/* شاشة الموارد البشرية في المتصفح.
 * نظام مستقل: دخوله، لوحة اليوم، الحضور والتصحيح، الإجازات، المرتبات والصرف، وسجل الموظف.
 * القاعدة المُختبرة: الموظف لا يرى إلا سجله، والمرتب المصروف لا يُعامل كمسودة.
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };
// شهر ويوم قابلان للتغيير: تشغيل الاختبار مرتين على نفس قاعدة البيانات لا يصطدم
// بحضور مسجّل أو مرتب مصروف من التشغيل السابق.
const MONTH = process.env.HR_MONTH || '2025-01';
const DAY = `${MONTH}-13`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(txt) && /(401|403|409|400|404)/.test(txt)) return; // رفض متعمّد
    errors.push(txt);
  });
  const waitText = (sel, txt, timeout = 25000) => page.waitForFunction(
    ([s, x]) => { const el = document.querySelector(s); return el && el.textContent.includes(x); }, [sel, txt], { timeout },
  ).catch(() => {});
  const goHash = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(900); };

  await page.goto(BASE + '/systems/hr.html', { waitUntil: 'networkidle' });
  check('H-UI · شاشة الموارد البشرية لها ثلاثة حسابات', (await page.locator('.demo-user').count()) === 3,
    `${await page.locator('.demo-user').count()} حساب`);

  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('H-UI · كاشير نقاط البيع مرفوض في الموارد البشرية', (await page.locator('#loginView:not(.hidden)').count()) === 1);

  await page.click('.demo-user[data-u="officer"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.waitForSelector('.board .emp', { timeout: 25000 });
  const cards = await page.locator('.board .emp').count();
  check('H-UI · لوحة اليوم ترسم كل الموظفين بحالتهم', cards >= 4, `${cards} موظف`);
  const dayTxt = (await page.textContent('#content')) || '';
  check('H-UI · لوحة اليوم بلا قيم مشوّهة', !/undefined|NaN|\[object/.test(dayTxt));
  check('H-UI · مؤشر "بلا انصراف" ظاهر', dayTxt.includes('بلا انصراف'));
  await page.screenshot({ path: `${OUT}/hr-day.png` });

  /* ---- الحضور: تسجيل على يوم بعيد ثم تصحيح ---- */
  await goHash('#/attendance');
  await page.waitForSelector('#rows', { timeout: 25000 });
  await page.fill('#aDate', DAY);
  await page.locator('#aDate').dispatchEvent('change');
  await page.waitForTimeout(900);
  await page.click('#addAtt');
  await page.waitForSelector('#atSave', { timeout: 20000 });
  await page.selectOption('#atEmp', { index: 0 });
  await page.fill('#atDate', DAY);
  await page.fill('#atIn', '09:40');   // بعد 09:15 = متأخر
  await page.click('#atSave');
  await waitText('#rows', 'متأخر');
  const attTxt = (await page.textContent('#rows')) || '';
  check('H-UI · تسجيل حضور متأخر يظهر فوراً في الجدول', attTxt.includes('متأخر'));
  check('H-UI · التسجيل بلا انصراف يظهر كناقص', attTxt.includes('ناقص'));
  await page.screenshot({ path: `${OUT}/hr-attendance.png` });

  const fixBtn = page.locator('#rows [data-act="fix"]').first();
  check('H-UI · صف التسجيل يعرض زر تصحيح', (await fixBtn.count()) === 1);
  if (await fixBtn.count()) {
    await fixBtn.click();
    await page.waitForSelector('#fxSave', { timeout: 20000 });
    // بلا سبب = مرفوض من الخادم، والنافذة تبقى مفتوحة
    await page.fill('#fxOut', '17:00');
    await page.click('#fxSave');
    await page.waitForTimeout(900);
    check('H-UI · تصحيح بلا سبب مرفوض والنافذة تظل مفتوحة', (await page.locator('#fxSave').count()) === 1);
    await page.fill('#fxWhy', 'الموظف نسي البصمة');
    await page.click('#fxSave');
    await page.waitForFunction(() => {
      const r = document.querySelector('#rows');
      return r && !r.textContent.includes('ناقص') && r.textContent.includes('17:00');
    }, null, { timeout: 25000 }).catch(() => {});
    const fixedTxt = (await page.textContent('#rows')) || '';
    check('H-UI · التصحيح بسبب يثبت وقت الخروج', fixedTxt.includes('17:00') && !fixedTxt.includes('ناقص'));
  }

  /* ---- الإجازات ---- */
  await goHash('#/leaves');
  await page.waitForSelector('#rows', { timeout: 25000 });
  await page.click('#addLeave');
  await page.waitForSelector('#lvSave', { timeout: 20000 });
  await page.selectOption('#lvEmp', { index: 1 });
  await page.fill('#lvFrom', '2025-02-03');
  await page.fill('#lvTo', '2025-02-04');
  await page.fill('#lvWhy', 'ظروف عائلية');
  await page.click('#lvSave');
  await waitText('#rows', 'منتظرة');
  check('H-UI · طلب الإجازة يظهر بحالة "منتظرة"', ((await page.textContent('#rows')) || '').includes('منتظرة'));
  const decide = page.locator('#rows [data-act="decide"]').first();
  if (await decide.count()) {
    await decide.click();
    await waitText('#rows', 'معتمدة');
  }
  check('H-UI · اعتماد الإجازة من الشاشة', ((await page.textContent('#rows')) || '').includes('معتمدة'));
  await page.screenshot({ path: `${OUT}/hr-leaves.png` });

  /* ---- الموظفون ---- */
  await goHash('#/employees');
  await page.waitForSelector('#rows', { timeout: 25000 });
  const empTxt = (await page.textContent('#rows')) || '';
  check('H-UI · قائمة الموظفين تعرض قيمة اليوم', empTxt.includes('E-1001') && empTxt.includes('ج.م'));
  check('H-UI · أرقام الموظفين بلا NaN', !/NaN|undefined/.test(empTxt));

  /* ---- المرتبات ---- */
  await goHash('#/payroll');
  await page.waitForSelector('#runBtn', { timeout: 25000 });
  await page.fill('#payMonth', MONTH);
  await page.locator('#payMonth').dispatchEvent('change');
  await page.waitForTimeout(900);
  await page.click('#runBtn');
  await waitText('#rows', 'مسودة');
  const payTxt = (await page.textContent('#rows')) || '';
  check('H-UI · حساب الشهر ينتج صفوفاً بحالة مسودة', payTxt.includes('مسودة'), `${await page.locator('#rows tr').count()} صف`);
  check('H-UI · حساب المرتب يعرض خصم التأخير الفعلي', /خصم التأخير/.test((await page.textContent('#content')) || ''));
  check('H-UI · المرتبات بلا قيم مشوّهة', !/NaN|undefined|\[object/.test(payTxt));
  await page.screenshot({ path: `${OUT}/hr-payroll.png` });

  await page.locator('#rows [data-act="slip"]').first().click();
  await page.waitForSelector('.modal .slip', { timeout: 20000 });
  const slipTxt = (await page.textContent('.modal .slip')) || '';
  check('H-UI · المسيّر يفصّل الأساسي والخصومات والصافي', slipTxt.includes('الصافي المستحق') && slipTxt.includes('خصم غياب'));
  await page.click('#slipClose');

  check('H-UI · الموارد البشرية لا ترى زر الصرف', (await page.locator('#payBtn').count()) === 0);
  await page.click('#approveBtn');
  await waitText('#rows', 'معتمد');
  check('H-UI · اعتماد المرتبات يغلق إعادة الحساب', (await page.locator('#runBtn').count()) === 0);

  /* ---- المدير يصرف ---- */
  await page.click('#logoutBtn');
  await page.waitForSelector('.demo-user[data-u="manager"]', { timeout: 25000 });
  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await goHash('#/payroll');
  await page.waitForSelector('#payMonth', { timeout: 25000 });
  await page.fill('#payMonth', MONTH);
  await page.locator('#payMonth').dispatchEvent('change');
  await page.waitForTimeout(1000);
  check('H-UI · المدير يرى زر الصرف بعد الاعتماد', (await page.locator('#payBtn').count()) === 1);
  if (await page.locator('#payBtn').count()) {
    await page.click('#payBtn');
    await waitText('#rows', 'مصروف');
  }
  check('H-UI · صرف الشهر يعلّم الصفوف "مصروف"', ((await page.textContent('#rows')) || '').includes('مصروف'));
  await page.waitForTimeout(800);
  check('H-UI · الشهر المصروف لا يعرض زر صرف ثانياً', (await page.locator('#payBtn').count()) === 0);
  await page.screenshot({ path: `${OUT}/hr-paid.png` });

  /* ---- الموظف: شاشاته فقط ---- */
  await page.click('#logoutBtn');
  await page.waitForSelector('.demo-user[data-u="employee"]', { timeout: 25000 });
  await page.click('.demo-user[data-u="employee"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.waitForSelector('#attRows', { timeout: 25000 });
  const hiddenPayroll = await page.locator('.side .nav-item[data-view="payroll"]').isVisible();
  const hiddenAttendance = await page.locator('.side .nav-item[data-view="attendance"]').isVisible();
  check('H-UI · الموظف لا يرى شاشات المرتبات أو الحضور العامة', !hiddenPayroll && !hiddenAttendance);
  const meTxt = (await page.textContent('#content')) || '';
  check('H-UI · "سجلي" يعرض ملف الموظف نفسه', meTxt.includes('نادين حسام') && meTxt.includes('قيمة يوم الغياب'));
  check('H-UI · مسيّراتي تعرض الشهر المصروف', ((await page.textContent('#payRows')) || '').includes('مصروف'));
  await page.screenshot({ path: `${OUT}/hr-me.png` });

  // رابط مباشر لشاشة ممنوعة: يعود إلى سجله، ولا يرى حالة زملائه
  await goHash('#/payroll');
  await page.waitForSelector('#attRows', { timeout: 25000 }).catch(() => {});
  check('H-UI · الموظف يُعاد إلى سجله عند فتح شاشة المرتبات', (await page.locator('#attRows').count()) === 1
    && (await page.evaluate(() => location.hash)) === '#/me');
  await goHash('#/day');
  await page.waitForTimeout(800);
  check('H-UI · لوحة اليوم غير متاحة للموظف', (await page.locator('.board .emp').count()) === 0);

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  check('H-UI · صفر أخطاء JavaScript', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
