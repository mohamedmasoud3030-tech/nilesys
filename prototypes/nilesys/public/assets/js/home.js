/* ===== Nile Systems — homepage logic ===== */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, esc } = window.NS;

  /* ---------- بيانات المنتجات ---------- */
  const SYSTEMS = [
    {
      id: 'courts', icon: '⚽', ready: true, href: '/systems/courts.html',
      ar: { n: 'حجز الملاعب والبادل', d: 'مواعيد متاحة، منع الحجز المزدوج، عربون ولوحة مستقلة للنادي.', f: ['موقع حجز متجاوب', 'لوحة مستقلة للملاعب', 'إدارة الأسعار والعربون'] },
      en: { n: 'Courts & Padel Booking', d: 'Available slots, double-booking prevention, deposits and a standalone club panel.', f: ['Responsive booking site', 'Standalone courts panel', 'Pricing & deposits'] },
    },
    {
      id: 'pos', icon: '🧾', ready: true, href: '/systems/pos.html',
      ar: { n: 'نظام الكاشير', d: 'بيع سريع بالباركود أو بالصور، ورديات وجرد الدرج، مرتجعات، وإيصال يتطبع.', f: ['بيع بالباركود', 'ورديات وفرق الدرج', 'مرتجعات وتقارير أرباح'] },
      en: { n: 'POS System', d: 'Fast selling by barcode or images, shifts and drawer counts, returns and printable receipts.', f: ['Barcode selling', 'Shifts & drawer diff', 'Returns & profit reports'] },
    },
    {
      id: 'inventory', icon: '📦', ready: true, href: '/systems/inventory.html',
      ar: { n: 'المخازن والمشتريات', d: 'الأصناف في كل مخزن، الموردين وحساباتهم، فواتير الشراء، الجرد وحركة كل صنف.', f: ['أصناف ومخازن', 'موردون وحساباتهم', 'فواتير شراء وجرد'] },
      en: { n: 'Inventory & Purchases', d: 'Items per warehouse, suppliers and their accounts, purchase invoices, stock counts.', f: ['Items & warehouses', 'Suppliers & accounts', 'Purchases & stocktake'] },
    },
    {
      id: 'restaurant', icon: '🍽️', ready: true, href: '/systems/restaurant.html',
      ar: { n: 'إدارة المطعم', d: 'الصالة والترابيزات، شاشة المطبخ، الدليفري والتيك أواي، الحجوزات، وأوردرات الموقع.', f: ['خريطة الترابيزات', 'شاشة مطبخ لحظية', 'دليفري وحجوزات'] },
      en: { n: 'Restaurant Management', d: 'Floor and tables, kitchen screen, delivery and takeaway, reservations and website orders.', f: ['Floor & tables', 'Live kitchen screen', 'Delivery & reservations'] },
    },
    {
      id: 'clinic', icon: '🩺', ready: true, href: '/systems/clinic.html',
      ar: { n: 'إدارة العيادة', d: 'جدول مواعيد لكل دكتور، ملف المريض، الكشف والروشتة المطبوعة، والحجز أونلاين.', f: ['مواعيد كل دكتور', 'ملف وتاريخ مرضي', 'روشتة مطبوعة'] },
      en: { n: 'Clinic Management', d: 'Per-doctor schedules, patient files, visits and printed prescriptions, online booking.', f: ['Doctor schedules', 'Patient history', 'Printed prescriptions'] },
    },
    {
      id: 'hr', icon: '👥', ready: true, href: '/systems/hr.html',
      ar: { n: 'الموارد البشرية والمرتبات', d: 'الموظفين، الحضور والانصراف بالتأخير والإضافي، الإجازات، السلف، والمرتبات وقسائمها.', f: ['حضور وانصراف', 'إجازات وأرصدة', 'سلف ومرتبات'] },
      en: { n: 'HR & Payroll', d: 'Employees, attendance with lateness and overtime, leaves, advances and payroll slips.', f: ['Attendance', 'Leaves & balances', 'Advances & payroll'] },
    },
    {
      id: 'admin', icon: '🗂️', ready: true, href: '/systems/sites.html',
      ar: { n: 'لوحة تحكم المواقع', d: 'المواقع بتتدار من هنا: الوحدات العقارية، اشتراكات الجيم، طلبات العملاء، وكلام كل موقع.', f: ['وحدات بالصور', 'اشتراكات وكلاسات', 'صندوق طلبات العملاء'] },
      en: { n: 'Websites Control Panel', d: 'Manage all sites from here: real-estate units, gym subscriptions, customer requests and site copy.', f: ['Units with photos', 'Plans & classes', 'Customer requests inbox'] },
    },
  ];

  const SITES = [
    {
      id: 'courts', icon: '🏟️',
      ar: { n: 'موقع حجز الملاعب', d: 'اختار الملعب والوقت واطلب الحجز، مع حساب السعر والعربون.' },
      en: { n: 'Courts Booking Site', d: 'Pick your court and time, request a booking with price and deposit.' },
    },
    {
      id: 'restaurant', icon: '🍢',
      ar: { n: 'موقع مطعم', d: 'منيو بالصور، طلب أونلاين ومتابعة الأوردر لحظة بلحظة، وحجز ترابيزة.' },
      en: { n: 'Restaurant Site', d: 'Photo menu, online ordering with live tracking, and table booking.' },
    },
    {
      id: 'clinic', icon: '🏥',
      ar: { n: 'موقع عيادة', d: 'الأطباء والتخصصات، وحجز ميعاد من المواعيد الفاضية فعلًا.' },
      en: { n: 'Clinic Site', d: 'Doctors and specialties, booking from actually available slots.' },
    },
    {
      id: 'realestate', icon: '🏢',
      ar: { n: 'موقع عقارات', d: 'بحث وفلترة، صفحة لكل وحدة بالصور والمميزات، وطلب معاينة.' },
      en: { n: 'Real Estate Site', d: 'Search and filters, a page per unit with photos and features, viewing requests.' },
    },
    {
      id: 'gym', icon: '🏋️',
      ar: { n: 'موقع جيم', d: 'الاشتراكات والأسعار، جدول الكلاسات، المدربين، وحصة تجربة مجانية.' },
      en: { n: 'Gym Site', d: 'Plans and pricing, class schedule, trainers, and a free trial session.' },
    },
    {
      id: 'mobile', icon: '📱',
      ar: { n: 'موقع محل موبايلات', d: 'موبايلات وإكسسوارات بالعروض، سلة وطلب أونلاين، تقسيط واستبدال وصيانة.' },
      en: { n: 'Mobile Shop Site', d: 'Phones and accessories with offers, cart and online orders, installments, trade-in and repairs.' },
    },
    {
      id: 'fashion', icon: '👗',
      ar: { n: 'موقع محل ملابس', d: 'لوك بوك تدوس على القطع فيه، مقاسات بالمخزون وحاسبة مقاس، ألوان بتغيّر الصورة، وشحن بالمحافظة.' },
      en: { n: 'Fashion Store Site', d: 'Shoppable lookbook, size stock and size calculator, color-changing images, and per-governorate shipping.' },
    },
  ];

  // البرامج الخمسة — كل بطاقة تفتح البرنامج نفسه، لا وعداً. ومعيار «7/7» مأخوذ
  // من docs/product/windows/<slug>.md ولا يُكتب هنا قبل أن يوجد اختبار يثبته.
  const WINDOWS = [
    { id: 'cashier', icon: '🧾', ar: 'نيل كاشير', en: 'Nile Cashier', ar2: 'بيع · إيصال 80mm · وردية ودرج', en2: 'Sell · 80mm receipt · shift & drawer', href: '/windows/cashier/', img: 'nile-cashier.png' },
    { id: 'stock', icon: '📦', ar: 'نيل مخازن', en: 'Nile Stock', ar2: 'جرد بسبب · استلام · ملصق باركود', en2: 'Count with reason · receive · barcode label', href: '/windows/stock/', img: 'nile-stock.png' },
    { id: 'kitchen', icon: '🍽️', ar: 'نيل مطعم', en: 'Nile Restaurant', ar2: 'ترابيزات · تذكرة مطبخ · تحصيل بعد التقديم', en2: 'Tables · kitchen ticket · pay after served', href: '/windows/kitchen/', img: 'nile-restaurant.png' },
    { id: 'attendance', icon: '🖐️', ar: 'نيل حضور', en: 'Nile Attendance', ar2: 'بصمة بالكود · ملخص شهري · CSV للمرتبات', en2: 'Code punch · monthly summary · payroll CSV', href: '/windows/attendance/', img: 'nile-attendance.png' },
    { id: 'reports', icon: '📈', ar: 'نيل تقارير', en: 'Nile Reports', ar2: 'مؤشرات من الأربعة · تقرير A4 · مصادر', en2: 'KPIs from the other four · A4 report · sources', href: '/windows/reports/', img: 'nile-reports.png' },
  ];

  const ACTIVITIES = [
    { ar: 'سوبر ماركت ومحلات', en: 'Supermarket & shops', sys: 'pos', site: null },
    { ar: 'مطعم وكافيه', en: 'Restaurant & cafe', sys: 'restaurant', site: 'restaurant' },
    { ar: 'عيادة', en: 'Clinic', sys: 'clinic', site: 'clinic' },
    { ar: 'محل موبايلات', en: 'Mobile shop', sys: 'pos', site: 'mobile' },
    { ar: 'محل ملابس', en: 'Fashion store', sys: 'pos', site: 'fashion' },
    { ar: 'جيم', en: 'Gym', sys: 'admin', site: 'gym' },
    { ar: 'عقارات', en: 'Real estate', sys: 'admin', site: 'realestate' },
    { ar: 'شركة أو مصنع', en: 'Company or factory', sys: 'hr', site: null },
  ];

  /* ---------- الرسم ---------- */
  const L = () => getLang();

  function tile(item, kind) {
    const d = item[L()];
    const ready = item.ready;
    const soon = `<span class="badge badge-warn ribbon">${t('common.soon')}</span>`;
    const btn = ready
      ? `<a class="btn btn-primary btn-sm" href="${item.href}">${t('common.demo')} →</a>`
      : `<button class="btn btn-ghost btn-sm" disabled>${t('common.soon')}</button>`;
    return `<div class="tile">
      ${ready ? '' : soon}
      <div class="icon">${item.icon}</div>
      <h3>${esc(d.n)}</h3>
      <p>${esc(d.d)}</p>
      ${kind === 'systems' && d.f ? `<div class="feats">${d.f.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="go">${btn}</div>
    </div>`;
  }

  function renderAll() {
    $('#systemsGrid').innerHTML = SYSTEMS.map((s) => tile(s, 'systems')).join('');
    $('#sitesGrid').innerHTML = SITES.map((s) => tile(s, 'sites')).join('');
    const AR = L() === 'ar';
    $('#winGrid').innerHTML = WINDOWS.map((w) => `
      <div class="tile">
        <span class="badge badge-ok ribbon">${AR ? 'يعمل الآن · 7/7 معيار' : 'Live · 7/7 criteria'}</span>
        <div class="icon">${w.icon}</div>
        <h3>${esc(AR ? w.ar : w.en)}</h3>
        <p class="small muted">${esc(AR ? w.ar2 : w.en2)}</p>
        <p class="small muted">${AR ? 'يشتغل بلا إنترنت ويحفظ على الجهاز · المتصفح' : 'Works offline, saves on the device · browser'}</p>
        <div class="go">
          <a class="btn btn-primary btn-sm" href="${w.href}">${AR ? 'شغّله' : 'Open'}</a>
          <a class="btn btn-ghost btn-sm" href="/docs/windows/${w.id}.html">${AR ? 'المواصفة' : 'Spec'}</a>
        </div>
      </div>`).join('');

    // شريط المقارنة
    $('#cmpOnline').textContent = L() === 'ar' ? 'أونلاين' : 'Online';
    $('#cmpWin').textContent = L() === 'ar' ? 'برنامج ويندوز' : 'Windows app';
    $('#cmpWinMobile').textContent = L() === 'ar' ? 'لما الجهاز يكون متصل' : 'When PC is online';
    $('#cmpWhereOnline').textContent = t('home.cmpWhereOnline');
    $('#cmpWhereWin').textContent = t('home.cmpWhereWin');
    $('#cmpPayOnline').textContent = t('home.cmpPayOnline');
    $('#cmpPayWin').textContent = t('home.cmpPayWin');

    // الفوتر
    const link = (label, href) => `<a href="${href}">${esc(label)}</a>`;
    $('#footSystems').innerHTML = SYSTEMS.map((s) => link(s[L()].n, s.ready ? s.href : '#systems')).join('');
    // F-17: الروابط تفتح صفحات المواقع الفعلية لا مرساة في نفس الصفحة.
    $('#footSites').innerHTML = SITES.map((s) => link(s[L()].n, `/sites/${s.id}.html`)).join('');
    $('#footWin').innerHTML = WINDOWS.map((w) => link(w[L()] || w.ar, w.href)).join('');

    renderChips();
    updateLangBtn();
  }

  let pickedActivity = null;
  function renderChips() {
    $('#activityChips').innerHTML = ACTIVITIES.map((a, i) =>
      `<button class="chip ${pickedActivity === i ? 'active' : ''}" data-act="${i}">${esc(a[L()])}</button>`).join('');
    $$('#activityChips .chip').forEach((c) => (c.onclick = () => {
      pickedActivity = Number(c.dataset.act);
      renderChips(); showSuggestion();
    }));
    if (pickedActivity !== null) showSuggestion();
  }

  function showSuggestion() {
    const a = ACTIVITIES[pickedActivity];
    const sys = SYSTEMS.find((s) => s.id === a.sys);
    const site = a.site ? SITES.find((s) => s.id === a.site) : null;
    $('#activityResult').innerHTML = `<div class="card card-pad row" style="gap:26px;flex-wrap:wrap">
      <div>
        <div class="small muted">${t('home.pickSystem')}</div>
        <div class="row mt-1"><span style="font-size:26px">${sys.icon}</span><b>${esc(sys[L()].n)}</b>
        ${sys.ready ? `<a class="btn btn-primary btn-sm" href="${sys.href}">${t('common.demo')} →</a>` : `<span class="badge badge-warn">${t('common.soon')}</span>`}</div>
      </div>
      ${site ? `<div>
        <div class="small muted">${t('home.pickSite')}</div>
        <div class="row mt-1"><span style="font-size:26px">${site.icon}</span><b>${esc(site[L()].n)}</b><span class="badge badge-warn">${t('common.soon')}</span></div>
      </div>` : ''}
    </div>`;
  }

  function updateLangBtn() {
    $('#langBtn').textContent = L() === 'ar' ? 'English' : 'عربي';
  }

  $('#langBtn').onclick = () => setLang(L() === 'ar' ? 'en' : 'ar');

  /* ---------- التشغيل ---------- */
  applyI18n();
  // جرب الهوية من API (لو متاحة)
  window.NS.api('/api/bootstrap').then((d) => window.NS.applyBranding(d.branding)).catch(() => {});
  renderAll();
  window.addEventListener('nile:lang', renderAll);
})();
