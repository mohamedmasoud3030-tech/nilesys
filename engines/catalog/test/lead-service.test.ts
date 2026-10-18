/**
 * Lead capture on real PostgreSQL (PGlite) through the production path
 * (open.ts: migrations as owner, queries as the non-bypass role nile_app).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type NileDb, type OpenedDatabase } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { TenantScopeError, withTenant } from '../../platform/src/db/with-tenant.js';
import { DomainError } from '../../transactions/src/line.js';
import { leads } from '../src/db/schema.js';
import { captureLead, listLeads, moveLead } from '../src/lead-service.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;

const valid = { source: 'clinic', customerName: '  منى أحمد ', customerPhone: '+20 100-123-4567', message: 'أريد حجز كشف' } as const;

async function domainCode(p: Promise<unknown>): Promise<string | undefined> {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'expected a rejection').toBeInstanceOf(DomainError);
  return (e as DomainError).code;
}
async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  let e: any = await p.then(() => null, (x) => x);
  while (e && !e.code) e = e.cause;
  return e?.code;
}
const rawCount = async (tenantId: string) =>
  withTenant(db, tenantId, async (tx: any) => Number((await tx.select({ n: sql<number>`count(*)` }).from(leads))[0].n));

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'lead-a' }).returning({ id: organization.id })) as [{ id: string }];
  [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'lead-b' }).returning({ id: organization.id })) as [{ id: string }];
});
afterAll(() => opened.close());

describe('captureLead — valid requests', () => {
  it('stores a normalised lead at stage NEW in the caller tenant', async () => {
    const lead = await captureLead(db, A, valid);
    expect(lead).toMatchObject({
      tenantId: A,
      source: 'clinic',
      customerName: 'منى أحمد',
      customerPhone: '+201001234567',
      message: 'أريد حجز كشف',
      stage: 'NEW',
    });
    expect(lead.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(lead.createdAt))).toBe(false);
  });

  it('accepts every one of the 7 site sources and treats a blank message as absent', async () => {
    for (const source of ['courts', 'restaurant', 'clinic', 'realestate', 'gym', 'mobile', 'fashion']) {
      const lead = await captureLead(db, B, { source, customerName: 'Ali', customerPhone: '91234567', message: '   ' });
      expect(lead.source).toBe(source);
      expect(lead).not.toHaveProperty('message');
    }
  });
});

describe('captureLead — invalid input is rejected before any write', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['unknown source', { ...valid, source: 'casino' }],
    ['name too short after trim', { ...valid, customerName: ' a ' }],
    ['phone with letters', { ...valid, customerPhone: '0100-CALL-ME' }],
    ['phone too short', { ...valid, customerPhone: '12345' }],
    ['message over 1000 chars', { ...valid, message: 'x'.repeat(1001) }],
    ['client-supplied tenantId', { ...valid, tenantId: '00000000-0000-4000-8000-000000000001' }],
    ['client-supplied stage', { ...valid, stage: 'WON' }],
    ['missing phone', { source: 'gym', customerName: 'Sara' }],
  ];

  it.each(cases)('%s → validation_failed', async (_label, body) => {
    const before = await rawCount(A);
    expect(await domainCode(captureLead(db, A, body))).toBe('validation_failed');
    expect(await rawCount(A)).toBe(before);
  });

  it('non-object bodies are rejected', async () => {
    for (const body of [null, undefined, 'lead', 42, []]) expect(await domainCode(captureLead(db, A, body))).toBe('validation_failed');
  });

  it('missing or malformed tenant id fails before touching the database', async () => {
    await expect(captureLead(db, '', valid)).rejects.toBeInstanceOf(TenantScopeError);
    await expect(captureLead(db, "x' OR 1=1 --", valid)).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe('cross-tenant isolation (enforced by RLS, not by filters)', () => {
  it('each tenant lists only its own leads', async () => {
    const a = await listLeads(db, A);
    const b = await listLeads(db, B);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((l) => l.tenantId === A)).toBe(true);
    expect(b.every((l) => l.tenantId === B)).toBe(true);
    const aIds = new Set(a.map((l) => l.id));
    expect(b.some((l) => aIds.has(l.id))).toBe(false);
  });

  it('without tenant context the runtime role sees zero leads', async () => {
    expect(Number((await db.select({ n: sql<number>`count(*)` }).from(leads))[0]!.n)).toBe(0);
  });

  it('a direct insert carrying another tenant id is refused by RLS WITH CHECK (42501)', async () => {
    expect(
      await sqlState(
        withTenant(db, A, (tx: any) => tx.insert(leads).values({ tenantId: B, source: 'gym', customerName: 'evil', customerPhone: '12345678' })),
      ),
    ).toBe('42501');
  });

  it('tenant A cannot move, and cannot learn about, tenant B lead', async () => {
    const [bLead] = await listLeads(db, B, { limit: 1 });
    expect(await domainCode(moveLead(db, A, bLead!.id, 'CONTACTED'))).toBe('lead_not_found');
    const after = (await listLeads(db, B, { limit: 200 })).find((l) => l.id === bLead!.id);
    expect(after?.stage).toBe('NEW');
  });
});

describe('listing filters', () => {
  it('filters by stage and source, newest first, and bounds the limit', async () => {
    const t = A;
    const first = await captureLead(db, t, { source: 'gym', customerName: 'Gym One', customerPhone: '01000000001' });
    const second = await captureLead(db, t, { source: 'gym', customerName: 'Gym Two', customerPhone: '01000000002' });
    const gym = await listLeads(db, t, { source: 'gym' });
    expect(gym.map((l) => l.id).slice(0, 2)).toEqual([second.id, first.id]);
    expect((await listLeads(db, t, { limit: 1 })).length).toBe(1);
    expect(await domainCode(listLeads(db, t, { limit: 0 }))).toBe('validation_failed');
    expect(await domainCode(listLeads(db, t, { limit: 201 }))).toBe('validation_failed');
    expect(await domainCode(listLeads(db, t, { stage: 'ARCHIVED' as never }))).toBe('validation_failed');
  });
});

describe('moveLead — pipeline transitions', () => {
  it('follows canMoveLead and refuses skips, reversals and terminal moves', async () => {
    const lead = await captureLead(db, A, { source: 'realestate', customerName: 'Owner', customerPhone: '96891234567' });
    expect(await domainCode(moveLead(db, A, lead.id, 'WON'))).toBe('invalid_lead_transition');
    expect((await moveLead(db, A, lead.id, 'CONTACTED')).stage).toBe('CONTACTED');
    expect(await domainCode(moveLead(db, A, lead.id, 'NEW'))).toBe('invalid_lead_transition');
    expect((await moveLead(db, A, lead.id, 'QUALIFIED')).stage).toBe('QUALIFIED');
    expect((await moveLead(db, A, lead.id, 'WON')).stage).toBe('WON');
    expect(await domainCode(moveLead(db, A, lead.id, 'LOST'))).toBe('invalid_lead_transition');
    expect((await listLeads(db, A, { stage: 'WON' })).map((l) => l.id)).toContain(lead.id);
  });

  it('rejects unknown stages and malformed ids without a database round-trip', async () => {
    const lead = await captureLead(db, A, { source: 'mobile', customerName: 'Buyer', customerPhone: '0501234567' });
    expect(await domainCode(moveLead(db, A, lead.id, 'ARCHIVED'))).toBe('validation_failed');
    expect(await domainCode(moveLead(db, A, 'not-a-uuid', 'CONTACTED'))).toBe('lead_not_found');
  });
});
