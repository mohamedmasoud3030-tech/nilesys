/**
 * POS extended E2E — checkout + shifts + refunds + reports + tenant isolation over HTTP.
 * Real HTTP (inject), real Better Auth, real PGlite, runtime role nile_app.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-pos-test-secret-pos-0123456789-abc';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-pos-e2e-'));

interface Running { opened: OpenedDatabase; created: CreatedApp }
let run: Running;

async function boot(): Promise<Running> {
  const opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  await provisionTenant(auth, opened.db, {
    slug: 'other-co', name: 'Other Co', password: 'other-pass-123',
    accounts: [{ role: 'cashier', email: 'cashier@other.test' }, { role: 'branch-manager', email: 'manager@other.test' }],
    catalog: [{ nameAr: 'صنف آخر', nameEn: 'Other item', category: 'x', priceMinor: 500, variants: [{ sku: 'OTH-1', labelAr: 'افتراضي', labelEn: 'Default', stock: '10' }] }],
  });
  const created = await createApp({ db: opened.db, auth }, { logger: false });
  return { opened, created };
}
async function shutdown(r: Running) { await r.created.app.close(); await r.opened.close(); }
type Res = { status: number; body: any; headers: Record<string, unknown> };
async function http(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const res = await run.created.app.getHttpAdapter().getInstance().inject({
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
let otherCashier: string;
let variantWtr: string;
let variantOil: string;
let shiftId: string;
let saleId: string;
let paymentId: string;

function todayStr() {
  // يوم القاهرة — المحرك يحدّ التقارير بحدود يوم Africa/Cairo، فلا يصح حساب «اليوم» بـUTC
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

beforeAll(async () => { run = await boot(); });
afterAll(async () => { await shutdown(run); rmSync(dataDir, { recursive: true, force: true }); });

describe('POS checkout via HTTP', () => {
  it('cashier and manager log in', async () => {
    cashier = await login('cashier@nile.demo');
    manager = await login('pos-manager@nile.demo');
    otherCashier = await login('cashier@other.test', 'other-pass-123');
    expect(cashier).toContain('session_token');
    expect(manager).toContain('session_token');
  });
  it('loads catalog', async () => {
    const r = await http('GET', '/api/v1/catalog/items', { cookie: cashier });
    expect(r.status).toBe(200);
    const flat = r.body.items.flatMap((i: any) => i.variants);
    variantWtr = flat.find((v: any) => v.sku === 'WTR-600')!.id;
    variantOil = flat.find((v: any) => v.sku === 'OIL-1L')!.id;
    expect(variantWtr).toBeDefined();
  });

  it('opens a cash shift (cashier can)', async () => {
    const r = await http('POST', '/api/v1/shifts', { cookie: cashier, body: { registerCode: 'main', openingMinor: 10000, idempotencyKey: 'pos-shift-001' } });
    expect(r.status).toBe(201);
    expect(r.body.shift.openingMinor).toBe(10000);
    shiftId = r.body.shift.id;
    // replay same key
    const r2 = await http('POST', '/api/v1/shifts', { cookie: cashier, body: { registerCode: 'main', openingMinor: 10000, idempotencyKey: 'pos-shift-001' } });
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBe(true);
  });

  it('rejects second open for same register while open', async () => {
    const r = await http('POST', '/api/v1/shifts', { cookie: cashier, body: { registerCode: 'main', openingMinor: 5000, idempotencyKey: 'pos-shift-002' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('shift_already_open');
  });

  it('checkout cash with shift succeeds; cash without shift is rejected', async () => {
    // cash with shift
    const ok = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-001', shiftId, lines: [{ variantId: variantWtr, quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 1500 }] } });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.totalMinor).toBe(1500);
    saleId = ok.body.sale.id;
    // fetch payment id via sale? we need to get sale via checkout response includes sale only; but we can get payment via report? Instead do another checkout to get payment for refund via DB? Easier: do checkout card for payment without shift
    // cash without shift should be rejected
    const bad = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-bad-001', lines: [{ variantId: variantWtr, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 750 }] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('shift_required_for_cash');
  });

  it('checkout card without shift succeeds', async () => {
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-002', lines: [{ variantId: variantOil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 8995 }] } });
    expect(r.status).toBe(201);
    expect(r.body.sale.totalMinor).toBe(8995);
  });

  it('tender mismatch is rejected', async () => {
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-bad-002', lines: [{ variantId: variantWtr, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 100 }] } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('tender_mismatch');
  });

  it('shift close computes expected vs counted', async () => {
    // shift has one cash sale 1500, opening 10000 => expected 11500
    const r = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: manager, body: { countedMinor: 11500 } });
    expect(r.status).toBe(201);
    expect(r.body.closure.expectedMinor).toBe(11500);
    expect(r.body.closure.differenceMinor).toBe(0);
    // get shift shows closed
    const g = await http('GET', `/api/v1/shifts/${shiftId}`, { cookie: cashier });
    expect(g.body.shift.isClosed).toBe(true);
    expect(g.body.shift.expectedMinor).toBe(11500);
  });

  it('closed shift cannot receive cash sale', async () => {
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-003', shiftId, lines: [{ variantId: variantWtr, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 750 }] } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('shift_closed');
  });

  it('open new shift for refunds on same register after close', async () => {
    const r = await http('POST', '/api/v1/shifts', { cookie: cashier, body: { registerCode: 'main', openingMinor: 11500, idempotencyKey: 'pos-shift-003' } });
    expect(r.status).toBe(201);
    shiftId = r.body.shift.id;
  });
});

describe('refunds via HTTP (manager only)', () => {
  let cashPaymentId: string;
  let cardPaymentId: string;
  beforeAll(async () => {
    // Create a cash sale on new shift for refund tests
    const r = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-ref-001', shiftId, lines: [{ variantId: variantWtr, quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 1500 }] } });
    expect(r.status).toBe(201);
    saleId = r.body.sale.id;
    // Need paymentId — fetch via direct DB? For e2e we can infer via report? Instead we do another sale via API and then use checkout to get payment via daily report? Simplify: do refund via known payment totals
    // We'll create a checkout and then query refunds endpoint needs paymentId. We can obtain paymentId via a direct HTTP endpoint? We don't have payments list endpoint, so we need to expose or we can cheat: create sale via old /api/v1/sales which returns sale but not payment? Actually checkout returns sale only, not payments. We need paymentId for refund.
    // Workaround: use the saleId as transactionId and fetch payments via DB in test via openPglite? But we have run.opened.db accessible.
    const { payments } = await import('../../../engines/transactions/src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const { withTenant } = await import('../../../engines/platform/src/db/with-tenant.js');
    const tenantId = (await http('GET', '/api/v1/me', { cookie: cashier })).body.tenant.id;
    const pays = await withTenant(run.opened.db, tenantId, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, saleId)));
    cashPaymentId = pays[0].id;
    // also card sale for card refund test
    const r2 = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-ref-002', lines: [{ variantId: variantOil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 8995 }] } });
    const pays2 = await withTenant(run.opened.db, tenantId, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, r2.body.sale.id)));
    cardPaymentId = pays2[0].id;
    // store card sale id for later card refund
    (globalThis as any).cardSaleId = r2.body.sale.id;
  });

  it('cashier cannot refund (403)', async () => {
    const r = await http('POST', '/api/v1/refunds', { cookie: cashier, body: { idempotencyKey: 'pos-ref-001', originalTransactionId: saleId, paymentId: cashPaymentId, items: [{ variantId: variantWtr, quantity: '1' }], shiftId } });
    expect(r.status).toBe(403);
  });

  it('manager can do partial cash refund with shift', async () => {
    const r = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-001', originalTransactionId: saleId, paymentId: cashPaymentId, items: [{ variantId: variantWtr, quantity: '1' }], shiftId } });
    expect(r.status).toBe(201);
    expect(r.body.refund.amountMinor).toBe(750);
    // replay
    const r2 = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-001', originalTransactionId: saleId, paymentId: cashPaymentId, items: [{ variantId: variantWtr, quantity: '1' }], shiftId } });
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBe(true);
  });

  it('over-refund is rejected', async () => {
    const r = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-002', originalTransactionId: saleId, paymentId: cashPaymentId, items: [{ variantId: variantWtr, quantity: '2' }], shiftId } });
    // already refunded 1 of 2, trying 2 more exceeds 2 total
    expect(r.status).toBe(422);
    expect(['refund_over_limit', 'refund_quantity_exceeded']).toContain(r.body.error);
  });

  it('card refund without shift succeeds', async () => {
    const cardSaleId = (globalThis as any).cardSaleId;
    const r = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-003', originalTransactionId: cardSaleId, paymentId: cardPaymentId, items: [{ variantId: variantOil, quantity: '1' }] } });
    expect(r.status).toBe(201);
    expect(r.body.refund.amountMinor).toBe(8995);
  });

  it('duplicate key with different body → 409', async () => {
    const cardSaleId = (globalThis as any).cardSaleId;
    // Need fresh sale for this test
    const rNew = await http('POST', '/api/v1/checkout', { cookie: cashier, body: { idempotencyKey: 'pos-chk-ref-003', lines: [{ variantId: variantWtr, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 750 }] } });
    const pays = await (async () => {
      const { payments } = await import('../../../engines/transactions/src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const { withTenant } = await import('../../../engines/platform/src/db/with-tenant.js');
      const tenantId = (await http('GET', '/api/v1/me', { cookie: cashier })).body.tenant.id;
      return withTenant(run.opened.db, tenantId, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, rNew.body.sale.id)));
    })();
    const pid = pays[0].id;
    const ok = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-dup-001', originalTransactionId: rNew.body.sale.id, paymentId: pid, items: [{ variantId: variantWtr, quantity: '1' }] } });
    expect(ok.status).toBe(201);
    const conflict = await http('POST', '/api/v1/refunds', { cookie: manager, body: { idempotencyKey: 'pos-ref-dup-001', originalTransactionId: rNew.body.sale.id, paymentId: pid, items: [{ variantId: variantWtr, quantity: '0.5' }] } });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_conflict');
  });
});

describe('reports via HTTP + tenant isolation (D-D proposal: report:read)', () => {
  it('manager with report:read sees gross/net/by method', async () => {
    const today = todayStr();
    const r = await http('GET', `/api/v1/reports/daily?from=${today}&to=${today}`, { cookie: manager });
    expect(r.status).toBe(200);
    // At least our sales above
    expect(r.body.report.grossMinor).toBeGreaterThan(0);
    expect(r.body.report.netMinor).toBe(r.body.report.grossMinor - r.body.report.refundsMinor);
    expect(r.body.report.byMethod.length).toBeGreaterThan(0);
    // profit excluded
    expect(r.body.report).not.toHaveProperty('profit');
  });

  it('cashier WITHOUT report:read is denied server-side (direct API too)', async () => {
    const today = todayStr();
    const r = await http('GET', `/api/v1/reports/daily?from=${today}&to=${today}`, { cookie: cashier });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  it('other tenant cannot see first tenant shifts or figures', async () => {
    const today = todayStr();
    // other tenant's cashier: no report:read at all → 403, figures never leak
    const r = await http('GET', `/api/v1/reports/daily?from=${today}&to=${today}`, { cookie: otherCashier });
    expect(r.status).toBe(403);
    // try to get first tenant shift — should be 404 (not found, not leaked)
    const g = await http('GET', `/api/v1/shifts/${shiftId}`, { cookie: otherCashier });
    expect(g.status).toBe(404);
  });
});
