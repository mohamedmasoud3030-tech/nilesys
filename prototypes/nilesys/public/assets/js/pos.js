/* ===== Nile Systems — POS system logic ===== */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, ago, esc, applyBranding } = window.NS;
  const SYSTEM = 'pos';

  const state = {
    user: null, branding: null, products: [], cart: [],
    openShift: null, cat: 'all', q: '', reportRange: 'today', view: 'sell',
    settings: { taxRate: 0 }, customers: [], coupon: null,
  };

  init();

  /* ================= boot ================= */
  async function init() {
    applyI18n();
    bindChrome();
    try {
      const { user } = await api('/api/session');
      if (user && user.system === SYSTEM) { state.user = user; await enterApp(); return; }
    } catch { /* ignore */ }
    showLogin();
  }

  function bindChrome() {
    ['#langBtn2', '#langBtn3'].forEach((sel) => { const b = $(sel); if (b) b.onclick = () => setLang(getLang() === 'ar' ? 'en' : 'ar'); });
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $('#logoutBtn').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* */ } location.reload(); };
    window.addEventListener('hashchange', route);
    window.addEventListener('nile:lang', () => { applyI18n(); if (state.user) { renderUser(); renderCurrent(); } });
    window.addEventListener('resize', checkMobile);
    // F-11: رجوع الشبكة يفرّغ الطابور من نفسه؛ ولا ننتظر ضغطة.
    window.addEventListener('online', () => { paintOfflineBar(); flushQueue(); });
    window.addEventListener('offline', () => paintOfflineBar());
    setInterval(() => { if (isOnline() && readQueue().length) flushQueue(); }, 20000);
    paintOfflineBar();
    checkMobile();
    bindShortcuts();
  }

  // اختصارات: الكاشير بيفضل إيده على الكيبورد. F2 بحث · F4 دفع · F9 تعليق · Esc إغلاق
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!state.user) return;
      if (e.key === 'Escape') { const back = document.querySelector('.modal-back'); if (back) back._close(); return; }
      if (e.key === 'F2') { e.preventDefault(); state.view = 'sell'; location.hash = '#/sell'; const b = $('#searchBox'); if (b) { b.focus(); b.select(); } }
      else if (e.key === 'F4') { e.preventDefault(); if (state.view === 'sell' && state.cart.length) checkout(); }
      else if (e.key === 'F9') { e.preventDefault(); if (state.view === 'sell' && state.cart.length) holdCart(); }
    });
  }
  function checkMobile() { $('#menuBtn').style.display = window.innerWidth <= 900 ? '' : 'none'; }

  /* ================= login ================= */
  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'أحمد سامي', role: t('common.manager') },
      { username: 'cashier', name: 'منى عادل', role: t('common.cashier') },
    ];
    $('#demoUsers').innerHTML = users.map((u) => `
      <button class="demo-user" data-u="${u.username}">
        <span class="avatar">${esc(u.name.slice(0, 1))}</span>
        <span><span class="nm">${esc(u.name)}</span><br><span class="rl mono">${esc(u.username)}</span> · <span class="rl">${esc(u.role)}</span></span>
        <span style="margin-inline-start:auto" class="badge badge-brand">→</span>
      </button>`).join('');
    $$('#demoUsers .demo-user').forEach((b) => (b.onclick = () => {
      $('#lu').value = b.dataset.u; $('#lp').value = 'demo1234'; doLogin();
    }));
    $('#loginForm').onsubmit = (e) => { e.preventDefault(); doLogin(); };
  }

  async function doLogin() {
    try {
      const { user } = await api('/api/login', {
        method: 'POST',
        body: { system: SYSTEM, username: $('#lu').value.trim(), password: $('#lp').value },
      });
      state.user = user;
      await enterApp();
    } catch (err) { toast(err.message, 'bad'); }
  }

  /* ================= app ================= */
  async function enterApp() {
    const b = await api('/api/bootstrap');
    state.branding = b.branding;
    state.openShift = b.openShift;
    applyBranding(b.branding);
    state.products = (await api('/api/products')).products;
    try { state.settings = (await api('/api/settings')).settings; } catch { /* الكاشير قد لا يملك الصلاحية */ }
    try { state.customers = (await api('/api/customers')).customers; } catch { /* */ }
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    const mgr = state.user.role === 'manager';
    $$('.side .nav-item[data-view]').forEach((b) => {
      const managersOnly = b.dataset.mgr === '1' || ['products', 'branding', 'returns'].includes(b.dataset.view);
      b.classList.toggle('hidden', managersOnly && !mgr);
      b.onclick = () => { location.hash = '#/' + b.dataset.view; $('#side').classList.remove('open'); };
    });
    // شاشات الإدارة تحتاج المستخدم الحالي وقائمة الأصناف — نمررها مرة واحدة.
    if (window.NSAdmin) {
      NSAdmin.attach({
        user: state.user,
        getProducts: () => state.products,
        refreshProducts: async () => { state.products = (await api('/api/products')).products; return state.products; },
      });
      NSAdmin.refreshBadge();
      const bell = $('#alertsBtn');
      if (bell) bell.onclick = () => { location.hash = '#/alerts'; $('#side').classList.remove('open'); };
      // نحدّث الشارة كل دقيقة: التنبيهات تتغير بالبيع والتوريد، لا بالضغط.
      setInterval(() => NSAdmin.refreshBadge(), 60000);
    }
    if (!location.hash) location.hash = '#/sell';
    paintOfflineBar();
    if (isOnline() && readQueue().length) flushQueue();
    route();
  }

  function renderUser() {
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = state.user.role === 'manager' ? t('common.manager') : t('common.cashier');
    $('#avatar').textContent = state.user.name.replace('د. ', '').slice(0, 1);
  }

  function route() {
    if (!state.user) return;
    state.view = (location.hash.replace('#/', '') || 'sell');
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    renderCurrent();
  }
  function renderCurrent() {
    const local = { sell: renderSell, sales: renderSales, returns: renderReturns, shifts: renderShifts, reports: renderReports, products: renderProducts, branding: renderBranding, audit: renderAudit };
    const fn = local[state.view] || (window.NSAdmin && NSAdmin.views[state.view]);
    // شاشات الإدارة async؛ فشلها لا يجوز أن يترك الشاشة بيضاء.
    // applyI18n بعد كل رسم: الشاشات تُبنى بعد الترجمة الأولى، فالعنوان يبقى فارغاً بدونها.
    Promise.resolve((fn || renderSell).call(null))
      .then(() => { try { applyI18n(); } catch { /* */ } })
      .catch((err) => toast(err.message, 'bad'));
  }

  /* ================= العمل بلا شبكة — F-11 =================
   *
   * النت في المحلات بيقطع. القرار: البيع لا يتوقف، ويُحفظ محلياً بمفتاح
   * تكرار، ويُرسل عند رجوع الشبكة. الخادم يعرف المفتاح، فالإرسال المتأخر
   * لا يصنع فاتورة ثانية أبداً (replay ⇒ 409 ويُعتبر نجاحاً هنا).
   *
   * حدود صادقة: البيع بلا شبكة لا يتحقق من المخزون على الخادم؛ نتشبث بآخر
   * نسخة محلية ونرفض البيع لو نفدت. هذا قرار المالك في السجل، لا اجتهاد.
   */
  var QUEUE_KEY = 'nile_pos_queue_v1';

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ممتلئ أو ممنوع */ }
    paintOfflineBar();
  }
  // دوال لا ثوابت: init() ينادي paintOfflineBar قبل أن تُهيَّأ الثوابت،
  // وconst في منطقة الوفاة المؤقتة تكسر الصفحة كلها (حدث فعلاً).
  function isOnline() { return navigator.onLine !== false; }

  function paintOfflineBar() {
    const q = readQueue();
    let bar = $('#offlineBar');
    if (!q.length && isOnline()) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offlineBar';
      bar.className = 'offline-bar';
      document.body.appendChild(bar);
    }
    // لون التحذير يمشي على وجود طابور لا على navigator.onLine: الشبكة قد
    // تكون «متصلة» والطلب يفشل، والمهم أن الكاشير يشوف إن فيه فواتير معلّقة.
    const pending = readQueue().length;
    bar.className = `offline-bar${isOnline() && !pending ? ' ok' : ''}`;
    const wait = q.filter((x) => !x.sending).length;
    bar.innerHTML = isOnline()
      ? `<span class="dot"></span> ${t('pos.online') || 'متصل'} · ${wait ? `${wait} ${t('pos.queued') || 'فاتورة في الطابور'}` : (t('pos.synced') || 'تمت المزامنة')}`
        + (wait ? ` <button class="btn btn-ghost btn-sm" id="flushNow">${t('pos.syncNow') || 'مزامنة الآن'}</button>` : '')
      : `<span class="dot"></span> ${t('pos.offline') || 'بلا شبكة'} — ${wait} ${t('pos.queued') || 'فاتورة محفوظة محلياً'}`;
    const btn = $('#flushNow');
    if (btn) btn.onclick = flushQueue;
  }

  // كل بيع يعدّل المخزون المحلي فوراً حتى لا نبيع صنفاً نفد أثناء الانقطاع.
  function consumeLocalStock(items) {
    for (const it of items) {
      const p = state.products.find((x) => x.id === it.productId);
      if (p) p.stock = Math.max(0, p.stock - it.qty);
    }
  }

  async function postSale(body) {
    try {
      const r = await api('/api/sales', { method: 'POST', body });
      return { sale: r.sale, queued: false };
    } catch (err) {
      // فشل الشبكة = نحفظ ونكمل. رفض الخادم (400/403/409) يظهر للمستخدم.
      if (!(err instanceof TypeError) && navigator.onLine !== false) throw err;
      const q = readQueue();
      q.push({ body, at: new Date().toISOString() });
      writeQueue(q);
      return { sale: { ...body, total: body.paid, offline: true, no: '—', createdAt: new Date().toISOString(), items: [] }, queued: true };
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing) return;
    const q = readQueue();
    if (!q.length) return paintOfflineBar();
    flushing = true;
    const left = [];
    for (const item of q) {
      try {
        await api('/api/sales', { method: 'POST', body: item.body });
      } catch (err) {
        // «الخادم رآها قبل كذا» ليست فاتورة ناقصة: أي رفض بسبب مفتاح التكرار
        // يعني أن الفاتورة موجودة عنده أصلاً، فنُخرجها من الطابور.
        const msg = String(err.message || '');
        const dup = /تكرار|مكرر|duplicate|idempot/i.test(msg);
        if (!dup) left.push(item);
      }
    }
    flushing = false;
    writeQueue(left);
    if (!left.length) {
      toast(t('pos.synced') || 'تمت المزامنة', 'ok');
      try { state.products = (await api('/api/products')).products; renderSell(); } catch { /* */ }
    }
  }

  /* ================= كاميرا الباركود — F-04 =================
   * BarcodeDetector مدعوم في كروم على أندرويد وفيه بدائل. لو مش موجود
   * أو الإذن مرفوض، الإدخال اليدوي يفضل شغالاً — الكاميرا إضافة لا شرط.
   */
  // منع القراءة المكررة في أقل من 500ms — الكاميرا تقرأ نفس الباركود عشرين مرة.
  // في مستوى الوحدة حتى يستخدمها الخطاف الاختباري بنفس المنطق تماماً.
  var scanState = { code: '', at: 0 };
  function scanHit(code) {
    const now = Date.now();
    if (!code) return false;
    if (code === scanState.code && now - scanState.at < 500) return true;
    scanState.code = code; scanState.at = now;
    const p = state.products.find((x) => x.barcode === code);
    if (!p) { toast(`${t('pos.barcodeUnknown') || 'باركود غير معروف'}: ${code}`, 'bad'); return false; }
    addToCart(p.id);
    closeModal();
    return true;
  }

  function openScanner() {
    const supported = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
    openModal({
      title: t('pos.scan') || 'قراءة باركود بالكاميرا',
      body: `<div class="scan-box" id="scanBox">
          <video id="scanVideo" playsinline muted></video>
          <div class="frame"></div>
          <div class="hint" id="scanHint">${supported ? (t('pos.scanHint') || 'وجّه الكاميرا على الباركود') : (t('pos.scanUnsupported') || 'المتصفح لا يدعم القراءة — استخدم الإدخال اليدوي')}</div>
        </div>
        <div class="field mt-2"><label class="label">${t('pos.barcode') || 'باركود'}</label>
          <input class="input mono" id="scanManual" placeholder="6221000000000" autocomplete="off" /></div>`,
      footer: `<button class="btn btn-ghost" id="mCancel">${t('common.close')}</button>
        <button class="btn btn-primary" id="scanAdd">${t('pos.addToCart') || 'أضف'}</button>`,
    });
    const cancelBtn = $('#mCancel');
    if (cancelBtn) cancelBtn.onclick = closeModal;
    let stream = null;
    let timer = null;

    const hit = (code) => scanHit(code);

    $('#scanManual').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); hit($('#scanManual').value.trim()); } };
    $('#scanAdd').onclick = () => hit($('#scanManual').value.trim());

    if (!supported) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        const v = $('#scanVideo');
        v.srcObject = s;
        await v.play().catch(() => {});
        const detector = new window.BarcodeDetector();
        timer = setInterval(async () => {
          if (!v.videoWidth) return;
          try {
            const codes = await detector.detect(v);
            if (codes && codes.length) hit(String(codes[0].rawValue || '').trim());
          } catch { /* إطار فاشل لا يوقف الحلقة */ }
        }, 300);
      })
      .catch(() => {
        $('#scanHint').textContent = t('pos.scanDenied') || 'الكاميرا مرفوضة — الإدخال اليدوي يعمل';
      });

    const back = document.querySelector('.modal-back');
    if (back) {
      const stop = back._close;
      back._close = () => { clearInterval(timer); if (stream) stream.getTracks().forEach((x) => x.stop()); stop(); };
    }
  }

  // خطاف اختباري: يسمح لاختبار الواجهة بتجربة قراءة باركود دون كاميرا حقيقية.
  window.__nileScan = (code) => scanHit(code);

  /* ================= نقطة البيع ================= */
  // أسماء طرق الدفع في مكان واحد — تُستخدم في الشاشة والإيصال والفواتير والتقارير.
  const TENDER_LABEL = {
    cash: () => `💵 ${t('pos.cash')}`,
    card: () => `💳 ${t('pos.card')}`,
    wallet: () => `📱 ${t('pos.wallet') || 'Wallet'}`,
    transfer: () => `🏦 ${t('pos.transfer') || 'Transfer'}`,
  };
  const tenderLabel = (m) => (TENDER_LABEL[m] ? TENDER_LABEL[m]() : m);

  function renderSell() {
    const cats = [...new Set(state.products.map((p) => p.category))];
    const list = state.products.filter((p) =>
      (state.cat === 'all' || p.category === state.cat) &&
      (!state.q || p.name.includes(state.q) || p.barcode.includes(state.q)));
    $('#content').innerHTML = `
      <div class="row between mb-2">
        <div><div class="view-title" data-i18n="pos.sell"></div>
        <div class="row mt-1" style="gap:6px">
          <span class="badge badge-info">${t('pos.tourTitle')}</span>
          <span class="small muted">1) ${t('pos.tour1')} · 2) ${t('pos.tour2')} · 3) ${t('pos.tour3')}</span>
        </div></div>
        ${state.openShift
          ? `<span class="badge badge-ok">● ${t('pos.shiftOpen')}</span>`
          : `<button class="btn btn-primary btn-sm" id="openShiftBtn">${t('pos.openShift')}</button>`}
      </div>
      <div class="pos-layout">
        <div>
          <div class="card card-pad mb-2">
            <div class="row" style="gap:8px">
              <input class="input input-lg" id="searchBox" placeholder="${esc(t('pos.barcodePh'))}" value="${esc(state.q)}" style="flex:1" />
              <button class="btn btn-ghost btn-sm" id="scanBtn" title="${t('pos.scan') || 'كاميرا الباركود'}">📷</button>
            </div>
            <div class="row mt-2" id="catChips">
              <button class="chip ${state.cat === 'all' ? 'active' : ''}" data-cat="all">${t('common.all')}</button>
              ${cats.map((c) => `<button class="chip ${state.cat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>
          </div>
          <div class="pgrid" id="pgrid">
            ${list.map(productCard).join('') || `<div class="card card-pad center muted">${t('common.none')}</div>`}
          </div>
        </div>
        <div class="card cart card-pad">
          <div class="row between mb-2"><b>${t('pos.cart')}</b><span class="badge" id="cartCount">0</span></div>
          <div class="cart-items" id="cartItems"></div>
          <div class="totals">
            <div class="line"><span>${t('common.total')}</span><b class="mono" id="tSub">0</b></div>
            <div class="line"><span>${t('pos.discount')}</span><input class="input" style="width:90px;text-align:center" type="number" min="0" value="0" id="cartDiscount" /></div>
            ${(state.settings.taxRate || 0) > 0 ? `<div class="line"><span>${t('pos.tax') || 'ض.ق.م'} ${state.settings.taxRate}%</span><span class="mono" id="tTax">0</span></div>` : ''}
            <div class="line grand"><span>${t('common.total')}</span><span class="mono" id="tGrand">0</span></div>
            ${state.coupon ? `<div class="small muted">🎟️ ${esc(state.coupon.code)}</div>` : ''}
          </div>
          <div class="row mt-2" style="gap:6px" id="tenderRow">
            ${['cash', 'card', 'wallet', 'transfer', 'credit'].map((m) => `<button class="chip ${(state.method || 'cash') === m ? 'active' : ''}" data-tender="${m}" style="flex:1">${m === 'credit' ? `🧾 ${t('pos.credit') || 'آجل'}` : tenderLabel(m)}</button>`).join('')}
          </div>
          <div class="row mt-2" style="gap:8px">
            <button class="btn btn-ghost" style="flex:1" id="holdBtn" title="F9">⏸ ${t('pos.hold') || 'تعليق'}</button>
            <button class="btn btn-success" style="flex:2" id="checkoutBtn" title="F4">${t('pos.checkout')}</button>
          </div>
          <div id="heldBox" class="mt-2"></div>
        </div>
      </div>`;

    $('#searchBox').oninput = (e) => {
      state.q = e.target.value.trim();
      const l = state.products.filter((p) => (state.cat === 'all' || p.category === state.cat) && (!state.q || p.name.includes(state.q) || p.barcode.includes(state.q)));
      $('#pgrid').innerHTML = l.map(productCard).join('') || `<div class="card card-pad center muted">${t('common.none')}</div>`;
      bindProductCards();
      // باركود مطابق تماماً → ضيف على طول
      const exact = state.products.find((p) => p.barcode === state.q);
      if (exact) { addToCart(exact.id); state.q = ''; $('#searchBox').value = ''; $('#pgrid').innerHTML = state.products.filter((p) => state.cat === 'all' || p.category === state.cat).map(productCard).join(''); bindProductCards(); }
    };
    $$('#catChips .chip').forEach((c) => (c.onclick = () => { state.cat = c.dataset.cat; renderSell(); }));
    bindProductCards();
    $('#cartDiscount').oninput = () => renderCart();
    $('#checkoutBtn').onclick = checkout;
    $$('#tenderRow .chip').forEach((b) => (b.onclick = () => {
      state.method = b.dataset.tender;
      $$('#tenderRow .chip').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('#holdBtn').onclick = holdCart;
    const sb = $('#scanBtn'); if (sb) sb.onclick = openScanner;
    const ob = $('#openShiftBtn'); if (ob) ob.onclick = openShiftModal;
    renderCart();
    renderHeld();
  }

  function productCard(p) {
    // حد التنبيه لكل صنف على حدة إن حُدِّد، وإلا الافتراضي من الإعدادات.
    const low = p.stock <= (p.reorderLevel ?? state.settings.lowStockDefault ?? 5);
    return `<div class="pcard ${low ? 'low' : ''}" data-id="${p.id}">
      <span class="st mono">${p.stock <= 0 ? t('pos.outStock') : num(p.stock)}</span>
      <div class="emo">${p.emoji}</div>
      <div class="nm">${esc(p.name)}</div>
      <div class="pr mono">${money(p.price)}</div>
    </div>`;
  }
  function bindProductCards() { $$('#pgrid .pcard').forEach((c) => (c.onclick = () => addToCart(c.dataset.id))); }

  function addToCart(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    if (p.stock <= 0) return toast(`${p.name} — ${t('pos.outStock')}`, 'bad');
    const line = state.cart.find((l) => l.id === id);
    if (line) { if (line.qty >= p.stock) return toast(t('pos.outStock'), 'bad'); line.qty++; }
    else state.cart.push({ id, name: p.name, emoji: p.emoji, price: p.price, qty: 1 });
    toast(`${p.name} — ${t('pos.addToCart')}`, 'ok');
    renderCart();
  }

  // معاينة فقط: السيرفر هو من يحسب الضريبة والكوبون فعلياً عند البيع،
  // وهذه الدالة تجعل الرقم على الشاشة قريباً من الحقيقة لا مفاجأة بعده.
  // المبالغ قد تحتوي كسوراً بعد الضريبة (10 ج.م + 14% = 11.40). تقريب العرض
  // إلى جنيه كامل كان يجعل الكاشير يظن الفاتورة 11 ويُرفض الدفع لأنها 11.40.
  function exact(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const txt = Number.isInteger(v) ? String(v) : v.toFixed(2);
    return `${txt} ${t('common.currency')}`;
  }

  function taxOf(net) {
    const rate = Number(state.settings.taxRate) || 0;
    if (!rate) return 0;
    return Math.round(net * rate) / 100;
  }

  function cartTotals() {
    const subtotal = state.cart.reduce((s, l) => s + l.price * l.qty, 0);
    const dEl = $('#cartDiscount');
    const discount = dEl ? Math.max(0, Math.min(Number(dEl.value) || 0, subtotal)) : 0;
    return { subtotal, discount, total: subtotal - discount };
  }

  function renderCart() {
    const box = $('#cartItems');
    if (!box) return;
    box.innerHTML = state.cart.map((l, i) => `
      <div class="cart-row">
        <span style="font-size:20px">${l.emoji}</span>
        <span class="info"><b>${esc(l.name)}</b><span class="mono">${money(l.price)}</span></span>
        <span class="qty-ctl">
          <button data-i="${i}" data-d="-1">−</button><span class="mono">${l.qty}</span><button data-i="${i}" data-d="1">+</button>
        </span>
        <b class="mono" style="min-width:64px;text-align:end">${money(l.price * l.qty)}</b>
      </div>`).join('') || `<div class="center muted small" style="padding:26px 0">${t('pos.cartEmpty')}</div>`;
    $$('#cartItems .qty-ctl button').forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.i);
      const p = state.products.find((x) => x.id === state.cart[i].id);
      state.cart[i].qty += Number(b.dataset.d);
      if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
      else if (p && state.cart[i].qty > p.stock) { state.cart[i].qty = p.stock; toast(t('pos.outStock'), 'bad'); }
      renderCart();
    }));
    const { subtotal, discount, total } = cartTotals();
    $('#tSub').textContent = exact(subtotal);
    const taxEl = $('#tTax');
    if (taxEl) taxEl.textContent = exact(taxOf(subtotal - discount));
    $('#tGrand').textContent = exact(total + taxOf(subtotal - discount));
    $('#cartCount').textContent = state.cart.reduce((s, l) => s + l.qty, 0);
  }

  async function checkout() {
    if (!state.cart.length) return toast(t('pos.cartEmpty'), 'bad');
    if (!state.openShift) return toast(t('pos.shiftNeeded'), 'bad');
    const { subtotal, discount } = cartTotals();
    // معاينة الكود بنفس منطق الخادم: نسبة أو مبلغ على (الإجمالي − خصم الفاتورة).
    const couponBase = Math.max(0, subtotal - discount);
    const couponAmt = state.coupon
      ? Math.min(couponBase, state.coupon.type === 'amount'
        ? Number(state.coupon.value) || 0
        : Math.round(couponBase * (Number(state.coupon.value) || 0)) / 100)
      : 0;
    const netAfter = Math.max(0, couponBase - couponAmt);
    const tax = taxOf(netAfter);
    const grand = Math.round((netAfter + tax) * 100) / 100;
    const method = state.method || 'cash';
    const cash = method === 'cash';
    const credit = method === 'credit';
    // مفتاح تكرار واحد لكل محاولة دفع: ضغطتان على «تأكيد» لا تصنعان فاتورتين.
    const idemKey = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try { state.customers = (await api('/api/customers')).customers; } catch { /* */ }

    openModal({
      title: t('pos.checkout'),
      body: `<div class="row between mb-2">
          <div><div class="small muted">${t('common.total')}</div><div class="mono" style="font-size:28px;font-weight:900">${exact(grand)}</div></div>
          <div class="small muted mono" style="text-align:end">${exact(subtotal)}${discount ? ` − ${exact(discount)}` : ''}${couponAmt ? ` − ${exact(couponAmt)}` : ''}${tax ? `<br>+ ${t('pos.tax') || 'ض.ق.م'} ${exact(tax)}` : ''}</div>
        </div>
        <div class="field"><label class="label">${t('pos.method')}</label><div class="mono" style="font-size:16px;font-weight:800">${credit ? `🧾 ${t('pos.credit') || 'آجل'}` : tenderLabel(method)}</div></div>
        ${credit || state.customers.length ? `<div class="field"><label class="label">${t('pos.customer') || 'العميل'}${credit ? ' *' : ` <span class="small muted">(${t('pos.optional') || 'اختياري'})</span>`}</label>
          <select class="input" id="ckCustomer">
            <option value="">${t('pos.walkIn') || 'عميل نقدي'}</option>
            ${state.customers.map((c) => `<option value="${c.id}" ${state.customerId === c.id ? 'selected' : ''}>${esc(c.name)} — ${esc(c.phone)}${c.creditLimit ? ` · ${money(c.balance || 0)}/${money(c.creditLimit)}` : ''}</option>`).join('')}
          </select>
          ${credit ? `<div class="small muted mt-1" id="creditHint">${t('pos.creditHint') || 'الآجل يحتاج عميلاً له حد آجل، والرصيد لا يتعداه.'}</div>` : ''}
        </div>` : ''}
        <div class="field"><label class="label">${t('pos.coupon') || 'كود خصم'}</label>
          <div class="row" style="gap:6px">
            <input class="input mono" id="ckCoupon" placeholder="NILE10" value="${esc(state.coupon?.code || '')}" style="flex:1" />
            <button class="btn btn-ghost btn-sm" id="ckCouponApply">${t('pos.apply') || 'تطبيق'}</button>
          </div>
          <div class="small muted mt-1" id="couponMsg">${state.coupon ? `✓ ${esc(state.coupon.code)}` : ''}</div>
        </div>
        ${cash ? `<div class="field"><label class="label">${t('pos.paid')}</label><input class="input input-lg mono" id="paidInput" type="number" min="0" value="${Math.ceil(grand - 1e-9)}" step="0.01" /></div>
        <div class="field"><label class="label">${t('pos.change')}</label><div class="mono" id="changeOut" style="font-size:22px;font-weight:800;color:var(--ok)">${money(0)}</div></div>`
          : `<div class="small muted">${t('pos.exactOnly') || 'المبلغ يُسجَّل بالضبط — لا باقي خارج الكاش.'}</div>`}`,
      footer: `<button class="btn btn-ghost" id="cCancel">${t('common.cancel')}</button><button class="btn btn-success" id="cOk">${t('common.confirm')}</button>`,
    });

    const totalNow = () => grand;
    if (cash) {
      const paid = $('#paidInput');
      paid.oninput = () => {
        const chg = (Number(paid.value) || 0) - totalNow();
        $('#changeOut').textContent = money(Math.max(0, chg));
        $('#changeOut').style.color = chg < 0 ? 'var(--bad)' : 'var(--ok)';
      };
      paid.oninput();
    }
    // الكود يُفحص هنا للعرض فقط؛ الخادم يعيد الفحص ويرفض إن انتهى أو نقص الحد.
    $('#ckCouponApply').onclick = async () => {
      const code = $('#ckCoupon').value.trim();
      if (!code) { state.coupon = null; $('#couponMsg').textContent = ''; return; }
      try {
        const { coupons } = await api('/api/coupons').catch(() => ({ coupons: [] }));
        const c = (coupons || []).find((x) => x.code === code.toUpperCase());
        if (!c || !c.active) { state.coupon = null; $('#couponMsg').textContent = `✗ ${t('pos.couponBad') || 'كود غير ساري'}`; return; }
        if (c.minSubtotal && subtotal < c.minSubtotal) {
          state.coupon = null;
          $('#couponMsg').textContent = `✗ ${t('pos.couponMin') || 'أقل من حد الكود'} ${money(c.minSubtotal)}`;
          return;
        }
        state.coupon = c;
        $('#couponMsg').textContent = `✓ ${c.code}${c.type === 'percent' ? ` · ${c.value}%` : ` · ${money(c.value)}`}`;
        // نعيد رسم النافذة بالخصم الجديد حتى يرى الكاشير الإجمالي الحقيقي قبل الدفع.
        closeModal();
        return checkout();
      } catch {
        // الكاشير لا يقرأ قائمة الأكواد (للمدير فقط) — نترك الخادم يحكم.
        state.coupon = { code: code.toUpperCase() };
        $('#couponMsg').textContent = `✓ ${code.toUpperCase()}`;
      }
    };

    $('#cCancel').onclick = closeModal;
    let busy = false;
    $('#cOk').onclick = async () => {
      if (busy) return;
      const customerId = $('#ckCustomer') ? $('#ckCustomer').value : '';
      if (credit && !customerId) return toast(t('pos.creditNeedsCustomer') || 'الآجل يحتاج عميلاً', 'bad');
      const paidVal = cash ? Number($('#paidInput')?.value) || 0 : grand;
      if (cash && paidVal < totalNow()) return toast(t('pos.short'), 'bad');
      busy = true;
      $('#cOk').disabled = true;
      try {
        const body = {
          items: state.cart.map((l) => ({ productId: l.id, qty: l.qty })),
          discount, method, paid: paidVal,
          couponCode: state.coupon ? state.coupon.code : undefined,
          customerId: customerId || undefined,
          idempotencyKey: idemKey,
          heldId: state.heldId || undefined,
        };
        const { sale, queued } = await postSale(body);
        const soldItems = state.cart.map((l) => ({ productId: l.id, qty: l.qty }));
        state.cart = [];
        state.heldId = null;
        state.q = '';
        state.coupon = null;
        state.customerId = null;
        if (queued) {
          closeModal();
          consumeLocalStock(soldItems);
          renderSell();
          toast(t('pos.savedOffline') || 'انحفظت محلياً — هتترفع لما الشبكة ترجع', '');
        } else {
          state.products = (await api('/api/products')).products;
          renderSell();
          toast(t('pos.done'), 'ok');
          showReceipt(sale);
        }
        if (window.NSAdmin) NSAdmin.refreshBadge();
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        busy = false;
        const ok = $('#cOk'); if (ok) ok.disabled = false;
      }
    };
  }

  /* ================= السلال المعلّقة ================= */

  async function holdCart() {
    if (!state.cart.length) return toast(t('pos.cartEmpty'), 'bad');
    try {
      const { discount } = cartTotals();
      await api('/api/held', {
        method: 'POST',
        body: { items: state.cart.map((l) => ({ productId: l.id, qty: l.qty })), discount },
      });
      state.cart = [];
      state.heldId = null;
      renderSell();
      toast(t('pos.heldSaved') || 'السلة اتعلّقت', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function renderHeld() {
    const box = $('#heldBox');
    if (!box) return;
    try {
      const { held } = await api('/api/held');
      if (!held.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="small muted mb-1">${t('pos.heldCarts') || 'سلال معلّقة'} (${held.length})</div>
        ${held.map((h) => `<div class="row between card card-pad mb-1" style="padding:8px">
          <div><b class="small">${esc(h.label)}</b><div class="small muted">${h.items.reduce((a, i) => a + i.qty, 0)} ${t('common.qty')} · ${money(h.items.reduce((a, i) => a + i.price * i.qty, 0) - (h.discount || 0))}</div></div>
          <div class="row" style="gap:4px">
            <button class="btn btn-primary btn-sm" data-recall="${h.id}">↩ ${t('common.open') || 'استرجاع'}</button>
            <button class="btn btn-ghost btn-sm" data-drop="${h.id}">✕</button>
          </div></div>`).join('')}`;
      $$('#heldBox [data-recall]').forEach((b) => (b.onclick = () => {
        const h = held.find((x) => x.id === b.dataset.recall);
        state.cart = h.items.map((i) => ({ id: i.productId, name: i.name, emoji: i.emoji, price: i.price, qty: i.qty }));
        state.heldId = h.id;
        renderSell();
        toast(t('common.open') || 'اترجعت', 'ok');
      }));
      $$('#heldBox [data-drop]').forEach((b) => (b.onclick = async () => {
        await api('/api/held/' + b.dataset.drop, { method: 'DELETE' }).catch(() => {});
        renderHeld();
      }));
    } catch { /* الديمو يستمر حتى لو القائمة فشلت */ }
  }

  function showReceipt(sale) {
    openModal({
      title: t('pos.receipt'),
      wide: true,
      body: `<div class="receipt" id="receipt">
        <div class="r-head">
          <h3 data-brand-name>${esc(state.branding?.storeName || '')}</h3>
          <div class="small muted">${t('pos.receiptNo')} <b class="mono">#${sale.no}</b> · <span class="mono">${dmy(sale.createdAt)} — ${hm(sale.createdAt)}</span></div>
        </div>
        <table>${sale.items.map((it) => `
          <tr><td>${esc(it.name)} <span class="muted mono">×${it.qty}</span></td><td style="text-align:end" class="mono">${money(it.price * it.qty)}</td></tr>`).join('')}
        </table>
        <div class="r-total">
          <table>
            <tr><td>${t('pos.subtotal') || 'الإجمالي'}</td><td style="text-align:end" class="mono">${exact(sale.subtotal)}</td></tr>
            ${sale.discount ? `<tr><td>${t('pos.discount')}${sale.couponCode ? ` (${esc(sale.couponCode)})` : ''}</td><td style="text-align:end" class="mono">− ${exact(sale.discount)}</td></tr>` : ''}
            ${sale.tax ? `<tr><td>${t('pos.tax') || 'ض.ق.م'} ${sale.taxRate || 0}%</td><td style="text-align:end" class="mono">${exact(sale.tax)}</td></tr>` : ''}
            <tr><td><b>${t('common.total')}</b></td><td style="text-align:end"><b class="mono">${exact(sale.total)}</b></td></tr>
            <tr><td>${t('pos.method')}</td><td style="text-align:end">${sale.method === 'credit' ? `🧾 ${t('pos.credit') || 'آجل'}` : tenderLabel(sale.method)}</td></tr>
            ${sale.method === 'cash' ? `<tr><td>${t('pos.paid')}</td><td style="text-align:end" class="mono">${money(sale.paid)}</td></tr>
            <tr><td>${t('pos.change')}</td><td style="text-align:end" class="mono">${money(sale.change ?? Math.max(0, sale.paid - sale.total))}</td></tr>` : ''}
            ${sale.method === 'credit' ? `<tr><td>${t('pos.creditDue') || 'المتبقي آجل'}</td><td style="text-align:end" class="mono">${money(sale.total - (sale.payments || []).reduce((a, x) => a + x.amount, 0))}</td></tr>` : ''}
          </table>
        </div>
        <div class="center small muted mt-2">${t('pos.thanks')} ★</div>
      </div>`,
      footer: `<button class="btn btn-ghost" id="rcptInv" data-sale="${sale.id}">🧾 ${t('pos.printInvoice') || 'فاتورة ضريبية'}</button>
        <button class="btn btn-ghost" onclick="window.print()">🖨 ${t('common.print')}</button>
        <button class="btn btn-primary" onclick="document.querySelector('.modal-back')._close()">${t('common.close')}</button>`,
    });
  }

  // الفاتورة الضريبية المطبوعة — نفس البيانات من الخادم، لا من الشاشة.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#rcptInv');
    if (b && window.NSAdmin) NSAdmin.printInvoice(b.dataset.sale);
  });

  /* ================= الفواتير ================= */
  async function renderSales() {
    $('#content').innerHTML = `<div class="view-title" data-i18n="pos.sales"></div><div class="view-sub"></div><div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>#</th><th>${t('common.date')}</th><th>${t('common.qty')}</th><th>${t('common.total')}</th><th>${t('pos.method')}</th><th>${t('common.status')}</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
    const { sales } = await api('/api/sales?limit=50');
    $('#rows').innerHTML = sales.map((s) => `
      <tr>
        <td class="mono">#${s.no}</td>
        <td class="mono">${dmy(s.createdAt)} ${hm(s.createdAt)}</td>
        <td class="mono">${s.items.reduce((a, i) => a + i.qty, 0)}</td>
        <td class="mono"><b>${money(s.total)}</b></td>
        <td>${tenderLabel(s.method)}</td>
        <td><span class="badge ${s.status === 'completed' ? 'badge-ok' : 'badge-bad'}">${s.status === 'completed' ? '✓' : '↩'} ${s.status}</span>
          ${s.method === 'credit' ? `<span class="badge ${s.paymentStatus === 'paid' ? 'badge-ok' : 'badge-warn'}">${s.paymentStatus === 'paid' ? (t('pos.paidFull') || 'مسدَّد') : (t('pos.creditDue') || 'آجل')}</span>` : ''}</td>
        <td class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-view-sale="${s.id}">👁</button>
          <button class="btn btn-ghost btn-sm" data-inv="${s.id}" title="${t('pos.printInvoice') || 'طباعة الفاتورة'}">🖨</button>
          ${s.method === 'credit' && s.paymentStatus !== 'paid' ? `<button class="btn btn-ghost btn-sm" data-collect="${s.id}">${t('pos.collect') || 'تحصيل'}</button>` : ''}
          ${state.user.role === 'manager' && s.status !== 'returned' ? `<button class="btn btn-ghost btn-sm" data-ret="${s.id}">↩ ${t('pos.returns')}</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="7" class="center muted">${t('common.none')}</td></tr>`;
    $$('#rows [data-view-sale]').forEach((b) => (b.onclick = async () => {
      const { sale } = await api('/api/sales/' + b.dataset.viewSale);
      showReceipt(sale);
    }));
    $$('#rows [data-ret]').forEach((b) => (b.onclick = () => returnModal(b.dataset.ret)));
    $$('#rows [data-inv]').forEach((b) => (b.onclick = () => window.NSAdmin && NSAdmin.printInvoice(b.dataset.inv)));
    $$('#rows [data-collect]').forEach((b) => (b.onclick = () => collectModal(b.dataset.collect)));
  }

  // تحصيل آجل — F-12: الدفعة تدخل الدرج إن كانت كاش، والفاتورة تتحدث من الخادم.
  async function collectModal(saleId) {
    const { sale } = await api('/api/sales/' + saleId);
    const paid = (sale.payments || []).reduce((a, p) => a + p.amount, 0);
    const due = Math.round((sale.total - paid) * 100) / 100;
    openModal({
      title: `${t('pos.collect') || 'تحصيل'} #${sale.no}`,
      body: `<div class="small muted mb-2">${t('pos.remaining') || 'المتبقي'}: <b class="mono">${money(due)}</b></div>
        <div class="field"><label class="label">${t('pos.amount') || 'المبلغ'}</label>
          <input class="input input-lg mono" id="colAmt" type="number" min="1" max="${due}" value="${due}" /></div>
        <div class="field"><label class="label">${t('pos.method')}</label>
          <select class="input" id="colMethod"><option value="cash">${tenderLabel('cash')}</option><option value="card">${tenderLabel('card')}</option><option value="wallet">${tenderLabel('wallet')}</option><option value="transfer">${tenderLabel('transfer')}</option></select></div>`,
      footer: `<button class="btn btn-ghost" id="colCancel">${t('common.cancel')}</button><button class="btn btn-success" id="colOk">${t('common.confirm')}</button>`,
    });
    $('#colCancel').onclick = closeModal;
    $('#colOk').onclick = async () => {
      try {
        await api(`/api/sales/${saleId}/payments`, {
          method: 'POST',
          body: { amount: Number($('#colAmt').value) || 0, method: $('#colMethod').value },
        });
        closeModal(); toast(t('pos.saved'), 'ok'); renderSales();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= المرتجعات ================= */
  async function returnModal(saleId) {
    const { sale } = await api('/api/sales/' + saleId);
    const m = openModal({
      title: t('pos.returnTitle') + ' #' + sale.no,
      body: `<div class="small muted mb-2">${t('pos.returnPick')} #${sale.no} — ${money(sale.total)}</div>
        ${sale.items.map((it) => {
          const done = (sale.returned.find((r) => r.productId === it.productId) || { qty: 0 }).qty;
          const left = it.qty - done;
          return `<div class="cart-row"><span class="info"><b>${esc(it.name)}</b><span class="mono">${money(it.price)}</span></span>
            <span class="qty-ctl"><span class="mono">${done}/${it.qty}</span></span>
            <input class="input mono" style="width:70px;text-align:center" type="number" min="0" max="${left}" value="0" data-pid="${it.productId}" data-price="${it.price}" ${left ? '' : 'disabled'} /></div>`;
        }).join('')}
        <div class="totals"><div class="line grand"><span>${t('pos.refund')}</span><span class="mono" id="refundOut">${money(0)}</span></div></div>`,
      footer: `<button class="btn btn-ghost" onclick="document.querySelector('.modal-back')._close()">${t('common.cancel')}</button><button class="btn btn-danger" id="retOk">${t('pos.returnBtn')}</button>`,
    });
    const calc = () => {
      let sum = 0;
      $$('.modal-b input[data-pid]').forEach((i) => { sum += (Number(i.value) || 0) * Number(i.dataset.price); });
      $('#refundOut').textContent = money(sum);
    };
    $$('.modal-b input[data-pid]').forEach((i) => (i.oninput = calc));
    $('#retOk').onclick = async () => {
      const items = $$('.modal-b input[data-pid]').filter((i) => Number(i.value) > 0)
        .map((i) => ({ productId: i.dataset.pid, qty: Number(i.value) }));
      if (!items.length) return toast(t('common.none'), 'bad');
      try {
        await api('/api/returns', { method: 'POST', body: { saleId, items } });
        closeModal(); toast(t('pos.returned'), 'ok');
        state.products = (await api('/api/products')).products;
        renderSales();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  async function renderReturns() {
    if (state.user.role !== 'manager') return renderSell();
    $('#content').innerHTML = `<div class="view-title" data-i18n="pos.returns"></div>
      <div class="view-sub">${t('pos.returnPick')}</div><div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>#</th><th>${t('common.date')}</th><th>${t('common.total')}</th><th>${t('common.status')}</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
    const { sales } = await api('/api/sales?limit=30');
    $('#rows').innerHTML = sales.map((s) => `
      <tr><td class="mono">#${s.no}</td><td class="mono">${dmy(s.createdAt)} ${hm(s.createdAt)}</td>
      <td class="mono">${money(s.total)}</td>
      <td><span class="badge ${s.status === 'completed' ? 'badge-ok' : 'badge-bad'}">${s.status}</span></td>
      <td>${s.status !== 'returned' ? `<button class="btn btn-ghost btn-sm" data-ret="${s.id}">↩ ${t('pos.returnBtn')}</button>` : '—'}</td></tr>`).join('')
      || `<tr><td colspan="5" class="center muted">${t('common.none')}</td></tr>`;
    $$('#rows [data-ret]').forEach((b) => (b.onclick = () => returnModal(b.dataset.ret)));
  }

  /* ================= الورديات ================= */
  function openShiftModal() {
    openModal({
      title: t('pos.openShift'),
      body: `<div class="field"><label class="label">${t('pos.startingCash')}</label><input class="input input-lg mono" id="startCash" type="number" min="0" value="500" /></div>`,
      footer: `<button class="btn btn-ghost" onclick="document.querySelector('.modal-back')._close()">${t('common.cancel')}</button><button class="btn btn-primary" id="openOk">${t('common.confirm')}</button>`,
    });
    $('#openOk').onclick = async () => {
      try {
        await api('/api/shifts', { method: 'POST', body: { action: 'open', startingCash: Number($('#startCash').value) || 0 } });
        const b = await api('/api/bootstrap'); state.openShift = b.openShift;
        closeModal(); toast(t('pos.shiftOpened'), 'ok'); renderSell();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  async function renderShifts() {
    $('#content').innerHTML = `<div class="view-title" data-i18n="pos.shifts"></div><div class="view-sub"></div><div id="shiftBox"></div>`;
    const { openShift, shifts } = await api('/api/shifts');
    state.openShift = openShift;
    const { sales } = await api('/api/sales?limit=200');
    const cashSince = (from) => sales.filter((s) => s.method === 'cash' && s.status !== 'returned' && new Date(s.createdAt) >= new Date(from)).reduce((a, s) => a + s.total, 0);
    if (openShift) {
      // SHIFT-2: المتوقع يُحسب على السيرفر (يشمل خصم المرتجعات الجزئية)؛ الحساب المحلي احتياطي فقط
      const expected = typeof openShift.expectedCashNow === 'number' ? openShift.expectedCashNow : openShift.startingCash + cashSince(openShift.openedAt);
      $('#shiftBox').innerHTML = `<div class="card card-pad" style="max-width:430px">
        <div class="row between mb-2"><b>● ${t('pos.shiftOpen')}</b><span class="badge badge-ok mono">${hm(openShift.openedAt)}</span></div>
        <div class="line" style="display:flex;justify-content:space-between;padding:6px 0"><span>${t('pos.startingCash')}</span><b class="mono">${money(openShift.startingCash)}</b></div>
        <div class="line" style="display:flex;justify-content:space-between;padding:6px 0"><span>${t('pos.expectedCash')}</span><b class="mono">${money(expected)}</b></div>
        <div class="field mt-2"><label class="label">${t('pos.countedCash')}</label><input class="input input-lg mono" id="countCash" type="number" value="${Math.round(expected)}" /></div>
        <button class="btn btn-danger btn-block" id="closeShift">${t('pos.closeShift')}</button>
      </div>`;
      $('#closeShift').onclick = async () => {
        try {
          await api('/api/shifts', { method: 'POST', body: { action: 'close', countedCash: Number($('#countCash').value) || 0 } });
          state.openShift = null; toast(t('pos.shiftClosed'), 'ok'); renderShifts();
        } catch (err) { toast(err.message, 'bad'); }
      };
    } else {
      $('#shiftBox').innerHTML = `<div class="card card-pad" style="max-width:430px">
        <p class="muted mb-2">${t('pos.noShift')}</p>
        <div class="field"><label class="label">${t('pos.startingCash')}</label><input class="input input-lg mono" id="startCash" type="number" value="500" /></div>
        <button class="btn btn-primary btn-block" id="openShift2">${t('pos.openShift')}</button>
      </div>`;
      $('#openShift2').onclick = async () => {
        try {
          await api('/api/shifts', { method: 'POST', body: { action: 'open', startingCash: Number($('#startCash').value) || 0 } });
          toast(t('pos.shiftOpened'), 'ok'); renderShifts();
        } catch (err) { toast(err.message, 'bad'); }
      };
    }
    if (shifts.length) {
      $('#shiftBox').insertAdjacentHTML('beforeend', `<div class="card mt-3"><div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>${t('common.date')}</th><th>${t('pos.startingCash')}</th><th>${t('pos.expectedCash')}</th><th>${t('pos.countedCash')}</th><th>${t('pos.diff')}</th></tr></thead><tbody>
        ${shifts.map((s) => `<tr><td class="mono">${dmy(s.openedAt)} ${hm(s.openedAt)}</td><td class="mono">${money(s.startingCash)}</td>
          <td class="mono">${s.expectedCash != null ? money(s.expectedCash) : '—'}</td><td class="mono">${s.countedCash != null ? money(s.countedCash) : '—'}</td>
          <td>${s.diff == null ? '—' : `<span class="badge ${Math.abs(s.diff) < 1 ? 'badge-ok' : s.diff > 0 ? 'badge-info' : 'badge-bad'} mono">${s.diff > 0 ? '+' : ''}${money(s.diff)}</span>`}</td></tr>`).join('')}
      </tbody></table></div></div>`);
    }
  }

  /* ================= سجل العمليات ================= */
  async function renderAudit() {
    if (state.user.role !== 'manager') return renderSell();
    $('#content').innerHTML = `<div class="mb-2"><div class="view-title" data-i18n="pos.audit"></div>
      <div class="view-sub small muted">${t('pos.auditSub')}</div></div>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th>${t('common.date')}</th><th>${t('common.name')}</th><th>${t('pos.audit')}</th><th></th>
      </tr></thead><tbody id="aRows"></tbody></table></div></div>`;
    const { audit } = await api('/api/audit?limit=100');
    $('#aRows').innerHTML = audit.map((a) => `<tr>
      <td class="mono small">${dmy(a.at)} ${hm(a.at)}</td>
      <td>${esc(a.userName)}</td>
      <td class="small"><b class="mono">${esc(a.action)}</b><div class="muted">${esc(a.detail)}</div></td>
      <td></td></tr>`).join('') || `<tr><td colspan="4" class="center muted">${t('common.none')}</td></tr>`;
  }

  /* ================= التقارير ================= */
  async function renderReports() {
    $('#content').innerHTML = `<div class="row between mb-2">
        <div><div class="view-title" data-i18n="pos.reports"></div></div>
        <div class="row" style="gap:6px">
          <button class="chip ${state.reportRange === 'today' ? 'active' : ''}" data-r="today">${getLang() === 'ar' ? 'النهارده' : 'Today'}</button>
          <button class="chip ${state.reportRange === 'week' ? 'active' : ''}" data-r="week">${getLang() === 'ar' ? 'الأسبوع' : 'This week'}</button>
          ${state.user.role === 'manager' ? `<button class="btn btn-ghost btn-sm" data-csv="sales">⬇ sales.csv</button>
          <button class="btn btn-ghost btn-sm" data-csv="returns">⬇ returns.csv</button>
          <button class="btn btn-ghost btn-sm" data-csv="shifts">⬇ shifts.csv</button>
          <button class="btn btn-ghost btn-sm" data-csv="stock">⬇ stock.csv</button>` : ''}
        </div>
      </div>
      <div class="kpi" id="kpis"></div>
      <div class="grid g-2">
        <div class="card card-pad"><b>${t('pos.topProducts')}</b><div class="tbl-wrap mt-2"><table class="tbl"><thead><tr><th>${t('common.name')}</th><th>${t('common.qty')}</th><th>${t('common.total')}</th></tr></thead><tbody id="topRows"></tbody></table></div></div>
        <div class="card card-pad"><b>${t('pos.byHour')}</b><div class="bars" id="bars"></div><div class="bars-x" id="barsX"></div></div>
      </div>
      <div class="card card-pad mt-3"><b>${t('pos.byMethod')}</b><div id="methodBox" class="mt-2"></div></div>`;
    $$('#content .chip[data-r]').forEach((c) => (c.onclick = () => { state.reportRange = c.dataset.r; renderReports(); }));
    $$('#content [data-csv]').forEach((b) => (b.onclick = () => window.NSAdmin && NSAdmin.downloadCsv(b.dataset.csv)));
    const r = await api('/api/reports/summary?range=' + state.reportRange);
    // المال كما قرّره D-E: الصافي هو الرقم الرئيسي، والمرتجع سطر مستقل.
    // لا «ربح» في الشاشة: بدون تكلفة موثوقة الربح رقم مضلِّل (خطة 001 §2).
    $('#kpis').innerHTML = `
      <div class="card"><div class="lbl">${t('pos.netSales') || 'صافي المحصَّل'}</div><div class="val mono" style="color:var(--brand-600)">${money(r.net)}</div><div class="sub muted">${t('pos.todaySales')}: ${money(r.grossTotal)}</div></div>
      <div class="card"><div class="lbl">${t('pos.returns')}</div><div class="val mono" style="color:var(--bad)">− ${money(r.refundsTotal)}</div><div class="sub muted">${num(r.returns)} ${t('pos.invoices')}</div></div>
      <div class="card"><div class="lbl">${t('pos.invoices')}</div><div class="val mono">${num(r.invoices)}</div><div class="sub muted">${t('pos.avgInvoice')} ${money(r.avg)}</div></div>
      <div class="card"><div class="lbl">${t('pos.returnedCount') || 'مرتجع بالكامل'}</div><div class="val mono">${num(r.returnedCount)}</div><div class="sub muted">${t('pos.netHint') || 'الصافي = الإجمالي − المرتجعات'}</div></div>
      ${r.taxTotal ? `<div class="card"><div class="lbl">${t('pos.tax') || 'ض.ق.م'} ${r.taxRate || state.settings.taxRate || 0}%</div><div class="val mono">${money(r.taxTotal)}</div><div class="sub muted">${getLang() === 'ar' ? 'محصّلة لصالح الضرائب — ليست إيراداً' : 'Collected for tax — not revenue'}</div></div>` : ''}`;
    $('#topRows').innerHTML = r.topProducts.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${num(p.qty)}</td><td class="mono">${money(p.total)}</td></tr>`).join('')
      || `<tr><td colspan="3" class="center muted">${t('common.none')}</td></tr>`;
    const max = Math.max(1, ...r.byHour);
    $('#bars').innerHTML = r.byHour.map((v, h) => `<div class="b" style="height:${(v / max) * 100}%" data-tip="${h}:00 — ${money(v)}"></div>`).join('');
    $('#barsX').innerHTML = r.byHour.map((_, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('');
    const methods = Object.keys(r.byMethod || {});
    const tot = Math.max(1, methods.reduce((a, k) => a + Math.abs(r.byMethod[k]), 0));
    const colors = { cash: 'var(--brand)', card: '#2563eb', wallet: '#7c3aed', transfer: '#0f766e' };
    $('#methodBox').innerHTML = methods.map((m) => {
      const v = r.byMethod[m];
      const pct = Math.round((Math.abs(v) / tot) * 100);
      return `<div class="row between small mb-2"><span>${tenderLabel(m)}</span><b class="mono">${money(v)} (${pct}%)</b></div>
        <div style="height:10px;background:var(--bg);border-radius:99px;overflow:hidden;margin-bottom:10px"><div style="width:${pct}%;height:100%;background:${colors[m] || 'var(--brand)'}"></div></div>`;
    }).join('');
  }

  /* ================= الأصناف ================= */
  async function renderProducts() {
    if (state.user.role !== 'manager') return renderSell();
    $('#content').innerHTML = `<div class="row between mb-2">
        <div><div class="view-title" data-i18n="pos.products"></div><div class="view-sub small muted">${state.products.length}</div></div>
        <button class="btn btn-primary btn-sm" id="addP">+ ${t('pos.addProduct')}</button>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th></th><th>${t('common.name')}</th><th>${t('pos.barcode')}</th><th>${t('pos.category')}</th><th>${t('pos.cost')}</th><th>${t('common.price')}</th><th>${t('pos.margin')}</th><th>${t('pos.stock')}</th><th></th>
      </tr></thead><tbody id="rows"></tbody></table></div></div>`;
    $('#addP').onclick = () => productModal(null);
    $('#rows').innerHTML = state.products.map((p) => `
      <tr>
        <td style="font-size:22px">${p.emoji}</td>
        <td><b>${esc(p.name)}</b></td>
        <td class="mono small muted">${esc(p.barcode)}</td>
        <td><span class="badge">${esc(p.category)}</span></td>
        <td class="mono">${money(p.cost)}</td>
        <td class="mono"><b>${money(p.price)}</b></td>
        <td class="mono">${p.cost ? Math.round(((p.price - p.cost) / p.price) * 100) : 100}%</td>
        <td><span class="badge ${p.stock <= 0 ? 'badge-bad' : p.stock <= (p.reorderLevel ?? state.settings.lowStockDefault ?? 5) ? 'badge-warn' : 'badge-ok'} mono">${num(p.stock)}</span>
          ${p.taxExempt ? `<span class="badge badge-info" title="${t('pos.taxExempt') || 'معفى'}">0%</span>` : (p.taxRate != null ? `<span class="badge" title="tax">${p.taxRate}%</span>` : '')}</td>
        <td class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}">✎</button>
          <button class="btn btn-ghost btn-sm" data-del="${p.id}">🗑</button>
        </td>
      </tr>`).join('');
    $$('#rows [data-edit]').forEach((b) => (b.onclick = () => productModal(state.products.find((p) => p.id === b.dataset.edit))));
    $$('#rows [data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm(t('common.youSure'))) return;
      try { await api('/api/products/' + b.dataset.del, { method: 'DELETE' }); state.products = (await api('/api/products')).products; toast(t('pos.deleted'), 'ok'); renderProducts(); }
      catch (err) { toast(err.message, 'bad'); }
    }));
  }

  function productModal(p) {
    const isNew = !p;
    openModal({
      title: isNew ? t('pos.addProduct') : t('pos.editProduct'),
      body: `<div class="field"><label class="label">${t('common.name')}</label><input class="input" id="fName" value="${esc(p?.name || '')}" /></div>
        <div class="grid g-2">
          <div class="field"><label class="label">${t('common.price')}</label><input class="input mono" id="fPrice" type="number" min="0" value="${p?.price ?? ''}" /></div>
          <div class="field"><label class="label">${t('pos.cost')}</label><input class="input mono" id="fCost" type="number" min="0" value="${p?.cost ?? ''}" /></div>
          <div class="field"><label class="label">${t('pos.stock')}</label><input class="input mono" id="fStock" type="number" min="0" value="${p?.stock ?? ''}" /></div>
          <div class="field"><label class="label">${t('pos.category')}</label><input class="input" id="fCat" value="${esc(p?.category || 'متنوع')}" /></div>
          <div class="field"><label class="label">${t('pos.barcode')}</label><input class="input mono" id="fBar" value="${esc(p?.barcode || '')}" /></div>
          <div class="field"><label class="label">Icon</label><input class="input" id="fEmo" maxlength="2" value="${esc(p?.emoji || '📦')}" /></div>
          <div class="field"><label class="label">${t('pos.reorder') || 'حد إعادة الطلب'}</label><input class="input mono" id="fReorder" type="number" min="0" value="${p?.reorderLevel ?? ''}" placeholder="${state.settings.lowStockDefault ?? 5}" /></div>
          <div class="field"><label class="label">${t('pos.taxRate') || 'ضريبة خاصة %'}</label><input class="input mono" id="fTaxRate" type="number" min="0" max="100" value="${p?.taxRate ?? ''}" placeholder="${state.settings.taxRate || 0}" /></div>
        </div>
        <div class="field"><label class="row" style="gap:8px;align-items:center">
          <input type="checkbox" id="fExempt" ${p?.taxExempt ? 'checked' : ''} />
          <span>${t('pos.taxExempt') || 'معفى من الضريبة (خبز، أدوية، سلع مدعومة)'}</span></label></div>`,
      footer: `<button class="btn btn-ghost" onclick="document.querySelector('.modal-back')._close()">${t('common.cancel')}</button><button class="btn btn-primary" id="pSave">${t('common.save')}</button>`,
    });
    $('#pSave').onclick = async () => {
      const body = {
        name: $('#fName').value.trim(), price: Number($('#fPrice').value), cost: Number($('#fCost').value) || 0,
        stock: Number($('#fStock').value) || 0, category: $('#fCat').value.trim() || 'متنوع',
        barcode: $('#fBar').value.trim(), emoji: $('#fEmo').value.trim() || '📦',
        ...(isNew ? {} : {
          reorderLevel: $('#fReorder').value === '' ? null : Number($('#fReorder').value),
          taxRate: $('#fTaxRate').value === '' ? null : Number($('#fTaxRate').value),
          taxExempt: $('#fExempt').checked,
        }),
      };
      if (!body.name || !(body.price > 0)) return toast(t('common.save') + ' ✗', 'bad');
      try {
        await api(isNew ? '/api/products' : '/api/products/' + p.id, { method: isNew ? 'POST' : 'PUT', body });
        state.products = (await api('/api/products')).products;
        closeModal(); toast(t('pos.saved'), 'ok'); renderProducts();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= الهوية ================= */
  async function renderBranding() {
    if (state.user.role !== 'manager') return renderSell();
    const b = state.branding || {};
    $('#content').innerHTML = `<div class="view-title" data-i18n="pos.branding"></div>
      <div class="view-sub">${getLang() === 'ar' ? 'جرّب النظام باسم ولوجو محلك — بيظهر في كل الشاشات.' : 'Try the system with your store name and logo — it shows on every screen.'}</div>
      <div class="grid g-2">
        <div class="card card-pad">
          <div class="field"><label class="label">${t('pos.storeName')}</label><input class="input input-lg" id="bName" value="${esc(b.storeName || '')}" /></div>
          <div class="field"><label class="label">Logo</label><input class="input" id="bLogo" maxlength="4" value="${esc(b.logoText || '')}" /></div>
          <div class="field"><label class="label">${t('pos.primary')}</label>
            <div class="row"><input type="color" id="bColor" value="${b.primary || '#0d9488'}" style="width:60px;height:44px;border:1px solid var(--line);border-radius:8px;background:#fff" /><span class="mono muted">${b.primary || ''}</span></div>
          </div>
          <button class="btn btn-primary btn-block" id="bSave">${t('common.save')}</button>
        </div>
        <div class="card card-pad">
          <b>${t('pos.resetDemo')}</b>
          <p class="small muted mt-1">${getLang() === 'ar' ? 'يرجّع كل البيانات (الأصناف، الفواتير، الورديات) للحالة الأصلية.' : 'Restores all data (products, invoices, shifts) to the original state.'}</p>
          <button class="btn btn-danger btn-block mt-2" id="bReset">${t('pos.resetDemo')}</button>
        </div>
      </div>`;
    $('#bSave').onclick = async () => {
      try {
        const { branding } = await api('/api/branding', { method: 'PUT', body: { storeName: $('#bName').value.trim(), logoText: $('#bLogo').value.trim(), primary: $('#bColor').value } });
        state.branding = branding; applyBranding(branding); toast(t('pos.brandSaved'), 'ok');
      } catch (err) { toast(err.message, 'bad'); }
    };
    $('#bReset').onclick = async () => {
      if (!confirm(t('common.youSure'))) return;
      try {
        await api('/api/reset', { method: 'POST' });
        const bb = await api('/api/bootstrap'); state.branding = bb.branding; state.openShift = bb.openShift;
        state.products = (await api('/api/products')).products;
        applyBranding(bb.branding); toast(t('pos.resetDone'), 'ok'); renderBranding();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }
})();
