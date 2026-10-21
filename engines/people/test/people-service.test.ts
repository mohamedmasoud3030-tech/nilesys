/**
 * People service on real PostgreSQL (PGlite) through the production path
 * (open.ts: migrations as owner, queries as the non-bypass role nile_app).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type NileDb, type OpenedDatabase } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { TenantScopeError, withTenant } from '../../platform/src/db/with-tenant.js';
import { DomainError } from '../../transactions/src/line.js';
import { attendanceRecords, employees, loans } from '../src/db/schema.js';
import { computePayslip } from '../src/payroll.js';
import {
  computeMonthlyPayslip,
  createEmployee,
  listAttendance,
  listEmployees,
  nextLoanInstallment,
  recordAttendance,
  type PayPolicy,
} from '../src/people-service.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let empA: string;
let empB: string;

const policy: PayPolicy = {
  workingDaysInMonth: 26,
  scheduledStart: '09:00',
  standardMinutes: 480,
  lateRatePerMinuteMinor: 50,
  overtimeRatePerMinuteMinor: 100,
};

async function domainCode(p: Promise<unknown>): Promise<string | undefined> {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'expected a DomainError').toBeInstanceOf(DomainError);
  return (e as DomainError).code;
}
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  let e: any = await p.then(() => null, (x) => x);
  while (e && !e.code) e = e.cause;
  return e?.code;
}
const count = (tenantId: string, table: any) =>
  withTenant(db, tenantId, async (tx: any) => Number((await tx.select({ n: sql<number>`count(*)` }).from(table))[0].n));

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'hr-a' }).returning({ id: organization.id })) as [{ id: string }];
  [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'hr-b' }).returning({ id: organization.id })) as [{ id: string }];
  empA = (await createEmployee(db, A, { name: ' سارة علي ', role: 'cashier', phone: '01001234567', baseSalaryMinor: 520_000 })).id;
  empB = (await createEmployee(db, B, { name: 'Omar', role: 'storekeeper', baseSalaryMinor: 400_000 })).id;
});
afterAll(() => opened.close());

describe('employees', () => {
  it('creates a trimmed, active employee and lists it in its own tenant only', async () => {
    const listA = await listEmployees(db, A);
    expect(listA).toEqual([{ id: empA, name: 'سارة علي', role: 'cashier', phone: '01001234567', baseSalaryMinor: 520_000, isActive: true }]);
    expect((await listEmployees(db, B)).map((e) => e.id)).toEqual([empB]);
  });

  it.each([
    ['name too short', { name: 'x', role: 'r', baseSalaryMinor: 1 }],
    ['negative salary', { name: 'Name', role: 'r', baseSalaryMinor: -1 }],
    ['fractional salary', { name: 'Name', role: 'r', baseSalaryMinor: 10.5 }],
    ['client-supplied tenantId', { name: 'Name', role: 'r', baseSalaryMinor: 1, tenantId: '00000000-0000-4000-8000-000000000001' }],
    ['client-supplied isActive', { name: 'Name', role: 'r', baseSalaryMinor: 1, isActive: false }],
  ])('%s → validation_failed, nothing written', async (_l, body) => {
    const before = await count(A, employees);
    expect(await domainCode(createEmployee(db, A, body))).toBe('validation_failed');
    expect(await count(A, employees)).toBe(before);
  });

  it('inactive employees are hidden by default and shown on request', async () => {
    const tmp = await createEmployee(db, B, { name: 'Left Company', role: 'x', baseSalaryMinor: 1 });
    await withTenant(db, B, (tx: any) => tx.update(employees).set({ isActive: false }).where(sql`id = ${tmp.id}`));
    expect((await listEmployees(db, B)).map((e) => e.id)).not.toContain(tmp.id);
    expect((await listEmployees(db, B, { includeInactive: true })).map((e) => e.id)).toContain(tmp.id);
    expect(await domainCode(recordAttendance(db, B, { employeeId: tmp.id, day: '2026-10-01', status: 'PRESENT', checkIn: '09:00' }))).toBe(
      'employee_not_found',
    );
  });
});

describe('attendance', () => {
  it('merges a morning check-in and an evening check-out into one record', async () => {
    await recordAttendance(db, A, { employeeId: empA, day: '2026-09-01', checkIn: '09:10' });
    const done = await recordAttendance(db, A, { employeeId: empA, day: '2026-09-01', checkOut: '18:10' });
    expect(done).toEqual({ employeeId: empA, day: '2026-09-01', checkIn: '09:10', checkOut: '18:10', status: 'PRESENT' });
    expect((await listAttendance(db, A, { employeeId: empA, month: '2026-09' })).length).toBe(1);
  });

  it('a merged row that would end before it starts rolls back entirely', async () => {
    await recordAttendance(db, A, { employeeId: empA, day: '2026-09-02', checkIn: '10:00' });
    expect(await domainCode(recordAttendance(db, A, { employeeId: empA, day: '2026-09-02', checkOut: '09:30' }))).toBe('invalid_attendance');
    const [row] = (await listAttendance(db, A, { employeeId: empA, month: '2026-09' })).filter((r) => r.day === '2026-09-02');
    expect(row).toMatchObject({ checkIn: '10:00', checkOut: null });
  });

  it('refuses a check-out with no check-in', async () => {
    expect(await domainCode(recordAttendance(db, A, { employeeId: empA, day: '2026-09-03', checkOut: '17:00' }))).toBe('invalid_attendance');
  });

  it('ABSENT clears times; ABSENT with times is invalid input', async () => {
    await recordAttendance(db, A, { employeeId: empA, day: '2026-09-04', checkIn: '09:00' });
    const absent = await recordAttendance(db, A, { employeeId: empA, day: '2026-09-04', status: 'ABSENT' });
    expect(absent).toMatchObject({ status: 'ABSENT', checkIn: null, checkOut: null });
    expect(await domainCode(recordAttendance(db, A, { employeeId: empA, day: '2026-09-05', status: 'ABSENT', checkIn: '09:00' }))).toBe(
      'validation_failed',
    );
  });

  it.each([
    ['impossible date', { day: '2026-02-30', checkIn: '09:00' }],
    ['bad time', { day: '2026-09-06', checkIn: '25:00' }],
    ['unknown status', { day: '2026-09-06', status: 'SICK' }],
    ['non-uuid employee', { day: '2026-09-06', employeeId: 'abc' }],
    ['extra field', { day: '2026-09-06', checkIn: '09:00', tenantId: '00000000-0000-4000-8000-000000000001' }],
  ])('%s → validation_failed', async (_l, patch) => {
    expect(await domainCode(recordAttendance(db, A, { employeeId: empA, ...patch }))).toBe('validation_failed');
  });

  it('rejects malformed month on listing', async () => {
    expect(await domainCode(listAttendance(db, A, { employeeId: empA, month: '2026-13' }))).toBe('validation_failed');
  });
});

describe('cross-tenant isolation', () => {
  it('tenant A cannot record attendance for tenant B employee — and nothing is written anywhere', async () => {
    const before = [await count(A, attendanceRecords), await count(B, attendanceRecords)];
    expect(await domainCode(recordAttendance(db, A, { employeeId: empB, day: '2026-09-07', checkIn: '09:00' }))).toBe('employee_not_found');
    expect([await count(A, attendanceRecords), await count(B, attendanceRecords)]).toEqual(before);
  });

  it('the composite FK blocks a direct insert pointing at another tenant employee (23503)', async () => {
    expect(
      await sqlState(withTenant(db, A, (tx: any) => tx.insert(attendanceRecords).values({ tenantId: A, employeeId: empB, day: '2026-09-08' }))),
    ).toBe('23503');
  });

  it('RLS WITH CHECK blocks inserting rows as another tenant (42501)', async () => {
    expect(
      await sqlState(withTenant(db, A, (tx: any) => tx.insert(employees).values({ tenantId: B, name: 'evil', role: 'x', baseSalaryMinor: 1 }))),
    ).toBe('42501');
  });

  it('tenant B employee is "not found" for tenant A reads and payslips', async () => {
    expect(await domainCode(listAttendance(db, A, { employeeId: empB, month: '2026-09' }))).toBe('employee_not_found');
    expect(await domainCode(computeMonthlyPayslip(db, A, { employeeId: empB, month: '2026-09', policy }))).toBe('employee_not_found');
  });

  it('without tenant context the runtime role sees no people data', async () => {
    for (const t of [employees, attendanceRecords, loans]) {
      expect(Number((await db.select({ n: sql<number>`count(*)` }).from(t))[0]!.n)).toBe(0);
    }
  });

  it('malformed tenant ids fail before touching the database', async () => {
    await expect(listEmployees(db, 'nope')).rejects.toBeInstanceOf(TenantScopeError);
    await expect(createEmployee(db, '', { name: 'Name', role: 'r', baseSalaryMinor: 1 })).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe('monthly payslip (computed from stored attendance + loans, never persisted)', () => {
  it('matches the pure engine on hand-checked figures', async () => {
    const emp = (await createEmployee(db, A, { name: 'Payroll Case', role: 'clerk', baseSalaryMinor: 260_000 })).id;
    // 09:20–18:00 → 20 late, 40 overtime · 08:50–17:50 → 0 late, 60 overtime · one ABSENT · one LEAVE (ignored)
    await recordAttendance(db, A, { employeeId: emp, day: '2026-08-03', checkIn: '09:20', checkOut: '18:00' });
    await recordAttendance(db, A, { employeeId: emp, day: '2026-08-04', checkIn: '08:50', checkOut: '17:50', status: 'LATE' });
    await recordAttendance(db, A, { employeeId: emp, day: '2026-08-05', status: 'ABSENT' });
    await recordAttendance(db, A, { employeeId: emp, day: '2026-08-06', status: 'LEAVE' });
    await recordAttendance(db, A, { employeeId: emp, day: '2026-09-01', checkIn: '12:00' }); // other month: excluded
    await withTenant(db, A, (tx: any) => tx.insert(loans).values({ tenantId: A, employeeId: emp, totalMinor: 10_000, months: 3, remainingMinor: 10_000 }));

    const r = await computeMonthlyPayslip(db, A, { employeeId: emp, month: '2026-08', policy: { ...policy, allowancesMinor: 5_000 } });
    expect(r.attendance).toEqual({ recordedDays: 4, absentDays: 1, lateMinutes: 20, overtimeMinutes: 100 });
    expect(r.loanInstallmentMinor).toBe(3_333);
    expect(r.payslip).toEqual(
      computePayslip({
        baseSalaryMinor: 260_000, workingDaysInMonth: 26, absentDays: 1, lateMinutes: 20, lateRatePerMinuteMinor: 50,
        overtimeMinutes: 100, overtimeRatePerMinuteMinor: 100, loanInstallmentMinor: 3_333, allowancesMinor: 5_000,
      }),
    );
    // Explicit numbers so a change in the pure engine cannot silently pass:
    // daily 10,000 · absence 10,000 · late 1,000 · overtime 10,000 · gross 275,000 · deductions 14,333 · net 260,667
    expect(r.payslip).toEqual({
      dailyRateMinor: 10_000, absenceDeductionMinor: 10_000, lateDeductionMinor: 1_000, overtimePayMinor: 10_000,
      grossMinor: 275_000, totalDeductionsMinor: 14_333, netMinor: 260_667,
    });
    // Read-only: computing twice changes nothing.
    expect(await computeMonthlyPayslip(db, A, { employeeId: emp, month: '2026-08', policy: { ...policy, allowancesMinor: 5_000 } })).toEqual(r);
  });

  it('rejects an invalid policy or month', async () => {
    expect(await domainCode(computeMonthlyPayslip(db, A, { employeeId: empA, month: '2026-09', policy: { ...policy, workingDaysInMonth: 0 } }))).toBe(
      'validation_failed',
    );
    expect(await domainCode(computeMonthlyPayslip(db, A, { employeeId: empA, month: 'Sept', policy }))).toBe('validation_failed');
    expect(
      await domainCode(computeMonthlyPayslip(db, A, { employeeId: empA, month: '2026-09', policy: { ...policy, bonusMultiplier: 2 } as never })),
    ).toBe('validation_failed');
  });
});

describe('nextLoanInstallment', () => {
  it('walks the schedule and lets the last installment absorb rounding', () => {
    expect(nextLoanInstallment(10_000, 3, 10_000)).toBe(3_333);
    expect(nextLoanInstallment(10_000, 3, 6_667)).toBe(3_333);
    expect(nextLoanInstallment(10_000, 3, 3_334)).toBe(3_334);
    expect(nextLoanInstallment(10_000, 3, 0)).toBe(0);
  });
  it('never deducts more than is owed when the balance was adjusted off-schedule', () => {
    expect(nextLoanInstallment(10_000, 3, 1_000)).toBe(1_000);
    expect(nextLoanInstallment(10_000, 3, 5_000)).toBe(3_333);
  });
});
