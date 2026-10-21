/**
 * Split tender over HTTP: one sale paid with several tenders of the SAME method
 * and amount (e.g. two customers each hand 375 in cash for a 750 bill).
 *
 * Defect (2026-10-18): each payment row's idempotency key was
 * `${key}#pay:${method}:${amount}`, so two identical tenders produced the same
 * key, violated payments_tenant_idem_uq (23505) and the request failed with a
 * server error. The key now carries the tender's position in the request.
 *
 * Real HTTP (inject), real Better Auth, real PGlite, runtime role nile_app.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { organization } from '../../../engines/platform/src/auth/schema.js';
import { withTenant } from '../../../engines/platform/src/db/with-tenant.js';
import { payments } from '../../../engines/transactions/src/db/schema.js';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-split-tender-0123456789-abcdefghij';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-split-tender-'));
let opened: OpenedDatabase;
let created: CreatedApp;

type Res = { status: number; body: any; headers: Record<string, unknown> };
async function http(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const res = await created.app.getHttpAdapter().getInstance().inject({
    method: method as 'GET', url,
    headers: { origin: BASE, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, body, headers: res.headers };
}
async function login(email: string, password = 'demo1234') {
  const res = await http('POST', '/api/auth/sign-in/email', { body: { email, password } });
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

let cashier: string;
let manager: string;
let water: string; // WTR-600, 750 minor
let shiftId: string;
let tenantId: string;

/** The HTTP response carries { sale, replayed } only, so payments are read back as nile_app (RLS on). */
type PaymentRow = { id: string; method: string; amountMinor: number };
const paymentsOf = (saleId: string): Promise<PaymentRow[]> =>
  withTenant(opened.db, tenantId, (tx: any): Promise<PaymentRow[]> => tx.select({ id: payments.id, method: payments.method, amountMinor: payments.amountMinor }).from(payments).where(eq(payments.transactionId, saleId)));

beforeAll(async () => {
  opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  created = await createApp({ db: opened.db, auth }, { logger: false });
  tenantId = (await opened.db.select({ id: organization.id }).from(organization).where(eq(organization.slug, demoTenantSpec().slug)))[0]!.id;
  cashier = await login('cashier@nile.demo');
  manager = await login('pos-manager@nile.demo');
  const items = await http('GET', '/api/v1/catalog/items', { cookie: cashier });
  water = items.body.items.flatMap((i: any) => i.variants).find((v: any) => v.sku === 'WTR-600').id;
  const s = await http('POST', '/api/v1/shifts', { cookie: cashier, body: { registerCode: 'split', openingMinor: 10000, idempotencyKey: 'split-shift-001' } });
  shiftId = s.body.shift.id;
}, 60_000);
afterAll(async () => { await created?.app.close(); await opened?.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('split tender with identical tenders', () => {
  const cashSplit = { idempotencyKey: 'split-cash-0001', tenders: [{ method: 'cash', amountMinor: 375 }, { method: 'cash', amountMinor: 375 }] };

  it('cash 375 + cash 375 for a 750 sale is accepted and records two payments', async () => {
    const body = { ...cashSplit, shiftId, lines: [{ variantId: water, quantity: '1' }] };
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.sale.totalMinor).toBe(750);
    const paid = await paymentsOf(r.body.sale.id);
    expect(paid).toHaveLength(2);
    expect(paid.map((p: any) => [p.method, p.amountMinor])).toEqual([['cash', 375], ['cash', 375]]);
    expect(new Set(paid.map((p: any) => p.id)).size).toBe(2);

    // replaying the identical request returns the same sale and the same two payments
    const again = await http('POST', '/api/v1/checkout', { cookie: cashier, body });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.sale.id).toBe(r.body.sale.id);
    expect((await paymentsOf(r.body.sale.id)).map((p: any) => p.id).sort()).toEqual(paid.map((p: any) => p.id).sort());
  });

  it('card 375 + card 375 (no shift) is accepted', async () => {
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'split-card-0001', lines: [{ variantId: water, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 375 }, { method: 'card', amountMinor: 375 }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await paymentsOf(r.body.sale.id)).map((p: any) => [p.method, p.amountMinor])).toEqual([['card', 375], ['card', 375]]);
  });

  it('the shift closure counts both cash tenders exactly once', async () => {
    // opening 10000 + one split cash sale 750 (the replay must not add another 750)
    const r = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: manager, body: { countedMinor: 10750 } });
    expect(r.status).toBe(201);
    expect(r.body.closure.expectedMinor).toBe(10750);
    expect(r.body.closure.differenceMinor).toBe(0);
  });
});
