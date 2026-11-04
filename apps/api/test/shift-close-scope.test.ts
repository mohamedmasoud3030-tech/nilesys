/**
 * D-C (V1, adopted) — shift-close scope review.
 * The commercial V1 policy is DIRECT close: an authorized seller counts and
 * closes; the manager reviews the recorded difference daily. Accountability
 * requires: tenant isolation is absolute, openedBy and closedBy are BOTH
 * recorded permanently, and a saved closure can never be edited or
 * duplicated financially. Cross-user close INSIDE one tenant is the adopted
 * behavior (single shared drawer/register in V1 scope — it is what makes
 * second-device recovery work); restricting it needs a new product decision,
 * not a silent tightening.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { withTenant } from '../../../engines/platform/src/db/with-tenant.js';
import { cashShiftClosures, cashShifts } from '../../../engines/transactions/src/db/schema.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-shift-scope-0123456789-ab';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-shift-scope-'));

let opened: OpenedDatabase;
let created: CreatedApp;
let tenantId = '';
let shiftId = '';
let closureId = '';

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
  tenantId = (await provisionTenant(auth, opened.db, demoTenantSpec())).tenantId;
  await provisionTenant(auth, opened.db, {
    slug: 'scope-other', name: 'Other', password: 'other-pass-123',
    accounts: [{ role: 'branch-manager', email: 'manager@scope-other.test' }], catalog: [],
  });
  created = await createApp({ db: opened.db, auth }, { logger: false });
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('D-C V1 shift-close scope', () => {
  it('manager opens; a different user (cashier, same tenant) closes — both identities recorded', async () => {
    const mgr = await login('pos-manager@nile.demo');
    const open = await http('POST', '/api/v1/shifts', { cookie: mgr, body: { openingMinor: 5000, idempotencyKey: 'dc-scope-open-1' } });
    expect(open.status).toBe(201);
    shiftId = open.body.shift.id;

    const mgrMe = (await http('GET', '/api/v1/me', { cookie: mgr })).body;
    const cashier = await login('cashier@nile.demo');
    const cashMe = (await http('GET', '/api/v1/me', { cookie: cashier })).body;

    const close = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: cashier, body: { countedMinor: 4900, idempotencyKey: 'dc-scope-close-1' } });
    expect(close.status).toBe(201);
    closureId = close.body.closure.id;
    expect(close.body.closure.differenceMinor).toBe(-100);

    const rows = await withTenant(opened.db, tenantId, async (tx: any) => {
      const [s] = await tx.select().from(cashShifts).where(eq(cashShifts.id, shiftId));
      const [c] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.id, closureId));
      return { s, c };
    });
    expect((rows as any).s.openedBy).toBe(mgrMe.user.id);
    expect((rows as any).c.closedBy).toBe(cashMe.user.id);
    expect((rows as any).c.countedMinor).toBe(4900);
  });

  it('a saved closure is immutable: re-close with a new key or no key is rejected, value unchanged', async () => {
    const cashier = await login('cashier@nile.demo');
    const again = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: cashier, body: { countedMinor: 99999, idempotencyKey: 'dc-scope-close-2' } });
    expect(again.body.error).toBe('shift_already_closed');
    const noKey = await http('POST', `/api/v1/shifts/${shiftId}/close`, { cookie: cashier, body: { countedMinor: 99999 } });
    expect(noKey.body.error).toBe('shift_already_closed');
    const [c] = await withTenant(opened.db, tenantId, (tx: any) =>
      tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, shiftId))) as any[];
    expect(c.countedMinor).toBe(4900);
  });

  it('another tenant cannot close (or even see) this shift; unauthenticated is 401', async () => {
    const mgr = await login('pos-manager@nile.demo');
    const open = await http('POST', '/api/v1/shifts', { cookie: mgr, body: { openingMinor: 0, idempotencyKey: 'dc-scope-open-2' } });
    expect(open.status).toBe(201);
    const otherShift = open.body.shift.id;
    const foreign = await login('manager@scope-other.test', 'other-pass-123');
    const r = await http('POST', `/api/v1/shifts/${otherShift}/close`, { cookie: foreign, body: { countedMinor: 0, idempotencyKey: 'dc-scope-foreign-1' } });
    // Engine business errors map to 422; the boundary is the tenant filter: the
    // foreign actor gets the same shift_not_found as for a random id — no lease
    // of existence, and the shift stays open for its own tenant.
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('shift_not_found');
    const anon = await http('POST', `/api/v1/shifts/${otherShift}/close`, { body: { countedMinor: 0 } });
    expect(anon.status).toBe(401);
    // still open for its own tenant
    const cur = await http('GET', '/api/v1/shifts/current', { cookie: mgr });
    expect(cur.body.shift?.id).toBe(otherShift);
  });
});
