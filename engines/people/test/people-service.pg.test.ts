/**
 * People service on REAL PostgreSQL (multi-connection pool, nile_app, FORCE RLS).
 *
 * PGlite (people-service.test.ts) is a single connection and cannot interleave
 * two transactions. Here the "first record of the day" race is made
 * deterministic: a third connection inserts (but does not commit) the same
 * employee-day row, so both recordAttendance transactions read "no row yet" and
 * block on the unique index (observed in pg_stat_activity); the holder then
 * rolls back. One insert wins; the other hits attendance_tenant_emp_day_uq and
 * must be merged into the winner's row, not surfaced as a raw SQL error.
 *
 * Skipped unless NILE_TEST_PG_ADMIN_URL is set (see ../../catalog/test/pg-harness.ts).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, createPgHarness, holdRowLock, rawClient, waitForLockWaiters, type PgHarness } from '../../catalog/test/pg-harness.js';
import { RUNTIME_ROLE, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { attendanceRecords } from '../src/db/schema.js';
import { createEmployee, listAttendance, listEmployees, recordAttendance } from '../src/people-service.js';

function sqlState(e: unknown): string | undefined {
  let c: any = e;
  while (c && !c.code) c = c.cause;
  return c?.code;
}

describe.skipIf(!ADMIN_URL)('people service on real PostgreSQL', () => {
  let h: PgHarness;
  let db: NileDb;
  let A: string;
  let B: string;
  let empA: string;
  let empB: string;

  /** Uncommitted insert of the same employee-day on a separate connection. */
  async function holdUncommittedAttendance(tenantId: string, employeeId: string, day: string) {
    const c = rawClient(h.loginUrl);
    await c.connect();
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(`INSERT INTO attendance_records (tenant_id, employee_id, day, status) VALUES ($1, $2, $3, 'PRESENT')`, [
      tenantId,
      employeeId,
      day,
    ]);
    return {
      rollback: async () => {
        await c.query('ROLLBACK');
        await c.end();
      },
    };
  }
  const rowsFor = (tenantId: string, employeeId: string, day: string) =>
    withTenant(db, tenantId, (tx: any) =>
      tx
        .select()
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.day, day))),
    ) as Promise<Array<{ checkIn: string | null; checkOut: string | null; status: string }>>;

  beforeAll(async () => {
    h = await createPgHarness('people');
    db = h.opened.db;
    [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'pg-people-a' }).returning({ id: organization.id })) as [{ id: string }];
    [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'pg-people-b' }).returning({ id: organization.id })) as [{ id: string }];
    empA = (await createEmployee(db, A, { name: 'سارة علي', role: 'cashier', baseSalaryMinor: 520_000 })).id;
    empB = (await createEmployee(db, B, { name: 'Omar', role: 'storekeeper', baseSalaryMinor: 400_000 })).id;
  }, 60_000);
  afterAll(async () => {
    await h?.dispose();
  });

  it('forced race on the first record of an employee-day: both calls succeed and merge into ONE row', async () => {
    const day = '2026-10-05';
    const holder = await holdUncommittedAttendance(A, empA, day);
    const racing = Promise.allSettled([
      recordAttendance(db, A, { employeeId: empA, day, checkIn: '09:00' }),
      recordAttendance(db, A, { employeeId: empA, day, checkIn: '09:00', checkOut: '17:00' }),
    ]);
    await waitForLockWaiters(h.observer, h.dbName, 2); // both read "no row" and are blocked on the unique index
    await holder.rollback();
    const results = await racing;

    expect(results.map((r) => (r.status === 'fulfilled' ? 'ok' : sqlState(r.reason) ?? String(r.reason)))).toEqual(['ok', 'ok']);
    const rows = await rowsFor(A, empA, day);
    expect(rows).toHaveLength(1);
    // Either serial order yields the same merge: check-in 09:00 and check-out 17:00.
    expect(rows[0]).toMatchObject({ checkIn: '09:00', checkOut: '17:00', status: 'PRESENT' });
  });

  it('forced race on an EXISTING row: two partial updates are serialised, no field is lost', async () => {
    const day = '2026-10-09';
    await recordAttendance(db, A, { employeeId: empA, day, checkIn: '09:00' });
    const { rows: idRows } = await h.observer.query<{ id: string }>(
      'SELECT id FROM attendance_records WHERE employee_id = $1 AND day = $2',
      [empA, day],
    );
    const lock = await holdRowLock(h.loginUrl, A, 'attendance_records', idRows[0]!.id);
    const racing = Promise.allSettled([
      recordAttendance(db, A, { employeeId: empA, day, status: 'LATE', checkOut: '17:00' }),
      recordAttendance(db, A, { employeeId: empA, day, status: 'LATE', checkIn: '09:20' }),
    ]);
    await waitForLockWaiters(h.observer, h.dbName, 2);
    await lock.release();
    const results = await racing;
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    // Either serial order merges to the same row; a lost update would drop one field.
    const rows = await rowsFor(A, empA, day);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ checkIn: '09:20', checkOut: '17:00', status: 'LATE' });
  });

  it('unforced burst: 8 concurrent check-ins for one employee-day never error and leave exactly one row', async () => {
    const day = '2026-10-06';
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => recordAttendance(db, A, { employeeId: empA, day, checkIn: '08:55' })));
    expect(results.filter((r) => r.status === 'rejected').map((r) => sqlState((r as PromiseRejectedResult).reason))).toEqual([]);
    expect(await rowsFor(A, empA, day)).toHaveLength(1);
  });

  it('tenant isolation through the pool: B cannot see or record attendance for A’s employee', async () => {
    await recordAttendance(db, A, { employeeId: empA, day: '2026-10-07', checkIn: '09:00' });
    expect((await listEmployees(db, B)).some((e) => e.id === empA)).toBe(false);
    await expect(recordAttendance(db, B, { employeeId: empA, day: '2026-10-07', checkIn: '10:00' })).rejects.toMatchObject({
      code: 'employee_not_found',
    });
    await expect(listAttendance(db, B, { employeeId: empA, month: '2026-10' })).rejects.toMatchObject({ code: 'employee_not_found' });
    expect((await listAttendance(db, A, { employeeId: empA, month: '2026-10' })).length).toBeGreaterThan(0);
    expect((await rowsFor(A, empA, '2026-10-07'))[0]?.checkIn).toBe('09:00');
  });

  it('composite FK is a database-level guard: tenant A cannot attach attendance to tenant B’s employee', async () => {
    const err = await withTenant(db, A, (tx: any) =>
      tx.insert(attendanceRecords).values({ tenantId: A, employeeId: empB, day: '2026-10-08', status: 'PRESENT' }),
    ).then(() => null, (e: unknown) => e);
    expect(sqlState(err)).toBe('23503'); // foreign_key_violation on (tenant_id, employee_id)
  });

  it('without tenant context the runtime role sees no employees (fail closed)', async () => {
    const c = rawClient(h.loginUrl);
    await c.connect();
    try {
      await c.query(`SET ROLE ${RUNTIME_ROLE}`);
      expect((await c.query('SELECT count(*)::int AS n FROM employees')).rows[0].n).toBe(0);
      expect((await h.observer.query('SELECT count(*)::int AS n FROM employees')).rows[0].n).toBeGreaterThanOrEqual(2);
    } finally {
      await c.end();
    }
  });
});
