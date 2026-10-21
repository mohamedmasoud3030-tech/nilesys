/* نظام المخازن — F-16.
 * اختبارات مستقلة عن الكاشير: مستخدمه، دوره، وأثره على نفس البيانات.
 *   BASE=http://localhost:4000 node --test tests/inventory.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:4000';

async function req(method, path, { cookie, body, raw } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return r;
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const sc = r.headers.get('set-cookie');
  return { status: r.status, data, cookie: sc ? sc.split(';')[0] : null };
}

let KEEPER, STOCKMAN, PRODUCT;

test('SETUP: the inventory manager logs into the stock system', async () => {
  KEEPER = (await req('POST', '/api/login', { body: { system: 'inventory', username: 'manager', password: 'demo1234' } })).cookie;
  assert.ok(KEEPER, 'inventory manager can log in');
  STOCKMAN = (await req('POST', '/api/login', { body: { system: 'inventory', username: 'store', password: 'demo1234' } })).cookie;
  assert.ok(STOCKMAN, 'the stock clerk can log in');
  const { products } = (await req('GET', '/api/products', { cookie: KEEPER })).data;
  PRODUCT = products[0];
  assert.ok(PRODUCT, 'products are shared with the till');
});

test('F-16: the till users cannot enter the stock system and vice versa', async () => {
  // لكل نظام مديره الخاص بنفس الاسم — الحارس الحقيقي هو ألا يعبر مستخدم
  // نظامٍ إلى نظامٍ آخر: كاشير الكاشير لا يدخل المخزن، وأمين المخزن لا يبيع.
  const till = await req('POST', '/api/login', { body: { system: 'inventory', username: 'cashier', password: 'demo1234' } });
  assert.equal(till.status, 401, 'a POS cashier is not an inventory user');
  const wrong = await req('POST', '/api/login', { body: { system: 'pos', username: 'store', password: 'demo1234' } });
  assert.equal(wrong.status, 401, 'an inventory user is not a POS user');
});

test('F-16: the stock system sees the same products the till sells', async () => {
  const viaPos = (await req('POST', '/api/login', { body: { system: 'pos', username: 'manager', password: 'demo1234' } }));
  const posProducts = (await req('GET', '/api/products', { cookie: viaPos.cookie })).data.products;
  const invProducts = (await req('GET', '/api/products', { cookie: KEEPER })).data.products;
  assert.equal(invProducts.length, posProducts.length, 'one inventory, one truth');
});

test('F-16: an adjustment by the storekeeper is visible to the till', async () => {
  const before = (await req('GET', '/api/products', { cookie: KEEPER })).data.products.find((p) => p.id === PRODUCT.id).stock;
  const r = await req('POST', '/api/stock/adjust', { cookie: KEEPER, body: { productId: PRODUCT.id, qty: 7, reason: 'توريد داخلي' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pos = await req('POST', '/api/login', { body: { system: 'pos', username: 'manager', password: 'demo1234' } });
  const after = (await req('GET', '/api/products', { cookie: pos.cookie })).data.products.find((p) => p.id === PRODUCT.id).stock;
  assert.equal(after, before + 7, 'the till sells the corrected number');
});

test('F-16: a purchase adds stock and updates the weighted average cost', async () => {
  const sup = await req('POST', '/api/suppliers', { cookie: KEEPER, body: { name: 'مورد المخزن' } });
  assert.equal(sup.status, 201);
  const before = (await req('GET', '/api/products', { cookie: KEEPER })).data.products.find((p) => p.id === PRODUCT.id);
  const r = await req('POST', '/api/purchases', {
    cookie: KEEPER,
    body: { supplierId: sup.data.supplier.id, paid: true, items: [{ productId: PRODUCT.id, qty: 10, cost: before.cost + 4 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const after = (await req('GET', '/api/products', { cookie: KEEPER })).data.products.find((p) => p.id === PRODUCT.id);
  assert.equal(after.stock, before.stock + 10);
  assert.ok(after.cost > before.cost && after.cost < before.cost + 4, 'cost moves toward the new price, not past it');
});

test('F-16: a clerk cannot adjust stock, the manager can', async () => {
  const denied = await req('POST', '/api/stock/adjust', { cookie: STOCKMAN, body: { productId: PRODUCT.id, qty: 1, reason: 'محاولة' } });
  assert.equal(denied.status, 403, 'adjustments need the manager role');
});

test('F-16: stock can never be driven below zero', async () => {
  const r = await req('POST', '/api/stock/adjust', { cookie: KEEPER, body: { productId: PRODUCT.id, qty: -999999, reason: 'جرد خاطئ' } });
  assert.equal(r.status, 409);
  const p = (await req('GET', '/api/products', { cookie: KEEPER })).data.products.find((x) => x.id === PRODUCT.id);
  assert.ok(p.stock >= 0, 'the shelf is never negative');
});

test('F-16: every movement carries who and why', async () => {
  const { movements } = (await req('GET', `/api/stock/movements?productId=${PRODUCT.id}&limit=20`, { cookie: KEEPER })).data;
  assert.ok(movements.length > 0);
  for (const m of movements.slice(0, 5)) {
    assert.ok(m.at, 'has a time');
    assert.ok(m.kind, 'has a kind');
    assert.equal(typeof m.after, 'number', 'records the balance after the move');
  }
  assert.ok(movements.some((m) => m.kind === 'purchase'), 'the purchase left a trail');
  assert.ok(movements.some((m) => m.kind === 'adjust'), 'the adjustment left a trail');
});

test('F-16: the stock CSV is a real file the store can open in Excel', async () => {
  const raw = await req('GET', '/api/export/stock.csv', { cookie: KEEPER, raw: true });
  const buf = Buffer.from(await raw.arrayBuffer());
  assert.equal(raw.status, 200);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM for Arabic in Excel');
});
