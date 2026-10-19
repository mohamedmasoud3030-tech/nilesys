#!/usr/bin/env node
/**
 * Nile Systems — اختبارات المراجعة الهندسية (المرحلة 1) — v3
 *
 * v3: بعد إصلاح PERM-3 / SALE-2 / SALE-3 / SALE-6 / SHIFT-2 / RESET-2 صارت التأكيدات
 * تتحقق من السلوك الصحيح بدل توثيق الخلل (كانت تأكيدات INFO). RET-4 كان تأكيده قديماً
 * (السلوك سليم أصلاً) فتم تصحيحه. اختبارات الانحدار المعزولة: tests/regression.test.js
 * التشغيل:  BASE=http://localhost:3210 node --test tests/review.test.js
 *
 * كل اختبار بيسجّل نتيجة صريحة: PASS / FAIL / INFO
 * PASS = السلوك صحيح ومُتحقق. FAIL = السلوك مغاير للمتوقع (مشكلة مؤكدة).
 * الاختبارات بتشتغل ضد نسخة معزولة (مش الديمو الحي).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:3210';

/* ---------- helpers ---------- */
async function req(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
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
const login = (system, username, password = 'demo1234') =>
  req('POST', '/api/login', { body: { system, username, password } });
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- تهيئة: إعادة ضبط الديمو لبدء نظيف ---------- */
test('SETUP: إعادة ضبط بيانات الديمو قبل الاختبارات', async () => {
  const l = await login('pos', 'manager');
  assert.equal(l.status, 200);
  const r = await req('POST', '/api/reset', { cookie: l.cookie });
  assert.equal(r.status, 200);
  const l2 = await login('pos', 'manager'); // (v3: الجلسة بقت تنجو من الإعادة — RESET-2؛ الدخول من جديد غير ضروري)
  const sales = await req('GET', '/api/sales?limit=100', { cookie: l2.cookie });
  const products = await req('GET', '/api/products', { cookie: l2.cookie });
  record('SETUP', sales.status === 200 && products.data.products.length === 26,
    `reset=${r.status} products=${products.data.products.length} sales=${sales.data.sales.length}`);
  assert.equal(sales.status, 200);
});

/* ================= 1) المصادقة ================= */

test('AUTH-1: دخول ناجح بكل حسابات التجربة (14 حساب)', async () => {
  const accounts = [
    ['pos', 'manager'], ['pos', 'cashier'], ['inventory', 'manager'], ['inventory', 'store'],
    ['restaurant', 'manager'], ['restaurant', 'waiter'], ['restaurant', 'kitchen'],
    ['clinic', 'manager'], ['clinic', 'reception'], ['clinic', 'doctor'],
    ['hr', 'manager'], ['hr', 'employee'], ['courts', 'manager'], ['admin', 'admin'],
  ];
  for (const [system, username] of accounts) {
    const r = await login(system, username);
    assert.equal(r.status, 200, `${system}/${username} → ${r.status}`);
    assert.ok(r.data.user.id, 'user id missing');
  }
  record('AUTH-1', true, `${accounts.length}/14 حساب`);
});

test('AUTH-2: رفض كلمة مرور غلط', async () => {
  const r = await login('pos', 'manager', 'wrong');
  record('AUTH-2', r.status === 401, `status=${r.status}`);
  assert.equal(r.status, 401);
});

test('AUTH-3: رفض مستخدم من نظام تاني (cashier على inventory)', async () => {
  const r = await login('inventory', 'cashier');
  record('AUTH-3', r.status === 401, `status=${r.status}`);
  assert.equal(r.status, 401);
});

test('AUTH-4: الجلسة شغالة وبتنتهي بعد الخروج', async () => {
  const l = await login('pos', 'manager');
  const s1 = await req('GET', '/api/session', { cookie: l.cookie });
  const lo = await req('POST', '/api/logout', { cookie: l.cookie });
  const s2 = await req('GET', '/api/session', { cookie: l.cookie });
  record('AUTH-4', s1.status === 200 && lo.status === 200 && s2.data.user === null,
    `session=${s1.status} logout=${lo.status} after=${JSON.stringify(s2.data.user)}`);
  assert.equal(s1.status, 200); assert.equal(s2.data.user, null);
});

/* ================= 2) الصلاحيات ================= */

test('PERM-1: الكاشير ممنوع من التعديل/الحذف/المرتجعات/الهوية/الإعادة', async () => {
  const l = await login('pos', 'cashier');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const codes = [
    (await req('PUT', '/api/products/' + p.id, { cookie: l.cookie, body: { name: 'x', price: 1 } })).status,
    (await req('DELETE', '/api/products/' + p.id, { cookie: l.cookie })).status,
    (await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: 'x', items: [] } })).status,
    (await req('PUT', '/api/branding', { cookie: l.cookie, body: { storeName: 'hack' } })).status,
    (await req('POST', '/api/reset', { cookie: l.cookie })).status,
  ];
  record('PERM-1', codes.every((s) => s === 403), `statuses=${codes.join(',')}`);
  assert.ok(codes.every((s) => s === 403));
});

