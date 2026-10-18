/**
 * FIRST END-TO-END OPERATIONAL PATH — login → permissions → tenant → sale saved.
 * Real HTTP (Fastify inject through NestJS), real Better Auth, real
 * PostgreSQL (PGlite on disk), runtime role `nile_app`. Ends by RESTARTING the
 * server on the same data directory and reading the sale back.
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
const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-e2e-'));

interface Running { opened: OpenedDatabase; created: CreatedApp }
let run: Running;

async function boot(): Promise<Running> {
  const opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  await provisionTenant(auth, opened.db, {
    slug: 'other-co', name: 'Other Co', password: 'other-pass-123',
    accounts: [{ role: 'cashier', email: 'cashier@other.test' }],
    catalog: [{ nameAr: 'صنف آخر', nameEn: 'Other item', category: 'x', priceMinor: 500, variants: [{ sku: 'OTH-1', labelAr: 'افتراضي', labelEn: 'Default', stock: '10' }] }],
  });
  const created = await createApp({ db: opened.db, auth }, { logger: false });
  return { opened, created };
}
async function shutdown(r: Running) {
  await r.created.app.close();
  await r.opened.close();
}

type Res = { status: number; body: any; headers: Record<string, unknown> };
async function http(method: string, url: string, opts: { cookie?: string; body?: unknown } = {}): Promise<Res> {
  const res = await run.created.app.getHttpAdapter().getInstance().inject({
    method: method as 'GET',
    url,
    headers: { origin: BASE, ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: unknown = res.body;
  try { body = JSON.parse(res.body); } catch { /* not json */ }
  return { status: res.statusCode, body, headers: res.headers };
}
async function login(email: string, password = 'demo1234') {
  const res = await http('POST', '/api/auth/sign-in/email', { body: { email, password } });
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return { status: res.status, cookie: list.map((c) => String(c).split(';')[0]).join('; ') };
}

let cashier: string;
let catalog: any[];
const variant = (sku: string) => catalog.flatMap((i: any) => i.variants).find((v: any) => v.sku === sku);
let saleId: string;

beforeAll(async () => { run = await boot(); });
afterAll(async () => { await shutdown(run); rmSync(dataDir, { recursive: true, force: true }); });

