/* شاشة المطعم في المتصفح.
 * نظام مستقل: دخوله، شاشته، وحركته الحقيقية (ترابيزة → مطبخ → حساب).
 * لا يكفي أن تنجح الـ API — لازم الشاشة نفسها تعمل.
 */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 401 المتعمّد (محاولة دخول كاشير نقاط البيع) يسجّله المتصفح كخطأ شبكة — ليس عطلاً.
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(txt) && /401/.test(txt)) return;
    errors.push(txt);
  });

  await page.goto(BASE + '/systems/restaurant.html', { waitUntil: 'networkidle' });
  const users = await page.locator('.demo-user').count();
  check('R-UI · شاشة المطعم لها حساباتها الثلاثة', users === 3, `${users} حسابات`);

  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('R-UI · كاشير نقاط البيع مرفوض في المطعم', (await page.locator('#loginView:not(.hidden)').count()) === 1);

  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 15000 });
  await page.waitForSelector('#floor .tcard', { timeout: 15000 });

  const tables = await page.locator('#floor .tcard').count();
  check('R-UI · الصالة ترسم ترابيزاتها', tables >= 6, `${tables} ترابيزة`);
  await page.screenshot({ path: `${OUT}/restaurant-floor.png` });

  // وردية مفتوحة قبل أي تحصيل نقدي
  await page.goto(`${BASE}/systems/restaurant.html#/shift`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (await page.locator('#openShift').count()) {
    await page.fill('#opening', '300');
    await page.click('#openShift');
    await page.waitForTimeout(900);
  }
  check('R-UI · شاشة الوردية تعرض درجاً مفتوحاً', (await page.locator('#closeShift').count()) === 1);

  // ترابيزة فاضية → طلب
  await page.goto(`${BASE}/systems/restaurant.html#/floor`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#floor .tcard', { timeout: 15000 });
  let free = page.locator('#floor .tcard[data-status="free"]').first();
  if (!(await free.count())) {
    const dirty = page.locator('#floor .tcard[data-status="dirty"]').first();
    if (await dirty.count()) { await dirty.click(); await page.waitForTimeout(900); }
    await page.goto(`${BASE}/systems/restaurant.html#/floor`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#floor .tcard', { timeout: 15000 });
    free = page.locator('#floor .tcard[data-status="free"]').first();
  }
  const tableId = await free.getAttribute('data-table');
  await free.click();
  await page.waitForSelector('#menuGrid .menu-item', { timeout: 15000 });

  await page.locator('#menuGrid .menu-item:not([disabled])').first().click();
  await page.waitForSelector('#lines .line', { timeout: 15000 });
  const lines1 = await page.locator('#lines .line').count();
  check('R-UI · إضافة صنف تفتح طلباً وتظهر سطراً', lines1 === 1);

  const payDisabled = await page.locator('#payBtn').isDisabled();
  check('R-UI · زر التحصيل مقفول قبل إرسال المطبخ', payDisabled);
  await page.screenshot({ path: `${OUT}/restaurant-order.png` });

  await page.click('#sendBtn');
  await page.waitForTimeout(1200);
  const sentTxt = (await page.textContent('#lines')).includes('اتبعت');
  check('R-UI · الإرسال يعلّم السطر «اتبعت»', sentTxt);
  check('R-UI · زر التحصيل يفتح بعد الإرسال', !(await page.locator('#payBtn').isDisabled()));

  // المطبخ يستلم التذكرة ويحرّكها
  await page.goto(`${BASE}/systems/restaurant.html#/kitchen`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const tickets = await page.locator('#board [data-ticket]').count();
  check('R-UI · المطبخ يستقبل تذكرة', tickets >= 1, `${tickets} تذكرة`);
  await page.screenshot({ path: `${OUT}/restaurant-kitchen.png` });

  await page.locator('#board [data-cook]').first().click();
  await page.waitForSelector('#board [data-ready]', { timeout: 10000 }).catch(() => {});
  check('R-UI · الصنف يبدأ التحضير من الشاشة', (await page.locator('#board [data-ready]').count()) === 1);
  await page.locator('#board [data-ready]').first().click();
  await page.waitForSelector('#board [data-served]', { timeout: 10000 }).catch(() => {});
  check('R-UI · الصنف يتحوّل «جاهز» ثم «قدّمني»', (await page.locator('#board [data-served]').count()) === 1);
  await page.locator('#board [data-served]').first().click();
  await page.waitForTimeout(1200);
  check('R-UI · التقديم يخرج التذكرة من شاشة المطبخ', (await page.locator('#board [data-ticket]').count()) === 0);
  await page.screenshot({ path: `${OUT}/restaurant-kitchen-empty.png` });

  // تحصيل
  await page.goto(`${BASE}/systems/restaurant.html#/floor`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#floor .tcard', { timeout: 15000 });
  await page.locator(`#floor .tcard[data-table="${tableId}"]`).click();
  await page.waitForSelector('#payBtn', { timeout: 15000 });
  await page.click('#payBtn');
  await page.waitForSelector('#payGo', { timeout: 10000 });
  await page.click('#payGo');
  await page.waitForTimeout(1400);
  const paidBadge = await page.locator('.cart .badge').first().textContent().catch(() => '');
  check('R-UI · الحساب يتقفل بعد التحصيل', /مدفوع/.test(paidBadge || ''), paidBadge);

  await page.goto(`${BASE}/systems/restaurant.html#/floor`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#floor .tcard', { timeout: 15000 });
  const st = await page.locator(`#floor .tcard[data-table="${tableId}"]`).getAttribute('data-status');
  check('R-UI · الترابيزة تتحول «للتنضيف» بعد الدفع', st === 'dirty', st);
  await page.locator(`#floor .tcard[data-table="${tableId}"]`).click();
  await page.waitForTimeout(1000);
  const st2 = await page.locator(`#floor .tcard[data-table="${tableId}"]`).getAttribute('data-status');
  check('R-UI · ضغطة التنضيف ترجّعها «فاضية»', st2 === 'free', st2);
  await page.screenshot({ path: `${OUT}/restaurant-floor-after.png` });

  // حجوزات
  await page.goto(`${BASE}/systems/restaurant.html#/reservations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#newRes');
  await page.waitForSelector('#rName', { timeout: 10000 });
  await page.fill('#rName', 'مها عبد الرحمن');
  await page.fill('#rPhone', '01001234567');
  await page.click('#rSave');
  await page.waitForTimeout(1200);
  const resTxt = (await page.textContent('#rows').catch(() => '')) || '';
  check('R-UI · الحجز الجديد يظهر في الجدول', resTxt.includes('مها عبد الرحمن'));

  // ملخص
  await page.goto(`${BASE}/systems/restaurant.html#/summary`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const sumBody = (await page.textContent('#content').catch(() => '')) || '';
  check('R-UI · ملخص اليوم يرسم بلا بيانات مشوّهة', !/undefined|NaN|\[object/.test(sumBody), sumBody.slice(0, 40).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${OUT}/restaurant-summary.png` });

  // فصل الأنظمة: مدير المطعم لا يفتح نقاط البيع
  const posStatus = await (await page.request.post(BASE + '/api/login', { data: { system: 'pos', username: 'waiter', password: 'demo1234' } })).status();
  check('R-UI · حساب المطعم لا يعمل على نظام آخر', posStatus === 401 || posStatus === 403, String(posStatus));

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  check('R-UI · صفر أخطاء JavaScript', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
