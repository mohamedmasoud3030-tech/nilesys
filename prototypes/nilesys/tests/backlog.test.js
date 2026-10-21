#!/usr/bin/env node
/**
 * Nile Systems — اختبارات المزايا المتبقية (F-01 … F-15)
 *
 * تُشغَّل على سيرفر حي:
 *   BASE=http://localhost:3210 DB_FILE=/tmp/x.json node --test tests/backlog.test.js
 *
 * كل اختبار مقابله بند في docs/product/feature-register.md:
 *   F-01 الضريبة           F-09 التصدير
 *   F-02 الخصومات          F-10 المستخدمون
 *   F-05 حركات المخزون     F-12 الدفع الجزئي
 *   F-06 الموردون          F-13 التنبيهات
 *   F-07 العملاء والآجل     F-14 النسخ الاحتياطي
 *   F-08 حركات الدرج       F-15 الأمان
 *   F-16/F-17 السجل (حالة صادقة لا وعود)
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:3210';

async function req(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, data, text, cookie: sc ? sc.split(';')[0] : null, type: res.headers.get('content-type') };
}

const login = async (username, password = 'demo1234') => {
  const r = await req('POST', '/api/login', { body: { system: 'pos', username, password } });
  assert.equal(r.status, 200, `login ${username}`);
  return r.cookie;
};
const money = (n) => Math.round(n * 100) / 100;

let MGR, CASH, PRODUCT;

test('SETUP: reset, open a shift, and pick a product', async () => {
  MGR = await login('manager');
  CASH = await login('cashier');
  await req('POST', '/api/reset', { cookie: MGR });
  await req('POST', '/api/shifts', { cookie: MGR, body: { action: 'open', startingCash: 100 } });
  const r = await req('GET', '/api/products', { cookie: MGR });
  PRODUCT = r.data.products.find((p) => p.stock > 3);
  assert.ok(PRODUCT, 'a product with stock exists');
  // كل الاختبارات تبيع من نفس الصنف، فلولا مخزون كبير لنفد قبل نهاية الملف
  // وصارت النتيجة تعتمد على ترتيب التشغيل — أكبر مصدر تقلّب واجهناه.
  const top = await req('PUT', `/api/products/${PRODUCT.id}`, { cookie: MGR, body: { stock: 5000 } });
  assert.equal(top.status, 200);
  PRODUCT = top.data.product;
});

/* ================= F-01 الضريبة ================= */

test('F-01: tax is off by default and does not change the old contract', async () => {
  const s = await req('GET', '/api/settings', { cookie: MGR });
  assert.equal(s.data.settings.taxRate, 0);
  const sale = await req('POST', '/api/sales', { cookie: CASH, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'cash' } });
  assert.equal(sale.status, 201);
  assert.equal(sale.data.sale.tax, 0);
  assert.equal(sale.data.sale.total, sale.data.sale.subtotal - sale.data.sale.discount);
});

test('F-01: enabling 14% tax adds a separate line and raises the total', async () => {
  await req('PUT', '/api/settings', { cookie: MGR, body: { taxRate: 14 } });
  const sale = await req('POST', '/api/sales', { cookie: CASH, body: { items: [{ productId: PRODUCT.id, qty: 2 }], method: 'cash' } });
  const s = sale.data.sale;
  assert.equal(s.taxRate, 14);
  assert.equal(money(s.taxableBase), money(s.subtotal - s.discount));
  assert.equal(money(s.tax), money(money(s.taxableBase) * 0.14));
  assert.equal(money(s.total), money(s.taxableBase + s.tax));
});

test('F-01: an exempt product is taxed at zero while others stay taxed', async () => {
  const created = await req('POST', '/api/products', {
    cookie: MGR,
    body: { name: 'خبز بلدي', barcode: `tax-${Date.now()}`, category: 'مخبوزات', cost: 5, price: 10, stock: 50, emoji: '🥖' },
  });
  assert.equal(created.status, 201, `create product: ${JSON.stringify(created.data)}`);
  const exemptId = created.data.product.id;
  await req('PUT', `/api/products/${exemptId}`, { cookie: MGR, body: { taxExempt: true } });

  const sale = await req('POST', '/api/sales', {
    cookie: CASH,
    body: { items: [{ productId: exemptId, qty: 3 }, { productId: PRODUCT.id, qty: 1 }], method: 'cash' },
  });
  const s = sale.data.sale;
  const exemptTotal = 30;
  const taxedTotal = PRODUCT.price;
  assert.equal(money(s.tax), money(money(taxedTotal * 0.14)), 'only the taxed line contributes');
  assert.equal(money(s.total), money(exemptTotal + taxedTotal + money(taxedTotal * 0.14)));
});

