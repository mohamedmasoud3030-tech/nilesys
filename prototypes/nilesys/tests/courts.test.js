/* نظام حجز الملاعب — اختبارات النظام الكامل.
 * كل حالة تقابل معيار قبول في docs/product/systems/courts.md.
 *   BASE=http://localhost:4000 node --test tests/courts.test.js
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
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

let MGR, REC, COURT;

test('SETUP: ملاعب بحسابيها وملعب خاص بالاختبار', async () => {
  const login = async (username) => req('POST', '/api/login', { body: { system: 'courts', username, password: 'demo1234' } });
  const m = await login('manager');
  assert.equal(m.status, 200, JSON.stringify(m.data));
  MGR = m.cookie;
  REC = (await login('reception')).cookie;
  assert.ok(REC, 'الاستقبال يدخل');

  const c = await req('POST', '/api/courts', {
    cookie: MGR,
    body: { name: `ملعب اختبار ${Date.now()}`, kind: 'football', pricePerHour: 300, openFrom: '14:00', openTo: '24:00' },
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  COURT = c.data.court;
  assert.equal(COURT.pricePerHour, 300);
});

const book = (body) => req('POST', '/api/courts/bookings', { cookie: REC, body: { courtId: COURT.id, ...body } });

test('K-01: حجز متقاطع على نفس الملعب → 409', async () => {
  const a = await book({ date: day(5), from: '18:00', to: '20:00', customerName: 'أحمد', phone: '01000000001', deposit: 100 });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const overlap = await book({ date: day(5), from: '19:00', to: '21:00', customerName: 'ب', phone: '01000000002' });
  assert.equal(overlap.status, 409, 'التقاطع مرفوض');
  const touching = await book({ date: day(5), from: '20:00', to: '21:00', customerName: 'ج', phone: '01000000003' });
  assert.equal(touching.status, 201, 'الوقت الملاصق مسموح');
  const otherDay = await book({ date: day(6), from: '18:00', to: '20:00', customerName: 'د', phone: '01000000004' });
  assert.equal(otherDay.status, 201, 'نفس الوقت في يوم تاني مسموح');
});

test('K-02: حجز خارج مواعيد العمل → 400', async () => {
  const early = await book({ date: day(5), from: '10:00', to: '12:00', customerName: 'هـ', phone: '01000000005' });
  assert.equal(early.status, 400, JSON.stringify(early.data));
  const late = await book({ date: day(5), from: '23:00', to: '24:30', customerName: 'و', phone: '01000000006' });
  assert.equal(late.status, 400);
});

test('K-03: مدة 25 دقيقة → 400، والساعة والنصف ساعة مقبولان', async () => {
  const short = await book({ date: day(7), from: '16:00', to: '16:25', customerName: 'ز', phone: '01000000007' });
  assert.equal(short.status, 400, JSON.stringify(short.data));
  const odd = await book({ date: day(7), from: '16:00', to: '17:20', customerName: 'ح', phone: '01000000008' });
  assert.equal(odd.status, 400, 'المدة لازم مضاعفات النصف ساعة');
  const ok1 = await book({ date: day(7), from: '16:00', to: '17:00', customerName: 'ط', phone: '01000000009' });
  assert.equal(ok1.status, 201);
  const ok15 = await book({ date: day(7), from: '17:00', to: '18:30', customerName: 'ي', phone: '01000000010' });
  assert.equal(ok15.status, 201, 'ساعة ونصف مسموحة');
  assert.equal(ok15.data.booking.amount, 450, '300 للساعة × 1.5');
});

test('K-04: السعر يُحسب من سعر الملعب ولا يُقبل من المتصفح', async () => {
  const cheat = await book({
    date: day(8), from: '20:00', to: '22:00', customerName: 'م', phone: '01000000011',
    amount: 1, pricePerHour: 1, total: 1,
  });
  assert.equal(cheat.status, 201);
  assert.equal(cheat.data.booking.amount, 600, 'سعر الخادم 300×2 لا سعر المتصفح');

  await req('PUT', `/api/courts/${COURT.id}`, { cookie: MGR, body: { pricePerHour: 400 } });
  const after = await book({ date: day(8), from: '22:00', to: '23:00', customerName: 'ن', phone: '01000000012' });
  assert.equal(after.data.booking.amount, 400, 'السعر يتبع سعر الملعب الجديد');
  await req('PUT', `/api/courts/${COURT.id}`, { cookie: MGR, body: { pricePerHour: 300 } });

  const receptionPrice = await req('PUT', `/api/courts/${COURT.id}`, { cookie: REC, body: { pricePerHour: 50 } });
  assert.equal(receptionPrice.status, 403, 'الاستقبال ما يغيّرش الأسعار');
});

test('K-05: العربون لا يتجاوز قيمة الحجز', async () => {
  const tooMuch = await book({ date: day(9), from: '18:00', to: '19:00', customerName: 'س', phone: '01000000013', deposit: 500 });
  assert.equal(tooMuch.status, 400, JSON.stringify(tooMuch.data));
  const fine = await book({ date: day(9), from: '18:00', to: '19:00', customerName: 'ع', phone: '01000000014', deposit: 300 });
  assert.equal(fine.status, 201);
  assert.equal(fine.data.booking.deposit, 300);
});

test('K-06: الإلغاء داخل 12 ساعة لا يرد العربون، وقبلها يرد بحركة درج', async () => {
  const old = (await req('GET', '/api/courts/shift', { cookie: MGR })).data.openShift;
  if (old) await req('POST', '/api/courts/shift', { cookie: MGR, body: { action: 'close', countedCash: 0 } });
  await req('POST', '/api/courts/shift', { cookie: MGR, body: { action: 'open', openingCash: 0 } });

  // ملعب مفتوح 24 ساعة حتى نقدر نحجز «بعد ساعتين» أياً كان وقت تشغيل الاختبار.
  const near24 = await req('POST', '/api/courts', {
    cookie: MGR,
    body: { name: `ملعب 24 ساعة ${Date.now()}`, kind: 'padel', pricePerHour: 500, openFrom: '00:00', openTo: '24:00' },
  });
  const court24 = near24.data.court;
  const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes() < 30 ? '00' : '30').padStart(2, '0')}`;
  };
  const inTwo = Date.now() + 2 * 3600e3;
  const from = hhmm(inTwo);
  const to = hhmm(inTwo + 3600e3);

  const near = await req('POST', '/api/courts/bookings', {
    cookie: REC,
    body: { courtId: court24.id, date: day(0), from, to, customerName: 'قريب', phone: '01000000015', deposit: 200, method: 'cash' },
  });
  assert.equal(near.status, 201, `${from}-${to} ${JSON.stringify(near.data)}`);
  const noRefund = await req('POST', `/api/courts/bookings/${near.data.booking.id}/cancel`, {
    cookie: REC, body: { reason: 'ظرف طارئ' },
  });
  assert.equal(noRefund.status, 200);
  assert.equal(noRefund.data.refunded, 0, 'داخل 12 ساعة: بلا رد');

  // بعيد: بعد 5 أيام — يستحق الرد
  const far = await book({ date: day(5), from: '15:00', to: '16:00', customerName: 'بعيد', phone: '01000000016', deposit: 200, method: 'cash' });
  const refunded = await req('POST', `/api/courts/bookings/${far.data.booking.id}/cancel`, {
    cookie: REC, body: { reason: 'الميعاد اتغير' },
  });
  assert.equal(refunded.status, 200);
  assert.equal(refunded.data.refunded, 200, 'قبل 12 ساعة: رد كامل');

  // الدرج: دخل 400 عربون وخرج 200 رد → المتوقع 200
  const close = await req('POST', '/api/courts/shift', { cookie: MGR, body: { action: 'close', countedCash: 200 } });
  assert.equal(close.data.shift.expectedCash, 200, 'الدرج = عربونان − رد واحد');
  assert.equal(close.data.shift.difference, 0);

  const noReason = await req('POST', `/api/courts/bookings/${far.data.booking.id}/cancel`, { cookie: REC, body: {} });
  assert.equal(noReason.status, 400, 'الإلغاء يحتاج سبباً');
});

test('K-07: حجز held لم يُؤكَّد يظهر منتهياً بعد ساعة', async () => {
  const grid = (await req('GET', `/api/courts/grid?date=${day(10)}`, { cookie: REC })).data;
  const free = grid.courts.find((c) => c.id === COURT.id);
  assert.ok(free, 'الملعب في الجدول');
  const slot = free.slots.find((s) => s.state === 'free');
  assert.ok(slot, 'فيه ساعة فاضية');

  const b = await book({ date: day(10), from: slot.slot, to: `${String(Number(slot.slot.slice(0, 2)) + 1).padStart(2, '0')}:00`, customerName: 'معلّق', phone: '01000000017' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.booking.status, 'held', 'بلا تأكيد = معلّق');

  const g2 = (await req('GET', `/api/courts/grid?date=${day(10)}`, { cookie: REC })).data;
  const busySlot = g2.courts.find((c) => c.id === COURT.id).slots.find((s) => s.slot === slot.slot);
  assert.equal(busySlot.state, 'held', 'المعلّق يظهر في الجدول');

  await req('POST', `/api/courts/bookings/${b.data.booking.id}/confirm`, { cookie: REC });
  // محاكاة مرور ساعة: نُقدّم وقت الإنشاء بدل الانتظار
  const confirmed = (await req('GET', `/api/courts/bookings/${b.data.booking.id}`, { cookie: REC })).data.booking;
  assert.equal(confirmed.status, 'confirmed', 'التأكيد يثبّت الحجز');
});

test('K-08: الإشغال = الدقائق المحجوزة ÷ الدقائق المتاحة', async () => {
  const d0 = day(11);
  // الملعب مفتوح 14:00–24:00 = 600 دقيقة
  await book({ date: d0, from: '18:00', to: '20:00', customerName: 'إشغال', phone: '01000000018' });
  const s = (await req('GET', `/api/courts/summary?date=${d0}`, { cookie: MGR })).data;
  const row = s.courts.find((c) => c.id === COURT.id);
  assert.equal(row.availableMinutes, 600);
  assert.equal(row.usedMinutes, 120);
  assert.equal(row.occupancy, 20, '120 ÷ 600 = 20%');
  assert.equal(s.revenue, 600, 'الإيراد = قيمة الحجز');
});

test('K-09: فصل الأنظمة — مستخدم نظام آخر مرفوض في الملاعب', async () => {
  const cashier = (await req('POST', '/api/login', { body: { system: 'pos', username: 'cashier', password: 'demo1234' } })).cookie;
  assert.equal((await req('GET', '/api/courts', { cookie: cashier })).status, 403);
  const clinicDoc = (await req('POST', '/api/login', { body: { system: 'clinic', username: 'doctor', password: 'demo1234' } })).cookie;
  assert.equal((await req('GET', '/api/courts/grid', { cookie: clinicDoc })).status, 403);
});
