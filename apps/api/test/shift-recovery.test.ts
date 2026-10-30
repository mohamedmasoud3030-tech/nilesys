/**
 * G-02 — open-shift discovery across devices.
 * Acceptance scenario: manager opens a shift in one session ("device A");
 * a brand-new login ("device B") must discover that same open shift via
 * GET /api/v1/shifts/current and be able to take a cash sale against it —
 * with strict tenant isolation. Real HTTP, real Better Auth, real PGlite.
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
const SECRET = 'test-secret-shift-recovery-0123456789-ab';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-shift-recovery-'));

let opened: OpenedDatabase;
let created: CreatedApp;
let variantId = '';
let shiftId = '';

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
    accounts: [{ role: 'branch-manager', email: 'manager@other.test' }],
    catalog: [],
  });
  created = await createApp({ db: opened.db, auth }, { logger: false });
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('GET /api/v1/shifts/current', () => {
  it('requires authentication', async () => {
    const r = await http('GET', '/api/v1/shifts/current');
    expect(r.status).toBe(401);
  });

  it('is null before any shift opens', async () => {
    const mgr = await login('pos-manager@nile.demo');
    const r = await http('GET', '/api/v1/shifts/current', { cookie: mgr });
    expect(r.status).toBe(200);
    expect(r.body.shift).toBeNull();
  });

  it('device B discovers the shift device A opened, and sells cash against it', async () => {
    const deviceA = await login('pos-manager@nile.demo');
    const openedShift = await http('POST', '/api/v1/shifts', {
      cookie: deviceA,
      body: { openingMinor: 10000, idempotencyKey: 'g02-shift-open-0001' },
    });
    expect(openedShift.status).toBe(201);
    shiftId = openedShift.body.shift.id;

    // Fresh login = new device / cleared browser: no local state at all.
    const deviceB = await login('cashier@nile.demo');
    const cur = await http('GET', '/api/v1/shifts/current', { cookie: deviceB });
    expect(cur.status).toBe(200);
    expect(cur.body.shift?.id).toBe(shiftId);
    expect(cur.body.shift?.isClosed).toBe(false);
    expect(cur.body.shift?.expectedMinor).toBe(10000);

    const items = await http('GET', '/api/v1/catalog/items', { cookie: deviceB });
    variantId = items.body.items[0].variants[0].id;
    const price = items.body.items[0].priceMinor;
    const sale = await http('POST', '/api/v1/checkout', {
      cookie: deviceB,
      body: {
        idempotencyKey: 'g02-cash-sale-0001', shiftId,
        lines: [{ variantId, quantity: '1' }],
        tenders: [{ method: 'cash', amountMinor: price, tenderedMinor: price }],
      },
    });
    expect(sale.status).toBe(201);
  });

  it('a second open is rejected without losing the original shift', async () => {
    const mgr = await login('pos-manager@nile.demo');
    const dup = await http('POST', '/api/v1/shifts', {
      cookie: mgr, body: { openingMinor: 5000, idempotencyKey: 'g02-shift-open-0002' },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('shift_already_open');
    const cur = await http('GET', '/api/v1/shifts/current', { cookie: mgr });
    expect(cur.body.shift?.id).toBe(shiftId);
  });

  it('another tenant sees no shift (isolation), unknown register is null', async () => {
    const other = await login('manager@other.test', 'other-pass-123');
    const r = await http('GET', '/api/v1/shifts/current', { cookie: other });
    expect(r.status).toBe(200);
    expect(r.body.shift).toBeNull();
    const mgr = await login('pos-manager@nile.demo');
    const reg = await http('GET', '/api/v1/shifts/current?registerCode=drive-thru', { cookie: mgr });
    expect(reg.body.shift).toBeNull();
  });

  it('after close (from any device), current is null again', async () => {
    const deviceB = await login('cashier@nile.demo');
    const view = await http('GET', `/api/v1/shifts/${shiftId}`, { cookie: deviceB });
    const close = await http('POST', `/api/v1/shifts/${shiftId}/close`, {
      cookie: deviceB, body: { countedMinor: view.body.shift.expectedMinor },
    });
    expect(close.status).toBe(201);
    const cur = await http('GET', '/api/v1/shifts/current', { cookie: deviceB });
    expect(cur.body.shift).toBeNull();
  });
});
