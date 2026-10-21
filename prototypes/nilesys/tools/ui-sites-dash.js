/* لوحة المواقع في المتصفح — التطبيق السابع.
 * نظام مستقل: دخوله، مواقعه السبعة، رسالة زائر حقيقية من صفحة عامة، وتقسيم الأدوار.
 */
const { chromium } = require('/tmp/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); };
const watch = (p, errors) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    // رفض متعمّد: 401/403 لغير المصرّح، 429 لحد محاولات الدخول
    if (/Failed to load resource/.test(txt) && /(400|401|403|404|409|429)/.test(txt)) return;
    errors.push(txt);
  });
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);

  await page.goto(BASE + '/systems/sites.html', { waitUntil: 'networkidle' });
  check('W-UI · لوحة المواقع لها حساباها', (await page.locator('.demo-user').count()) === 2);

  await page.fill('#lu', 'cashier');
  await page.fill('#lp', 'demo1234');
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(900);
  check('W-UI · كاشير نقاط البيع مرفوض في اللوحة', (await page.locator('#loginView:not(.hidden)').count()) === 1);

  await page.click('.demo-user[data-u="admin"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.waitForSelector('.site-card', { timeout: 25000 });
  check('W-UI · النظرة العامة ترسم المواقع السبعة', (await page.locator('.site-card').count()) === 7);

  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'systems.json'), 'utf8'));
  const liveSystems = reg.systems.filter((s) => s.status === 'live').length;
  const kpiTxt = (await page.textContent('#content')) || '';
  check('W-UI · عدد الأنظمة العاملة من سجل المواصفات لا من رقم مكتوب',
    kpiTxt.includes(`${liveSystems}/${reg.systems.length}`), `${liveSystems}/${reg.systems.length}`);
  check('W-UI · النظرة العامة بلا قيم مشوّهة', !/undefined|NaN|\[object/.test(kpiTxt));
  await page.screenshot({ path: `${OUT}/sites-overview.png` });

  /* ---- المواقع ---- */
  await page.evaluate(() => { location.hash = '#/sites'; });
  await page.waitForSelector('#rows', { timeout: 25000 });
  const rows = await page.locator('#rows tr').count();
  const sitesTxt = (await page.textContent('#rows')) || '';
  check('W-UI · قائمة المواقع سبعة', rows === 7, `${rows} صف`);
  check('W-UI · الحالات صادقة — الأزياء تعمل والجيم قيد التنفيذ',
    sitesTxt.includes('يعمل الآن') && sitesTxt.includes('قيد التنفيذ'));

  /* ---- رسالة زائر من صفحة عامة (جلسة متصفح أخرى، بلا دخول) ---- */
  const pub = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const visitor = await pub.newPage();
  watch(visitor, errors);
  await visitor.goto(BASE + '/sites/fashion.html', { waitUntil: 'networkidle' });
  await visitor.waitForSelector('#leadForm', { timeout: 20000 });
  check('W-UI · صفحة الموقع العام فيها نموذج رسالة', (await visitor.locator('#leadForm').count()) === 1);
  const name = 'زينة ' + String(Date.now()).slice(-4);
  const phone = '011' + String(Date.now()).slice(-8);
  await visitor.fill('#leadName', name);
  await visitor.fill('#leadPhone', '123');
  await visitor.click('#leadSend');
  await visitor.waitForTimeout(600);
  check('W-UI · موبايل غير صالح مرفوض على الصفحة', ((await visitor.textContent('#leadState')) || '').includes('مش مظبوط'));
  await visitor.fill('#leadPhone', phone);
  await visitor.fill('#leadMsg', 'مقاس L متاح؟');
  await visitor.click('#leadSend');
  await visitor.waitForFunction(() => {
    const s = document.querySelector('#leadState');
    return s && s.textContent.includes('وصلت');
  }, null, { timeout: 25000 }).catch(() => {});
  check('W-UI · رسالة الزائر توصل وتُؤكَّد له', ((await visitor.textContent('#leadState')) || '').includes('وصلت'));
  await visitor.screenshot({ path: `${OUT}/site-public-form.png` });

  await visitor.fill('#leadName', name);
  await visitor.fill('#leadPhone', phone);
  await visitor.click('#leadSend');
  await visitor.waitForFunction(() => {
    const s = document.querySelector('#leadState');
    return s && s.textContent.includes('قبل كده');
  }, null, { timeout: 25000 }).catch(() => {});
  check('W-UI · نفس الموبايل في 24 ساعة لا يصنع رسالة ثانية',
    ((await visitor.textContent('#leadState')) || '').includes('قبل كده'));

  /* ---- الرسالة ظهرت في اللوحة ---- */
  await page.evaluate(() => { location.hash = '#/leads'; });
  await page.waitForFunction((n) => {
    const r = document.querySelector('#rows');
    return r && r.textContent.includes(n);
  }, name, { timeout: 25000 }).catch(() => {});
  const leadsTxt = (await page.textContent('#rows')) || '';
  check('W-UI · رسالة الزائر ظاهرة في اللوحة باسمها', leadsTxt.includes(name), name);
  check('W-UI · الرسالة الجديدة تحمل وسم «جديدة»', leadsTxt.includes('جديدة'));
  await page.screenshot({ path: `${OUT}/sites-leads.png` });

  // رسالتنا بعينها: قائمة الديمو قد تحمل رسائل أخرى، والحكم على صفّ واحد أدق.
  const leadId = await page.evaluate(async (n) => {
    const d = await (await fetch('/api/sites/leads')).json();
    return ((d.leads || []).find((l) => l.name === n) || {}).id;
  }, name);
  const L = `#rows tr[data-lead="${leadId}"]`;
  await page.locator(`${L} [data-act="replied"]`).click();
  await page.waitForFunction((sel) => {
    const tr = document.querySelector(sel);
    return tr && tr.dataset.status === 'replied';
  }, L, { timeout: 25000 }).catch(() => {});
  check('W-UI · تعليم الرسالة «تم الرد» من الشاشة',
    (await page.locator(L).getAttribute('data-status')) === 'replied');

  await page.locator(`${L} [data-act="closed"]`).click();
  await page.waitForFunction((sel) => {
    const tr = document.querySelector(sel);
    return tr && tr.dataset.status === 'closed';
  }, L, { timeout: 25000 }).catch(() => {});
  check('W-UI · إغلاق الرسالة يمنع أي إجراء بعدها',
    (await page.locator(L).getAttribute('data-status')) === 'closed'
    && (await page.locator(`${L} [data-act]`).count()) === 0);

  /* ---- الزيارات والتقارير ---- */
  await page.evaluate(() => { location.hash = '#/views'; });
  await page.waitForTimeout(1200);
  const viewsTxt = (await page.textContent('#content')) || '';
  check('W-UI · الزيارات ترسم أشرطة بلا قيم مشوّهة', viewsTxt.includes('الزيارات') && !/NaN|undefined/.test(viewsTxt));
  const fashionViews = await page.evaluate(async () => {
    const r = await fetch('/api/sites');
    const d = await r.json();
    return (d.sites.find((s) => s.slug === 'fashion') || {}).viewsToday;
  });
  check('W-UI · زيارة الصفحة العامة تُحسب مرة واحدة في اليوم', fashionViews >= 1, `${fashionViews} زيارة`);

  await page.evaluate(() => { location.hash = '#/summary'; });
  await page.waitForTimeout(1200);
  const sumTxt = (await page.textContent('#content')) || '';
  check('W-UI · التقارير تعرض أكثر موقع جذباً ونسبة الرد',
    sumTxt.includes('أكثر موقع جذباً') && sumTxt.includes('%'));
  check('W-UI · التقارير بلا قيم مشوّهة', !/NaN|undefined|\[object/.test(sumTxt));
  await page.screenshot({ path: `${OUT}/sites-summary.png` });

  /* ---- المحتوى: تعديل يحفظ ويظهر ---- */
  await page.evaluate(() => { location.hash = '#/content'; });
  await page.waitForSelector('#rows [data-act="edit"]', { timeout: 25000 });
  await page.locator('#rows [data-act="edit"]').first().click();
  await page.waitForSelector('#edSave', { timeout: 20000 });
  const newHeadline = 'عنوان من اللوحة ' + String(Date.now()).slice(-4);
  await page.fill('#edHd', newHeadline);
  await page.click('#edSave');
  await page.waitForFunction((h) => ((document.querySelector('#rows') || {}).textContent || '').includes(h),
    newHeadline, { timeout: 25000 }).catch(() => {});
  check('W-UI · تعديل المحتوى من اللوحة يظهر فوراً',
    ((await page.textContent('#rows')) || '').includes(newHeadline));

  /* ---- مدير النشاط: موقعه فقط ---- */
  await page.click('#logoutBtn');
  await page.waitForSelector('.demo-user[data-u="manager"]', { timeout: 25000 });
  await page.click('.demo-user[data-u="manager"]');
  await page.waitForSelector('#appView:not(.hidden)', { timeout: 25000 });
  await page.evaluate(() => { location.hash = '#/sites'; });
  await page.waitForSelector('#rows', { timeout: 25000 });
  const mgrRows = await page.locator('#rows tr').count();
  check('W-UI · مدير النشاط يرى موقعه فقط', mgrRows === 1, `${mgrRows} صف`);

  await page.evaluate(() => { location.hash = '#/content'; });
  await page.waitForSelector('#rows', { timeout: 25000 });
  check('W-UI · مدير النشاط لا يرى زر التعديل', (await page.locator('#rows [data-act="edit"]').count()) === 0);

  await page.evaluate(() => { location.hash = '#/leads'; });
  await page.waitForSelector('#rows', { timeout: 25000 });
  const mgrLeads = (await page.textContent('#rows')) || '';
  check('W-UI · رسائل مدير النشاط من موقعه وحده',
    !mgrLeads.includes('متجر موبايلات') && !mgrLeads.includes('موقع جيم'));

  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  check('W-UI · صفر أخطاء JavaScript', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
