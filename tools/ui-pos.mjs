/**
 * اختبار متصفح حقيقي لواجهة الكاشير الإنتاجية (/pos): رحلات مدير وكاشير
 * كاملة ببيع حقيقي عبر الـAPI (لا محاكاة) + سلامة التكرار عند قطع الشبكة
 * + لقطات لكل الشاشات الأساسية. يشغَّل على خادم اختبار معزول فقط.
 *
 *   PORT=3000 NILE_PGLITE_DIR=/tmp/nile-ui-test-db npm run api:dev   # Terminal 1
 *   BASE=http://localhost:3000 node tools/ui-pos.mjs                  # Terminal 2
 *
 * متطلبات المتصفح: playwright-core + Chromium. في صناديق Arena بلا متصفح
 * نظام: NILE_PW_HOME=/tmp/pw (فيه playwright-core و@sparticuz/chromium)
 * وLD_LIBRARY_PATH يشير لمكتبات chromium المستخرجة. حسابات الاختبار هي
 * حسابات التهيئة التجريبية للخادم المحلي فقط — لا تُستخدم مع أي نشر حي.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SHOTS = fileURLToPath(new URL('../docs/pos-ui/screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

async function launchBrowser() {
  const pwHome = process.env.NILE_PW_HOME ?? '/tmp/pw';
  let chromium, exe = process.env.NILE_CHROME, args = ['--no-sandbox'];
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    ({ chromium } = await import(`${pwHome}/node_modules/playwright-core/index.mjs`));
  }
  if (!exe) {
    try {
      const sp = (await import(`${pwHome}/node_modules/@sparticuz/chromium/build/index.js`)).default;
      exe = await sp.executablePath();
      args = [...sp.args, '--no-sandbox'];
    } catch { /* متصفح نظام عبر playwright-core */ }
  }
  return chromium.launch({ executablePath: exe, args });
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name} ${extra}`); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayCairo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const today = todayCairo();

async function newPage(browser, vp) {
  const page = await browser.newPage({ viewport: vp });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.consoleErrors = consoleErrors;
  return page;
}

/* المتصفح يطبع أي استجابة HTTP خطأ كـconsole error. ردود 401 هنا متوقعة
   بالتصميم: فحص «هل توجد جلسة؟» عند الإقلاع + محاولة الدخول الخاطئة في
   الاختبار نفسه. وتدفق الشبكة (C) يقطع عمدًا طلبي حفظ (route.abort)
   فيظهر net::ERR_FAILED — مسموح هناك فقط وبعلم الاختبار. ما عدا ذلك
   نرفضه فعلًا: أخطاء JS وأي فشل تحميل موارد آخر. */
const realConsoleErrors = (page, { allowAborted = false } = {}) =>
  page.consoleErrors.filter((t) =>
    !/^Failed to load resource: the server responded with a status of 401/.test(t) &&
    !(allowAborted && /net::ERR_FAILED/.test(t)));
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const apiGet = (page, path) => page.evaluate(async (p) => { const r = await fetch(p); return { status: r.status, body: await r.json().catch(() => ({})) }; }, path);

async function login(page, email) {
  await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', 'demo1234');
  await page.click('#loginBtn');
  await page.waitForSelector('#catalog .item-card', { timeout: 20000 });
  await sleep(300);
}

async function addByName(page, namePart) {
  await page.locator('.item-card', { hasText: namePart }).locator('.item-add').click();
  await sleep(150);
}

/* ═══ A) مدير — سطح مكتب: بحث/وزن/وردية/بيع/تقسيم/مرتجع/تقرير/إغلاق ═══ */
async function flowManager() {
  const browser = await launchBrowser();
  try { return await flowManagerInner(browser); } finally { await browser.close().catch(() => {}); }
}
async function flowManagerInner(browser) {
  console.log('\nA) مدير · 1440×900');
  const page = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  const loginText = await page.locator('#loginView').innerText();
  ok('شاشة الدخول لا تعرض أي كلمة مرور تجريبية', !loginText.includes('demo1234'));
  ok('البريد حقل حر لا قائمة حسابات', (await page.locator('#email').evaluate((n) => n.tagName)) === 'INPUT');
  await page.screenshot({ path: `${SHOTS}after-login-desktop-1440.png` });

  await page.fill('#email', 'pos-manager@nile.demo');
  await page.fill('#password', 'wrong-password');
  await page.click('#loginBtn');
  await page.waitForSelector('#loginErr:not([hidden])');
  ok('دخول خاطئ: رسالة عربية واضحة', (await page.locator('#loginErr').innerText()).includes('غير صحيحة'));

  await login(page, 'pos-manager@nile.demo');
  ok('الدور يظهر معرّبًا (مدير فرع)', (await page.locator('#userRole').innerText()).includes('مدير فرع'));
  ok('قسم الإدارة ظاهر للمدير', await page.locator('#navAdmin').isVisible());
  const catalogText = await page.locator('#catalog').innerText();
  ok('لا حالات مخزون خام بالإنجليزية', !/\(in\)|\(low\)|\(out\)/.test(catalogText));
  ok('أهداف اللمس ≥44px لزر الإضافة', (await page.locator('.item-add').first().evaluate((n) => n.getBoundingClientRect().height)) >= 44);

  await page.fill('#searchInput', 'قهوة');
  await sleep(300);
  ok('البحث يصفّي الأصناف', (await page.locator('#catalog .item-card').count()) === 1);
  await page.click('#searchClear'); await sleep(200);

  await page.fill('#searchInput', 'WTR-600');
  await page.keyboard.press('Enter'); await sleep(250);
  ok('إضافة بكود SKU + Enter (قارئ باركود)', (await page.locator('#cartCount').innerText()).trim() === '1');

  await addByName(page, 'جبنة رومي');
  const cheeseQty = page.locator('.cart-line', { hasText: 'جبنة' }).locator('.qty-input');
  await cheeseQty.fill('0.25');
  await page.locator('.cart-head').click(); await sleep(250);
  ok('بيع بالوزن 0.25 كجم = 80.00', (await page.locator('.cart-line', { hasText: 'جبنة' }).locator('.cart-line-total').innerText()).includes('80.00'));
  ok('الإجمالي المبدئي 87.50', (await page.locator('#sumTotal').innerText()).trim() === '87.50');
  await page.screenshot({ path: `${SHOTS}after-pos-desktop-1440.png` });
  ok('لا تمرير أفقي 1440', (await overflowX(page)) <= 1);

  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.click('#confirmCheckoutBtn'); await sleep(300);
  ok('النقدي بلا وردية يُمنع قبل الحفظ برسالة واضحة', (await page.locator('#checkoutErr').innerText()).includes('وردية'));
  await page.keyboard.press('Escape'); await sleep(200);

  await page.locator('.nav-btn[data-view="shift"]').click();
  await page.fill('#openingAmount', '100');
  await page.click('#openShiftBtn');
  await page.waitForFunction(() => document.getElementById('shiftChipText')?.textContent === 'وردية مفتوحة');
  ok('فتح وردية + شارة الحالة', true);
  await page.locator('.nav-btn[data-view="sale"]').click();
  await page.keyboard.press('F9');
  await page.waitForSelector('#checkoutDialog[open]');
  ok('اختصار F9 يفتح الدفع', true);
  await page.fill('#checkoutDialog .tender-tendered', '100'); await sleep(200);
  ok('معاينة الباقي 12.50 قبل الحفظ', (await page.locator('#tenderChange').innerText()).trim() === '12.50');
  await page.screenshot({ path: `${SHOTS}after-checkout-desktop-1440.png` });

  const confirm = page.locator('#confirmCheckoutBtn');
  await Promise.all([confirm.click(), confirm.click().catch(() => {})]); // ضغطة مزدوجة مقصودة
  await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
  const receiptText = await page.locator('#receiptPaper').innerText();
  ok('الإيصال: إجمالي خادمي 87.50', receiptText.includes('87.50 ج.م'));
  ok('الإيصال: الباقي من الخادم 12.50', receiptText.includes('الباقي للعميل') && receiptText.includes('12.50'));
  const saleId1 = (await page.locator('#receiptPaper code').first().innerText()).trim();
  ok('رقم فاتورة كامل على الإيصال', /^[0-9a-f-]{36}$/i.test(saleId1), saleId1);
  await page.screenshot({ path: `${SHOTS}after-receipt-desktop-1440.png` });
  let rep = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  ok('الضغطة المزدوجة لم تصنع فاتورة ثانية (عدد المفوتر 1)', rep.billedCount === 1, JSON.stringify(rep));
  await page.click('#newSaleBtn'); await sleep(200);

  /* بيع ثانٍ: دفع مقسّم 7.50 نقدي + 7.50 بطاقة */
  await addByName(page, 'مياه معدنية'); await addByName(page, 'مياه معدنية');
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.fill('#checkoutDialog .tender-row:first-child .tender-amount', '7.50'); await sleep(150);
  await page.click('#addTenderBtn'); await sleep(200);
  const secondAmt = await page.locator('#checkoutDialog .tender-row').nth(1).locator('.tender-amount').inputValue();
  ok('الدفع المقسّم: الصف الثاني يأخذ المتبقي (7.50)', secondAmt === '7.50', secondAmt);
  await page.click('#confirmCheckoutBtn');
  await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
  ok('بيع مقسّم نجح ووصلنا إيصاله', (await page.locator('#receiptPaper').innerText()).includes('15.00 ج.م'));
  const saleId2 = (await page.locator('#receiptPaper code').first().innerText()).trim();

  /* مرتجع جزئي من الإيصال */
  ok('زر المرتجع ظاهر للمدير على الإيصال', await page.locator('#receiptRefundBtn').isVisible());
  await page.click('#receiptRefundBtn');
  await page.waitForSelector('#refundDialog[open]');
  await page.locator('#refundLines .refund-qty').first().fill('1'); await sleep(150);
  await page.click('#confirmRefundBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.click('#confirmOk');
  await page.locator('.toast', { hasText: 'تم المرتجع بمبلغ 7.50' }).waitFor({ timeout: 20000 });
  ok('مرتجع جزئي بتأكيد صريح تم بنجاح (المبلغ النهائي من الخادم)', true);
  rep = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  ok('الخادم: المحصّل 102.50 − مرتجعات 7.50 = صافي 95.00',
    rep.collectedMinor === 10250 && rep.refundsMinor === 750 && rep.netCollectedMinor === 9500, JSON.stringify(rep));

  /* الإدارة: تقرير بعنوان المحصّل + استرجاع فاتورة */
  await page.locator('.nav-btn[data-view="admin"]').click();
  await page.waitForFunction(() => document.getElementById('kpiNetCollected')?.textContent === '95.00');
  ok('التقرير يعنْوِن صافي المحصّل (ADR-0014)', true);
  ok('تفصيل طرق الدفع ظاهر', (await page.locator('#reportMethods').innerText()).includes('نقدي'));
  await page.screenshot({ path: `${SHOTS}after-report-desktop-1440.png` });
  await page.fill('#saleLookupId', saleId1);
  await page.click('#saleLookupBtn');
  await page.waitForSelector('#saleLookupResult .receipt-paper');
  ok('استرجاع فاتورة برقمها الكامل', (await page.locator('#saleLookupResult').innerText()).includes('87.50'));

  /* إغلاق الوردية: متوقع خادمي 187.50 */
  await page.locator('.nav-btn[data-view="shift"]').click();
  await page.waitForFunction(() => document.getElementById('shiftExpected')?.textContent === '187.50');
  ok('متوقع الدرج من الخادم = 187.50', true);
  await page.screenshot({ path: `${SHOTS}after-shift-desktop-1440.png` });
  await page.fill('#countedAmount', '187.50'); await sleep(150);
  ok('معاينة الفرق = 0.00', (await page.locator('#closeDiffPreview').innerText()).includes('0.00'));
  await page.click('#closeShiftBtn');
  await page.waitForSelector('#confirmDialog[open]');
  await page.click('#confirmOk');
  await page.waitForSelector('#closureResult:not([hidden])', { timeout: 20000 });
  ok('إغلاق وردية بتأكيد وفرق صفر محفوظ', (await page.locator('#closureDiff').innerText()).includes('0.00'));

  /* وضع داكن + طباعة وإعادة فتح وردية للتدفقات التالية */
  await page.click('#themeBtn'); await sleep(200);
  ok('الوضع الداكن يُفعّل من الزر', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.locator('.nav-btn[data-view="sale"]').click(); await sleep(200);
  await page.screenshot({ path: `${SHOTS}after-pos-dark-1440.png` });
  await page.click('#themeBtn'); await sleep(150);
  /* لا نعيد فتح وردية هنا: تدفق الشبكة (C) جلسة متصفح جديدة تفتح ورديتها
     بنفسها على نفس السجل، ووجود وردية مفتوحة مجهولة المعرف لها يمنعها. */

  ok('صفر أخطاء Console في رحلة المدير', realConsoleErrors(page).length === 0, page.consoleErrors.join(' | '));
  await page.close();
  return { saleId2 };
}

/* ═══ B) كاشير — تابلت + جوال: صلاحيات ودرج سلة واستمرارية ═══ */
async function flowCashier() {
  const browser = await launchBrowser();
  try { return await flowCashierInner(browser); } finally { await browser.close().catch(() => {}); }
}
async function flowCashierInner(browser) {
  console.log('\nB) كاشير · 768×1024 ثم 390×844 و360×740');
  const page = await newPage(browser, { width: 768, height: 1024 });
  await login(page, 'cashier@nile.demo');
  ok('الدور: كاشير', (await page.locator('#userRole').innerText()).includes('كاشير'));
  ok('قسم الإدارة مخفي عن الكاشير', await page.locator('#navAdmin').isHidden());
  ok('لا تمرير أفقي على التابلت', (await overflowX(page)) <= 1);

  await addByName(page, 'مشروب غازي');
  await page.screenshot({ path: `${SHOTS}after-pos-tablet-768.png` });
  const repBefore = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  await page.locator('#mobileCartBar').click();
  await page.waitForSelector('#cartPane.is-open');
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.locator('#checkoutDialog .tender-row .method-btn', { hasText: 'بطاقة' }).click(); await sleep(150);
  await page.click('#confirmCheckoutBtn');
  await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
  ok('الكاشير باع بالبطاقة دون وردية', (await page.locator('#receiptPaper').innerText()).includes('15.00'));
  ok('لا زر مرتجع للكاشير على الإيصال', await page.locator('#receiptRefundBtn').isHidden());
  await page.click('#newSaleBtn'); await sleep(200);
  const repAfter = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  ok('زيادة فاتورة واحدة فقط عند الخادم', repAfter.billedCount === repBefore.billedCount + 1);

  await page.setViewportSize({ width: 390, height: 844 }); await sleep(250);
  await addByName(page, 'مياه معدنية');
  ok('شريط سلة الجوال ثابت ودقيق', await page.locator('#mobileCartBar').isVisible());
  ok('لا تمرير أفقي 390', (await overflowX(page)) <= 1);
  await page.screenshot({ path: `${SHOTS}after-pos-mobile-390.png` });
  await page.locator('#mobileCartBar').click(); await sleep(250);
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.screenshot({ path: `${SHOTS}after-checkout-mobile-390.png` });
  ok('حوار الدفع ملء العرض بلا تمرير أفقي', (await overflowX(page)) <= 1);
  await page.keyboard.press('Escape'); await sleep(200);

  await page.setViewportSize({ width: 360, height: 740 }); await sleep(250);
  ok('لا تمرير أفقي 360', (await overflowX(page)) <= 1);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#catalog .item-card', { timeout: 20000 });
  ok('بعد إعادة التحميل: الجلسة مستعادة دون دخول جديد', await page.locator('#appView').isVisible());
  ok('بعد إعادة التحميل: السلة محفوظة', (await page.locator('#cartCount').innerText()).trim() === '1');
  await page.keyboard.press('/');
  ok('اختصار / يركّز البحث', (await page.evaluate(() => document.activeElement?.id)) === 'searchInput');
  ok('صفر أخطاء Console في رحلة الكاشير', realConsoleErrors(page).length === 0, page.consoleErrors.join(' | '));
  await page.close();
}

/* ═══ C) قطع شبكة أثناء الحفظ: لا افتراض ولا تكرار ═══ */
async function flowNetworkSafety() {
  const browser = await launchBrowser();
  try { return await flowNetworkSafetyInner(browser); } finally { await browser.close().catch(() => {}); }
}
async function flowNetworkSafetyInner(browser) {
  console.log('\nC) سلامة التكرار عند قطع الشبكة · 1440×900');
  const page = await newPage(browser, { width: 1440, height: 900 });
  await login(page, 'pos-manager@nile.demo');
  await page.locator('.nav-btn[data-view="shift"]').click();
  await page.fill('#openingAmount', '50');
  await page.click('#openShiftBtn');
  await page.waitForFunction(() => document.getElementById('shiftChipText')?.textContent === 'وردية مفتوحة');
  await page.locator('.nav-btn[data-view="sale"]').click(); await sleep(200);
  const before = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;

  await addByName(page, 'مياه معدنية');
  let aborted = false;
  await page.route('**/api/v1/checkout', async (route) => {
    if (!aborted) { aborted = true; await route.abort('failed'); }
    else await route.continue();
  });
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.click('#confirmCheckoutBtn');
  await page.waitForSelector('#checkoutUncertain:not([hidden])', { timeout: 20000 });
  ok('بعد قطع الشبكة: حالة «غير مؤكدة» صريحة', true);
  ok('حقول الدفع مقفلة حتى لا يتغير الطلب (مبلغ وطريقة)',
    (await page.locator('#checkoutDialog .tender-amount').isDisabled()) &&
    (await page.locator('#checkoutDialog .method-btn').first().isDisabled()));
  ok('السلة لم تُمسح بعد الخطأ', true);
  await page.screenshot({ path: `${SHOTS}after-checkout-uncertain-1440.png` });

  await page.click('#confirmCheckoutBtn'); // إعادة نفس العملية بالمفتاح نفسه
  await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
  const mid = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  ok('إعادة المحاولة أنجزت فاتورة واحدة فقط', mid.billedCount === before.billedCount + 1, `${before.billedCount}→${mid.billedCount}`);
  await page.click('#newSaleBtn'); await sleep(200);
  await page.unrouteAll({ behavior: 'wait' }).catch(() => {});

  /* قطع + إعادة تحميل كاملة للصفحة: الهوية يجب أن تنجو */
  await addByName(page, 'شيبسي');
  let aborted2 = false;
  await page.route('**/api/v1/checkout', async (route) => {
    if (!aborted2) { aborted2 = true; await route.abort('failed'); }
    else await route.continue();
  });
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  await page.click('#confirmCheckoutBtn');
  await page.waitForSelector('#checkoutUncertain:not([hidden])', { timeout: 20000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#catalog .item-card', { timeout: 20000 });
  await page.click('#openCheckoutBtn');
  await page.waitForSelector('#checkoutDialog[open]');
  ok('بعد إعادة التحميل: العملية المعلّقة مسترجعة ومقفلة', await page.locator('#checkoutUncertain').isVisible());
  await page.click('#confirmCheckoutBtn');
  await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
  const after = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
  ok('رغم القطع وإعادة التحميل: فاتورة واحدة إضافية فقط', after.billedCount === mid.billedCount + 1, `${mid.billedCount}→${after.billedCount}`);
  ok('صفر أخطاء Console في رحلة الشبكة (عدا قطعَي الاختبار المتعمدين)', realConsoleErrors(page, { allowAborted: true }).length === 0, page.consoleErrors.join(' | '));
  await page.close();
}

/* ── D) استرجاع الوردية عبر الأجهزة (G-02) + رد مفقود بعد حفظ الخادم (§6) ── */
async function flowCrossDeviceInner() {
  console.log('\nD) جهاز ثانٍ يسترجع الوردية · وردّ مفقود بعد حفظ خادمي · 1440×900');
  // الجهاز A: المدير يفتح وردية ثم يختفي (إغلاق المتصفح بالكامل)
  {
    const browserA = await launchBrowser();
    const pageA = await newPage(browserA, { width: 1440, height: 900 });
    await login(pageA, 'pos-manager@nile.demo');
    await pageA.locator('.nav-btn[data-view="shift"]').click(); await sleep(300);
    // تدفق C السابق قد يكون ترك وردية مفتوحة — عندئذٍ يكون الجهاز A قد ارتبط
    // بها تلقائيًا أصلًا (G-02)، ولا حاجة لفتح جديدة.
    if ((await pageA.locator('#shiftChipText').textContent()) !== 'وردية مفتوحة') {
      await pageA.fill('#openingAmount', '100');
      await pageA.click('#openShiftBtn');
      await pageA.waitForFunction(() => document.getElementById('shiftChipText')?.textContent === 'وردية مفتوحة', { timeout: 20000 });
    }
    await browserA.close().catch(() => {});
  }
  // الجهاز B: كاشير بجلسة جديدة تمامًا — يجب أن يجد الوردية تلقائيًا
  const browser = await launchBrowser();
  try {
    const page = await newPage(browser, { width: 1440, height: 900 });
    await login(page, 'cashier@nile.demo');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const before = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
    await page.waitForFunction(() => document.getElementById('shiftChipText')?.textContent === 'وردية مفتوحة', { timeout: 20000 }).catch(() => {});
    ok('G-02: الجهاز الثاني رأى الوردية المفتوحة تلقائيًا دون فتح ثانية',
      (await page.locator('#shiftChipText').textContent()) === 'وردية مفتوحة');
    await addByName(page, 'مياه معدنية');
    await page.click('#openCheckoutBtn');
    await page.waitForSelector('#checkoutDialog[open]');
    ok('G-02: الدفع النقدي متاح فورًا على الجهاز الثاني', await page.locator('#checkoutShiftWarn').isHidden());
    await page.click('#confirmCheckoutBtn');
    await page.waitForSelector('#receiptDialog[open]', { timeout: 20000 });
    ok('G-02: بيع نقدي ناجح على وردية الجهاز الأول', true);
    await page.click('#newSaleBtn'); await sleep(250);

    /* §6: الخادم يحفظ البيع لكن الرد لا يصل المتصفح أبدًا (fetch ثم abort).
       بعد تحديث الصفحة يجب أن تسترد المصالحةُ الإيصالَ نفسه — لا بيع ثانٍ. */
    await addByName(page, 'مشروب غازي');
    let swallowed = false;
    await page.route('**/api/v1/checkout', async (route) => {
      if (!swallowed) { swallowed = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.click('#openCheckoutBtn');
    await page.waitForSelector('#checkoutDialog[open]');
    await page.click('#confirmCheckoutBtn');
    await page.waitForSelector('#checkoutUncertain:not([hidden])', { timeout: 20000 });
    ok('§6: بعد فقدان الرد الحالة «غير مؤكدة» (لا افتراض نجاح/فشل)', true);
    await page.reload({ waitUntil: 'networkidle' });
    // المصالحة عند الدخول تعرض الإيصال المحفوظ خادميًا من تلقاء نفسها
    await page.waitForSelector('#receiptDialog[open]', { timeout: 25000 });
    ok('§6: المصالحة عند إعادة التحميل استردت الإيصال المحفوظ', true);
    const after = (await apiGet(page, `/api/v1/reports/daily?from=${today}&to=${today}`)).body.report;
    ok('§6: فاتورتان فقط في هذا التدفق كله رغم الرد المفقود', after.billedCount === before.billedCount + 2, `${before.billedCount}→${after.billedCount}`);
    await page.click('#newSaleBtn'); await sleep(250);
    ok('§6: السلة فارغة بعد المصالحة (لم تبقَ بنود محفوظة قابل لإعادة بيعها)',
      (await page.locator('#sumTotal').innerText()).trim() === '0.00');
    ok('صفر أخطاء Console في تدفق الأجهزة/المصالحة (عدا قطع الاختبار المتعمد)', realConsoleErrors(page, { allowAborted: true }).length === 0, page.consoleErrors.join(' | '));
    await page.close();
  } finally { await browser.close().catch(() => {}); }
}

/* متصفح جديد لكل تدفق: كروميوم المدمج (sparticuz) أحادي العملية وقد يسقط
   بين الصفحات الطويلة — العزل يجعل أي سقوط فشلًا مسجلًا لا انهيار تشغيل. */
for (const [name, flow] of [['المدير', flowManager], ['الكاشير', flowCashier], ['الشبكة', flowNetworkSafety], ['الأجهزة/المصالحة', flowCrossDeviceInner]]) {
  try { await flow(); }
  catch (e) { ok(`اكتمال تدفق ${name} دون استثناء`, false, String(e).slice(0, 300)); }
}
console.log(`\nالمجموع: ${pass}/${pass + fail} ناجح`);
if (fail) { console.log('الفاشل:\n- ' + failures.join('\n- ')); process.exit(1); }
