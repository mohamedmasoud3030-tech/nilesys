#!/usr/bin/env node
/**
 * Nile Systems prototype — regression tests for the defects fixed after the
 * engineering review (REVIEW.md): PERM-3, SALE-2, SALE-3, SALE-6, SHIFT-2, RESET-2.
 *
 * Self-contained: spawns its own `node server.js` on a random port with DB_FILE
 * pointing at a throwaway temp directory, so it never touches data/db.json.
 *
 *   node --test tests/regression.test.js
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nilesys-regression-'));
let server;

async function req(method, p, { body, cookie } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null };
}
const login = async (system, username) => {
  const r = await req('POST', '/api/login', { body: { system, username, password: 'demo1234' } });
  assert.equal(r.status, 200, `login ${system}/${username}`);
  return r.cookie;
};
const products = async (cookie) => (await req('GET', '/api/products', { cookie })).data.products;
const productById = async (cookie, id) => (await products(cookie)).find((x) => x.id === id);

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(TMP, 'db.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('Nile Systems')) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (server) server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ---------------- PERM-3: system isolation ---------------- */

test('PERM-3: HR employee cannot read POS products, create POS sales, or read POS reports', async () => {
  const hr = await login('hr', 'employee');
  const pos = await login('pos', 'manager');
  const p = (await products(pos))[0];
  const before = p.stock;

  assert.equal((await req('GET', '/api/products', { cookie: hr })).status, 403);
  assert.equal((await req('GET', '/api/reports/summary', { cookie: hr })).status, 403);
  assert.equal((await req('GET', '/api/sales', { cookie: hr })).status, 403);
  const sale = await req('POST', '/api/sales', { cookie: hr, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash' } });
  assert.equal(sale.status, 403);
  assert.equal((await productById(pos, p.id)).stock, before, 'blocked sale must not move stock');
});

test('PERM-3: a manager of another system is not a POS manager', async () => {
  const hrManager = await login('hr', 'manager');
  const pos = await login('pos', 'manager');
  const p = (await products(pos))[0];
  assert.equal((await req('PUT', '/api/products/' + p.id, { cookie: hrManager, body: { price: 1 } })).status, 403);
  assert.equal((await req('POST', '/api/reset', { cookie: hrManager })).status, 403);
  assert.equal((await req('PUT', '/api/branding', { cookie: hrManager, body: { storeName: 'x' } })).status, 403);
  assert.equal((await productById(pos, p.id)).price, p.price);
});

test('PERM-3: POS users keep access; non-POS users keep their generic bootstrap', async () => {
  const cashier = await login('pos', 'cashier');
  assert.equal((await req('GET', '/api/products', { cookie: cashier })).status, 200);
  const hr = await login('hr', 'employee');
  assert.equal((await req('GET', '/api/bootstrap', { cookie: hr })).status, 200);
});

/* ---------------- SALE-2: stock sufficiency ---------------- */

test('SALE-2: selling more than stock is rejected with 409 and stock is unchanged', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos))[0];
  const r = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: p.stock + 999 }], method: 'cash' } });
  assert.equal(r.status, 409);
  assert.equal((await productById(pos, p.id)).stock, p.stock);
});

test('SALE-2: repeated lines of the same product are aggregated before the stock check', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos)).find((x) => x.stock >= 4);
  const half = Math.ceil(p.stock / 2) + 1; // two lines whose sum exceeds stock
  const r = await req('POST', '/api/sales', {
    cookie: pos,
    body: { items: [{ productId: p.id, qty: half }, { productId: p.id, qty: half }], method: 'cash' },
  });
  assert.equal(r.status, 409);
  assert.equal((await productById(pos, p.id)).stock, p.stock);
});

test('SALE-2: selling exactly the remaining stock is allowed and leaves stock at 0', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos)).find((x) => x.stock > 0);
  const r = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: p.stock }], method: 'card' } });
  assert.equal(r.status, 201);
  assert.equal((await productById(pos, p.id)).stock, 0);
  const again = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'card' } });
  assert.equal(again.status, 409);
});

test('SALE-2: concurrent sales never oversell (sum of accepted qty == stock consumed)', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos)).find((x) => x.stock >= 8);
  const attempts = p.stock + 10;
  const rs = await Promise.all(Array.from({ length: attempts }, () =>
    req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'card' } })));
  const created = rs.filter((r) => r.status === 201).length;
  assert.equal(created, p.stock);
  assert.equal(rs.filter((r) => r.status === 409).length, attempts - p.stock);
  assert.equal((await productById(pos, p.id)).stock, 0);
});

/* ---------------- SALE-3: payment sufficiency ---------------- */

test('SALE-3: cash paid below total is rejected with 400 and stock is unchanged', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos)).find((x) => x.stock > 2 && x.price > 1);
  const r = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', paid: 1 } });
  assert.equal(r.status, 400);
  assert.equal((await productById(pos, p.id)).stock, p.stock);
});

test('SALE-3: cash paid >= total is stored; omitted paid defaults to total; card is always exact', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos)).find((x) => x.stock > 3);
  const over = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', paid: p.price + 50 } });
  assert.equal(over.status, 201);
  assert.equal(over.data.sale.paid, p.price + 50);
  const omitted = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash' } });
  assert.equal(omitted.data.sale.paid, omitted.data.sale.total);
  const card = await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 1 }], method: 'card', paid: 1 } });
  assert.equal(card.status, 201);
  assert.equal(card.data.sale.paid, card.data.sale.total);
});

/* ---------------- SALE-6: unique barcode ---------------- */

