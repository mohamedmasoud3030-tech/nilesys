'use strict';
/* ============================================================
   إضافات «الباك أوفيس» — كل ما تبقّى من سجل المزايا (F-01 … F-15)
   في ملف واحد، بلا أي مكتبة خارجية، مع نفس أسلوب server.js.

   لماذا ملف منفصل: server.js صار طويلاً، وهذه الإضافات كلها «دفتر»
   (موردون، عملاء، حركات مخزون، حركات درج، تنبيهات). فصلها يجعل
   مراجعتها ممكنة من غير قراءة آلة الحالة كلها.

   العقد مع server.js:
     const ext = require('./lib/extensions')(ctx)
     ext.handle(req, res, url, { route, user, isManager }) → true إذا خُدم الطلب
     ext.priceSale(...) / ext.afterSale(...) تُستدعى من مسار البيع
   ============================================================ */

const crypto = require('crypto');

module.exports = function createExtensions(ctx) {
  const getDb = ctx.getDb;
  const save = ctx.save;
  const audit = ctx.audit;
  const sendJSON = ctx.sendJSON;
  const sendError = ctx.sendError;
  const readBody = ctx.readBody;

  const db = () => getDb();
  const now = () => new Date().toISOString();
  const money = (n) => Math.round(n * 100) / 100;
  const auth = (user) => {
    if (!user) {
      const e = new Error('لازم تسجل دخول الأول');
      e.status = 401;
      throw e;
    }
  };
  const managerOnly = (user) => {
    auth(user);
    if (user.role !== 'manager') {
      const e = new Error('الصفحة دي للمدير بس');
      e.status = 403;
      throw e;
    }
  };
  const notFound = (msg) => {
    const e = new Error(msg || 'مش موجود');
    e.status = 404;
    throw e;
  };

  /* ============================================================
     كلمات المرور — F-10 · F-15
     scrypt مملّح لكل مستخدم. لا نص صريح في المستند مطلقاً.
     ============================================================ */

  function hashPassword(plain) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  function verifyPassword(plain, stored) {
    if (!stored || typeof stored !== 'string') return false;
    const [algo, salt, hash] = stored.split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(plain), salt, 64);
    const known = Buffer.from(hash, 'hex');
    return test.length === known.length && crypto.timingSafeEqual(test, known);
  }

  /* ============================================================
     الافتراضيات — تُضاف لمستند قديم عند أول قراءة (ترحيل لطيف)
     ============================================================ */

  // مستخدمو الأنظمة الجديدة — F-16.
  // كل نظام له مستخدموه: مدير الكاشير لا يدخل نظام المخازن تلقائياً، والعكس.
  // كلمة المرور نفسها في الديمو (demo1234) لكن التجزئة تُحسب هنا مرة واحدة.
  function ensureSystemUsers(d, system, names) {
    let changed = false;
    for (const n of names) {
      const exists = (d.users || []).some((u) => u.system === system && u.username === n.username);
      if (exists) continue;
      d.users.push({
        id: crypto.randomUUID(), name: n.name, username: n.username,
        system, role: n.role, active: true,
        passwordHash: hashPassword('demo1234'),
      });
      changed = true;
    }
    return changed;
  }

  function seedDefaults(d) {
    let changed = false;
    const ensure = (key, value) => {
      if (d[key] === undefined) { d[key] = value; changed = true; }
    };
    ensure('suppliers', []);
    ensure('purchases', []);
    ensure('customers', []);
    ensure('coupons', [
      { code: 'NILE10', type: 'percent', value: 10, active: true, expiresAt: null, minSubtotal: 0, used: 0 },
      { code: 'SAVE50', type: 'amount', value: 50, active: true, expiresAt: null, minSubtotal: 300, used: 0 },
    ]);
    ensure('stockMovements', []);
    ensure('cashMovements', []);
    ensure('customerPayments', []);
    ensure('alertsSeen', []);
    ensure('held', []);
    ensure('audit', []);
    if (!d.settings) { d.settings = {}; changed = true; }
    const s = d.settings;
    const dflt = {
      taxRate: 0,               // 0 = الضريبة مطفية حتى يفعّلها المالك من الإعدادات
      taxNumber: '',
      legalName: '',
      commercialRegister: '',
      address: '',
      invoicePrefix: 'INV',
      currency: 'ج.م',
      lowStockDefault: 5,
      drawerDiffAlert: 50,
      shiftHoursAlert: 12,
      refundsAlertRatio: 0.2,
      loyaltyPerUnit: 100,      // نقطة لكل 100 من الصافي
    };
    for (const [k, v] of Object.entries(dflt)) {
      if (s[k] === undefined) { s[k] = v; changed = true; }
    }
    // ترحيل كلمات المرور: أي مستخدم ما زال بنص صريح يُشفّر الآن ومرة واحدة.
    for (const u of d.users || []) {
      if (u.password && !u.passwordHash) {
        u.passwordHash = hashPassword(u.password);
        delete u.password;
        changed = true;
      }
    }
    // حقول جديدة على الأصناف
    for (const p of d.products || []) {
      if (p.taxExempt === undefined) { p.taxExempt = false; changed = true; }
      if (p.taxRate === undefined) { p.taxRate = null; changed = true; }
      if (p.reorderLevel === undefined) { p.reorderLevel = d.settings.lowStockDefault; changed = true; }
    }
    return changed;
  }

  /* ============================================================
     الأحداث — يومية موحّدة
     ============================================================ */

  function stockMove(d, product, qty, reason, meta, user) {
    if (!product) return;
    d.stockMovements.push({
      id: crypto.randomUUID(),
      at: now(),
      productId: product.id,
      name: product.name,
      qty,                      // موجب = داخل، سالب = خارج
      reason,                   // sale | refund | purchase | adjust | waste
      kind: reason,             // اسم صريح للعرض (نفس القيمة، لكن مقروء)
      after: product.stock,     // الرصيد بعد الحركة — «+5 ← 42» أصدق من «+5»
      ref: (meta && meta.ref) || null,
      note: (meta && meta.note) || '',
      userId: user ? user.id : null,
      userName: user ? user.name : '—',
    });
  }

  function cashMove(d, { type, amount, reason, user, shiftId, origin }) {
    d.cashMovements.push({
      id: crypto.randomUUID(),
      at: now(),
      type,                     // in | out
      amount: money(amount),
      reason,
      // origin: sale/refund تُحسب من الفواتير نفسها في shiftExpectedCash،
      // فلا يجوز جمعها مرتين. manual/payment هي التي تُجمع من الدفتر.
      origin: origin || 'manual',
      status: 'approved',
      shiftId: shiftId || null,
      userId: user ? user.id : null,
      userName: user ? user.name : '—',
    });
  }

  function openShiftOf(d, system) {
    return (d.shifts || []).find((s) => s.system === system && !s.closedAt) || null;
  }

  /* ============================================================
     التسعير — F-01 (الضريبة) · F-02 (الخصومات) · F-12 (الدفع)
     دالة واحدة تحسب كل شيء من جهة السيرفر، ولا تثق بالمتصرّف.
     ============================================================ */

  function priceSale(d, body, user) {
    const isManager = user && user.role === 'manager';
    const settings = d.settings || {};

    const items = (body.items || []).map((it) => {
      const p = d.products.find((x) => x.id === it.productId);
      if (!p) { const e = new Error('صنف غير موجود'); e.status = 400; throw e; }
      const qty = Math.max(1, Number(it.qty) || 1);
      const lineDiscount = Math.max(0, Math.min(Number(it.discount) || 0, p.price * qty * 0.3));
      const gross = p.price * qty;
      const lineNet = money(gross - lineDiscount);
      const rate = p.taxExempt ? 0 : (p.taxRate === null || p.taxRate === undefined
        ? Number(settings.taxRate) || 0 : Number(p.taxRate));
      return {
        productId: p.id, name: p.name, qty, price: p.price, cost: p.cost,
        lineDiscount: money(lineDiscount),
        lineNet,
        taxRate: rate,
      };
    });
    if (!items.length) { const e = new Error('السلة فاضية'); e.status = 400; throw e; }

    const subtotal = money(items.reduce((a, i) => a + i.price * i.qty, 0));
    const lineDiscounts = money(items.reduce((a, i) => a + i.lineDiscount, 0));

    // كود خصم — F-02
    let coupon = null;
    let couponDiscount = 0;
    if (body.couponCode) {
      const c = d.coupons.find((x) => x.code.toUpperCase() === String(body.couponCode).trim().toUpperCase());
      if (!c || !c.active) { const e = new Error('كود الخصم غير صالح'); e.status = 400; throw e; }
      if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
        const e = new Error('كود الخصم منتهي'); e.status = 400; throw e;
      }
      const afterLines = subtotal - lineDiscounts;
      if (afterLines < (c.minSubtotal || 0)) {
        const e = new Error(`الكود يتطلب فاتورة ${c.minSubtotal} على الأقل`); e.status = 400; throw e;
      }
      coupon = c;
      couponDiscount = c.type === 'percent' ? money(afterLines * (Number(c.value) / 100)) : money(Number(c.value));
      couponDiscount = Math.min(couponDiscount, afterLines);
    }

    const invoiceDiscount = Math.max(0, Number(body.discount) || 0);
    const discount = money(Math.min(invoiceDiscount + lineDiscounts + couponDiscount, subtotal));

    // سقف الدور على الخصم الكلي — F-02 / PERM-4
    const ratio = subtotal > 0 ? discount / subtotal : 0;
    const cap = isManager ? 1 : 0.10;
    if (ratio > cap + 1e-9) {
      const e = new Error(`الخصم الأقصى ${Math.round(cap * 100)}% — اطلب مدير`);
      e.status = 403;
      throw e;
    }

    const taxableBase = money(subtotal - discount);
    // الضريبة تُحسب على أساس كل سطر بعد خصمه (تناسبيًا) — لا تُحتسب على الخصم.
    const tax = money(items.reduce((a, i) => {
      const share = subtotal > 0 ? (i.price * i.qty) / subtotal : 0;
      const deducted = money(discount * share);
      const base = Math.max(0, money(i.lineNet - deducted));
      return a + money(base * (i.taxRate / 100));
    }, 0));

    const total = money(taxableBase + tax);
    const profit = money(items.reduce((a, i) => a + (i.price - i.cost) * i.qty, 0) - discount);

    return {
      items: items.map((i) => ({
        productId: i.productId, name: i.name, qty: i.qty, price: i.price, cost: i.cost,
        lineDiscount: i.lineDiscount, taxRate: i.taxRate,
      })),
      subtotal, lineDiscounts, couponDiscount, discount,
      couponCode: coupon ? coupon.code : null,
      taxRate: Number(settings.taxRate) || 0,
      taxableBase, tax, total, profit,
    };
  }

  /* ============================================================
     بعد البيع — مخزون · نقاط · حركات درج · تنبيهات
     ============================================================ */

  function afterSale(d, sale, user) {
    for (const it of sale.items) {
      const p = d.products.find((x) => x.id === it.productId);
      if (p) stockMove(d, p, -it.qty, 'sale', { ref: `#${sale.no}` }, user);
    }
    if (sale.customerId) {
      const c = d.customers.find((x) => x.id === sale.customerId);
      if (c) {
        if (sale.method === 'credit') {
          c.balance = money((c.balance || 0) + sale.total);
        } else {
          const per = Number((d.settings || {}).loyaltyPerUnit) || 100;
          c.points = Math.round((c.points || 0) + sale.total / per);
        }
      }
    }
    if (sale.method === 'cash') {
      const shift = openShiftOf(d, 'pos');
      if (shift) cashMove(d, { type: 'in', amount: sale.total, reason: `بيع #${sale.no}`, user, shiftId: shift.id, origin: 'sale' });
    }
  }

  function afterRefund(d, sale, refundAmount, user) {
    for (const r of sale.returned || []) {
      const p = d.products.find((x) => x.id === r.productId);
      if (p) stockMove(d, p, r.qty, 'refund', { ref: `#${sale.no}` }, user);
    }
    if (sale.method === 'cash' && refundAmount) {
      const shift = openShiftOf(d, 'pos');
      if (shift) cashMove(d, { type: 'out', amount: refundAmount, reason: `مرتجع #${sale.no}`, user, shiftId: shift.id, origin: 'refund' });
    }
    if (sale.method === 'credit' && sale.customerId) {
      const c = d.customers.find((x) => x.id === sale.customerId);
      if (c) c.balance = money(Math.max(0, (c.balance || 0) - refundAmount));
    }
  }

  /* ============================================================
     التنبيهات — F-13
     ============================================================ */

  function computeAlerts(d) {
    const out = [];
    const s = d.settings || {};
    for (const p of d.products.filter((x) => x.active !== false)) {
      const level = p.reorderLevel === undefined ? s.lowStockDefault : p.reorderLevel;
      if (p.stock <= level) {
        out.push({
          id: `low-${p.id}`, kind: 'low_stock', severity: p.stock <= 0 ? 'high' : 'medium',
          title: `${p.name} — المخزون ${p.stock}`,
          detail: `حد إعادة الطلب ${level}`,
        });
      }
    }
    const open = (d.shifts || []).filter((x) => !x.closedAt);
    for (const sh of open) {
      const hours = (Date.now() - new Date(sh.openedAt).getTime()) / 3600000;
      if (hours >= (s.shiftHoursAlert || 12)) {
        out.push({
          id: `shift-${sh.id}`, kind: 'shift_long', severity: 'medium',
          title: `وردية مفتوحة ${Math.round(hours)} ساعة`,
          detail: `بدأت ${sh.openedAt}`,
        });
      }
    }
    for (const sh of (d.shifts || []).filter((x) => x.closedAt && Math.abs(x.diff || 0) >= (s.drawerDiffAlert || 50))) {
      out.push({
        id: `drawer-${sh.id}`, kind: 'drawer_diff', severity: 'high',
        title: `فرق درج ${sh.diff}`,
        detail: `وردية أُغلقت بمتوقع ${sh.expectedCash} ومعدود ${sh.countedCash}`,
      });
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todaySales = (d.sales || []).filter((x) => new Date(x.createdAt) >= today);
    const refunds = todaySales.reduce((a, x) => a + (x.refunds || []).reduce((b, r) => b + r.amount, 0), 0);
    const gross = todaySales.reduce((a, x) => a + x.total, 0);
    if (gross > 0 && refunds / gross >= (s.refundsAlertRatio || 0.2)) {
      out.push({
        id: 'refunds-today', kind: 'refund_ratio', severity: 'high',
        title: `المرتجعات ${Math.round((refunds / gross) * 100)}% من مبيعات اليوم`,
        detail: `مرتجعات ${refunds} من إجمالي ${gross}`,
      });
    }
    return out;
  }

  /* ============================================================
     CSV — F-09
     ============================================================ */

  function csv(rows, headers) {
    const esc = (v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map((h) => esc(h.label)).join(',')];
    for (const r of rows) lines.push(headers.map((h) => esc(typeof h.get === 'function' ? h.get(r) : r[h.key])).join(','));
    return '\ufeff' + lines.join('\r\n');
  }

  /* ============================================================
     الموجّه
     ============================================================ */

  async function handle(req, res, url, rc) {
    const { route } = rc;
    const d = db();
    const u = rc.user;
    const isManager = rc.isManager;
    const p = url.pathname;
    const q = url.searchParams;

    /* ---------------- الإعدادات ---------------- */
    if (route === 'GET /api/settings') {
      auth(u);
      return sendJSON(res, 200, { settings: d.settings }), true;
    }
    if (route === 'PUT /api/settings') {
      managerOnly(u);
      const b = await readBody(req);
      const allowed = ['taxRate', 'taxNumber', 'legalName', 'commercialRegister', 'address',
        'invoicePrefix', 'lowStockDefault', 'drawerDiffAlert', 'shiftHoursAlert', 'refundsAlertRatio', 'loyaltyPerUnit'];
      for (const k of allowed) if (b[k] !== undefined) d.settings[k] = b[k];
      audit(u, 'settings.updated', 'تحديث إعدادات المتجر', { keys: Object.keys(b) });
      save();
      return sendJSON(res, 200, { settings: d.settings }), true;
    }

    /* ---------------- المستخدمون — F-10 ---------------- */
    if (route === 'GET /api/users') {
      managerOnly(u);
      return sendJSON(res, 200, {
        users: d.users.map((x) => ({
          id: x.id, name: x.name, username: x.username, role: x.role,
          system: x.system, active: x.active !== false,
        })),
      }), true;
    }
    if (route === 'POST /api/users') {
      managerOnly(u);
      const b = await readBody(req);
      if (!b.username || !b.password) return sendError(res, 400, 'اسم المستخدم وكلمة المرور مطلوبين'), true;
      if (String(b.password).length < 6) return sendError(res, 400, 'كلمة المرور 6 أحرف على الأقل'), true;
      if (d.users.some((x) => x.system === (b.system || 'pos') && x.username === b.username)) {
        return sendError(res, 409, 'اسم المستخدم موجود'), true;
      }
      const nu = {
        id: crypto.randomUUID(),
        name: b.name || b.username,
        username: b.username,
        system: b.system || 'pos',
        role: b.role === 'manager' ? 'manager' : 'cashier',
        active: true,
        passwordHash: hashPassword(b.password),
      };
      d.users.push(nu);
      audit(u, 'user.created', `مستخدم جديد ${nu.username} (${nu.role})`, { userId: nu.id });
      save();
      return sendJSON(res, 201, { user: { id: nu.id, username: nu.username, name: nu.name, role: nu.role, system: nu.system, active: true } }), true;
    }
    if (route.startsWith('PUT /api/users/')) {
      managerOnly(u);
      const id = p.split('/').pop();
      const target = d.users.find((x) => x.id === id);
      if (!target) return sendError(res, 404, 'المستخدم مش موجود'), true;
      const b = await readBody(req);
      if (b.name) target.name = b.name;
      if (b.role) target.role = b.role === 'manager' ? 'manager' : 'cashier';
      if (b.active !== undefined) {
        const wouldDisable = !b.active && target.role === 'manager';
        const otherManagers = d.users.filter((x) => x.role === 'manager' && x.active !== false && x.id !== target.id);
        if (wouldDisable && otherManagers.length === 0) {
          return sendError(res, 400, 'مينفعش تعطّل آخر مدير'), true;
        }
        target.active = Boolean(b.active);
      }
      if (b.password) target.passwordHash = hashPassword(b.password);
      audit(u, 'user.updated', `تعديل ${target.username}`, { userId: target.id });
      save();
      return sendJSON(res, 200, { user: { id: target.id, name: target.name, role: target.role, active: target.active !== false } }), true;
    }

    /* ---------------- الموردون والمشتريات — F-06 ---------------- */
    if (route === 'GET /api/suppliers') {
      auth(u);
      return sendJSON(res, 200, {
        suppliers: d.suppliers.map((s) => ({
          ...s,
          purchasesCount: d.purchases.filter((x) => x.supplierId === s.id).length,
          due: money(d.purchases.filter((x) => x.supplierId === s.id)
            .reduce((a, x) => a + (x.paid ? 0 : x.total), 0)),
        })),
      }), true;
    }
    if (route === 'POST /api/suppliers') {
      managerOnly(u);
      const b = await readBody(req);
      if (!b.name) return sendError(res, 400, 'اسم المورد مطلوب'), true;
      const s = { id: crypto.randomUUID(), name: b.name, phone: b.phone || '', note: b.note || '', at: now() };
      d.suppliers.push(s);
      audit(u, 'supplier.created', `مورد ${s.name}`, { supplierId: s.id });
      save();
      return sendJSON(res, 201, { supplier: s }), true;
    }
    if (route === 'GET /api/purchases') {
      auth(u);
      return sendJSON(res, 200, { purchases: d.purchases.slice(-100).reverse() }), true;
    }
    if (route === 'POST /api/purchases') {
      managerOnly(u);
      const b = await readBody(req);
      const supplier = d.suppliers.find((x) => x.id === b.supplierId);
      if (!supplier) return sendError(res, 404, 'المورد مش موجود'), true;
      const lines = [];
      for (const it of b.items || []) {
        const prod = d.products.find((x) => x.id === it.productId);
        if (!prod) return sendError(res, 400, 'صنف غير موجود'), true;
        const qty = Math.max(1, Number(it.qty) || 1);
        const cost = Math.max(0, Number(it.cost) || 0);
        // متوسط التكلفة المرجح — F-05/F-06
        const before = prod.stock * prod.cost;
        const after = qty * cost;
        const newStock = prod.stock + qty;
        prod.cost = newStock > 0 ? money((before + after) / newStock) : cost;
        prod.stock = newStock;
        stockMove(d, prod, qty, 'purchase', { ref: supplier.name }, u);
        lines.push({ productId: prod.id, name: prod.name, qty, cost });
      }
      if (!lines.length) return sendError(res, 400, 'مفيش أصناف'), true;
      const total = money(lines.reduce((a, l) => a + l.qty * l.cost, 0));
      const purchase = {
        id: crypto.randomUUID(), at: now(), supplierId: supplier.id, supplierName: supplier.name,
        items: lines, total, paid: Boolean(b.paid),
      };
      d.purchases.push(purchase);
      audit(u, 'purchase.created', `توريد من ${supplier.name} بقيمة ${total}`, { purchaseId: purchase.id });
      save();
      return sendJSON(res, 201, { purchase }), true;
    }

    /* ---------------- المخزون — F-05 ---------------- */
    if (route === 'GET /api/stock/movements') {
      auth(u);
      const pid = q.get('productId');
      const limit = Math.min(500, Number(q.get('limit')) || 100);
      const list = d.stockMovements
        .filter((m) => !pid || m.productId === pid)
        .slice(-limit).reverse();
      return sendJSON(res, 200, { movements: list }), true;
    }
    if (route === 'POST /api/stock/adjust') {
      managerOnly(u);
      const b = await readBody(req);
      const prod = d.products.find((x) => x.id === b.productId);
      if (!prod) return sendError(res, 404, 'الصنف مش موجود'), true;
      const qty = Number(b.qty) || 0;
      if (!qty) return sendError(res, 400, 'الكمية مطلوبة'), true;
      if (prod.stock + qty < 0) return sendError(res, 409, 'المخزون ممنوع يبقى سالب'), true;
      if (!b.reason) return sendError(res, 400, 'سبب التسوية مطلوب'), true;
      prod.stock += qty;
      stockMove(d, prod, qty, 'adjust', { note: b.reason }, u);
      audit(u, 'stock.adjusted', `${prod.name}: ${qty > 0 ? '+' : ''}${qty} — ${b.reason}`, { productId: prod.id });
      save();
      return sendJSON(res, 201, { product: prod }), true;
    }
    if (route === 'GET /api/stock/low') {
      auth(u);
      const low = d.products.filter((x) => x.active !== false && x.stock <= (x.reorderLevel ?? d.settings.lowStockDefault));
      return sendJSON(res, 200, { low }), true;
    }

    /* ---------------- العملاء والآجل والولاء — F-07 ---------------- */
    if (route === 'GET /api/customers') {
      auth(u);
      return sendJSON(res, 200, { customers: d.customers }), true;
    }
    if (route === 'POST /api/customers') {
      auth(u);
      const b = await readBody(req);
      if (!b.name || !b.phone) return sendError(res, 400, 'الاسم والموبايل مطلوبين'), true;
      if (d.customers.some((c) => c.phone === b.phone)) return sendError(res, 409, 'الموبايل مستخدم'), true;
      const c = {
        id: crypto.randomUUID(), name: b.name, phone: b.phone,
        creditLimit: Math.max(0, Number(b.creditLimit) || 0),
        balance: 0, points: 0, active: true, at: now(),
      };
      d.customers.push(c);
      audit(u, 'customer.created', `عميل ${c.name}`, { customerId: c.id });
      save();
      return sendJSON(res, 201, { customer: c }), true;
    }
    if (route.startsWith('POST /api/customers/') && p.endsWith('/payments')) {
      managerOnly(u);
      const id = p.split('/')[3];
      const c = d.customers.find((x) => x.id === id);
      if (!c) return sendError(res, 404, 'العميل مش موجود'), true;
      const b = await readBody(req);
      const amount = money(Number(b.amount) || 0);
      if (amount <= 0) return sendError(res, 400, 'المبلغ مطلوب'), true;
      if (amount > (c.balance || 0)) return sendError(res, 400, 'المبلغ أكبر من الرصيد المستحق'), true;
      c.balance = money(c.balance - amount);
      const payment = { id: crypto.randomUUID(), at: now(), customerId: c.id, customerName: c.name, amount, userId: u.id };
      d.customerPayments.push(payment);
      if (b.method !== 'transfer') cashMove(d, { type: 'in', amount, reason: `سداد ${c.name}`, user: u, shiftId: (openShiftOf(d, 'pos') || {}).id, origin: 'payment' });
      audit(u, 'customer.paid', `${c.name} سدد ${amount}`, { customerId: c.id });
      save();
      return sendJSON(res, 201, { customer: c, payment }), true;
    }
    if (route === 'GET /api/customers/statement') {
      auth(u);
      const id = q.get('id');
      const c = d.customers.find((x) => x.id === id);
      if (!c) return sendError(res, 404, 'العميل مش موجود'), true;
      const rows = [
        ...d.sales.filter((s) => s.customerId === id).map((s) => ({ at: s.createdAt, kind: 'sale', amount: s.total, ref: `#${s.no}` })),
        ...d.sales.filter((s) => s.customerId === id).flatMap((s) => (s.refunds || []).map((r) => ({ at: r.at, kind: 'refund', amount: -r.amount, ref: `#${s.no}` }))),
        ...d.customerPayments.filter((x) => x.customerId === id).map((x) => ({ at: x.at, kind: 'payment', amount: -x.amount, ref: x.id.slice(0, 8) })),
      ].sort((a, b2) => new Date(a.at) - new Date(b2.at));
      return sendJSON(res, 200, { customer: c, rows }), true;
    }

    /* ---------------- أكواد الخصم — F-02 ---------------- */
    if (route === 'GET /api/coupons') {
      managerOnly(u);
      return sendJSON(res, 200, { coupons: d.coupons }), true;
    }
    if (route === 'POST /api/coupons') {
      managerOnly(u);
      const b = await readBody(req);
      const code = String(b.code || '').trim().toUpperCase();
      if (!code) return sendError(res, 400, 'الكود مطلوب'), true;
      if (d.coupons.some((c) => c.code === code)) return sendError(res, 409, 'الكود موجود'), true;
      const c = {
        code, type: b.type === 'amount' ? 'amount' : 'percent',
        value: Math.max(0, Number(b.value) || 0),
        active: true, expiresAt: b.expiresAt || null,
        minSubtotal: Math.max(0, Number(b.minSubtotal) || 0), used: 0,
      };
      d.coupons.push(c);
      audit(u, 'coupon.created', `كود ${code}`, { code });
      save();
      return sendJSON(res, 201, { coupon: c }), true;
    }
    if (route.startsWith('DELETE /api/coupons/')) {
      managerOnly(u);
      const code = decodeURIComponent(p.split('/').pop()).toUpperCase();
      const c = d.coupons.find((x) => x.code === code);
      if (!c) return sendError(res, 404, 'الكود مش موجود'), true;
      c.active = false;               // إبطال، لا حذف
      audit(u, 'coupon.disabled', `إبطال كود ${code}`, { code });
      save();
      return sendJSON(res, 200, { coupon: c }), true;
    }

    /* ---------------- حركات الدرج — F-08 ---------------- */
    if (route === 'GET /api/cash-movements') {
      auth(u);
      const shift = openShiftOf(d, 'pos');
      const list = d.cashMovements.filter((m) => !q.get('shiftId') || m.shiftId === q.get('shiftId')).slice(-200).reverse();
      return sendJSON(res, 200, { movements: list, openShiftId: shift ? shift.id : null }), true;
    }
    if (route === 'POST /api/cash-movements') {
      auth(u);
      const b = await readBody(req);
      const amount = money(Number(b.amount) || 0);
      if (amount <= 0) return sendError(res, 400, 'المبلغ مطلوب'), true;
      if (!b.reason) return sendError(res, 400, 'السبب مطلوب'), true;
      const type = b.type === 'out' ? 'out' : 'in';
      // الكاشير يطلب، والمدير يعتمد — F-08 · D-B
      const needsApproval = !isManager;
      const shift = openShiftOf(d, 'pos');
      const m = {
        id: crypto.randomUUID(), at: now(), type, amount, reason: b.reason, origin: 'manual',
        status: needsApproval ? 'pending' : 'approved',
        shiftId: shift ? shift.id : null,
        userId: u.id, userName: u.name, approvedBy: needsApproval ? null : u.id,
      };
      d.cashMovements.push(m);
      audit(u, 'cash.movement', `${type === 'in' ? 'إيداع' : 'سحب'} ${amount} — ${b.reason} (${m.status})`, { id: m.id });
      save();
      return sendJSON(res, 201, { movement: m }), true;
    }
    if (route.startsWith('POST /api/cash-movements/') && p.endsWith('/approve')) {
      managerOnly(u);
      const id = p.split('/')[3];
      const m = d.cashMovements.find((x) => x.id === id);
      if (!m) return sendError(res, 404, 'الحركة مش موجودة'), true;
      m.status = 'approved'; m.approvedBy = u.id; m.approvedAt = now();
      audit(u, 'cash.approved', `اعتماد حركة ${m.amount}`, { id });
      save();
      return sendJSON(res, 200, { movement: m }), true;
    }

    /* ---------------- تنبيهات — F-13 ---------------- */
    if (route === 'GET /api/alerts') {
      auth(u);
      const alerts = computeAlerts(d).filter((a) => !(d.alertsSeen || []).includes(a.id));
      return sendJSON(res, 200, { alerts, count: alerts.length }), true;
    }
    if (route === 'POST /api/alerts/seen') {
      auth(u);
      const b = await readBody(req);
      d.alertsSeen = Array.from(new Set([...(d.alertsSeen || []), ...(b.ids || [])]));
      save();
      return sendJSON(res, 200, { ok: true }), true;
    }

    /* ---------------- تصدير CSV — F-09 ---------------- */
    if (route === 'GET /api/export/sales.csv' || route === 'GET /api/export/returns.csv'
      || route === 'GET /api/export/shifts.csv' || route === 'GET /api/export/stock.csv') {
      managerOnly(u);
      let body;
      let name;
      if (p.endsWith('sales.csv')) {
        name = 'sales';
        body = csv(d.sales, [
          { label: 'no', get: (s) => s.no },
          { label: 'createdAt', get: (s) => s.createdAt },
          { label: 'cashier', get: (s) => (d.users.find((x) => x.id === s.userId) || {}).name },
          { label: 'method', get: (s) => s.method },
          { label: 'subtotal', get: (s) => s.subtotal },
          { label: 'discount', get: (s) => s.discount },
          { label: 'tax', get: (s) => s.tax || 0 },
          { label: 'total', get: (s) => s.total },
          { label: 'status', get: (s) => s.status },
          { label: 'refunded', get: (s) => (s.refunds || []).reduce((a, r) => a + r.amount, 0) },
        ]);
      } else if (p.endsWith('returns.csv')) {
        name = 'returns';
        const rows = d.sales.flatMap((s) => (s.refunds || []).map((r) => ({ no: s.no, ...r })));
        body = csv(rows, [
          { label: 'invoice', get: (r) => r.no },
          { label: 'at', get: (r) => r.at },
          { label: 'amount', get: (r) => r.amount },
          { label: 'method', get: (r) => r.method },
        ]);
      } else if (p.endsWith('shifts.csv')) {
        name = 'shifts';
        body = csv(d.shifts, [
          { label: 'id', get: (s) => s.id },
          { label: 'openedAt', get: (s) => s.openedAt },
          { label: 'closedAt', get: (s) => s.closedAt },
          { label: 'startingCash', get: (s) => s.startingCash },
          { label: 'expectedCash', get: (s) => s.expectedCash },
          { label: 'countedCash', get: (s) => s.countedCash },
          { label: 'diff', get: (s) => s.diff },
        ]);
      } else {
        name = 'stock';
        body = csv(d.products, [
          { label: 'name', get: (x) => x.name },
          { label: 'barcode', get: (x) => x.barcode },
          { label: 'stock', get: (x) => x.stock },
          { label: 'reorderLevel', get: (x) => x.reorderLevel },
          { label: 'cost', get: (x) => x.cost },
          { label: 'price', get: (x) => x.price },
        ]);
      }
      const header = { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` };
      const h = ctx.rawHeaders ? ctx.rawHeaders(res, 200, header) : null;
      if (h) { res.end(body); return true; }
      res.writeHead(200, header);
      res.end(body);
      return true;
    }

    /* ---------------- نسخ احتياطي واستعادة — F-14 ---------------- */
    if (route === 'GET /api/backup') {
      managerOnly(u);
      const payload = JSON.stringify({ at: now(), version: 1, data: d });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="nilesys-backup.json"',
      });
      res.end(payload);
      return true;
    }
    if (route === 'POST /api/restore') {
      managerOnly(u);
      const b = await readBody(req);
      if (b.confirm !== 'RESTORE') return sendError(res, 400, 'اكتب RESTORE للتأكيد'), true;
      if (!b.data || !Array.isArray(b.data.products) || !Array.isArray(b.data.users)) {
        return sendError(res, 400, 'ملف غير صالح'), true;
      }
      ctx.restore(b.data);
      audit(u, 'data.restored', 'استعادة نسخة احتياطية', { at: b.at || null });
      save();
      return sendJSON(res, 200, { ok: true, products: b.data.products.length }), true;
    }

    /* ---------------- الفواتير (بحث/طباعة) — F-01 · F-03 ---------------- */
    if (route === 'GET /api/invoice') {
      auth(u);
      const id = q.get('id') || q.get('saleId');
      const s = d.sales.find((x) => x.id === id);
      if (!s) return sendError(res, 404, 'الفاتورة مش موجودة'), true;
      return sendJSON(res, 200, {
        sale: s,
        tax: {
          legalName: d.settings.legalName,
          taxNumber: d.settings.taxNumber,
          commercialRegister: d.settings.commercialRegister,
          address: d.settings.address,
          prefix: d.settings.invoicePrefix,
          number: `${d.settings.invoicePrefix}-${String(s.no).padStart(6, '0')}`,
        },
        store: d.branding,
      }), true;
    }

    /* ---------------- دفع جزئي — F-12 ---------------- */
    if (route.startsWith('POST /api/sales/') && p.endsWith('/payments')) {
      auth(u);
      const id = p.split('/')[3];
      const s = d.sales.find((x) => x.id === id);
      if (!s) return sendError(res, 404, 'الفاتورة مش موجودة'), true;
      const b = await readBody(req);
      const amount = money(Number(b.amount) || 0);
      if (amount <= 0) return sendError(res, 400, 'المبلغ مطلوب'), true;
      const due = money(s.total - (s.payments || []).reduce((a, x) => a + x.amount, 0));
      if (amount > due + 0.001) return sendError(res, 400, `المبلغ أكبر من المتبقي (${due})`), true;
      const method = ['cash', 'card', 'wallet', 'transfer'].includes(b.method) ? b.method : 'cash';
      s.payments = [...(s.payments || []), { id: crypto.randomUUID(), at: now(), amount, method, userId: u.id }];
      const paidSum = money(s.payments.reduce((a, x) => a + x.amount, 0));
      s.paymentStatus = paidSum >= s.total - 0.001 ? 'paid' : 'partial';
      if (method === 'cash') cashMove(d, { type: 'in', amount, reason: `دفعة على #${s.no}`, user: u, shiftId: (openShiftOf(d, 'pos') || {}).id, origin: 'sale' });
      audit(u, 'sale.payment', `دفعة ${amount} على #${s.no} (${s.paymentStatus})`, { saleId: s.id });
      save();
      return sendJSON(res, 201, { sale: s }), true;
    }

    /* ---------------- سجل الأنظمة والمواقع — F-16 · F-17 ----------------
       حقيقة لا وعد: كل نظام له حالته الفعلية. لا نعرض «قادم قريباً» على
       شيء يعمل، ولا ندّعي أن نظاماً بُني وهو مجرد سجل. */
    if (route === 'GET /api/systems') {
      const systems = [
        { key: 'pos', name: 'الكاشير', path: '/systems/pos.html', status: 'live', note: 'بيع · مرتجعات · ورديات · تقارير · ضريبة' },
        { key: 'inventory', name: 'المخازن', path: '/systems/inventory.html', status: 'live', note: 'نظام مستقل: أصناف · حركات · توريد · جرد' },
        { key: 'restaurant', name: 'المطعم', path: '/systems/restaurant.html', status: 'planned', note: 'ترابيزات وشاشة مطبخ' },
        { key: 'clinic', name: 'العيادة', path: '/systems/clinic.html', status: 'planned', note: 'مواعيد وروشتات' },
        { key: 'hr', name: 'الموارد البشرية', path: '/systems/hr.html', status: 'planned', note: 'حضور ومرتبات' },
        { key: 'booking', name: 'حجز الملاعب', path: '/systems/booking.html', status: 'planned', note: 'ملاعب ومواعيد' },
        { key: 'sites', name: 'لوحة المواقع', path: '/systems/sites.html', status: 'planned', note: 'المواقع السبعة' },
      ];
      return sendJSON(res, 200, { systems }), true;
    }
    if (route === 'GET /api/sites') {
      const sites = ['مطعم', 'عيادة', 'عقارات', 'جيم', 'موبايلات', 'ملابس', 'ملاعب'].map((n, i) => ({
        key: `site-${i + 1}`, name: n, status: 'planned', template: n,
      }));
      return sendJSON(res, 200, { sites }), true;
    }

    return false;
  }

  return {
    handle,
    seedDefaults,
    priceSale,
    afterSale,
    afterRefund,
    hashPassword,
    verifyPassword,
    computeAlerts,
    stockMove,
    cashMove,
  };
};
