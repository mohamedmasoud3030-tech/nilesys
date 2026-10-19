/* ===== Nile Systems — POS system logic ===== */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, ago, esc, applyBranding } = window.NS;
  const SYSTEM = 'pos';

  const state = {
    user: null, branding: null, products: [], cart: [],
    openShift: null, cat: 'all', q: '', reportRange: 'today', view: 'sell',
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
    checkMobile();
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
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    const mgr = state.user.role === 'manager';
    $$('.side .nav-item[data-view]').forEach((b) => {
      b.classList.toggle('hidden', ['products', 'branding', 'returns'].includes(b.dataset.view) && !mgr);
      b.onclick = () => { location.hash = '#/' + b.dataset.view; $('#side').classList.remove('open'); };
    });
    if (!location.hash) location.hash = '#/sell';
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
    ({ sell: renderSell, sales: renderSales, returns: renderReturns, shifts: renderShifts, reports: renderReports, products: renderProducts, branding: renderBranding }[state.view] || renderSell)();
  }

  /* ================= نقطة البيع ================= */
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
            <input class="input input-lg" id="searchBox" placeholder="${esc(t('pos.barcodePh'))}" value="${esc(state.q)}" />
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
            <div class="line grand"><span>${t('common.total')}</span><span class="mono" id="tGrand">0</span></div>
          </div>
          <div class="row mt-2" style="gap:8px">
            <select class="select" id="payMethod" style="flex:1">
              <option value="cash">${t('pos.cash')}</option>
              <option value="card">${t('pos.card')}</option>
            </select>
            <button class="btn btn-success" style="flex:1" id="checkoutBtn">${t('pos.checkout')}</button>
          </div>
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
    const ob = $('#openShiftBtn'); if (ob) ob.onclick = openShiftModal;
    renderCart();
  }

  function productCard(p) {
    const low = p.stock <= 5;
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
    $('#tSub').textContent = money(subtotal);
    $('#tGrand').textContent = money(total);
    $('#cartCount').textContent = state.cart.reduce((s, l) => s + l.qty, 0);
  }

  async function checkout() {
    if (!state.cart.length) return toast(t('pos.cartEmpty'), 'bad');
    if (!state.openShift) return toast(t('pos.shiftNeeded'), 'bad');
    const { discount, total } = cartTotals();
    const m = openModal({
      title: t('pos.checkout'),
      body: `<div class="field"><label class="label">${t('common.total')}</label><div class="mono" style="font-size:30px;font-weight:900">${money(total)}</div></div>
        <div class="field"><label class="label">${t('pos.paid')}</label><input class="input input-lg mono" id="paidInput" type="number" min="0" value="${total}" /></div>
        <div class="field"><label class="label">${t('pos.change')}</label><div class="mono" id="changeOut" style="font-size:22px;font-weight:800;color:var(--ok)">${money(0)}</div></div>
        <div class="small muted">${t('pos.method')}: <b id="mOut">${$('#payMethod').value === 'cash' ? t('pos.cash') : t('pos.card')}</b></div>`,
      footer: `<button class="btn btn-ghost" id="cCancel">${t('common.cancel')}</button><button class="btn btn-success" id="cOk">${t('common.confirm')}</button>`,
    });
    const paid = $('#paidInput');
    paid.oninput = () => {
      const chg = (Number(paid.value) || 0) - total;
      $('#changeOut').textContent = money(Math.max(0, chg));
      $('#changeOut').style.color = chg < 0 ? 'var(--bad)' : 'var(--ok)';
    };
    $('#cCancel').onclick = closeModal;
    $('#cOk').onclick = async () => {
      const paidVal = Number(paid.value) || 0;
      if (paidVal < total) return toast(t('pos.short'), 'bad');
      try {
        const { sale } = await api('/api/sales', {
          method: 'POST',
          body: { items: state.cart.map((l) => ({ productId: l.id, qty: l.qty })), discount, method: $('#payMethod').value, paid: paidVal },
        });
        state.cart = [];
        state.products = (await api('/api/products')).products;
        renderSell();
        toast(t('pos.done'), 'ok');
        showReceipt(sale);
      } catch (err) { toast(err.message, 'bad'); }
    };
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
            <tr><td>${t('common.total')}</td><td style="text-align:end" class="mono">${money(sale.subtotal)}</td></tr>
            <tr><td>${t('pos.discount')}</td><td style="text-align:end" class="mono">${money(sale.discount)}</td></tr>
            <tr><td><b>${t('common.total')}</b></td><td style="text-align:end"><b class="mono">${money(sale.total)}</b></td></tr>
            <tr><td>${t('pos.paid')}</td><td style="text-align:end" class="mono">${money(sale.paid)}</td></tr>
            <tr><td>${t('pos.change')}</td><td style="text-align:end" class="mono">${money(Math.max(0, sale.paid - sale.total))}</td></tr>
          </table>
        </div>
        <div class="center small muted mt-2">${t('pos.thanks')} ★</div>
      </div>`,
      footer: `<button class="btn btn-ghost" onclick="window.print()">🖨 ${t('common.print')}</button><button class="btn btn-primary" onclick="document.querySelector('.modal-back')._close()">${t('common.close')}</button>`,
    });
  }

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
        <td>${s.method === 'cash' ? t('pos.cash') : t('pos.card')}</td>
        <td><span class="badge ${s.status === 'completed' ? 'badge-ok' : 'badge-bad'}">${s.status === 'completed' ? '✓' : '↩'} ${s.status}</span></td>
        <td class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-view-sale="${s.id}">👁</button>
          ${state.user.role === 'manager' && s.status !== 'returned' ? `<button class="btn btn-ghost btn-sm" data-ret="${s.id}">↩ ${t('pos.returns')}</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="7" class="center muted">${t('common.none')}</td></tr>`;
    $$('#rows [data-view-sale]').forEach((b) => (b.onclick = async () => {
      const { sale } = await api('/api/sales/' + b.dataset.viewSale);
      showReceipt(sale);
    }));
    $$('#rows [data-ret]').forEach((b) => (b.onclick = () => returnModal(b.dataset.ret)));
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

  /* ================= التقارير ================= */
  async function renderReports() {
    $('#content').innerHTML = `<div class="row between mb-2">
        <div><div class="view-title" data-i18n="pos.reports"></div></div>
        <div class="row" style="gap:6px">
          <button class="chip ${state.reportRange === 'today' ? 'active' : ''}" data-r="today">${getLang() === 'ar' ? 'النهارده' : 'Today'}</button>
          <button class="chip ${state.reportRange === 'week' ? 'active' : ''}" data-r="week">${getLang() === 'ar' ? 'الأسبوع' : 'This week'}</button>
        </div>
      </div>
      <div class="kpi" id="kpis"></div>
      <div class="grid g-2">
        <div class="card card-pad"><b>${t('pos.topProducts')}</b><div class="tbl-wrap mt-2"><table class="tbl"><thead><tr><th>${t('common.name')}</th><th>${t('common.qty')}</th><th>${t('common.total')}</th></tr></thead><tbody id="topRows"></tbody></table></div></div>
        <div class="card card-pad"><b>${t('pos.byHour')}</b><div class="bars" id="bars"></div><div class="bars-x" id="barsX"></div></div>
      </div>
      <div class="card card-pad mt-3"><b>${t('pos.byMethod')}</b><div id="methodBox" class="mt-2"></div></div>`;
    $$('#content .chip[data-r]').forEach((c) => (c.onclick = () => { state.reportRange = c.dataset.r; renderReports(); }));
    const r = await api('/api/reports/summary?range=' + state.reportRange);
    $('#kpis').innerHTML = `
      <div class="card"><div class="lbl">${t('pos.todaySales')}</div><div class="val mono" style="color:var(--brand-600)">${money(r.salesTotal)}</div></div>
      <div class="card"><div class="lbl">${t('pos.todayProfit')}</div><div class="val mono" style="color:var(--ok)">${money(r.profit)}</div><div class="sub muted">${t('pos.margin')} ${r.salesTotal ? Math.round((r.profit / r.salesTotal) * 100) : 0}%</div></div>
      <div class="card"><div class="lbl">${t('pos.invoices')}</div><div class="val mono">${num(r.invoices)}</div><div class="sub muted">${t('pos.avgInvoice')} ${money(r.avg)}</div></div>
      <div class="card"><div class="lbl">${t('pos.returns')}</div><div class="val mono">${num(r.returns)}</div></div>`;
    $('#topRows').innerHTML = r.topProducts.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${num(p.qty)}</td><td class="mono">${money(p.total)}</td></tr>`).join('')
      || `<tr><td colspan="3" class="center muted">${t('common.none')}</td></tr>`;
    const max = Math.max(1, ...r.byHour);
    $('#bars').innerHTML = r.byHour.map((v, h) => `<div class="b" style="height:${(v / max) * 100}%" data-tip="${h}:00 — ${money(v)}"></div>`).join('');
    $('#barsX').innerHTML = r.byHour.map((_, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('');
    const tot = r.byMethod.cash + r.byMethod.card || 1;
    $('#methodBox').innerHTML = `
      <div class="row between small mb-2"><span>💵 ${t('pos.cash')}</span><b class="mono">${money(r.byMethod.cash)} (${Math.round((r.byMethod.cash / tot) * 100)}%)</b></div>
      <div style="height:10px;background:var(--bg);border-radius:99px;overflow:hidden"><div style="width:${(r.byMethod.cash / tot) * 100}%;height:100%;background:var(--brand)"></div></div>
      <div class="row between small mt-3 mb-2"><span>💳 ${t('pos.card')}</span><b class="mono">${money(r.byMethod.card)} (${Math.round((r.byMethod.card / tot) * 100)}%)</b></div>
      <div style="height:10px;background:var(--bg);border-radius:99px;overflow:hidden"><div style="width:${(r.byMethod.card / tot) * 100}%;height:100%;background:#2563eb"></div></div>`;
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
        <td><span class="badge ${p.stock <= 0 ? 'badge-bad' : p.stock <= 5 ? 'badge-warn' : 'badge-ok'} mono">${num(p.stock)}</span></td>
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
        </div>`,
      footer: `<button class="btn btn-ghost" onclick="document.querySelector('.modal-back')._close()">${t('common.cancel')}</button><button class="btn btn-primary" id="pSave">${t('common.save')}</button>`,
    });
    $('#pSave').onclick = async () => {
      const body = {
        name: $('#fName').value.trim(), price: Number($('#fPrice').value), cost: Number($('#fCost').value) || 0,
        stock: Number($('#fStock').value) || 0, category: $('#fCat').value.trim() || 'متنوع',
        barcode: $('#fBar').value.trim(), emoji: $('#fEmo').value.trim() || '📦',
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
