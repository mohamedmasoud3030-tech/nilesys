/* نظام العيادة — اختبارات النظام الكامل.
 * كل حالة هنا تقابل معيار قبول في docs/product/systems/clinic.md.
 *   BASE=http://localhost:4000 node --test tests/clinic.test.js
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

let MGR, REC, DOC, DOCTOR, PATIENT;
const SLOT = Date.now() % 2 === 0 ? 0 : 0; // ثابت الشكل: نستخدم حساب وقت نسبي
const tomorrow = (hour) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

test('SETUP: عيادة بحساباتها الثلاثة وطبيب خاص بالاختبار', async () => {
  const login = async (username) => (await req('POST', '/api/login', { body: { system: 'clinic', username, password: 'demo1234' } }));
  const m = await login('manager');
  assert.equal(m.status, 200, JSON.stringify(m.data));
  MGR = m.cookie;
  REC = (await login('reception')).cookie;
  DOC = (await login('doctor')).cookie;
  assert.ok(REC && DOC, 'الاستقبال والطبيب يدخلون');

  // طبيب جديد باسم فريد: مساحة مواعيد نظيفة لكل تشغيل.
  const doc = await req('POST', '/api/clinic/doctors', {
    cookie: MGR, body: { name: `د. اختبار ${Date.now()}`, specialty: 'عام', fee: 300 },
  });
  assert.equal(doc.status, 201, JSON.stringify(doc.data));
  DOCTOR = doc.data.doctor;
  assert.equal(DOCTOR.fee, 300);

  const p = await req('POST', '/api/clinic/patients', {
    cookie: REC, body: { name: 'مريض الاختبار', phone: `010${String(Date.now()).slice(-8)}`, gender: 'male', birthYear: 1990 },
  });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  PATIENT = p.data.patient;
  assert.match(PATIENT.code, /^P-\d+$/);
});

async function book(at, minutes = 20, patientId = PATIENT.id) {
  return req('POST', '/api/clinic/appointments', {
    cookie: REC, body: { patientId, doctorId: DOCTOR.id, at, minutes },
  });
}

test('C-01: موعدان متعارضان لنفس الطبيب → 409', async () => {
  const first = await book(tomorrow(10));
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const clash = await book(tomorrow(10)); // نفس اللحظة
  assert.equal(clash.status, 409, 'نفس الوقت مرفوض');
  const overlap = await book(new Date(new Date(tomorrow(10)).getTime() + 10 * 60000).toISOString());
  assert.equal(overlap.status, 409, 'التقاطع الجزئي مرفوض');
  const after = await book(new Date(new Date(tomorrow(10)).getTime() + 20 * 60000).toISOString());
  assert.equal(after.status, 201, 'الوقت اللي بعده مباشرة مسموح');
});

test('C-02: بدء كشف قبل وصول المريض → 400', async () => {
  const a = (await book(tomorrow(11))).data.appointment;
  const early = await req('POST', `/api/clinic/appointments/${a.id}/visit`, {
    cookie: DOC, body: { complaint: 'صداع', diagnosis: 'صداع توتري' },
  });
  assert.equal(early.status, 400, JSON.stringify(early.data));
  assert.match(early.data.error, /قبل ما المريض يوصل|وصل/);
});

test('C-03: تسجيل موبايل مكرر → 409 يحمل معرّف المريض الموجود', async () => {
  const again = await req('POST', '/api/clinic/patients', {
    cookie: REC, body: { name: 'اسم تاني', phone: PATIENT.phone },
  });
  assert.equal(again.status, 409);
  assert.equal(again.data.patientId, PATIENT.id, 'الملف الموجود هو المرجع');
  const file = await req('GET', `/api/clinic/patients/${again.data.patientId}`, { cookie: REC });
  assert.equal(file.status, 200);
  assert.equal(file.data.patient.name, PATIENT.name, 'الاسم لم يُستبدل');
});

test('C-04: روشتة بدوائين تُحفظ وتُقرأ كاملة في ملف المريض', async () => {
  const a = (await book(tomorrow(12))).data.appointment;
  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'arrived' } });
  const visit = await req('POST', `/api/clinic/appointments/${a.id}/visit`, {
    cookie: DOC,
    body: {
      complaint: 'حرارة وسعال', diagnosis: 'التهاب شعبي',
      prescription: [
        { drug: 'أوجمنتين 1جم', dose: 'قرص كل 12 ساعة', duration: '7 أيام' },
        { drug: 'بانادول', dose: 'قرص عند اللزوم', duration: '5 أيام', notes: 'بعد الأكل' },
      ],
      followUpAt: tomorrow(18),
    },
  });
  assert.equal(visit.status, 201, JSON.stringify(visit.data));
  assert.equal(visit.data.visit.prescription.length, 2);
  assert.equal(visit.data.appointment.status, 'done', 'الزيارة تقفل الموعد');

  const file = await req('GET', `/api/clinic/patients/${PATIENT.id}`, { cookie: REC });
  const saved = file.data.visits.find((v) => v.appointmentId === a.id);
  assert.ok(saved, 'الزيارة في ملف المريض');
  assert.equal(saved.prescription[1].drug, 'بانادول');
  assert.equal(saved.prescription[1].notes, 'بعد الأكل');
  assert.equal(saved.prescription[0].duration, '7 أيام');
  assert.equal(saved.diagnosis, 'التهاب شعبي');

  const twice = await req('POST', `/api/clinic/appointments/${a.id}/visit`, {
    cookie: DOC, body: { diagnosis: 'تشخيص تاني' },
  });
  assert.equal(twice.status, 409, 'روشتة واحدة لكل زيارة');
});

test('C-05: تحصيل كاش 300 يظهر في درج وردية العيادة بالضبط', async () => {
  // وردية نظيفة: نقفل أي وردية عيادة قديمة، ونفتح بواحد صفر عشان الحساب يكون صريحاً.
  const old = (await req('GET', '/api/clinic/shift', { cookie: MGR })).data.openShift;
  if (old) await req('POST', '/api/clinic/shift', { cookie: MGR, body: { action: 'close', countedCash: 0 } });
  const open = await req('POST', '/api/clinic/shift', { cookie: MGR, body: { action: 'open', openingCash: 0 } });
  assert.equal(open.status, 201, JSON.stringify(open.data));

  const a = (await book(tomorrow(13))).data.appointment;
  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'arrived' } });
  const pay = await req('POST', `/api/clinic/appointments/${a.id}/pay`, { cookie: REC, body: { method: 'cash', amount: 300 } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.appointment.paid, 300);
  assert.equal(pay.data.remaining, 0);

  const close = await req('POST', '/api/clinic/shift', { cookie: MGR, body: { action: 'close', countedCash: 300 } });
  assert.equal(close.status, 200);
  assert.equal(close.data.shift.expectedCash, 300, 'المتوقع في الدرج = 300 بالضبط');
  assert.equal(close.data.shift.difference, 0);
});

test('C-06: الطبيب لا يحصّل → 403', async () => {
  const a = (await book(tomorrow(14))).data.appointment;
  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'arrived' } });
  const denied = await req('POST', `/api/clinic/appointments/${a.id}/pay`, { cookie: DOC, body: { method: 'cash', amount: 300 } });
  assert.equal(denied.status, 403, JSON.stringify(denied.data));
  const kept = await req('GET', `/api/clinic/appointments?date=${tomorrow(14).slice(0, 10)}`, { cookie: MGR });
  const same = kept.data.appointments.find((x) => x.id === a.id);
  assert.equal(same.paid, 0, 'ولا قرش اتسجل');
});

test('C-07: عدم الحضور لا يزيد الإيراد ولا يُحصَّل', async () => {
  const day = tomorrow(15).slice(0, 10);
  const before = (await req('GET', `/api/clinic/summary?date=${day}`, { cookie: MGR })).data;
  const a = (await book(tomorrow(15))).data.appointment;
  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'no_show' } });
  const after = (await req('GET', `/api/clinic/summary?date=${day}`, { cookie: MGR })).data;
  assert.equal(after.revenue, before.revenue, 'الإيراد ما اتغيرش');
  assert.equal(after.noShow, before.noShow + 1, 'اتحسب عدم حضور');
  const pay = await req('POST', `/api/clinic/appointments/${a.id}/pay`, { cookie: REC, body: { method: 'cash' } });
  assert.equal(pay.status, 409, 'مفيش تحصيل لعدم حضور');
});

test('C-08: إعادة جدولة موعد لا تفقد ملف المريض', async () => {
  const a = (await book(tomorrow(16))).data.appointment;
  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'arrived' } });
  const moved = await req('POST', `/api/clinic/appointments/${a.id}/reschedule`, {
    cookie: REC, body: { at: tomorrow(17) },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.appointment.patientId, PATIENT.id, 'نفس المريض');
  assert.equal(moved.data.appointment.status, 'booked');
  assert.equal(moved.data.appointment.previousAt.length, 1, 'الوقت القديم محفوظ');
  const file = await req('GET', `/api/clinic/patients/${PATIENT.id}`, { cookie: REC });
  assert.equal(file.status, 200);
  assert.ok(file.data.appointments.some((x) => x.id === a.id), 'الموعد في ملفه');
});

test('C-09: تحصيل قبل الوصول → 400، وتعديل زيارة مدفوعة للطبيب → 403 وللمدير → يمر', async () => {
  const a = (await book(tomorrow(19))).data.appointment;
  const early = await req('POST', `/api/clinic/appointments/${a.id}/pay`, { cookie: REC, body: { method: 'cash' } });
  assert.equal(early.status, 400, 'المريض لسه ما وصلش');

  await req('POST', `/api/clinic/appointments/${a.id}/status`, { cookie: REC, body: { status: 'arrived' } });
  const visit = await req('POST', `/api/clinic/appointments/${a.id}/visit`, {
    cookie: DOC, body: { diagnosis: 'نزلة معوية', prescription: [{ drug: 'فلاجيل', dose: 'قرص', duration: '5 أيام' }] },
  });
  assert.equal(visit.status, 201);
  const pay = await req('POST', `/api/clinic/appointments/${a.id}/pay`, { cookie: REC, body: { method: 'card' } });
  assert.equal(pay.status, 200);

  const docEdit = await req('PATCH', `/api/clinic/visits/${visit.data.visit.id}`, {
    cookie: DOC, body: { diagnosis: 'تعديل بعد التحصيل' },
  });
  assert.equal(docEdit.status, 403, 'الطبيب ما يعدّلش زيارة مدفوعة');
  const mgrEdit = await req('PATCH', `/api/clinic/visits/${visit.data.visit.id}`, {
    cookie: MGR, body: { diagnosis: 'تعديل معتمد من المدير' },
  });
  assert.equal(mgrEdit.status, 200, JSON.stringify(mgrEdit.data));
  assert.equal(mgrEdit.data.visit.diagnosis, 'تعديل معتمد من المدير');
});

test('C-10: فصل الأنظمة — كاشير نقاط البيع ومدير المطعم مرفوضون في العيادة', async () => {
  const cashier = (await req('POST', '/api/login', { body: { system: 'pos', username: 'cashier', password: 'demo1234' } })).cookie;
  const denied = await req('GET', '/api/clinic/patients', { cookie: cashier });
  assert.equal(denied.status, 403);
  const waiter = (await req('POST', '/api/login', { body: { system: 'restaurant', username: 'waiter', password: 'demo1234' } })).cookie;
  assert.equal((await req('GET', '/api/clinic/appointments', { cookie: waiter })).status, 403);
});