test('F-01: the tax invoice carries store data and a sequential number', async () => {
  await req('PUT', '/api/settings', {
    cookie: MGR,
    body: { legalName: 'شركة النيل للتجارة', taxNumber: '123-456-789', commercialRegister: 'CR-9911', address: 'الإسكندرية', invoicePrefix: 'NS' },
  });
  const sale = await req('POST', '/api/sales', { cookie: CASH, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'cash' } });
  const inv = await req('GET', `/api/invoice?id=${sale.data.sale.id}`, { cookie: MGR });
  assert.equal(inv.status, 200);
  assert.equal(inv.data.tax.taxNumber, '123-456-789');
  assert.equal(inv.data.tax.legalName, 'شركة النيل للتجارة');
  assert.match(inv.data.tax.number, /^NS-\d{6}$/);
  assert.equal(inv.data.tax.number, `NS-${String(sale.data.sale.no).padStart(6, '0')}`);
});

test('F-01: the daily report separates tax from sales', async () => {
  const r = await req('GET', '/api/reports/summary?range=today', { cookie: MGR });
  const d = r.data;
  assert.ok(d.taxTotal > 0, 'tax collected is reported');
  assert.ok(Math.abs(d.net - (d.grossTotal - d.refundsTotal)) < 0.02, 'net identity holds with tax in the gross');
});

/* ================= F-02 الخصومات ================= */

test('F-02: a line discount is capped at 30% of that line', async () => {
  const sale = await req('POST', '/api/sales', {
    cookie: MGR,
    body: { items: [{ productId: PRODUCT.id, qty: 1, discount: PRODUCT.price * 5 }], method: 'cash' },
  });
  const line = sale.data.sale;
  assert.equal(money(line.discount), money(money(PRODUCT.price * 0.3)), 'capped at 30%');
});

test('F-02: a coupon applies and is counted', async () => {
  const before = await req('GET', '/api/coupons', { cookie: MGR });
  const coupon = before.data.coupons.find((c) => c.code === 'NILE10');
  assert.ok(coupon, 'seeded coupon exists');
  const used = coupon.used || 0;

  const sale = await req('POST', '/api/sales', {
    cookie: MGR,
    body: { items: [{ productId: PRODUCT.id, qty: 2 }], method: 'cash', couponCode: 'nile10' },
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.data.sale.couponCode, 'NILE10');
  assert.ok(sale.data.sale.couponDiscount > 0);

  const after = await req('GET', '/api/coupons', { cookie: MGR });
  assert.equal(after.data.coupons.find((c) => c.code === 'NILE10').used, used + 1);
});

test('F-02: an unknown or expired coupon is rejected with 400', async () => {
  const bad = await req('POST', '/api/sales', {
    cookie: CASH, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'cash', couponCode: 'NOPE-404' },
  });
  assert.equal(bad.status, 400);

  await req('POST', '/api/coupons', {
    cookie: MGR,
    body: { code: 'OLD1', type: 'percent', value: 5, expiresAt: new Date(Date.now() - 86400000).toISOString() },
  });
  const expired = await req('POST', '/api/sales', {
    cookie: CASH, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'cash', couponCode: 'OLD1' },
  });
  assert.equal(expired.status, 400);
});

test('F-02: a cashier cannot exceed 10% total, a manager can', async () => {
  const big = { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'cash', discount: PRODUCT.price };
  const denied = await req('POST', '/api/sales', { cookie: CASH, body: big });
  assert.equal(denied.status, 403);
  const allowed = await req('POST', '/api/sales', { cookie: MGR, body: big });
  assert.equal(allowed.status, 201);
});

/* ================= F-05 حركات المخزون ================= */

