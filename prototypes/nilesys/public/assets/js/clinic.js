/* ===== Nile Systems — نظام العيادة =====
 *
 * نظام مستقل: مستخدموه (مدير/استقبال/طبيب)، شاشته، ودخوله الخاص. يقرأ بياناته
 * من /api/clinic فقط، ويصرّف الكاش من درج وردية العيادة — لا يلمس مخزون
 * المتجر ولا فواتير الكاشير.
 *
 * القاعدة الحاكمة: ملف المريض واحد بالموبايل، والروشتة تُكتب مرة واحدة للزيارة.
 */
(function () {
  'use strict';
  const { $, $$, t, getLang, setLang, applyI18n, api, toast, openModal, closeModal, money, num, dmy, hm, esc, applyBranding } = window.NS;
  const SYSTEM = 'clinic';

  const state = { user: null, view: 'day', patients: [], doctors: [], appointments: [], patient: null };

  const ST_AR = {
    booked: 'محجوز', arrived: 'وصل', in_room: 'في الغرفة', done: 'تم', no_show: 'عدم حضور', cancelled: 'ملغي',
  };
  const METHOD_AR = { cash: 'نقدي', card: 'فيزا', wallet: 'محفظة', transfer: 'تحويل' };
  const ROLE_AR = { manager: 'مدير عيادة', reception: 'استقبال', doctor: 'طبيب' };
  const isManager = () => state.user && state.user.role === 'manager';
  const isDoctor = () => state.user && state.user.role === 'doctor';

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
      if (act === 'arrive') await setStatus(id, 'arrived');
      else if (act === 'room') await setStatus(id, 'in_room');
      else if (act === 'noshow') await setStatus(id, 'no_show');
      else if (act === 'pay') payModal(id);
      else if (act === 'visit') visitModal(id);
      else if (act === 'reschedule') rescheduleModal(id);
      else if (act === 'file') openFile(id);
    } catch (err) { toast(err.message, 'bad'); }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    const users = [
      { username: 'manager', name: 'د. هالة مراد', role: 'مدير عيادة' },
      { username: 'reception', name: 'نورا سمير', role: 'استقبال' },
      { username: 'doctor', name: 'د. أحمد الشريف', role: 'طبيب' },
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
    if (!location.hash) location.hash = '#/day';
    route();
  }

  function renderUser() {
    $('#userName').textContent = state.user.name;
    $('#userRole').textContent = ROLE_AR[state.user.role] || state.user.role;
    $('#avatar').textContent = state.user.name.replace(/^د\.\s*/, '').slice(0, 1);
  }

  function route() {
    if (!state.user) return;
    state.view = (location.hash.replace('#/', '') || 'day').split('/')[0];
    $$('.side .nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    render();
  }

  const views = {
    day: renderDay, patients: renderPatients, book: renderBook,
    doctors: renderDoctors, summary: renderSummary, shift: renderShift,
  };
  function render() {
    Promise.resolve((views[state.view] || renderDay)()).catch((err) => toast(err.message, 'bad'));
  }

  const head = (title, sub, actions = '') => `
    <div class="row between mb-2" style="flex-wrap:wrap;gap:10px">
      <div><div class="view-title">${esc(title)}</div><div class="view-sub small muted">${sub}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${actions}</div>
    </div>`;
  const table = (heads, id) => `<div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div></div>`;
  const emptyRow = (n, txt) => `<tr><td colspan="${n}" class="center muted">${esc(txt)}</td></tr>`;

  async function loadDoctors() { state.doctors = (await api('/api/clinic/doctors')).doctors; return state.doctors; }
  async function loadAppointments(date) {
    const url = date ? `/api/clinic/appointments?date=${date}` : '/api/clinic/appointments';
    state.appointments = (await api(url)).appointments;
    return state.appointments;
  }

  async function setStatus(id, status) {
    await api(`/api/clinic/appointments/${id}/status`, { method: 'POST', body: { status } });
    toast(`الموعد: ${ST_AR[status]}`, 'ok');
    render();
  }

  /* ---------- يوم العيادة ---------- */
  async function renderDay() {
    const [appts, docs] = await Promise.all([loadAppointments(), loadDoctors()]);
    const waiting = appts.filter((a) => a.status === 'arrived');
    const inRoom = appts.filter((a) => a.status === 'in_room');
    const done = appts.filter((a) => a.status === 'done');
    const collected = appts.reduce((s, a) => s + (Number(a.paid) || 0), 0);

    $('#content').innerHTML = `
      ${head('يوم العيادة', `${num(appts.length)} موعد النهارده — بالترتيب الزمني`,
        `<button class="btn btn-primary" id="goBook">➕ حجز موعد</button>`)}
      <div class="kpi" style="margin-bottom:16px">
        <div class="card"><div class="lbl">في الانتظار</div><div class="val mono">${num(waiting.length)}</div><div class="sub muted">وصلوا ولم يُكشف عليهم</div></div>
        <div class="card"><div class="lbl">في الغرفة</div><div class="val mono">${num(inRoom.length)}</div><div class="sub muted">جاري الكشف</div></div>
        <div class="card"><div class="lbl">انتهى</div><div class="val mono">${num(done.length)}</div><div class="sub muted">زيارة مكتملة</div></div>
        <div class="card"><div class="lbl">محصَّل النهارده</div><div class="val mono">${money(collected)}</div><div class="sub muted">نقدي + إلكتروني</div></div>
      </div>
      <div id="apptList" style="display:grid;gap:10px"></div>`;

    if (!appts.length) {
      $('#apptList').innerHTML = '<div class="card card-pad center muted">مفيش مواعيد النهارده — ابدأ بحجز جديد</div>';
    } else {
      const t0 = Date.now();
      $('#apptList').innerHTML = appts.map((a) => {
        const late = ['booked'].includes(a.status) && new Date(a.at).getTime() < t0;
        return `
        <div class="appt" data-status="${esc(a.status)}" data-appt="${esc(a.id)}">
          <div>
            <div class="time">${hm(a.at)}</div>
            <div class="small muted">${late ? 'متأخر' : num(a.minutes) + ' د'}</div>
          </div>
          <div>
            <div class="who">${esc(a.patientName)} <span class="small muted mono">${esc(a.patientPhone)}</span></div>
            <div class="small muted">${esc(a.doctorName)} · كشف ${money(a.fee)}${a.paid ? ` · مدفوع ${money(a.paid)}` : ''}${a.remaining ? ` · متبقي ${money(a.remaining)}` : ''}</div>
          </div>
          <div class="acts">
            <span class="pill-state s-${esc(a.status)}">${esc(ST_AR[a.status] || a.status)}</span>
            ${a.status === 'booked' ? `<button class="btn btn-sm" data-act="arrive" data-id="${esc(a.id)}">وصل</button>` : ''}
            ${a.status === 'arrived' ? `<button class="btn btn-sm" data-act="room" data-id="${esc(a.id)}">دخل الغرفة</button>` : ''}
            ${['arrived', 'in_room'].includes(a.status) && !a.hasVisit && (isDoctor() || isManager()) ? `<button class="btn btn-sm btn-primary" data-act="visit" data-id="${esc(a.id)}">كشف</button>` : ''}
            ${['arrived', 'in_room', 'done'].includes(a.status) && a.remaining > 0 && !isDoctor() ? `<button class="btn btn-sm" data-act="pay" data-id="${esc(a.id)}">تحصيل</button>` : ''}
            ${['booked', 'arrived'].includes(a.status) && !isDoctor() ? `<button class="btn btn-ghost btn-sm" data-act="reschedule" data-id="${esc(a.id)}">تأجيل</button>` : ''}
            ${['booked'].includes(a.status) ? `<button class="btn btn-ghost btn-sm" data-act="noshow" data-id="${esc(a.id)}">ما جاش</button>` : ''}
            ${a.hasVisit ? `<button class="btn btn-ghost btn-sm" data-act="file" data-id="${esc(a.patientId)}">الملف</button>` : ''}
          </div>
        </div>`;
      }).join('');
    }
    $('#goBook').onclick = () => { location.hash = '#/book'; };
  }

  /* ---------- المرضى ---------- */
  async function renderPatients() {
    const term = state.patientQuery || '';
    const { patients } = await api(`/api/clinic/patients${term ? '?q=' + encodeURIComponent(term) : ''}`);
    state.patients = patients;
    $('#content').innerHTML = `
      ${head('المرضى', `${num(patients.length)} ملف — ملف واحد لكل موبايل`,
        `<input class="input" id="pq" placeholder="ابحث بالاسم أو الموبايل" value="${esc(term)}" style="width:240px" />
         <button class="btn btn-primary" id="newPatient">＋ مريض جديد</button>`)}
      ${table(['الكود', 'الاسم', 'الموبايل', 'زيارات', 'آخر زيارة', ''], 'rows')}`;
    $('#rows').innerHTML = patients.length ? patients.map((p) => `
      <tr>
        <td class="mono small">${esc(p.code)}</td>
        <td><b>${esc(p.name)}</b>${p.gender === 'female' ? ' <span class="small muted">أنثى</span>' : p.gender === 'male' ? ' <span class="small muted">ذكر</span>' : ''}</td>
        <td class="mono small">${esc(p.phone)}</td>
        <td class="mono">${num(p.visits)}</td>
        <td class="small muted">${p.lastVisitAt ? dmy(p.lastVisitAt) : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="file" data-id="${esc(p.id)}">فتح الملف</button></td>
      </tr>`).join('') : emptyRow(6, 'مفيش مرضى بالبحث ده');
    $('#pq').oninput = (e) => {
      clearTimeout(state._tm);
      state._tm = setTimeout(() => { state.patientQuery = e.target.value.trim(); renderPatients(); }, 300);
    };
    $('#newPatient').onclick = newPatientModal;
  }

  async function newPatientModal() {
    openModal({
      title: 'مريض جديد',
      body: `
        <div class="field"><label class="label">الاسم</label><input class="input" id="pName" /></div>
        <div class="field"><label class="label">الموبايل</label><input class="input" id="pPhone" inputmode="tel" /></div>
        <div class="field"><label class="label">النوع</label><select class="input" id="pGender">
          <option value="female">أنثى</option><option value="male">ذكر</option></select></div>
        <div class="field"><label class="label">سنة الميلاد</label><input class="input" id="pYear" type="number" min="1900" max="2026" /></div>`,
      footer: `<button class="btn btn-primary" id="pSave">حفظ</button>`,
    });
    $('#pSave').onclick = async () => {
      try {
        const r = await api('/api/clinic/patients', {
          method: 'POST',
          body: {
            name: $('#pName').value.trim(), phone: $('#pPhone').value.trim(),
            gender: $('#pGender').value, birthYear: Number($('#pYear').value) || null,
          },
        });
        closeModal(); toast('اتسجل', 'ok'); renderPatients();
        if (r.patient) state.patients.unshift(r.patient);
      } catch (e) {
        // 409 يعني الملف موجود — نفتحه بدل تكراره.
        if (e.data && e.data.patientId) { closeModal(); openFile(e.data.patientId); return; }
        toast(e.message, 'bad');
      }
    };
  }

  async function openFile(patientId) {
    const f = await api(`/api/clinic/patients/${patientId}`);
    state.patient = f;
    const p = f.patient;
    openModal({
      title: `${p.name} · ${p.code}`,
      wide: true,
      body: `
        <div class="row between mb-2">
          <div class="small muted">${esc(p.phone)} · ${p.gender === 'female' ? 'أنثى' : p.gender === 'male' ? 'ذكر' : '—'}${p.birthYear ? ` · مواليد ${num(p.birthYear)}` : ''}</div>
          <div class="row" style="gap:8px"><span class="badge badge-info">مدفوع ${money(f.paid)}</span>
            <span class="badge ${f.due ? 'badge-warn' : 'badge-ok'}">متبقي ${money(f.due)}</span></div>
        </div>
        <b>الزيارات (${num(f.visits.length)})</b>
        <div class="mt-1" id="visitList"></div>
        <b style="display:block;margin-top:12px">المواعيد</b>
        ${table(['الوقت', 'الطبيب', 'الحالة', 'مدفوع'], 'apptRows')}`,
      footer: `<button class="btn btn-primary" id="closeFile">تمام</button>`,
    });
    $('#closeFile').onclick = closeModal;
    $('#visitList').innerHTML = f.visits.length ? f.visits.slice().reverse().map((v) => `
      <div class="card card-pad mb-2">
        <div class="row between small muted"><span>${dmy(v.at)} ${hm(v.at)}</span><span>${esc(v.doctorName)}</span></div>
        <div class="mt-1"><b>الشكوى:</b> ${esc(v.complaint || '—')}</div>
        <div><b>التشخيص:</b> ${esc(v.diagnosis || '—')}</div>
        ${v.prescription.length ? `<div class="mt-1"><b>الروشتة:</b>
          <ul style="margin:6px 0 0;padding-inline-start:18px">
            ${v.prescription.map((x) => `<li class="small">${esc(x.drug)} — ${esc(x.dose || '—')} — ${esc(x.duration || '—')}${x.notes ? ` <span class="muted">(${esc(x.notes)})</span>` : ''}</li>`).join('')}
          </ul></div>` : '<div class="small muted">مفيش روشتة</div>'}
        ${v.followUpAt ? `<div class="small muted mt-1">متابعة: ${dmy(v.followUpAt)}</div>` : ''}
      </div>`).join('') : '<div class="small muted">مفيش زيارات مسجّلة</div>';
    $('#apptRows').innerHTML = f.appointments.length ? f.appointments.map((a) => `
      <tr><td class="mono small">${dmy(a.at)} ${hm(a.at)}</td>
        <td class="small">${esc(a.doctorName)}</td>
        <td><span class="pill-state s-${esc(a.status)}">${esc(ST_AR[a.status] || a.status)}</span></td>
        <td class="mono">${money(a.paid)} / ${money(a.fee)}</td></tr>`).join('') : emptyRow(4, 'مفيش مواعيد');
  }

  /* ---------- الحجز ---------- */
  async function renderBook() {
    const [docs, { patients }] = await Promise.all([loadDoctors(), api('/api/clinic/patients')]);
    state.patients = patients;
    const local = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('#content').innerHTML = `
      ${head('حجز موعد', 'الطبيب لا يقبل موعدين متداخلين — النظام يرفض التعارض')}
      <div class="card card-pad" style="max-width:620px">
        <div class="field"><label class="label">المريض</label>
          <select class="input" id="bPatient">
            ${patients.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.phone)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label">الطبيب</label>
          <select class="input" id="bDoctor">
            ${docs.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.specialty)} · ${money(x.fee)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="label">الوقت</label><input class="input" id="bAt" type="datetime-local" value="${local(Date.now() + 3600e3)}" /></div>
        <div class="field"><label class="label">مدة الكشف (دقيقة)</label><input class="input" id="bMin" type="number" min="5" step="5" value="20" /></div>
        <div class="row" style="gap:8px">
          <button class="btn btn-primary" id="bSave">حجز</button>
          <button class="btn btn-ghost" id="bNewPatient">مريض جديد</button>
        </div>
        <div class="small muted mt-2" id="bHint"></div>
      </div>`;
    const hint = () => {
      const d = docs.find((x) => x.id === $('#bDoctor').value);
      $('#bHint').textContent = d ? `سعر الكشف ${money(d.fee)} — ${num(d.todayCount)} موعد للطبيب النهارده` : '';
    };
    $('#bDoctor').onchange = hint; hint();
    $('#bNewPatient').onclick = newPatientModal;
    $('#bSave').onclick = async () => {
      try {
        const r = await api('/api/clinic/appointments', {
          method: 'POST',
          body: {
            patientId: $('#bPatient').value, doctorId: $('#bDoctor').value,
            at: new Date($('#bAt').value).toISOString(), minutes: Number($('#bMin').value) || 20,
          },
        });
        toast(`اتحجز موعد #${r.appointment.no}`, 'ok');
        location.hash = '#/day';
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الأطباء ---------- */
  async function renderDoctors() {
    const docs = await loadDoctors();
    $('#content').innerHTML = `
      ${head('الأطباء والأسعار', 'سعر الكشف يُستخدم في التحصيل — تعديله للمدير فقط',
        isManager() ? '<button class="btn btn-primary" id="addDoc">＋ طبيب</button>' : '')}
      ${table(['الطبيب', 'التخصص', 'سعر الكشف', 'مواعيد النهارده', ''], 'rows')}`;
    $('#rows').innerHTML = docs.length ? docs.map((x) => `
      <tr>
        <td><b>${esc(x.name)}</b></td>
        <td class="small">${esc(x.specialty)}</td>
        <td class="mono">${money(x.fee)}</td>
        <td class="mono">${num(x.todayCount)} <span class="small muted">(تم ${num(x.todayDone)})</span></td>
        <td>${isManager() ? `<button class="btn btn-ghost btn-sm" data-fee="${esc(x.id)}">تعديل السعر</button>` : ''}</td>
      </tr>`).join('') : emptyRow(5, 'مفيش أطباء');
    $$('#rows [data-fee]').forEach((b) => (b.onclick = () => {
      const d = docs.find((x) => x.id === b.dataset.fee);
      openModal({
        title: `سعر الكشف — ${d.name}`,
        body: `<div class="field"><label class="label">سعر الكشف</label>
          <input class="input" id="dFee" type="number" min="0" value="${d.fee}" /></div>`,
        footer: `<button class="btn btn-primary" id="dSave">حفظ</button>`,
      });
      $('#dSave').onclick = async () => {
        try {
          await api(`/api/clinic/doctors/${d.id}`, { method: 'PUT', body: { fee: Number($('#dFee').value) } });
          closeModal(); toast('اتعدل', 'ok'); renderDoctors();
        } catch (e) { toast(e.message, 'bad'); }
      };
    }));
    if ($('#addDoc')) $('#addDoc').onclick = () => {
      openModal({
        title: 'طبيب جديد',
        body: `<div class="field"><label class="label">الاسم</label><input class="input" id="ndName" /></div>
               <div class="field"><label class="label">التخصص</label><input class="input" id="ndSpec" value="عام" /></div>
               <div class="field"><label class="label">سعر الكشف</label><input class="input" id="ndFee" type="number" min="0" value="300" /></div>`,
        footer: `<button class="btn btn-primary" id="ndSave">حفظ</button>`,
      });
      $('#ndSave').onclick = async () => {
        try {
          await api('/api/clinic/doctors', {
            method: 'POST',
            body: { name: $('#ndName').value.trim(), specialty: $('#ndSpec').value.trim(), fee: Number($('#ndFee').value) },
          });
          closeModal(); toast('اتضاف', 'ok'); renderDoctors();
        } catch (e) { toast(e.message, 'bad'); }
      };
    };
  }

  /* ---------- التحصيل ---------- */
  async function payModal(id) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    openModal({
      title: `تحصيل — ${a.patientName}`,
      body: `
        <div class="small muted mb-2">كشف ${money(a.fee)} · مدفوع ${money(a.paid)} · متبقي <b>${money(a.remaining)}</b></div>
        <div class="field"><label class="label">طريقة الدفع</label>
          <select class="input" id="pmMethod">${Object.entries(METHOD_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label class="label">المبلغ</label><input class="input" id="pmAmount" type="number" min="1" value="${a.remaining}" /></div>`,
      footer: `<button class="btn btn-primary" id="pmGo">تأكيد التحصيل</button>`,
    });
    $('#pmGo').onclick = async () => {
      try {
        const r = await api(`/api/clinic/appointments/${id}/pay`, {
          method: 'POST',
          body: { method: $('#pmMethod').value, amount: Number($('#pmAmount').value) },
        });
        closeModal();
        toast(`اتحصّل ${money(r.appointment.paid)}${r.remaining ? ` · متبقي ${money(r.remaining)}` : ''}`, 'ok');
        render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الكشف ---------- */
  async function visitModal(id) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    openModal({
      title: `كشف — ${a.patientName}`,
      wide: true,
      body: `
        <div class="small muted mb-2">${esc(a.doctorName)} · ${hm(a.at)} · ${esc(a.patientPhone)}</div>
        <div class="field"><label class="label">الشكوى</label><input class="input" id="vComplaint" placeholder="مثال: حرارة من يومين" /></div>
        <div class="field"><label class="label">التشخيص</label><input class="input" id="vDiagnosis" /></div>
        <label class="label">الروشتة</label>
        <div id="rxRows"></div>
        <button class="btn btn-ghost btn-sm" id="rxAdd">＋ دواء</button>
        <div class="field mt-2"><label class="label">متابعة بعد (اختياري)</label><input class="input" id="vFollow" type="date" /></div>`,
      footer: `<button class="btn btn-primary" id="vSave">حفظ الزيارة</button>`,
    });
    const rowHtml = () => `
      <div class="rx">
        <input class="input" data-rx="drug" placeholder="الدواء" />
        <input class="input" data-rx="dose" placeholder="الجرعة" />
        <input class="input" data-rx="duration" placeholder="المدة" />
        <button class="btn btn-ghost btn-sm" data-rxdel>✕</button>
      </div>`;
    const addRow = () => {
      const div = document.createElement('div');
      div.innerHTML = rowHtml();
      const row = div.firstElementChild;
      row.querySelector('[data-rxdel]').onclick = () => row.remove();
      $('#rxRows').appendChild(row);
    };
    addRow();
    $('#rxAdd').onclick = addRow;
    $('#vSave').onclick = async () => {
      const prescription = $$('#rxRows .rx').map((r) => ({
        drug: r.querySelector('[data-rx="drug"]').value.trim(),
        dose: r.querySelector('[data-rx="dose"]').value.trim(),
        duration: r.querySelector('[data-rx="duration"]').value.trim(),
      })).filter((x) => x.drug);
      try {
        await api(`/api/clinic/appointments/${id}/visit`, {
          method: 'POST',
          body: {
            complaint: $('#vComplaint').value.trim(),
            diagnosis: $('#vDiagnosis').value.trim(),
            prescription,
            followUpAt: $('#vFollow').value ? new Date($('#vFollow').value).toISOString() : null,
          },
        });
        closeModal(); toast('الزيارة اتسجلت', 'ok'); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  async function rescheduleModal(id) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    const local = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    openModal({
      title: `تأجيل موعد — ${a.patientName}`,
      body: `<div class="small muted mb-2">الحالي: ${dmy(a.at)} ${hm(a.at)} · المريض وملفه لا يتغيّران</div>
             <div class="field"><label class="label">الوقت الجديد</label>
               <input class="input" id="rsAt" type="datetime-local" value="${local(new Date(a.at).getTime() + 864e5)}" /></div>`,
      footer: `<button class="btn btn-primary" id="rsGo">تأجيل</button>`,
    });
    $('#rsGo').onclick = async () => {
      try {
        await api(`/api/clinic/appointments/${id}/reschedule`, {
          method: 'POST', body: { at: new Date($('#rsAt').value).toISOString() },
        });
        closeModal(); toast('اتأجل', 'ok'); render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- الوردية ---------- */
  async function renderShift() {
    const { openShift } = await api('/api/clinic/shift');
    $('#content').innerHTML = `
      ${head('الوردية والدرج', 'كاش الكشف يدخل درج العيادة — البطاقة تُسجَّل ولا تمسّ الدرج')}
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
      try { await api('/api/clinic/shift', { method: 'POST', body: { action: 'open', openingCash: Number($('#opening').value) || 0 } }); toast('الوردية اتفتحت', 'ok'); renderShift(); } catch (e) { toast(e.message, 'bad'); }
    };
    if ($('#closeShift')) $('#closeShift').onclick = async () => {
      try {
        const { shift } = await api('/api/clinic/shift', { method: 'POST', body: { action: 'close', countedCash: Number($('#counted').value) || 0 } });
        toast(`الفرق ${money(shift.difference)} ${shift.difference === 0 ? '— مطابق تماماً' : ''}`, shift.difference === 0 ? 'ok' : 'bad');
        renderShift();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }

  /* ---------- التقارير ---------- */
  async function renderSummary() {
    const s = await api('/api/clinic/summary?range=today');
    $('#content').innerHTML = `
      ${head('تقارير اليوم', dmy(s.date))}
      <div class="kpi">
        <div class="card"><div class="lbl">مواعيد</div><div class="val mono">${num(s.appointments)}</div><div class="sub muted">تم ${num(s.done)}</div></div>
        <div class="card"><div class="lbl">الإيراد المحصَّل</div><div class="val mono">${money(s.revenue)}</div><div class="sub muted">متوسط ${money(s.avgTicket)}</div></div>
        <div class="card"><div class="lbl">عدم الحضور</div><div class="val mono">${num(s.noShow)}</div><div class="sub muted">${num(s.noShowRate)}% من المواعيد</div></div>
        <div class="card"><div class="lbl">طرق الدفع</div><div class="val mono" style="font-size:16px">${Object.entries(s.byMethod || {}).map(([k, v]) => `${esc(METHOD_AR[k] || k)}: ${money(v)}`).join('<br>') || '—'}</div></div>
      </div>
      <div class="row" style="gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:280px"><div class="card card-pad"><b>أكثر التشخيصات</b>
          ${table(['التشخيص', 'عدد'], 'diagRows')}</div></div>
        <div style="flex:1;min-width:280px"><div class="card card-pad"><b>المواعيد لكل طبيب</b>
          ${table(['الطبيب', 'مواعيد'], 'docRows')}</div></div>
      </div>`;
    $('#diagRows').innerHTML = (s.topDiagnoses || []).length
      ? s.topDiagnoses.map((x) => `<tr><td>${esc(x.diagnosis)}</td><td class="mono">${num(x.count)}</td></tr>`).join('')
      : emptyRow(2, 'مفيش تشخيصات النهارده');
    $('#docRows').innerHTML = (s.doctors || []).length
      ? s.doctors.map((x) => `<tr><td>${esc(x.name)}</td><td class="mono">${num(x.count)}</td></tr>`).join('')
      : emptyRow(2, 'مفيش أطباء');
  }
})();
