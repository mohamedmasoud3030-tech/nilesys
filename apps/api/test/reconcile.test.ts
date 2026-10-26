/**
 * §6 — server-side financial reconciliation by idempotency key.
 * A client that lost a checkout/refund response must be able to learn the
 * server's truth: `saved` (with the document) or `not_found` (the same key
 * may be safely retried) — never another tenant's data, never a guess.
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
const SECRET = 'test-secret-reconcile-0123456789-abcde';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-reconcile-'));

let opened: OpenedDatabase;
let created: CreatedApp;
let mgr = '';
let cashier = '';
let otherMgr = '';
let variantId = '';
let price = 0;
let saleId = '';
let paymentId = '';

type Res = { status: number; body: any };
async function http(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const res = await created.app.getHttpAdapter().getInstance().inject({
    method: method as 'GET', url,
    headers: { origin: BASE, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, body };
}
async function login(email: string, password = 'demo1234'): Promise<string> {
  const res = await created.app.getHttpAdapter().getInstance().inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: BASE, 'content-type': 'application/json' },
    payload: JSON.stringify({ email, password }),
  });
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

beforeAll(async () => {
  opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  await provisionTenant(auth, opened.db, {
    slug: 'other-co', name: 'Other Co', password: 'other-pass-123',
    accounts: [{ role: 'branch-manager', email: 'manager@other.test' }], catalog: [],
  });
  created = await createApp({ db: opened.db, auth }, { logger: false });
  mgr = await login('pos-manager@nile.demo');
  cashier = await login('cashier@nile.demo');
  otherMgr = await login('manager@other.test', 'other-pass-123');
  const items = await http('GET', '/api/v1/catalog/items', { cookie: mgr });
  variantId = items.body.items[0].variants[0].id;
  price = items.body.items[0].priceMinor;
  const sale = await http('POST', '/api/v1/checkout', {
    cookie: cashier,
    body: { idempotencyKey: 'recon-checkout-0001', lines: [{ variantId, quantity: '2' }], tenders: [{ method: 'card', amountMinor: price * 2 }] },
  });
  expect(sale.status).toBe(201);
  saleId = sale.body.sale.id;
  const view = await http('GET', `/api/v1/sales/${saleId}`, { cookie: mgr });
  paymentId = view.body.sale.payments[0].id;
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('GET /api/v1/checkout/reconcile', () => {
  it('resolves a saved checkout with the full sale', async () => {
    const r = await http('GET', '/api/v1/checkout/reconcile?key=recon-checkout-0001', { cookie: mgr });
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('saved');
    expect(r.body.sale.id).toBe(saleId);
    expect(r.body.sale.totalMinor).toBe(price * 2);
  });
  it('unknown key is an explicit not_found (safe same-key retry)', async () => {
    const r = await http('GET', '/api/v1/checkout/reconcile?key=recon-never-sent-1', { cookie: cashier });
    expect(r.body).toEqual({ state: 'not_found' });
  });
  it('another tenant cannot resolve this key', async () => {
    const r = await http('GET', '/api/v1/checkout/reconcile?key=recon-checkout-0001', { cookie: otherMgr });
    expect(r.body).toEqual({ state: 'not_found' });
  });
  it('requires auth and a well-formed key', async () => {
    expect((await http('GET', '/api/v1/checkout/reconcile?key=recon-checkout-0001')).status).toBe(401);
    expect((await http('GET', '/api/v1/checkout/reconcile?key=short', { cookie: mgr })).status).toBe(400);
  });
});

describe('GET /api/v1/refunds/reconcile', () => {
  it('resolves a saved refund for managers; cashiers are forbidden', async () => {
    const refund = await http('POST', '/api/v1/refunds', {
      cookie: mgr,
      body: { idempotencyKey: 'recon-refund-0001', originalTransactionId: saleId, paymentId, items: [{ variantId, quantity: '1' }] },
    });
    expect(refund.status).toBe(201);
    const r = await http('GET', '/api/v1/refunds/reconcile?key=recon-refund-0001', { cookie: mgr });
    expect(r.body.state).toBe('saved');
    expect(r.body.refund.amountMinor).toBe(price);
    expect((await http('GET', '/api/v1/refunds/reconcile?key=recon-refund-0001', { cookie: cashier })).status).toBe(403);
    const nf = await http('GET', '/api/v1/refunds/reconcile?key=recon-refund-nope', { cookie: mgr });
    expect(nf.body).toEqual({ state: 'not_found' });
  });
});
