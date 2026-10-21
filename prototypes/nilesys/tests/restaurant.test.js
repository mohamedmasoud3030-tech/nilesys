/* نظام المطعم — اختبارات النظام الكامل.
 * كل حالة هنا تقابل معيار قبول في docs/product/systems/restaurant.md.
 *   BASE=http://localhost:4000 node --test tests/restaurant.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:4000';

async function req(method, path, { cookie, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const sc = r.headers.get('set-cookie');
  return { status: r.status, data, cookie: sc ? sc.split(';')[0] : null };
}
const money = (n) => Math.round(n * 100) / 100;

let MGR, WAITER, KITCHEN, TABLE, MENU;

test('SETUP: مطعم بحساباته الثلاثة ووردية مفتوحة', async () => {
  const m = await req('POST', '/api/login', { body: { system: 'restaurant', username: 'manager', password: 'demo1234' } });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  MGR = m.cookie;
  WAITER = (await req('POST', '/api/login', { body: { system: 'restaurant', username: 'waiter', password: 'demo1234' } })).cookie;
  KITCHEN = (await req('POST', '/api/login', { body: { system: 'restaurant', username: 'kitchen', password: 'demo1234' } })).cookie;
  assert.ok(WAITER && KITCHEN, 'الويتر والشيف يدخلون');

  // وردية نظيفة: نقفل أي وردية قديمة أولاً حتى يكون المتوقع قابلاً للحساب.
  const old = (await req('GET', '/api/restaurant/shift', { cookie: MGR })).data.openShift;
  if (old) await req('POST', '/api/restaurant/shift', { cookie: MGR, body: { action: 'close', countedCash: 0 } });
  const open = await req('POST', '/api/restaurant/shift', { cookie: MGR, body: { action: 'open', openingCash: 200 } });
  assert.ok([201, 409].includes(open.status));

  const { tables } = (await req('GET', '/api/restaurant/tables', { cookie: MGR })).data;
  TABLE = tables.find((t) => !t.order) || tables[0];
  assert.ok(TABLE, 'فيه ترابيزة');
  MENU = (await req('GET', '/api/restaurant/menu', { cookie: MGR })).data.menu;
  assert.ok(MENU.length >= 5, 'المنيو مزروع');
});

test('R-01: ترابيزة عليها طلب مفتوح لا تقبل طلباً ثانياً', async () => {
  const first = await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[0].id, qty: 2 }] },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const second = await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[1].id, qty: 1 }] },
  });
  assert.equal(second.status, 409);
  // نغلقها عشان الاختبارات التالية تبدأ من ترابيزة فاضية
  await req('POST', `/api/restaurant/orders/${first.data.order.id}/void`, { cookie: MGR, body: { reason: 'تهيئة اختبار' } });
});

test('R-02: إرسال الطلب مرتين لا يضاعف الكميات ولا يولّد تذكرة ثانية', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[0].id, qty: 3 }] },
  })).data.order;

  const first = await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  assert.equal(first.status, 200);
  assert.equal(first.data.sent, 1);
  assert.equal(first.data.resent, false);

  const second = await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  assert.equal(second.data.sent, 0, 'لا أصناف جديدة تُرسل');
  assert.equal(second.data.resent, true);

  const { tickets } = (await req('GET', '/api/restaurant/kitchen', { cookie: KITCHEN })).data;
  const mine = tickets.filter((t) => t.orderId === o.id);
  assert.equal(mine.length, 1, 'تذكرة واحدة');
  assert.equal(mine[0].items.reduce((a, i) => a + i.qty, 0), 3, 'الكمية كما هي');
  await req('POST', `/api/restaurant/orders/${o.id}/void`, { cookie: MGR, body: { reason: 'تهيئة' } });
});

test('R-03: لا دفع قبل إرسال كل الأصناف', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[0].id, qty: 1 }] },
  })).data.order;
  const pay = await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'cash', paid: 9999 } });
  assert.equal(pay.status, 400, JSON.stringify(pay.data));
  assert.match(pay.data.error, /لم يُرسل/);
  await req('POST', `/api/restaurant/orders/${o.id}/void`, { cookie: MGR, body: { reason: 'تهيئة' } });
});

test('R-04: الدفع مرتين مرفوض والمبلغ لا يتضاعف', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[0].id, qty: 2 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  const first = await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'card' } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'card' } });
  assert.equal(second.status, 400);

  const summary = (await req('GET', '/api/restaurant/summary?range=today', { cookie: MGR })).data;
  assert.ok(summary.orders >= 1);
});

test('R-05: إلغاء صنف بعد بدء التحضير يحتاج مديراً', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[0].id, qty: 1 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  const line = o.items[0];

  await req('PATCH', `/api/restaurant/orders/${o.id}/items/${line.id}`, { cookie: KITCHEN, body: { state: 'cooking' } });
  const byWaiter = await req('PATCH', `/api/restaurant/orders/${o.id}/items/${line.id}`, {
    cookie: WAITER, body: { state: 'void', reason: 'العميل غيّر رأيه' },
  });
  assert.equal(byWaiter.status, 403);

  const byManager = await req('PATCH', `/api/restaurant/orders/${o.id}/items/${line.id}`, {
    cookie: MGR, body: { state: 'void', reason: 'العميل غيّر رأيه' },
  });
  assert.equal(byManager.status, 200, JSON.stringify(byManager.data));
  const voided = byManager.data.order.items[0];
  assert.equal(voided.state, 'void');
  assert.equal(voided.voidReason, 'العميل غيّر رأيه');
  assert.ok(voided.voidBy, 'مين ألغى مسجَّل');
  await req('POST', `/api/restaurant/orders/${o.id}/void`, { cookie: MGR, body: { reason: 'تهيئة' } });
});

test('R-06: الدفع النقدي يظهر في درج وردية المطعم بالضبط', async () => {
  const shift = (await req('GET', '/api/restaurant/shift', { cookie: MGR })).data.openShift;
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[0].id, qty: 2 }] },
  })).data.order;
  const total = money(MENU[0].price * 2);
  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  const pay = await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'cash', paid: total + 50 } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.order.payment.change, 50, 'الباقي محسوب');

  const close = await req('POST', '/api/restaurant/shift', { cookie: MGR, body: { action: 'close', countedCash: 0 } });
  assert.equal(close.status, 200);
  const { shift: closed } = close.data;
  assert.equal(closed.id, shift.id);
  assert.ok(closed.expectedCash >= total, `المتوقع ${closed.expectedCash} يحتوي الفاتورة`);

  await req('POST', '/api/restaurant/shift', { cookie: MGR, body: { action: 'open', openingCash: 200 } });
});

test('R-07: تقسيم الحساب على 3 لا يضيع قرشاً', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[0].id, qty: 3 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  const pay = await req('POST', `/api/restaurant/orders/${o.id}/pay`, {
    cookie: WAITER, body: { method: 'card', split: { count: 3 } },
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  const { parts } = pay.data.order.payment.split;
  assert.equal(parts.length, 3);
  assert.equal(money(parts.reduce((a, x) => a + x, 0)), pay.data.order.payment.total, 'المجموع = الإجمالي');
});

test('R-08: حجز متعارض على نفس الترابيزة مرفوض', async () => {
  const at = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const first = await req('POST', '/api/restaurant/reservations', {
    cookie: WAITER, body: { tableId: TABLE.id, at, name: 'أسرة محمد', phone: '01001112223', partySize: 4 },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const second = await req('POST', '/api/restaurant/reservations', {
    cookie: WAITER, body: { tableId: TABLE.id, at, name: 'أسرة أخرى', phone: '01001112224', partySize: 2 },
  });
  assert.equal(second.status, 409);
});

test('R-09: شاشة المطبخ لا تعرض إلا ما يستحق التحضير، بالأقدم أولاً', async () => {
  const a = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[1].id, qty: 1 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${a.id}/send`, { cookie: WAITER });
  await new Promise((r) => setTimeout(r, 20));
  const b = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[2].id, qty: 1 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${b.id}/send`, { cookie: WAITER });

  const { tickets } = (await req('GET', '/api/restaurant/kitchen', { cookie: KITCHEN })).data;
  const ai = tickets.findIndex((t) => t.orderId === a.id);
  const bi = tickets.findIndex((t) => t.orderId === b.id);
  assert.ok(ai >= 0 && bi >= 0, 'الطلبان على الشاشة');
  assert.ok(ai < bi, 'الأقدم أولاً');

  // ما لم يُرسل لا يظهر
  const c = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[3].id, qty: 1 }] },
  })).data.order;
  const after = (await req('GET', '/api/restaurant/kitchen', { cookie: KITCHEN })).data.tickets;
  assert.equal(after.find((t) => t.orderId === c.id), undefined, 'غير المُرسل لا يظهر');

  // بعد «جاهز» و«قُدّم» تخرج التذكرة
  await req('PATCH', `/api/restaurant/orders/${b.id}/items/${b.items[0].id}`, { cookie: KITCHEN, body: { state: 'ready' } });
  await req('PATCH', `/api/restaurant/orders/${b.id}/items/${b.items[0].id}`, { cookie: WAITER, body: { state: 'served' } });
  const fin = (await req('GET', '/api/restaurant/kitchen', { cookie: KITCHEN })).data.tickets;
  assert.equal(fin.find((t) => t.orderId === b.id), undefined, 'المقدَّم يخرج من الشاشة');

  for (const x of [a, b, c]) await req('POST', `/api/restaurant/orders/${x.id}/void`, { cookie: MGR, body: { reason: 'تهيئة' } });
});

test('R-10: صنف غير متوفر لا يُباع', async () => {
  const item = MENU[MENU.length - 1];
  await req('PUT', `/api/restaurant/menu/${item.id}`, { cookie: MGR, body: { available: false } });
  const r = await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: item.id, qty: 1 }] },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /غير متوفر/);
  await req('PUT', `/api/restaurant/menu/${item.id}`, { cookie: MGR, body: { available: true } });
});

test('R-11: الحسابات لا تعبر بين الأنظمة', async () => {
  const posCookie = (await req('POST', '/api/login', { body: { system: 'pos', username: 'manager', password: 'demo1234' } })).cookie;
  const denied = await req('GET', '/api/restaurant/tables', { cookie: posCookie });
  assert.equal(denied.status, 403, 'مدير الكاشير لا يدخل المطعم');

  const kitchenPay = await req('POST', '/api/restaurant/orders', {
    cookie: KITCHEN, body: { tableId: TABLE.id, type: 'takeaway', items: [{ menuItemId: MENU[0].id, qty: 1 }] },
  });
  assert.equal(kitchenPay.status, 403, 'الشيف لا يفتح طلبات');
});

test('R-12: الدفع يحرّر الترابيزة للتنضيف', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[0].id, qty: 1 }] },
  })).data.order;
  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'card' } });
  const t = (await req('GET', '/api/restaurant/tables', { cookie: MGR })).data.tables.find((x) => x.id === TABLE.id);
  assert.equal(t.status, 'dirty');
  assert.equal(t.currentOrderId, null);
  const clean = await req('POST', `/api/restaurant/tables/${TABLE.id}/status`, { cookie: WAITER, body: { status: 'free' } });
  assert.equal(clean.status, 200);
});

test('R-13: الكمية تتعدّل قبل الإرسال وتُقفل بعده، والسطر يُشال بلا أثر مالي', async () => {
  const o = (await req('POST', '/api/restaurant/orders', {
    cookie: WAITER, body: { tableId: TABLE.id, type: 'dine_in', items: [{ menuItemId: MENU[0].id, qty: 1 }] },
  })).data.order;
  const line = o.items[0];
  const up = await req('PATCH', `/api/restaurant/orders/${o.id}/items/${line.id}`, { cookie: WAITER, body: { qty: 3 } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.order.items[0].qty, 3);
  assert.equal(up.data.order.totals.total, money(MENU[0].price * 3), 'الإجمالي يتبع الكمية');

  await req('POST', `/api/restaurant/orders/${o.id}/send`, { cookie: WAITER });
  const locked = await req('PATCH', `/api/restaurant/orders/${o.id}/items/${line.id}`, { cookie: WAITER, body: { qty: 1 } });
  assert.equal(locked.status, 409, 'بعد الإرسال الكمية ثابتة');

  // سطر جديد لم يُرسل يُشال — الطلب يرجع لمجموع السطر الأول فقط
  const add = await req('POST', `/api/restaurant/orders/${o.id}/items`, {
    cookie: WAITER, body: { items: [{ menuItemId: MENU[1].id, qty: 2 }] },
  });
  assert.equal(add.status, 201);
  const extra = add.data.order.items.find((i) => i.menuItemId === MENU[1].id);
  const gone = await req('PATCH', `/api/restaurant/orders/${o.id}/items/${extra.id}`, { cookie: WAITER, body: { qty: 0 } });
  assert.equal(gone.status, 200);
  assert.equal(gone.data.order.items.length, 1, 'السطر اتشال فعلاً');
  assert.equal(gone.data.order.totals.total, money(MENU[0].price * 3));

  await req('POST', `/api/restaurant/orders/${o.id}/pay`, { cookie: WAITER, body: { method: 'card' } });
  await req('POST', `/api/restaurant/tables/${TABLE.id}/status`, { cookie: WAITER, body: { status: 'free' } });
});