test('PERM-2: المدير مسموح (للمقارنة)', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const put = await req('PUT', '/api/products/' + p.id, {
    cookie: l.cookie,
    body: { name: p.name, price: p.price, cost: p.cost, stock: p.stock, category: p.category, barcode: p.barcode, emoji: p.emoji },
  });
  record('PERM-2', put.status === 200, `PUT status=${put.status}`);
  assert.equal(put.status, 200);
});

test('PERM-3: عزل الأنظمة — موظف HR يوصل لبيانات الكاشير؟', async () => {
  const hr = await login('hr', 'employee');
  const products = await req('GET', '/api/products', { cookie: hr.cookie });
  const report = await req('GET', '/api/reports/summary', { cookie: hr.cookie });
  const posProducts = (await login('pos', 'manager'), await req('GET', '/api/products', { cookie: (await login('pos', 'manager')).cookie })).data.products;
  const sale = await req('POST', '/api/sales', { cookie: hr.cookie, body: { items: [{ productId: posProducts[0].id, qty: 1 }], method: 'cash' } });
  const isolated = products.status === 403 && sale.status === 403 && report.status === 403;
  record('PERM-3', isolated,
    `HR employee: GET products=${products.status} (${products.data.products?.length ?? 0} صنف) | POST sale=${sale.status} | report=${report.status} → ${isolated ? 'معزول' : 'تسريب كامل بين الأنظمة'}`);
  assert.ok(isolated);
});

/* ================= 3) سلامة البيع ================= */

test('SALE-1: بيع عادي بيخصم المخزون ويحسب الربح صح', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.stock > 5);
  const before = p.stock;
  const r = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 3 }], method: 'cash', paid: 1000 } });
  const after = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.id === p.id);
  const expectedProfit = (p.price - p.cost) * 3;
  const ok = r.status === 201 && after.stock === before - 3 && r.data.sale.profit === expectedProfit && r.data.sale.total === p.price * 3;
  record('SALE-1', ok, `stock ${before}→${after.stock} profit=${r.data.sale.profit}/${expectedProfit}`);
  assert.equal(r.status, 201); assert.equal(after.stock, before - 3);
});

test('SALE-2: البيع بأكثر من المخزون (هل السيرفر يمنع؟)', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const before = p.stock;
  const r = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: before + 999 }], method: 'cash' } });
  const after = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.id === p.id);
  // الحكم المطبوع = شرط التأكيد نفسه بالضبط (409 + المخزون لم يتغير)؛ أي كود آخر (مثلاً 500) = FAIL
  const ok = r.status === 409 && after.stock === before;
  const verdict = r.status === 201 ? 'السيرفر قبل بيع أكتر من المخزون' : ok ? 'ممنوع (409)' : `استجابة غير متوقعة (${r.status}) أو المخزون اتغير`;
  record('SALE-2', ok, `status=${r.status} qty sold=${before + 999} stock ${before}→${after.stock} → ${verdict}`);
  assert.equal(r.status, 409); assert.equal(after.stock, before);
});

test('SALE-3: المبلغ المستلم أقل من الإجمالي (هل السيرفر يمنع؟)', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const r = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash', paid: 1 } });
  // سياسة معتمدة: رفض الدفع الناقص بـ 400. الحكم = شرط التأكيد؛ لا قراءة لـ data.sale من استجابة خطأ
  const ok = r.status === 400;
  const verdict = r.status === 201 ? 'السيرفر قبل نقص في الدفع' : ok ? 'مرفوض (400)' : `استجابة غير متوقعة (${r.status})`;
  record('SALE-3', ok, `status=${r.status} price=${p.price} paid=1 → ${verdict}`);
  assert.equal(r.status, 400);
});

