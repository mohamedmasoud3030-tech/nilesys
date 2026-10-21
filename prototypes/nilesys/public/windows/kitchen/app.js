/* ===== نيل مطعم (ويندوز) =====
 *
 * صالة + شاشة مطبخ + طباعة تذكرة 80mm على نفس الجهاز. يعمل بلا إنترنت كاملاً.
 *
 * القواعد: لا طباعة تذكرة قبل الإرسال · كل تذكرة تُطبع مرة واحدة وتُسجَّل
 * إعادة الطبع · لا تحصيل قبل إرسال المطبخ · الترابيزة لا تُفرَّغ إلا بعد الدفع.
 */
(function () {
  'use strict';
  const D = window.Desk;
  const { $, $$, esc, money, num, uid, dmy, hm, load, save, queue, sync, toast, modal, closeModal, printHtml } = D;
  const SLUG = 'kitchen';

  const MENU = [
    { id: 'm1', name: 'مشويات مشكلة', price: 320, station: 'مطبخ' },
    { id: 'm2', name: 'فراخ مشوية', price: 240, station: 'مطبخ' },
    { id: 'm3', name: 'كفتة', price: 210, station: 'مطبخ' },
    { id: 'm4', name: 'طاجن بامية', price: 150, station: 'مطبخ' },
    { id: 'm5', name: 'شوربة عدس', price: 60, station: 'مطبخ' },
    { id: 'm6', name: 'سلطة بلدي', price: 45, station: 'بار' },
    { id: 'm7', name: 'مياه معدنية', price: 15, station: 'بار' },
    { id: 'm8', name: 'مشروب غازي', price: 25, station: 'بار' },
    { id: 'm9', name: 'شاي', price: 20, station: 'بار' },
    { id: 'm10', name: 'كولا كبيرة', price: 30, station: 'بار' },
  ];
  const seed = () => ({
    tables: Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, name: `ترابيزة ${i + 1}`, seats: i < 4 ? 2 : 4 })),
    orders: [],
    seq: 500,
  });

  let doc = load(SLUG, seed);
  let view = 'floor';
  let activeTableId = null;
  let draft = [];
  let repaint = () => {};

  const openOrder = (tableId) => doc.orders.find((o) => o.tableId === tableId && o.status === 'open') || null;
  const tableState = (t) => {
    const o = openOrder(t.id);
    return o ? (o.sentAt ? 'busy' : 'draft') : 'free';
  };

  function boot() {
    $$('.desk-nav[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; activeTableId = null; render(); }; });
    repaint = D.status($('#statusBar'), SLUG, doc, doSync);
    render();
  }

  async function doSync() {
    try {
      const r = await sync(SLUG, doc);
      if (r.acked) toast(`اتزامن ${num(r.acked)} حركة`, 'ok');
      else if (r.empty) toast('مفيش حاجة مستنية', 'ok');
      render();
      return r;
    } catch (e) { toast(e.message, 'bad'); throw e; }
  }

  function render() {
    $$('.desk-nav[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('#topActions').innerHTML = '';
    if (view === 'floor') return renderFloor();
    if (view === 'kitchen') return renderKitchen();
    if (view === 'orders') return renderOrders();
    return renderSync();
  }

  /* ---------------- الصالة / الطلب ---------------- */
  function renderFloor() {
    if (activeTableId) return renderTable();
    $('#title').textContent = 'الترابيزات';
    const busy = doc.orders.filter((o) => o.status === 'open').length;
    $('#sub').innerHTML = `${num(busy)} ترابيزة مشغولة من ${num(doc.tables.length)}`;
    $('#content').innerHTML = `<div class="tiles fill" id="tiles" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));align-content:start"></div>`;
    $('#tiles').innerHTML = doc.tables.map((t) => {
      const st = tableState(t);
      const o = openOrder(t.id);
      const label = st === 'free' ? 'فاضية' : st === 'draft' ? 'طلب مفتوح' : 'نشطة';
      const cls = st === 'free' ? 'b-ok' : st === 'draft' ? 'b-warn' : 'b-info';
      return `<button class="tile-btn" data-table="${esc(t.id)}" style="min-height:110px">
        <div class="row between"><b>${esc(t.name)}</b><span class="badge ${cls}">${label}</span></div>
        <div class="small muted">${num(t.seats)} أفراد</div>
        ${o ? `<div class="price">${money(orderTotal(o))}</div>` : '<div class="small muted">—</div>'}
      </button>`;
    }).join('');
    $$('#tiles [data-table]').forEach((b) => (b.onclick = () => { activeTableId = b.dataset.table; draft = []; render(); }));
  }

  const orderTotal = (o) => Math.round(o.items.reduce((a, i) => a + i.price * i.qty, 0) * 100) / 100;

  function renderTable() {
    const t = doc.tables.find((x) => x.id === activeTableId);
    const o = openOrder(t.id);
    const items = o ? o.items : draft.map((d) => ({ ...d, state: 'draft' }));
    $('#title').textContent = t.name;
    $('#sub').textContent = o ? `طلب #${o.no} — ${o.sentAt ? 'اتبعت للمطبخ' : 'لم يُبعت بعد'}` : 'طلب جديد';
    $('#topActions').innerHTML = '<button class="btn btn-ghost" id="backFloor">↩ الصالة</button>';
    $('#content').innerHTML = `
      <div class="split split-main fill">
        <div class="card pad">
          <h2 class="sec mb">القائمة</h2>
          <div class="tiles" id="menu"></div>
        </div>
        <div class="card pad">
          <div class="row between mb"><h2 class="sec">الطلب</h2><span class="badge b-mute" id="cnt">0</span></div>
          <div class="cart" id="lines"></div>
          <div class="totals mt"><div class="line grand"><span>الإجمالي</span><span id="tot">0 ج.م</span></div></div>
          <div class="grid mt" style="grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-primary" id="sendBtn">إرسال للمطبخ</button>
            <button class="btn" id="payBtn">تحصيل وإغلاق</button>
          </div>
          <div class="small muted mt" id="hint">التحصيل يفتح بعد الإرسال فقط.</div>
        </div>
      </div>`;
    $('#backFloor').onclick = () => { activeTableId = null; render(); };
    $('#menu').innerHTML = MENU.map((m) => `
      <button class="tile-btn" data-menu="${esc(m.id)}">
        <b>${esc(m.name)}</b><span class="price">${money(m.price)}</span>
        <span class="small muted">${esc(m.station)}</span>
      </button>`).join('');
    $$('#menu [data-menu]').forEach((b) => (b.onclick = () => addLine(b.dataset.menu)));
    paintLines();
    $('#sendBtn').onclick = sendToKitchen;
    $('#payBtn').onclick = payModal;
  }

  function addLine(menuId) {
    const m = MENU.find((x) => x.id === menuId);
    const o = openOrder(activeTableId);
    if (o && o.sentAt) {
      // بعد الإرسال: الإضافة تصبح سطراً جديداً يُرسل بتذكرة تانية
      o.items.push({ id: uid(), menuId: m.id, name: m.name, price: m.price, qty: 1, station: m.station, state: 'new' });
      save(SLUG, doc);
    } else {
      const line = draft.find((l) => l.menuId === m.id);
      if (line) line.qty += 1; else draft.push({ menuId: m.id, name: m.name, price: m.price, qty: 1, station: m.station });
    }
    renderTable();
  }

  function paintLines() {
    const o = openOrder(activeTableId);
    const items = o ? o.items : draft;
    $('#cnt').textContent = `${num(items.reduce((a, l) => a + l.qty, 0))} صنف`;
    $('#lines').innerHTML = items.length ? items.map((l, i) => `
      <div class="cart-line">
        <span class="nm">${esc(l.name)}<span class="small muted mono" style="display:block">${money(l.price)} × ${num(l.qty)}${l.state && l.state !== 'draft' ? ' · ' + esc(l.state) : ''}</span></span>
        <span class="row" style="gap:4px">
          ${o && o.sentAt ? '<span class="badge b-info small">اتبعت</span>' : `
            <button class="qty-btn" data-minus="${i}">−</button><b class="mono">${num(l.qty)}</b>
            <button class="qty-btn" data-plus="${i}">+</button>`}
        </span>
        <b class="mono">${money(l.price * l.qty)}</b>
      </div>`).join('') : '<div class="empty">مفيش أصناف</div>';
    if (!(o && o.sentAt)) {
      $$('#lines [data-plus]').forEach((b) => (b.onclick = () => { draft[Number(b.dataset.plus)].qty += 1; renderTable(); }));
      $$('#lines [data-minus]').forEach((b) => (b.onclick = () => {
        const i = Number(b.dataset.minus);
        draft[i].qty -= 1; if (draft[i].qty <= 0) draft.splice(i, 1);
        renderTable();
      }));
    }
    const total = (o ? orderTotal(o) : draft.reduce((a, l) => a + l.price * l.qty, 0));
    $('#tot').textContent = money(total);
    const canPay = Boolean(o && o.sentAt && o.items.every((i) => i.state === 'served'));
    $('#payBtn').disabled = !canPay;
    $('#hint').textContent = !o ? 'أرسل الطلب للمطبخ الأول.'
      : !o.sentAt ? 'الطلب لم يُبعت — التحصيل مقفول.'
        : canPay ? 'كل الأصناف قدّمت — التحصيل متاح.'
          : 'التحصيل يفتح بعد تقديم كل الأصناف.';
  }

  function sendToKitchen() {
    if (!draft.length) return toast('مفيش أصناف تتبعت', 'bad');
    doc.seq += 1;
    const order = {
      id: uid(), no: doc.seq, tableId: activeTableId, at: new Date().toISOString(),
      sentAt: new Date().toISOString(), status: 'open', ticketPrints: 0,
      items: draft.map((l) => ({ id: uid(), ...l, state: 'new' })),
    };
    doc.orders.push(order);
    draft = [];
    queue(SLUG, doc, 'order.sent', { no: order.no, items: order.items.length }, orderTotal(order));
    save(SLUG, doc);
    printTicket(order);
    toast('الطلب اتبعت للمطبخ والتذكرة اتطبع', 'ok');
    repaint(); renderTable();
  }

  function ticketHtml(order) {
    const t = doc.tables.find((x) => x.id === order.tableId);
    return `
      <h1 class="center">تذكرة مطبخ</h1>
      <div class="center small">${esc(t ? t.name : '')} · طلب #${order.no}</div>
      <div class="center small mono">${hm(order.sentAt)} ${dmy(order.sentAt)}</div>
      <div class="sep"></div>
      <table>${order.items.map((i) => `<tr><td><b>${num(i.qty)}×</b> ${esc(i.name)}</td><td class="small">${esc(i.station)}</td></tr>`).join('')}</table>
      <div class="sep"></div>
      <div class="center small">${order.ticketPrints > 0 ? 'إعادة طباعة' : 'النسخة الأولى'}</div>`;
  }

  function printTicket(order) {
    order.ticketPrints = (order.ticketPrints || 0) + 1;
    order.lastPrintAt = new Date().toISOString();
    save(SLUG, doc);
    printHtml(ticketHtml(order), { width: '80mm' });
  }

  /* ---------------- المطبخ ---------------- */
  function renderKitchen() {
    $('#title').textContent = 'شاشة المطبخ';
    const open = doc.orders.filter((o) => o.status === 'open' && o.items.some((i) => i.state !== 'served'));
    $('#sub').innerHTML = `${num(open.length)} تذكرة مفتوحة — الأقدم أولاً`;
    $('#content').innerHTML = open.length ? `<div class="grid g2 fill" id="board" style="align-content:start"></div>`
      : '<div class="card empty">المطبخ فاضي — مفيش تذاكر مفتوحة</div>';
    if (!open.length) return;
    const now = Date.now();
    $('#board').innerHTML = open.map((o) => {
      const t = doc.tables.find((x) => x.id === o.tableId);
      const mins = Math.max(0, Math.round((now - new Date(o.sentAt).getTime()) / 60000));
      return `<div class="ticket ${o.items.some((i) => i.state === 'new') ? 'new' : o.items.some((i) => i.state === 'cooking') ? 'cooking' : ''}">
        <div class="row between"><b>#${num(o.no)} · ${esc(t ? t.name : '')}</b><span class="badge ${mins > 15 ? 'b-bad' : 'b-mute'}">${num(mins)} دقيقة</span></div>
        <div class="grid mt" style="gap:6px">
          ${o.items.filter((i) => i.state !== 'served').map((i) => `
            <div class="row between" style="gap:6px">
              <span class="small"><b>${num(i.qty)}×</b> ${esc(i.name)} <span class="badge b-mute">${esc(i.state)}</span></span>
              <span class="row" style="gap:4px">
                ${i.state === 'new' ? `<button class="btn btn-sm" data-cook="${esc(i.id)}" data-order="${esc(o.id)}">ابدأ</button>` : ''}
                ${i.state === 'cooking' ? `<button class="btn btn-sm" data-ready="${esc(i.id)}" data-order="${esc(o.id)}">جاهز</button>` : ''}
                ${i.state === 'ready' ? `<button class="btn btn-sm" data-served="${esc(i.id)}" data-order="${esc(o.id)}">قدّمني</button>` : ''}
              </span>
            </div>`).join('')}
        </div>
      </div>`;
    }).join('');
    const step = (orderId, itemId, to) => {
      const o = doc.orders.find((x) => x.id === orderId);
      const it = o && o.items.find((x) => x.id === itemId);
      if (!it) return;
      it.state = to;
      queue(SLUG, doc, `item.${to}`, { no: o.no });
      save(SLUG, doc); repaint(); renderKitchen();
    };
    $$('#board [data-cook]').forEach((b) => (b.onclick = () => step(b.dataset.order, b.dataset.cook, 'cooking')));
    $$('#board [data-ready]').forEach((b) => (b.onclick = () => step(b.dataset.order, b.dataset.ready, 'ready')));
    $$('#board [data-served]').forEach((b) => (b.onclick = () => step(b.dataset.order, b.dataset.served, 'served')));
  }

  /* ---------------- التحصيل ---------------- */
  function payModal() {
    const o = openOrder(activeTableId);
    if (!o) return toast('مفيش طلب', 'bad');
    if (!o.sentAt) return toast('ابعت الطلب للمطبخ الأول', 'bad');
    if (!o.items.every((i) => i.state === 'served')) return toast('فيه أصناف لسه ما اتقدمتش', 'bad');
    const total = orderTotal(o);
    modal({
      title: `تحصيل طلب #${o.no}`,
      body: `<div class="row between" style="font-size:18px"><b>الإجمالي</b><b class="mono">${money(total)}</b></div>
        <div class="field mt"><label class="label">طريقة الدفع</label>
          <div class="row" style="gap:8px"><button class="btn btn-primary" data-m="cash">نقدي</button><button class="btn btn-ghost" data-m="card">كارت</button></div></div>
        <div class="field"><label class="label">المدفوع</label><input class="input mono" id="paid" inputmode="decimal" value="${total}" /></div>
        <div class="row between"><b>الباقي</b><b class="mono" id="change">0 ج.م</b></div>`,
      footer: '<button class="btn btn-ghost" id="pc">إلغاء</button><button class="btn btn-primary" id="pok">تم التحصيل</button>',
    });
    let method = 'cash';
    const paint = () => {
      const diff = Math.round((Number($('#paid').value) - total) * 100) / 100;
      $('#change').textContent = diff >= 0 ? money(diff) : 'ناقص ' + money(-diff);
      $('#change').style.color = diff >= 0 ? 'var(--ok)' : 'var(--bad)';
      $('#pok').disabled = diff < 0;
    };
    $$('[data-m]').forEach((b) => (b.onclick = () => {
      method = b.dataset.m;
      $$('[data-m]').forEach((x) => x.className = 'btn ' + (x.dataset.m === method ? 'btn-primary' : 'btn-ghost'));
    }));
    $('#paid').oninput = paint; paint();
    $('#pc').onclick = closeModal;
    $('#pok').onclick = () => {
      o.status = 'paid';
      o.paidAt = new Date().toISOString();
      o.method = method;
      o.total = total;
      queue(SLUG, doc, 'order.paid', { no: o.no, method }, total);
      save(SLUG, doc);
      closeModal();
      toast(`طلب #${o.no} اتحصّل`, 'ok');
      activeTableId = null; repaint(); render();
    };
  }

  /* ---------------- الطلبات ---------------- */
  function renderOrders() {
    $('#title').textContent = 'الطلبات';
    const done = doc.orders.slice().reverse();
    $('#sub').innerHTML = `${num(doc.orders.filter((o) => o.status === 'open').length)} مفتوح · ${num(done.length)} إجمالاً`;
    $('#content').innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>الترابيزة</th><th>الأصناف</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${done.length ? done.map((o) => {
        const t = doc.tables.find((x) => x.id === o.tableId);
        return `<tr>
          <td class="num">${num(o.no)}</td>
          <td class="small">${esc(t ? t.name : '—')}<div class="small muted">${hm(o.at)}</div></td>
          <td class="small">${esc(o.items.map((i) => `${i.name} ×${i.qty}`).join(' · '))}</td>
          <td class="num">${money(orderTotal(o))}</td>
          <td><span class="badge ${o.status === 'paid' ? 'b-ok' : 'b-warn'}">${o.status === 'paid' ? 'مدفوع' : 'مفتوح'}</span></td>
          <td><button class="btn btn-ghost btn-sm" data-reprint="${esc(o.id)}">تذكرة</button></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty">مفيش طلبات لسه</td></tr>'}</tbody></table></div></div>`;
    $$('[data-reprint]').forEach((b) => (b.onclick = () => {
      const o = doc.orders.find((x) => x.id === b.dataset.reprint);
      if (!o) return;
      printTicket(o);
      if (o.ticketPrints > 1) {
        queue(SLUG, doc, 'ticket.reprint', { no: o.no });
        save(SLUG, doc); repaint();
        toast('إعادة طباعة مسجّلة على التذكرة', 'ok');
      }
    }));
  }

  /* ---------------- المزامنة ---------------- */
  function renderSync() {
    $('#title').textContent = 'المزامنة';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="syncNow">زامن الآن</button>';
    $('#sub').textContent = 'الطلبات تُحفظ محلياً وتُزامن عند رجوع الشبكة';
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="kpi card pad"><div class="lbl">في الانتظار</div><div class="val">${num(doc.pending.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">طلبات</div><div class="val">${num(doc.orders.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">آخر مزامنة</div><div class="val" style="font-size:18px">${doc.lastSync ? hm(doc.lastSync) : '—'}</div></div>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>النوع</th><th>الوقت</th><th>المفتاح</th></tr></thead>
        <tbody>${doc.pending.length ? doc.pending.slice(-30).reverse().map((o) => `
          <tr><td class="small">${esc(o.type)}</td><td class="small">${dmy(o.at)} ${hm(o.at)}</td><td class="mono small">${esc(o.key)}</td></tr>`).join('')
          : '<tr><td colspan="3" class="empty">كل حاجة متزامنة</td></tr>'}</tbody></table></div></div>
      <div class="card pad"><b>إعادة ضبط بيانات العرض</b>
        <div class="small muted mt">يمسح الطلبات ويعيد الترابيزات فاضية — للتجربة فقط.</div>
        <button class="btn btn-danger btn-sm mt" id="resetApp">إعادة ضبط الجهاز</button></div>`;
    $('#syncNow').onclick = () => doSync().catch(() => {});
    $('#resetApp').onclick = () => {
      doc = D.reset(SLUG, seed); draft = []; activeTableId = null;
      repaint = D.status($('#statusBar'), SLUG, doc, doSync);
      toast('الجهاز اترجع للبيانات الأولية', 'ok'); render();
    };
  }

  window.addEventListener('online', () => doSync().catch(() => {}));
  boot();
})();
