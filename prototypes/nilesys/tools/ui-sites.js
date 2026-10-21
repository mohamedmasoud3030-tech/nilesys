/* المواقع السبعة وصفحة برامج ويندوز — F-17.
 * ما نتحقق منه: الصفحة تُحمّل، تقول الحقيقة عن حالتها، تشتغل على الموبايل،
 * ولا تعتمد على أي ملف خارجي (تُفتح من أي مكان). */
const { chromium } = require('/tmp/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const SITES = ['mobile', 'fashion', 'restaurant', 'clinic', 'gym', 'courts', 'realestate'];
const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // موبايل أولاً
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  for (const slug of SITES) {
    const r = await page.goto(`${BASE}/sites/${slug}.html`, { waitUntil: 'networkidle' });
    const txt = (await page.textContent('body')) || '';
    // الحالة تُقرأ من الشارة نفسها لا من نص الصفحة: كلمة «يعمل الآن» قد ترد
    // داخل جملة تشرح ما لم يُبنَ بعد (حدث فعلاً مع صفحة الجيم).
    const badgeCls = await page.locator('.hero .b').first().getAttribute('class').catch(() => '');
    const hasStatus = Boolean(badgeCls);
    const live = /\blive\b/.test(badgeCls || '');
    const link = await page.locator('a.cta').getAttribute('href').catch(() => null);
    const okLink = live ? link === '/systems/pos.html' : !(await page.locator('a.cta').count());
    check(`F-17 · ${slug} · تُفتح وتعلن حالتها`, r.status() === 200 && hasStatus, live ? 'يعمل الآن' : 'قيد التنفيذ');
    check(`F-17 · ${slug} · لا زر يوهم بما ليس جاهزاً`, okLink || link === null);

    // لا موارد خارجية: الصفحة تعمل حتى لو النت مقطوع
    const external = await page.evaluate(() => [...document.querySelectorAll('link[href],script[src],img[src]')]
      .map((el) => el.getAttribute('href') || el.getAttribute('src'))
      .filter((u) => u && /^(https?:)?\/\//.test(u)));
    check(`F-17 · ${slug} · بلا موارد خارجية`, external.length === 0, external.join(','));

    // لا فيض أفقي على الموبايل
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`F-17 · ${slug} · لا فيض أفقي على الموبايل`, !overflow);
  }

  await page.goto(`${BASE}/sites/index.html`, { waitUntil: 'networkidle' });
  const cards = await page.locator('.grid a.card').count();
  check('F-17 · فهرس المواقع يعرض السبعة + برامج ويندوز', cards === 8, `${cards} بطاقة`);
  await page.screenshot({ path: `${OUT}/sites-index.png`, fullPage: true });

  await page.goto(`${BASE}/sites/windows.html`, { waitUntil: 'networkidle' });
  const winTxt = (await page.textContent('body')) || '';
  const planned = (winTxt.match(/قيد التخطيط/g) || []).length;
  const liveWin = (winTxt.match(/يعمل · 7\/7/g) || []).length;
  check('F-17 · خمسة برامج ويندوز معلنة «يعمل» بدليلها', liveWin >= 5 && planned === 0, `${liveWin} يعمل · ${planned} قيد التخطيط`);
  let winLinks = 0;
  for (const slug of ['cashier', 'stock', 'kitchen', 'attendance', 'reports']) {
    winLinks += await page.locator(`a[href="/windows/${slug}/"]`).count();
  }
  check('F-17 · صفحة ويندوز تفتح البرامج الخمسة نفسها', winLinks >= 5, `${winLinks} رابط`);
  check('F-17 · الصفحة تقول صراحة إن .exe لم يُبنَ', winTxt.includes('.exe'));
  await page.screenshot({ path: `${OUT}/sites-windows.png`, fullPage: true });

  // الصفحة الرئيسية تربط الأنظمة والمواقع الحقيقية — لا مراسي وهمية
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const footSites = await page.locator('#footSites a[href^="/sites/"]').count();
  const footInv = await page.locator('a[href="/systems/inventory.html"]').count();
  check('F-17 · الرئيسية تربط المواقع السبعة الحقيقية', footSites === 7, `${footSites} رابط`);
  check('F-16 · الرئيسية تربط نظام المخازن', footInv > 0, `${footInv} رابط`);

  // قسم برامج ويندوز في الرئيسية: خمس بطاقات حقيقية بروابط تعمل — لا «قريباً»
  const winCards = await page.locator('#winGrid .tile').count();
  let winCardLinks = 0;
  for (const slug of ['cashier', 'stock', 'kitchen', 'attendance', 'reports']) {
    winCardLinks += await page.locator(`#winGrid a[href="/windows/${slug}/"]`).count();
  }
  const winGridTxt = (await page.textContent('#winGrid')) || '';
  check('F-17 · الرئيسية: خمس بطاقات ويندوز بروابط تشغيل', winCards === 5 && winCardLinks === 5, `${winCards} بطاقة · ${winCardLinks} رابط`);
  check('F-17 · الرئيسية لا تعرض «قريباً» على برامج ويندوز', !winGridTxt.includes('قريباً') && !winGridTxt.includes('Soon'));

  // صفحة فرعية جاهزة تفتح النظام فعلاً
  await page.goto(`${BASE}/sites/mobile.html`, { waitUntil: 'networkidle' });
  await page.click('a.cta');
  await page.waitForURL(/pos\.html/, { timeout: 8000 }).catch(() => {});
  check('F-17 · الموقع الجاهز يفتح الكاشير فعلاً', page.url().includes('/systems/pos.html'));
  await page.screenshot({ path: `${OUT}/sites-mobile.png`, fullPage: true });

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})();