test('SALE-4: 20 عملية بيع متزامنة على نفس الصنف', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.stock > 30);
  const before = p.stock;
  const rs = await Promise.all(Array.from({ length: 20 }, () =>
    req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash' } })));
  const created = rs.filter((r) => r.status === 201).length;
  const after = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.id === p.id);
  const ok = created === 20 && after.stock === before - 20;
  record('SALE-4', ok, `created=${created}/20 stock ${before}→${after.stock} (فرق=${before - after.stock - created})`);
  assert.equal(created, 20); assert.equal(after.stock, before - 20);
});

test('SALE-5: الخصم الأكبر من الإجمالي بيتم clamp', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const r = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 2 }], discount: 99999, method: 'cash' } });
  record('SALE-5', r.data.sale.total === 0 && r.data.sale.discount === p.price * 2, `discount=${r.data.sale.discount} total=${r.data.sale.total}`);
  assert.equal(r.data.sale.total, 0);
});

test('SALE-6: باركود مكرر مسموح (تحقق المدخلات)', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const r = await req('POST', '/api/products', { cookie: l.cookie, body: { name: 'صنف اختبار', price: 10, cost: 5, stock: 5, barcode: p.barcode } });
  const dup = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.filter((x) => x.barcode === p.barcode).length;
  // الحكم = شرط التأكيد (409 + لا يوجد تكرار)
  const ok = r.status === 409 && dup === 1;
  const verdict = r.status === 201 ? 'مسموح بباركود مكرر' : ok ? 'مرفوض (409)' : `استجابة غير متوقعة (${r.status}) أو تكرار=${dup}`;
  record('SALE-6', ok, `status=${r.status} duplicates=${dup} → ${verdict}`);
  assert.equal(r.status, 409); assert.equal(dup, 1);
});

test('SALE-7: سعر/تكلفة سالبة أو صفرية', async () => {
  const l = await login('pos', 'manager');
  const r1 = await req('POST', '/api/products', { cookie: l.cookie, body: { name: 'سالب', price: -5, cost: 1, stock: 1 } });
  const r2 = await req('POST', '/api/products', { cookie: l.cookie, body: { name: 'صفر', price: 0, cost: 0, stock: 1 } });
  record('SALE-7', r1.status !== 201 && r2.status !== 201, `negative=${r1.status} zero=${r2.status}`);
  assert.equal(r1.status, 400); assert.equal(r2.status, 400);
});

/* ================= 4) المرتجعات ================= */

test('RET-1: مرتجع جزئي بيسترجع المخزون ويحسب المبلغ', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.stock > 10);
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 4 }], method: 'cash' } })).data.sale;
  const stockAfterSale = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.id === p.id).stock;
  const r = await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 2 }] } });
  const stockAfterRet = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.id === p.id).stock;
  const ok = r.status === 201 && r.data.sale.status === 'partial' && r.data.refund === p.price * 2 && stockAfterRet === stockAfterSale + 2;
  record('RET-1', ok, `status=${r.data.sale.status} refund=${r.data.refund} stock ${stockAfterSale}→${stockAfterRet}`);
  assert.equal(r.data.sale.status, 'partial'); assert.equal(r.data.refund, p.price * 2);
});

test('RET-2: مرتجع كامل', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 3 }], method: 'cash' } })).data.sale;
  const r = await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 3 }] } });
  record('RET-2', r.data.sale.status === 'returned', `status=${r.data.sale.status}`);
  assert.equal(r.data.sale.status, 'returned');
});

test('RET-3: منع تجاوز الكمية المشتراة في المرتجع', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 2 }], method: 'cash' } })).data.sale;
  await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 2 }] } });
  const r2 = await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 2 }] } });
  record('RET-3', r2.status === 400, `second return status=${r2.status}`);
  assert.equal(r2.status, 400);
});