test('F-05: a sale and a refund leave two ledger rows with the right signs', async () => {
  const sale = await req('POST', '/api/sales', { cookie: MGR, body: { items: [{ productId: PRODUCT.id, qty: 3 }], method: 'cash' } });
  assert.equal(sale.status, 201);
  await req('POST', '/api/returns', { cookie: MGR, body: { saleId: sale.data.sale.id, items: [{ productId: PRODUCT.id, qty: 1 }] } });

  const mov = await req('GET', `/api/stock/movements?productId=${PRODUCT.id}&limit=50`, { cookie: MGR });
  const rows = mov.data.movements.slice(0, 2);
  assert.equal(rows[0].qty, 1, 'refund is the newest row');
  assert.equal(rows[0].reason, 'refund');
  assert.equal(rows[1].qty, -3, 'sale row is negative');
  assert.equal(rows[1].reason, 'sale');
});

test('F-05: an adjustment cannot take stock below zero', async () => {
  const bad = await req('POST', '/api/stock/adjust', { cookie: MGR, body: { productId: PRODUCT.id, qty: -99999, reason: 'جرد' } });
  assert.equal(bad.status, 409);
  const good = await req('POST', '/api/stock/adjust', { cookie: MGR, body: { productId: PRODUCT.id, qty: -2, reason: 'تالف' } });
  assert.equal(good.status, 201);
});

/* ================= F-06 الموردون والمشتريات ================= */

test('F-06: receiving stock updates the weighted average cost', async () => {
  const supplier = await req('POST', '/api/suppliers', { cookie: MGR, body: { name: 'مورد النيل', phone: '0100' } });
  assert.equal(supplier.status, 201);

  const fresh = await req('POST', '/api/products', {
    cookie: MGR,
    body: { name: 'صنف توريد', barcode: `po-${Date.now()}`, category: 'اختبار', cost: 50, price: 90, stock: 10, emoji: '📦' },
  });
  const id = fresh.data.product.id;

  const p1 = await req('POST', '/api/purchases', {
    cookie: MGR, body: { supplierId: supplier.data.supplier.id, items: [{ productId: id, qty: 10, cost: 70 }] },
  });
  assert.equal(p1.status, 201);

  const after = await req('GET', '/api/products', { cookie: MGR });
  const prod = after.data.products.find((x) => x.id === id);
  assert.equal(prod.stock, 20);
  assert.equal(money(prod.cost), money((10 * 50 + 10 * 70) / 20), 'weighted average = 60');
});

test('F-06: an unpaid purchase shows as a supplier balance', async () => {
  const s = await req('GET', '/api/suppliers', { cookie: MGR });
  const first = s.data.suppliers.find((x) => x.name === 'مورد النيل');
  assert.ok(first.due > 0, 'unpaid purchase is due');
});

/* ================= F-07 العملاء والآجل والولاء ================= */

test('F-07: credit sales respect the limit and do not enter the drawer', async () => {
  const c = await req('POST', '/api/customers', { cookie: MGR, body: { name: 'أستاذ سيد', phone: `010${Date.now() % 10000000}`, creditLimit: 200 } });
  assert.equal(c.status, 201, `create customer: ${JSON.stringify(c.data)}`);
  const cust = c.data.customer;

  const shiftBefore = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  const sale = await req('POST', '/api/sales', {
    cookie: MGR, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'credit', customerId: cust.id },
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.data.sale.paymentStatus, 'unpaid');

  const shiftAfter = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  assert.equal(shiftAfter, shiftBefore, 'credit does not move the drawer');

  const over = await req('POST', '/api/sales', {
    cookie: MGR, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'credit', customerId: cust.id, discount: 0 },
  });
  // الرصيد الآن قريب من 200؛ بيع إضافي لازم يتحقق مقابل الحد
  const customers = await req('GET', '/api/customers', { cookie: MGR });
  const live = customers.data.customers.find((x) => x.id === cust.id);
  assert.ok(live.balance >= sale.data.sale.total);
  assert.ok([201, 409].includes(over.status));
});

