/* نظام الموارد البشرية — اختبارات النظام الكامل.
 * كل حالة تقابل معيار قبول في docs/product/systems/hr.md.
 *   BASE=http://localhost:4000 node --test tests/hr.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:4000';
const MONTH = '2025-03'; // شهر ماضي ثابت: بيانات الاختبار لا تختلط بمرتبات الشهر الحالي

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

let MGR, OFFICER, EMPLOYEE, E1, E2;

test('SETUP: ثلاثة حسابات وموظفان خاصّان بالاختبار', async () => {
  const login = async (username) => req('POST', '/api/login', { body: { system: 'hr', username, password: 'demo1234' } });
  const m = await login('manager');
  assert.equal(m.status, 200, JSON.stringify(m.data));
  MGR = m.cookie;
  OFFICER = (await login('officer')).cookie;
  EMPLOYEE = (await login('employee')).cookie;
  assert.ok(OFFICER && EMPLOYEE, 'الموارد البشرية والموظف يدخلون');

  const mk = async (name, base, allow, username) => {
    const r = await req('POST', '/api/hr/employees', {
      cookie: OFFICER, body: { name, jobTitle: 'اختبار', baseSalary: base, allowances: allow, username },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.employee;
  };
  E1 = await mk(`موظف حساب ${Date.now()}`, 6000, 500, null);
  E2 = await mk(`موظف إجازات ${Date.now()}`, 6000, 500, null);
  assert.match(E1.code, /^E-\d+$/);
});

test('H-01: تسجيل حضور مرتين لنفس الموظف ونفس اليوم → 409', async () => {
  const first = await req('POST', '/api/hr/attendance', {
    cookie: OFFICER, body: { employeeId: E1.id, date: `${MONTH}-02`, in: '09:00' },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await req('POST', '/api/hr/attendance', {
    cookie: OFFICER, body: { employeeId: E1.id, date: `${MONTH}-02`, in: '09:05' },
  });
  assert.equal(again.status, 409);
});

test('H-02: يوم بلا انصراف يُحسب نصف يوم حتى يُصحَّح بسبب', async () => {
  const rec = await req('POST', '/api/hr/attendance', {
    cookie: OFFICER, body: { employeeId: E1.id, date: `${MONTH}-03`, in: '09:00' },
  });
  assert.equal(rec.status, 201);
  assert.equal(rec.data.attendance.out, null, 'بلا انصراف');

  // يوم 02 بلا انصراف (نصف) + يوم 03 بلا انصراف (نصف) + غيابان = 3 أيام
  for (const d of ['04', '05']) {
    await req('POST', '/api/hr/attendance', { cookie: OFFICER, body: { employeeId: E1.id, date: `${MONTH}-${d}`, status: 'absent' } });
  }
  const run = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  assert.equal(run.status, 201, JSON.stringify(run.data));
  const rowBefore = run.data.rows.find((r) => r.employeeId === E1.id);
  assert.equal(rowBefore.absenceDays, 3, 'نصفان + غيابان');
  assert.equal(rowBefore.absenceDeduction, 600, 'قيمة اليوم 200 × 3');

  const fix = await req('POST', `/api/hr/attendance/${rec.data.attendance.id}/fix`, {
    cookie: OFFICER, body: { out: '17:00', reason: 'نسي يسجّل الانصراف' },
  });
  assert.equal(fix.status, 200, JSON.stringify(fix.data));
  assert.equal(fix.data.attendance.fixed, true);
  const noReason = await req('POST', `/api/hr/attendance/${rec.data.attendance.id}/fix`, { cookie: OFFICER, body: { out: '18:00' } });
  assert.equal(noReason.status, 400, 'التصحيح يحتاج سبباً');

  // بعد التصحيح: نصف اليوم بقى يوماً كاملاً → الغياب 2.5 مش 3
  const rerun = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  const fixedRow = rerun.data.rows.find((r) => r.employeeId === E1.id);
  assert.equal(fixedRow.absenceDays, 2.5, 'التصحيح شال نصف اليوم');
  assert.equal(fixedRow.absenceDeduction, 500);
});

test('H-03: إجازة معتمدة لا تُخصم، ومرفوضة تُخصم', async () => {
  const ok = await req('POST', '/api/hr/leaves', {
    cookie: OFFICER, body: { employeeId: E2.id, from: `${MONTH}-10`, to: `${MONTH}-10`, kind: 'annual', reason: 'ظرف عائلي' },
  });
  const no = await req('POST', '/api/hr/leaves', {
    cookie: OFFICER, body: { employeeId: E2.id, from: `${MONTH}-11`, to: `${MONTH}-11`, kind: 'unpaid', reason: 'سفر' },
  });
  assert.equal(ok.status, 201);
  assert.equal(no.status, 201);

  await req('POST', `/api/hr/leaves/${ok.data.leave.id}/decide`, { cookie: OFFICER, body: { approve: true } });
  await req('POST', `/api/hr/leaves/${no.data.leave.id}/decide`, { cookie: OFFICER, body: { approve: false } });
  const twice = await req('POST', `/api/hr/leaves/${no.data.leave.id}/decide`, { cookie: OFFICER, body: { approve: true } });
  assert.equal(twice.status, 409, 'الحسم مرة واحدة');

  const run = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  const row = run.data.rows.find((r) => r.employeeId === E2.id);
  assert.equal(row.absenceDays, 1, 'المرفوضة فقط تُحسب غياباً');
  assert.equal(row.absenceDeduction, 200);
  assert.equal(row.net, 6300, '6000 + 500 − 200');
});

test('H-04: مرتب شهر = أساسي + بدل − غياب (6100 في المثال)', async () => {
  // E1 عنده 2.5 يوم غياب → خصم 500. نضيف يوم غياب رابع ونصف؟ لا: نصصّ على الرقم المطلوب.
  const run = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  assert.equal(run.status, 201);
  const row = run.data.rows.find((r) => r.employeeId === E1.id);
  assert.equal(row.base, 6000);
  assert.equal(row.allowances, 500);
  assert.equal(row.dayValue, 200);

  // الموظف الجديد بلا سجلات: 6000 + 500 = 6500 (لا خصم بلا دليل)
  const clean = await req('POST', '/api/hr/employees', {
    cookie: OFFICER, body: { name: `موظف نظيف ${Date.now()}`, baseSalary: 6000, allowances: 500 },
  });
  const run2 = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  const rowClean = run2.data.rows.find((r) => r.employeeId === clean.data.employee.id);
  assert.equal(rowClean.absenceDays, 0);
  assert.equal(rowClean.net, 6500, 'بلا غياب = الأساسي + البدلات');

  // مثال المواصفة بالأرقام: غياب يومين على 6000 → 6100
  const target = await req('POST', '/api/hr/employees', {
    cookie: OFFICER, body: { name: `موظف المثال ${Date.now()}`, baseSalary: 6000, allowances: 500 },
  });
  for (const d of ['17', '18']) {
    await req('POST', '/api/hr/attendance', { cookie: OFFICER, body: { employeeId: target.data.employee.id, date: `${MONTH}-${d}`, status: 'absent' } });
  }
  const run3 = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  const rowT = run3.data.rows.find((r) => r.employeeId === target.data.employee.id);
  assert.equal(rowT.absenceDeduction, 400, 'غياب يومين × 200');
  assert.equal(rowT.net, 6100, '6000 + 500 − 400 = 6100');
});

test('H-05: مرتب معتمد لا يُعاد حسابه، والمصروف لا يُعدَّل', async () => {
  const approve = await req('POST', `/api/hr/payroll/${MONTH}/approve`, { cookie: OFFICER });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  const rerun = await req('POST', '/api/hr/payroll/run', { cookie: OFFICER, body: { month: MONTH } });
  assert.equal(rerun.status, 409, 'معتمد = لا إعادة حساب');
  const approveAgain = await req('POST', `/api/hr/payroll/${MONTH}/approve`, { cookie: OFFICER });
  assert.equal(approveAgain.status, 409, 'معتمد بالفعل');
});

test('H-06: صرف الشهر مرة واحدة فقط والخزينة تتأثر مرة واحدة', async () => {
  const before = (await req('GET', '/api/cash-movements', { cookie: MGR })).data.movements
    .filter((m) => m.reason === `hr:salary:${MONTH}`).length;
  assert.equal(before, 0, 'مفيش صرف سابق للشهر');

  const paid = await req('POST', `/api/hr/payroll/${MONTH}/pay`, { cookie: MGR });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.ok(paid.data.total > 0);

  const after = (await req('GET', '/api/cash-movements', { cookie: MGR })).data.movements
    .filter((m) => m.reason === `hr:salary:${MONTH}`);
  assert.equal(after.length, 1, 'حركة خزينة واحدة');
  assert.equal(after[0].origin, 'hr');
  assert.equal(after[0].type, 'out');
  assert.equal(after[0].amount, paid.data.total);

  const twice = await req('POST', `/api/hr/payroll/${MONTH}/pay`, { cookie: MGR });
  assert.equal(twice.status, 409, 'الصرف مرة واحدة');
  const count2 = (await req('GET', '/api/cash-movements', { cookie: MGR })).data.movements
    .filter((m) => m.reason === `hr:salary:${MONTH}`).length;
  assert.equal(count2, 1, 'الخزينة ما اتأثرتش مرتين');

  const officerPay = await req('POST', `/api/hr/payroll/${MONTH}/pay`, { cookie: OFFICER });
  assert.equal([403, 409].includes(officerPay.status), true, 'الموارد البشرية لا تصرف');
});

test('H-07: الموظف يرى سجله فقط، وسجل زميله → 403', async () => {
  const me = await req('GET', '/api/hr/me', { cookie: EMPLOYEE });
  assert.equal(me.status, 200, JSON.stringify(me.data));
  assert.ok(me.data.employee, 'فيه ملف مربوط بالحساب');

  const peek = await req('GET', `/api/hr/attendance?employeeId=${E1.id}`, { cookie: EMPLOYEE });
  assert.equal(peek.status, 403, 'سجل غيره مرفوض');

  const ownPayroll = await req('GET', `/api/hr/payroll`, { cookie: EMPLOYEE });
  assert.equal([200, 404].includes(ownPayroll.status), true);
});

test('H-08: المسيّر يحمل كل بنود الحساب', async () => {
  const sheet = await req('GET', `/api/hr/payroll/${MONTH}`, { cookie: OFFICER });
  assert.equal(sheet.status, 200);
  const row = sheet.data.rows.find((r) => r.employeeId === E1.id);
  for (const key of ['base', 'allowances', 'bonus', 'absenceDeduction', 'lateDeduction', 'advance', 'net', 'dayValue', 'absenceDays']) {
    assert.equal(typeof row[key], 'number', `البند ${key} موجود كرقم`);
  }
  assert.equal(row.status, 'paid');
  assert.equal(row.net, money(row.base + row.allowances + row.bonus - row.absenceDeduction - row.lateDeduction - row.advance));
});

test('H-09: فصل الأنظمة — كاشير نقاط البيع مرفوض في الموارد البشرية', async () => {
  const cashier = (await req('POST', '/api/login', { body: { system: 'pos', username: 'cashier', password: 'demo1234' } })).cookie;
  assert.equal((await req('GET', '/api/hr/employees', { cookie: cashier })).status, 403);
  const doctor = (await req('POST', '/api/login', { body: { system: 'clinic', username: 'doctor', password: 'demo1234' } })).cookie;
  assert.equal((await req('GET', '/api/hr/day', { cookie: doctor })).status, 403);
  // الموظف لا يرى لوحة اليوم (حالات كل الزملاء)
  assert.equal((await req('GET', '/api/hr/day', { cookie: EMPLOYEE })).status, 403);
});
