/* ===== Nile Systems — نظام المخازن =====
 *
 * نظام مستقل: مستخدموه، شاشته، ودخوله الخاص. يقرأ ويكتب نفس بيانات الكاشير
 * (نفس الخادم ونفس المخزون) — لأن متجراً بمخزونين لا يمكن أن يكون صادقاً.
 * لا يبيع ولا يحصّل؛ وظيفته أن يكون الرصيد صحيحاً.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'inventory';

  const state = { user: null, products: [], view: 'overview' };

  init();

  async function init() {
    applyI18n();
    bindChrome();
    try {
      const { user } = await api('/api/session');
      if (user && user.system === SYSTEM) { state.user = user; await enterApp(); return; }
    } catch { /* */ }
    showLogin();
  }

  function bindChrome() {
    ['#langBtn2', '#langBtn3'].forEach((sel) => { const b = $(sel); if (b) b.onclick = () => setLang(getLang() === 'ar' ? 'en' : 'ar'); });
    $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
    $('#logoutBtn').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* */ } location.reload(); };
    window.addEventListener('hashchange', route);
    window.addEventListener('nile:lang', () => { applyI18n(); if (state.user) { renderUser(); render(); } });
    if (window.innerWidth <= 900) $('#menuBtn').style.display = '';
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'خالد فتحي', role: 'مدير مخزن' },
      { username: 'store', name: 'سعيد ربيع', role: 'أمين مخزن' },
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

  async function enterApp() {
    const b = await api('/api/bootstrap');
    applyBranding(b.branding);
    state.products = (await api('/api/products')).products;
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    $$('.side .nav-item[data-view]').forEach((x) => {
      x.onclick = () => { location.hash = '#/' + x.dataset.view; $('#side').classList.remove('open'); };
    });
    if (!location.hash) location.hash = '#/overview';
    route();
  }

  function renderUser() {
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = state.user.role === 'manager' ? 'مدير مخزن' : 'أمين مخزن';
    $('#avatar').textContent = state.user.name.slice(0, 1);
  }

  function route() {
    if (!state.user) return;
    state.view = location.hash.replace('#/', '') || 'overview';
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = { overview: renderOverview, items: renderItems, low: renderLow, moves: renderMoves, purchases: renderPurchases };
  // رسم متسلسل — لا شاشة قديمة ترسم فوق الشاشة المطلوبة (نفس عيب pos/clinic).
  let renderChain = Promise.resolve();
  function render() {
    const view = views[state.view] || renderOverview;
    renderChain = renderChain
      .then(() => view())
      .catch((err) => toast(err.message, 'bad'));
    return renderChain;
  }

  const head = (title, sub, actions = '') => `
    <div class="row between mb-2" style="flex-wrap:wrap;gap:10px">
      <div><div class="view-title">${esc(title)}</div><div class="view-sub small muted">${sub}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${actions}</div>
    </div>`;
  const table = (heads, id) => `<div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div></div>`;
  const emptyRow = (n, txt) => `<tr><td colspan="${n}" class="center muted">${esc(txt)}</td></tr>`;

  /* ---------- لوحة المخزن ---------- */
  async function renderOverview() {
    const [{ products }, { low }, { movements }] = await Promise.all([
      api('/api/products'), api('/api/stock/low'), api('/api/stock/movements?limit=8'),
    ]);
    const value = products.reduce((a, p) => a + p.stock * p.cost, 0);
    const units = products.reduce((a, p) => a + p.stock, 0);
    $('#content').innerHTML = `
      ${head('لوحة المخزن', 'صورة واحدة لحالة المخزون الآن')}
      <div class="kpi">
        <div class="card"><div class="lbl">أصناف</div><div class="val mono">${num(products.length)}</div><div class="sub muted">${num(units)} وحدة</div></div>
        <div class="card"><div class="lbl">قيمة المخزون بسعر التكلفة</div><div class="val mono">${money(value)}</div><div class="sub muted">ليست ربحاً — بضاعة لم تُبع بعد</div></div>
        <div class="card"><div class="lbl">تحت حد الطلب</div><div class="val mono" style="color:var(--warn)">${num(low.length)}</div><div class="sub muted">محتاجة توريد</div></div>
        <div class="card"><div class="lbl">حركات اليوم</div><div class="val mono">${num(movements.length)}</div><div class="sub muted">آخر ٨ حركات</div></div>
      </div>
      <div class="card card-pad mt-3"><b>آخر الحركات</b>
        ${table(['الوقت', 'الصنف', 'الحركة', 'النوع', 'بواسطة'], 'mrows')}
      </div>`;
    const kind = { sale: 'بيع', refund: 'مرتجع', purchase: 'توريد', adjust: 'تسوية' };
    $('#mrows').innerHTML = movements.length ? movements.map((m) => `
      <tr><td class="mono small">${dmy(m.at)} ${hm(m.at)}</td>
        <td class="small">${esc(m.name || '—')}</td>
        <td class="mono"><b>${m.qty > 0 ? '+' : ''}${num(m.qty)}</b></td>
        <td class="small">${kind[m.kind] || esc(m.kind || '')}</td>
        <td class="small">${esc(m.byName || m.userName || '—')}</td></tr>`).join('')
      : emptyRow(5, 'مفيش حركات');
  }

  /* ---------- الأصناف ---------- */
  async function renderItems() {
    state.products = (await api('/api/products')).products;
    $('#content').innerHTML = `
      ${head('الأصناف', `${state.products.length} صنف — الرصيد يتحدث من البيع والتوريد والتسوية`,
        `<button class="btn btn-ghost btn-sm" id="csvBtn">⬇ stock.csv</button>`)}
      ${table(['الصنف', 'الباركود', 'المتاح', 'حد الطلب', 'التكلفة', 'قيمة الرصيد', ''], 'rows')}`;
    $('#rows').innerHTML = state.products.map((p) => `
      <tr><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.category)}</div></td>
        <td class="mono small muted">${esc(p.barcode)}</td>
        <td><span class="badge ${p.stock <= 0 ? 'badge-bad' : p.stock <= (p.reorderLevel ?? 5) ? 'badge-warn' : 'badge-ok'} mono">${num(p.stock)}</span></td>
        <td class="mono muted">${num(p.reorderLevel ?? '—')}</td>
        <td class="mono">${money(p.cost)}</td>
        <td class="mono"><b>${money(p.stock * p.cost)}</b></td>
        <td><button class="btn btn-ghost btn-sm" data-adj="${p.id}">تسوية</button></td></tr>`).join('');
    $$('#rows [data-adj]').forEach((b) => (b.onclick = () => adjust(b.dataset.adj)));
    const csv = $('#csvBtn');
    if (csv) csv.onclick = () => { location.href = '/api/export/stock.csv'; };
  }

  /* ---------- تحت حد الطلب ---------- */
  async function renderLow() {
    const { low } = await api('/api/stock/low');
    $('#content').innerHTML = `
      ${head('تحت حد الطلب', 'كل صنف هنا لازم يتحوّل لتوريد أو تسوية')}
      ${table(['الصنف', 'المتاح', 'حد الطلب', 'المطلوب', ''], 'rows')}`;
    $('#rows').innerHTML = low.length ? low.map((p) => {
      const need = Math.max(1, (p.reorderLevel ?? 5) * 2 - p.stock);
      return `<tr><td><b>${esc(p.name)}</b></td>
        <td><span class="badge badge-warn mono">${num(p.stock)}</span></td>
        <td class="mono">${num(p.reorderLevel ?? '—')}</td>
        <td class="mono">${num(need)}</td>
        <td><button class="btn btn-ghost btn-sm" data-adj="${p.id}">تسوية</button></td></tr>`;
    }).join('') : emptyRow(5, 'كل الأصناف فوق الحد');
    $$('#rows [data-adj]').forEach((b) => (b.onclick = () => adjust(b.dataset.adj)));
  }

  /* ---------- الحركات ---------- */
  async function renderMoves() {
    const { movements } = await api('/api/stock/movements?limit=200');
    const kind = { sale: 'بيع', refund: 'مرتجع', purchase: 'توريد', adjust: 'تسوية' };
    $('#content').innerHTML = `
      ${head('حركات المخزون', 'كل وحدة دخلت أو خرجت لها سطر — لا رصيد بلا سبب')}
      ${table(['الوقت', 'الصنف', 'الحركة', 'بعد الحركة', 'النوع', 'بواسطة'], 'rows')}`;
    $('#rows').innerHTML = movements.length ? movements.map((m) => `
      <tr><td class="mono small">${dmy(m.at)} ${hm(m.at)}</td>
        <td class="small">${esc(m.name || '—')}</td>
        <td class="mono"><b class="${m.qty > 0 ? 'good' : 'bad'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</b></td>
        <td class="mono muted">${num(m.after ?? '')}</td>
        <td class="small">${kind[m.kind] || esc(m.kind || '')}${m.note ? ` · ${esc(m.note)}` : ''}</td>
        <td class="small">${esc(m.byName || m.userName || '—')}</td></tr>`).join('')
      : emptyRow(6, 'مفيش حركات');
  }

  /* ---------- الموردون والتوريد ---------- */
  async function renderPurchases() {
    const [{ suppliers }, { purchases }] = await Promise.all([api('/api/suppliers'), api('/api/purchases')]);
    const mgr = state.user.role === 'manager';
    $('#content').innerHTML = `
      ${head('الموردون والتوريد', 'التوريد يزيد الرصيد ويعدّل متوسط التكلفة',
        mgr ? `<button class="btn btn-ghost btn-sm" id="addS">+ مورد</button><button class="btn btn-primary btn-sm" id="addP">+ توريد</button>` : '')}
      ${table(['المورد', 'الموبايل', 'عدد التوريدات', 'مستحق'], 'srows')}
      <h3 class="mt-3 mb-1">آخر التوريدات</h3>
      ${table(['التاريخ', 'المورد', 'الأصناف', 'الإجمالي', 'الحالة'], 'prows')}`;
    $('#srows').innerHTML = suppliers.length ? suppliers.map((s) => `
      <tr><td><b>${esc(s.name)}</b></td><td class="mono small">${esc(s.phone || '—')}</td>
        <td class="mono">${num(s.purchasesCount)}</td><td class="mono">${money(s.due)}</td></tr>`).join('')
      : emptyRow(4, 'مفيش موردين');
    $('#prows').innerHTML = purchases.length ? purchases.map((p) => `
      <tr><td class="mono small">${dmy(p.at)}</td><td>${esc(p.supplierName)}</td>
        <td class="small">${p.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(' · ')}</td>
        <td class="mono"><b>${money(p.total)}</b></td>
        <td><span class="badge ${p.paid ? 'badge-ok' : 'badge-warn'}">${p.paid ? 'مدفوع' : 'مستحق'}</span></td></tr>`).join('')
      : emptyRow(5, 'مفيش توريدات');
    const a = $('#addS'); if (a) a.onclick = () => supplierModal();
    const b = $('#addP'); if (b) b.onclick = () => purchaseModal(suppliers);
  }

  function supplierModal() {
    openModal({
      title: 'مورد جديد',
      body: `<div class="field"><label class="label">الاسم</label><input class="input" id="sN" /></div>
        <div class="field"><label class="label">الموبايل</label><input class="input mono" id="sP" /></div>`,
      footer: `<button class="btn btn-ghost" id="mCancel">إلغاء</button><button class="btn btn-primary" id="sOk">حفظ</button>`,
    });
    $('#mCancel').onclick = closeModal;
    $('#sOk').onclick = async () => {
      try {
        await api('/api/suppliers', { method: 'POST', body: { name: $('#sN').value.trim(), phone: $('#sP').value.trim() } });
        closeModal(); toast('تم الحفظ', 'ok'); renderPurchases();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  function purchaseModal(suppliers) {
    if (!suppliers.length) return toast('أضف مورداً أولاً', 'bad');
    const opts = state.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    openModal({
      wide: true,
      title: 'توريد جديد',
      body: `<div class="field"><label class="label">المورد</label>
          <select class="input" id="puSup">${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="grid g-2">
          <div class="field"><label class="label">الصنف</label><select class="input" id="puProd">${opts}</select></div>
          <div class="field"><label class="label">الكمية</label><input class="input mono" id="puQty" type="number" min="1" value="1" /></div>
          <div class="field"><label class="label">سعر الشراء للوحدة</label><input class="input mono" id="puCost" type="number" min="0" value="0" /></div>
          <div class="field"><label class="label">مدفوع الآن</label>
            <label class="row" style="gap:6px;align-items:center;padding-top:8px"><input type="checkbox" id="puPaid" /> <span>مدفوع</span></label></div>
        </div>
        <div class="small muted">سعر الشراء يدخل في متوسط التكلفة المرجح.</div>`,
      footer: `<button class="btn btn-ghost" id="mCancel">إلغاء</button><button class="btn btn-primary" id="puOk">حفظ</button>`,
    });
    $('#mCancel').onclick = closeModal;
    $('#puOk').onclick = async () => {
      try {
        await api('/api/purchases', {
          method: 'POST',
          body: {
            supplierId: $('#puSup').value,
            paid: $('#puPaid').checked,
            items: [{ productId: $('#puProd').value, qty: Number($('#puQty').value) || 1, cost: Number($('#puCost').value) || 0 }],
          },
        });
        state.products = (await api('/api/products')).products;
        closeModal(); toast('تم التوريد', 'ok'); renderPurchases();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  function adjust(productId) {
    openModal({
      title: 'تسوية مخزون',
      body: `<div class="field"><label class="label">الصنف</label>
          <select class="input" id="ajProd">${state.products.map((p) => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)} — ${p.stock}</option>`).join('')}</select></div>
        <div class="field"><label class="label">الفرق (+/−)</label><input class="input input-lg mono" id="ajQty" type="number" value="0" /></div>
        <div class="field"><label class="label">السبب</label><input class="input" id="ajWhy" placeholder="تالف · جرد · فقد" /></div>
        <div class="small muted">لا يمكن أن ينزل الرصيد تحت الصفر.</div>`,
      footer: `<button class="btn btn-ghost" id="mCancel">إلغاء</button><button class="btn btn-primary" id="ajOk">حفظ</button>`,
    });
    $('#mCancel').onclick = closeModal;
    $('#ajOk').onclick = async () => {
      try {
        await api('/api/stock/adjust', {
          method: 'POST',
          body: { productId: $('#ajProd').value, qty: Number($('#ajQty').value) || 0, reason: $('#ajWhy').value.trim() },
        });
        state.products = (await api('/api/products')).products;
        closeModal(); toast('تم الحفظ', 'ok'); render();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }
})();