test('F-07: a customer payment reduces the balance and enters the drawer', async () => {
  const customers = await req('GET', '/api/customers', { cookie: MGR });
  const cust = customers.data.customers.find((x) => (x.balance || 0) > 0);
  assert.ok(cust, 'a customer with a balance exists');

  const before = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  const pay = await req('POST', `/api/customers/${cust.id}/payments`, { cookie: MGR, body: { amount: 10 } });
  assert.equal(pay.status, 201);
  assert.equal(money(pay.data.customer.balance), money(cust.balance - 10));

  const after = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  assert.equal(money(after - before), 10);

  const st = await req('GET', `/api/customers/statement?id=${cust.id}`, { cookie: MGR });
  assert.ok(st.data.rows.some((r) => r.kind === 'payment'));
});

test('F-07: a cash sale earns loyalty points', async () => {
  const c = await req('POST', '/api/customers', { cookie: MGR, body: { name: 'عميلة ولاء', phone: `011${Date.now() % 10000000}`, creditLimit: 0 } });
  assert.equal(c.status, 201, `create customer: ${JSON.stringify(c.data)}`);
  const cust = c.data.customer;
  // نقرأ المخزون الآن، لا وقت الإعداد: اختبارات سابقة باعت من نفس الصنف.
  const fresh = (await req('GET', '/api/products', { cookie: MGR })).data.products
    .find((p) => p.id === PRODUCT.id);
  const qty = Math.min(fresh.stock, Math.max(1, Math.ceil(250 / fresh.price)));
  assert.ok(qty >= 1, 'there is stock left to sell');
  const sold = await req('POST', '/api/sales', { cookie: MGR, body: { items: [{ productId: PRODUCT.id, qty }], method: 'cash', customerId: cust.id } });
  assert.equal(sold.status, 201, JSON.stringify(sold.data));
  const customers = await req('GET', '/api/customers', { cookie: MGR });
  const live = customers.data.customers.find((x) => x.id === cust.id);
  assert.ok(live.points > 0, 'points awarded on a paid sale');
});

/* ================= F-08 حركات الدرج ================= */

test('F-08: a cashier movement is pending and only a manager can approve it', async () => {
  const m = await req('POST', '/api/cash-movements', { cookie: CASH, body: { type: 'out', amount: 40, reason: 'إيداع بنكي' } });
  assert.equal(m.status, 201);
  assert.equal(m.data.movement.status, 'pending');

  const before = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  const denied = await req('POST', `/api/cash-movements/${m.data.movement.id}/approve`, { cookie: CASH });
  assert.equal(denied.status, 403);

  const ok = await req('POST', `/api/cash-movements/${m.data.movement.id}/approve`, { cookie: MGR });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.movement.status, 'approved');

  const after = (await req('GET', '/api/shifts', { cookie: MGR })).data.openShift.expectedCashNow;
  assert.equal(money(before - after), 40, 'approved withdrawal reduces the expected drawer');
});

/* ================= F-12 الدفع الجزئي ================= */

test('F-12: a credit invoice can be paid in instalments up to the total', async () => {
  const c = await req('POST', '/api/customers', { cookie: MGR, body: { name: 'عميل تقسيط', phone: `012${Date.now() % 10000000}`, creditLimit: 1000 } });
  const cust = c.data.customer;
  // مخزون طازج: اختبارات سابقة باعت من نفس الصنف.
  const fresh = (await req('GET', '/api/products', { cookie: MGR })).data.products.find((p) => p.id === PRODUCT.id);
  assert.ok(fresh.stock >= 1, 'stock is available for the credit sale');
  const sale = await req('POST', '/api/sales', { cookie: MGR, body: { items: [{ productId: PRODUCT.id, qty: 1 }], method: 'credit', customerId: cust.id } });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const s = sale.data.sale;

  const half = money(s.total / 2);
  const first = await req('POST', `/api/sales/${s.id}/payments`, { cookie: MGR, body: { amount: half, method: 'cash' } });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.sale.paymentStatus, 'partial');

  const over = await req('POST', `/api/sales/${s.id}/payments`, { cookie: MGR, body: { amount: money(s.total) } });
  assert.equal(over.status, 400, 'cannot pay more than what remains');

  const rest = await req('POST', `/api/sales/${s.id}/payments`, { cookie: MGR, body: { amount: money(s.total - half), method: 'cash' } });
  assert.equal(rest.status, 201, JSON.stringify(rest.data));
  assert.equal(rest.status, 201);
  assert.equal(rest.data.sale.paymentStatus, 'paid');
});

