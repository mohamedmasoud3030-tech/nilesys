/* ===== Nile Systems — نظام المطاعم =====
 *
 * نظام مستقل: مستخدموه، شاشته، ودخوله الخاص. يملك بياناته (الترابيزات، المنيو،
 * الطلبات، الحجوزات) لكنه يصرّف الكاش من نفس درج الوردية العام ويسجّل حركة
 * مخزون بنفس شكل باقي الأنظمة — لأن مطعماً بدرج منفصل لا يمكن أن يُطابَق.
 *
 * القاعدة الحاكمة: التذكرة في المطبخ مشتقّة من سطور الطلب نفسها، لا نسخة ثانية منها.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'restaurant';

  const state = { user: null, tables: [], menu: [], view: 'floor', order: null, ticket: [] };

  const STATUS_AR = { free: 'فاضية', seated: 'مشغولة', reserved: 'محجوزة', dirty: 'للتنضيف' };
  const LINE_AR = { new: 'جديد', cooking: 'على النار', ready: 'جاهز', served: 'اتقدّم', void: 'ملغي' };
  const TYPE_AR = { dine_in: 'صالة', takeaway: 'تيك أواي', delivery: 'دليفري' };
  const METHOD_AR = { cash: 'نقدي', card: 'فيزا', wallet: 'محفظة', transfer: 'تحويل' };
  const isManager = () => state.user && state.user.role === 'manager';

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
    document.addEventListener('click', onAction);
    if (window.innerWidth <= 900) $('#menuBtn').style.display = '';
  }

  async function onAction(e) {
    const b = e.target.closest('[data-cook],[data-ready],[data-served]');
    if (!b || !state.user) return;
    const orderId = b.closest('[data-ticket]') && b.closest('[data-ticket]').dataset.ticket;
    if (!orderId) return;
    const map = { cook: ['cook', 'cooking'], ready: ['ready', 'ready'], served: ['served', 'served'] };
    const hit = Object.keys(map).find((k) => b.dataset[k]);
    if (!hit) return;
    const [, to] = map[hit];
    try {
      await api(`/api/restaurant/orders/${orderId}/items/${b.dataset[hit]}`, { method: 'PATCH', body: { state: to } });
      await renderKitchen();
    } catch (err) { toast(err.message, 'bad'); }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'طارق نبيل', role: 'مدير مطعم' },
      { username: 'waiter', name: 'حسن عماد', role: 'ويتر' },
      { username: 'kitchen', name: 'عم صابر', role: 'شيف' },
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
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    $$('.side .nav-item[data-view]').forEach((x) => {
      x.onclick = () => { location.hash = '#/' + x.dataset.view; $('#side').classList.remove('open'); };
    });
    if (!location.hash) location.hash = '#/floor';
    route();
  }

  function renderUser() {
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = { manager: 'مدير مطعم', waiter: 'ويتر', kitchen: 'شيف' }[state.user.role] || state.user.role;
    $('#avatar').textContent = state.user.name.slice(0, 1);
  }

  function route() {
    if (!state.user) return;
    // أي نافذة مفتوحة تنقفل مع تغيير الشاشة: نافذة قديمة فوق شاشة جديدة تحجب
    // الضغط على أزرارها (أمسكها اختبار المتصفح على الديمو المنشور).
    closeModal();
    const raw = location.hash.replace('#/', '') || 'floor';
    state.view = raw.split('/')[0];
    if (state.view === 'order') { renderOrder(raw.split('/')[1] || null); return; }
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = { floor: renderFloor, kitchen: renderKitchen, reservations: renderReservations, summary: renderSummary, shift: renderShift };
  function render() {
    Promise.resolve((views[state.view] || renderFloor)()).catch((err) => toast(err.message, 'bad'));
  }

  const head = (title, sub, actions = '') => `
    <div class="row between mb-2" style="flex-wrap:wrap;gap:10px">
      <div><div class="view-title">${esc(title)}</div><div class="view-sub small muted">${sub}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${actions}</div>
    </div>`;
  const table = (heads, id) => `<div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div></div>`;
  const emptyRow = (n, txt) => `<tr><td colspan="${n}" class="center muted">${esc(txt)}</td></tr>`;

  async function loadTables() {
    state.tables = (await api('/api/restaurant/tables')).tables;
    return state.tables;
  }

  /* ---------- الصالة ---------- */
  async function renderFloor() {
    const [tables, menu] = await Promise.all([loadTables(), api('/api/restaurant/menu')]);
    state.menu = menu.menu;
    const busy = tables.filter((x) => x.status === 'seated');
    const openTotal = busy.reduce((a, x) => a + ((x.order && x.order.total) || 0), 0);
    $('#content').innerHTML = `
      ${head('الصالة', `${num(tables.length)} ترابيزة — اضغط ترابيزة تفتح طلب أو تكمل طلب قائم`,
        `<button class="btn btn-primary" id="newTakeaway">＋ طلب تيك أواي</button>
         ${isManager() ? '<button class="btn btn-ghost" id="addTable">＋ ترابيزة</button>' : ''}`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">مشغولة</div><div class="val mono">${num(busy.length)}</div><div class="sub muted">من ${num(tables.length)}</div></div>
        <div class="card"><div class="lbl">قيمة الطلبات المفتوحة</div><div class="val mono">${money(openTotal)}</div><div class="sub muted">لم تُحصّل بعد</div></div>
        <div class="card"><div class="lbl">للتنضيف</div><div class="val mono">${num(tables.filter((x) => x.status === 'dirty').length)}</div><div class="sub muted">تحتاج تأكيد قبل الاستخدام</div></div>
        <div class="card"><div class="lbl">أصناف المنيو</div><div class="val mono">${num(state.menu.filter((m) => m.available !== false).length)}</div><div class="sub muted">متاحة للطلب الآن</div></div>
      </div>
      <div class="floor" id="floor"></div>`;
    $('#floor').innerHTML = tables.map((x) => `
      <button class="tcard" data-status="${esc(x.status)}" data-table="${esc(x.id)}" aria-label="ترابيزة ${esc(x.name)} ${esc(STATUS_AR[x.status] || x.status)}">
        <span class="badge st ${x.status === 'seated' ? 'badge-warn' : x.status === 'reserved' ? 'badge-info' : x.status === 'dirty' ? 'badge-bad' : 'badge-ok'}">${esc(STATUS_AR[x.status] || x.status)}</span>
        <div class="tno">${esc(x.name)}</div>
        <div class="seats">${num(x.seats)} أفراد · ${esc(x.area || 'صالة')}</div>
        ${x.order ? `<div class="amt">${money(x.order.total)}</div><div class="small muted">طلب #${x.order.no} · ${num(x.order.items)} صنف</div>` : '<div class="small muted" style="margin-top:6px">اضغط لفتح طلب</div>'}
      </button>`).join('');
    $$('#floor .tcard').forEach((b) => (b.onclick = () => onTable(b.dataset.table, b.dataset.status)));
    if ($('#newTakeaway')) $('#newTakeaway').onclick = () => openOrder(null, 'takeaway');
    if ($('#addTable')) $('#addTable').onclick = addTableModal;
  }

  async function onTable(tableId, status) {
    if (status === 'dirty') {
      try { await api(`/api/restaurant/tables/${tableId}/status`, { method: 'POST', body: { status: 'free' } }); toast('الترابيزة بقت جاهزة', 'ok'); } catch (e) { toast(e.message, 'bad'); }
      renderFloor(); return;
    }
    if (status === 'reserved') { location.hash = '#/reservations'; return; }
    const tb = state.tables.find((x) => x.id === tableId);
    if (tb && tb.order) openOrder(tb.order.id, 'dine_in', tableId);
    else openOrder(null, 'dine_in', tableId);
  }

  async function addTableModal() {
    openModal({
      title: 'ترابيزة جديدة',
      body: `<div class="field"><label class="label">الاسم</label><input class="input" id="tName" placeholder="مثال: T9 أو تراس 1" /></div>
             <div class="field"><label class="label">عدد الأفراد</label><input class="input" id="tSeats" type="number" min="1" value="4" /></div>
             <div class="field"><label class="label">المنطقة</label><input class="input" id="tArea" value="صالة" /></div>`,
      footer: `<button class="btn btn-primary" id="tSave">حفظ</button>`,
    });
    $('#tSave').onclick = async () => {
      try {
        await api('/api/restaurant/tables', { method: 'POST', body: { name: $('#tName').value.trim(), seats: Number($('#tSeats').value), area: $('#tArea').value.trim() } });
        closeModal(); toast('اتضافت', 'ok'); renderFloor();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الطلب ---------- */
  function openOrder(orderId, type, tableId) {
    state.view = 'order';
    state.orderId = orderId || null;
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.remove('active'));
    state.order = orderId ? null : { id: null, type: type || 'dine_in', tableId: tableId || null, items: [], status: 'open' };
    state.pendingTable = tableId || null;
    // الرابط يعكس الشاشة: رجوع المتصفح يرجّعك للصالة، وتحديث الصفحة لا يضيّع الطلب.
    const target = orderId ? `#/order/${orderId}` : '#/order';
    if (location.hash === target) renderOrder();
    else location.hash = target;
  }

  async function renderOrder(orderId) {
    if (orderId) state.orderId = orderId;
    state.order = state.order || null;
    if (!state.order) state.order = { id: null, type: 'dine_in', tableId: state.pendingTable || null, items: [], status: 'open' };
    if (state.orderId) {
      try {
        const { order } = await api(`/api/restaurant/orders/${state.orderId}`);
        state.order = order;
      } catch (e) { toast(e.message, 'bad'); }
    }
    if (!state.menu.length) state.menu = (await api('/api/restaurant/menu')).menu;
    if (!state.tables.length) await loadTables();
    const o = state.order;
    const tb = state.tables.find((x) => x.id === o.tableId);
    const open = o.status === 'open';
    const totals = o.totals || computeTotals(o);
    const unsent = (o.items || []).filter((i) => !i.sentAt && i.state !== 'void').length;
    const cats = [...new Set(state.menu.map((m) => m.category))];

    $('#content').innerHTML = `
      ${head(`طلب ${o.no ? '#' + o.no : 'جديد'}`, `${tb ? 'ترابيزة ' + esc(tb.name) : esc(TYPE_AR[o.type] || o.type)} · ${o.status === 'paid' ? 'مدفوع' : 'مفتوح'}`,
        `<button class="btn btn-ghost" id="backFloor">→ الصالة</button>`)}
      <div class="order-grid">
        <div>
          ${open ? `<div class="row mb-2" style="gap:6px;flex-wrap:wrap" id="cats">
            ${cats.map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
          <div class="pgrid" id="menuGrid"></div>` : `<div class="card card-pad"><b>الطلب مقفول ومدفوع</b><div class="small muted mt-1">الإجمالي ${money(totals.total)} · ${esc((METHOD_AR[o.payment && o.payment.method] || '—'))}</div></div>`}
        </div>
        <div class="card card-pad cart">
          <div class="row between"><b>الطلب</b><span class="badge ${open ? 'badge-warn' : 'badge-ok'}">${open ? 'مفتوح' : 'مدفوع'}</span></div>
          <div class="cart-items mt-2" id="lines"></div>
          <div class="mt-2" style="border-top:1px solid var(--line);padding-top:10px">
            <div class="row between small"><span>المجموع</span><span class="mono">${money(totals.subtotal)}</span></div>
            ${totals.discount ? `<div class="row between small"><span>خصم</span><span class="mono">− ${money(totals.discount)}</span></div>` : ''}
            <div class="row between" style="margin-top:6px"><b>الإجمالي</b><b class="mono">${money(totals.total)}</b></div>
          </div>
          <div class="mt-2" style="display:grid;gap:8px">
            ${open ? `<button class="btn btn-primary btn-block" id="sendBtn">${unsent ? `إرسال ${num(unsent)} للمطبخ` : 'كل حاجة اتبعتت'}</button>` : ''}
            ${open ? `<button class="btn btn-block" id="payBtn" ${unsent ? 'disabled title="فيه أصناف لم تُرسل"' : ''}>تحصيل ${money(totals.total)}</button>` : ''}
            ${open && isManager() ? `<button class="btn btn-ghost btn-block" id="voidBtn">إلغاء الطلب</button>` : ''}
          </div>
          <div class="small muted mt-2">الدفع لا يمكن قبل إرسال كل الأصناف — الحساب لا يسبق المطبخ.</div>
        </div>
      </div>`;

    const paintMenu = (cat) => {
      $('#menuGrid').innerHTML = state.menu.filter((m) => !cat || m.category === cat).map((m) => `
        <button class="menu-item" data-menu="${esc(m.id)}" ${m.available === false ? 'disabled' : ''}>
          <div class="nm">${esc(m.name)}</div>
          <div class="pr">${money(m.price)}</div>
          <div class="small muted">${esc(m.station === 'bar' ? 'بار' : 'مطبخ')} · ${num(m.prepMinutes)} د${m.available === false ? ' · غير متاح' : ''}</div>
        </button>`).join('');
      $$('#menuGrid .menu-item').forEach((b) => (b.onclick = () => addLine(b.dataset.menu)));
    };
    paintMenu(cats[0]);
    $$('#cats .chip').forEach((c) => (c.onclick = () => {
      $$('#cats .chip').forEach((x) => x.classList.remove('active')); c.classList.add('active'); paintMenu(c.dataset.cat);
    }));

    paintLines();
    $('#backFloor').onclick = () => { state.order = null; state.orderId = null; location.hash = '#/floor'; };
    if ($('#sendBtn')) $('#sendBtn').onclick = sendToKitchen;
    if ($('#payBtn')) $('#payBtn').onclick = payModal;
    if ($('#voidBtn')) $('#voidBtn').onclick = voidOrder;
  }

  function computeTotals(o) {
    const lines = (o.items || []).filter((i) => i.state !== 'void');
    const subtotal = Math.round(lines.reduce((a, i) => a + i.price * i.qty, 0));
    const discount = Math.min(Math.round(Number(o.discount) || 0), subtotal);
    return { subtotal, discount, total: subtotal - discount };
  }

  function paintLines() {
    const o = state.order;
    const items = o.items || [];
    $('#lines').innerHTML = items.length ? items.map((i) => `
      <div class="line" data-line="${esc(i.id)}">
        <div class="nm">
          <b>${num(i.qty)}× ${esc(i.name)}</b>
          <div class="small muted">${money(i.price * i.qty)} · ${esc(LINE_AR[i.state] || i.state)}${i.sentAt ? ' · اتبعت' : ' · لسه'}</div>
          ${i.notes ? `<div class="small muted">📝 ${esc(i.notes)}</div>` : ''}
        </div>
        ${o.status === 'open' && i.state !== 'void' ? `<span class="row" style="gap:4px">
          ${i.state === 'new' && !i.sentAt ? `<button class="btn btn-ghost btn-sm" data-inc="${esc(i.id)}">＋</button><button class="btn btn-ghost btn-sm" data-dec="${esc(i.id)}">−</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-void="${esc(i.id)}" title="إلغاء الصنف">✕</button>
        </span>` : ''}
      </div>`).join('') : '<div class="center muted small" style="padding:14px">مفيش أصناف بعد</div>';
    $$('#lines [data-inc]').forEach((b) => (b.onclick = () => addLine(b.dataset.inc, 1, true)));
    $$('#lines [data-dec]').forEach((b) => (b.onclick = () => decLine(b.dataset.dec)));
    $$('#lines [data-void]').forEach((b) => (b.onclick = () => voidLine(b.dataset.void)));
  }

  async function ensureOrder() {
    if (state.order && state.order.id) return state.order;
    const body = { type: state.order.type, items: [] };
    if (state.order.type === 'dine_in') body.tableId = state.order.tableId;
    const { order } = await api('/api/restaurant/orders', { method: 'POST', body });
    state.order = order; state.orderId = order.id;
    return state.order;
  }

  async function addLine(menuId, qty = 1, existing = false) {
    const mi = state.menu.find((m) => m.id === menuId);
    if (!mi) return;
    if (mi.available === false) { toast('الصنف غير متاح', 'bad'); return; }
    try {
      if (existing) {
        await api(`/api/restaurant/orders/${state.order.id}/items/${menuId}`, { method: 'PATCH', body: { qty: state.order.items.find((i) => i.id === menuId).qty + 1 } });
      } else {
        const o = await ensureOrder();
        const same = (o.items || []).find((i) => i.menuItemId === menuId && i.state === 'new' && !i.sentAt);
        if (same) {
          // نفس الصنف قبل الإرسال يزيد كميته بدل ما يفتح سطر تاني — فاتورة أنظف.
          await api(`/api/restaurant/orders/${o.id}/items/${same.id}`, { method: 'PATCH', body: { qty: same.qty + qty } });
        } else {
          await api(`/api/restaurant/orders/${o.id}/items`, { method: 'POST', body: { items: [{ menuItemId: menuId, qty }] } });
        }
      }
      const { order } = await api(`/api/restaurant/orders/${state.order.id}`);
      state.order = order;
      await renderOrder();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function decLine(lineId) {
    const line = state.order.items.find((i) => i.id === lineId);
    if (!line) return;
    try {
      await api(`/api/restaurant/orders/${state.order.id}/items/${lineId}`, { method: 'PATCH', body: { qty: line.qty - 1 } });
      const { order } = await api(`/api/restaurant/orders/${state.order.id}`);
      state.order = order;
      await renderOrder();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function removeLine(lineId) {
    try {
      await api(`/api/restaurant/orders/${state.order.id}/items/${lineId}`, { method: 'PATCH', body: { qty: 0 } });
      const { order } = await api(`/api/restaurant/orders/${state.order.id}`);
      state.order = order;
      await renderOrder();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function voidLine(lineId) {
    const line = state.order.items.find((i) => i.id === lineId);
    if (line && !line.sentAt) return removeLine(lineId);
    if (!isManager()) { toast('إلغاء صنف بعد الإرسال للمدير فقط', 'bad'); return; }
    const reason = prompt('سبب إلغاء الصنف؟');
    if (!reason) return;
    try {
      await api(`/api/restaurant/orders/${state.order.id}/items/${lineId}`, { method: 'PATCH', body: { state: 'void', reason } });
      const { order } = await api(`/api/restaurant/orders/${state.order.id}`);
      state.order = order;
      await renderOrder();
      toast('الصنف اتلغى', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function sendToKitchen() {
    try {
      const r = await api(`/api/restaurant/orders/${state.order.id}/send`, { method: 'POST' });
      toast(r.resent ? 'مفيش جديد — التذكرة اتبعتت قبل كده' : `اتبعت ${num(r.sent)} صنف للمطبخ`, r.resent ? '' : 'ok');
      const { order } = await api(`/api/restaurant/orders/${state.order.id}`);
      state.order = order;
      await renderOrder();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function payModal() {
    const totals = state.order.totals || computeTotals(state.order);
    openModal({
      title: `تحصيل ${money(totals.total)}`,
      body: `
        <div class="field"><label class="label">طريقة الدفع</label>
          <select class="input" id="payMethod">
            ${Object.entries(METHOD_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label">تقسيم الحساب على كم شخص؟</label>
          <input class="input" id="paySplit" type="number" min="1" value="1" /></div>
        <div class="field"><label class="label">المدفوع نقداً (لحساب الباقي)</label>
          <input class="input" id="payCash" type="number" min="0" value="${totals.total}" /></div>
        <div class="small muted" id="payHint">الإجمالي ${money(totals.total)}</div>`,
      footer: `<button class="btn btn-primary" id="payGo">تأكيد التحصيل</button>`,
    });
    const upd = () => {
      const split = Math.max(1, Number($('#paySplit').value) || 1);
      const cash = Number($('#payCash').value) || 0;
      $('#payHint').innerHTML = split > 1
        ? `${num(split)} أفراد × ${money(Math.round(totals.total / split))} — آخر فرد عليه الباقي، مفيش قرش يضيع`
        : (cash >= totals.total ? `الباقي ${money(cash - totals.total)}` : `ناقص ${money(totals.total - cash)}`);
    };
    ['#paySplit', '#payCash'].forEach((s) => { $(s).oninput = upd; });
    $('#payGo').onclick = async () => {
      try {
        const body = { method: $('#payMethod').value };
        const n = Number($('#paySplit').value) || 1;
        if (n > 1) body.split = { count: n };
        if (body.method === 'cash') body.paid = Number($('#payCash').value) || 0;
        const r = await api(`/api/restaurant/orders/${state.order.id}/pay`, { method: 'POST', body });
        closeModal();
        toast(`اتحصّل ${money((r.order.payment || {}).total || totals.total)}`, 'ok');
        state.order = r.order;
        await renderOrder();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  async function voidOrder() {
    const reason = prompt('سبب إلغاء الطلب؟');
    if (!reason) return;
    try {
      await api(`/api/restaurant/orders/${state.order.id}/void`, { method: 'POST', body: { reason } });
      toast('الطلب اتلغى', 'ok');
      state.order = null; state.orderId = null; location.hash = '#/floor';
    } catch (e) { toast(e.message, 'bad'); }
  }

  /* ---------- المطبخ ---------- */
  async function renderKitchen() {
    if (state.user.role === 'manager' || state.user.role === 'kitchen' || state.user.role === 'waiter') { /* all may view */ }
    const { tickets } = await api('/api/restaurant/kitchen');
    const station = state.kitchenStation || 'all';
    const shown = tickets.filter((tk) => station === 'all' || tk.items.some((i) => i.station === station));
    $('#content').innerHTML = `
      ${head('شاشة المطبخ', `${num(tickets.length)} تذكرة مفتوحة — الأقدم أولاً`,
        `<div class="row" style="gap:6px">
          ${[['all', 'الكل'], ['kitchen', 'مطبخ'], ['bar', 'بار']].map(([k, v]) => `<button class="chip ${station === k ? 'active' : ''}" data-st="${k}">${v}</button>`).join('')}
        </div>`)}
      ${tickets.length ? `<div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">تذاكر</div><div class="val mono">${num(tickets.length)}</div></div>
        <div class="card"><div class="lbl">أصناف على النار</div><div class="val mono">${num(tickets.reduce((a, tk) => a + tk.items.filter((i) => i.state === 'cooking').length, 0))}</div></div>
        <div class="card"><div class="lbl">جاهزة للتقديم</div><div class="val mono">${num(tickets.reduce((a, tk) => a + tk.items.filter((i) => i.state === 'ready').length, 0))}</div></div>
      </div>` : ''}
      <div class="floor" id="board" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))"></div>`;
    if (!tickets.length) {
      $('#board').innerHTML = '<div class="card card-pad center muted">مفيش حاجة مستنية — المطبخ فاضي</div>';
      return;
    }
    const t0 = Date.now();
    $('#board').innerHTML = shown.map((tk) => `
      <div class="card card-pad kticket" data-ticket="${esc(tk.orderId)}">
        <div class="row between"><b>#${num(tk.no)}</b>
          <span class="badge badge-warn">${esc(tk.tableName || TYPE_AR[tk.type] || '')}</span></div>
        <div class="small muted mb-2">اتبعت ${hm(tk.sentAt)} · ${num(Math.max(0, Math.round((t0 - new Date(tk.sentAt).getTime()) / 60000)))} دقيقة</div>
        ${tk.items.map((i) => `
          <div class="krow">
            <span class="small"><b>${num(i.qty)}×</b> ${esc(i.name)}${i.notes ? `<br><span class="muted">📝 ${esc(i.notes)}</span>` : ''}
              <br><span class="badge st-${esc(i.state)} small">${esc(LINE_AR[i.state] || i.state)}</span></span>
            <span class="row" style="gap:4px">
              ${i.state === 'new' ? `<button class="btn btn-sm" data-cook="${esc(i.id)}">ابدأ</button>` : ''}
              ${i.state === 'cooking' ? `<button class="btn btn-sm" data-ready="${esc(i.id)}">جاهز</button>` : ''}
              ${i.state === 'ready' ? `<button class="btn btn-sm" data-served="${esc(i.id)}">قدّمني</button>` : ''}
            </span>
          </div>`).join('')}
      </div>`).join('') || '<div class="card card-pad center muted">مفيش تذاكر على المحطة دي</div>';
    $$('#content .chip[data-st]').forEach((b) => (b.onclick = () => { state.kitchenStation = b.dataset.st; renderKitchen(); }));
  }

  /* ---------- الحجوزات ---------- */
  async function renderReservations() {
    const today = new Date().toISOString().slice(0, 10);
    const [{ reservations }, tables] = await Promise.all([api(`/api/restaurant/reservations?date=${today}`), loadTables()]);
    $('#content').innerHTML = `
      ${head('حجوزات اليوم', dmy(today), `<button class="btn btn-primary" id="newRes">＋ حجز جديد</button>`)}
      ${table(['الوقت', 'الاسم', 'الموبايل', 'الترابيزة', 'أفراد', 'الحالة', ''], 'rows')}`;
    $('#rows').innerHTML = reservations.length ? reservations.map((r) => {
      const tb = tables.find((x) => x.id === r.tableId);
      return `<tr>
        <td class="mono small">${hm(r.at)}</td>
        <td>${esc(r.name)}</td>
        <td class="mono small">${esc(r.phone)}</td>
        <td>${esc(tb ? tb.name : '—')}</td>
        <td class="mono">${num(r.partySize)}</td>
        <td><span class="badge ${r.status === 'cancelled' ? 'badge-bad' : 'badge-ok'}">${r.status === 'cancelled' ? 'ملغي' : 'محجوز'}</span></td>
        <td>${r.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm" data-cancel="${esc(r.id)}">إلغاء</button>` : ''}</td>
      </tr>`;
    }).join('') : emptyRow(7, 'مفيش حجوزات النهارده');
    $$('#rows [data-cancel]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/restaurant/reservations/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('اتلغى', 'ok'); renderReservations(); } catch (e) { toast(e.message, 'bad'); }
    }));
    $('#newRes').onclick = () => newReservationModal(tables);
  }

  function newReservationModal(tables) {
    const now = new Date(Date.now() + 3600e3);
    now.setSeconds(0, 0);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    openModal({
      title: 'حجز جديد',
      body: `
        <div class="field"><label class="label">الاسم</label><input class="input" id="rName" /></div>
        <div class="field"><label class="label">الموبايل</label><input class="input" id="rPhone" inputmode="tel" /></div>
        <div class="field"><label class="label">الترابيزة</label><select class="input" id="rTable">
          ${tables.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} — ${num(x.seats)} أفراد</option>`).join('')}</select></div>
        <div class="field"><label class="label">الوقت</label><input class="input" id="rAt" type="datetime-local" value="${local}" /></div>
        <div class="field"><label class="label">عدد الأفراد</label><input class="input" id="rParty" type="number" min="1" value="2" /></div>`,
      footer: `<button class="btn btn-primary" id="rSave">حجز</button>`,
    });
    $('#rSave').onclick = async () => {
      try {
        await api('/api/restaurant/reservations', {
          method: 'POST',
          body: {
            name: $('#rName').value.trim(), phone: $('#rPhone').value.trim(), tableId: $('#rTable').value,
            at: new Date($('#rAt').value).toISOString(), partySize: Number($('#rParty').value) || 2,
          },
        });
        closeModal(); toast('اتحجز', 'ok'); renderReservations();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الوردية ---------- */
  async function renderShift() {
    const { openShift } = await api('/api/restaurant/shift');
    $('#content').innerHTML = `
      ${head('الوردية والدرج', 'الكاش النقدي هنا يدخل نفس درج الفرع — لا درج منفصل للمطعم')}
      <div class="card card-pad">
        ${openShift ? `
          <div class="row between"><b>وردية مفتوحة</b><span class="badge badge-ok">مفتوحة</span></div>
          <div class="small muted mt-1">اتفتحت ${dmy(openShift.openedAt)} ${hm(openShift.openedAt)} · رصيد افتتاحي ${money(openShift.openingCash)}</div>
          <div class="mt-2" style="display:grid;gap:8px;max-width:320px">
            <div class="field"><label class="label">النقدية المعدودة في الدرج</label><input class="input" id="counted" type="number" min="0" value="${openShift.openingCash}" /></div>
            <button class="btn btn-primary" id="closeShift">إغلاق الوردية ومطابقة الدرج</button>
          </div>`
        : `<div class="row between"><b>مفيش وردية مفتوحة</b><span class="badge badge-bad">مقفولة</span></div>
           <div class="mt-2" style="display:grid;gap:8px;max-width:320px">
            <div class="field"><label class="label">رصيد افتتاحي في الدرج</label><input class="input" id="opening" type="number" min="0" value="500" /></div>
            <button class="btn btn-primary" id="openShift">فتح وردية</button>
           </div>`}
      </div>`;
    if ($('#openShift')) $('#openShift').onclick = async () => {
      try { await api('/api/restaurant/shift', { method: 'POST', body: { action: 'open', openingCash: Number($('#opening').value) || 0 } }); toast('الوردية اتفتحت', 'ok'); renderShift(); } catch (e) { toast(e.message, 'bad'); }
    };
    if ($('#closeShift')) $('#closeShift').onclick = async () => {
      try {
        const { shift } = await api('/api/restaurant/shift', { method: 'POST', body: { action: 'close', countedCash: Number($('#counted').value) || 0 } });
        toast(`الفرق ${money(shift.difference)} ${shift.difference === 0 ? '— مطابق تماماً' : ''}`, shift.difference === 0 ? 'ok' : 'bad');
        renderShift();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- ملخص اليوم ---------- */
  async function renderSummary() {
    const s = await api('/api/restaurant/summary?range=today');
    $('#content').innerHTML = `
      ${head('ملخص اليوم', 'أرقام من طلبات مدفوعة فقط — لا تقديرات')}
      <div class="kpi">
        <div class="card"><div class="lbl">إجمالي التحصيل</div><div class="val mono">${money(s.gross)}</div><div class="sub muted">${num(s.orders)} طلب مدفوع</div></div>
        <div class="card"><div class="lbl">متوسط الفاتورة</div><div class="val mono">${money(s.avgTicket)}</div><div class="sub muted">لكل ترابيزة/طلب</div></div>
        <div class="card"><div class="lbl">متوسط التحضير</div><div class="val mono">${num(Math.round(s.avgPrepMinutes || 0))} د</div><div class="sub muted">من الإرسال للجاهزية</div></div>
        <div class="card"><div class="lbl">طرق الدفع</div><div class="val mono" style="font-size:16px">${Object.entries(s.byMethod || {}).map(([k, v]) => `${esc(METHOD_AR[k] || k)}: ${money(v)}`).join('<br>') || '—'}</div></div>
      </div>
      <div class="card card-pad"><b>الأكثر مبيعاً</b>
        ${table(['الصنف', 'الكمية'], 'topRows')}
      </div>`;
    $('#topRows').innerHTML = (s.topItems || []).length ? s.topItems.map((i) => `
      <tr><td>${esc(i.name)}</td><td class="mono"><b>${num(i.qty)}</b></td></tr>`).join('') : emptyRow(2, 'مفيش مبيعات النهارده');
  }
})();
