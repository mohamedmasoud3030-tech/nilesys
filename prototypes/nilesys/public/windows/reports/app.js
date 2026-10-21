/* ===== نيل تقارير (ويندوز) =====
 *
 * يقرأ ما حفظته البرامج الأربعة على نفس الجهاز (localStorage) وما وصل للخادم
 * من مزامنة، ويعرض أرقاماً — لا يخترع رقماً ولا يخفي صفراً.
 *
 * القواعد: كل رقم بجانبه مصدره · صفر يعني صفراً لا «—» · تقرير A4 صفحة واحدة
 * قابلة للتوقيع · CSV بترميز UTF-8 BOM حتى يفتح في إكسل العربي بلا رموز.
 */
(function () {
  'use strict';
  const D = window.Desk;
  const { $, $$, esc, money, num, dmy, hm, today, load, save, queue, sync, toast, printHtml } = D;
  const SLUG = 'reports';

  // أسماء البرامج ومفاتيح تخزينها — كلها على نفس الجهاز
  const SOURCES = [
    { slug: 'cashier', name: 'نيل كاشير', key: 'nile.os.cashier.v1' },
    { slug: 'stock', name: 'نيل مخازن', key: 'nile.os.stock.v1' },
    { slug: 'kitchen', name: 'نيل مطعم', key: 'nile.os.kitchen.v1' },
    { slug: 'attendance', name: 'نيل حضور', key: 'nile.os.attendance.v1' },
  ];

  const seed = () => ({ notes: [] });
  let doc = load(SLUG, seed);
  let view = 'dash';
  let repaint = () => {};

  function readSource(s) {
    try {
      const raw = localStorage.getItem(s.key);
      if (!raw) return { ...s, ok: false, doc: null };
      return { ...s, ok: true, doc: JSON.parse(raw) };
    } catch { return { ...s, ok: false, doc: null }; }
  }

  function collect() {
    const sources = SOURCES.map(readSource);
    const cashier = (sources.find((s) => s.slug === 'cashier') || {}).doc;
    const stock = (sources.find((s) => s.slug === 'stock') || {}).doc;
    const kitchen = (sources.find((s) => s.slug === 'kitchen') || {}).doc;
    const attendance = (sources.find((s) => s.slug === 'attendance') || {}).doc;
    const day = today();

    const salesToday = cashier ? cashier.sales.filter((s) => String(s.at).slice(0, 10) === day) : [];
    const salesTotal = cashier ? cashier.sales.reduce((a, s) => a + s.total, 0) : 0;
    const pending = sources.reduce((a, s) => a + ((s.doc && s.doc.pending) || []).length, 0);
    const stockValue = stock ? stock.items.reduce((a, i) => a + i.qty * i.cost, 0) : 0;
    const lowItems = stock ? stock.items.filter((i) => i.qty <= i.min).length : 0;
    const orders = kitchen ? kitchen.orders : [];
    const paidOrders = orders.filter((o) => o.status === 'paid');
    const ordersTotal = paidOrders.reduce((a, o) => a + (o.total || 0), 0);
    const punchesToday = attendance ? attendance.punches.filter((p) => p.date === day) : [];

    return {
      sources,
      day,
      cashier: {
        invoices: cashier ? cashier.sales.length : 0,
        today: salesToday.length,
        todayTotal: salesToday.reduce((a, s) => a + s.total, 0),
        total: salesTotal,
        cash: salesToday.filter((s) => s.method === 'cash').reduce((a, s) => a + s.total, 0),
        card: salesToday.filter((s) => s.method === 'card').reduce((a, s) => a + s.total, 0),
      },
      stock: { items: stock ? stock.items.length : 0, value: stockValue, low: lowItems, moves: stock ? stock.moves.length : 0 },
      kitchen: { open: orders.filter((o) => o.status === 'open').length, paid: paidOrders.length, total: ordersTotal },
      attendance: { present: new Set(punchesToday.filter((p) => p.kind === 'in').map((p) => p.employeeId)).size, late: punchesToday.filter((p) => p.kind === 'in' && p.late).length },
      pending,
      connected: sources.filter((s) => s.ok).length,
    };
  }

  function boot() {
    $$('.desk-nav[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; render(); }; });
    repaint = D.status($('#statusBar'), SLUG, doc, doSync);
    render();
  }

  async function doSync() {
    try {
      const r = await sync(SLUG, doc);
      toast(r.acked ? `اتزامن ${num(r.acked)}` : 'مفيش حاجة مستنية', 'ok');
      render();
      return r;
    } catch (e) { toast(e.message, 'bad'); throw e; }
  }

  function render() {
    $$('.desk-nav[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('#topActions').innerHTML = '';
    if (view === 'dash') return renderDash();
    if (view === 'report') return renderReport();
    if (view === 'sources') return renderSources();
    return renderSync();
  }

  /* ---------------- المؤشرات ---------------- */
  function renderDash() {
    const d = collect();
    $('#title').textContent = 'لوحة المؤشرات';
    $('#sub').innerHTML = `${dmy(d.day)} · ${num(d.connected)} من ${num(SOURCES.length)} برامج على هذا الجهاز`;
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="card pad kpi"><div class="lbl">بيع اليوم</div><div class="val">${money(d.cashier.todayTotal)}</div><div class="small muted">${num(d.cashier.today)} فاتورة</div></div>
        <div class="card pad kpi"><div class="lbl">إجمالي المبيعات</div><div class="val">${money(d.cashier.total)}</div><div class="small muted">${num(d.cashier.invoices)} فاتورة على الجهاز</div></div>
        <div class="card pad kpi"><div class="lbl">قيمة المخزون</div><div class="val">${money(d.stock.value)}</div><div class="small muted">${num(d.stock.items)} صنف · ${num(d.stock.low)} تحت الحد</div></div>
        <div class="card pad kpi"><div class="lbl">حضور اليوم</div><div class="val">${num(d.attendance.present)}</div><div class="small muted">${num(d.attendance.late)} متأخر</div></div>
      </div>
      <div class="grid g2">
        <div class="card pad">
          <h2 class="sec mb">المطعم</h2>
          <div class="totals">
            <div class="line"><span>طلبات مفتوحة</span><span>${num(d.kitchen.open)}</span></div>
            <div class="line"><span>طلبات محصّلة</span><span>${num(d.kitchen.paid)}</span></div>
            <div class="line grand"><span>إجمالي المحصّل</span><span>${money(d.kitchen.total)}</span></div>
          </div>
        </div>
        <div class="card pad">
          <h2 class="sec mb">الكاشير — اليوم</h2>
          <div class="totals">
            <div class="line"><span>نقدي</span><span>${money(d.cashier.cash)}</span></div>
            <div class="line"><span>كارت</span><span>${money(d.cashier.card)}</span></div>
            <div class="line grand"><span>الإجمالي</span><span>${money(d.cashier.todayTotal)}</span></div>
          </div>
        </div>
      </div>
      <div class="card pad small muted">كل رقم فوق مقروء من تخزين البرنامج المسؤول على هذا الجهاز. لو برنامج مسح بياناته أو مزامنته، الرقم ينزل لصفر — ولا نعرض رقماً لا يقابله بيانات.</div>`;
  }

  /* ---------------- تقرير A4 ---------------- */
  function reportHtml(d) {
    return `
      <h1 class="center">تقرير يوم ${dmy(d.day)}</h1>
      <div class="center small">نيل سيستمز · جهاز ${esc(doc.device)} · طُبع ${dmy(new Date().toISOString())} ${hm(new Date().toISOString())}</div>
      <div class="sep"></div>
      <table>
        <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
        <tbody>
          <tr><td>مبيعات اليوم (كاشير)</td><td class="mono">${money(d.cashier.todayTotal)}</td></tr>
          <tr><td>عدد فواتير اليوم</td><td class="mono">${num(d.cashier.today)}</td></tr>
          <tr><td>مبيعات نقدية / كارت</td><td class="mono">${money(d.cashier.cash)} / ${money(d.cashier.card)}</td></tr>
          <tr><td>إجمالي المبيعات على الجهاز</td><td class="mono">${money(d.cashier.total)}</td></tr>
          <tr><td>قيمة المخزون بالتكلفة</td><td class="mono">${money(d.stock.value)}</td></tr>
          <tr><td>أصناف تحت حد التنبيه</td><td class="mono">${num(d.stock.low)}</td></tr>
          <tr><td>طلبات مطعم محصّلة</td><td class="mono">${num(d.kitchen.paid)} — ${money(d.kitchen.total)}</td></tr>
          <tr><td>حضور اليوم / متأخرون</td><td class="mono">${num(d.attendance.present)} / ${num(d.attendance.late)}</td></tr>
          <tr><td>عمليات في انتظار المزامنة</td><td class="mono">${num(d.pending)}</td></tr>
        </tbody>
      </table>
      <div class="sep"></div>
      <div class="small">المصدر: ${d.sources.map((s) => `${esc(s.name)} (${s.ok ? 'موصول' : 'غير موصول'})`).join(' · ')}</div>
      <div class="sign"><span>توقيع الكاشير: ....................</span><span>توقيع المدير: ....................</span></div>`;
  }

  function renderReport() {
    const d = collect();
    $('#title').textContent = 'تقرير A4';
    $('#sub').textContent = 'صفحة واحدة، قابلة للتوقيع، بكل الأرقام ومصادرها';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="print">طباعة A4</button><button class="btn btn-ghost" id="csv">CSV</button>';
    $('#content').innerHTML = `
      <div class="card pad">
        <pre class="mono small" style="white-space:pre-wrap;margin:0">${esc(reportHtml(d).replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim())}</pre>
      </div>`;
    $('#print').onclick = () => {
      printHtml(reportHtml(d), { width: 'A4' });
      queue(SLUG, doc, 'report.print', { day: d.day });
      save(SLUG, doc); repaint();
      toast('التقرير اتبعت للطابعة', 'ok');
    };
    $('#csv').onclick = () => {
      const rows = [
        ['البند', 'القيمة'],
        ['اليوم', d.day],
        ['مبيعات اليوم', d.cashier.todayTotal],
        ['فواتير اليوم', d.cashier.today],
        ['مبيعات نقدية', d.cashier.cash],
        ['مبيعات كارت', d.cashier.card],
        ['إجمالي المبيعات', d.cashier.total],
        ['قيمة المخزون', d.stock.value],
        ['أصناف تحت الحد', d.stock.low],
        ['طلبات محصّلة', d.kitchen.paid],
        ['إجمالي المطعم', d.kitchen.total],
        ['حضور اليوم', d.attendance.present],
        ['متأخرون', d.attendance.late],
        ['في انتظار المزامنة', d.pending],
      ];
      const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `report-${d.day}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('CSV اتصدّر', 'ok');
    };
  }

  /* ---------------- المصادر ---------------- */
  function renderSources() {
    const d = collect();
    $('#title').textContent = 'مصادر البيانات';
    $('#sub').textContent = 'من أين يأتي كل رقم — وما هو غير موصول يُقال إنه غير موصول';
    $('#content').innerHTML = `
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>البرنامج</th><th>الحالة</th><th>عمليات في الانتظار</th><th>آخر مزامنة</th></tr></thead>
        <tbody>${d.sources.map((s) => `
          <tr>
            <td><b>${esc(s.name)}</b><div class="small muted mono">${esc(s.key)}</div></td>
            <td><span class="badge ${s.ok ? 'b-ok' : 'b-mute'}">${s.ok ? 'موصول' : 'لا بيانات على الجهاز'}</span></td>
            <td class="num">${num((s.doc && s.doc.pending ? s.doc.pending.length : 0))}</td>
            <td class="small mono">${s.doc && s.doc.lastSync ? `${dmy(s.doc.lastSync)} ${hm(s.doc.lastSync)}` : '—'}</td>
          </tr>`).join('')}</tbody></table></div></div>
      <div class="card pad">
        <b>الخادم</b>
        <div class="small muted mt" id="srvState">بنقرأ ملخص المزامنة من الخادم…</div>
        <button class="btn btn-sm mt" id="ping">اقرأ من الخادم</button>
      </div>`;
    const ping = async () => {
      try {
        const r = await fetch('/api/windows/summary', { headers: { 'x-nile-device': 'demo-device' } });
        if (!r.ok) throw new Error(`الخادم رد ${r.status}`);
        const s = await r.json();
        $('#srvState').innerHTML = `متوصل · ${num(s.totalOps)} عملية مستلمة · ${num(s.programs.length)} برنامج زامن
          <div class="mt small">${s.programs.map((p) => `${esc(p.program)}: ${num(p.ops)} عملية (آخر ${esc(p.lastAt ? hm(p.lastAt) : '—')})`).join(' · ') || 'مفيش مزامنات لسه'}</div>`;
      } catch (e) { $('#srvState').textContent = `تعذّر القراءة من الخادم (${e.message}) — البرنامج بلا شبكة يظل يعمل.`; }
    };
    $('#ping').onclick = ping;
    ping();
  }

  /* ---------------- المزامنة ---------------- */
  function renderSync() {
    $('#title').textContent = 'المزامنة';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="syncNow">زامن الآن</button>';
    $('#sub').textContent = 'التقارير نفسها تُسجَّل كعمليات — والطباعة تُزامن أيضاً';
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="kpi card pad"><div class="lbl">في الانتظار</div><div class="val">${num(doc.pending.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">آخر مزامنة</div><div class="val" style="font-size:18px">${doc.lastSync ? hm(doc.lastSync) : '—'}</div></div>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>النوع</th><th>الوقت</th><th>المفتاح</th></tr></thead>
        <tbody>${doc.pending.length ? doc.pending.slice(-30).reverse().map((o) => `
          <tr><td class="small">${esc(o.type)}</td><td class="small">${dmy(o.at)} ${hm(o.at)}</td><td class="mono small">${esc(o.key)}</td></tr>`).join('')
          : '<tr><td colspan="3" class="empty">كل حاجة متزامنة</td></tr>'}</tbody></table></div></div>
      <div class="card pad"><b>إعادة ضبط</b>
        <div class="small muted mt">يمسح عمليات هذا البرنامج فقط — بيانات البرامج الأخرى لا تُمس.</div>
        <button class="btn btn-danger btn-sm mt" id="resetApp">إعادة ضبط التقارير</button></div>`;
    $('#syncNow').onclick = () => doSync().catch(() => {});
    $('#resetApp').onclick = () => {
      doc = D.reset(SLUG, seed);
      repaint = D.status($('#statusBar'), SLUG, doc, doSync);
      toast('اتضبط', 'ok'); render();
    };
  }

  window.addEventListener('online', () => doSync().catch(() => {}));
  boot();
})();
