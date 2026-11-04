/**
 * G-17 — shift close idempotency over HTTP.
 * Same key + same counted replays the saved closure (one DB row, one drawer
 * result); same key with a different payload conflicts; closing without a
 * key keeps working (backward compatibility); concurrent closes with the
 * same key converge on exactly one closure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { withTenant } from '../../../engines/platform/src/db/with-tenant.js';
import { cashShiftClosures } from '../../../engines/transactions/src/db/schema.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-shift-close-idem-0123456789';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-close-idem-'));

let opened: OpenedDatabase;
let created: CreatedApp;
let mgr = '';
let tenantId = '';

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
async function login(): Promise<string> {
  const res = await created.app.getHttpAdapter().getInstance().inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: BASE, 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'pos-manager@nile.demo', password: 'demo1234' }),
  });
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}
let n = 0;
async function openShift(): Promise<string> {
  n += 1;
  const r = await http('POST', '/api/v1/shifts', { cookie: mgr, body: { openingMinor: 10000, idempotencyKey: `g17-open-${n}-xxxxxxxx` } });
  expect(r.status).toBe(201);
  return r.body.shift.id;
}
async function closureRows(): Promise<number> {
  // RLS: the runtime role only sees rows inside a tenant context.
  return withTenant(opened.db as never, tenantId, async (tx: any) => {
    const rows = await tx.select({ id: cashShiftClosures.id }).from(cashShiftClosures);
    return rows.length as number;
  });
}

beforeAll(async () => {
  opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  created = await createApp({ db: opened.db, auth }, { logger: false });
  mgr = await login();
  const me = await http('GET', '/api/v1/me', { cookie: mgr });
  tenantId = me.body.tenant.id;
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('close with idempotency key (G-17)', () => {
  it('same key + same counted replays the same closure; exactly one row', async () => {
    const shiftId = await openShift();
    const before = await closureRows();
    const first = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-key-0001' } });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    const retry = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-key-0001' } });
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.closure.id).toBe(first.body.closure.id);
    expect(retry.body.closure.differenceMinor).toBe(0);
    expect(await closureRows()).toBe(before + 1);
  });

  it('same key reused for a different close conflicts', async () => {
    const shiftId = await openShift();
    const r = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-key-0001' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('idempotency_conflict');
    // the shift is still open and closable with a fresh key
    const ok = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 9900, idempotencyKey: 'g17-close-key-0002' } });
    expect(ok.status).toBe(201);
    expect(ok.body.closure.differenceMinor).toBe(-100);
  });

  it('a different key after close still reports shift_already_closed', async () => {
    const shiftId = await openShift();
    const first = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-key-0003' } });
    expect(first.status).toBe(201);
    const again = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-key-9999' } });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('shift_already_closed');
  });

  it('closing without a key still works (backward compatibility)', async () => {
    const shiftId = await openShift();
    const r = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000 } });
    expect(r.status).toBe(201);
    expect(r.body.closure.differenceMinor).toBe(0);
  });

  it('two concurrent closes with the same key converge on one closure', async () => {
    const shiftId = await openShift();
    const before = await closureRows();
    const [a, b] = await Promise.all([
      http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-race-01' } }),
      http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-race-01' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.closure.id).toBe(b.body.closure.id);
    expect(await closureRows()).toBe(before + 1);
  });

  it('a too-short key is rejected by contract validation', async () => {
    const shiftId = await openShift();
    const r = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'short' } });
    expect(r.status).toBe(400);
    const ok = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: mgr, body: { countedMinor: 10000, idempotencyKey: 'g17-close-final-01' } });
    expect(ok.status).toBe(201);
  });
});
