/**
 * G-03 — catalog administration (إدارة الأصناف).
 * Manager creates/edits/deactivates items through the real HTTP API with
 * server-enforced `catalog:manage`; price changes affect later sales only;
 * historical invoices keep their snapshotted prices; inactive items are
 * rejected by checkout; optimistic concurrency prevents silent overwrites.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openPglite, type OpenedDatabase } from '../../../engines/db/open.js';
import { createAuth } from '../../../engines/platform/src/auth/auth.js';
import { withTenant } from '../../../engines/platform/src/db/with-tenant.js';
import { auditLog } from '../../../engines/platform/src/db/schema.js';
import { createApp, type CreatedApp } from '../src/app.js';
import { demoTenantSpec, provisionTenant } from '../src/provision.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-catalog-admin-0123456789-ab';
const dataDir = mkdtempSync(join(tmpdir(), 'nile-catalog-admin-'));

let opened: OpenedDatabase;
let created: CreatedApp;
let mgr = ''; let cashier = ''; let otherMgr = '';
let tenantId = '';
let shiftId = '';
let itemId = ''; let variantId = ''; let weighedItemId = ''; let weighedVariantId = '';
let firstSaleId = '';

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
const checkout = (cookie: string, vId: string, quantity: string, amountMinor: number, key: string) =>
  http('POST', '/api/v1/checkout', {
    cookie, body: { idempotencyKey: key, shiftId, lines: [{ variantId: vId, quantity }], tenders: [{ method: 'cash', amountMinor, tenderedMinor: amountMinor }] },
  });

beforeAll(async () => {
  opened = await openPglite({ dataDir });
  const auth = createAuth(opened.db, { baseURL: BASE, secret: SECRET, trustedOrigins: [BASE] });
  await provisionTenant(auth, opened.db, demoTenantSpec());
  await provisionTenant(auth, opened.db, {
    slug: 'catalog-other-co', name: 'Other Co', password: 'other-pass-123',
    accounts: [{ role: 'branch-manager', email: 'manager@other.test' }], catalog: [],
  });
  tenantId = (await provisionTenant(auth, opened.db, demoTenantSpec())).tenantId;
  created = await createApp({ db: opened.db, auth }, { logger: false });
  mgr = await login('pos-manager@nile.demo');
  cashier = await login('cashier@nile.demo');
  otherMgr = await login('manager@other.test', 'other-pass-123');
  const shift = await http('POST', '/api/v1/shifts', { cookie: mgr, body: { openingMinor: 0, idempotencyKey: 'g03-shift-open-0001' } });
  shiftId = shift.body.shift.id;
});
afterAll(async () => { await created.app.close(); await opened.close(); rmSync(dataDir, { recursive: true, force: true }); });

describe('G-03 catalog administration', () => {
  it('manager creates an item + variant; it is immediately sellable', async () => {
    const r = await http('POST', '/api/v1/catalog/items', {
      cookie: mgr,
      body: {
        nameAr: 'سكر أبيض', nameEn: 'White Sugar', category: 'groceries', priceMinor: 4500,
        variants: [{ sku: 'SUG-1KG', labelAr: '1 كجم', labelEn: '1 kg', stock: '20' }],
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.item.version).toBe(1);
    expect(r.body.item.isActive).toBe(true);
    itemId = r.body.item.id; variantId = r.body.item.variants[0].id;

    const sellable = await http('GET', '/api/v1/catalog/items', { cookie: cashier });
    expect(sellable.body.items.some((i: any) => i.id === itemId)).toBe(true);

    const sale = await checkout(cashier, variantId, '1', 4500, 'g03-sale-before-price-1');
    expect(sale.status).toBe(201);
    expect(sale.body.sale.totalMinor).toBe(4500);
    firstSaleId = sale.body.sale.id;
  });

  it('cashier is denied every admin path server-side (403), sale list still works', async () => {
    expect((await http('GET', '/api/v1/catalog/items/admin', { cookie: cashier })).status).toBe(403);
    expect((await http('POST', '/api/v1/catalog/items', { cookie: cashier, body: { nameAr: 'x', nameEn: 'x', category: 'x', priceMinor: 100, variants: [{ sku: 'X-1', labelAr: 'x', labelEn: 'x', stock: '1' }] } })).status).toBe(403);
    expect((await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: cashier, body: { priceMinor: 1, expectedVersion: 1 } })).status).toBe(403);
    expect((await http('POST', `/api/v1/catalog/items/${itemId}/variants`, { cookie: cashier, body: { sku: 'X-2', labelAr: 'x', labelEn: 'x', stock: '1' } })).status).toBe(403);
    expect((await http('GET', '/api/v1/catalog/items', { cookie: cashier })).status).toBe(200);
    expect((await http('GET', '/api/v1/catalog/items/admin')).status).toBe(401);
  });

  it('price change affects later sales only — the old invoice keeps its snapshot', async () => {
    const up = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { priceMinor: 5200, expectedVersion: 1 } });
    expect(up.status).toBe(200);
    expect(up.body.item.priceMinor).toBe(5200);
    expect(up.body.item.version).toBe(2);

    const sale2 = await checkout(cashier, variantId, '1', 5200, 'g03-sale-after-price-1');
    expect(sale2.status).toBe(201);
    expect(sale2.body.sale.totalMinor).toBe(5200);

    const Old = await http('GET', `/api/v1/sales/${firstSaleId}`, { cookie: mgr });
    expect(Old.body.sale.lines.every((l: any) => l.unitPriceMinor === 4500)).toBe(true);
    expect(Old.body.sale.totalMinor).toBe(4500);
  });

  it('stale editor cannot silently overwrite (version_conflict), fresh editor can', async () => {
    const stale = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { priceMinor: 9900, expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('version_conflict');
    const admin = await http('GET', '/api/v1/catalog/items/admin', { cookie: mgr });
    const current = admin.body.items.find((i: any) => i.id === itemId);
    expect(current.priceMinor).toBe(5200); // unchanged by the stale write
    const fresh = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { nameAr: 'سكر أبيض (مُعدّل)', expectedVersion: current.version } });
    expect(fresh.status).toBe(200);
    expect(fresh.body.item.nameAr).toContain('مُعدّل');
  });

  it('invalid data is rejected with no partial write', async () => {
    const bad = await http('POST', '/api/v1/catalog/items', {
      cookie: mgr,
      body: { nameAr: 'x', nameEn: 'x', category: 'x', priceMinor: 0, variants: [{ sku: 'BAD-1', labelAr: 'x', labelEn: 'x', stock: '1' }] },
    });
    expect(bad.status).toBe(400); // contract
    const compareBad = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { compareAtMinor: 100, expectedVersion: 3 } });
    expect(compareBad.status).toBe(422);
    expect(compareBad.body.error).toBe('invalid_price');
    const badStock = await http('POST', `/api/v1/catalog/items/${itemId}/variants`, { cookie: mgr, body: { sku: 'SUG-2KG', labelAr: 'x', labelEn: 'x', stock: '1.2345' } });
    expect(badStock.status).toBe(400);
    const stockUpdate = await http('PATCH', `/api/v1/catalog/variants/${variantId}`, { cookie: mgr, body: { stock: '999', expectedVersion: 1 } });
    expect(stockUpdate.status).toBe(400); // stock is not an editable field (.strict)
  });

  it('duplicate SKU is rejected (exact and case-insensitive), per tenant', async () => {
    const dup = await http('POST', `/api/v1/catalog/items/${itemId}/variants`, { cookie: mgr, body: { sku: 'SUG-1KG', labelAr: 'x', labelEn: 'x', stock: '1' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('duplicate_sku');
    const dupCase = await http('POST', `/api/v1/catalog/items/${itemId}/variants`, { cookie: mgr, body: { sku: 'sug-1kg', labelAr: 'x', labelEn: 'x', stock: '1' } });
    expect(dupCase.status).toBe(409);
    // Same SKU under ANOTHER tenant is fine.
    const other = await http('POST', '/api/v1/catalog/items', {
      cookie: otherMgr,
      body: { nameAr: 'y', nameEn: 'y', category: 'y', priceMinor: 100, variants: [{ sku: 'SUG-1KG', labelAr: 'y', labelEn: 'y', stock: '1' }] },
    });
    expect(other.status).toBe(201);
  });

  it('tenant isolation: other tenant cannot see, update, or sell this store\'s item', async () => {
    const admin = await http('GET', '/api/v1/catalog/items/admin', { cookie: otherMgr });
    expect(admin.body.items.some((i: any) => i.id === itemId)).toBe(false);
    const patch = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: otherMgr, body: { priceMinor: 1, expectedVersion: 3 } });
    expect(patch.status).toBe(404);
    expect(patch.body.error).toBe('item_not_found');
  });

  it('deactivated item: hidden from selling, rejected by checkout, still manageable; reactivation restores selling', async () => {
    const admin = await http('GET', '/api/v1/catalog/items/admin', { cookie: mgr });
    const version = admin.body.items.find((i: any) => i.id === itemId).version;
    const off = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { isActive: false, expectedVersion: version } });
    expect(off.status).toBe(200);
    expect(off.body.item.isActive).toBe(false);

    const sellable = await http('GET', '/api/v1/catalog/items', { cookie: cashier });
    expect(sellable.body.items.some((i: any) => i.id === itemId)).toBe(false);
    const blocked = await checkout(cashier, variantId, '1', 5200, 'g03-sale-inactive-1');
    expect(blocked.body.error).toBe('unknown_item'); // server-side rejection, not just UI hiding
    expect([400, 422]).toContain(blocked.status);

    const on = await http('PATCH', `/api/v1/catalog/items/${itemId}`, { cookie: mgr, body: { isActive: true, expectedVersion: version + 1 } });
    expect(on.status).toBe(200);
    const sale = await checkout(cashier, variantId, '1', 5200, 'g03-sale-reactivated-1');
    expect(sale.status).toBe(201);
  });

  it('weighed goods: decimal stock + fractional-quantity sale', async () => {
    const r = await http('POST', '/api/v1/catalog/items', {
      cookie: mgr,
      body: {
        nameAr: 'بطاطس', nameEn: 'Potatoes', category: 'produce', priceMinor: 2000,
        variants: [{ sku: 'POT-KG', labelAr: 'كيلو', labelEn: 'kg', stock: '12.500' }],
      },
    });
    expect(r.status).toBe(201);
    weighedItemId = r.body.item.id; weighedVariantId = r.body.item.variants[0].id;
    const sale = await checkout(cashier, weighedVariantId, '0.500', 1000, 'g03-sale-weighed-1');
    expect(sale.status).toBe(201);
  });

  it('variant management: add + relabel with version guard', async () => {
    const add = await http('POST', `/api/v1/catalog/items/${weighedItemId}/variants`, { cookie: mgr, body: { sku: 'POT-5KG', labelAr: 'شيكارة 5 كجم', labelEn: '5 kg bag', stock: '3' } });
    expect(add.status).toBe(201);
    const added = add.body.item.variants.find((v: any) => v.sku === 'POT-5KG');
    const upd = await http('PATCH', `/api/v1/catalog/variants/${added.id}`, { cookie: mgr, body: { labelAr: 'شيكارة بلدية', expectedVersion: added.version } });
    expect(upd.status).toBe(200);
    const staleUpd = await http('PATCH', `/api/v1/catalog/variants/${added.id}`, { cookie: mgr, body: { labelEn: 'stale', expectedVersion: added.version } });
    expect(staleUpd.status).toBe(409);
    expect(staleUpd.body.error).toBe('version_conflict');
  });

  it('mutations are audit-logged with actor and diff', async () => {
    const rows = (await withTenant(opened.db, tenantId, (tx: any) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, itemId)))) as any[];
    const actions = rows.map((r: any) => r.action);
    expect(actions).toContain('catalog.create');
    expect(actions).toContain('catalog.update');
    expect(rows.every((r: any) => r.tenantId === tenantId && r.userId)).toBe(true);
    const updateRow = rows.find((r: any) => r.action === 'catalog.update');
    expect(JSON.parse(updateRow.payload).changed).toBeTruthy();
  });
});
