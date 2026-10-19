/* ===== Nile Systems — homepage logic ===== */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, esc } = window.NS;

  /* ---------- بيانات المنتجات ---------- */
  const SYSTEMS = [
    {
      id: 'courts', icon: '🎾', ready: false,
      ar: { n: 'حجز الملاعب والبادل', d: 'مواعيد متاحة، منع الحجز المزدوج، عربون ولوحة مستقلة للنادي.', f: ['موقع حجز متجاوب', 'لوحة مستقلة للملاعب', 'إدارة الأسعار والعربون'] },
      en: { n: 'Courts & Padel Booking', d: 'Available slots, double-booking prevention, deposits and a standalone club panel.', f: ['Responsive booking site', 'Standalone courts panel', 'Pricing & deposits'] },
    },
    {
      id: 'pos', icon: '🧾', ready: true, href: '/systems/pos.html',
      ar: { n: 'نظام الكاشير', d: 'بيع سريع بالباركود أو بالصور، ورديات وجرد الدرج، مرتجعات، وإيصال يتطبع.', f: ['بيع بالباركود', 'ورديات وفرق الدرج', 'مرتجعات وتقارير أرباح'] },
      en: { n: 'POS System', d: 'Fast selling by barcode or images, shifts and drawer counts, returns and printable receipts.', f: ['Barcode selling', 'Shifts & drawer diff', 'Returns & profit reports'] },
    },
    {
      id: 'inventory', icon: '📦', ready: false,
      ar: { n: 'المخازن والمشتريات', d: 'الأصناف في كل مخزن، الموردين وحساباتهم، فواتير الشراء، الجرد وحركة كل صنف.', f: ['أصناف ومخازن', 'موردون وحساباتهم', 'فواتير شراء وجرد'] },
      en: { n: 'Inventory & Purchases', d: 'Items per warehouse, suppliers and their accounts, purchase invoices, stock counts.', f: ['Items & warehouses', 'Suppliers & accounts', 'Purchases & stocktake'] },
    },
    {
      id: 'restaurant', icon: '🍽️', ready: false,
      ar: { n: 'إدارة المطعم', d: 'الصالة والترابيزات، شاشة المطبخ، الدليفري والتيك أواي، الحجوزات، وأوردرات الموقع.', f: ['خريطة الترابيزات', 'شاشة مطبخ لحظية', 'دليفري وحجوزات'] },
      en: { n: 'Restaurant Management', d: 'Floor and tables, kitchen screen, delivery and takeaway, reservations and website orders.', f: ['Floor & tables', 'Live kitchen screen', 'Delivery & reservations'] },
    },
    {
      id: 'clinic', icon: '🩺', ready: false,
      ar: { n: 'إدارة العيادة', d: 'جدول مواعيد لكل دكتور، ملف المريض، الكشف والروشتة المطبوعة، والحجز أونلاين.', f: ['مواعيد كل دكتور', 'ملف وتاريخ مرضي', 'روشتة مطبوعة'] },
      en: { n: 'Clinic Management', d: 'Per-doctor schedules, patient files, visits and printed prescriptions, online booking.', f: ['Doctor schedules', 'Patient history', 'Printed prescriptions'] },
    },
    {
      id: 'hr', icon: '👥', ready: false,
      ar: { n: 'الموارد البشرية والمرتبات', d: 'الموظفين، الحضور والانصراف بالتأخير والإضافي، الإجازات، السلف، والمرتبات وقسائمها.', f: ['حضور وانصراف', 'إجازات وأرصدة', 'سلف ومرتبات'] },
      en: { n: 'HR & Payroll', d: 'Employees, attendance with lateness and overtime, leaves, advances and payroll slips.', f: ['Attendance', 'Leaves & balances', 'Advances & payroll'] },
    },
    {
      id: 'admin', icon: '🗂️', ready: false,
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

  const WINDOWS = [
    { id: 'pos', icon: '🧾', ar: 'نظام الكاشير', en: 'POS System' },
    { id: 'inventory', icon: '📦', ar: 'المخازن والمشتريات', en: 'Inventory' },
    { id: 'restaurant', icon: '🍽️', ar: 'إدارة المطعم', en: 'Restaurant' },
    { id: 'clinic', icon: '🩺', ar: 'إدارة العيادة', en: 'Clinic' },
    { id: 'hr', icon: '👥', ar: 'الموارد البشرية والمرتبات', en: 'HR & Payroll' },
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
    $('#winGrid').innerHTML = WINDOWS.map((w) => {
      const d = w[L()];
      return `<div class="tile">
        <span class="badge badge-warn ribbon">${t('common.soon')}</span>
        <div class="icon">${w.icon}</div>
        <h3>${esc(d)}</h3>
        <p class="small muted">89 MB · Windows 10/11 · <span class="mono">3</span> ${L() === 'ar' ? 'أيام تجربة' : 'days trial'}</p>
        <div class="go"><button class="btn btn-ghost btn-sm" disabled>${t('common.soon')}</button></div>
      </div>`;
    }).join('');

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
    $('#footSites').innerHTML = SITES.map((s) => link(s[L()].n, '#sites')).join('');
    $('#footWin').innerHTML = WINDOWS.map((w) => link(w[L()], '#windows')).join('');

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
