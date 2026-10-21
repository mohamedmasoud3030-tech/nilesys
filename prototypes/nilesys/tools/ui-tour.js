/* جولة على شاشات الديمو: تدخل، تفتح كل شاشة، تصوّرها، وتجمع أخطاء الكونسول.
 * الفكرة: «الشاشة بتفتح» لا تُثبت بالكود، بل بصورة وبكونسول نظيف. */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';
const fs = require('fs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE + '/systems/pos.html', { waitUntil: 'networkidle' });
  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(600);

  const views = ['sell', 'sales', 'shifts', 'reports', 'products', 'stock', 'customers',
    'suppliers', 'coupons', 'cash', 'users', 'settings', 'backup', 'alerts'];
  for (const v of views) {
    await page.goto(`${BASE}/systems/pos.html#/${v}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const title = await page.textContent('.view-title').catch(() => '(none)');
    const txt = (await page.textContent('#content').catch(() => '')) || '';
    const bad = /undefined|NaN|\[object Object\]/.test(txt);
    await page.screenshot({ path: `${OUT}/${v}.png`, fullPage: false });
    console.log(`${v.padEnd(10)} title="${title.trim()}" ${bad ? 'BAD-TEXT' : 'ok'}`);
  }

  // بيع كامل: ضيف صنف، ادفع كاش، شوف الإيصال
  await page.goto(`${BASE}/systems/pos.html#/sell`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const shiftBtn = page.locator('#openShiftBtn');
  if (await shiftBtn.count()) {
    await shiftBtn.click();
    await page.waitForTimeout(400);
    const ok = page.locator('.modal-f .btn-primary, #osOk, .modal-f .btn-success').first();
    if (await ok.count()) await ok.click();
    await page.waitForTimeout(600);
  }
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(300);
  await page.click('#checkoutBtn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/checkout.png` });
  await page.click('#cOk');
  await page.waitForTimeout(900);
  const receipt = await page.locator('#receipt').count();
  console.log('checkout → receipt shown:', receipt > 0);
  await page.screenshot({ path: `${OUT}/receipt.png` });

  console.log('\nconsole errors:', errors.length);
  errors.slice(0, 12).forEach((e) => console.log('  ' + e));
  await browser.close();
})();