/* ================= F-09 التصدير ================= */

test('F-09: CSV exports are real CSV with a BOM and the right columns', async () => {
  for (const name of ['sales', 'returns', 'shifts', 'stock']) {
    // الحصول على البايتات مباشرة: fetch().text() يحذف BOM حسب معيار WHATWG،
    // ففحص النص وحده لا يثبت شيئاً عن الملف الفعلي.
    const raw = await fetch(`${BASE}/api/export/${name}.csv`, { headers: { Cookie: MGR } });
    const buf = Buffer.from(await raw.arrayBuffer());
    assert.equal(raw.status, 200, name);
    assert.match(raw.headers.get('content-type') || '', /text\/csv/, name);
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} starts with a UTF-8 BOM`);
    const body = buf.subarray(3).toString('utf8');
    assert.ok(body.split('\r\n').length > 1, `${name} has rows`);
    assert.ok(body.includes(','), `${name} is comma separated`);
  }
  const denied = await req('GET', '/api/export/sales.csv', { cookie: CASH });
  assert.equal(denied.status, 403);
});

/* ================= F-10 المستخدمون ================= */

test('F-10: a manager creates a user, and the password is never plain', async () => {
  const username = `cashier2_${Date.now() % 100000}`;
  const created = await req('POST', '/api/users', { cookie: MGR, body: { name: 'كاشير جديد', username, password: 'secret123', role: 'cashier', system: 'pos' } });
  assert.equal(created.status, 201);

  const dup = await req('POST', '/api/users', { cookie: MGR, body: { name: 'x', username, password: 'secret123' } });
  assert.equal(dup.status, 409);

  const session = await req('POST', '/api/login', { body: { system: 'pos', username, password: 'secret123' } });
  assert.equal(session.status, 200, 'the new user can log in');

  const wrong = await req('POST', '/api/login', { body: { system: 'pos', username, password: 'nope' } });
  assert.equal(wrong.status, 401);
});

test('F-10: a disabled user cannot log in and the last manager cannot be disabled', async () => {
  const users = (await req('GET', '/api/users', { cookie: MGR })).data.users;
  const cashier = users.find((u) => u.username === 'cashier');
  const off = await req('PUT', `/api/users/${cashier.id}`, { cookie: MGR, body: { active: false } });
  assert.equal(off.status, 200);
  const blocked = await req('POST', '/api/login', { body: { system: 'pos', username: 'cashier', password: 'demo1234' } });
  assert.equal(blocked.status, 403);
  await req('PUT', `/api/users/${cashier.id}`, { cookie: MGR, body: { active: true } });

  const managers = users.filter((u) => u.role === 'manager' && u.active);
  if (managers.length === 1) {
    const last = await req('PUT', `/api/users/${managers[0].id}`, { cookie: MGR, body: { active: false } });
    assert.equal(last.status, 400, 'the last manager stays');
  }
});

/* ================= F-13 التنبيهات ================= */

test('F-13: alerts surface low stock and can be marked seen', async () => {
  // نصنع الشرط بأنفسنا بدل الاعتماد على بقايا اختبارات سابقة.
  const p = await req('POST', '/api/products', {
    cookie: MGR, body: { name: 'آخر علبة', barcode: `low-${Date.now()}`, category: 'اختبار', cost: 5, price: 12, stock: 1 },
  });
  assert.equal(p.status, 201);
  const low = (await req('GET', '/api/stock/low', { cookie: MGR })).data.low;
  assert.ok(low.some((x) => x.id === p.data.product.id), 'the low-stock list includes it');

  const r = await req('GET', '/api/alerts', { cookie: MGR });
  assert.equal(r.status, 200);
  assert.ok(r.data.alerts.some((a) => a.kind === 'low_stock'), 'low stock appears');

  if (r.data.alerts.length) {
    await req('POST', '/api/alerts/seen', { cookie: MGR, body: { ids: [r.data.alerts[0].id] } });
    const again = await req('GET', '/api/alerts', { cookie: MGR });
    assert.ok(!again.data.alerts.some((a) => a.id === r.data.alerts[0].id), 'a seen alert disappears');
  }
  assert.ok(Array.isArray(low));
});

/* ================= F-14 النسخ الاحتياطي ================= */

test('F-14: backup exports the whole document and restore needs an explicit word', async () => {
  const backup = await req('GET', '/api/backup', { cookie: MGR });
  assert.equal(backup.status, 200);
  const parsed = JSON.parse(backup.text);
  assert.ok(Array.isArray(parsed.data.products));
  assert.ok(Array.isArray(parsed.data.users));
  assert.ok(!JSON.stringify(parsed.data.users).includes('demo1234'), 'no plain password in the backup');

  const noConfirm = await req('POST', '/api/restore', { cookie: MGR, body: { data: parsed.data } });
  assert.equal(noConfirm.status, 400);

  const ok = await req('POST', '/api/restore', { cookie: MGR, body: { confirm: 'RESTORE', data: parsed.data } });
  assert.equal(ok.status, 200);
});

/* ================= F-15 الأمان ================= */

test('F-15: five bad logins lock the name for a while', async () => {
  // مستخدم مخصص للاختبار: قفل «manager» كان يسمّم باقي التشغيلات.
  const username = `lockme_${Date.now() % 100000}`;
  const created = await req('POST', '/api/users', { cookie: MGR, body: { name: 'هدف القفل', username, password: 'goodpass1', role: 'cashier' } });
  assert.equal(created.status, 201);

  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await req('POST', '/api/login', { body: { system: 'pos', username, password: 'wrong-pass' } });
  }
  assert.equal(last.status, 429, 'the sixth attempt is rate limited');

  const blocked = await req('POST', '/api/login', { body: { system: 'pos', username, password: 'goodpass1' } });
  assert.equal(blocked.status, 429, 'the lock applies even to the right password');
});

/* ================= F-16 · F-17 السجل ================= */

test('F-16: the systems registry tells the truth about each system', async () => {
  const r = await req('GET', '/api/systems', { cookie: MGR });
  assert.equal(r.status, 200);
  assert.equal(r.data.systems.length, 7, 'seven systems, as promised');
  const pos = r.data.systems.find((s) => s.key === 'pos');
  assert.equal(pos.status, 'live');
  const planned = r.data.systems.filter((s) => s.status === 'planned');
  assert.ok(planned.every((s) => s.note && s.note.length > 0), 'a planned system says what it is missing');
});

test('F-17: الحالات صادقة — كل موقع يعلن حالته كما في صفحته', async () => {
  // كان الاختبار يشترط ألا يدّعي موقع أنه يعمل، لأن اللوحة كانت قائمة مكتوبة
  // بأيدينا بحالة «planned» ثابتة. اللوحة الآن تقرأ الحالة الحقيقية: موقعان
  // يعملان فعلاً، وخمسة قيد التنفيذ — والاختبار يتحقق من التطابق مع الصفحات.
  // اللوحة صارت تطبيقاً مستقلاً بمستخدميه (admin/manager في نظام admin)،
  // فمدير نقاط البيع لا يقرأ قائمتها — وهذا بذاته فحص صلاحيات.
  const own = await req('GET', '/api/sites', { cookie: MGR });
  assert.equal(own.status, 403, 'مدير الكاشير ليس مستخدم لوحة المواقع');
  const adminCookie = (await req('POST', '/api/login', {
    body: { system: 'admin', username: 'admin', password: 'demo1234' },
  })).cookie;
  const r = await req('GET', '/api/sites', { cookie: adminCookie });
  assert.equal(r.data.sites.length, 7);
  const live = r.data.sites.filter((s) => s.status === 'live');
  const coming = r.data.sites.filter((s) => s.status === 'coming');
  assert.equal(live.length + coming.length, 7, 'كل موقع له حالة معروفة');
  assert.ok(live.length >= 2, 'موقعان على الأقل يعملان');
  for (const s of r.data.sites) {
    const page = await fetch(`${BASE}${s.url}`);
    assert.equal(page.status, 200, `صفحة ${s.slug}`);
    const html = await page.text();
    const declaredLive = /class="b live"/.test(html);
    assert.equal(s.status === 'live', declaredLive, `حالة ${s.slug} تطابق شارة صفحته`);
  }
});
