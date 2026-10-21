/* ===== نيل حضور (ويندوز) =====
 *
 * بصمة على جهاز الاستقبال: كود الموظف يدخل ويخرج. يعمل بلا إنترنت، ويصدّر
 * ملخص الشهر لبرنامج المرتبات.
 *
 * القواعد: تسجيل دخول مزدوج في نفس اليوم مرفوض · التأخير بعد 09:15 ·
 * بلا انصراف = نصف يوم · الموظف غير المعروف مرفوض · التصدير CSV بترميز UTF-8.
 */
(function () {
  'use strict';
  const D = window.Desk;
  const { $, $$, esc, money, num, uid, dmy, hm, today, load, save, queue, sync, toast, modal, closeModal, printHtml } = D;
  const SLUG = 'attendance';
  const LATE_AFTER = '09:15';

  const seed = () => ({
    employees: [
      { id: 'e1', code: '1001', name: 'نادين حسام', job: 'محاسبة', base: 6000 },
      { id: 'e2', code: '1002', name: 'محمود عزت', job: 'كاشير', base: 4500 },
      { id: 'e3', code: '1003', name: 'سارة لبيب', job: 'مسؤولة مخزن', base: 5200 },
      { id: 'e4', code: '1004', name: 'عمرو دسوقي', job: 'سائق توصيل', base: 4000 },
      { id: 'e5', code: '1005', name: 'حسن عماد', job: 'ويتر', base: 3800 },
    ],
    punches: [],
  });

  let doc = load(SLUG, seed);
  let view = 'punch';
  let typed = '';
  let repaint = () => {};

  const dayKey = (iso) => String(iso).slice(0, 10);
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const empByCode = (code) => doc.employees.find((e) => e.code === code) || null;
  const dayOf = (empId, date) => doc.punches.filter((p) => p.employeeId === empId && p.date === date);

  function boot() {
    $$('.desk-nav[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; render(); }; });
    repaint = D.status($('#statusBar'), SLUG, doc, doSync);
    render();
  }

  async function doSync() {
    try {
      const r = await sync(SLUG, doc);
      if (r.acked) toast(`اتزامن ${num(r.acked)} بصمة`, 'ok');
      else if (r.empty) toast('مفيش حاجة مستنية', 'ok');
      render();
      return r;
    } catch (e) { toast(e.message, 'bad'); throw e; }
  }

  function render() {
    $$('.desk-nav[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('#topActions').innerHTML = '';
    if (view === 'punch') return renderPunch();
    if (view === 'today') return renderToday();
    if (view === 'month') return renderMonth();
    return renderSync();
  }

  /* ---------------- البصمة ---------------- */
  function renderPunch() {
    const todayStr = today();
    $('#title').textContent = 'البصمة';
    $('#sub').innerHTML = `${dmy(todayStr)} · ${num(doc.punches.filter((p) => p.date === todayStr).length)} بصمة النهارده`;
    $('#content').innerHTML = `
      <div class="grid" style="grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);align-items:start">
        <div class="card pad">
          <div class="field"><label class="label">كود الموظف</label>
            <input class="input mono" id="code" inputmode="numeric" autofocus placeholder="مثال 1001" value="${esc(typed)}" style="font-size:22px;letter-spacing:2px" /></div>
          <div class="keys" id="keys"></div>
          <button class="btn btn-primary mt" id="punch" style="width:100%">تسجيل</button>
          <div class="small muted mt">الدخول والخروج تلقائيان: أول تسجيل في اليوم دخول، والتاني خروج.</div>
        </div>
        <div class="card pad" id="result">
          <div class="empty">اكتب كود الموظف لتظهر حالته هنا</div>
        </div>
      </div>`;
    $('#keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C']
      .map((k) => `<button data-k="${k}">${k}</button>`).join('');
    $$('#keys [data-k]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'C') typed = '';
      else if (k === '⌫') typed = typed.slice(0, -1);
      else typed += k;
      $('#code').value = typed;
      preview();
    }));
    $('#code').oninput = (e) => { typed = e.target.value.replace(/\D/g, ''); preview(); };
    $('#punch').onclick = () => submitPunch();
    document.onkeydown = (e) => { if (e.key === 'Enter' && view === 'punch') submitPunch(); };
    preview();
  }

  function preview() {
    const host = $('#result');
    if (!host) return;
    const emp = empByCode(typed);
    if (!typed) { host.innerHTML = '<div class="empty">اكتب كود الموظف لتظهر حالته هنا</div>'; return; }
    if (!emp) { host.innerHTML = `<div class="card pad" style="border:0"><span class="badge b-bad">كود غير معروف</span>
      <div class="mt small muted">الموظف لازم يكون مسجّل قبل البصمة.</div></div>`; return; }
    const todayStr = today();
    const punches = dayOf(emp.id, todayStr);
    const isIn = punches.some((p) => p.kind === 'in') && !punches.some((p) => p.kind === 'out');
    host.innerHTML = `
      <div class="row between"><b>${esc(emp.name)}</b><span class="badge b-info">${esc(emp.job)}</span></div>
      <div class="small muted mono mt">كود ${esc(emp.code)}</div>
      <div class="mt">
        ${punches.length ? punches.map((p) => `<div class="row between small"><span>${p.kind === 'in' ? 'دخول' : 'خروج'}</span>
          <span class="mono">${esc(p.time)}${p.kind === 'in' && p.late ? ' · متأخر' : ''}</span></div>`).join('')
          : '<div class="small muted">مفيش تسجيل النهارده</div>'}
      </div>
      <div class="mt"><span class="badge ${isIn ? 'b-warn' : 'b-ok'}">الضغطة الجاية: ${isIn ? 'خروج' : 'دخول'}</span></div>`;
  }

  function submitPunch() {
    const emp = empByCode(typed);
    if (!emp) return toast('كود غير معروف', 'bad');
    const todayStr = today();
    const punches = dayOf(emp.id, todayStr);
    const hasIn = punches.some((p) => p.kind === 'in');
    const hasOut = punches.some((p) => p.kind === 'out');
    if (hasOut) return toast(`${emp.name} سجّل دخول وخروج النهارده بالفعل`, 'bad');
    if (!hasIn && punches.some((p) => p.kind === 'in')) return toast('تسجيل دخول مكرر', 'bad');
    const time = nowHM();
    const kind = hasIn ? 'out' : 'in';
    const late = kind === 'in' && toMin(time) > toMin(LATE_AFTER);
    doc.punches.push({
      id: uid(), employeeId: emp.id, code: emp.code, name: emp.name,
      date: todayStr, time, kind, late, at: new Date().toISOString(),
    });
    queue(SLUG, doc, `punch.${kind}`, { code: emp.code, time, late });
    save(SLUG, doc);
    typed = '';
    toast(`${emp.name} — ${kind === 'in' ? (late ? 'دخول متأخر' : 'دخول') : 'خروج'} ${time}`, kind === 'in' && late ? 'bad' : 'ok');
    repaint(); render();
  }

  /* ---------------- سجل اليوم ---------------- */
  function renderToday() {
    const todayStr = today();
    $('#title').textContent = 'سجل اليوم';
    const rows = doc.employees.map((e) => {
      const p = dayOf(e.id, todayStr);
      const inP = p.find((x) => x.kind === 'in');
      const outP = p.find((x) => x.kind === 'out');
      const state = !inP ? 'غائب' : outP ? 'انصرف' : 'حاضر';
      return { e, inP, outP, state };
    });
    const present = rows.filter((r) => r.inP).length;
    $('#sub').innerHTML = `${num(present)} حاضر من ${num(rows.length)} · ${num(rows.filter((r) => r.inP && r.inP.late).length)} متأخر`;
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="card pad kpi"><div class="lbl">حاضر</div><div class="val">${num(present)}</div></div>
        <div class="card pad kpi"><div class="lbl">متأخر</div><div class="val" style="color:var(--warn)">${num(rows.filter((r) => r.inP && r.inP.late).length)}</div></div>
        <div class="card pad kpi"><div class="lbl">بلا انصراف</div><div class="val" style="color:var(--bad)">${num(rows.filter((r) => r.inP && !r.outP).length)}</div></div>
        <div class="card pad kpi"><div class="lbl">غائب</div><div class="val">${num(rows.filter((r) => !r.inP).length)}</div></div>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الموظف</th><th>الوظيفة</th><th>دخول</th><th>خروج</th><th>الحالة</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><b>${esc(r.e.name)}</b><div class="small muted mono">${esc(r.e.code)}</div></td>
            <td class="small">${esc(r.e.job)}</td>
            <td class="mono">${r.inP ? esc(r.inP.time) : '—'}${r.inP && r.inP.late ? ' <span class="badge b-warn">متأخر</span>' : ''}</td>
            <td class="mono">${r.outP ? esc(r.outP.time) : (r.inP ? '<span class="badge b-bad">ناقص</span>' : '—')}</td>
            <td><span class="badge ${r.state === 'حاضر' ? 'b-ok' : r.state === 'انصرف' ? 'b-info' : 'b-bad'}">${r.state}</span></td>
          </tr>`).join('')}</tbody></table></div></div>`;
  }

  /* ---------------- الملخص الشهري ---------------- */
  const monthOf = () => (window.__month || today().slice(0, 7));
  function summary(month) {
    return doc.employees.map((e) => {
      const days = {};
      for (const p of doc.punches) {
        if (p.employeeId !== e.id || !p.date.startsWith(month)) continue;
        days[p.date] = days[p.date] || { in: null, out: null, late: false };
        if (p.kind === 'in') { days[p.date].in = p.time; days[p.date].late = p.late; }
        else days[p.date].out = p.time;
      }
      const list = Object.values(days);
      const lateDays = list.filter((d) => d.late).length;
      const missingOut = list.filter((d) => d.in && !d.out).length;
      const workedMin = list.reduce((a, d) => {
        if (!d.in || !d.out) return a;
        return a + Math.max(0, toMin(d.out) - toMin(d.in));
      }, 0);
      return { e, presentDays: list.length, lateDays, missingOut, hours: Math.round((workedMin / 60) * 10) / 10 };
    });
  }

  function renderMonth() {
    const month = monthOf();
    $('#title').textContent = 'الملخص الشهري';
    const rows = summary(month);
    $('#sub').innerHTML = `${esc(month)} — الأساس لتصدير المرتبات`;
    $('#topActions').innerHTML = `
      <input class="input mono" type="month" id="monthPick" value="${esc(month)}" style="max-width:170px;min-height:40px" />
      <button class="btn btn-primary" id="exportCsv">تصدير CSV</button>
      <button class="btn btn-ghost" id="printReport">طباعة A4</button>`;
    $('#content').innerHTML = `
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الموظف</th><th>أيام حضور</th><th>أيام تأخير</th><th>بلا انصراف</th><th>ساعات عمل</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><b>${esc(r.e.name)}</b><div class="small muted mono">${esc(r.e.code)}</div></td>
            <td class="num">${num(r.presentDays)}</td>
            <td class="num" style="color:${r.lateDays ? 'var(--warn)' : 'inherit'}">${num(r.lateDays)}</td>
            <td class="num" style="color:${r.missingOut ? 'var(--bad)' : 'inherit'}">${num(r.missingOut)}</td>
            <td class="num">${num(r.hours)}</td>
          </tr>`).join('')}</tbody></table></div></div>
      <div class="card pad small muted">نصف يوم يُحسب لكل تسجيل بلا انصراف — وهذا يظهر في عمود «بلا انصراف» ويُصدَّر للمرتبات.</div>`;
    $('#monthPick').onchange = (e) => { window.__month = e.target.value || today().slice(0, 7); renderMonth(); };
    $('#exportCsv').onclick = () => exportCsv(month, rows);
    $('#printReport').onclick = () => printReport(month, rows);
  }

  function exportCsv(month, rows) {
    const lines = [['الشهر', 'الكود', 'الموظف', 'الوظيفة', 'أيام حضور', 'أيام تأخير', 'بلا انصراف', 'ساعات']];
    rows.forEach((r) => lines.push([month, r.e.code, r.e.name, r.e.job, r.presentDays, r.lateDays, r.missingOut, r.hours]));
    const csv = '\ufeff' + lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    queue(SLUG, doc, 'month.export', { month, employees: rows.length });
    save(SLUG, doc); repaint();
    toast('الملف اتصدّر للمرتبات', 'ok');
  }

  function printReport(month, rows) {
    const html = `
      <h1 class="center">ملخص حضور — ${esc(month)}</h1>
      <div class="center small">نيل سيستمز · جهاز ${esc(doc.device)} · ${dmy(new Date().toISOString())}</div>
      <div class="sep"></div>
      <table>
        <thead><tr><th>الكود</th><th>الموظف</th><th>حضور</th><th>تأخير</th><th>بلا انصراف</th><th>ساعات</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td class="mono">${esc(r.e.code)}</td><td>${esc(r.e.name)}</td>
          <td class="mono">${num(r.presentDays)}</td><td class="mono">${num(r.lateDays)}</td>
          <td class="mono">${num(r.missingOut)}</td><td class="mono">${num(r.hours)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="sign"><span>توقيع الموارد البشرية: ....................</span><span>توقيع المدير: ....................</span></div>`;
    printHtml(html, { width: 'A4' });
  }

  /* ---------------- المزامنة ---------------- */
  function renderSync() {
    $('#title').textContent = 'المزامنة';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="syncNow">زامن الآن</button>';
    $('#sub').textContent = 'البصمات تُحفظ محلياً أولاً — والجهاز يعمل والشبكة مقطوعة';
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="kpi card pad"><div class="lbl">في الانتظار</div><div class="val">${num(doc.pending.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">بصمات</div><div class="val">${num(doc.punches.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">آخر مزامنة</div><div class="val" style="font-size:18px">${doc.lastSync ? hm(doc.lastSync) : '—'}</div></div>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>النوع</th><th>الوقت</th><th>المفتاح</th></tr></thead>
        <tbody>${doc.pending.length ? doc.pending.slice(-30).reverse().map((o) => `
          <tr><td class="small">${esc(o.type)}</td><td class="small">${dmy(o.at)} ${hm(o.at)}</td><td class="mono small">${esc(o.key)}</td></tr>`).join('')
          : '<tr><td colspan="3" class="empty">كل حاجة متزامنة</td></tr>'}</tbody></table></div></div>
      <div class="card pad"><b>إعادة ضبط بيانات العرض</b>
        <button class="btn btn-danger btn-sm mt" id="resetApp">إعادة ضبط الجهاز</button></div>`;
    $('#syncNow').onclick = () => doSync().catch(() => {});
    $('#resetApp').onclick = () => {
      doc = D.reset(SLUG, seed); typed = '';
      repaint = D.status($('#statusBar'), SLUG, doc, doSync);
      toast('الجهاز اترجع للبيانات الأولية', 'ok'); render();
    };
  }

  window.addEventListener('online', () => doSync().catch(() => {}));
  boot();
})();
