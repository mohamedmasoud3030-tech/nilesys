#!/usr/bin/env node
/**
 * Nile Systems — اختبارات ترقية الكاشير (المرحلة 2)
 *
 * تُشغَّل ضد سيرفر حي (نسخة معزولة، مش الديمو العام):
 *   BASE=http://localhost:3210 DB_FILE=/tmp/x.json node --test tests/pos-upgrade.test.js
 *
 * كل اختبار هنا يقابل بنداً في docs/plan/001 و proposal 0007:
 *   TENDER-1  أربع طرق دفع، والباقي من الكاش فقط
 *   IDEM-1    مفتاح تكرار: نفس الطلب → نفس الفاتورة، نفس المفتاح بجسم مختلف → 409
 *   PERM-4    خصم الكاشير محدود، والمدير بلا حد
 *   HELD-1    سلة معلّقة تُحفظ وتُسترجع وتُستهلك
 *   MONEY-1   صافي = الإجمالي − المرتجعات (D-E / ADR-0014)
 *   AUDIT-1   كل عملية حساسة تُكتب في سجل لا يُعدَّل
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:3210';

async function req(method, path, { body, cookie, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function login(username) {
  const r = await req('POST', '/api/login', { body: { system: 'pos', username, password: 'demo1234' } });
  assert.equal(r.status, 200, `login ${username}`);
  return r.cookie;
}

const money = (n) => Math.round(n * 100) / 100;

test('SETUP: reset demo data and open a shift', async () => {
  const mgr = await login('manager');
  await req('POST', '/api/reset', { cookie: mgr });
  const shift = await req('POST', '/api/shifts', { cookie: mgr, body: { action: 'open', startingCash: 100 } });
  assert.equal(shift.status, 201);
});

test('TENDER-1: wallet and transfer are stored as-is, with no change', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;

  for (const method of ['wallet', 'transfer']) {
    const r = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 1 }], method } });
    assert.equal(r.status, 201, method);
    assert.equal(r.data.sale.method, method);
    assert.equal(r.data.sale.change, 0, `${method} never produces change`);
    assert.equal(r.data.sale.paid, r.data.sale.total, `${method} is exact`);
  }
});

test('TENDER-1: cash over-payment is stored with the exact change', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;
  const r = await req('POST', '/api/sales', {
    cookie: cashier,
    body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', paid: p.price + 37.5 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.sale.change, money(37.5));
  assert.equal(r.data.sale.paid, money(p.price + 37.5));
});

test('IDEM-1: same key + same body replays the sale and does not touch stock twice', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;
  const key = 'up-idem-0001';
  const body = { items: [{ productId: p.id, qty: 2 }], method: 'cash', idempotencyKey: key };

  const first = await req('POST', '/api/sales', { cookie: cashier, body });
  const second = await req('POST', '/api/sales', { cookie: cashier, body });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200, 'a replay is 200, not a second 201');
  assert.equal(second.data.replay, true);
  assert.equal(second.data.sale.id, first.data.sale.id, 'same invoice, not a new one');

  const after = (await req('GET', '/api/products', { cookie: cashier })).data.products.find((x) => x.id === p.id);
  assert.equal(after.stock, p.stock - 2, 'stock was decremented exactly once');
});

test('IDEM-1: same key with a different body is rejected with 409', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;
  const key = 'up-idem-0002';
  const a = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', idempotencyKey: key } });
  assert.equal(a.status, 201);
  const b = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 3 }], method: 'cash', idempotencyKey: key } });
  assert.equal(b.status, 409);
});

test('PERM-4: a cashier cannot give more than 10% discount, a manager can', async () => {
  const cashier = await login('cashier');
  const manager = await login('manager');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;
  const subtotal = p.price;
  const big = money(subtotal * 0.5);

  const denied = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', discount: big } });
  assert.equal(denied.status, 403);

  const allowed = await req('POST', '/api/sales', { cookie: manager, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', discount: big } });
  assert.equal(allowed.status, 201);

  const small = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', discount: money(subtotal * 0.05) } });
  assert.equal(small.status, 201, 'a small discount stays allowed for the cashier');
});

test('HELD-1: a cart is held, listed, and consumed by the sale that finishes it', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;

  const held = await req('POST', '/api/held', { cookie: cashier, body: { items: [{ productId: p.id, qty: 2 }], label: 'عميل بيجرّب' } });
  assert.equal(held.status, 201);
  const id = held.data.held.id;

  const list = await req('GET', '/api/held', { cookie: cashier });
  assert.ok(list.data.held.some((h) => h.id === id));

  const sale = await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 2 }], method: 'cash', heldId: id } });
  assert.equal(sale.status, 201);

  const after = await req('GET', '/api/held', { cookie: cashier });
  assert.equal(after.data.held.some((h) => h.id === id), false, 'the held cart is gone once it is paid');
});

test('HELD-1: releasing a held cart removes it without a sale', async () => {
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;
  const held = await req('POST', '/api/held', { cookie: cashier, body: { items: [{ productId: p.id, qty: 1 }] } });
  const del = await req('DELETE', `/api/held/${held.data.held.id}`, { cookie: cashier });
  assert.equal(del.status, 200);
  const again = await req('DELETE', `/api/held/${held.data.held.id}`, { cookie: cashier });
  assert.equal(again.status, 404, 'deleting twice is a clean 404');
});

test('MONEY-1: net = gross − refunds, and refunds are their own line (D-E)', async () => {
  const manager = await login('manager');
  const cashier = await login('cashier');
  const [p] = (await req('GET', '/api/products', { cookie: cashier })).data.products;

  const before = (await req('GET', '/api/reports/summary?range=today', { cookie: manager })).data;

  const sale = (await req('POST', '/api/sales', { cookie: cashier, body: { items: [{ productId: p.id, qty: 4 }], method: 'cash' } })).data.sale;
  const refund = await req('POST', '/api/returns', { cookie: manager, body: { saleId: sale.id, items: [{ productId: p.id, qty: 1 }] } });
  assert.equal(refund.status, 201);

  const after = (await req('GET', '/api/reports/summary?range=today', { cookie: manager })).data;

  assert.equal(money(after.grossTotal - before.grossTotal), money(sale.total), 'gross grows by the whole sale');
  assert.equal(money(after.refundsTotal - before.refundsTotal), money(refund.data.refund), 'the refund is its own line');
  assert.equal(money(after.net - before.net), money(sale.total - refund.data.refund), 'net is what was actually collected');
  assert.ok(Math.abs(after.net - (after.grossTotal - after.refundsTotal)) < 0.005, 'net identity holds');
  assert.ok('wallet' in after.byMethod && 'transfer' in after.byMethod, 'all four tenders are reported even when unused');
});

test('AUDIT-1: sensitive actions are recorded, and only a manager can read the log', async () => {
  const manager = await login('manager');
  const cashier = await login('cashier');
  const denied = await req('GET', '/api/audit', { cookie: cashier });
  assert.equal(denied.status, 403);

  const log = await req('GET', '/api/audit?limit=100', { cookie: manager });
  assert.equal(log.status, 200);
  const actions = log.data.audit.map((a) => a.action);
  for (const expected of ['sale.created', 'sale.refunded', 'shift.opened', 'cart.held']) {
    assert.ok(actions.includes(expected), `audit contains ${expected}`);
  }
  assert.ok(log.data.audit.every((a) => a.at && a.action), 'every entry is dated and named');
});
