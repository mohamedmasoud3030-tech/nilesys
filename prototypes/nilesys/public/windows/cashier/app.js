/* ===== نيل كاشير (ويندوز) =====
 *
 * برنامج بيع مستقل: يعمل بلا إنترنت، ويحفظ كل فاتورة على الجهاز بمفتاح فريد
 * قبل أي شيء، ثم يزامنها. الخادم يعرف المفتاح فلا تتكرر فاتورة أبداً.
 *
 * القواعد: لا بيع بسلة فاضية · لا دفع ناقص · الوردية تُفتح قبل البيع النقدي ·
 * إغلاق الوردية يحسب الفرق بين المتوقع والمعدود · الإيصال يُطبع 80mm.
 */
(function () {
  'use strict';
  const D = window.Desk;
  const { $, $$, esc, money, num, uid, dmy, hm, today, load, save, queue, sync, toast, modal, closeModal, printHtml } = D;
  const SLUG = 'cashier';

  const seed = () => ({
    settings: { storeName: 'سوبر ماركت النيل', branch: 'فرع سموحة', taxRate: 0 },
    products: [
      { id: 'p1', name: 'لبن جهينة 1 لتر', price: 38, cost: 32, code: 'P-1001', stock: 40 },
      { id: 'p2', name: 'عيش بلدي', price: 5, cost: 3, code: 'P-1002', stock: 200 },
      { id: 'p3', name: 'زيت عافية 1 لتر', price: 92, cost: 80, code: 'P-1003', stock: 25 },
      { id: 'p4', name: 'شاي العروسة 250 جم', price: 55, cost: 45, code: 'P-1004', stock: 30 },
      { id: 'p5', name: 'جبنة رومي كيلو', price: 210, cost: 180, code: 'P-1005', stock: 12 },
      { id: 'p6', name: 'مياه معدنية 1.5 لتر', price: 8, cost: 5, code: 'P-1006', stock: 90 },
      { id: 'p7', name: 'شيبسي كبير', price: 20, cost: 15, code: 'P-1007', stock: 60 },
      { id: 'p8', name: 'شوكولاتة كادبوري', price: 45, cost: 36, code: 'P-1008', stock: 35 },
      { id: 'p9', name: 'سكر ناعم كيلو', price: 32, cost: 27, code: 'P-1009', stock: 50 },
      { id: 'p10', name: 'أرز مصري كيلو', price: 36, cost: 29, code: 'P-1010', stock: 48 },
      { id: 'p11', name: 'مسحوق غسيل 2 كجم', price: 165, cost: 140, code: 'P-1011', stock: 18 },
      { id: 'p12', name: 'مناديل ورقية', price: 25, cost: 18, code: 'P-1012', stock: 44 },
    ],
    sales: [],
    shifts: [],
    seq: 1000,
  });

  let doc = load(SLUG, seed);
  let view = 'sell';
  let cart = [];
  let repaint = () => {};

  const openShift = () => doc.shifts.find((s) => !s.closedAt) || null;
  const cashSales = (sh) => doc.sales.filter((s) => s.shiftId === sh.id && s.method === 'cash')
    .reduce((a, s) => a + s.total, 0);

  /* ---------------- الهيكل ---------------- */
  function boot() {
    $$('.desk-nav[data-view]').forEach((b) => {
      b.onclick = () => { view = b.dataset.view; cartRender(); render(); };
    });
    repaint = D.status($('#statusBar'), SLUG, doc, doSync);
    render();
  }

  async function doSync() {
    try {
      const r = await sync(SLUG, doc);
      if (r.acked) toast(`اتزامن ${num(r.acked)} عملية`, 'ok');
      else if (r.empty) toast('مفيش حاجة مستنية', 'ok');
      render();
      return r;
    } catch (e) { toast(e.message, 'bad'); throw e; }
  }

  function render() {
    $$('.desk-nav[data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
    $('#topActions').innerHTML = '';
    if (view === 'sell') return renderSell();
    if (view === 'invoices') return renderInvoices();
    if (view === 'shift') return renderShift();
    return renderSync();
  }

  /* ---------------- البيع ---------------- */
  function renderSell() {
    const sh = openShift();
    $('#title').textContent = 'بيع';
    $('#sub').innerHTML = sh
      ? `وردية مفتوحة من ${hm(sh.openedAt)} · درج البداية ${money(sh.openingCash)}`
      : 'مفيش وردية مفتوحة — البيع النقدي يحتاج وردية';
    $('#content').innerHTML = `
      ${sh ? '' : `<div class="card pad" style="border-inline-start:4px solid var(--warn)">
        <div class="row between wrapw"><span><b>الدرج مقفول.</b> افتح وردية بالدرج اللي في الصندوق الأول.</span>
        <button class="btn btn-primary" id="openFromSell">افتح وردية</button></div></div>`}
      <div class="grid" style="grid-template-columns:minmax(280px,1.55fr) minmax(300px,1fr);align-items:start">
        <div class="card pad">
          <div class="row between mb">
            <h2 class="sec">الأصناف</h2>
            <input class="input" id="q" placeholder="ابحث بالاسم أو الكود" style="max-width:220px" />
          </div>
          <div class="tiles" id="tiles"></div>
        </div>
        <div class="card pad">
          <div class="row between mb"><h2 class="sec">الفاتورة</h2><span class="badge b-mute" id="cartCount">0 صنف</span></div>
          <div class="cart" id="cart"></div>
          <div class="totals mt" id="totals"></div>
          <div class="row mt" style="gap:8px">
            <button class="btn btn-primary" id="pay" style="flex:1">تحصيل (F2)</button>
            <button class="btn btn-ghost btn-sm" id="clearCart">تفريغ</button>
          </div>
        </div>
      </div>`;
    const paint = (filter = '') => {
      const list = doc.products.filter((p) => !filter
        || p.name.includes(filter) || p.code.toLowerCase().includes(filter.toLowerCase()));
      $('#tiles').innerHTML = list.map((p) => `
        <button class="tile-btn" data-add="${esc(p.id)}">
          <b>${esc(p.name)}</b>
          <span class="price">${money(p.price)}</span>
          <span class="small muted mono">${esc(p.code)} · رصيد ${num(p.stock)}</span>
        </button>`).join('') || '<div class="empty">مفيش صنف بالاسم ده</div>';
      $$('#tiles [data-add]').forEach((b) => (b.onclick = () => addToCart(b.dataset.add)));
    };
    paint();
    $('#q').oninput = (e) => paint(e.target.value.trim());
    if ($('#openFromSell')) $('#openFromSell').onclick = () => { view = 'shift'; render(); };
    $('#clearCart').onclick = () => { cart = []; cartRender(); };
    $('#pay').onclick = payModal;
    cartRender();
  }

  function addToCart(id) {
    const p = doc.products.find((x) => x.id === id);
    if (!p) return;
    const line = cart.find((l) => l.productId === id);
    if (line) line.qty += 1; else cart.push({ productId: id, name: p.name, price: p.price, qty: 1, code: p.code });
    cartRender();
  }

  function cartRender() {
    const host = $('#cart');
    if (!host) return;
    const count = cart.reduce((a, l) => a + l.qty, 0);
    $('#cartCount').textContent = `${num(count)} صنف`;
    host.innerHTML = cart.length ? cart.map((l, i) => `
      <div class="cart-line">
        <span class="nm">${esc(l.name)}<span class="small muted mono" style="display:block">${money(l.price)} × ${num(l.qty)}</span></span>
        <span class="row" style="gap:4px">
          <button class="qty-btn" data-minus="${i}" aria-label="أنقص">−</button>
          <b class="mono">${num(l.qty)}</b>
          <button class="qty-btn" data-plus="${i}" aria-label="زيد">+</button>
        </span>
        <b class="mono">${money(l.price * l.qty)}</b>
      </div>`).join('') : '<div class="empty">السلة فاضية — اختر صنفاً</div>';
    $$('#cart [data-plus]').forEach((b) => (b.onclick = () => { cart[Number(b.dataset.plus)].qty += 1; cartRender(); }));
    $$('#cart [data-minus]').forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.minus);
      cart[i].qty -= 1;
      if (cart[i].qty <= 0) cart.splice(i, 1);
      cartRender();
    }));
    const sub = cart.reduce((a, l) => a + l.price * l.qty, 0);
    const taxRate = Number(doc.settings.taxRate) || 0;
    const tax = Math.round(sub * taxRate) / 100;
    const total = Math.round((sub + tax) * 100) / 100;
    const t = $('#totals');
    if (t) {
      t.innerHTML = `
        <div class="line"><span>الإجمالي قبل الضريبة</span><span>${money(sub)}</span></div>
        ${taxRate ? `<div class="line"><span>ضريبة ${taxRate}%</span><span>${money(tax)}</span></div>` : ''}
        <div class="line grand"><span>المطلوب</span><span>${money(total)}</span></div>`;
    }
    const pay = $('#pay');
    if (pay) pay.disabled = cart.length === 0;
  }

  function payModal() {
    if (!cart.length) return toast('السلة فاضية', 'bad');
    if (!openShift()) return toast('افتح وردية الأول', 'bad');
    const sub = cart.reduce((a, l) => a + l.price * l.qty, 0);
    const taxRate = Number(doc.settings.taxRate) || 0;
    const total = Math.round((sub + sub * (taxRate / 100)) * 100) / 100;
    let method = 'cash';
    let cash = String(Math.ceil(total));
    modal({
      title: 'تحصيل',
      body: `
        <div class="row" style="gap:8px;margin-bottom:10px">
          <button class="btn btn-primary" data-m="cash">نقدي</button>
          <button class="btn btn-ghost" data-m="card">فيزا / كارت</button>
        </div>
        <div class="field"><label class="label">المبلغ المدفوع</label><input class="input mono" id="paid" inputmode="decimal" value="${cash}" /></div>
        <div class="keys" id="keys"></div>
        <div class="row between mt" style="font-size:18px"><b>الباقي</b><b class="mono" id="change">0 ج.م</b></div>`,
      footer: `<button class="btn btn-ghost" id="cancelPay">إلغاء</button><button class="btn btn-primary" id="okPay">تم التحصيل</button>`,
    });
    const paint = () => {
      const paid = Number(cash) || 0;
      const diff = Math.round((paid - total) * 100) / 100;
      $('#change').textContent = diff >= 0 ? money(diff) : 'ناقص ' + money(-diff);
      $('#change').style.color = diff >= 0 ? 'var(--ok)' : 'var(--bad)';
      $('#okPay').disabled = diff < 0;
    };
    $('#keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
      .map((k) => `<button data-k="${k}">${k}</button>`).join('');
    $$('#keys [data-k]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.k;
      if (k === '⌫') cash = cash.slice(0, -1);
      else cash = (cash === '0' ? '' : cash) + k;
      $('#paid').value = cash || '';
      paint();
    }));
    $$('[data-m]').forEach((b) => (b.onclick = () => {
      method = b.dataset.m;
      $$('[data-m]').forEach((x) => x.className = 'btn ' + (x.dataset.m === method ? 'btn-primary' : 'btn-ghost'));
      if (method === 'card') { cash = String(total); $('#paid').value = cash; paint(); }
    }));
    $('#paid').oninput = (e) => { cash = e.target.value.replace(/[^\d.]/g, ''); paint(); };
    $('#cancelPay').onclick = closeModal;
    $('#okPay').onclick = () => finishSale({ method, paid: Number(cash) || total, total });
    paint();
  }

  function finishSale({ method, paid, total }) {
    const sh = openShift();
    try {
      doc.seq += 1;
      const sale = {
        id: uid(), no: doc.seq, at: new Date().toISOString(), shiftId: sh ? sh.id : null,
        items: cart.map((l) => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty })),
        subtotal: Math.round(cart.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100,
        total, method, paid, change: Math.round((paid - total) * 100) / 100,
        cashier: 'كاشير الجهاز',
      };
      // الرصيد محلياً — والبرنامج لا يبيع أكثر من الموجود
      for (const l of sale.items) {
        const p = doc.products.find((x) => x.id === l.productId);
        if (p) p.stock = Math.max(0, p.stock - l.qty);
      }
      doc.sales.push(sale);
      queue(SLUG, doc, 'sale', { no: sale.no, items: sale.items.length, method, branch: doc.settings.branch }, total);
      save(SLUG, doc);
      closeModal();
      cart = [];
      renderSell();
      repaint();
      printReceipt(sale);
      toast(`فاتورة #${sale.no} اتحفظت على الجهاز`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  function receiptHtml(sale) {
    const lines = sale.items.map((l) => `<tr><td>${esc(l.name)} × ${num(l.qty)}</td><td class="mono">${money(l.price * l.qty)}</td></tr>`).join('');
    return `
      <h1 class="center">${esc(doc.settings.storeName)}</h1>
      <div class="center small">${esc(doc.settings.branch)} · ${dmy(sale.at)} ${hm(sale.at)}</div>
      <div class="center small mono">فاتورة #${sale.no} · ${sale.method === 'cash' ? 'نقدي' : 'كارت'}</div>
      <div class="sep"></div>
      <table>${lines}</table>
      <div class="sep"></div>
      <div class="row"><span>الإجمالي</span><span class="mono tot">${money(sale.total)}</span></div>
      <div class="row"><span>المدفوع</span><span class="mono">${money(sale.paid)}</span></div>
      <div class="row"><span>الباقي</span><span class="mono">${money(sale.change)}</span></div>
      <div class="sep"></div>
      <div class="center small">شكراً لزيارتكم — الاستبدال خلال 14 يوم بالإيصال</div>
      <div class="center small mono">${esc(sale.id)}</div>`;
  }
  const printReceipt = (sale) => printHtml(receiptHtml(sale), { width: '80mm' });

  /* ---------------- الفواتير ---------------- */
  function renderInvoices() {
    $('#title').textContent = 'الفواتير';
    const total = doc.sales.reduce((a, s) => a + s.total, 0);
    $('#sub').innerHTML = `${num(doc.sales.length)} فاتورة على الجهاز · إجمالي ${money(total)}`;
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="card pad kpi"><div class="lbl">فواتير</div><div class="val">${num(doc.sales.length)}</div></div>
        <div class="card pad kpi"><div class="lbl">إجمالي البيع</div><div class="val">${money(total)}</div></div>
        <div class="card pad kpi"><div class="lbl">في انتظار المزامنة</div><div class="val">${num(doc.pending.length)}</div></div>
      </div>
      <div class="card">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>#</th><th>الوقت</th><th>الأصناف</th><th>الطريقة</th><th>الإجمالي</th><th></th></tr></thead>
          <tbody id="rows"></tbody></table></div>
      </div>`;
    $('#rows').innerHTML = doc.sales.length ? doc.sales.slice().reverse().map((s) => `
      <tr>
        <td class="num">${num(s.no)}</td>
        <td class="small">${dmy(s.at)} ${hm(s.at)}</td>
        <td class="small">${esc(s.items.map((i) => `${i.name} ×${i.qty}`).join(' · '))}</td>
        <td><span class="badge ${s.method === 'cash' ? 'b-ok' : 'b-info'}">${s.method === 'cash' ? 'نقدي' : 'كارت'}</span></td>
        <td class="num"><b>${money(s.total)}</b></td>
        <td><button class="btn btn-ghost btn-sm" data-print="${esc(s.id)}">إيصال</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">مفيش فواتير لسه</td></tr>';
    $$('#rows [data-print]').forEach((b) => (b.onclick = () => {
      const s = doc.sales.find((x) => x.id === b.dataset.print);
      if (s) printReceipt(s);
    }));
  }

  /* ---------------- الوردية ---------------- */
  function renderShift() {
    const sh = openShift();
    $('#title').textContent = 'الوردية والدرج';
    $('#sub').textContent = sh ? `مفتوحة من ${hm(sh.openedAt)}` : 'مفيش وردية مفتوحة';
    const closed = doc.shifts.filter((s) => s.closedAt).slice(-6).reverse();
    $('#content').innerHTML = `
      <div class="card pad">
        ${sh ? `
          <div class="kpis mb">
            <div class="kpi"><div class="lbl">درج البداية</div><div class="val">${money(sh.openingCash)}</div></div>
            <div class="kpi"><div class="lbl">مبيعات نقدية</div><div class="val">${money(cashSales(sh))}</div></div>
            <div class="kpi"><div class="lbl">المتوقع في الدرج</div><div class="val">${money(sh.openingCash + cashSales(sh))}</div></div>
          </div>
          <div class="field" style="max-width:280px"><label class="label">المعدود فعلياً في الدرج</label>
            <input class="input mono" id="counted" inputmode="decimal" placeholder="0" /></div>
          <button class="btn btn-primary" id="closeShift">إغلاق الوردية وحساب الفرق</button>`
          : `
          <div class="field" style="max-width:280px"><label class="label">درج البداية (النقد الموجود)</label>
            <input class="input mono" id="opening" inputmode="decimal" value="500" /></div>
          <button class="btn btn-primary" id="openShift">افتح وردية</button>`}
      </div>
      <div class="card">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>الفتح</th><th>الإغلاق</th><th>بداية</th><th>متوقع</th><th>معدود</th><th>الفرق</th></tr></thead>
          <tbody>${closed.length ? closed.map((s) => `
            <tr><td class="small">${dmy(s.openedAt)} ${hm(s.openedAt)}</td>
            <td class="small">${hm(s.closedAt)}</td>
            <td class="num">${money(s.openingCash)}</td>
            <td class="num">${money(s.expected)}</td>
            <td class="num">${money(s.counted)}</td>
            <td class="num"><span class="badge ${Math.abs(s.difference) < 0.01 ? 'b-ok' : 'b-bad'}">${money(s.difference)}</span></td></tr>`).join('')
            : '<tr><td colspan="6" class="empty">مفيش ورديات مقفولة</td></tr>'}</tbody></table></div>
      </div>`;
    if ($('#openShift')) $('#openShift').onclick = () => {
      const cash = Number($('#opening').value);
      if (!(cash >= 0)) return toast('اكتب مبلغ صحيح', 'bad');
      doc.shifts.push({ id: uid(), openedAt: new Date().toISOString(), closingCash: cash, openingCash: cash, closedAt: null });
      queue(SLUG, doc, 'shift.open', { cash });
      save(SLUG, doc);
      toast('الوردية اتفتحت', 'ok');
      repaint(); render();
    };
    if ($('#closeShift')) $('#closeShift').onclick = () => {
      const counted = Number($('#counted').value);
      if ($('#counted').value === '' || !(counted >= 0)) return toast('اكتب المبلغ المعدود', 'bad');
      const expected = Math.round((sh.openingCash + cashSales(sh)) * 100) / 100;
      sh.expected = expected;
      sh.counted = counted;
      sh.difference = Math.round((counted - expected) * 100) / 100;
      sh.closedAt = new Date().toISOString();
      queue(SLUG, doc, 'shift.close', { expected, counted, difference: sh.difference }, expected);
      save(SLUG, doc);
      toast(`الوردية اتقفلت — الفرق ${money(sh.difference)}`, Math.abs(sh.difference) < 0.01 ? 'ok' : 'bad');
      repaint(); render();
    };
  }

  /* ---------------- المزامنة ---------------- */
  function renderSync() {
    $('#title').textContent = 'المزامنة';
    $('#sub').textContent = 'كل عملية تُحفظ محلياً أولاً، والمزامنة لا تصنع حركة مكررة';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="syncNow">زامن الآن</button>';
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="kpi card pad"><div class="lbl">في الانتظار</div><div class="val">${num(doc.pending.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">آخر مزامنة</div><div class="val" style="font-size:18px">${doc.lastSync ? hm(doc.lastSync) : '—'}</div></div>
        <div class="kpi card pad"><div class="lbl">رقم الجهاز</div><div class="val" style="font-size:16px">${esc(doc.device)}</div></div>
      </div>
      <div class="card">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>النوع</th><th>الوقت</th><th>المبلغ</th><th>المفتاح</th></tr></thead>
          <tbody>${doc.pending.length ? doc.pending.slice(-40).reverse().map((o) => `
            <tr><td class="small">${esc(o.type)}</td><td class="small">${dmy(o.at)} ${hm(o.at)}</td>
            <td class="num">${money(o.amount)}</td><td class="mono small">${esc(o.key)}</td></tr>`).join('')
            : '<tr><td colspan="4" class="empty">كل حاجة متزامنة</td></tr>'}</tbody></table></div>
      </div>
      <div class="card pad">
        <b>إعادة ضبط بيانات العرض</b>
        <div class="small muted mt">يمسح فواتير هذا الجهاز ويعيد الأصناف الأولية — للتجربة فقط.</div>
        <button class="btn btn-danger btn-sm mt" id="resetApp">إعادة ضبط الجهاز</button>
      </div>`;
    $('#syncNow').onclick = () => doSync().catch(() => {});
    $('#resetApp').onclick = () => {
      doc = D.reset(SLUG, seed); cart = []; repaint = D.status($('#statusBar'), SLUG, doc, doSync);
      toast('الجهاز اترجع للبيانات الأولية', 'ok'); render();
    };
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2' && view === 'sell') { e.preventDefault(); if (cart.length) payModal(); }
  });

  // مزامنة تلقائية عند رجوع الشبكة
  window.addEventListener('online', () => doSync().catch(() => {}));

  boot();
})();
