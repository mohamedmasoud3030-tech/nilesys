/* ===== Nile Systems — نظام الموارد البشرية =====
 *
 * نظام مستقل: مستخدموه (مدير/موارد بشرية/موظف)، مساراته /api/hr، وشاشته الخاصة.
 * الموظف يرى سجله فقط؛ والشاشات المالية لا تظهر له إطلاقاً.
 *
 * القاعدة الحاكمة: مرتب معتمد لا يُعاد حسابه، والمصروف لا يُعدَّل — الشاشة تتبع
 * نفس القواعد ولا تعرض أزراراً لا تنجح.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'hr';

  const state = { user: null, view: 'day', date: null, employees: [], month: null, payroll: null };
  const ST_AR = {
    present: 'حاضر', late: 'متأخر', absent: 'غائب', leave: 'إجازة',
    absent_not_recorded: 'لم يُسجَّل', not_in: 'لم يُسجَّل', paid: 'مصروف', approved: 'معتمد', draft: 'مسودة',
  };
  const KIND_AR = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بدون أجر' };
  const ROLE_AR = { manager: 'مدير', hr: 'موارد بشرية', employee: 'موظف' };
  const isManager = () => state.user && state.user.role === 'manager';
  const isOfficer = () => state.user && (state.user.role === 'hr' || state.user.role === 'manager');
  const isEmployee = () => state.user && state.user.role === 'employee';
  const today = () => new Date().toISOString().slice(0, 10);
  const thisMonth = () => today().slice(0, 7);

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
      if (act === 'in') attendModal(id);
      else if (act === 'fix') fixModal(id);
      else if (act === 'decide') decideLeave(id, true);
      else if (act === 'reject') decideLeave(id, false);
      else if (act === 'slip') showSlip(id);
    } catch (err) { toast(err.message, 'bad'); }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'مها رشدي', role: 'مدير' },
      { username: 'officer', name: 'رنا فتحي', role: 'موارد بشرية' },
      { username: 'employee', name: 'نادين حسام', role: 'موظف' },
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
    state.month = state.month || thisMonth();
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    renderUser();
    // الشاشات المالية للموظف مخفية — نفس قاعدة الخادم، مطبقة في الواجهة.
    $$('.side .nav-item[data-roles]').forEach((x) => {
      const roles = x.dataset.roles.split(',');
      x.style.display = roles.includes(state.user.role) ? '' : 'none';
    });
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
    let want = (location.hash.replace('#/', '') || (isEmployee() ? 'me' : 'day')).split('/')[0];
    if (!views[want] || !canSee(want, state.user.role)) {
      want = isEmployee() ? 'me' : 'day';
      if (location.hash !== '#/' + want) location.hash = '#/' + want;
    }
    state.view = want;
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = {
    day: renderDay, attendance: renderAttendance, employees: renderEmployees,
    leaves: renderLeaves, payroll: renderPayroll, me: renderMe,
  };
  // من يرى ماذا — نفس تقسيم الخادم. الموظف يرى سجله فقط، وأي رابط آخر يعيده لسجله.
  const VIEW_ROLES = {
    day: ['manager', 'hr'], attendance: ['manager', 'hr'], employees: ['manager', 'hr'],
    leaves: ['manager', 'hr'], payroll: ['manager', 'hr'], me: ['manager', 'hr', 'employee'],
  };
  const canSee = (v, role) => !VIEW_ROLES[v] || VIEW_ROLES[v].includes(role);
  // رسم متسلسل: تغيير الشاشة أثناء رسم شاشة أخرى كان يترك الشاشة القديمة
  // ترسم فوق الجديدة بعد انتهاء جلبها (أمسكه اختبار المتصفح على الديمو المنشور،
  // حيث الشبكة أبطأ: العنوان يقول «المرضى» والمحتوى يبقى «يوم العيادة»).
  let renderChain = Promise.resolve();
  function render() {
    const view = views[state.view] || renderDay;
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

  /* ---------- لوحة اليوم ---------- */
  async function renderDay() {
    const d = await api(`/api/hr/day?date=${state.date}`);
    const emp = await api('/api/hr/employees');
    state.employees = emp.employees;
    $('#content').innerHTML = `
      ${head('لوحة اليوم', `${dmy(d.date)} — من جاء، من تأخر، ومن لم يسجّل بعد`,
        `<input class="input" id="dayPick" type="date" value="${esc(d.date)}" style="width:170px" />`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">حاضر</div><div class="val mono">${num(d.present)}</div><div class="sub muted">سجّل دخول في الوقت</div></div>
        <div class="card"><div class="lbl">متأخر</div><div class="val mono" style="color:var(--warn)">${num(d.late)}</div><div class="sub muted">بعد 09:15</div></div>
        <div class="card"><div class="lbl">إجازة</div><div class="val mono">${num(d.leave)}</div><div class="sub muted">معتمدة</div></div>
        <div class="card"><div class="lbl">بلا انصراف</div><div class="val mono" style="color:var(--bad)">${num(d.noCheckout)}</div><div class="sub muted">نصف يوم حتى التصحيح</div></div>
      </div>
      <div class="board" id="board"></div>`;
    $('#board').innerHTML = d.board.map((b) => `
      <div class="emp">
        <div class="nm">${esc(b.name)}</div>
        <div class="small muted">${esc(b.jobTitle)} · ${esc(b.code)}</div>
        <div class="st st-${esc(b.state)}">${esc(ST_AR[b.state] || b.state)}</div>
        <div class="small muted mt-1 mono">${b.in ? `دخول ${esc(b.in)}` : '—'}${b.out ? ` · خروج ${esc(b.out)}` : ''}</div>
        ${isOfficer() && ['absent_not_recorded'].includes(b.state) ? `<button class="btn btn-sm mt-1" data-act="in" data-id="${esc(b.employeeId)}">تسجيل حضور</button>` : ''}
      </div>`).join('');
    $('#dayPick').onchange = (e) => { state.date = e.target.value || today(); renderDay(); };
  }

  /* ---------- الحضور ---------- */
  async function renderAttendance() {
    const [d, emp] = await Promise.all([api(`/api/hr/attendance?date=${state.date}&board=1`), api('/api/hr/employees')]);
    state.employees = emp.employees;
    $('#content').innerHTML = `
      ${head('الحضور', `${dmy(d.date)} — تسجيل دخول/خروج وتصحيح بسبب`,
        `<input class="input" id="aDate" type="date" value="${esc(d.date)}" style="width:170px" />
         <button class="btn btn-primary" id="addAtt">＋ تسجيل حضور</button>`)}
      ${table(['الموظف', 'الوظيفة', 'الحالة', 'دخول', 'خروج', ''], 'rows')}`;
    $('#rows').innerHTML = (d.board || []).length ? d.board.map((b) => `
      <tr>
        <td><b>${esc(b.name)}</b><div class="small muted mono">${esc(b.code)}</div></td>
        <td class="small">${esc(b.jobTitle)}</td>
        <td><span class="st st-${esc(b.state)}">${esc(ST_AR[b.state] || b.state)}</span></td>
        <td class="mono small">${b.in ? esc(b.in) : '—'}</td>
        <td class="mono small">${b.out ? esc(b.out) : (b.in ? '<span class="muted">ناقص</span>' : '—')}</td>
        <td>${b.attendanceId ? `<button class="btn btn-ghost btn-sm" data-act="fix" data-id="${esc(b.attendanceId)}">تصحيح</button>`
          : `<button class="btn btn-sm" data-act="in" data-id="${esc(b.employeeId)}">تسجيل</button>`}</td>
      </tr>`).join('') : emptyRow(6, 'مفيش موظفين');
    $('#aDate').onchange = (e) => { state.date = e.target.value || today(); renderAttendance(); };
    $('#addAtt').onclick = () => attendModal();
  }

  function attendModal(employeeId) {
    const emps = state.employees.filter((e) => e.active !== false);
    openModal({
      title: 'تسجيل حضور',
      body: `
        <div class="field"><label class="label">الموظف</label><select class="input" id="atEmp">
          ${emps.map((e) => `<option value="${esc(e.id)}" ${e.id === employeeId ? 'selected' : ''}>${esc(e.name)} · ${esc(e.code)}</option>`).join('')}
        </select></div>
        <div class="field"><label class="label">التاريخ</label><input class="input" id="atDate" type="date" value="${esc(state.date || today())}" /></div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">دخول</label><input class="input" id="atIn" type="time" value="09:00" /></div>
          <div class="field" style="flex:1"><label class="label">خروج (اختياري)</label><input class="input" id="atOut" type="time" /></div>
        </div>
        <div class="small muted">بلا وقت خروج = نصف يوم يُخصم حتى يُصحَّح بسبب.</div>`,
      footer: `<button class="btn btn-primary" id="atSave">حفظ</button>`,
    });
    $('#atSave').onclick = async () => {
      try {
        await api('/api/hr/attendance', {
          method: 'POST',
          body: {
            employeeId: $('#atEmp').value, date: $('#atDate').value,
            in: $('#atIn').value || null, out: $('#atOut').value || null,
          },
        });
        closeModal(); toast('اتسجل', 'ok'); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  function fixModal(attendanceId) {
    openModal({
      title: 'تصحيح تسجيل الحضور',
      body: `<div class="field"><label class="label">دخول</label><input class="input" id="fxIn" type="time" /></div>
             <div class="field"><label class="label">خروج</label><input class="input" id="fxOut" type="time" value="17:00" /></div>
             <div class="field"><label class="label">سبب التصحيح (مطلوب)</label><input class="input" id="fxWhy" /></div>`,
      footer: `<button class="btn btn-primary" id="fxSave">حفظ</button>`,
    });
    $('#fxSave').onclick = async () => {
      try {
        const body = { reason: $('#fxWhy').value.trim() };
        if ($('#fxIn').value) body.in = $('#fxIn').value;
        if ($('#fxOut').value) body.out = $('#fxOut').value;
        await api(`/api/hr/attendance/${attendanceId}/fix`, { method: 'POST', body });
        closeModal(); toast('اتصحّح', 'ok'); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الموظفون ---------- */
  async function renderEmployees() {
    const { employees } = await api('/api/hr/employees');
    state.employees = employees;
    $('#content').innerHTML = `
      ${head('الموظفون', `${num(employees.length)} موظف — الراتب الأساسي والبدلات هما أساس المرتب`,
        isOfficer() ? '<button class="btn btn-primary" id="addEmp">＋ موظف</button>' : '')}
      ${table(['الكود', 'الاسم', 'الوظيفة', 'الأساسي', 'البدلات', 'قيمة اليوم', 'التعيين', 'نشط'], 'rows')}`;
    $('#rows').innerHTML = employees.length ? employees.map((e) => `
      <tr>
        <td class="mono small">${esc(e.code)}</td>
        <td><b>${esc(e.name)}</b></td>
        <td class="small">${esc(e.jobTitle)}</td>
        <td class="mono">${money(e.baseSalary)}</td>
        <td class="mono">${money(e.allowances)}</td>
        <td class="mono">${money(e.dayValue)}</td>
        <td class="small muted">${dmy(e.hireDate)}</td>
        <td>${e.active !== false ? '<span class="badge badge-ok">نشط</span>' : '<span class="badge badge-bad">موقوف</span>'}</td>
      </tr>`).join('') : emptyRow(8, 'مفيش موظفين');
    if ($('#addEmp')) $('#addEmp').onclick = () => {
      openModal({
        title: 'موظف جديد',
        body: `<div class="field"><label class="label">الاسم</label><input class="input" id="neName" /></div>
          <div class="field"><label class="label">الوظيفة</label><input class="input" id="neJob" value="موظف" /></div>
          <div class="row" style="gap:8px">
            <div class="field" style="flex:1"><label class="label">الأساسي</label><input class="input" id="neBase" type="number" min="0" value="6000" /></div>
            <div class="field" style="flex:1"><label class="label">البدلات</label><input class="input" id="neAllow" type="number" min="0" value="500" /></div>
          </div>`,
        footer: `<button class="btn btn-primary" id="neSave">حفظ</button>`,
      });
      $('#neSave').onclick = async () => {
        try {
          await api('/api/hr/employees', {
            method: 'POST',
            body: {
              name: $('#neName').value.trim(), jobTitle: $('#neJob').value.trim(),
              baseSalary: Number($('#neBase').value), allowances: Number($('#neAllow').value),
            },
          });
          closeModal(); toast('اتضاف', 'ok'); renderEmployees();
        } catch (e) { toast(e.message, 'bad'); }
      };
    };
  }

  /* ---------- الإجازات ---------- */
  async function renderLeaves() {
    const { leaves } = await api('/api/hr/leaves');
    const { employees } = await api('/api/hr/employees');
    state.employees = employees;
    $('#content').innerHTML = `
      ${head('الإجازات', 'المعتمدة لا تُحسب غياباً؛ المرفوضة تُحسب',
        `<button class="btn btn-primary" id="addLeave">＋ طلب إجازة</button>`)}
      ${table(['الموظف', 'النوع', 'من', 'إلى', 'الحالة', 'السبب', ''], 'rows')}`;
    $('#rows').innerHTML = leaves.length ? leaves.map((l) => `
      <tr>
        <td><b>${esc(l.employeeName)}</b></td>
        <td class="small">${esc(KIND_AR[l.kind] || l.kind)}</td>
        <td class="mono small">${esc(l.from)}</td>
        <td class="mono small">${esc(l.to)}</td>
        <td><span class="badge ${l.status === 'approved' ? 'badge-ok' : l.status === 'rejected' ? 'badge-bad' : 'badge-warn'}">
          ${l.status === 'approved' ? 'معتمدة' : l.status === 'rejected' ? 'مرفوضة' : 'منتظرة'}</span></td>
        <td class="small muted">${esc(l.reason || '—')}</td>
        <td class="row" style="gap:6px;justify-content:flex-end">
          ${l.status === 'pending' && isOfficer() ? `<button class="btn btn-sm" data-act="decide" data-id="${esc(l.id)}">اعتماد</button>
            <button class="btn btn-ghost btn-sm" data-act="reject" data-id="${esc(l.id)}">رفض</button>` : ''}
        </td>
      </tr>`).join('') : emptyRow(7, 'مفيش إجازات');
    $('#addLeave').onclick = () => {
      openModal({
        title: 'طلب إجازة',
        body: `<div class="field"><label class="label">الموظف</label><select class="input" id="lvEmp">
            ${employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label class="label">النوع</label><select class="input" id="lvKind">
            ${Object.entries(KIND_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="row" style="gap:8px">
            <div class="field" style="flex:1"><label class="label">من</label><input class="input" id="lvFrom" type="date" /></div>
            <div class="field" style="flex:1"><label class="label">إلى</label><input class="input" id="lvTo" type="date" /></div>
          </div>
          <div class="field"><label class="label">السبب</label><input class="input" id="lvWhy" /></div>`,
        footer: `<button class="btn btn-primary" id="lvSave">إرسال</button>`,
      });
      $('#lvSave').onclick = async () => {
        try {
          await api('/api/hr/leaves', {
            method: 'POST',
            body: {
              employeeId: $('#lvEmp').value, kind: $('#lvKind').value,
              from: $('#lvFrom').value, to: $('#lvTo').value, reason: $('#lvWhy').value.trim(),
            },
          });
          closeModal(); toast('الطلب اتبعت', 'ok'); renderLeaves();
        } catch (e) { toast(e.message, 'bad'); }
      };
    };
  }

  async function decideLeave(id, approve) {
    await api(`/api/hr/leaves/${id}/decide`, { method: 'POST', body: { approve } });
    toast(approve ? 'اتعمدت' : 'اترفضت', 'ok');
    renderLeaves();
  }

  /* ---------- المرتبات ---------- */
  async function renderPayroll() {
    const data = await api(`/api/hr/payroll/${state.month}`);
    state.payroll = data;
    const rows = data.rows || [];
    const monthStatus = rows.length ? rows[0].status : 'none';
    const total = rows.reduce((s, r) => s + r.net, 0);
    $('#content').innerHTML = `
      ${head('المرتبات', `${esc(state.month)} — الأساسي + البدلات − الغياب − التأخير − السلف`,
        `<input class="input" id="payMonth" type="month" value="${esc(state.month)}" style="width:170px" />
         ${isOfficer() && (monthStatus === 'draft' || monthStatus === 'none') ? `<button class="btn ${rows.length ? 'btn-ghost' : 'btn-primary'}" id="runBtn">${rows.length ? 'إعادة الحساب' : 'حساب الشهر'}</button>` : ''}
         ${isOfficer() && monthStatus === 'draft' ? '<button class="btn btn-primary" id="approveBtn">اعتماد</button>' : ''}
         ${isManager() && monthStatus === 'approved' ? '<button class="btn btn-primary" id="payBtn">صرف المرتبات</button>' : ''}`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">موظفون</div><div class="val mono">${num(rows.length)}</div><div class="sub muted">${esc(ST_AR[monthStatus] || 'لم يُحسب')}</div></div>
        <div class="card"><div class="lbl">إجمالي الصافي</div><div class="val mono">${money(total)}</div><div class="sub muted">قبل الصرف</div></div>
        <div class="card"><div class="lbl">خصومات الغياب</div><div class="val mono">${money(rows.reduce((s, r) => s + r.absenceDeduction, 0))}</div><div class="sub muted">من سجلات الحضور</div></div>
        <div class="card"><div class="lbl">خصم التأخير</div><div class="val mono">${money(rows.reduce((s, r) => s + r.lateDeduction, 0))}</div><div class="sub muted">ربع يوم لكل تأخير</div></div>
      </div>
      ${table(['الموظف', 'الأساسي', 'بدلات', 'إضافي', 'غياب', 'تأخير', 'سلف', 'الصافي', 'الحالة', ''], 'rows')}`;
    $('#rows').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td><b>${esc(r.employeeName)}</b><div class="small muted mono">${esc(r.code)}</div></td>
        <td class="mono">${money(r.base)}</td>
        <td class="mono">${money(r.allowances)}</td>
        <td class="mono">${r.bonus ? money(r.bonus) : '<span class="muted">—</span>'}</td>
        <td class="mono" style="color:var(--bad)">${r.absenceDeduction ? `− ${money(r.absenceDeduction)}<div class="small muted">${r.absenceDays} يوم</div>` : '<span class="muted">—</span>'}</td>
        <td class="mono">${r.lateDeduction ? '− ' + money(r.lateDeduction) : '<span class="muted">—</span>'}</td>
        <td class="mono">${r.advance ? '− ' + money(r.advance) : '<span class="muted">—</span>'}</td>
        <td class="mono"><b>${money(r.net)}</b></td>
        <td><span class="badge ${r.status === 'paid' ? 'badge-ok' : r.status === 'approved' ? 'badge-info' : 'badge-warn'}">${esc(ST_AR[r.status] || r.status)}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-act="slip" data-id="${esc(r.id)}">المسيّر</button></td>
      </tr>`).join('') : emptyRow(10, 'الشهر ده لسه ما اتحسبش');
    $('#payMonth').onchange = (e) => { state.month = e.target.value || thisMonth(); renderPayroll(); };
    if ($('#runBtn')) $('#runBtn').onclick = async () => {
      try {
        const r = await api('/api/hr/payroll/run', { method: 'POST', body: { month: state.month } });
        toast(`اتحسب ${r.rows.length} موظف — صافي ${money(r.total)}`, 'ok');
        renderPayroll();
      } catch (e) { toast(e.message, 'bad'); }
    };
    if ($('#approveBtn')) $('#approveBtn').onclick = async () => {
      try {
        await api(`/api/hr/payroll/${state.month}/approve`, { method: 'POST' });
        toast('المرتبات اتعمدت', 'ok'); renderPayroll();
      } catch (e) { toast(e.message, 'bad'); }
    };
    if ($('#payBtn')) $('#payBtn').onclick = async () => {
      try {
        const r = await api(`/api/hr/payroll/${state.month}/pay`, { method: 'POST' });
        toast(`اتصرف ${money(r.total)} — حركة خزينة واحدة`, 'ok'); renderPayroll();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  function showSlip(rowId) {
    const r = (state.payroll.rows || []).find((x) => x.id === rowId);
    if (!r) return;
    openModal({
      title: `مسيّر راتب — ${r.employeeName}`,
      wide: true,
      body: `<div class="slip">
        <div class="row between mb-2"><span class="small muted">شهر ${esc(r.month)} · ${esc(r.code || '')}</span>
          <span class="badge ${r.status === 'paid' ? 'badge-ok' : 'badge-warn'}">${esc(ST_AR[r.status] || r.status)}</span></div>
        <table class="tbl">
          <tbody>
            <tr><td>الراتب الأساسي</td><td class="mono">${money(r.base)}</td></tr>
            <tr><td>البدلات</td><td class="mono">${money(r.allowances)}</td></tr>
            <tr><td>إضافي / مكافأة</td><td class="mono">${money(r.bonus)}</td></tr>
            <tr><td>خصم غياب (${r.absenceDays} يوم × ${money(r.dayValue)})</td><td class="mono">− ${money(r.absenceDeduction)}</td></tr>
            <tr><td>خصم تأخير (${r.lateDays} يوم)</td><td class="mono">− ${money(r.lateDeduction)}</td></tr>
            <tr><td>سلف</td><td class="mono">− ${money(r.advance)}</td></tr>
            <tr><td><b>الصافي المستحق</b></td><td class="mono"><b>${money(r.net)}</b></td></tr>
          </tbody>
        </table>
        <div class="small muted mt-2">المرتب يُحسب في الخادم من سجلات الحضور والإجازات — الشاشة تعرض لا تحسب.</div>
      </div>`,
      footer: `<button class="btn btn-ghost" onclick="window.print()">🖨️ طباعة</button>
               <button class="btn btn-primary" id="slipClose">تمام</button>`,
    });
    $('#slipClose').onclick = closeModal;
  }

  /* ---------- سجل الموظف ---------- */
  async function renderMe() {
    const me = await api('/api/hr/me');
    const e = me.employee;
    $('#content').innerHTML = `
      ${head('سجلي', `${esc(e.name)} · ${esc(e.jobTitle)} · ${esc(e.code)}`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">الأساسي</div><div class="val mono">${money(e.baseSalary)}</div><div class="sub muted">+ بدلات ${money(e.allowances)}</div></div>
        <div class="card"><div class="lbl">قيمة يوم الغياب</div><div class="val mono">${money(e.baseSalary / 30)}</div><div class="sub muted">الأساسي ÷ 30</div></div>
        <div class="card"><div class="lbl">سجلات حضور</div><div class="val mono">${num(me.attendance.length)}</div><div class="sub muted">آخر 31</div></div>
        <div class="card"><div class="lbl">مسيّرات</div><div class="val mono">${num(me.payroll.length)}</div><div class="sub muted">آخر 12 شهر</div></div>
      </div>
      <div class="row" style="gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:300px"><div class="card card-pad"><b>حضوري</b>
          ${table(['التاريخ', 'دخول', 'خروج', 'الحالة'], 'attRows')}</div></div>
        <div style="flex:1;min-width:300px"><div class="card card-pad"><b>مسيّراتي</b>
          ${table(['الشهر', 'الصافي', 'الحالة'], 'payRows')}</div></div>
      </div>`;
    $('#attRows').innerHTML = me.attendance.length ? me.attendance.map((a) => `
      <tr><td class="mono small">${esc(a.date)}</td><td class="mono small">${a.in ? esc(a.in) : '—'}</td>
        <td class="mono small">${a.out ? esc(a.out) : '—'}</td>
        <td><span class="st st-${esc(a.status)}">${esc(ST_AR[a.status] || a.status)}</span></td></tr>`).join('')
      : emptyRow(4, 'مفيش سجلات');
    $('#payRows').innerHTML = me.payroll.length ? me.payroll.map((r) => `
      <tr><td class="mono small">${esc(r.month)}</td><td class="mono">${money(r.net)}</td>
        <td><span class="badge ${r.status === 'paid' ? 'badge-ok' : 'badge-warn'}">${esc(ST_AR[r.status] || r.status)}</span></td></tr>`).join('')
      : emptyRow(3, 'مفيش مسيّرات');
  }
})();