test('RET-4: التقارير بعد مرتجع — هل المبلغ المرتجع بيتخصم؟', async () => {
  const l = await login('pos', 'manager');
  const before = (await req('GET', '/api/reports/summary?range=today', { cookie: l.cookie })).data;
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.stock > 5);
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 5 }], discount: 10, method: 'cash' } })).data.sale;
  const afterSale = (await req('GET', '/api/reports/summary?range=today', { cookie: l.cookie })).data;
  await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 5 }] } });
  const afterRet = (await req('GET', '/api/reports/summary?range=today', { cookie: l.cookie })).data;
  const delta = afterRet.salesTotal - before.salesTotal;
  const expected = 0; // مرتجع كامل → المفروض مبيعات اليوم ماتتغيرش
  record('RET-4', Math.abs(delta - expected) < 1,
    `salesTotal ${before.salesTotal} →(+sale) ${afterSale.salesTotal} →(+مرتجع كامل) ${afterRet.salesTotal} | Δ=${delta} المتوقع ${expected}`);
  assert.ok(Math.abs(delta - expected) < 1);
});

/* ================= 5) الورديات ================= */

test('SHIFT-1: فتح/إغلاق وردية وحساب الفرق (اتساق داخلي)', async () => {
  const l = await login('pos', 'cashier');
  const open = await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'open', startingCash: 500 } });
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash' } });
  const counted = 500 + p.price;
  const close = await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'close', countedCash: counted } });
  const s = close.data.shift;
  const ok = s.diff === s.countedCash - s.expectedCash && s.expectedCash >= 500;
  record('SHIFT-1', ok, `expected=${s.expectedCash} counted=${s.countedCash} diff=${s.diff} (اتساق: diff === counted - expected ✓)`);
  assert.ok(ok);
});

test('SHIFT-2: مرتجع جزئي كاش أثناء الوردية بيخصم من المتوقع؟', async () => {
  const l = await login('pos', 'manager');
  await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'open', startingCash: 1000 } });
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products.find((x) => x.stock > 4);
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 2 }], method: 'cash' } })).data.sale;
  await req('POST', '/api/returns', { cookie: l.cookie, body: { saleId: sale.id, items: [{ productId: p.id, qty: 1 }] } });
  const close = await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'close', countedCash: 1000 + p.price } });
  const s = close.data.shift;
  // الصح: المتوقع = 1000 + سعر قطعة واحدة (القطعة المرتجعة فلوسها رجعت). الحالي: 1000 + سعر قطعتين
  record('SHIFT-2', s.expectedCash === 1000 + p.price,
    `expected=${s.expectedCash} | الصح=${1000 + p.price} | diff=${s.diff} → ${s.expectedCash === 1000 + p.price ? 'المرتجع الجزئي محسوب' : 'المرتجع الجزئي مش بيتخصم'}`);
  assert.equal(s.expectedCash, 1000 + p.price);
});

test('SHIFT-3: منع فتح وردية تانية while واحدة مفتوحة', async () => {
  const l = await login('pos', 'cashier');
  await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'open', startingCash: 100 } });
  const r = await req('POST', '/api/shifts', { cookie: l.cookie, body: { action: 'open', startingCash: 100 } });
  record('SHIFT-3', r.status === 400, `second open status=${r.status}`);
  assert.equal(r.status, 400);
});

/* ================= 6) إعادة الضبط والجلسات ================= */

test('RESET-1: الإعادة بترجّع البيانات الأصلية (26 صنف + مبيعات البذور)', async () => {
  const l = await login('pos', 'manager');
  const r = await req('POST', '/api/reset', { cookie: l.cookie });
  const l2 = await login('pos', 'manager');
  const products = await req('GET', '/api/products', { cookie: l2.cookie });
  const sales = await req('GET', '/api/sales?limit=100', { cookie: l2.cookie });
  record('RESET-1', r.status === 200 && products.data.products.length === 26 && sales.data.sales.length > 30,
    `reset=${r.status} products=${products.data.products.length} seededSales=${sales.data.sales.length}`);
  assert.equal(products.data.products.length, 26);
});

