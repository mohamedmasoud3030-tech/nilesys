/* ===== Nile Systems — نظام حجز الملاعب =====
 *
 * نظام مستقل: مستخدموه (مدير/استقبال)، مساراته /api/courts، وشاشته الخاصة.
 * سؤال واحد يجيب عليه بسرعة: الملعب فاضي ولا محجوز في الساعة دي؟
 *
 * السعر يُحسب في الخادم دائماً — الشاشة تعرضه ولا تقترحه.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'courts';

  const state = { user: null, view: 'grid', date: null, courts: [], bookings: [], grid: null };
  const ST_AR = { free: 'فاضي', held: 'معلّق', confirmed: 'مؤكد', played: 'اتلعب', cancelled: 'ملغي', expired: 'منتهي' };
  const KIND_AR = { football: 'خماسي', padel: 'بادل' };
  const METHOD_AR = { cash: 'نقدي', card: 'فيزا', wallet: 'محفظة', transfer: 'تحويل' };
  const ROLE_AR = { manager: 'مدير', reception: 'استقبال' };
  const isManager = () => state.user && state.user.role === 'manager';
  const today = () => new Date().toISOString().slice(0, 10);

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
    document.addEventListener('click', onAction);
  }

  async function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !state.user) return;
    const { act, id } = b.dataset;
    try {
      if (act === 'slot') {
        openBookingModal({ date: b.dataset.date, from: b.dataset.slot, courtId: id });
      } else if (act === 'confirm') {
        await api(`/api/courts/bookings/${id}/confirm`, { method: 'POST' });
        toast('الحجز اتأكد', 'ok'); render();
      } else if (act === 'play') {
        await api(`/api/courts/bookings/${id}/play`, { method: 'POST' });
        toast('اتسجل إنه اتلعب', 'ok'); render();
      } else if (act === 'cancel') {
        cancelModal(id);
      }
    } catch (err) { toast(err.message, 'bad'); }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'مدير ملعبنا', role: 'مدير' },
      { username: 'reception', name: 'هدى عبد الله', role: 'استقبال' },
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
    state.date = state.date || today();
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    $$('.side .nav-item[data-view]').forEach((x) => {
      x.onclick = () => { location.hash = '#/' + x.dataset.view; $('#side').classList.remove('open'); };
    });
    if (!location.hash) location.hash = '#/grid';
    route();
  }

  function renderUser() {
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = ROLE_AR[state.user.role] || state.user.role;
    $('#avatar').textContent = state.user.name.slice(0, 1);
  }

  function route() {
    if (!state.user) return;
    closeModal();
    state.view = (location.hash.replace('#/', '') || 'grid').split('/')[0];
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = { grid: renderGrid, bookings: renderBookings, courts: renderCourts, summary: renderSummary, shift: renderShift };
  // رسم متسلسل: تغيير الشاشة أثناء رسم شاشة أخرى كان يترك الشاشة القديمة
  // ترسم فوق الجديدة بعد انتهاء جلبها (أمسكه اختبار المتصفح على الديمو المنشور،
  // حيث الشبكة أبطأ: العنوان يقول «المرضى» والمحتوى يبقى «يوم العيادة»).
  let renderChain = Promise.resolve();
  function render() {
    const view = views[state.view] || renderGrid;
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

  /* ---------- الجدول ---------- */
  async function renderGrid() {
    const g = await api(`/api/courts/grid?date=${state.date}`);
    state.grid = g;
    const totalSlots = g.courts.reduce((s, c) => s + c.slots.length, 0);
    const busy = g.courts.reduce((s, c) => s + c.slots.filter((x) => x.state !== 'free').length, 0);
    const income = g.courts.reduce((s, c) => s + c.slots.filter((x) => x.state !== 'free').length * c.pricePerHour, 0);

    $('#content').innerHTML = `
      ${head('جدول اليوم', `${dmy(g.date)} — كل ملعب × كل ساعة`,
        `<input class="input" id="datePick" type="date" value="${esc(g.date)}" style="width:170px" />
         <button class="btn btn-primary" id="newBooking">＋ حجز جديد</button>`)}
      <div class="kpi" style="margin-bottom:14px">
        <div class="card"><div class="lbl">ساعات مشغولة</div><div class="val mono">${num(busy)} / ${num(totalSlots)}</div><div class="sub muted">على كل الملاعب</div></div>
        <div class="card"><div class="lbl">إشغال اليوم</div><div class="val mono">${num(totalSlots ? Math.round((busy / totalSlots) * 100) : 0)}%</div><div class="sub muted">محجوز ÷ متاح</div></div>
        <div class="card"><div class="lbl">قيمة محجوزة</div><div class="val mono">${money(income)}</div><div class="sub muted">سعر الساعة × الساعات المحجوزة</div></div>
        <div class="card"><div class="lbl">ملاعب</div><div class="val mono">${num(g.courts.length)}</div><div class="sub muted">${num(g.courts.filter((c) => c.kind === 'padel').length)} بادل</div></div>
      </div>
      <div class="legend mb-2">
        <span><i style="background:#fff;border:1px solid #cbd5e1"></i>فاضي</span>
        <span><i style="background:#fef3c7"></i>معلّق (ينتهي بعد ساعة)</span>
        <span><i style="background:#dbeafe"></i>مؤكد</span>
        <span><i style="background:#dcfce7"></i>اتلعب</span>
        <span><i style="background:#f3f4f6"></i>ملغي/منتهي</span>
      </div>
      <div id="gridWrap" style="display:grid;gap:14px"></div>`;

    $('#gridWrap').innerHTML = g.courts.map((c) => `
      <div class="card card-pad">
        <div class="row between mb-2">
          <b>${esc(c.name)} <span class="badge badge-brand">${esc(KIND_AR[c.kind] || c.kind)}</span></b>
          <span class="small muted mono">${money(c.pricePerHour)} / ساعة · ${esc(c.openFrom)}–${esc(c.openTo)}</span>
        </div>
        <div class="grid-wrap"><div class="slotgrid" style="grid-template-columns:repeat(auto-fill,minmax(66px,1fr))">
          ${c.slots.map((s) => `
            <button class="slot" data-state="${esc(s.state)}" data-act="slot" data-id="${esc(c.id)}"
              data-slot="${esc(s.slot)}" data-date="${esc(g.date)}"
              title="${esc(ST_AR[s.state] || s.state)}${s.customerName ? ' — ' + esc(s.customerName) : ''}">
              ${esc(s.slot)}
              <span class="who">${esc(s.customerName || ST_AR[s.state] || '')}</span>
            </button>`).join('')}
        </div></div>
      </div>`).join('');

    $('#datePick').onchange = (e) => { state.date = e.target.value || today(); renderGrid(); };
    $('#newBooking').onclick = () => openBookingModal();
  }

  /* ---------- حجز جديد ---------- */
  async function openBookingModal(prefill = {}) {
    const { courts } = await api('/api/courts');
    state.courts = courts;
    const courtId = prefill.courtId || (courts[0] && courts[0].id);
    openModal({
      title: 'حجز جديد',
      body: `
        <div class="field"><label class="label">الملعب</label>
          <select class="input" id="kCourt">
            ${courts.map((c) => `<option value="${esc(c.id)}" ${c.id === courtId ? 'selected' : ''}>${esc(c.name)} · ${esc(KIND_AR[c.kind] || c.kind)} · ${money(c.pricePerHour)}/ساعة</option>`).join('')}
          </select></div>
        <div class="field"><label class="label">التاريخ</label>
          <input class="input" id="kDate" type="date" value="${esc(prefill.date || state.date || today())}" /></div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">من</label><input class="input" id="kFrom" type="time" step="1800" value="${esc(prefill.from || '18:00')}" /></div>
          <div class="field" style="flex:1"><label class="label">إلى</label><input class="input" id="kTo" type="time" step="1800" value="${esc(nextHour(prefill.from || '18:00'))}" /></div>
        </div>
        <div class="field"><label class="label">اسم العميل</label><input class="input" id="kName" /></div>
        <div class="field"><label class="label">الموبايل</label><input class="input" id="kPhone" inputmode="tel" /></div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">العربون</label><input class="input" id="kDeposit" type="number" min="0" value="0" /></div>
          <div class="field" style="flex:1"><label class="label">طريقة الدفع</label>
            <select class="input" id="kMethod">${Object.entries(METHOD_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        </div>
        <label class="row" style="gap:8px;align-items:center"><input type="checkbox" id="kConfirm" /> <span class="small">تأكيد الحجز فوراً</span></label>
        <div class="small muted mt-2" id="kHint">السعر يُحسب في الخادم من سعر الملعب × المدة.</div>`,
      footer: `<button class="btn btn-primary" id="kSave">حجز</button>`,
    });
    const hint = () => {
      const c = courts.find((x) => x.id === $('#kCourt').value);
      const m = minutesBetween($('#kFrom').value, $('#kTo').value);
      $('#kHint').textContent = c
        ? `${c.name} · ${money(c.pricePerHour)}/ساعة × ${(m / 60).toFixed(1)} ساعة = ${money(c.pricePerHour * (m / 60))}`
        : '';
    };
    ['#kCourt', '#kFrom', '#kTo'].forEach((s) => { $(s).oninput = hint; $(s).onchange = hint; });
    hint();
    $('#kSave').onclick = async () => {
      try {
        const r = await api('/api/courts/bookings', {
          method: 'POST',
          body: {
            courtId: $('#kCourt').value, date: $('#kDate').value,
            from: $('#kFrom').value, to: $('#kTo').value,
            customerName: $('#kName').value.trim(), phone: $('#kPhone').value.trim(),
            deposit: Number($('#kDeposit').value) || 0, method: $('#kMethod').value,
            confirmed: $('#kConfirm').checked,
          },
        });
        closeModal();
        toast(`حجز #${r.booking.no} — ${money(r.booking.amount)}`, 'ok');
        state.date = r.booking.date;
        render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  function minutesBetween(a, b) {
    const m = (x) => { const [h, mi] = String(x || '00:00').split(':').map(Number); return h * 60 + (mi || 0); };
    return m(b) - m(a);
  }
  function nextHour(hhmm) {
    const [h] = String(hhmm || '18:00').split(':').map(Number);
    return `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`;
  }

  /* ---------- الحجوزات ---------- */
  async function renderBookings() {
    const q = state.bookingQuery || '';
    const url = q ? `/api/courts/bookings?q=${encodeURIComponent(q)}` : `/api/courts/bookings?date=${state.date}`;
    const { bookings } = await api(url);
    state.bookings = bookings;
    $('#content').innerHTML = `
      ${head('الحجوزات', q ? `بحث: ${esc(q)}` : `حجوزات ${dmy(state.date)}`,
        `<input class="input" id="bq" placeholder="ابحث بالموبايل" value="${esc(q)}" style="width:200px" />
         <input class="input" id="bdate" type="date" value="${esc(state.date)}" style="width:160px" />`)}
      ${table(['#', 'الملعب', 'التاريخ', 'من–إلى', 'العميل', 'الموبايل', 'المبلغ', 'العربون', 'الحالة', ''], 'rows')}`;
    $('#rows').innerHTML = bookings.length ? bookings.map((b) => `
      <tr>
        <td class="mono small">${num(b.no)}</td>
        <td class="small">${esc(b.courtName)}</td>
        <td class="mono small">${esc(b.date)}</td>
        <td class="mono small">${esc(b.from)}–${esc(b.to)}</td>
        <td><b>${esc(b.customerName)}</b></td>
        <td class="mono small">${esc(b.phone)}</td>
        <td class="mono">${money(b.amount)}</td>
        <td class="mono">${money(b.deposit)}${b.depositRefunded ? ` <span class="small muted">(رد ${money(b.depositRefunded)})</span>` : ''}</td>
        <td><span class="badge ${b.status === 'cancelled' || b.status === 'expired' ? 'badge-bad' : b.status === 'held' ? 'badge-warn' : 'badge-ok'}">${esc(ST_AR[b.status] || b.status)}</span></td>
        <td class="row" style="gap:6px;justify-content:flex-end">
          ${b.status === 'held' ? `<button class="btn btn-sm" data-act="confirm" data-id="${esc(b.id)}">تأكيد</button>` : ''}
          ${['confirmed'].includes(b.status) ? `<button class="btn btn-sm" data-act="play" data-id="${esc(b.id)}">اتلعب</button>` : ''}
          ${['held', 'confirmed'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${esc(b.id)}">إلغاء</button>` : ''}
        </td>
      </tr>`).join('') : emptyRow(10, 'مفيش حجوزات في النطاق ده');
    $('#bq').oninput = (e) => {
      clearTimeout(state._tm);
      state._tm = setTimeout(() => { state.bookingQuery = e.target.value.trim(); renderBookings(); }, 350);
    };
    $('#bdate').onchange = (e) => { state.date = e.target.value || today(); state.bookingQuery = ''; renderBookings(); };
  }

  function cancelModal(id) {
    const b = state.bookings.find((x) => x.id === id);
    openModal({
      title: `إلغاء حجز #${b ? b.no : ''}`,
      body: `<div class="small muted mb-2">الإلغاء قبل 12 ساعة من بداية الحجز يرد العربون؛ بعدها لا.</div>
             <div class="field"><label class="label">سبب الإلغاء</label><input class="input" id="cReason" /></div>`,
      footer: `<button class="btn btn-primary" id="cGo">إلغاء الحجز</button>`,
    });
    $('#cGo').onclick = async () => {
      try {
        const r = await api(`/api/courts/bookings/${id}/cancel`, { method: 'POST', body: { reason: $('#cReason').value.trim() } });
        closeModal();
        toast(r.refunded ? `اتلغى — اترد العربون ${money(r.refunded)}` : 'اتلغى — بلا رد عربون', r.refunded ? '' : 'bad');
        render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الملاعب ---------- */
  async function renderCourts() {
    const { courts } = await api('/api/courts');
    state.courts = courts;
    $('#content').innerHTML = `
      ${head('الملاعب والأسعار', 'سعر الساعة يُستخدم في حساب كل حجز — تعديله للمدير',
        isManager() ? '<button class="btn btn-primary" id="addCourt">＋ ملعب</button>' : '')}
      ${table(['الملعب', 'النوع', 'سعر الساعة', 'مواعيد العمل', 'ساعات متاحة/يوم', ''], 'rows')}`;
    $('#rows').innerHTML = courts.length ? courts.map((c) => {
      const h = minutesBetween(c.openFrom, c.openTo === '24:00' ? '00:00' : c.openTo) + (c.openTo === '24:00' ? 600 : 0);
      return `<tr>
        <td><b>${esc(c.name)}</b></td>
        <td class="small">${esc(KIND_AR[c.kind] || c.kind)}</td>
        <td class="mono">${money(c.pricePerHour)}</td>
        <td class="mono small">${esc(c.openFrom)}–${esc(c.openTo)}</td>
        <td class="mono">${num(Math.round(h / 60))}</td>
        <td>${isManager() ? `<button class="btn btn-ghost btn-sm" data-price="${esc(c.id)}">تعديل</button>` : ''}</td>
      </tr>`;
    }).join('') : emptyRow(6, 'مفيش ملاعب');
    $$('#rows [data-price]').forEach((btn) => (btn.onclick = () => {
      const c = courts.find((x) => x.id === btn.dataset.price);
      openModal({
        title: `تعديل — ${c.name}`,
        body: `<div class="field"><label class="label">سعر الساعة</label><input class="input" id="cPrice" type="number" min="0" value="${c.pricePerHour}" /></div>
               <div class="row" style="gap:8px">
                 <div class="field" style="flex:1"><label class="label">من</label><input class="input" id="cFrom" type="time" value="${esc(c.openFrom)}" /></div>
                 <div class="field" style="flex:1"><label class="label">إلى</label><input class="input" id="cTo" type="time" value="${esc(c.openTo)}" /></div>
               </div>`,
        footer: `<button class="btn btn-primary" id="cSave">حفظ</button>`,
      });
      $('#cSave').onclick = async () => {
        try {
          await api(`/api/courts/${c.id}`, {
            method: 'PUT',
            body: { pricePerHour: Number($('#cPrice').value), openFrom: $('#cFrom').value, openTo: $('#cTo').value },
          });
          closeModal(); toast('اتعدل', 'ok'); renderCourts();
        } catch (e) { toast(e.message, 'bad'); }
      };
    }));
    if ($('#addCourt')) $('#addCourt').onclick = () => {
      openModal({
        title: 'ملعب جديد',
        body: `<div class="field"><label class="label">الاسم</label><input class="input" id="ncName" /></div>
          <div class="field"><label class="label">النوع</label><select class="input" id="ncKind">
            <option value="football">خماسي</option><option value="padel">بادل</option></select></div>
          <div class="field"><label class="label">سعر الساعة</label><input class="input" id="ncPrice" type="number" min="0" value="300" /></div>
          <div class="row" style="gap:8px">
            <div class="field" style="flex:1"><label class="label">من</label><input class="input" id="ncFrom" type="time" value="14:00" /></div>
            <div class="field" style="flex:1"><label class="label">إلى</label><input class="input" id="ncTo" type="time" value="23:00" /></div>
          </div>`,
        footer: `<button class="btn btn-primary" id="ncSave">حفظ</button>`,
      });
      $('#ncSave').onclick = async () => {
        try {
          await api('/api/courts', {
            method: 'POST',
            body: {
              name: $('#ncName').value.trim(), kind: $('#ncKind').value,
              pricePerHour: Number($('#ncPrice').value),
              openFrom: $('#ncFrom').value, openTo: $('#ncTo').value,
            },
          });
          closeModal(); toast('اتضاف', 'ok'); renderCourts();
        } catch (e) { toast(e.message, 'bad'); }
      };
    };
  }

  /* ---------- التقارير ---------- */
  async function renderSummary() {
    const s = await api('/api/courts/summary?range=today');
    $('#content').innerHTML = `
      ${head('تقارير اليوم', dmy(s.date))}
      <div class="kpi">
        <div class="card"><div class="lbl">حجوزات</div><div class="val mono">${num(s.bookings)}</div><div class="sub muted">مؤكدة + معلّقة</div></div>
        <div class="card"><div class="lbl">قيمة الحجوزات</div><div class="val mono">${money(s.revenue)}</div><div class="sub muted">سعر الملعب × المدة</div></div>
        <div class="card"><div class="lbl">عربونات محصّلة</div><div class="val mono">${money(s.deposits)}</div><div class="sub muted">مردود ${money(s.refunds)}</div></div>
        <div class="card"><div class="lbl">صافي الدرج من العربونات</div><div class="val mono">${money(s.net)}</div><div class="sub muted">محصّل − مردود</div></div>
      </div>
      <div class="row" style="gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:300px"><div class="card card-pad"><b>إشغال كل ملعب</b>
          ${table(['الملعب', 'حجوزات', 'دقائق محجوزة', 'إشغال'], 'occRows')}</div></div>
        <div style="flex:1;min-width:260px"><div class="card card-pad"><b>أكثر الأوقات طلباً</b>
          ${table(['الساعة', 'حجوزات'], 'peakRows')}</div></div>
      </div>`;
    $('#occRows').innerHTML = (s.courts || []).length ? s.courts.map((c) => `
      <tr><td>${esc(c.name)}</td><td class="mono">${num(c.booked)}</td>
        <td class="mono">${num(c.usedMinutes)} / ${num(c.availableMinutes)}</td>
        <td class="mono"><b>${num(c.occupancy)}%</b></td></tr>`).join('') : emptyRow(4, 'مفيش ملاعب');
    $('#peakRows').innerHTML = (s.peakHours || []).length
      ? s.peakHours.map((x) => `<tr><td class="mono">${esc(x.from)}</td><td class="mono">${num(x.count)}</td></tr>`).join('')
      : emptyRow(2, 'مفيش حجوزات النهارده');
  }

  /* ---------- الوردية ---------- */
  async function renderShift() {
    const { openShift } = await api('/api/courts/shift');
    $('#content').innerHTML = `
      ${head('الوردية والدرج', 'عربون الكاش يدخل الدرج؛ العربون المردود يخرج منه بحركة معتمدة')}
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
      try { await api('/api/courts/shift', { method: 'POST', body: { action: 'open', openingCash: Number($('#opening').value) || 0 } }); toast('الوردية اتفتحت', 'ok'); renderShift(); } catch (e) { toast(e.message, 'bad'); }
    };
    if ($('#closeShift')) $('#closeShift').onclick = async () => {
      try {
        const { shift } = await api('/api/courts/shift', { method: 'POST', body: { action: 'close', countedCash: Number($('#counted').value) || 0 } });
        toast(`الفرق ${money(shift.difference)} ${shift.difference === 0 ? '— مطابق تماماً' : ''}`, shift.difference === 0 ? 'ok' : 'bad');
        renderShift();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }
})();
