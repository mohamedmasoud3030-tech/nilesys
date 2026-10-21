/* شاشة المخازن في المتصفح — F-16.
 * نظام مستقل: دخوله، شاشته، وحركاته. لا يكفي أن تعمل الـ API. */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    // رفض متعمّد: 401/403 لغير المصرّح، و429 لحد محاولات الدخول
    if (/Failed to load resource/.test(txt) && /(401|403|409|400|404|429)/.test(txt)) return;
    errors.push(txt);
  });

  await page.goto(BASE + '/systems/inventory.html', { waitUntil: 'networkidle' });
  const users = await page.locator('.demo-user').count();
  check('F-16 · شاشة المخزن لها حسابها الخاص', users === 2, `${users} حسابات`);

  // كاشير الكاشير ما يدخلش المخزن
  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  const stillLogin = await page.locator('#loginView:not(.hidden)').count();
  check('F-16 · كاشير الكاشير مرفوض في نظام المخزن', stillLogin === 1);

  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(800);

  const kpis = await page.locator('.kpi .card').count();
  check('F-16 · لوحة المخزن تعرض مؤشراتها', kpis >= 4, `${kpis} مؤشر`);
  await page.screenshot({ path: `${OUT}/inventory-overview.png` });

  for (const v of ['items', 'low', 'moves', 'purchases']) {
    await page.goto(`${BASE}/systems/inventory.html#/${v}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const title = (await page.textContent('.view-title').catch(() => '')) || '';
    const body = (await page.textContent('#content').catch(() => '')) || '';
    const bad = /undefined|NaN|\[object/.test(body);
    check(`F-16 · شاشة ${v} ترسم بلا بيانات مشوّهة`, title.length > 0 && !bad, title);
    await page.screenshot({ path: `${OUT}/inventory-${v}.png` });
  }

  // تسوية من داخل الشاشة، والتأكد أن الكاشير يراها
  await page.goto(`${BASE}/systems/inventory.html#/items`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('[data-adj]').first().click();
  await page.waitForTimeout(400);
  await page.fill('#ajQty', '4');
  await page.fill('#ajWhy', 'جرد أسبوعي');
  await page.click('#ajOk');
  await page.waitForTimeout(900);
  const movesTxt = await (await page.request.get(BASE + '/api/stock/movements?limit=5')).json();
  const hit = movesTxt.movements.find((m) => m.note === 'جرد أسبوعي' || m.reason === 'adjust');
  check('F-16 · التسوية تُسجَّل بحركة وسبب', Boolean(hit), hit ? `${hit.kind} ${hit.qty} → ${hit.after}` : 'لا حركة');

  const pos = await (await page.request.post(BASE + '/api/login', { data: { system: 'pos', username: 'manager', password: 'demo1234' } })).status();
  check('F-16 · نظام نقاط البيع يعمل بعد وجود نظام المخزن', pos === 200);

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