test('RESET-2: الجلسة بعد الإعادة (المستخدم اتعاد إنشاؤه بـ id جديد)', async () => {
  const l = await login('pos', 'manager');
  await req('POST', '/api/reset', { cookie: l.cookie });
  const s = await req('GET', '/api/session', { cookie: l.cookie });
  record('RESET-2', s.data.user !== null,
    `session user=${JSON.stringify(s.data.user)} → ${s.data.user ? 'الجلسة سليمة' : 'الجلسة اتكسرت (401) بعد الإعادة'}`);
  assert.notEqual(s.data.user, null);
});

test('RESET-3: الإعادة مسموحة للمدير بس (اتأكدنا في PERM-1) — وبتلمس كل الأنظمة', async () => {
  // الإعادة الحالية تعمل rebuild لكل db (كل الأنظمة) — ملاحظة معمارية موثقة
  const l = await login('pos', 'manager');
  const r = await req('POST', '/api/reset', { cookie: l.cookie });
  record('RESET-3', r.status === 200, 'الإعادة تعيد بناء قاعدة البيانات بالكامل (كل الأنظمة مش نظام واحد)');
  assert.equal(r.status, 200);
});

/* ================= 7) التحقق من المدخلات ================= */

test('VAL-1: صنف بدون اسم/سعر', async () => {
  const l = await login('pos', 'manager');
  const r1 = await req('POST', '/api/products', { cookie: l.cookie, body: { name: '', price: 0 } });
  record('VAL-1', r1.status === 400, `status=${r1.status}`);
  assert.equal(r1.status, 400);
});

test('VAL-2: بيع بسلة فاضية / صنف غير موجود', async () => {
  const l = await login('pos', 'manager');
  const r1 = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [] } });
  const r2 = await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: 'not-exist', qty: 1 }] } });
  record('VAL-2', r1.status === 400 && r2.status === 400, `empty=${r1.status} bad-id=${r2.status}`);
  assert.equal(r1.status, 400); assert.equal(r2.status, 400);
});

/* ================= 8) الحماية العامة ================= */

test('SEC-1: كل الـ API محمية بدون جلسة', async () => {
  const gets = ['/api/products', '/api/sales', '/api/bootstrap', '/api/reports/summary', '/api/shifts'];
  const posts = ['/api/sales', '/api/shifts', '/api/returns', '/api/products', '/api/reset', '/api/branding'];
  const codes = [];
  for (const p of gets) codes.push((await req('GET', p)).status);
  for (const p of posts) codes.push((await req('PUT', p, { body: {} })).status, (await req('POST', p, { body: {} })).status);
  record('SEC-1', codes.every((c) => c === 401), `all=${codes.length} endpoints → statuses=${[...new Set(codes)].join(',')}`);
  assert.ok(codes.every((c) => c === 401));
});

test('SEC-2: المسارات الثابتة محمية من path traversal', async () => {
  const r1 = await fetch(BASE + '/../server.js').then((r) => r.status).catch(() => 'err');
  const r2 = await fetch(BASE + '/%2e%2e/server.js').then((r) => r.status).catch(() => 'err');
  record('SEC-2', r1 !== 200 && r2 !== 200, `..=${r1} encoded=${r2}`);
  assert.notEqual(r1, 200);
});

/* ================= 9) الاستمرارية ================= */

test('PERSIST-1: البيانات بتتحفظ على الملف بعد العمليات', async () => {
  const l = await login('pos', 'manager');
  const p = (await req('GET', '/api/products', { cookie: l.cookie })).data.products[0];
  const sale = (await req('POST', '/api/sales', { cookie: l.cookie, body: { items: [{ productId: p.id, qty: 1 }], method: 'cash' } })).data.sale;
  await sleep(300); // انتظر flush الملف (debounce 80ms)
  const fs = require('node:fs');
  const dbFile = process.env.DB_FILE || '/tmp/nilesys-review/data/db.json';
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const found = db.sales.find((s) => s.id === sale.id);
  record('PERSIST-1', !!found, `sale ${sale.no} on disk=${!!found} (flush بعد debounce ✓)`);
  assert.ok(found);
});

/* ================= ملخص ================= */

test('ملخص المراجعة', () => {
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  console.log(`\n===== الملخص: ${results.length} نتيجة | ✅ ${pass} سلوك سليم | ❌ ${fail} مشكلة مؤكدة =====`);
  results.filter((r) => r.ok === false).forEach((r) => console.log(`  ❌ ${r.name}: ${r.detail}`));
});
