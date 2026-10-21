/* ===== نيل مخازن (ويندوز) =====
 *
 * جرد واستلام وملصقات — يعمل بلا إنترنت على جهاز المخزن، ويزامن الحركات.
 *
 * القواعد: الرصيد لا يصير سالباً · أي جرد بفرق لازم يكون له سبب مكتوب ·
 * ملصق الباركود Code39 حقيقي (لا رسم عشوائي) · كل حركة تُسجَّل بمفتاح فريد.
 */
(function () {
  'use strict';
  const D = window.Desk;
  const { $, $$, esc, money, num, uid, dmy, hm, load, save, queue, sync, toast, modal, closeModal, printHtml, code39 } = D;
  const SLUG = 'stock';

  const seed = () => ({
    items: [
      { id: 'i1', code: 'SKU-1001', name: 'لبن جهينة 1 لتر', unit: 'علبة', qty: 40, cost: 32, price: 38, min: 12 },
      { id: 'i2', code: 'SKU-1002', name: 'زيت عافية 1 لتر', unit: 'زجاجة', qty: 25, cost: 80, price: 92, min: 8 },
      { id: 'i3', code: 'SKU-1003', name: 'شاي العروسة 250 جم', unit: 'علبة', qty: 30, cost: 45, price: 55, min: 10 },
      { id: 'i4', code: 'SKU-1004', name: 'سكر ناعم كيلو', unit: 'كيس', qty: 50, cost: 27, price: 32, min: 15 },
      { id: 'i5', code: 'SKU-1005', name: 'أرز مصري كيلو', unit: 'كيس', qty: 48, cost: 29, price: 36, min: 15 },
      { id: 'i6', code: 'SKU-1006', name: 'مسحوق غسيل 2 كجم', unit: 'كرتونة', qty: 6, cost: 140, price: 165, min: 10 },
    ],
    moves: [],
    counts: [],
  });

  let doc = load(SLUG, seed);
  let view = 'items';
  let repaint = () => {};
  let countDraft = [];
  let receiveDraft = [];
  let draftSupplier = '';

  function boot() {
    $$('.desk-nav[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; render(); }; });
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
    if (view === 'items') return renderItems();
    if (view === 'count') return renderCount();
    if (view === 'receive') return renderReceive();
    if (view === 'moves') return renderMoves();
    return renderSync();
  }

  const lowStock = () => doc.items.filter((i) => i.qty <= i.min);

  /* ---------------- الأصناف ---------------- */
  function renderItems() {
    $('#title').textContent = 'الأصناف';
    const value = doc.items.reduce((a, i) => a + i.qty * i.cost, 0);
    $('#sub').innerHTML = `${num(doc.items.length)} صنف · قيمة المخزون ${money(value)} · ${num(lowStock().length)} تحت الحد`;
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="newItem">+ صنف جديد</button>';
    $('#content').innerHTML = `
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الكود</th><th>الصنف</th><th>الرصيد</th><th>الحد</th><th>التكلفة</th><th>البيع</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>`;
    $('#rows').innerHTML = doc.items.length ? doc.items.map((i) => `
      <tr>
        <td class="mono small">${esc(i.code)}</td>
        <td><b>${esc(i.name)}</b><div class="small muted">${esc(i.unit)}</div></td>
        <td class="num"><span class="badge ${i.qty <= i.min ? 'b-bad' : 'b-ok'}">${num(i.qty)}</span></td>
        <td class="num small muted">${num(i.min)}</td>
        <td class="num">${money(i.cost)}</td>
        <td class="num">${money(i.price)}</td>
        <td><button class="btn btn-ghost btn-sm" data-label="${esc(i.id)}">ملصق 🏷️</button></td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty">مفيش أصناف</td></tr>';
    $$('#rows [data-label]').forEach((b) => (b.onclick = () => printLabel(doc.items.find((x) => x.id === b.dataset.label))));
    $('#newItem').onclick = newItemModal;
  }

  function newItemModal() {
    modal({
      title: 'صنف جديد',
      body: `
        <div class="field"><label class="label">الاسم</label><input class="input" id="niName" /></div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">الكود (باركود)</label><input class="input mono" id="niCode" value="SKU-${String(Date.now()).slice(-6)}" /></div>
          <div class="field" style="flex:1"><label class="label">الوحدة</label><input class="input" id="niUnit" value="علبة" /></div>
        </div>
        <div class="row" style="gap:8px">
          <div class="field" style="flex:1"><label class="label">التكلفة</label><input class="input mono" id="niCost" inputmode="decimal" value="0" /></div>
          <div class="field" style="flex:1"><label class="label">سعر البيع</label><input class="input mono" id="niPrice" inputmode="decimal" value="0" /></div>
          <div class="field" style="flex:1"><label class="label">حد التنبيه</label><input class="input mono" id="niMin" inputmode="decimal" value="5" /></div>
        </div>`,
      footer: '<button class="btn btn-ghost" id="niCancel">إلغاء</button><button class="btn btn-primary" id="niSave">حفظ</button>',
    });
    $('#niCancel').onclick = closeModal;
    $('#niSave').onclick = () => {
      const name = $('#niName').value.trim();
      const code = $('#niCode').value.trim().toUpperCase();
      if (!name) return toast('الاسم مطلوب', 'bad');
      if (!code) return toast('الكود مطلوب للملصق', 'bad');
      if (doc.items.some((i) => i.code === code)) return toast('الكود مستخدم بالفعل', 'bad');
      doc.items.push({
        id: uid(), code, name, unit: $('#niUnit').value.trim() || 'وحدة',
        qty: 0, cost: Number($('#niCost').value) || 0, price: Number($('#niPrice').value) || 0,
        min: Number($('#niMin').value) || 0,
      });
      queue(SLUG, doc, 'item.new', { code, name });
      save(SLUG, doc);
      closeModal(); toast('الصنف اتضاف', 'ok'); repaint(); render();
    };
  }

  function printLabel(item) {
    if (!item) return;
    const html = `
      <div class="center" style="padding:6px 0">
        <div style="font-weight:800;font-size:13px">${esc(item.name)}</div>
        <div style="margin:4px 0">${code39(item.code, { height: 34, unit: 1.25 })}</div>
        <div style="font-size:12px">${money(item.price)} · ${esc(item.unit)}</div>
      </div>`;
    printHtml(html, { width: '50mm' });
    queue(SLUG, doc, 'label.print', { code: item.code });
    save(SLUG, doc); repaint();
  }

  /* ---------------- الجرد ---------------- */
  function renderCount() {
    $('#title').textContent = 'الجرد';
    $('#sub').textContent = 'عدّ فعلي — أي فرق لازم يتكتب سببه قبل الحفظ';
    const draftByItem = new Map(countDraft.map((r) => [r.itemId, r]));
    $('#content').innerHTML = `
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الصنف</th><th>الرصيد الدفتري</th><th>المعدود</th><th>الفرق</th><th>السبب</th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>
      <div class="row between wrapw">
        <span class="small muted" id="countHint">اكتب الكمية المعدودة لكل صنف عدّيته</span>
        <div class="row" style="gap:8px">
          <button class="btn btn-ghost" id="clearCount">تفريغ</button>
          <button class="btn btn-primary" id="saveCount">حفظ الجرد</button>
        </div>
      </div>`;
    $('#rows').innerHTML = doc.items.map((i) => {
      const r = draftByItem.get(i.id);
      const counted = r && r.counted !== '' ? Number(r.counted) : null;
      const diff = counted === null ? null : counted - i.qty;
      return `<tr>
        <td><b>${esc(i.name)}</b><div class="small muted mono">${esc(i.code)}</div></td>
        <td class="num">${num(i.qty)}</td>
        <td><input class="input mono" data-count="${esc(i.id)}" inputmode="numeric" value="${r ? esc(r.counted) : ''}" style="max-width:110px" /></td>
        <td class="num">${diff === null ? '—' : `<span class="badge ${diff === 0 ? 'b-mute' : diff > 0 ? 'b-info' : 'b-bad'}">${diff > 0 ? '+' : ''}${num(diff)}</span>`}</td>
        <td><input class="input" data-reason="${esc(i.id)}" value="${r ? esc(r.reason || '') : ''}" placeholder="${diff ? 'مطلوب' : '—'}" style="max-width:220px" ${diff ? '' : 'disabled'} /></td>
      </tr>`;
    }).join('');
    $$('#rows [data-count]').forEach((inp) => (inp.oninput = (e) => {
      const id = inp.dataset.count;
      const row = countDraft.find((r) => r.itemId === id) || { itemId: id, counted: '', reason: '' };
      row.counted = e.target.value.replace(/[^\d]/g, '');
      if (!countDraft.includes(row)) countDraft.push(row);
      const item = doc.items.find((x) => x.id === id);
      const diff = row.counted === '' ? null : Number(row.counted) - item.qty;
      const reason = document.querySelector(`[data-reason="${id}"]`);
      if (reason) { reason.disabled = !diff; if (!diff) reason.value = ''; }
      // نحدّث خانة الفرق فقط بلا إعادة رسم كاملة (حتى لا يفقد المؤشر مكانه)
      const cell = inp.closest('tr').children[3];
      cell.innerHTML = diff === null ? '—' : `<span class="badge ${diff === 0 ? 'b-mute' : diff > 0 ? 'b-info' : 'b-bad'}">${diff > 0 ? '+' : ''}${num(diff)}</span>`;
      updateCountHint();
    }));
    $$('#rows [data-reason]').forEach((inp) => (inp.oninput = (e) => {
      const row = countDraft.find((r) => r.itemId === inp.dataset.reason);
      if (row) row.reason = e.target.value;
    }));
    $('#clearCount').onclick = () => { countDraft = []; render(); };
    $('#saveCount').onclick = saveCount;
    updateCountHint();
  }

  function updateCountHint() {
    const rows = countDraft.filter((r) => r.counted !== '');
    const diffs = rows.filter((r) => Number(r.counted) !== (doc.items.find((i) => i.id === r.itemId) || {}).qty);
    const missing = diffs.filter((r) => !String(r.reason || '').trim()).length;
    const hint = $('#countHint');
    if (!hint) return;
    hint.innerHTML = `${num(rows.length)} صنف معدود · ${num(diffs.length)} بفرق${missing ? ` · <b style="color:var(--bad)">${num(missing)} بلا سبب</b>` : ''}`;
  }

  function saveCount() {
    const rows = countDraft.filter((r) => r.counted !== '' && r.counted !== undefined);
    if (!rows.length) return toast('عدّ صنف واحد على الأقل', 'bad');
    const diffs = rows.filter((r) => Number(r.counted) !== doc.items.find((i) => i.id === r.itemId).qty);
    const noReason = diffs.filter((r) => !String(r.reason || '').trim());
    if (noReason.length) return toast(`فيه ${num(noReason.length)} فرق بلا سبب — اكتب السبب`, 'bad');
    const count = { id: uid(), at: new Date().toISOString(), rows: [] };
    for (const r of rows) {
      const item = doc.items.find((i) => i.id === r.itemId);
      const diff = Number(r.counted) - item.qty;
      count.rows.push({ itemId: item.id, code: item.code, book: item.qty, counted: Number(r.counted), diff, reason: r.reason || '' });
      if (diff !== 0) {
        item.qty = Number(r.counted);
        doc.moves.push({
          id: uid(), at: new Date().toISOString(), type: 'count', itemId: item.id, code: item.code,
          qty: diff, reason: r.reason || 'جرد', ref: count.id,
        });
      }
    }
    doc.counts.push(count);
    queue(SLUG, doc, 'count', { rows: count.rows.length, diffs: count.rows.filter((x) => x.diff !== 0).length });
    save(SLUG, doc);
    countDraft = [];
    toast('الجرد اتحفظ واتسجلت فروقه', 'ok');
    repaint(); render();
  }

  /* ---------------- الاستلام ---------------- */
  function renderReceive() {
    $('#title').textContent = 'استلام بضاعة';
    $('#sub').textContent = 'استلام من مورد: الكمية تدخل الرصيد وحركة مسجّلة';
    $('#content').innerHTML = `
      <div class="card pad">
        <div class="row between wrapw mb">
          <div class="field" style="flex:1;min-width:220px;margin:0"><label class="label">المورد / رقم الإذن</label>
            <input class="input" id="supplier" placeholder="مورد الألبان — إذن 4412" value="${esc(draftSupplier)}" /></div>
          <div class="row" style="gap:8px;align-items:flex-end">
            <select class="input" id="recItem" style="min-width:220px">
              ${doc.items.map((i) => `<option value="${esc(i.id)}">${esc(i.name)} — ${esc(i.code)}</option>`).join('')}
            </select>
            <input class="input mono" id="recQty" inputmode="numeric" placeholder="كمية" style="max-width:110px" />
            <button class="btn btn-primary" id="addLine">أضف</button>
          </div>
        </div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>الصنف</th><th>الكمية</th><th></th></tr></thead>
          <tbody id="lines"></tbody></table></div>
        <div class="row between mt">
          <span class="small muted" id="recHint">مفيش سطور</span>
          <button class="btn btn-primary" id="saveReceive">حفظ الاستلام</button>
        </div>
      </div>`;
    const paint = () => {
      $('#lines').innerHTML = receiveDraft.length ? receiveDraft.map((l, idx) => {
        const item = doc.items.find((i) => i.id === l.itemId);
        return `<tr><td>${esc(item ? item.name : '—')}<div class="small muted mono">${esc(item ? item.code : '')}</div></td>
          <td class="num">${num(l.qty)}</td>
          <td><button class="btn btn-ghost btn-sm" data-del="${idx}">حذف</button></td></tr>`;
      }).join('') : '<tr><td colspan="3" class="empty">أضف أصنافاً مستلمة</td></tr>';
      $$('#lines [data-del]').forEach((b) => (b.onclick = () => { receiveDraft.splice(Number(b.dataset.del), 1); paint(); }));
      $('#recHint').textContent = receiveDraft.length
        ? `${num(receiveDraft.length)} سطر · ${num(receiveDraft.reduce((a, l) => a + l.qty, 0))} وحدة`
        : 'مفيش سطور';
    };
    paint();
    $('#addLine').onclick = () => {
      const qty = Number($('#recQty').value);
      if (!(qty > 0)) return toast('الكمية لازم تكون أكبر من صفر', 'bad');
      const line = receiveDraft.find((l) => l.itemId === $('#recItem').value);
      if (line) line.qty += qty; else receiveDraft.push({ itemId: $('#recItem').value, qty });
      $('#recQty').value = '';
      paint();
    };
    $('#saveReceive').onclick = () => {
      if (!receiveDraft.length) return toast('مفيش سطور للاستلام', 'bad');
      const supplier = $('#supplier').value.trim() || 'استلام بلا إذن';
      const rec = { id: uid(), at: new Date().toISOString(), supplier, lines: [] };
      for (const l of receiveDraft) {
        const item = doc.items.find((i) => i.id === l.itemId);
        item.qty += l.qty;
        rec.lines.push({ itemId: item.id, code: item.code, qty: l.qty });
        doc.moves.push({ id: uid(), at: new Date().toISOString(), type: 'in', itemId: item.id, code: item.code, qty: l.qty, reason: supplier, ref: rec.id });
      }
      doc.receipts = doc.receipts || [];
      doc.receipts.push(rec);
      queue(SLUG, doc, 'receive', { supplier, lines: rec.lines.length });
      save(SLUG, doc);
      receiveDraft = []; draftSupplier = '';
      toast('الاستلام دخل الرصيد', 'ok');
      repaint(); render();
    };
  }

  /* ---------------- الحركات ---------------- */
  function renderMoves() {
    $('#title').textContent = 'حركات المخزن';
    $('#sub').textContent = 'كل تعديل رصيد له حركة وسبب ومفتاح';
    const TYPE = { count: 'جرد', in: 'استلام', out: 'صرف', adjust: 'تسوية' };
    $('#content').innerHTML = `
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>الوقت</th><th>النوع</th><th>الصنف</th><th>الكمية</th><th>السبب</th></tr></thead>
        <tbody>${doc.moves.length ? doc.moves.slice().reverse().map((m) => `
          <tr><td class="small">${dmy(m.at)} ${hm(m.at)}</td>
          <td><span class="badge ${m.qty > 0 ? 'b-ok' : 'b-bad'}">${esc(TYPE[m.type] || m.type)}</span></td>
          <td class="small">${esc(m.code)}</td>
          <td class="num">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
          <td class="small">${esc(m.reason || '—')}</td></tr>`).join('')
          : '<tr><td colspan="5" class="empty">مفيش حركات لسه</td></tr>'}</tbody></table></div></div>`;
  }

  /* ---------------- المزامنة ---------------- */
  function renderSync() {
    $('#title').textContent = 'المزامنة';
    $('#sub').textContent = 'الجهاز يشتغل بلا شبكة، والحركات تُرسل عند الرجوع بلا تكرار';
    $('#topActions').innerHTML = '<button class="btn btn-primary" id="syncNow">زامن الآن</button>';
    $('#content').innerHTML = `
      <div class="kpis">
        <div class="kpi card pad"><div class="lbl">في الانتظار</div><div class="val">${num(doc.pending.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">حركات مسجّلة</div><div class="val">${num(doc.moves.length)}</div></div>
        <div class="kpi card pad"><div class="lbl">آخر مزامنة</div><div class="val" style="font-size:18px">${doc.lastSync ? hm(doc.lastSync) : '—'}</div></div>
      </div>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>النوع</th><th>الوقت</th><th>المفتاح</th></tr></thead>
        <tbody>${doc.pending.length ? doc.pending.slice(-30).reverse().map((o) => `
          <tr><td class="small">${esc(o.type)}</td><td class="small">${dmy(o.at)} ${hm(o.at)}</td><td class="mono small">${esc(o.key)}</td></tr>`).join('')
          : '<tr><td colspan="3" class="empty">كل حاجة متزامنة</td></tr>'}</tbody></table></div></div>
      <div class="card pad"><b>إعادة ضبط بيانات العرض</b>
        <div class="small muted mt">يرجع الأصناف لأرصدة البداية — للتجربة فقط.</div>
        <button class="btn btn-danger btn-sm mt" id="resetApp">إعادة ضبط الجهاز</button></div>`;
    $('#syncNow').onclick = () => doSync().catch(() => {});
    $('#resetApp').onclick = () => {
      doc = D.reset(SLUG, seed); countDraft = []; receiveDraft = [];
      repaint = D.status($('#statusBar'), SLUG, doc, doSync);
      toast('الجهاز اترجع للبيانات الأولية', 'ok'); render();
    };
  }

  window.addEventListener('online', () => doSync().catch(() => {}));
  boot();
})();
