/* ===== Nile Systems — لوحة المواقع =====
 *
 * التطبيق السابع: يدير المواقع السبعة التي بُنيت كصفحات مستقلة.
 * مستخدموه (مدير الموقع/مدير نشاط)، مساراته /api/sites.
 *
 * القاعدة الحاكمة: حالة كل موقع تُعرض كما هي في صفحته — ما يعمل مكتوب أنه
 * يعمل، وما لم يُبنَ مكتوب أنه قيد التنفيذ. اللوحة لا تجمّل الحقيقة، وعدد
 * الأنظمة العاملة يصل من سجل المواصفات نفسه لا من رقم مكتوب في الشاشة.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'admin';

  const state = { user: null, view: 'overview', sites: [], leads: [], summary: null };
  const ST_AR = { live: 'يعمل الآن', coming: 'قيد التنفيذ' };
  const LEAD_AR = { new: 'جديدة', replied: 'تم الرد', closed: 'مغلقة' };
  const LEAD_BADGE = { new: 'badge-warn', replied: 'badge-info', closed: 'badge-ok' };
  const ROLE_AR = { admin: 'مدير الموقع', manager: 'مدير نشاط' };
  const isAdmin = () => state.user && state.user.role === 'admin';

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
      if (act === 'replied' || act === 'closed') await setLeadStatus(id, act);
      else if (act === 'edit') editSite(id);
      else if (act === 'openSite') window.open(b.dataset.url, '_blank');
    } catch (err) { toast(err.message, 'bad'); }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'admin', name: 'مدير الموقع', role: 'مدير الموقع' },
      { username: 'manager', name: 'مسؤول موقع الأزياء', role: 'مدير نشاط' },
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
    const want = (location.hash.replace('#/', '') || 'overview').split('/')[0];
    state.view = views[want] ? want : 'overview';
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = {
    overview: renderOverview, sites: renderSites, content: renderContent,
    leads: renderLeads, views: renderViews, summary: renderSummary,
  };
  // رسم متسلسل — لا شاشة قديمة ترسم فوق المطلوبة (نفس درس بقية الأنظمة).
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
  const statusBadge = (s, active = true) => (!active
    ? '<span class="badge st-off">موقوف</span>'
    : `<span class="badge st-${s}">${esc(ST_AR[s] || s)}</span>`);

  async function loadSites() {
    const { sites, date } = await api('/api/sites');
    state.sites = sites;
    state.date = date;
    return sites;
  }

  /* ---------- نظرة عامة ---------- */
  async function renderOverview() {
    const [sites, s] = await Promise.all([loadSites(), api('/api/sites/summary')]);
    state.summary = s;
    $('#content').innerHTML = `
      ${head('نظرة عامة', `${dmy(s.date)} — الأنظمة والمواقع والرسائل من مصدر واحد`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">أنظمة تعمل</div><div class="val mono">${num(s.systems.live)}/${num(s.systems.total)}</div><div class="sub muted">من سجل المواصفات</div></div>
        <div class="card"><div class="lbl">مواقع تعمل</div><div class="val mono">${num(s.sites.live)}/${num(s.sites.total)}</div><div class="sub muted">${num(s.sites.coming)} قيد التنفيذ</div></div>
        <div class="card"><div class="lbl">رسائل اليوم</div><div class="val mono">${num(s.leads.today)}</div><div class="sub muted">${num(s.leads.new)} بلا رد</div></div>
        <div class="card"><div class="lbl">نسبة الرد</div><div class="val mono">${num(s.leads.replyRate)}%</div><div class="sub muted">${num(s.leads.total)} رسالة إجمالاً</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px" id="cards"></div>`;
    $('#cards').innerHTML = sites.map((x) => `
      <div class="site-card">
        <div class="top"><span class="hd">${esc(x.name)}</span>${statusBadge(x.status, x.active)}</div>
        <div class="small muted mt-1">${esc(x.headline || '')}</div>
        <div class="row between mt-2 small">
          <span class="mono">👁️ ${num(x.viewsToday)} اليوم</span>
          <span class="mono">📨 ${num(x.leadsNew)} جديد / ${num(x.leadsTotal)}</span>
        </div>
        <div class="row mt-2" style="gap:6px">
          <button class="btn btn-sm" data-act="openSite" data-url="${esc(x.url)}">افتح الموقع ↗</button>
        </div>
      </div>`).join('');
  }

  /* ---------- المواقع ---------- */
  async function renderSites() {
    const sites = await loadSites();
    $('#content').innerHTML = `
      ${head('المواقع', `${num(sites.length)} موقع — الحالة من صفحة كل موقع لا من اللوحة`,
        `<a class="btn btn-ghost" href="/sites/" target="_blank">صفحة المواقع السبعة ↗</a>`)}
      ${table(['الموقع', 'الرابط', 'الحالة', 'زيارات اليوم', 'رسائل جديدة', ''], 'rows')}`;
    $('#rows').innerHTML = sites.length ? sites.map((x) => `
      <tr>
        <td><b>${esc(x.name)}</b><div class="small muted">${esc(x.headline || '')}</div></td>
        <td class="mono small">${esc(x.url)}</td>
        <td>${statusBadge(x.status, x.active)}</td>
        <td class="mono">${num(x.viewsToday)}</td>
        <td class="mono">${x.leadsNew ? `<span class="badge badge-warn">${num(x.leadsNew)}</span>` : '0'}</td>
        <td class="row" style="gap:6px;justify-content:flex-end">
          ${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(x.slug)}">تعديل</button>` : ''}
          <button class="btn btn-sm" data-act="openSite" data-url="${esc(x.url)}">فتح ↗</button>
        </td>
      </tr>`).join('') : emptyRow(6, 'مفيش مواقع في نطاقك');
  }

  /* ---------- المحتوى ---------- */
  async function renderContent() {
    const sites = await loadSites();
    $('#content').innerHTML = `
      ${head('المحتوى', 'عنوان الصفحة والتليفون والواتساب — يُحدَّث من هنا بلا كود',
        isAdmin() ? '' : '<span class="badge badge-warn">مدير النشاط يقرأ فقط</span>')}
      ${table(['الموقع', 'العنوان المعروض', 'تليفون', 'واتساب', ''], 'rows')}`;
    $('#rows').innerHTML = sites.length ? sites.map((x) => `
      <tr>
        <td><b>${esc(x.name)}</b><div class="small muted mono">/sites/${esc(x.slug)}.html</div></td>
        <td class="small">${esc(x.headline || '—')}</td>
        <td class="mono small">${esc(x.phone || '—')}</td>
        <td class="mono small">${esc(x.whatsapp || '—')}</td>
        <td>${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(x.slug)}">تعديل</button>` : ''}</td>
      </tr>`).join('') : emptyRow(5, 'مفيش مواقع');
  }

  function editSite(slug) {
    const x = state.sites.find((s) => s.slug === slug);
    if (!x) return;
    openModal({
      title: `تعديل ${x.name}`,
      body: `
        <div class="field"><label class="label">العنوان المعروض</label><input class="input" id="edHd" value="${esc(x.headline || '')}" /></div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">تليفون</label><input class="input" id="edPh" value="${esc(x.phone || '')}" /></div>
          <div class="field" style="flex:1"><label class="label">واتساب (أرقام فقط)</label><input class="input" id="edWa" value="${esc(x.whatsapp || '')}" /></div>
        </div>
        <label class="row" style="gap:8px;align-items:center;margin-top:4px">
          <input type="checkbox" id="edAct" ${x.active ? 'checked' : ''} /> <span>الموقع نشط</span>
        </label>
        <div class="small muted mt-2">الحالة (يعمل / قيد التنفيذ) تُقرأ من صفحة الموقع ولا تتغيّر من هنا — لوحة لا تجمّل الحقيقة.</div>`,
      footer: `<button class="btn btn-primary" id="edSave">حفظ</button>`,
    });
    $('#edSave').onclick = async () => {
      try {
        await api(`/api/sites/${slug}`, {
          method: 'PUT',
          body: {
            headline: $('#edHd').value.trim(), phone: $('#edPh').value.trim(),
            whatsapp: $('#edWa').value.trim(), active: $('#edAct').checked,
          },
        });
        closeModal(); toast('اتحفظ', 'ok'); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الرسائل ---------- */
  async function renderLeads(status) {
    const filter = status === undefined ? (state.leadFilter || '') : status;
    state.leadFilter = filter;
    const { leads } = await api('/api/sites/leads' + (filter ? `?status=${filter}` : ''));
    state.leads = leads;
    const chips = [['', 'الكل'], ['new', 'جديدة'], ['replied', 'تم الرد'], ['closed', 'مغلقة']]
      .map(([k, v]) => `<button class="chip ${filter === k ? 'active' : ''}" data-filter="${k}">${v}</button>`).join('');
    $('#content').innerHTML = `
      ${head('الرسائل', 'كل رسالة بمصدرها — والحالة لا ترجع للخلف', `<div class="row" style="gap:6px">${chips}</div>`)}
      ${table(['الوقت', 'الموقع', 'الاسم', 'الموبايل', 'الرسالة', 'الحالة', ''], 'rows')}`;
    $('#rows').innerHTML = leads.length ? leads.map((l) => `
      <tr data-lead="${esc(l.id)}" data-status="${esc(l.status)}">
        <td class="mono small">${dmy(l.at)}<br>${hm(l.at)}</td>
        <td class="small">${esc(l.siteName || l.siteSlug)}</td>
        <td><b>${esc(l.name)}</b></td>
        <td class="mono small"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></td>
        <td class="small lead-row-msg">${esc(l.message || '—')}</td>
        <td><span class="badge ${LEAD_BADGE[l.status] || 'badge-warn'}">${esc(LEAD_AR[l.status] || l.status)}</span></td>
        <td class="row" style="gap:6px;justify-content:flex-end">
          ${l.status === 'new' ? `<button class="btn btn-sm" data-act="replied" data-id="${esc(l.id)}">تم الرد</button>` : ''}
          ${l.status !== 'closed' ? `<button class="btn btn-ghost btn-sm" data-act="closed" data-id="${esc(l.id)}">إغلاق</button>` : ''}
        </td>
      </tr>`).join('') : emptyRow(7, 'مفيش رسائل بالحالة دي');
    $$('#content .chip[data-filter]').forEach((b) => (b.onclick = () => renderLeads(b.dataset.filter)));
  }

  async function setLeadStatus(id, status) {
    await api(`/api/sites/leads/${id}/status`, { method: 'POST', body: { status } });
    toast(status === 'replied' ? 'اتعلّمت «تم الرد»' : 'اتقفلت', 'ok');
    renderLeads();
  }

  /* ---------- الزيارات ---------- */
  async function renderViews() {
    const [sites, s] = await Promise.all([loadSites(), api('/api/sites/summary')]);
    state.summary = s;
    const max = Math.max(1, ...s.perSite.map((x) => x.views));
    $('#content').innerHTML = `
      ${head('الزيارات', `${dmy(s.date)} — زيارة واحدة لكل جلسة في اليوم`)}
      <div class="card card-pad">
        ${sites.map((x) => `
          <div class="row between" style="gap:10px;align-items:center;margin-bottom:10px">
            <span class="small" style="min-width:130px"><b>${esc(x.name)}</b></span>
            <span style="flex:1;background:var(--line);border-radius:999px;height:10px;overflow:hidden">
              <span style="display:block;height:100%;width:${Math.round((x.viewsToday / max) * 100)}%;background:var(--brand)"></span>
            </span>
            <span class="mono small" style="min-width:48px;text-align:end">${num(x.viewsToday)}</span>
          </div>`).join('') || '<div class="muted center">مفيش مواقع</div>'}
        <div class="small muted mt-2">العدّاد لا يتضاعف بإعادة تحميل الصفحة من نفس المتصفح، ولا يُسجَّل بلا زيارة فعلية.</div>
      </div>`;
  }

  /* ---------- التقارير ---------- */
  async function renderSummary() {
    const s = await api('/api/sites/summary');
    state.summary = s;
    $('#content').innerHTML = `
      ${head('التقارير', 'أين تجذب المواقع أكثر — ومن لم يُرَد عليه')}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">أكثر موقع جذباً</div><div class="val" style="font-size:20px">${esc(s.topSite ? s.topSite.name : '—')}</div><div class="sub muted">${s.topSite ? `${num(s.topSite.leads)} رسالة · ${num(s.topSite.views)} زيارة` : 'لا بيانات'}</div></div>
        <div class="card"><div class="lbl">نسبة الرد</div><div class="val mono">${num(s.leads.replyRate)}%</div><div class="sub muted">${num(s.leads.total)} رسالة</div></div>
        <div class="card"><div class="lbl">بلا رد</div><div class="val mono" style="color:var(--warn)">${num(s.leads.unanswered)}</div><div class="sub muted">تحتاج متابعة</div></div>
        <div class="card"><div class="lbl">أنظمة تعمل</div><div class="val mono">${num(s.systems.live)}/${num(s.systems.total)}</div><div class="sub muted mono">${esc(s.systems.source)}</div></div>
      </div>
      ${table(['الموقع', 'زيارات اليوم', 'رسائل اليوم'], 'rows')}`;
    $('#rows').innerHTML = s.perSite.length ? s.perSite.map((x) => `
      <tr><td><b>${esc(x.name)}</b></td><td class="mono">${num(x.views)}</td><td class="mono">${num(x.leads)}</td></tr>`).join('')
      : emptyRow(3, 'مفيش بيانات');
  }
})();
