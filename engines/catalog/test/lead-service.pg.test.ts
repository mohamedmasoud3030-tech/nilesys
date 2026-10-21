/**
 * Lead service on REAL PostgreSQL (multi-connection pool, nile_app, FORCE RLS).
 *
 * PGlite (lead-service.test.ts) is a single connection, so it cannot exercise
 * two transactions racing on the same lead. These tests can: the race is made
 * deterministic by holding the lead's row lock on a third connection until both
 * moveLead transactions have read stage=NEW and are blocked on their UPDATE
 * (observed in pg_stat_activity), then releasing it. Under READ COMMITTED the
 * second UPDATE re-evaluates `WHERE stage = 'NEW'`, matches 0 rows and must
 * surface as lead_stage_conflict — never as a silent lost update.
 *
 * Skipped unless NILE_TEST_PG_ADMIN_URL is set (see ./pg-harness.ts).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { DomainError } from '../../transactions/src/line.js';
import { leads } from '../src/db/schema.js';
import { captureLead, listLeads, moveLead } from '../src/lead-service.js';
import { ADMIN_URL, createPgHarness, holdRowLock, rawClient, waitForLockWaiters, type PgHarness } from './pg-harness.js';

const lead = { source: 'gym', customerName: 'Race Test', customerPhone: '+201001112233' } as const;

function codeOf(r: PromiseSettledResult<unknown>): string | undefined {
  if (r.status === 'fulfilled') return undefined;
  const e = r.reason as unknown;
  return e instanceof DomainError ? e.code : `non-domain:${String((e as Error)?.message ?? e)}`;
}

describe.skipIf(!ADMIN_URL)('lead service on real PostgreSQL', () => {
  let h: PgHarness;
  let db: NileDb;
  let A: string;
  let B: string;

  beforeAll(async () => {
    h = await createPgHarness('lead');
    db = h.opened.db;
    [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'pg-lead-a' }).returning({ id: organization.id })) as [{ id: string }];
    [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'pg-lead-b' }).returning({ id: organization.id })) as [{ id: string }];
  }, 60_000);
  afterAll(async () => {
    await h?.dispose();
  });

  it('runs as the non-bypass runtime role on a multi-connection pool', async () => {
    const res = (await db.execute(
      sql`SELECT current_user AS u, r.rolsuper AS s, r.rolbypassrls AS b FROM pg_roles r WHERE r.rolname = current_user`,
    )) as unknown as { rows: Array<{ u: string; s: boolean; b: boolean }> };
    expect(res.rows[0]).toEqual({ u: 'nile_app', s: false, b: false });
    expect(h.opened.driver).toBe('postgres');
  });

  it('forced race NEW→CONTACTED vs NEW→LOST: exactly one wins, the other gets lead_stage_conflict', async () => {
    const { id } = await captureLead(db, A, lead);
    const lock = await holdRowLock(h.loginUrl, A, 'leads', id);
    const racing = Promise.allSettled([moveLead(db, A, id, 'CONTACTED'), moveLead(db, A, id, 'LOST')]);
    await waitForLockWaiters(h.observer, h.dbName, 2); // both have read NEW and are blocked on UPDATE
    await lock.release();
    const results = await racing;

    const winners = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ stage: string }>[];
    expect(winners).toHaveLength(1);
    expect(results.map(codeOf).filter(Boolean)).toEqual(['lead_stage_conflict']);
    const [stored] = await listLeads(db, A, {}).then((all) => all.filter((l) => l.id === id));
    expect(stored?.stage).toBe(winners[0]!.value.stage); // the loser did not overwrite the winner
  });

  it('forced race on the same target: one success, one lead_stage_conflict (no double transition)', async () => {
    const { id } = await captureLead(db, A, lead);
    const lock = await holdRowLock(h.loginUrl, A, 'leads', id);
    const racing = Promise.allSettled([moveLead(db, A, id, 'CONTACTED'), moveLead(db, A, id, 'CONTACTED')]);
    await waitForLockWaiters(h.observer, h.dbName, 2);
    await lock.release();
    const results = await racing;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.map(codeOf).filter(Boolean)).toEqual(['lead_stage_conflict']);
  });

  it('unforced burst: 25 leads × 4 concurrent identical moves → exactly one success per lead, losers get a domain error', async () => {
    const ids = await Promise.all(Array.from({ length: 25 }, () => captureLead(db, A, lead).then((l) => l.id)));
    const perLead = await Promise.all(ids.map((id) => Promise.allSettled([1, 2, 3, 4].map(() => moveLead(db, A, id, 'CONTACTED')))));
    for (const results of perLead) {
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // Depending on interleaving the loser either lost the UPDATE (conflict) or read the
      // already-moved row (CONTACTED→CONTACTED is not a legal move). Never a raw SQL error.
      for (const c of results.map(codeOf).filter(Boolean)) expect(['lead_stage_conflict', 'invalid_lead_transition']).toContain(c);
    }
  });

  it('tenant isolation through the pool: B cannot list, move or write into A', async () => {
    const { id } = await captureLead(db, A, lead);
    expect((await listLeads(db, B, {})).some((l) => l.id === id)).toBe(false);
    await expect(moveLead(db, B, id, 'CONTACTED')).rejects.toMatchObject({ code: 'lead_not_found' });
    expect((await listLeads(db, A, {})).find((l) => l.id === id)?.stage).toBe('NEW');

    // WITH CHECK: a row for tenant A cannot be inserted while the context is B.
    const insertErr = await withTenant(db, B, (tx: any) =>
      tx.insert(leads).values({ tenantId: A, source: 'gym', customerName: 'x', customerPhone: '+201001112233' }),
    ).then(() => null, (e: any) => e);
    let cause: any = insertErr;
    while (cause && !cause.code) cause = cause.cause;
    expect(cause?.code).toBe('42501'); // new row violates row-level security policy
  });

  it('without tenant context the runtime role sees no leads at all (fail closed)', async () => {
    const c = rawClient(h.loginUrl);
    await c.connect();
    try {
      await c.query('SET ROLE nile_app');
      expect((await c.query('SELECT count(*)::int AS n FROM leads')).rows[0].n).toBe(0);
      const owner = await h.observer.query('SELECT count(*)::int AS n FROM leads'); // superuser view
      expect(owner.rows[0].n).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });

  it('interleaved concurrent requests for A and B never bleed tenant context across pooled connections', async () => {
    await captureLead(db, B, { ...lead, customerName: 'Tenant B lead' });
    const runs = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const t = i % 2 ? A : B;
        return listLeads(db, t, {}).then((rows) => ({ t, rows }));
      }),
    );
    for (const { t, rows } of runs) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === t)).toBe(true);
    }
  });
});
