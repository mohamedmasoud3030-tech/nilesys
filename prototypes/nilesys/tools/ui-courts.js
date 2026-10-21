/* شاشة الملاعب في المتصفح.
 * نظام مستقل: دخوله، جدوله، وحجزه الحقيقي (حجز → تأكيد → لعب → إلغاء).
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(txt) && /(401|403|409|400)/.test(txt)) return; // رفض متعمّد
    errors.push(txt);
  });

  await page.goto(BASE + '/systems/courts.html', { waitUntil: 'networkidle' });
  check('K-UI · شاشة الملاعب لها حساباها', (await page.locator('.demo-user').count()) === 2);

  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('K-UI · كاشير نقاط البيع مرفوض في الملاعب', (await page.locator('#loginView:not(.hidden)').count()) === 1);

  await page.click('.demo-user[data-u="reception"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.waitForSelector('.slot', { timeout: 25000 });
  check('K-UI · الجدول يرسم الملاعب × الساعات', (await page.locator('.slot').count()) >= 20,
    `${await page.locator('.slot').count()} خانة`);
  await page.screenshot({ path: `${OUT}/courts-grid.png` });

  // نفتح يوم بعيد حتى لا نصطدم بحجوزات الديمو المتراكمة
  const date = day(14 + (Date.now() % 5));
  await page.fill('#datePick', date);
  await page.locator('#datePick').dispatchEvent('change');
  await page.waitForTimeout(900);
  check('K-UI · تغيير اليوم يعيد رسم الجدول', (await page.locator('.slot').count()) >= 20);

  // حجز من الشاشة على ساعة فاضية
  const free = page.locator('.slot[data-state="free"]').first();
  const slot = await free.getAttribute('data-slot');
  await free.click();
  await page.waitForSelector('#kName', { timeout: 20000 });
  const amountHint = (await page.textContent('#kHint')) || '';
  check('K-UI · نافذة الحجز تحسب السعر من سعر الملعب', /ج\.م/.test(amountHint), amountHint.slice(0, 60));

  const customer = 'عميل الواجهة ' + String(Date.now()).slice(-4);
  await page.fill('#kName', customer);
  await page.fill('#kPhone', '010' + String(Date.now()).slice(-8));
  await page.fill('#kDeposit', '100');
  await page.click('#kSave');
  await page.waitForFunction((c) => (document.querySelector('#content') || {}).textContent?.includes(c), customer, { timeout: 25000 }).catch(() => {});
  const gridTxt = (await page.textContent('#content').catch(() => '')) || '';
  check('K-UI · الحجز يظهر على الخانة باسم العميل', gridTxt.includes(customer), slot);

  // الحجوزات: تأكيد ثم لعب
  await page.goto(`${BASE}/systems/courts.html#/bookings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#rows', { timeout: 25000 });
  await page.fill('#bq', customer);
  await page.waitForTimeout(1200);
  const rowsTxt = (await page.textContent('#rows').catch(() => '')) || '';
  check('K-UI · البحث بالموبايل/الاسم يجد الحجز', rowsTxt.includes(customer));
  if (await page.locator('#rows [data-act="confirm"]').count()) {
    await page.locator('#rows [data-act="confirm"]').first().click();
    await page.waitForTimeout(1200);
    check('K-UI · تأكيد الحجز من الشاشة', (await page.textContent('#rows')).includes('مؤكد'));
  } else {
    check('K-UI · تأكيد الحجز من الشاشة', false, 'زر التأكيد غير موجود');
  }
  await page.screenshot({ path: `${OUT}/courts-bookings.png` });

  // إلغاء حجز مع سبب
  if (await page.locator('#rows [data-act="cancel"]').count()) {
    await page.locator('#rows [data-act="cancel"]').first().click();
    await page.waitForSelector('#cReason', { timeout: 20000 });
    await page.fill('#cReason', 'العميل غيّر رأيه');
    await page.click('#cGo');
    await page.waitForFunction(() => {
      const rows = document.querySelector('#rows');
      return rows && rows.textContent.includes('ملغي');
    }, null, { timeout: 25000 }).catch(() => {});
    check('K-UI · الإلغاء بسبب يعمل من الشاشة', (await page.textContent('#rows')).includes('ملغي'));
  } else {
    check('K-UI · الإلغاء بسبب يعمل من الشاشة', false, 'زر الإلغاء غير موجود');
  }

  // التقارير والوردية
  await page.goto(`${BASE}/systems/courts.html#/summary`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const sumTxt = (await page.textContent('#content').catch(() => '')) || '';
  check('K-UI · التقارير ترسم بلا بيانات مشوّهة', !/undefined|NaN|\[object/.test(sumTxt));
  check('K-UI · التقرير يعرض الإشغال', sumTxt.includes('%'));
  await page.screenshot({ path: `${OUT}/courts-summary.png` });

  await page.goto(`${BASE}/systems/courts.html#/shift`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (await page.locator('#openShift').count()) {
    await page.fill('#opening', '300');
    await page.click('#openShift');
    await page.waitForSelector('#closeShift', { timeout: 25000 }).catch(() => {});
  }
  check('K-UI · شاشة الوردية تعرض درجاً مفتوحاً', (await page.locator('#closeShift').count()) === 1);

  // الأستقبال لا يعدّل الأسعار
  await page.goto(`${BASE}/systems/courts.html#/courts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('K-UI · الاستقبال لا يرى تعديل الأسعار', (await page.locator('[data-price]').count()) === 0);

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  check('K-UI · صفر أخطاء JavaScript', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
