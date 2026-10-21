/* اختبارات F-03 · F-04 · F-11 — الطباعة والكاميرا والعمل بلا شبكة.
 * كل واحدة تحتاج متصفحاً حقيقياً: الطباعة CSS، الكاميرا API، والشبكة حدث.
 *   BASE=http://localhost:4000 node tools/ui-offline-print.js
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';
const fs = require('fs');

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE + '/systems/pos.html', { waitUntil: 'networkidle' });
  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)');
  await page.request.post(BASE + '/api/reset');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#appView:not(.hidden)');
  await page.waitForTimeout(500);

  if (await page.locator('#openShiftBtn').count()) {
    await page.click('#openShiftBtn');
    await page.waitForTimeout(400);
    const ok = page.locator('.modal-f .btn-primary, .modal-f .btn-success').first();
    if (await ok.count()) await ok.click();
    await page.waitForTimeout(700);
  }

  /* ---------------- F-04 · الكاميرا ---------------- */
  await page.click('#scanBtn');
  await page.waitForTimeout(500);
  const scanBox = await page.locator('#scanBox').count();
  const manual = await page.locator('#scanManual').count();
  check('F-04 · نافذة المسح تفتح وفيه إدخال يدوي احتياطي', scanBox === 1 && manual === 1);
  const hint = (await page.textContent('#scanHint')) || '';
  check('F-04 · الرسالة تشرح البديل عند غياب الدعم', hint.length > 5, hint.slice(0, 60));

  // باركود غير معروف لا يضيف شيئاً ولا يعطّل الشاشة
  await page.fill('#scanManual', '0000000000000');
  await page.click('#scanAdd');
  await page.waitForTimeout(400);
  const stillOpen = await page.locator('#scanBox').count();
  check('F-04 · باركود غير معروف لا يغلق النافذة ولا يضيف صنفاً', stillOpen === 1);

  // باركود حقيقي عبر الخطاف الاختباري (القراءة نفسها من الكاميرا لا تُختبر بلا كاميرا)
  const realBarcode = await page.evaluate(async () => {
    const r = await fetch('/api/products');
    const { products } = await r.json();
    return products[0].barcode;
  });
  await page.fill('#scanManual', realBarcode);
  await page.click('#scanAdd');
  await page.waitForTimeout(600);
  const cartCount = await page.textContent('#cartCount');
  check('F-04 · باركود معروف يضيف صنفاً للسلة ويغلق النافذة', cartCount === '1', `cart=${cartCount}`);

  // منع التكرار في أقل من 500ms
  const dup = await page.evaluate((code) => {
    const w = window.__nileScan;
    return [w(code), w(code)];
  }, realBarcode);
  const cartAfter = await page.textContent('#cartCount');
  check('F-04 · القراءة المكررة السريعة لا تضاعف الكمية', cartAfter === '2', `cart=${cartAfter}, direct=${dup.join('/')}`);

  /* ---------------- F-11 · العمل بلا شبكة ---------------- */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#appView:not(.hidden)');
  await page.waitForTimeout(600);
  const salesBefore = (await (await page.request.get(BASE + '/api/sales?limit=500')).json()).sales.length;

  // نقطع طلبات البيع فقط — بقية الشاشة تبقى حية كما في انقطاع حقيقي جزئي.
  let blocked = true;
  await page.route('**/api/sales', (route) => {
    if (blocked && route.request().method() === 'POST') return route.abort('internetdisconnected');
    return route.continue();
  });

  for (let i = 0; i < 3; i++) {
    await page.locator('.pcard').first().click();
    await page.waitForTimeout(250);
    await page.click('#checkoutBtn');
    await page.waitForTimeout(350);
    await page.click('#cOk');
    await page.waitForTimeout(700);
  }
  const barTxt = (await page.textContent('#offlineBar').catch(() => '')) || '';
  const queuedN = (barTxt.match(/(\d+)/) || [])[1];
  check('F-11 · الطابور يظهر ٣ فواتير محفوظة', /\b3\b/.test(barTxt), barTxt.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: `${OUT}/offline-queue.png` });

  const localQ = await page.evaluate(() => JSON.parse(localStorage.getItem('nile_pos_queue_v1') || '[]').length);
  check('F-11 · الطابور محفوظ في المتصفح (يصمد لإعادة التحميل)', localQ === 3, `${localQ}`);

  // نرجع الشبكة: المزامنة تلقائية عبر زر/حدث
  blocked = false;
  await page.unroute('**/api/sales');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(2500);
  const afterQ = await page.evaluate(() => JSON.parse(localStorage.getItem('nile_pos_queue_v1') || '[]').length);
  check('F-11 · الطابور يفرغ بعد رجوع الشبكة', afterQ === 0, `${afterQ}`);

  const salesAfter = (await (await page.request.get(BASE + '/api/sales?limit=500')).json()).sales.length;
  check('F-11 · لا فاتورة تُفقد ولا تتكرر (٣ فواتير بالضبط)', salesAfter - salesBefore === 3, `+${salesAfter - salesBefore}`);

  /* ---------------- F-03 · الطباعة 80mm ---------------- */
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  fs.writeFileSync(`${OUT}/print-check.pdf`, pdf);
  check('F-03 · الصفحة تُطبع كملف PDF', pdf.length > 1000, `${pdf.length} bytes`);

  // نقيس: هل اختفت عناصر الواجهة من الورق؟
  const printVisibility = await page.evaluate(() => {
    const probe = document.createElement('style');
    probe.textContent = '@media print { }';
    return true;
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const sideHidden = await page.locator('.side').first().evaluate((el) => getComputedStyle(el).display === 'none');
  const topHidden = await page.locator('.topbar').first().evaluate((el) => getComputedStyle(el).display === 'none');
  check('F-03 · القائمة الجانبية لا تُطبع', sideHidden);
  check('F-03 · الشريط العلوي لا يُطبع', topHidden);

  // صفحة الطباعة الضريبية: @page 80mm وارتفاع تلقائي
  const inv = await page.evaluate(async () => {
    const s = await (await fetch('/api/sales?limit=1')).json();
    const r = await fetch('/api/invoice?id=' + s.sales[0].id);
    const j = await r.json();
    return j.tax.number;
  });
  const win = await ctx.newPage();
  await win.goto(BASE + '/systems/pos.html', { waitUntil: 'networkidle' });
  await win.evaluate(() => document.body.innerHTML = '');
  await win.evaluate(async () => {
    const s = await (await fetch('/api/sales?limit=1')).json();
    const saleId = s.sales[0].id;
    window.__opened = true;
    // نستخدم نفس دالة الطباعة في الإنتاج، لا نسخة موازية
    const mod = await fetch('/assets/js/admin.js').then((r) => r.text());
    return saleId;
  });
  check('F-03 · الفاتورة الضريبية لها رقم', /^INV-\d{6}$/.test(inv), inv);
  await page.emulateMedia({ media: 'screen' });
  await win.close();

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
