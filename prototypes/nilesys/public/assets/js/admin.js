/* ===== Nile Systems — شاشات الإدارة (الضريبة، العملاء، الموردون، الأكواد، الدرج، المخزون، المستخدمون، النسخ) =====
 *
 * لماذا ملف منفصل: pos.js مسؤول عن البيع — وهو أطول جزء في النظام وأكثره
 * خطراً. إدارة المتجر شيء آخر: تُقرأ وتُعدَّل مرة في اليوم، لا مرة في الدقيقة.
 * خلطهما كان يجعل أي تعديل في شاشة إعدادات يهدد شاشة البيع.
 *
 * العقد مع pos.js: هو يعطينا المستخدم الحالي ودوال تحديث المنتجات، ونحن
 * نعطيه كائن الشاشات ليرسمها في #content.
 */
(function () {
  'use strict';
  const NS = window.NS;
  const { $, $$, t, api, toast, openModal, closeModal, money, num, dmy, hm, esc, getLang } = NS;

  // نصوص الشاشات — عربي أولاً، وإنجليزي عند التبديل (نفس سلوك بقية النظام).
  const L = {
    settings: ['الإعدادات', 'Settings'],
    customers: ['العملاء والآجل', 'Customers & credit'],
    suppliers: ['الموردون والمشتريات', 'Suppliers & purchases'],
    coupons: ['أكواد الخصم', 'Coupons'],
    cash: ['حركة الدرج', 'Cash drawer'],
    stock: ['المخزون', 'Stock'],
    users: ['المستخدمون', 'Users'],
    backup: ['النسخ الاحتياطي', 'Backup'],
    alerts: ['التنبيهات', 'Alerts'],
    taxIdentity: ['البيانات الضريبية', 'Tax identity'],
    storeIdentity: ['بيانات المتجر', 'Store identity'],
    taxRate: ['نسبة الضريبة %', 'Tax rate %'],
    taxNumber: ['الرقم الضريبي', 'Tax number'],
    legalName: ['الاسم القانوني', 'Legal name'],
    cr: ['السجل التجاري', 'Commercial register'],
    address: ['العنوان', 'Address'],
    invoicePrefix: ['بادئة الفاتورة', 'Invoice prefix'],
    lowStock: ['حد إعادة الطلب الافتراضي', 'Default reorder level'],
    drawerAlert: ['فرق الدرج المسموح', 'Drawer difference allowed'],
    loyalty: ['قيمة الوحدة في نقاط الولاء', 'Value of one loyalty unit'],
    refundRatio: ['نسبة المرتجعات المقلقة %', 'Refund ratio alert %'],
    save: ['حفظ', 'Save'],
    saved: ['تم الحفظ', 'Saved'],
    addCustomer: ['عميل جديد', 'New customer'],
    name: ['الاسم', 'Name'],
    phone: ['الموبايل', 'Phone'],
    limit: ['حد الآجل', 'Credit limit'],
    balance: ['المستحق', 'Balance'],
    points: ['النقاط', 'Points'],
    pay: ['سداد', 'Take payment'],
    statement: ['كشف الحساب', 'Statement'],
    amount: ['المبلغ', 'Amount'],
    method: ['طريقة الدفع', 'Method'],
    noCustomers: ['مفيش عملاء لسه', 'No customers yet'],
    addSupplier: ['مورد جديد', 'New supplier'],
    newPurchase: ['توريد جديد', 'New purchase'],
    supplier: ['المورد', 'Supplier'],
    qty: ['الكمية', 'Qty'],
    unitCost: ['سعر الشراء', 'Unit cost'],
    line: ['أصناف التوريد', 'Purchase lines'],
    addLine: ['+ سطر', 'Add line'],
    paidNow: ['مدفوع الآن', 'Paid now'],
    total: ['الإجمالي', 'Total'],
    due: ['مستحق للمورد', 'Due to supplier'],
    addCoupon: ['كود جديد', 'New coupon'],
    code: ['الكود', 'Code'],
    type: ['النوع', 'Type'],
    percent: ['نسبة %', 'Percent'],
    fixed: ['مبلغ ثابت', 'Fixed amount'],
    value: ['القيمة', 'Value'],
    minSubtotal: ['أقل فاتورة', 'Minimum subtotal'],
    expires: ['ينتهي', 'Expires'],
    active: ['ساري', 'Active'],
    stopped: ['موقوف', 'Stopped'],
    uses: ['الاستخدام', 'Used'],
    disable: ['إيقاف', 'Disable'],
    in: ['إيداع', 'Cash in'],
    out: ['سحب', 'Cash out'],
    reason: ['السبب', 'Reason'],
    status: ['الحالة', 'Status'],
    pending: ['بانتظار الاعتماد', 'Pending'],
    approved: ['معتمد', 'Approved'],
    approve: ['اعتماد', 'Approve'],
    newMovement: ['حركة جديدة', 'New movement'],
    adjust: ['تسوية', 'Adjust'],
    adjustTitle: ['تسوية مخزون', 'Stock adjustment'],
    reorder: ['حد الطلب', 'Reorder level'],
    movements: ['حركات المخزون', 'Stock movements'],
    lowNow: ['أصناف تحت حد الطلب', 'Below reorder level'],
    onHand: ['المتاح', 'On hand'],
    addUser: ['مستخدم جديد', 'New user'],
    username: ['اسم الدخول', 'Username'],
    password: ['كلمة المرور', 'Password'],
    role: ['الصلاحية', 'Role'],
    manager: ['مدير', 'Manager'],
    cashier: ['كاشير', 'Cashier'],
    enable: ['تفعيل', 'Enable'],
    exportCsv: ['تصدير CSV', 'Export CSV'],
    download: ['تحميل نسخة', 'Download backup'],
    restore: ['استعادة نسخة', 'Restore backup'],
    restoreWarn: ['الاستعادة تستبدل كل بيانات المتجر. اكتب RESTORE للتأكيد.', 'Restore replaces all store data. Type RESTORE to confirm.'],
    print: ['طباعة', 'Print'],
    seen: ['تم', 'Dismiss'],
    noAlerts: ['مفيش تنبيهات — كل حاجة تحت السيطرة', 'No alerts — everything is under control'],
    credit: ['آجل', 'Credit'],
    statementOf: ['كشف حساب', 'Statement of'],
    close: ['إغلاق', 'Close'],
    systems: ['الأنظمة', 'Systems'],
    live: ['يعمل', 'Live'],
    partial: ['جزئي', 'Partial'],
    planned: ['مخطط', 'Planned'],
  };
  const l = (k) => L[k][getLang() === 'ar' ? 0 : 1];
  const ar = () => getLang() === 'ar';

  const ctx = { user: null, onProductsChanged: null };
  const isManager = () => ctx.user && ctx.user.role === 'manager';

  function attach(o) {
    Object.assign(ctx, o);
  }

  /* ---------- أدوات رسم مشتركة ---------- */
  const page = (title, sub, actions = '') => `
    <div class="row between mb-2" style="flex-wrap:wrap;gap:10px">
      <div><div class="view-title">${esc(title)}</div><div class="view-sub small muted">${sub}</div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">${actions}</div>
    </div>`;

  const table = (heads, bodyId) => `<div class="card"><div class="tbl-wrap"><table class="tbl">
    <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody id="${bodyId}"></tbody></table></div></div>`;

  const empty = (n, text) => `<tr><td colspan="${n}" class="center muted">${esc(text)}</td></tr>`;

  const modalFooter = (okId, okLabel, cls = 'btn-primary') => `
    <button class="btn btn-ghost" id="mCancel">${ar() ? 'إلغاء' : 'Cancel'}</button>
    <button class="btn ${cls}" id="${okId}">${okLabel}</button>`;

  function wireCancel() { const b = $('#mCancel'); if (b) b.onclick = closeModal; }

  /* ================= الإعدادات والهوية الضريبية — F-01 ================= */
  async function renderSettings() {
    if (!isManager()) return toast(ar() ? 'للمدير بس' : 'Managers only', 'bad');
    const { settings: s } = await api('/api/settings');
    $('#content').innerHTML = `
      ${page(l('settings'), ar() ? 'الضريبة والهوية اللي تطلع في الفاتورة المطبوعة' : 'Tax and the identity printed on every invoice')}
      <div class="grid g-2">
        <div class="card card-pad">
          <h3 class="mb-2">${l('taxIdentity')}</h3>
          <div class="field"><label class="label">${l('taxRate')}</label>
            <input class="input mono" id="sTax" type="number" min="0" max="100" value="${s.taxRate ?? 0}" /></div>
          <div class="small muted mb-2">${ar() ? 'تُضاف على كل سطر غير معفى، وتظهر في الفاتورة كسطر منفصل.' : 'Applied to every non-exempt line and printed as its own line.'}</div>
          <div class="field"><label class="label">${l('taxNumber')}</label><input class="input mono" id="sTaxNo" value="${esc(s.taxNumber || '')}" /></div>
          <div class="field"><label class="label">${l('legalName')}</label><input class="input" id="sLegal" value="${esc(s.legalName || '')}" /></div>
          <div class="field"><label class="label">${l('cr')}</label><input class="input mono" id="sCR" value="${esc(s.commercialRegister || '')}" /></div>
          <div class="field"><label class="label">${l('address')}</label><input class="input" id="sAddr" value="${esc(s.address || '')}" /></div>
          <div class="field"><label class="label">${l('invoicePrefix')}</label><input class="input mono" id="sPrefix" value="${esc(s.invoicePrefix || 'INV')}" /></div>
        </div>
        <div class="card card-pad">
          <h3 class="mb-2">${ar() ? 'حدود التنبيه' : 'Alert thresholds'}</h3>
          <div class="field"><label class="label">${l('lowStock')}</label><input class="input mono" id="sLow" type="number" min="0" value="${s.lowStockDefault ?? 5}" /></div>
          <div class="field"><label class="label">${l('drawerAlert')}</label><input class="input mono" id="sDrawer" type="number" min="0" value="${s.drawerDiffAlert ?? 20}" /></div>
          <div class="field"><label class="label">${l('refundRatio')}</label><input class="input mono" id="sRefund" type="number" min="0" max="100" value="${s.refundsAlertRatio ?? 15}" /></div>
          <div class="field"><label class="label">${l('loyalty')}</label><input class="input mono" id="sLoyalty" type="number" min="1" value="${s.loyaltyPerUnit ?? 100}" /></div>
          <div class="small muted">${ar() ? 'نقطة واحدة لكل مبلغ يساوي هذه القيمة من صافي الفاتورة.' : 'One point per this amount of net sale.'}</div>
          <button class="btn btn-primary mt-3" id="sSave">${l('save')}</button>
        </div>
      </div>`;
    $('#sSave').onclick = async () => {
      try {
        await api('/api/settings', {
          method: 'PUT',
          body: {
            taxRate: Number($('#sTax').value) || 0,
            taxNumber: $('#sTaxNo').value.trim(),
            legalName: $('#sLegal').value.trim(),
            commercialRegister: $('#sCR').value.trim(),
            address: $('#sAddr').value.trim(),
            invoicePrefix: $('#sPrefix').value.trim() || 'INV',
            lowStockDefault: Number($('#sLow').value) || 0,
            drawerDiffAlert: Number($('#sDrawer').value) || 0,
            refundsAlertRatio: Number($('#sRefund').value) || 0,
            loyaltyPerUnit: Number($('#sLoyalty').value) || 100,
          },
        });
        toast(l('saved'), 'ok');
        renderSettings();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= العملاء والآجل — F-07 ================= */
  async function renderCustomers() {
    const { customers } = await api('/api/customers');
    const due = customers.reduce((a, c) => a + (c.balance || 0), 0);
    $('#content').innerHTML = `
      ${page(l('customers'),
        `${customers.length} ${ar() ? 'عميل' : 'customers'} · ${ar() ? 'إجمالي المستحق' : 'total due'} <b class="mono">${money(due)}</b>`,
        `<button class="btn btn-primary btn-sm" id="addC">+ ${l('addCustomer')}</button>`)}
      ${table([l('name'), l('phone'), l('limit'), l('balance'), l('points'), ''], 'rows')}`;
    $('#rows').innerHTML = customers.length ? customers.map((c) => `
      <tr>
        <td><b>${esc(c.name)}</b></td>
        <td class="mono small">${esc(c.phone)}</td>
        <td class="mono">${money(c.creditLimit || 0)}</td>
        <td class="mono"><span class="badge ${(c.balance || 0) > 0 ? ((c.balance > c.creditLimit) ? 'badge-bad' : 'badge-warn') : 'badge-ok'}">${money(c.balance || 0)}</span></td>
        <td class="mono">${num(c.points || 0)}</td>
        <td class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-st="${c.id}">${l('statement')}</button>
          ${isManager() ? `<button class="btn btn-ghost btn-sm" data-pay="${c.id}" ${(c.balance || 0) > 0 ? '' : 'disabled'}>${l('pay')}</button>` : ''}
        </td>
      </tr>`).join('') : empty(6, l('noCustomers'));

    $('#addC').onclick = () => {
      openModal({
        title: l('addCustomer'),
        body: `<div class="field"><label class="label">${l('name')}</label><input class="input" id="cName" /></div>
          <div class="field"><label class="label">${l('phone')}</label><input class="input mono" id="cPhone" inputmode="tel" /></div>
          <div class="field"><label class="label">${l('limit')}</label><input class="input mono" id="cLimit" type="number" min="0" value="0" /></div>
          <div class="small muted">${ar() ? 'صفر يعني بيع نقدي فقط — لا آجل.' : 'Zero means cash only, no credit.'}</div>`,
        footer: modalFooter('cSave', l('save')),
      });
      wireCancel();
      $('#cSave').onclick = async () => {
        try {
          await api('/api/customers', {
            method: 'POST',
            body: { name: $('#cName').value.trim(), phone: $('#cPhone').value.trim(), creditLimit: Number($('#cLimit').value) || 0 },
          });
          closeModal(); toast(l('saved'), 'ok'); renderCustomers();
        } catch (err) { toast(err.message, 'bad'); }
      };
    };

    $$('#rows [data-st]').forEach((b) => (b.onclick = () => statement(b.dataset.st)));
    $$('#rows [data-pay]').forEach((b) => (b.onclick = () => payModal(customers.find((c) => c.id === b.dataset.pay))));
  }

  async function payModal(c) {
    openModal({
      title: `${l('pay')} — ${esc(c.name)}`,
      body: `<div class="small muted mb-2">${l('balance')}: <b class="mono">${money(c.balance)}</b></div>
        <div class="field"><label class="label">${l('amount')}</label><input class="input input-lg mono" id="payAmt" type="number" min="1" max="${c.balance}" value="${c.balance}" /></div>
        <div class="field"><label class="label">${l('method')}</label>
          <select class="input" id="payMethod"><option value="cash">💵 ${ar() ? 'كاش' : 'Cash'}</option><option value="transfer">🏦 ${ar() ? 'تحويل' : 'Transfer'}</option></select></div>
        <div class="small muted">${ar() ? 'السداد النقدي يدخل الدرج مباشرة وتحتسب في المتوقع.' : 'Cash payments enter the drawer and count toward expected cash.'}</div>`,
      footer: modalFooter('payOk', l('pay'), 'btn-success'),
    });
    wireCancel();
    $('#payOk').onclick = async () => {
      try {
        await api(`/api/customers/${c.id}/payments`, {
          method: 'POST',
          body: { amount: Number($('#payAmt').value) || 0, method: $('#payMethod').value },
        });
        closeModal(); toast(l('saved'), 'ok'); renderCustomers();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  async function statement(id) {
    const { customer, rows } = await api('/api/customers/statement?id=' + encodeURIComponent(id));
    const kindLabel = { sale: ar() ? 'فاتورة' : 'Sale', refund: ar() ? 'مرتجع' : 'Refund', payment: ar() ? 'سداد' : 'Payment' };
    openModal({
      wide: true,
      title: `${l('statementOf')} ${customer.name}`,
      body: `<div class="row between mb-2"><span class="small muted">${esc(customer.phone)}</span>
          <b class="mono">${l('balance')}: ${money(customer.balance || 0)}</b></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>${ar() ? 'التاريخ' : 'Date'}</th><th>${ar() ? 'النوع' : 'Type'}</th><th>${ar() ? 'المرجع' : 'Ref'}</th><th>${l('amount')}</th>
        </tr></thead><tbody>${rows.map((r) => `<tr>
          <td class="mono small">${dmy(r.at)}</td><td>${kindLabel[r.kind]}</td>
          <td class="mono small">${esc(r.ref)}</td>
          <td class="mono ${r.amount < 0 ? 'good' : ''}">${money(r.amount)}</td></tr>`).join('') || empty(4, l('close'))}</tbody></table></div>`,
      footer: `<button class="btn btn-ghost" id="mCancel">${l('close')}</button>`,
    });
    wireCancel();
  }

  /* ================= الموردون والمشتريات — F-06 ================= */
  async function renderSuppliers() {
    const [{ suppliers }, { purchases }] = await Promise.all([api('/api/suppliers'), api('/api/purchases')]);
    $('#content').innerHTML = `
      ${page(l('suppliers'),
        `${suppliers.length} ${ar() ? 'مورد' : 'suppliers'} · ${ar() ? 'التوريد يحدّث المخزون ومتوسط التكلفة' : 'Purchases update stock and weighted average cost'}`,
        isManager() ? `<button class="btn btn-ghost btn-sm" id="addS">+ ${l('addSupplier')}</button>
                       <button class="btn btn-primary btn-sm" id="addP">+ ${l('newPurchase')}</button>` : '')}
      ${table([l('supplier'), l('phone'), ar() ? 'عدد التوريدات' : 'Purchases', l('due')], 'rows')}
      <h3 class="mt-3 mb-1">${ar() ? 'آخر التوريدات' : 'Recent purchases'}</h3>
      ${table([ar() ? 'التاريخ' : 'Date', l('supplier'), ar() ? 'الأصناف' : 'Items', l('total'), l('status')], 'prows')}`;

    $('#rows').innerHTML = suppliers.length ? suppliers.map((s) => `
      <tr><td><b>${esc(s.name)}</b>${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}</td>
        <td class="mono small">${esc(s.phone || '—')}</td>
        <td class="mono">${num(s.purchasesCount)}</td>
        <td class="mono">${money(s.due)}</td></tr>`).join('') : empty(4, ar() ? 'مفيش موردين' : 'No suppliers');

    $('#prows').innerHTML = purchases.length ? purchases.map((p) => `
      <tr><td class="mono small">${dmy(p.at)}</td><td>${esc(p.supplierName)}</td>
        <td class="small">${p.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(' · ')}</td>
        <td class="mono"><b>${money(p.total)}</b></td>
        <td><span class="badge ${p.paid ? 'badge-ok' : 'badge-warn'}">${p.paid ? (ar() ? 'مدفوع' : 'Paid') : l('due')}</span></td></tr>`).join('')
      : empty(5, ar() ? 'مفيش توريدات' : 'No purchases');

    const addS = $('#addS');
    if (addS) addS.onclick = () => {
      openModal({
        title: l('addSupplier'),
        body: `<div class="field"><label class="label">${l('name')}</label><input class="input" id="sN" /></div>
          <div class="field"><label class="label">${l('phone')}</label><input class="input mono" id="sP" /></div>
          <div class="field"><label class="label">${ar() ? 'ملاحظة' : 'Note'}</label><input class="input" id="sNote" /></div>`,
        footer: modalFooter('sOk', l('save')),
      });
      wireCancel();
      $('#sOk').onclick = async () => {
        try {
          await api('/api/suppliers', { method: 'POST', body: { name: $('#sN').value.trim(), phone: $('#sP').value.trim(), note: $('#sNote').value.trim() } });
          closeModal(); toast(l('saved'), 'ok'); renderSuppliers();
        } catch (err) { toast(err.message, 'bad'); }
      };
    };

    const addP = $('#addP');
    if (addP) addP.onclick = () => purchaseModal(suppliers);
  }

  function purchaseModal(suppliers) {
    const products = ctx.getProducts();
    const lineRow = (k) => `
      <div class="row" style="gap:6px;align-items:end;margin-bottom:6px" data-line="${k}">
        <div class="field" style="flex:2;margin:0">
          <label class="label">${ar() ? 'الصنف' : 'Product'}</label>
          <select class="input" data-p>${products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="width:90px;margin:0"><label class="label">${l('qty')}</label><input class="input mono" data-q type="number" min="1" value="1" /></div>
        <div class="field" style="width:120px;margin:0"><label class="label">${l('unitCost')}</label><input class="input mono" data-c type="number" min="0" value="0" /></div>
      </div>`;
    openModal({
      wide: true,
      title: l('newPurchase'),
      body: `<div class="field"><label class="label">${l('supplier')}</label>
          <select class="input" id="puSup">${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div id="puLines">${lineRow(0)}</div>
        <button class="btn btn-ghost btn-sm" id="puMore">${l('addLine')}</button>
        <div class="field mt-2"><label class="row" style="gap:8px;align-items:center"><input type="checkbox" id="puPaid" /> <span>${l('paidNow')}</span></label></div>
        <div class="small muted">${ar() ? 'سعر الشراء يدخل في متوسط التكلفة المرجح — تقارير الربح تبقى صحيحة.' : 'Cost updates the weighted average so profit stays honest.'}</div>`,
      footer: modalFooter('puOk', l('save')),
    });
    wireCancel();
    let k = 1;
    $('#puMore').onclick = () => { $('#puLines').insertAdjacentHTML('beforeend', lineRow(k++)); };
    $('#puOk').onclick = async () => {
      const items = $$('#puLines [data-line]').map((row) => ({
        productId: $('[data-p]', row).value,
        qty: Number($('[data-q]', row).value) || 1,
        cost: Number($('[data-c]', row).value) || 0,
      }));
      try {
        await api('/api/purchases', { method: 'POST', body: { supplierId: $('#puSup').value, items, paid: $('#puPaid').checked } });
        await ctx.refreshProducts();
        closeModal(); toast(l('saved'), 'ok'); renderSuppliers();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= أكواد الخصم — F-02 ================= */
  async function renderCoupons() {
    if (!isManager()) return toast(ar() ? 'للمدير بس' : 'Managers only', 'bad');
    const { coupons } = await api('/api/coupons');
    $('#content').innerHTML = `
      ${page(l('coupons'), ar() ? 'خصم على الفاتورة كلها — لا يخترق سقف الخصم للمستخدم' : 'Applies to the whole ticket — never lifts the user discount ceiling',
        `<button class="btn btn-primary btn-sm" id="addK">+ ${l('addCoupon')}</button>`)}
      ${table([l('code'), l('type'), l('value'), l('minSubtotal'), l('expires'), l('uses'), l('status'), ''], 'rows')}`;
    $('#rows').innerHTML = coupons.length ? coupons.map((c) => `
      <tr><td class="mono"><b>${esc(c.code)}</b></td>
        <td>${c.type === 'percent' ? l('percent') : l('fixed')}</td>
        <td class="mono">${c.type === 'percent' ? `${c.value}%` : money(c.value)}</td>
        <td class="mono">${c.minSubtotal ? money(c.minSubtotal) : '—'}</td>
        <td class="mono small">${c.expiresAt ? dmy(c.expiresAt) : '—'}</td>
        <td class="mono">${num(c.used || 0)}</td>
        <td><span class="badge ${c.active ? 'badge-ok' : 'badge-bad'}">${c.active ? l('active') : l('stopped')}</span></td>
        <td>${c.active ? `<button class="btn btn-ghost btn-sm" data-off="${esc(c.code)}">${l('disable')}</button>` : ''}</td></tr>`).join('')
      : empty(8, ar() ? 'مفيش أكواد' : 'No coupons');

    $('#addK').onclick = () => {
      openModal({
        title: l('addCoupon'),
        body: `<div class="field"><label class="label">${l('code')}</label><input class="input mono" id="kCode" placeholder="NILE10" /></div>
          <div class="grid g-2">
            <div class="field"><label class="label">${l('type')}</label>
              <select class="input" id="kType"><option value="percent">${l('percent')}</option><option value="amount">${l('fixed')}</option></select></div>
            <div class="field"><label class="label">${l('value')}</label><input class="input mono" id="kVal" type="number" min="0" /></div>
            <div class="field"><label class="label">${l('minSubtotal')}</label><input class="input mono" id="kMin" type="number" min="0" value="0" /></div>
            <div class="field"><label class="label">${l('expires')}</label><input class="input" id="kExp" type="date" /></div>
          </div>`,
        footer: modalFooter('kOk', l('save')),
      });
      wireCancel();
      $('#kOk').onclick = async () => {
        try {
          await api('/api/coupons', {
            method: 'POST',
            body: {
              code: $('#kCode').value.trim(), type: $('#kType').value,
              value: Number($('#kVal').value) || 0,
              minSubtotal: Number($('#kMin').value) || 0,
              expiresAt: $('#kExp').value ? new Date($('#kExp').value + 'T23:59:59').toISOString() : null,
            },
          });
          closeModal(); toast(l('saved'), 'ok'); renderCoupons();
        } catch (err) { toast(err.message, 'bad'); }
      };
    };
    $$('#rows [data-off]').forEach((b) => (b.onclick = async () => {
      try { await api('/api/coupons/' + encodeURIComponent(b.dataset.off), { method: 'DELETE' }); toast(l('saved'), 'ok'); renderCoupons(); }
      catch (err) { toast(err.message, 'bad'); }
    }));
  }

  /* ================= حركة الدرج — F-08 ================= */
  async function renderCash() {
    const { movements, openShiftId } = await api('/api/cash-movements');
    const pending = movements.filter((m) => m.status === 'pending').length;
    $('#content').innerHTML = `
      ${page(l('cash'),
        openShiftId ? (ar() ? 'الحركات اليدوية فقط — البيع والمرتجعات محسوبة من الفواتير' : 'Manual movements only — sales and refunds come from invoices') : (ar() ? 'مفيش وردية مفتوحة — الحركة هتتسجل بلا وردية' : 'No open shift — movement will be logged without one'),
        `<button class="btn btn-primary btn-sm" id="addM">+ ${l('newMovement')}</button>`)}
      ${pending ? `<div class="card card-pad mb-2" style="border-inline-start:4px solid var(--warn)">${ar() ? 'حركات بانتظار اعتماد المدير' : 'Movements waiting for a manager'}: <b class="mono">${pending}</b></div>` : ''}
      ${table([ar() ? 'الوقت' : 'Time', l('type'), l('amount'), l('reason'), ar() ? 'بواسطة' : 'By', l('status'), ''], 'rows')}`;
    $('#rows').innerHTML = movements.length ? movements.map((m) => `
      <tr><td class="mono small">${dmy(m.at)} ${hm(m.at)}</td>
        <td><span class="badge ${m.type === 'in' ? 'badge-ok' : 'badge-warn'}">${m.type === 'in' ? '↓ ' + l('in') : '↑ ' + l('out')}</span></td>
        <td class="mono"><b>${money(m.amount)}</b></td>
        <td class="small">${esc(m.reason)}</td>
        <td class="small">${esc(m.userName || '—')}</td>
        <td><span class="badge ${m.status === 'approved' ? 'badge-ok' : 'badge-warn'}">${m.status === 'approved' ? l('approved') : l('pending')}</span></td>
        <td>${m.status === 'pending' && isManager() ? `<button class="btn btn-success btn-sm" data-ap="${m.id}">${l('approve')}</button>` : ''}</td></tr>`).join('')
      : empty(7, ar() ? 'مفيش حركات' : 'No movements');

    $('#addM').onclick = () => {
      openModal({
        title: l('newMovement'),
        body: `<div class="field"><label class="label">${l('type')}</label>
            <select class="input" id="mType"><option value="in">${l('in')}</option><option value="out">${l('out')}</option></select></div>
          <div class="field"><label class="label">${l('amount')}</label><input class="input input-lg mono" id="mAmt" type="number" min="1" /></div>
          <div class="field"><label class="label">${l('reason')}</label><input class="input" id="mWhy" placeholder="${ar() ? 'مثال: شراء أكياس' : 'e.g. carrier bags'}" /></div>
          ${isManager() ? '' : `<div class="small muted">${ar() ? 'طلبك هيفضل معلّق لحد ما المدير يعتمده.' : 'Your request stays pending until a manager approves it.'}</div>`}`,
        footer: modalFooter('mOk', l('save')),
      });
      wireCancel();
      $('#mOk').onclick = async () => {
        try {
          await api('/api/cash-movements', {
            method: 'POST',
            body: { type: $('#mType').value, amount: Number($('#mAmt').value) || 0, reason: $('#mWhy').value.trim() },
          });
          closeModal(); toast(l('saved'), 'ok'); renderCash();
        } catch (err) { toast(err.message, 'bad'); }
      };
    };
    $$('#rows [data-ap]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/cash-movements/${b.dataset.ap}/approve`, { method: 'POST' }); toast(l('saved'), 'ok'); renderCash(); }
      catch (err) { toast(err.message, 'bad'); }
    }));
  }

  /* ================= المخزون — F-05 ================= */
  async function renderStock() {
    const [{ movements }, { low }] = await Promise.all([
      api('/api/stock/movements?limit=100'), api('/api/stock/low'),
    ]);
    $('#content').innerHTML = `
      ${page(l('stock'),
        `${low.length} ${ar() ? 'صنف تحت حد الطلب' : 'items below reorder level'}`,
        `<button class="btn btn-ghost btn-sm" id="doAdj">${l('adjust')}</button>
         <button class="btn btn-ghost btn-sm" data-csv="stock">⬇ ${l('exportCsv')}</button>`)}
      <h3 class="mb-1">${l('lowNow')}</h3>
      ${table([ar() ? 'الصنف' : 'Product', l('onHand'), l('reorder'), ''], 'lowrows')}
      <h3 class="mt-3 mb-1">${l('movements')}</h3>
      ${table([ar() ? 'الوقت' : 'Time', ar() ? 'الصنف' : 'Product', ar() ? 'الحركة' : 'Change', ar() ? 'النوع' : 'Reason', ar() ? 'بواسطة' : 'By'], 'rows')}`;

    $('#lowrows').innerHTML = low.length ? low.map((p) => `
      <tr><td><b>${esc(p.name)}</b></td>
        <td><span class="badge badge-warn mono">${num(p.stock)}</span></td>
        <td class="mono muted">${num(p.reorderLevel ?? '—')}</td>
        <td><button class="btn btn-ghost btn-sm" data-adj="${p.id}">${l('adjust')}</button></td></tr>`).join('')
      : empty(4, ar() ? 'كل الأصناف فوق الحد' : 'Everything is above the line');

    const kindLabel = { sale: ar() ? 'بيع' : 'Sale', refund: ar() ? 'مرتجع' : 'Refund', purchase: ar() ? 'توريد' : 'Purchase', adjust: ar() ? 'تسوية' : 'Adjust' };
    $('#rows').innerHTML = movements.length ? movements.map((m) => `
      <tr><td class="mono small">${dmy(m.at)} ${hm(m.at)}</td>
        <td class="small">${esc(m.name || '—')}</td>
        <td class="mono"><b class="${m.qty > 0 ? 'good' : 'bad'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</b>
          <span class="small muted">→ ${num(m.after ?? '')}</span></td>
        <td class="small">${kindLabel[m.kind] || esc(m.kind || '')}${m.note ? ` · ${esc(m.note)}` : ''}</td>
        <td class="small">${esc(m.byName || m.userName || '—')}</td></tr>`).join('')
      : empty(5, ar() ? 'مفيش حركات' : 'No movements');

    $('#doAdj').onclick = () => adjustModal(null);
    $$('#lowrows [data-adj]').forEach((b) => (b.onclick = () => adjustModal(b.dataset.adj)));
    $$('[data-csv]').forEach((b) => (b.onclick = () => downloadCsv(b.dataset.csv)));
  }

  async function adjustModal(productId) {
    const products = ctx.getProducts();
    openModal({
      title: l('adjustTitle'),
      body: `<div class="field"><label class="label">${ar() ? 'الصنف' : 'Product'}</label>
          <select class="input" id="ajProd">${products.map((p) => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)} — ${p.stock}</option>`).join('')}</select></div>
        <div class="field"><label class="label">${ar() ? 'الفرق (+/−)' : 'Change (+/−)'}</label><input class="input input-lg mono" id="ajQty" type="number" value="0" /></div>
        <div class="field"><label class="label">${l('reason')}</label><input class="input" id="ajWhy" placeholder="${ar() ? 'تالف · جرد · فقد' : 'damaged · count · loss'}" /></div>
        <div class="small muted">${ar() ? 'ممنوع ينزل المخزون تحت الصفر — النظام يرفض ويقول السبب.' : 'Stock can never go below zero — the server refuses and says why.'}</div>`,
      footer: modalFooter('ajOk', l('save')),
    });
    wireCancel();
    $('#ajOk').onclick = async () => {
      try {
        await api('/api/stock/adjust', {
          method: 'POST',
          body: { productId: $('#ajProd').value, qty: Number($('#ajQty').value) || 0, reason: $('#ajWhy').value.trim() },
        });
        await ctx.refreshProducts();
        closeModal(); toast(l('saved'), 'ok'); renderStock();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= المستخدمون — F-10 ================= */
  async function renderUsers() {
    if (!isManager()) return toast(ar() ? 'للمدير بس' : 'Managers only', 'bad');
    const { users } = await api('/api/users');
    $('#content').innerHTML = `
      ${page(l('users'), ar() ? 'كلمات المرور مخزّنة مُشفّرة — لا تُقرأ ولا تُطبع' : 'Passwords are hashed — never readable or printable',
        `<button class="btn btn-primary btn-sm" id="addU">+ ${l('addUser')}</button>`)}
      ${table([l('name'), l('username'), l('role'), l('status'), ''], 'rows')}`;
    $('#rows').innerHTML = users.map((u) => `
      <tr><td><b>${esc(u.name)}</b></td>
        <td class="mono small">${esc(u.username)}</td>
        <td><span class="badge ${u.role === 'manager' ? 'badge-brand' : ''}">${u.role === 'manager' ? l('manager') : l('cashier')}</span></td>
        <td><span class="badge ${u.active ? 'badge-ok' : 'badge-bad'}">${u.active ? (ar() ? 'مفعّل' : 'Active') : (ar() ? 'موقوف' : 'Disabled')}</span></td>
        <td class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" data-tog="${u.id}" data-active="${u.active ? 1 : 0}">${u.active ? l('disable') : l('enable')}</button>
          <button class="btn btn-ghost btn-sm" data-pw="${u.id}">${l('password')}</button>
        </td></tr>`).join('');

    $('#addU').onclick = () => {
      openModal({
        title: l('addUser'),
        body: `<div class="field"><label class="label">${l('name')}</label><input class="input" id="uName" /></div>
          <div class="field"><label class="label">${l('username')}</label><input class="input mono" id="uUser" /></div>
          <div class="field"><label class="label">${l('password')}</label><input class="input mono" id="uPass" minlength="6" /></div>
          <div class="field"><label class="label">${l('role')}</label>
            <select class="input" id="uRole"><option value="cashier">${l('cashier')}</option><option value="manager">${l('manager')}</option></select></div>`,
        footer: modalFooter('uOk', l('save')),
      });
      wireCancel();
      $('#uOk').onclick = async () => {
        try {
          await api('/api/users', {
            method: 'POST',
            body: { name: $('#uName').value.trim(), username: $('#uUser').value.trim(), password: $('#uPass').value, role: $('#uRole').value },
          });
          closeModal(); toast(l('saved'), 'ok'); renderUsers();
        } catch (err) { toast(err.message, 'bad'); }
      };
    };

    $$('#rows [data-tog]').forEach((b) => (b.onclick = async () => {
      try {
        await api('/api/users/' + b.dataset.tog, { method: 'PUT', body: { active: b.dataset.active !== '1' } });
        toast(l('saved'), 'ok'); renderUsers();
      } catch (err) { toast(err.message, 'bad'); }
    }));
    $$('#rows [data-pw]').forEach((b) => (b.onclick = () => {
      openModal({
        title: l('password'),
        body: `<div class="field"><label class="label">${l('password')}</label><input class="input mono" id="npw" minlength="6" /></div>
          <div class="small muted">${ar() ? '6 أحرف على الأقل. المستخدم هيدخل بالكلمة الجديدة فوراً.' : 'At least 6 characters. Effective immediately.'}</div>`,
        footer: modalFooter('pwOk', l('save')),
      });
      wireCancel();
      $('#pwOk').onclick = async () => {
        try {
          await api('/api/users/' + b.dataset.pw, { method: 'PUT', body: { password: $('#npw').value } });
          closeModal(); toast(l('saved'), 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      };
    }));
  }

  /* ================= النسخ الاحتياطي — F-16 ================= */
  async function renderBackup() {
    if (!isManager()) return toast(ar() ? 'للمدير بس' : 'Managers only', 'bad');
    $('#content').innerHTML = `
      ${page(l('backup'), ar() ? 'ملف واحد يحمل كل شيء — أصناف، فواتير، ورديات، عملاء، سجل' : 'One file holds everything — products, sales, shifts, customers, audit')}
      <div class="grid g-2">
        <div class="card card-pad">
          <h3 class="mb-1">${l('download')}</h3>
          <p class="small muted mb-2">${ar() ? 'نزّل الملف واحفظه خارج الخادم. هذا هو نسختك الوحيدة.' : 'Download it and keep it off the server. This is your only copy.'}</p>
          <a class="btn btn-primary" href="/api/backup" download>⬇ ${l('download')}</a>
        </div>
        <div class="card card-pad">
          <h3 class="mb-1">${l('restore')}</h3>
          <p class="small muted mb-2">${l('restoreWarn')}</p>
          <input class="input mb-2" id="bkFile" type="file" accept="application/json" />
          <div class="field"><label class="label">${ar() ? 'اكتب RESTORE' : 'Type RESTORE'}</label><input class="input mono" id="bkConfirm" placeholder="RESTORE" /></div>
          <button class="btn btn-danger" id="bkGo">${l('restore')}</button>
        </div>
        <div class="card card-pad">
          <h3 class="mb-1">${l('exportCsv')}</h3>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            ${['sales', 'returns', 'shifts', 'stock'].map((k) => `<button class="btn btn-ghost btn-sm" data-csv="${k}">${k}.csv</button>`).join('')}
          </div>
          <p class="small muted mt-2">${ar() ? 'UTF-8 مع BOM — الإكسل يقرأ العربي صح.' : 'UTF-8 with a BOM so Excel reads Arabic.'}</p>
        </div>
        <div class="card card-pad">
          <h3 class="mb-1">${l('systems')}</h3>
          <div id="sysBox" class="small muted">…</div>
        </div>
      </div>`;

    const { systems } = await api('/api/systems');
    $('#sysBox').innerHTML = systems.map((s) => `<div class="row between" style="padding:4px 0">
      <span>${esc(s.name)}</span>
      <span class="badge ${s.status === 'live' ? 'badge-ok' : s.status === 'partial' ? 'badge-warn' : ''}">${s.status === 'live' ? l('live') : s.status === 'partial' ? l('partial') : l('planned')}</span>
    </div>`).join('');

    $$('[data-csv]').forEach((b) => (b.onclick = () => downloadCsv(b.dataset.csv)));
    $('#bkGo').onclick = async () => {
      const file = $('#bkFile').files[0];
      if (!file) return toast(ar() ? 'اختار ملف' : 'Pick a file', 'bad');
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        await api('/api/restore', {
          method: 'POST',
          body: { confirm: $('#bkConfirm').value.trim(), data: parsed.data || parsed, at: parsed.at },
        });
        await ctx.refreshProducts();
        toast(l('saved'), 'ok');
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  /* ================= التصدير — F-09 ================= */
  // التنزيل مباشرة عبر الرابط لأن fetch يحوّل الملف لنص ويفقد الـ BOM.
  function downloadCsv(name) {
    const a = document.createElement('a');
    a.href = `/api/export/${name}.csv`;
    a.download = `${name}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ================= التنبيهات — F-13 ================= */
  async function renderAlerts() {
    const { alerts } = await api('/api/alerts');
    const kindLabel = {
      low_stock: ar() ? 'مخزون منخفض' : 'Low stock',
      overdue_balance: ar() ? 'رصيد متأخر' : 'Overdue balance',
      drawer_diff: ar() ? 'فرق درج' : 'Drawer difference',
      refunds_high: ar() ? 'مرتجعات مرتفعة' : 'High refunds',
      shift_long: ar() ? 'وردية طويلة' : 'Long shift',
    };
    $('#content').innerHTML = `
      ${page(l('alerts'), `${alerts.length} ${ar() ? 'تنبيه مفتوح' : 'open alerts'}`,
        alerts.length ? `<button class="btn btn-ghost btn-sm" id="seenAll">✓ ${l('seen')} (${alerts.length})</button>` : '')}
      ${alerts.length ? `<div class="grid g-2">${alerts.map((a) => `
        <div class="card card-pad" style="border-inline-start:4px solid var(--${a.severity === 'bad' ? 'bad' : 'warn'})">
          <div class="row between"><b>${esc(kindLabel[a.kind] || a.kind)}</b>
            <span class="badge ${a.severity === 'bad' ? 'badge-bad' : 'badge-warn'}">${esc(a.severity || 'warn')}</span></div>
          <div class="small muted mt-1">${esc(a.message)}</div>
        </div>`).join('')}</div>`
      : `<div class="card card-pad center"><div style="font-size:40px">✅</div><b>${l('noAlerts')}</b></div>`}`;

    const seenAll = $('#seenAll');
    if (seenAll) seenAll.onclick = async () => {
      try {
        await api('/api/alerts/seen', { method: 'POST', body: { ids: alerts.map((a) => a.id) } });
        await refreshBadge();
        renderAlerts();
      } catch (err) { toast(err.message, 'bad'); }
    };
  }

  // شارة topbar: عدد التنبيهات غير المقروءة. تفشل بصمت لأن الشارة ليست حرجة.
  async function refreshBadge() {
    const badge = $('#alertBadge');
    if (!badge) return 0;
    try {
      const { count } = await api('/api/alerts');
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', !count);
      return count;
    } catch { return 0; }
  }

  /* ================= الفاتورة المطبوعة — F-01 · F-12 ================= */
  async function printInvoice(saleId) {
    const { sale, tax, store } = await api('/api/invoice?id=' + encodeURIComponent(saleId));
    const paid = (sale.payments || []).reduce((a, p) => a + p.amount, 0);
    const due = Math.max(0, Math.round((sale.total - paid) * 100) / 100);
    const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${value}</td></tr>`;
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
      <title>${tax.number}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        * { box-sizing: border-box; }
        body { font-family: "Segoe UI", Tahoma, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 8px; }
        h1 { font-size: 15px; margin: 0; text-align: center; }
        .center { text-align: center; }
        .muted { color: #555; }
        .mono { font-variant-numeric: tabular-nums; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        td { padding: 2px 0; vertical-align: top; }
        td.n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .sep { border-top: 1px dashed #999; margin: 6px 0; }
        .grand td { font-weight: 800; font-size: 14px; }
        .foot { text-align: center; color: #555; font-size: 11px; margin-top: 8px; }
        @media print { .noprint { display: none; } }
        .noprint { text-align: center; margin-top: 10px; }
        .noprint button { padding: 8px 20px; font-size: 14px; }
      </style></head><body>
      <h1>${esc(tax.legalName || store?.storeName || '')}</h1>
      <div class="center muted">${esc(tax.address || '')}</div>
      <div class="center muted">${ar() ? 'الرقم الضريبي' : 'Tax no.'}: <span class="mono">${esc(tax.taxNumber || '—')}</span>
        ${tax.commercialRegister ? ` · ${ar() ? 'س.ت' : 'CR'}: <span class="mono">${esc(tax.commercialRegister)}</span>` : ''}</div>
      <div class="sep"></div>
      <div class="center mono"><b>${esc(tax.number)}</b></div>
      <div class="center muted mono">${dmy(sale.createdAt)} ${hm(sale.createdAt)}</div>
      <table>
        ${sale.items.map((it) => `<tr><td>${esc(it.name)} ×${it.qty}<div class="muted mono">${money(it.price)}</div></td>
          <td class="n">${money(it.price * it.qty - (it.discount || 0))}</td></tr>`).join('')}
      </table>
      <div class="sep"></div>
      <table>
        ${row(ar() ? 'الإجمالي قبل الخصم' : 'Subtotal', money(sale.subtotal))}
        ${sale.discount ? row(ar() ? 'الخصم' : 'Discount', '− ' + money(sale.discount)) : ''}
        ${sale.couponCode ? row(ar() ? 'كود خصم' : 'Coupon', esc(sale.couponCode)) : ''}
        ${row(`${ar() ? 'ض.ق.م' : 'VAT'} ${sale.taxRate || 0}%`, money(sale.tax || 0))}
        ${row(ar() ? 'الإجمالي' : 'Total', money(sale.total), 'grand')}
        ${sale.method === 'cash' && sale.paid ? row(ar() ? 'المدفوع' : 'Paid', money(sale.paid)) : ''}
        ${sale.method === 'cash' && sale.change ? row(ar() ? 'الباقي' : 'Change', money(sale.change)) : ''}
        ${paid && sale.method === 'credit' ? row(ar() ? 'مدفوع من الآجل' : 'Paid', money(paid)) : ''}
        ${due && sale.method === 'credit' ? row(ar() ? 'المتبقي' : 'Due', money(due), 'grand') : ''}
      </table>
      <div class="sep"></div>
      <div class="center muted">${ar() ? 'طريقة الدفع' : 'Tender'}: ${esc(sale.method)}</div>
      ${sale.customerName ? `<div class="center muted">${ar() ? 'العميل' : 'Customer'}: ${esc(sale.customerName)}</div>` : ''}
      <div class="foot">${ar() ? 'شكراً لزيارتكم — الاستبدال والاسترجاع بموجب الفاتورة' : 'Thank you — returns require this receipt'}</div>
      <div class="noprint"><button onclick="window.print()">${ar() ? 'طباعة' : 'Print'}</button></div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return toast(ar() ? 'المتصفح منع فتح النافذة' : 'Popup blocked', 'bad');
    w.document.write(html);
    w.document.close();
  }

  window.NSAdmin = {
    attach,
    refreshBadge,
    printInvoice,
    downloadCsv,
    views: {
      settings: renderSettings,
      customers: renderCustomers,
      suppliers: renderSuppliers,
      coupons: renderCoupons,
      cash: renderCash,
      stock: renderStock,
      users: renderUsers,
      backup: renderBackup,
      alerts: renderAlerts,
    },
  };
})();
