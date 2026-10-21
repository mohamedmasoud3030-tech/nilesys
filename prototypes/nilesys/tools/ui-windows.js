/* برامج ويندوز الخمسة في المتصفح — كما يجرّبها البائع.
 *
 * كل برنامج يُشغَّل ويُقاس أثره: الفاتورة والمحتوى المطبوع نفسه (window.__lastPrint)،
 * التذكرة، الملصق (عدد أعمدة Code39)، الفرق في الجرد، البصمة، ومؤشرات التقارير.
 * ويُجرَّب الانقطاع فعلاً: ctx.setOffline(true) ثم شغل كامل ثم مزامنة بعد الرجوع.
 *
 *   sh tools/setup-browser.sh tools/ui-windows.js
 */
const { chromium } = require('/tmp/node_modules/playwright');

const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
const check = (n, ok, extra = '') => {
  results.push({ n, ok });
  console.log(`${ok ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
};
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t) && /(400|401|403|404|409|429)/.test(t)) return;
    if (/ERR_INTERNET_DISCONNECTED|net::/.test(t)) return; // انقطاع متعمّد
    errors.push(t);
  });
};
const lastPrint = (page) => page.evaluate(() => window.__lastPrint || '');
const toastText = async (page) => ((await page.locator('.desk-toast-item').last().textContent().catch(() => '')) || '');
const store = (page, slug) => page.evaluate((k) => JSON.parse(localStorage.getItem(`nile.os.${k}.v1`) || 'null'), slug);
const waitPrint = async (page, needle, ms = 15000) => {
  await page.waitForFunction((n) => (window.__lastPrint || '').includes(n), needle, { timeout: ms }).catch(() => {});
  return lastPrint(page);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  watch(page);

  /* ================= فهرس البرامج ================= */
  await page.goto(BASE + '/windows/', { waitUntil: 'networkidle' });
  check('WIN · الصفحة تعرض البرامج الخمسة', (await page.locator('.prog-card').count()) === 5);
  let links = 0;
  for (const slug of ['cashier', 'stock', 'kitchen', 'attendance', 'reports']) {
    links += await page.locator(`.prog-card a[href="/windows/${slug}/"]`).count();
  }
  check('WIN · كل برنامج له رابط تشغيل', links === 5, `${links}/5`);
  const specLinks = await page.locator('.prog-card a[href^="/docs/windows/"]').count();
  check('WIN · كل برنامج له صفحة مواصفة', specLinks === 5, `${specLinks}/5`);

  // المواصفة نفسها تفتح (لا 404) وتعلن معاييرها
  const specResp = await page.goto(BASE + '/docs/windows/cashier.html', { waitUntil: 'networkidle' });
  check('WIN · صفحة المواصفة موجودة وتُقرأ', specResp.status() === 200 && (await page.textContent('body')).includes('كاشير'));

  /* ================= 1) نيل كاشير ================= */
  await page.goto(BASE + '/windows/cashier/', { waitUntil: 'networkidle' });
  await page.click('.desk-nav[data-view="shift"]');
  await page.waitForSelector('#openShift', { timeout: 20000 });
  await page.fill('#opening', '500');
  await page.click('#openShift');
  await page.waitForSelector('#closeShift', { timeout: 20000 });
  check('W-CASH · وردية فتحت بدرج 500', true);

  await page.click('.desk-nav[data-view="sell"]');
  await page.waitForSelector('#tiles [data-add]', { timeout: 20000 });
  await page.locator('#tiles [data-add]').first().click();
  await page.locator('#tiles [data-add]').first().click();
  await page.waitForSelector('#cart .cart-line', { timeout: 15000 });
  check('W-CASH · السلة تحسب الإجمالي', /ج\.م/.test(await page.textContent('#totals')));
  await page.screenshot({ path: `${OUT}/win-cashier-sell.png` });

  await page.click('#pay');
  await page.waitForSelector('#okPay', { timeout: 15000 });
  await page.fill('#paid', '1');
  check('W-CASH · مدفوع أقل من المطلوب يقفل التحصيل', await page.locator('#okPay').isDisabled());
  await page.fill('#paid', '5000');
  await page.waitForTimeout(150);
  await page.click('#okPay');
  await page.waitForFunction(() => !document.querySelector('#cart .cart-line'), null, { timeout: 20000 });
  const receipt = await waitPrint(page, 'فاتورة #');
  check('W-CASH · إيصال 80mm فيه بنود وإجمالي وباقي',
    receipt.includes('الإجمالي') && receipt.includes('الباقي') && receipt.includes('فاتورة #'));
  const afterSale = await store(page, 'cashier');
  check('W-CASH · الفاتورة اتحفظت على الجهاز ومخزونها نقص',
    afterSale.sales.length === 1 && afterSale.products.find((p) => p.id === afterSale.sales[0].items[0].productId).stock < 40);

  /* --- الانقطاع: بيع كامل والشبكة مطفية --- */
  await ctx.setOffline(true);
  await page.locator('#tiles [data-add]').nth(1).click();
  await page.click('#pay');
  await page.waitForSelector('#okPay', { timeout: 15000 });
  await page.fill('#paid', '9999');
  await page.click('#okPay');
  await page.waitForFunction(() => !document.querySelector('#cart .cart-line'), null, { timeout: 20000 });
  const offlineReceipt = await waitPrint(page, 'فاتورة #');
  const offlineDoc = await store(page, 'cashier');
  check('W-CASH · بيع كامل والشبكة مقطوعة', offlineReceipt.includes('فاتورة #') && offlineDoc.sales.length === 2);
  check('W-CASH · العمليتان محفوظتان في طابور المزامنة', offlineDoc.pending.length >= 2, `${offlineDoc.pending.length} في الانتظار`);
  check('W-CASH · شريط الحالة يقول بلا شبكة', ((await page.textContent('#statusBar')) || '').includes('بلا شبكة'));

  await page.click('.desk-nav[data-view="sync"]');
  await page.waitForSelector('#syncNow', { timeout: 15000 });
  await ctx.setOffline(false);
  await page.waitForTimeout(300);
  await page.click('#syncNow');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('nile.os.cashier.v1')).pending.length === 0, null, { timeout: 25000 })
    .catch(() => {});
  check('W-CASH · المزامنة فرّغت الطابور بعد رجوع الشبكة',
    (await store(page, 'cashier')).pending.length === 0);

  await page.click('.desk-nav[data-view="invoices"]');
  await page.waitForSelector('#rows tr', { timeout: 15000 });
  check('W-CASH · الفاتورتان في قائمة الفواتير', (await page.locator('#rows tr').count()) === 2);

  await page.click('.desk-nav[data-view="shift"]');
  await page.waitForSelector('#closeShift', { timeout: 15000 });
  await page.fill('#counted', '500');
  await page.click('#closeShift');
  await page.waitForTimeout(500);
  const shiftDoc = await store(page, 'cashier');
  const closed = shiftDoc.shifts.find((s) => s.closedAt) || {};
  const cashInShift = shiftDoc.sales
    .filter((s) => s.shiftId === closed.id && s.method === 'cash')
    .reduce((a, s) => a + s.total, 0);
  const expectInDrawer = Math.round((500 + cashInShift) * 100) / 100;
  check('W-CASH · إغلاق الوردية حسب الفرق بين المتوقع والمعدود',
    closed.expected === expectInDrawer
    && closed.difference === Math.round((500 - expectInDrawer) * 100) / 100
    && closed.difference < 0,
    `متوقع ${closed.expected} · معدود 500 · فرق ${closed.difference}`);

  /* ================= 2) نيل مخازن ================= */
  await page.goto(BASE + '/windows/stock/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#rows tr', { timeout: 20000 });
  const seedItems = (await store(page, 'stock')).items.length;

  await page.click('#newItem');
  await page.waitForSelector('#niSave', { timeout: 15000 });
  const dupCode = (await store(page, 'stock')).items[0].code;
  await page.fill('#niName', 'صنف واجهة');
  await page.fill('#niCode', dupCode);
  await page.click('#niSave');
  await page.waitForTimeout(400);
  check('W-STOCK · كود مكرر مرفوض برسالة', (await toastText(page)).includes('مستخدم'), dupCode);
  check('W-STOCK · الصنف المرفوض ما اتضافش', (await store(page, 'stock')).items.length === seedItems);
  await page.fill('#niCode', 'SKU-T' + String(Date.now()).slice(-4));
  await page.click('#niSave');
  await page.waitForTimeout(600);
  check('W-STOCK · صنف جديد اتضاف', (await store(page, 'stock')).items.length === seedItems + 1);
  check('W-STOCK · إضافة الصنف دخلت الطابور', (await store(page, 'stock')).pending.some((o) => o.type === 'item.new'));

  await page.locator('#rows [data-label]').first().click();
  const label = await waitPrint(page, 'svg');
  const bars = (label.match(/<rect /g) || []).length;
  check('W-STOCK · ملصق Code39 حقيقي (أعمدة محسوبة من الجدول)', bars > 20, `${bars} عمود`);

  await page.click('.desk-nav[data-view="count"]');
  await page.waitForSelector('#rows tr', { timeout: 15000 });
  const first = page.locator('#rows [data-count]').first();
  const itemId = await first.getAttribute('data-count');
  const qty0 = await page.evaluate((id) => JSON.parse(localStorage.getItem('nile.os.stock.v1')).items.find((i) => i.id === id).qty, itemId);
  await first.fill(String(qty0 - 2));
  await page.waitForTimeout(200);
  await page.click('#saveCount');
  await page.waitForTimeout(400);
  check('W-STOCK · جرد بفرق بلا سبب مرفوض', (await toastText(page)).includes('سبب'));
  check('W-STOCK · الرصيد ما اتغيّرش بعد الرفض',
    (await page.evaluate((id) => JSON.parse(localStorage.getItem('nile.os.stock.v1')).items.find((i) => i.id === id).qty, itemId)) === qty0);

  await page.fill(`[data-reason="${itemId}"]`, 'كسر في المخزن');
  await page.click('#saveCount');
  await page.waitForTimeout(700);
  const afterCount = await store(page, 'stock');
  check('W-STOCK · جرد بسبب يعدّل الرصيد ويكتب حركة',
    afterCount.items.find((i) => i.id === itemId).qty === qty0 - 2
    && afterCount.moves.some((m) => m.type === 'count' && m.itemId === itemId),
    `${afterCount.moves.length} حركة`);
  await page.screenshot({ path: `${OUT}/win-stock-count.png` });

  await page.click('.desk-nav[data-view="receive"]');
  await page.waitForSelector('#content .tbl, #content .card', { timeout: 15000 });
  check('W-STOCK · شاشة الاستلام تفتح', ((await page.textContent('#title')) || '').includes('استلام'));

  /* ================= 3) نيل مطعم ================= */
  await page.goto(BASE + '/windows/kitchen/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tiles [data-table]', { timeout: 20000 });
  await page.locator('#tiles [data-table]').first().click();
  await page.waitForSelector('#menu [data-menu]', { timeout: 15000 });
  await page.locator('#menu [data-menu]').first().click();
  await page.locator('#menu [data-menu]').nth(2).click();
  check('W-KIT · التحصيل مقفول قبل الإرسال للمطبخ', await page.locator('#payBtn').isDisabled());

  await page.click('#sendBtn');
  const ticket = await waitPrint(page, 'تذكرة مطبخ');
  check('W-KIT · تذكرة 80mm فيها الترابيزة ورقم الطلب والأصناف',
    ticket.includes('تذكرة مطبخ') && ticket.includes('طلب #') && ticket.includes('ترابيزة'));
  check('W-KIT · الشاشة تقول الطلب اتبعت', ((await page.textContent('#sub')) || '').includes('اتبعت'));
  check('W-KIT · التحصيل يفضل مقفول والأصناف لسه ما اتقدمتش', await page.locator('#payBtn').isDisabled());

  await page.click('.desk-nav[data-view="orders"]');
  await page.waitForSelector('[data-reprint]', { timeout: 15000 });
  check('W-KIT · الطلب المفتوح ظاهر في الطلبات', ((await page.textContent('#content')) || '').includes('مفتوح'));
  await page.locator('[data-reprint]').first().click();
  await page.waitForTimeout(600);
  const kit1 = await store(page, 'kitchen');
  check('W-KIT · إعادة الطبع مسجّلة على التذكرة نفسها', kit1.orders[0].ticketPrints === 2, `${kit1.orders[0].ticketPrints} طبعة`);
  check('W-KIT · إعادة الطبع دخلت الطابور كحركة', kit1.pending.some((o) => o.type === 'ticket.reprint'));

  await page.click('.desk-nav[data-view="kitchen"]');
  await page.waitForSelector('.ticket', { timeout: 15000 });
  check('W-KIT · شاشة المطبخ شايفة التذكرة', (await page.locator('.ticket').count()) === 1);
  for (let i = 0; i < 12; i += 1) {
    if (await page.locator('[data-cook]').count()) await page.locator('[data-cook]').first().click();
    else if (await page.locator('[data-ready]').count()) await page.locator('[data-ready]').first().click();
    else if (await page.locator('[data-served]').count()) await page.locator('[data-served]').first().click();
    else break;
    await page.waitForTimeout(220);
  }
  const kit2 = await store(page, 'kitchen');
  check('W-KIT · كل الأصناف وصلت «قدّمني» والمطبخ فضل فاضي',
    kit2.orders[0].items.every((i) => i.state === 'served') && (await page.locator('.ticket').count()) === 0);
  check('W-KIT · كل خطوة مطبخ دخلت الطابور', kit2.pending.filter((o) => o.type.startsWith('item.')).length >= 6);

  await page.click('.desk-nav[data-view="floor"]');
  await page.waitForSelector('#tiles [data-table]', { timeout: 15000 });
  await page.locator('#tiles [data-table]').first().click();
  await page.waitForSelector('#payBtn', { timeout: 15000 });
  const payOpen = !(await page.locator('#payBtn').isDisabled());
  check('W-KIT · التحصيل يفتح بعد تقديم كل الأصناف', payOpen);
  await page.click('#payBtn');
  await page.waitForSelector('#pok', { timeout: 15000 });
  await page.click('#pok');
  await page.waitForTimeout(700);
  await page.click('.desk-nav[data-view="orders"]');
  await page.waitForSelector('.tbl', { timeout: 15000 });
  const kit3 = await store(page, 'kitchen');
  check('W-KIT · الطلب اتحصّل وظهر «مدفوع»',
    kit3.orders[0].status === 'paid' && ((await page.textContent('#content')) || '').includes('مدفوع'));
  await page.screenshot({ path: `${OUT}/win-kitchen.png` });

  /* ================= 4) نيل حضور ================= */
  await page.goto(BASE + '/windows/attendance/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#punch', { timeout: 20000 });
  await page.fill('#code', '9999');
  await page.click('#punch');
  await page.waitForTimeout(350);
  check('W-ATT · كود غير معروف مرفوض', (await toastText(page)).includes('غير معروف')
    && (await store(page, 'attendance')).punches.length === 0);

  await page.fill('#code', '1002');
  await page.click('#punch');
  await page.waitForTimeout(500);
  let att = await store(page, 'attendance');
  check('W-ATT · أول بصمة في اليوم = دخول', att.punches.length === 1 && att.punches[0].kind === 'in');

  await page.click('.desk-nav[data-view="today"]');
  await page.waitForSelector('.tbl', { timeout: 15000 });
  const todayTxt = (await page.textContent('#content')) || '';
  check('W-ATT · سجل اليوم يبيّن حاضر وبلا انصراف', todayTxt.includes('حاضر') && todayTxt.includes('ناقص'));

  await page.click('.desk-nav[data-view="punch"]');
  await page.waitForSelector('#punch', { timeout: 15000 });
  await page.fill('#code', '1002');
  await page.click('#punch');
  await page.waitForTimeout(500);
  att = await store(page, 'attendance');
  check('W-ATT · الضغطة التانية = خروج', att.punches.length === 2 && att.punches[1].kind === 'out');

  await page.fill('#code', '1002');
  await page.click('#punch');
  await page.waitForTimeout(400);
  check('W-ATT · البصمة الثالثة في نفس اليوم مرفوضة', (await store(page, 'attendance')).punches.length === 2);

  await page.click('.desk-nav[data-view="today"]');
  await page.waitForSelector('.tbl', { timeout: 15000 });
  check('W-ATT · الحالة اتغيّرت إلى «انصرف»', ((await page.textContent('#content')) || '').includes('انصرف'));

  await page.click('.desk-nav[data-view="month"]');
  await page.waitForSelector('#exportCsv', { timeout: 15000 });
  const monthRows = await page.locator('#content tbody tr').count();
  const perEmp = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#content tbody tr'));
    return rows.map((r) => Array.from(r.children).map((c) => c.textContent.trim()));
  });
  const e2 = perEmp.find((r) => r.join(' ').includes('محمود عزت')) || [];
  check('W-ATT · الملخص الشهري صف لكل موظف', monthRows === 5, `${monthRows} صف`);
  check('W-ATT · يوم الحضور والساعات محسوبان', e2[1] === '1', `أيام: ${e2[1]}`);
  await page.click('#printReport');
  const monthPrint = await waitPrint(page, 'ملخص حضور');
  check('W-ATT · ملخص A4 فيه توقيعان ولا NaN',
    monthPrint.includes('توقيع المدير') && monthPrint.includes('توقيع الموارد') && !/NaN|undefined/.test(monthPrint));
  await page.screenshot({ path: `${OUT}/win-attendance.png` });

  /* ================= 5) نيل تقارير ================= */
  await page.goto(BASE + '/windows/reports/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpis', { timeout: 20000 });
  const cashierDoc = await store(page, 'cashier');
  const salesTotal = cashierDoc.sales.reduce((a, s) => a + s.total, 0);
  const dashTxt = (await page.textContent('#content')) || '';
  check('W-REP · المؤشرات تقرأ مبيعات الكاشير من نفس الجهاز',
    salesTotal > 0 && dashTxt.includes('إجمالي المبيعات'), `إجمالي ${salesTotal}`);
  check('W-REP · الحضور والمخزون ظاهران في اللوحة',
    dashTxt.includes('قيمة المخزون') && dashTxt.includes('حضور اليوم'));

  await page.click('.desk-nav[data-view="sources"]');
  await page.waitForSelector('.tbl', { timeout: 15000 });
  const srcTxt = (await page.textContent('#content')) || '';
  check('W-REP · البرامج الأربعة موصولة', (srcTxt.match(/موصول/g) || []).length >= 4);
  await page.click('#ping');
  await page.waitForTimeout(1200);
  const srvTxt = (await page.textContent('#srvState')) || '';
  check('W-REP · ملخص الخادم يُقرأ (عمليات مستلمة)', srvTxt.includes('عملية مستلمة'), srvTxt.replace(/\s+/g, ' ').slice(0, 40));

  await page.click('.desk-nav[data-view="report"]');
  await page.waitForSelector('#print', { timeout: 15000 });
  await page.click('#print');
  const rep = await waitPrint(page, 'تقرير يوم');
  check('W-REP · تقرير A4 فيه بنود وتوقيعان ومصدر',
    rep.includes('تقرير يوم') && rep.includes('توقيع المدير') && rep.includes('المصدر'));
  check('W-REP · التقرير بلا NaN أو undefined', !/NaN|undefined/.test(rep));
  await page.screenshot({ path: `${OUT}/win-reports.png` });

  /* ================= الحصيلة ================= */
  console.log('\nأخطاء الصفحة:', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  ' + e));
  check('WIN · صفر أخطاء JavaScript في الخمسة', errors.length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
