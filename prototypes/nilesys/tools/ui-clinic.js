/* شاشة العيادة في المتصفح.
 * نظام مستقل: دخوله، شاشته، وحركته الحقيقية (حجز → وصول → كشف → روشتة → تحصيل).
 * لا يكفي أن تنجح الـ API — لازم الشاشة نفسها تعمل، والطبيب ما يشوفش زر تحصيل.
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

const uniq = () => String(Date.now());
const localDT = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

(async () => {
  const browser = await chromium.launch();
  const ctxRec = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctxRec.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => {
      const txt = m.text();
      if (m.type() !== 'error') return;
      if (/Failed to load resource/.test(txt) && /(401|409|403|400)/.test(txt)) return; // رفض متعمّد
      errors.push(txt);
    });
  };
  watch(page);

  await page.goto(BASE + '/systems/clinic.html', { waitUntil: 'networkidle' });
  check('C-UI · شاشة العيادة لها حساباتها الثلاثة', (await page.locator('.demo-user').count()) === 3);

  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('C-UI · كاشير نقاط البيع مرفوض في العيادة', (await page.locator('#loginView:not(.hidden)').count()) === 1);

  await page.click('.demo-user[data-u="reception"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.waitForSelector('#apptList', { timeout: 25000 });
  check('C-UI · يوم العيادة يرسم مؤشراته', (await page.locator('.kpi .card').count()) >= 4);
  await page.screenshot({ path: `${OUT}/clinic-day.png` });

  // مريض جديد من الشاشة
  await page.goto(`${BASE}/systems/clinic.html#/patients`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#rows', { timeout: 25000 });
  const phone = '010' + uniq().slice(-8);
  const patientName = 'مريض الواجهة ' + uniq().slice(-4);
  await page.click('#newPatient');
  await page.waitForSelector('#pName', { timeout: 15000 });
  await page.fill('#pName', patientName);
  await page.fill('#pPhone', phone);
  await page.click('#pSave');
  await page.waitForFunction((n) => (document.querySelector('#rows') || {}).textContent?.includes(n), patientName, { timeout: 25000 }).catch(() => {});
  const rowsTxt = (await page.textContent('#rows').catch(() => '')) || '';
  check('C-UI · تسجيل مريض جديد يظهر في القائمة', rowsTxt.includes(patientName));

  // نفس الموبايل مرة تانية → يفتح الملف الموجود بدل التكرار
  await page.click('#newPatient');
  await page.waitForSelector('#pName', { timeout: 15000 });
  await page.fill('#pName', 'اسم مكرر');
  await page.fill('#pPhone', phone);
  await page.click('#pSave');
  await page.waitForSelector('.modal', { timeout: 25000 }).catch(() => {});
  const modalTxt = (await page.textContent('.modal').catch(() => '')) || '';
  check('C-UI · موبايل مكرر يفتح الملف الموجود', modalTxt.includes(patientName) && !modalTxt.includes('اسم مكرر'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // حجز من الشاشة (طبيب بلا تعارض: نختار آخر طبيب في القائمة — د. كريم منصور)
  await page.goto(`${BASE}/systems/clinic.html#/book`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#bPatient', { timeout: 25000 });
  await page.selectOption('#bPatient', { label: `${patientName} — ${phone}` }).catch(async () => {
    await page.selectOption('#bPatient', { index: 0 });
  });
  const opts = await page.locator('#bDoctor option').count();
  await page.selectOption('#bDoctor', { index: opts - 1 });
  await page.fill('#bAt', localDT(Date.now() + (3 + (Date.now() % 5)) * 864e5 + 10 * 3600e3));
  await page.click('#bSave');
  await page.waitForSelector('#apptList', { timeout: 25000 }).catch(() => {});
  check('C-UI · الحجز يرجع ليوم العيادة', (await page.locator('#apptList').count()) === 1);
  await page.screenshot({ path: `${OUT}/clinic-book.png` });

  // الموعد المحجوز مش النهارده؛ نرجع لقائمة اليوم للتأكد أنها سليمة بدون أخطاء
  const dayTxt = (await page.textContent('#apptList').catch(() => '')) || '';
  check('C-UI · قائمة اليوم لا تعرض بيانات مشوّهة', !/undefined|NaN|\[object/.test(dayTxt));

  // الوصول والكشف من حساب الطبيب في نافذة منفصلة
  const ctxDoc = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const docPage = await ctxDoc.newPage();
  watch(docPage);
  await docPage.goto(BASE + '/systems/clinic.html', { waitUntil: 'networkidle' });
  await docPage.click('.demo-user[data-u="doctor"]');
  await docPage.waitForSelector('#apptList', { timeout: 25000 });
  const payBtnsForDoctor = await docPage.locator('[data-act="pay"]').count();
  check('C-UI · الطبيب لا يرى زر التحصيل', payBtnsForDoctor === 0, `${payBtnsForDoctor} زر`);

  // نجهّز موعداً اليوم للكشف عبر الـ API (نفس ما تفعله الشاشة) ثم نكشف عليه من حساب الطبيب
  const token = await page.evaluate(async () => {
    const r = await fetch('/api/clinic/doctors');
    return (await r.json()).doctors.map((d) => d.id);
  });
  const appt = await page.evaluate(async ({ doctorId, phone }) => {
    const pats = await (await fetch('/api/clinic/patients')).json();
    const p = (pats.patients || []).find((x) => x.phone === phone) || (pats.patients || [])[0];
    const at = new Date(Date.now() + 2 * 3600e3).toISOString();
    const r = await fetch('/api/clinic/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: p.id, doctorId, at, minutes: 20 }),
    });
    return { status: r.status, body: await r.json() };
  }, { doctorId: token[token.length - 1], phone });
  check('C-UI · حجز موعد اليوم للاختبار', appt.status === 201 || appt.status === 409, String(appt.status));

  if (appt.status === 201) {
    const id = appt.body.appointment.id;
    // الموعد اتعمل من الـ API بعد رسم الشاشة: إعادة تحميل الصفحة تجيب القائمة الجديدة
    // (تغيير الـ hash لنفسه لا يطلق hashchange، فالشاشة كانت تفضل على قائمتها القديمة).
    await page.goto(`${BASE}/systems/clinic.html#/day`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector(`[data-appt="${id}"]`, { timeout: 25000 });
    await page.locator(`[data-appt="${id}"] [data-act="arrive"]`).click();
    await page.waitForFunction((x) => {
      const el = document.querySelector(`[data-appt="${x}"]`);
      return el && el.dataset.status === 'arrived';
    }, id, { timeout: 25000 }).catch(() => {});
    const st1 = await page.locator(`[data-appt="${id}"]`).getAttribute('data-status');
    check('C-UI · تسجيل وصول المريض من الشاشة', st1 === 'arrived', st1);

    await docPage.goto(`${BASE}/systems/clinic.html#/day`, { waitUntil: 'networkidle' });
    await docPage.reload({ waitUntil: 'networkidle' });
    await docPage.waitForSelector(`[data-appt="${id}"] [data-act="visit"]`, { timeout: 25000 });
    await docPage.locator(`[data-appt="${id}"] [data-act="visit"]`).click();
    await docPage.waitForSelector('#vDiagnosis', { timeout: 15000 });
    await docPage.fill('#vComplaint', 'كحة من ٣ أيام');
    await docPage.fill('#vDiagnosis', 'التهاب حلق');
    await docPage.fill('#rxRows .rx [data-rx="drug"]', 'أوجمنتين');
    await docPage.fill('#rxRows .rx [data-rx="dose"]', 'قرص كل 12 ساعة');
    await docPage.fill('#rxRows .rx [data-rx="duration"]', '7 أيام');
    await docPage.click('#rxAdd');
    await docPage.locator('#rxRows .rx').nth(1).locator('[data-rx="drug"]').fill('بانادول');
    await docPage.locator('#rxRows .rx').nth(1).locator('[data-rx="dose"]').fill('قرص عند اللزوم');
    await docPage.click('#vSave');
    await docPage.waitForFunction((x) => {
      const el = document.querySelector(`[data-appt="${x}"]`);
      return el && el.dataset.status === 'done';
    }, id, { timeout: 25000 }).catch(() => {});
    const statusAfter = await docPage.locator(`[data-appt="${id}"]`).getAttribute('data-status');
    check('C-UI · الكشف والروشتة من شاشة الطبيب', statusAfter === 'done', statusAfter);
    await docPage.screenshot({ path: `${OUT}/clinic-doctor.png` });

    // التحصيل من الاستقبال
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector(`[data-appt="${id}"] [data-act="pay"]`, { timeout: 25000 });
    await page.locator(`[data-appt="${id}"] [data-act="pay"]`).click();
    await page.waitForSelector('#pmGo', { timeout: 15000 });
    await page.click('#pmGo');
    await page.waitForFunction((x) => {
      const el = document.querySelector(`[data-appt="${x}"]`);
      return el && !el.querySelector('[data-act="pay"]');
    }, id, { timeout: 25000 }).catch(() => {});
    const stillPay = await page.locator(`[data-appt="${id}"] [data-act="pay"]`).count();
    check('C-UI · التحصيل يقفل مطالبة الموعد', stillPay === 0);
    await page.screenshot({ path: `${OUT}/clinic-day-paid.png` });

    // ملف المريض يعرض الروشتة بدوائيها
    await page.goto(`${BASE}/systems/clinic.html#/patients`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#rows', { timeout: 25000 });
    await page.fill('#pq', phone);
    await page.waitForTimeout(800);
    await page.locator('#rows [data-act="file"]').first().click();
    await page.waitForSelector('#visitList', { timeout: 25000 });
    const fileTxt = (await page.textContent('#visitList').catch(() => '')) || '';
    check('C-UI · ملف المريض يعرض الروشتة كاملة', fileTxt.includes('أوجمنتين') && fileTxt.includes('بانادول') && fileTxt.includes('التهاب حلق'));
    await page.screenshot({ path: `${OUT}/clinic-file.png` });
    await page.keyboard.press('Escape');
  } else {
    check('C-UI · تسجيل وصول المريض من الشاشة', false, 'ما اتفتحش موعد');
    check('C-UI · الكشف والروشتة من شاشة الطبيب', false, '—');
    check('C-UI · التحصيل يقفل مطالبة الموعد', false, '—');
    check('C-UI · ملف المريض يعرض الروشتة كاملة', false, '—');
  }

  // التقارير والوردية
  await page.goto(`${BASE}/systems/clinic.html#/summary`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const sumTxt = (await page.textContent('#content').catch(() => '')) || '';
  check('C-UI · التقارير ترسم بلا بيانات مشوّهة', !/undefined|NaN|\[object/.test(sumTxt));
  await page.screenshot({ path: `${OUT}/clinic-summary.png` });

  await page.goto(`${BASE}/systems/clinic.html#/shift`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (await page.locator('#openShift').count()) {
    await page.fill('#opening', '200');
    await page.click('#openShift');
    await page.waitForSelector('#closeShift', { timeout: 25000 }).catch(() => {});
  }
  check('C-UI · شاشة الوردية تعرض درجاً مفتوحاً', (await page.locator('#closeShift').count()) === 1);

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  check('C-UI · صفر أخطاء JavaScript', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