test('SALE-6: creating a product with an existing active barcode is rejected with 409', async () => {
  const pos = await login('pos', 'manager');
  const p = (await products(pos))[0];
  const r = await req('POST', '/api/products', { cookie: pos, body: { name: 'dup', price: 10, cost: 5, stock: 5, barcode: p.barcode } });
  assert.equal(r.status, 409);
  assert.equal((await products(pos)).filter((x) => x.barcode === p.barcode).length, 1);
});

test('SALE-6: unique barcodes are accepted; a deactivated product frees its barcode', async () => {
  const pos = await login('pos', 'manager');
  const a = await req('POST', '/api/products', { cookie: pos, body: { name: 'A', price: 10, stock: 1, barcode: '9990000000001' } });
  assert.equal(a.status, 201);
  assert.equal((await req('DELETE', '/api/products/' + a.data.product.id, { cookie: pos })).status, 200);
  const b = await req('POST', '/api/products', { cookie: pos, body: { name: 'B', price: 10, stock: 1, barcode: '9990000000001' } });
  assert.equal(b.status, 201);
});

/* ---------------- SHIFT-2: partial returns reduce expected cash ---------------- */

test('SHIFT-2: a partial cash return during the shift is deducted from expected cash', async () => {
  const pos = await login('pos', 'manager');
  assert.equal((await req('POST', '/api/shifts', { cookie: pos, body: { action: 'open', startingCash: 1000 } })).status, 201);
  const p = (await products(pos)).find((x) => x.stock > 4);
  const sale = (await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 2 }], method: 'cash' } })).data.sale;
  const ret = await req('POST', '/api/returns', { cookie: pos, body: { saleId: sale.id, items: [{ productId: p.id, qty: 1 }] } });
  assert.equal(ret.status, 201);
  assert.equal(ret.data.refund, p.price, 'no-discount refund stays price × qty');

  const live = (await req('GET', '/api/shifts', { cookie: pos })).data.openShift;
  assert.equal(live.expectedCashNow, 1000 + p.price, 'shift screen value matches server close value');

  const close = await req('POST', '/api/shifts', { cookie: pos, body: { action: 'close', countedCash: 1000 + p.price } });
  assert.equal(close.data.shift.expectedCash, 1000 + p.price);
  assert.equal(close.data.shift.diff, 0);
});

test('SHIFT-2: discounted sale returned in two steps nets to zero cash; card refunds do not touch the drawer', async () => {
  const pos = await login('pos', 'manager');
  await req('POST', '/api/shifts', { cookie: pos, body: { action: 'open', startingCash: 500 } });
  const p = (await products(pos)).find((x) => x.stock > 4 && x.price >= 10);
  const discount = 7;
  const sale = (await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: p.id, qty: 3 }], discount, method: 'cash' } })).data.sale;
  assert.equal(sale.total, p.price * 3 - discount);
  const r1 = await req('POST', '/api/returns', { cookie: pos, body: { saleId: sale.id, items: [{ productId: p.id, qty: 1 }] } });
  const r2 = await req('POST', '/api/returns', { cookie: pos, body: { saleId: sale.id, items: [{ productId: p.id, qty: 2 }] } });
  assert.equal(r2.data.sale.status, 'returned');
  assert.ok(Math.abs(r1.data.refund + r2.data.refund - sale.total) < 1e-9, 'total refunded == amount actually paid');
  assert.ok(r1.data.refund < p.price, 'discount is shared pro rata');

  const q = (await products(pos)).find((x) => x.stock > 2 && x.id !== p.id);
  const cardSale = (await req('POST', '/api/sales', { cookie: pos, body: { items: [{ productId: q.id, qty: 2 }], method: 'card' } })).data.sale;
  await req('POST', '/api/returns', { cookie: pos, body: { saleId: cardSale.id, items: [{ productId: q.id, qty: 1 }] } });

  const close = await req('POST', '/api/shifts', { cookie: pos, body: { action: 'close', countedCash: 500 } });
  assert.ok(Math.abs(close.data.shift.expectedCash - 500) < 1e-9, `expected 500, got ${close.data.shift.expectedCash}`);
});

/* ---------------- RESET-2: sessions survive a demo reset ---------------- */

test('RESET-2: the resetting manager and other users keep valid sessions after reset', async () => {
  const manager = await login('pos', 'manager');
  const cashier = await login('pos', 'cashier');
  const beforeMe = (await req('GET', '/api/session', { cookie: manager })).data.user;
  assert.equal((await req('POST', '/api/reset', { cookie: manager })).status, 200);
  const afterMe = (await req('GET', '/api/session', { cookie: manager })).data.user;
  assert.notEqual(afterMe, null);
  assert.equal(afterMe.id, beforeMe.id);
  assert.notEqual((await req('GET', '/api/session', { cookie: cashier })).data.user, null);
  assert.equal((await req('GET', '/api/products', { cookie: manager })).data.products.length, 26);
});

test('RESET-2: demo user ids are deterministic across resets', async () => {
  const manager = await login('pos', 'manager');
  const id1 = (await req('GET', '/api/session', { cookie: manager })).data.user.id;
  await req('POST', '/api/reset', { cookie: manager });
  await req('POST', '/api/reset', { cookie: manager });
  const fresh = await login('pos', 'manager');
  assert.equal((await req('GET', '/api/session', { cookie: fresh })).data.user.id, id1);
});

/* ---------------- SEED-1 (found while testing SHIFT-2) ---------------- */

test('SEED-1: seeded demo sales are never timestamped in the future', async () => {
  const manager = await login('pos', 'manager');
  await req('POST', '/api/reset', { cookie: manager });
  const sales = (await req('GET', '/api/sales?limit=300', { cookie: manager })).data.sales;
  assert.ok(sales.length > 30);
  const now = Date.now();
  assert.deepEqual(sales.filter((s) => Date.parse(s.createdAt) > now).map((s) => s.no), []);
});