describe('1. authentication', () => {
  it('rejects a wrong password', async () => {
    expect((await login('cashier@nile.demo', 'wrong-password')).status).toBe(401);
  });
  it('public self-registration is disabled', async () => {
    const r = await http('POST', '/api/auth/sign-up/email', { body: { email: 'x@y.test', password: 'whatever123', name: 'x' } });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it('anonymous requests are refused', async () => {
    expect((await http('GET', '/api/v1/me')).status).toBe(401);
    expect((await http('POST', '/api/v1/sales', { body: { idempotencyKey: 'anon-0001', lines: [] } })).status).toBe(401);
  });
  it('demo cashier logs in with demo1234 and gets an HttpOnly session cookie', async () => {
    const res = await http('POST', '/api/auth/sign-in/email', { body: { email: 'cashier@nile.demo', password: 'demo1234' } });
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    cashier = (await login('cashier@nile.demo')).cookie;
    expect(cashier).toContain('session_token');
  });
});

describe('2. tenant + role resolved on the server', () => {
  it('/me shows the demo tenant, the cashier role and its permissions', async () => {
    const r = await http('GET', '/api/v1/me', { cookie: cashier });
    expect(r.status).toBe(200);
    expect(r.body.tenant.slug).toBe('nile-demo');
    expect(r.body.role).toBe('cashier');
    expect(r.body.permissions).toContain('sale:create');
    expect(r.body.permissions).not.toContain('sale:void');
  });
  it('catalog lists only this tenant\'s items, in Arabic and English, with stock state', async () => {
    const r = await http('GET', '/api/v1/catalog/items', { cookie: cashier });
    expect(r.status).toBe(200);
    catalog = r.body.items;
    expect(catalog.length).toBe(6);
    expect(catalog.some((i: any) => i.nameEn === 'Other item')).toBe(false);
    expect(variant('WTR-600')).toMatchObject({ stock: '120.000', stockState: 'in' });
    expect(variant('CHIPS-L')).toMatchObject({ stockState: 'low' });
  });
});

describe('3. the sale', () => {
  it('records a sale: server prices from catalog, rounds per line, saves everything', async () => {
    const r = await http('POST', '/api/v1/sales', {
      cookie: cashier,
      body: {
        idempotencyKey: 'pos-demo-0001',
        lines: [
          { variantId: variant('WTR-600').id, quantity: '3' },
          { variantId: variant('OIL-1L').id, quantity: '1' },
          { variantId: variant('CHS-ROUMY').id, quantity: '0.333' },
        ],
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.replayed).toBe(false);
    const s = r.body.sale;
    saleId = s.id;
    // 3 × 7.50 = 22.50 ; 1 × 89.95 = 89.95 ; 0.333 kg × 320.00 = 106.56 → 219.01 EGP
    expect(s.totalMinor).toBe(2250 + 8995 + 10656);
    expect(s.lines).toHaveLength(3);
    expect(s.lines.find((l: any) => l.nameAr.startsWith('زيت'))).toMatchObject({ unitPriceMinor: 8995, lineTotalMinor: 8995 });
  });

  it('the saved sale can be read back (receipt data)', async () => {
    const r = await http('GET', `/api/v1/sales/${saleId}`, { cookie: cashier });
    expect(r.status).toBe(200);
    expect(r.body.sale.totalMinor).toBe(21901);
  });

  it('stock was decremented exactly once', async () => {
    catalog = (await http('GET', '/api/v1/catalog/items', { cookie: cashier })).body.items;
    expect(variant('WTR-600').stock).toBe('117.000');
    expect(variant('OIL-1L').stock).toBe('2.000');
    expect(variant('CHS-ROUMY').stock).toBe('12.167');
  });

  it('retrying the same request (network glitch) does NOT create a second sale', async () => {
    const body = {
      idempotencyKey: 'pos-demo-0001',
      lines: [
        { variantId: variant('WTR-600').id, quantity: '3' },
        { variantId: variant('OIL-1L').id, quantity: '1' },
        { variantId: variant('CHS-ROUMY').id, quantity: '0.333' },
      ],
    };
    const r = await http('POST', '/api/v1/sales', { cookie: cashier, body });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ replayed: true, sale: { id: saleId } });
    catalog = (await http('GET', '/api/v1/catalog/items', { cookie: cashier })).body.items;
    expect(variant('WTR-600').stock).toBe('117.000');
  });

  it('reusing a key for a DIFFERENT cart is rejected (409)', async () => {
    const r = await http('POST', '/api/v1/sales', { cookie: cashier, body: { idempotencyKey: 'pos-demo-0001', lines: [{ variantId: variant('WTR-600').id, quantity: '1' }] } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('idempotency_conflict');
  });

  it('cannot sell more than in stock — and nothing is half-saved', async () => {
    const r = await http('POST', '/api/v1/sales', {
      cookie: cashier,
      body: { idempotencyKey: 'pos-demo-0002', lines: [{ variantId: variant('WTR-600').id, quantity: '1' }, { variantId: variant('OIL-1L').id, quantity: '5' }] },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('insufficient_stock');
    catalog = (await http('GET', '/api/v1/catalog/items', { cookie: cashier })).body.items;
    expect(variant('WTR-600').stock).toBe('117.000'); // the water line was rolled back too
  });

  it('client cannot set prices, totals or tenant (400)', async () => {
    const r = await http('POST', '/api/v1/sales', {
      cookie: cashier,
      body: { idempotencyKey: 'pos-demo-0003', tenantId: '00000000-0000-4000-8000-000000000000', lines: [{ variantId: variant('WTR-600').id, quantity: '1', unitPriceMinor: 1 }] },
    });
    expect(r.status).toBe(400);
  });
});

describe('4. permissions', () => {
  it('storekeeper can read the catalog but cannot sell (403)', async () => {
    const sk = (await login('storekeeper@nile.demo')).cookie;
    expect((await http('GET', '/api/v1/catalog/items', { cookie: sk })).status).toBe(200);
    const r = await http('POST', '/api/v1/sales', { cookie: sk, body: { idempotencyKey: 'sk-0001', lines: [{ variantId: variant('WTR-600').id, quantity: '1' }] } });
    expect(r.status).toBe(403);
  });
  it('HR employee cannot even read sales (403)', async () => {
    const emp = (await login('employee@nile.demo')).cookie;
    expect((await http('GET', `/api/v1/sales/${saleId}`, { cookie: emp })).status).toBe(403);
  });
});

describe('5. company isolation over HTTP', () => {
  let other: string;
  beforeAll(async () => { other = (await login('cashier@other.test', 'other-pass-123')).cookie; });

  it('another company\'s cashier sees their own catalog only', async () => {
    const r = await http('GET', '/api/v1/catalog/items', { cookie: other });
    expect(r.body.items.map((i: any) => i.nameEn)).toEqual(['Other item']);
  });
  it('…cannot open the demo company\'s sale (404, not 403 — existence is not leaked)', async () => {
    expect((await http('GET', `/api/v1/sales/${saleId}`, { cookie: other })).status).toBe(404);
  });
  it('…cannot sell the demo company\'s products (422 unknown item)', async () => {
    const r = await http('POST', '/api/v1/sales', { cookie: other, body: { idempotencyKey: 'other-0001', lines: [{ variantId: variant('WTR-600').id, quantity: '1' }] } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('unknown_item');
  });
  it('…cannot switch company by sending a tenant id in headers or query (server ignores it)', async () => {
    const demoTenantId = (await http('GET', '/api/v1/me', { cookie: cashier })).body.tenant.id;
    const inject = run.created.app.getHttpAdapter().getInstance().inject;
    for (const url of [`/api/v1/sales/${saleId}`, `/api/v1/sales/${saleId}?tenantId=${demoTenantId}`]) {
      const res = await inject({
        method: 'GET', url,
        headers: { cookie: other, origin: BASE, 'x-tenant-id': demoTenantId, 'x-organization-id': demoTenantId },
      });
      expect(res.statusCode).toBe(404);
    }
    const items = await inject({ method: 'GET', url: '/api/v1/catalog/items', headers: { cookie: other, 'x-tenant-id': demoTenantId } });
    expect(JSON.parse(items.body).items.map((i: any) => i.nameEn)).toEqual(['Other item']);
  });
  it('…and can reuse the same idempotency key without colliding with the demo company', async () => {
    const own = (await http('GET', '/api/v1/catalog/items', { cookie: other })).body.items[0].variants[0].id;
    const r = await http('POST', '/api/v1/sales', { cookie: other, body: { idempotencyKey: 'pos-demo-0001', lines: [{ variantId: own, quantity: '2' }] } });
    expect(r.status).toBe(201);
    expect(r.body.sale.totalMinor).toBe(1000);
  });
});

describe('6. contract + session lifecycle', () => {
  it('OpenAPI contract documents the sale endpoint with its strict schema', async () => {
    const r = await http('GET', '/api/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.paths['/api/v1/sales'].post).toBeDefined();
    expect(JSON.stringify(r.body.paths['/api/v1/sales'].post)).toContain('idempotencyKey');
  });
  it('sign-out revokes the session server-side', async () => {
    const c = (await login('cashier@nile.demo')).cookie;
    expect((await http('GET', '/api/v1/me', { cookie: c })).status).toBe(200);
    expect((await http('POST', '/api/auth/sign-out', { cookie: c, body: {} })).status).toBe(200);
    expect((await http('GET', '/api/v1/me', { cookie: c })).status).toBe(401);
  });
});

describe('6b. shared demo logins cannot be hijacked by one visitor', () => {
  // The demo password is public: every visitor shares these logins, so one
  // visitor must not be able to lock out or deface them for everyone else.
  const attempts: Array<[string, unknown]> = [
    ['/api/auth/change-password', { currentPassword: 'demo1234', newPassword: 'locked-out-123', revokeOtherSessions: true }],
    ['/api/auth/update-user', { name: 'defaced' }],
    ['/api/auth/revoke-sessions', {}],
    ['/api/auth/revoke-other-sessions', {}],
    ['/api/auth/organization/leave', {}],
  ];

  it('account-mutating endpoints are refused for a shared demo login (403) and nothing changes', async () => {
    const otherVisitor = (await login('waiter@nile.demo')).cookie;
    const visitor = (await login('waiter@nile.demo')).cookie;
    const me = (await http('GET', '/api/v1/me', { cookie: visitor })).body;
    for (const [url, body] of attempts) {
      const res = await http('POST', url, { cookie: visitor, body: url.endsWith('/leave') ? { organizationId: me.tenant.id } : body });
      expect([url, res.status, res.body?.code]).toEqual([url, 403, 'SHARED_DEMO_ACCOUNT_LOCKED']);
    }
    const otherMe = await http('GET', '/api/v1/me', { cookie: otherVisitor });
    expect(otherMe.status).toBe(200); // the other visitor was not kicked out
    expect(otherMe.body.user.name).toBe(me.user.name); // not defaced
    expect(otherMe.body.role).toBe('waiter'); // membership intact
    expect((await login('waiter@nile.demo', 'demo1234')).status).toBe(200); // password unchanged
  });

  it('a real (non-demo) tenant user can still change their own password', async () => {
    const own = (await login('cashier@other.test', 'other-pass-123')).cookie;
    const change = (from: string, to: string) =>
      http('POST', '/api/auth/change-password', { cookie: own, body: { currentPassword: from, newPassword: to } });
    expect((await change('other-pass-123', 'other-pass-456')).status).toBe(200);
    expect((await login('cashier@other.test', 'other-pass-456')).status).toBe(200);
    expect((await change('other-pass-456', 'other-pass-123')).status).toBe(200); // restore for later suites
  });
});

describe('7. the sale survives a server restart', () => {
  it('restart on the same data directory → log in again → the sale is still there', async () => {
    await shutdown(run);
    run = await boot(); // provisioning is idempotent: demo data is NOT re-created
    const c = (await login('cashier@nile.demo')).cookie;
    const r = await http('GET', `/api/v1/sales/${saleId}`, { cookie: c });
    expect(r.status).toBe(200);
    expect(r.body.sale.totalMinor).toBe(21901);
    catalog = (await http('GET', '/api/v1/catalog/items', { cookie: c })).body.items;
    expect(variant('WTR-600').stock).toBe('117.000');
  });
});
