/* اختبار واجهة كامل على السيرفر الحقيقي — سيناريو واحد يمشي على كل المزايا الجديدة.
 * لا يختبر الكود الداخلي، بل ما يراه المستخدم: زر يضغط، رقم يظهر، صف يتكون.
 *   BASE=http://localhost:4000 node tools/ui-flow.js
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // سجل الشبكة: عند الفشل نريد سبباً (500؟ مهلة؟) لا تخميناً.
  const netLog = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) netLog.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`);
  });
  page.on('request', (r) => {
    if (r.url().includes('/api/stock/adjust')) netLog.push(`→ POST body ${String(r.postData()).slice(0, 120)}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) netLog.push(`FAILED ${r.method()} ${r.url().replace(BASE, '')} — ${r.failure()?.errorText}`);
  });
  const money = async (sel) => {
    const t = (await page.textContent(sel).catch(() => '0')) || '0';
    return Number(t.replace(/[^\d.-]/g, '')) || 0;
  };
  // ينقر زر الحفظ ثم يتأكد أن النافذة أُغلقت — وإلا فشل الحفظ وبقيت النافذة
  // تسدّ الشاشة، وكل نقرة بعدها تفشل برسالة مضلِّلة عن «اعتراض المؤشر».
  const modalOk = async (sel, expectClose = true) => {
    await page.click(sel);
    // انتظار حقيقي بدل رقم ثابت: على Vercel الطلب البارد بياخد أكتر من ثانية،
    // والانتظار الثابت كان يخلي الاختبار يفشل بسبب السرعة لا بسبب عيب.
    if (expectClose) {
      await page.waitForFunction(() => !document.querySelector('.modal-back'), { timeout: 25000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
    if (expectClose && await page.locator('.modal-back').count()) {
      const msg = (await page.textContent('.modal-back').catch(() => '')) || '';
      await page.locator('.modal-back .x-btn').first().click().catch(() => {});
      await page.waitForTimeout(200);
      console.log('شبكة:', netLog.slice(-6).join(' | ') || 'لا خطأ شبكة مسجّل');
      throw new Error(`النافذة لم تُغلق بعد ${sel}: ${msg.slice(0, 160)}`);
    }
  };

  await page.goto(BASE + '/systems/pos.html', { waitUntil: 'networkidle' });
  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.waitForTimeout(400);
  // نبدأ من قاعدة نظيفة محلياً فقط: على الديمو المنشور المسح بيمسح بيانات
  // حقيقية، وكل الاختبارات هناك بتستخدم أسماء فريدة بدل ما تمسح.
  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    await page.request.post(BASE + '/api/reset');
    await page.waitForTimeout(500);
  }

  /* ---------- F-13: شارة التنبيهات موجودة في الشريط ---------- */
  const bell = await page.locator('#alertsBtn').count();
  check('F-13 · جرس التنبيهات في الشريط', bell === 1);

  /* ---------- F-01: تفعيل الضريبة من الإعدادات ---------- */
  await page.goto(BASE + '/systems/pos.html#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.fill('#sTax', '14');
  await page.fill('#sTaxNo', '310-455-889');
  await page.fill('#sLegal', 'سوبر ماركت النيل ش.ذ.م.م');
  await page.fill('#sCR', 'CR-99871');
  await page.fill('#sAddr', '١٢ شارع سعد زغلول، الإسكندرية');
  await modalOk('#sSave');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const keptTax = await page.inputValue('#sTax').catch(() => '');
  check('F-01 · الضريبة والهوية تُحفظ وتبقى بعد إعادة التحميل', keptTax === '14', `taxRate=${keptTax}`);

  /* ---------- F-07: عميل جديد بحد آجل ---------- */
  await page.goto(BASE + '/systems/pos.html#/customers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('#addC');
  await page.waitForTimeout(300);
  const phone = '0100' + String(Date.now()).slice(-7);
  await page.fill('#cName', 'سمير عبد الله');
  await page.fill('#cPhone', phone);
  await page.fill('#cLimit', '500');
  await modalOk('#cSave');
  const custRows = await page.locator('#rows tr').count();
  check('F-07 · عميل جديد يظهر في القائمة', custRows >= 1, `${custRows} صف`);

  /* ---------- F-02: كود خصم 10% ---------- */
  await page.goto(BASE + '/systems/pos.html#/coupons', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const seeded = (await page.textContent('#rows')) || '';
  check('F-02 · الأكواد المزروعة ظاهرة (NILE10 و SAVE50)', seeded.includes('NILE10') && seeded.includes('SAVE50'));
  await page.click('#addK');
  await page.waitForTimeout(300);
  const code = `EID${String(Date.now()).slice(-5)}`;
  await page.fill('#kCode', code);
  await page.fill('#kVal', '25');
  await page.fill('#kMin', '200');
  await modalOk('#kOk');
  const couponTxt = (await page.textContent('#rows')) || '';
  check('F-02 · كود جديد يُضاف كساري', couponTxt.includes(code) && couponTxt.includes('ساري'), code);

  /* ---------- F-05: تسوية مخزون ---------- */
  await page.goto(BASE + '/systems/pos.html#/stock', { waitUntil: 'networkidle' });
  await page.waitForSelector('#doAdj', { timeout: 25000 });
  await page.click('#doAdj');
  await page.waitForTimeout(300);
  const firstProd = await page.locator('#ajProd option').first().getAttribute('value');
  await page.fill('#ajQty', '-1');
  await page.fill('#ajWhy', 'تالف');
  await modalOk('#ajOk');
  const movTxt = (await page.textContent('#rows')) || '';
  check('F-05 · التسوية تُسجَّل كحركة مخزون', movTxt.includes('تسوية') || movTxt.includes('تالف'));

  /* ---------- F-08: حركة درج كاشير تحتاج اعتماد ---------- */
  await page.goto(BASE + '/systems/pos.html#/cash', { waitUntil: 'networkidle' });
  await page.waitForSelector('#addM', { timeout: 25000 });
  await page.click('#addM');
  await page.waitForTimeout(300);
  await page.fill('#mAmt', '75');
  await page.fill('#mWhy', 'شراء أكياس');
  await modalOk('#mOk');
  const cashTxt = (await page.textContent('#rows')) || '';
  check('F-08 · حركة يدوية تظهر في الدرج', cashTxt.includes('أكياس'));

  /* ---------- بيع كاش مع ضريبة: الضريبة سطر منفصل ---------- */
  await page.goto(BASE + '/systems/pos.html#/sell', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (await page.locator('#openShiftBtn').count()) {
    await page.click('#openShiftBtn');
    await page.waitForTimeout(400);
    const ok = page.locator('.modal-f .btn-primary, .modal-f .btn-success').first();
    if (await ok.count()) await ok.click();
    await page.waitForTimeout(700);
  }
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(300);
  const cartTotal = await money('#tGrand');
  const cartTax = await money('#tTax');
  await page.click('#checkoutBtn');
  await page.waitForTimeout(400);
  await page.fill('#ckCoupon', 'NILE10');
  await page.click('#ckCouponApply');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/flow-checkout.png` });
  // الإيصال نافذة جديدة تفتح مكان نافذة الدفع — لا نتوقع اختفاء كل النوافذ.
  await page.click('#cOk');
  await page.waitForTimeout(1500);
  if (!(await page.locator('#receipt').count())) {
    const t = (await page.textContent('body').catch(() => '')) || '';
    console.log('DEBUG toast/dialog:', (t.match(/[^\n]{0,80}✗[^\n]{0,80}/) || [''])[0]);
    console.log('DEBUG modal:', await page.textContent('.modal-h').catch(() => 'none'));
    await page.screenshot({ path: `${OUT}/debug-fail.png` });
    throw new Error('no receipt after checkout');
  }
  const receipt = (await page.textContent('#receipt').catch(() => '')) || '';
  check('F-01 · الإيصال يعرض سطر ضريبة', /ض\.ق\.م|VAT/.test(receipt), `tax on cart=${cartTax}`);
  check('F-02 · الإيصال يعرض كود الخصم المستخدم', receipt.includes('NILE10'));
  check('بيع كاش ينتج إيصالاً', receipt.length > 0);
  await page.screenshot({ path: `${OUT}/flow-receipt.png` });
  await page.locator('.modal-f .btn-primary').click();
  await page.waitForTimeout(300);

  /* ---------- F-12: بيع آجل ثم تحصيل ---------- */
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(300);
  await page.click('.chip[data-tender="credit"]');
  await page.waitForTimeout(200);
  await page.click('#checkoutBtn');
  await page.waitForTimeout(400);
  const opts = await page.locator('#ckCustomer option').count();
  await page.selectOption('#ckCustomer', { index: 1 });
  await page.click('#cOk');
  await page.waitForSelector('#receipt', { timeout: 8000 });
  await page.waitForTimeout(400);
  const creditOk = ((await page.textContent('#receipt').catch(() => '')) || '').length > 0;
  check('F-12 · بيع آجل لعميل له حد يُقبل', creditOk, `${opts - 1} عميل في القائمة`);
  await page.locator('.modal-f .btn-primary').click();
  await page.waitForTimeout(400);
  await page.goto(BASE + '/systems/pos.html#/sales', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const collectBtn = page.locator('[data-collect]').first();
  check('F-12 · زر التحصيل يظهر على فاتورة آجلة', (await collectBtn.count()) > 0);
  if (await collectBtn.count()) {
    await collectBtn.click();
    await page.waitForTimeout(400);
    await modalOk('#colOk');
    const rows = (await page.textContent('#rows')) || '';
    check('F-12 · التحصيل يحدّث حالة الفاتورة', rows.includes('مسدَّد') || rows.includes('paid'));
  }

  /* ---------- F-09 + F-16: التصدير والنسخ ---------- */
  await page.goto(BASE + '/systems/pos.html#/backup', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const sysTxt = (await page.textContent('#sysBox')) || '';
  check('F-17 · سجل الأنظمة يظهر بحالاته', sysTxt.includes('الكاشير'));
  const csvResp = await page.request.get(BASE + '/api/export/sales.csv');
  const buf = await csvResp.body();
  check('F-09 · تصدير الفواتير CSV بـ BOM', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, `${buf.length} bytes`);
  const bkResp = await page.request.get(BASE + '/api/backup');
  const bk = await bkResp.json();
  check('F-16 · النسخة الاحتياطية تحمل كل الأقسام',
    ['products', 'sales', 'users', 'shifts', 'customers'].every((k) => k in bk.data));

  /* ---------- F-01 · الفاتورة الضريبية المطبوعة ---------- */
  const salesList = await (await page.request.get(BASE + '/api/sales?limit=1')).json();
  const saleId = salesList.sales[0].id;
  const inv = await (await page.request.get(`${BASE}/api/invoice?id=${saleId}`)).json();
  check('F-01 · رقم الفاتورة الضريبية بصيغة INV-000123', /^INV-\d{6}$/.test(inv.tax.number), inv.tax.number);
  check('F-01 · الفاتورة تحمل الرقم الضريبي', String(inv.tax.taxNumber).includes('310'));

  /* ---------- F-13 · تنبيهات ---------- */
  await page.goto(BASE + '/systems/pos.html#/alerts', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const alertTxt = (await page.textContent('#content')) || '';
  check('F-13 · شاشة التنبيهات ترسم', alertTxt.includes('التنبيهات'));
  await page.screenshot({ path: `${OUT}/flow-alerts.png` });

  /* ---------- أدوار: الكاشير لا يرى شاشات المدير ---------- */
  await page.click('#logoutBtn');
  await page.waitForTimeout(800);
  await page.click('.demo-user[data-u="cashier"]');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.waitForTimeout(500);
  const hiddenSettings = await page.locator('.nav-item[data-view="settings"]').isHidden();
  const visibleCustomers = await page.locator('.nav-item[data-view="customers"]').isVisible();
  check('F-15 · شاشة الإعدادات مخفية عن الكاشير', hiddenSettings);
  check('F-15 · العملاء متاحون للكاشير', visibleCustomers);

  console.log('\nأخطاء الكونسول:', errors.length);
  errors.slice(0, 10).forEach((e) => console.log('  ' + e));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})();
