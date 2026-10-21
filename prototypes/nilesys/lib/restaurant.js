/* ===== نظام المطعم — محرك مستقل =====
 *
 * الشكل: ترابيزات · منيو · طلبات · تذاكر مطبخ · حجوزات · وردية ودرج.
 * لا يبيع من كتالوج الكاشير: المنيو أقسام ومحطات تحضير، والصنف قد يكون
 * مشروباً في البار لا طبقاً في المطبخ.
 *
 * كل قاعدة هنا مكتوبة في docs/product/systems/restaurant.md ولها اختبار في
 * tests/restaurant.test.js. الاثنان يُغيَّران معاً أو لا يُغيَّر أيٌّ منهما.
 */
'use strict';

const crypto = require('crypto');

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const now = () => new Date().toISOString();

const TABLE_STATES = ['free', 'seated', 'reserved', 'dirty'];
const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'];
const PAY_METHODS = ['cash', 'card', 'wallet', 'transfer'];

module.exports = function createRestaurant(ctx) {
  const { getDb, save, audit, sendJSON, sendError, readBody } = ctx;

  /* ---------------- البذور ---------------- */
  function seedDefaults(d) {
    let changed = false;
    const ensure = (k, v) => { if (d[k] === undefined) { d[k] = v; changed = true; } };

    ensure('restTables', []);
    ensure('restMenu', []);
    ensure('restOrders', []);
    ensure('restReservations', []);
    ensure('restSeq', { order: 1000 });

    if (d.restTables.length === 0) {
      const tables = [
        ['ت1', 2, 'صالة'], ['ت2', 2, 'صالة'], ['ت3', 4, 'صالة'], ['ت4', 4, 'صالة'],
        ['ت5', 6, 'صالة'], ['ت6', 6, 'عائلات'], ['ت7', 8, 'عائلات'], ['بار1', 3, 'بار'],
      ];
      d.restTables = tables.map(([name, seats, area]) => ({
        id: crypto.randomUUID(), name, seats, area, status: 'free',
        currentOrderId: null, seatedAt: null, active: true,
      }));
      changed = true;
    }

    if (d.restMenu.length === 0) {
      // [الاسم, القسم, السعر, التكلفة, المحطة, دقائق التحضير]
      const menu = [
        ['شوربة عدس', 'مقبلات', 35, 12, 'kitchen', 8],
        ['سلطة بلدي', 'مقبلات', 40, 14, 'kitchen', 6],
        ['طاجن بطاطس', 'مقبلات', 45, 16, 'kitchen', 12],
        ['كفتة مشوية', 'مشويات', 120, 55, 'kitchen', 18],
        ['فراخ مشوية', 'مشويات', 130, 60, 'kitchen', 20],
        ['ريش ضاني', 'مشويات', 220, 110, 'kitchen', 25],
        ['سمك بلطي', 'أسماك', 160, 75, 'kitchen', 22],
        ['أرز بالشعرية', 'إضافات', 25, 8, 'kitchen', 5],
        ['عيش بلدي', 'إضافات', 10, 3, 'kitchen', 2],
        ['كولا', 'مشروبات', 20, 8, 'bar', 1],
        ['عصير مانجو', 'مشروبات', 35, 15, 'bar', 3],
        ['شاي', 'مشروبات', 15, 3, 'bar', 2],
      ];
      d.restMenu = menu.map(([name, category, price, cost, station, prepMinutes]) => ({
        id: crypto.randomUUID(), name, category, price, cost, station, prepMinutes,
        available: true, system: 'restaurant',
      }));
      changed = true;
    }
    return changed;
  }

  /* ---------------- أدوات ---------------- */
  const isRestaurantUser = (u) => u && u.system === 'restaurant';
  const isManager = (u) => isRestaurantUser(u) && u.role === 'manager';
  const isKitchen = (u) => isRestaurantUser(u) && u.role === 'kitchen';

  function guard(u, res, opts = {}) {
    if (!isRestaurantUser(u)) {
      sendError(res, 403, 'غير مسموح: مسارات المطعم لمستخدمي نظام المطعم فقط');
      return true;
    }
    if (opts.manager && !isManager(u)) {
      sendError(res, 403, 'للمدير بس');
      return true;
    }
    if (opts.noKitchen && isKitchen(u)) {
      sendError(res, 403, 'الشيف مش بيعدّل الفواتير');
      return true;
    }
    return false;
  }

  function openShiftOf(d) {
    return (d.shifts || []).find((s) => s.system === 'restaurant' && !s.closedAt) || null;
  }

  function cashMove(d, { type, amount, reason, user, shiftId, origin }) {
    d.cashMovements = d.cashMovements || [];
    const m = {
      id: crypto.randomUUID(), at: now(), type, amount: money(amount), reason,
      origin: origin || 'restaurant', status: 'approved',
      shiftId: shiftId || null, userId: user ? user.id : null, userName: user ? user.name : '—',
    };
    d.cashMovements.push(m);
    return m;
  }

  function orderTotals(order) {
    const lines = (order.items || []).filter((i) => i.state !== 'void');
    const subtotal = money(lines.reduce((a, i) => a + i.price * i.qty, 0));
    const discount = money(Math.min(Number(order.discount) || 0, subtotal));
    return { subtotal, discount, total: money(subtotal - discount) };
  }

  function tableOf(d, id) { return (d.restTables || []).find((t) => t.id === id); }
  function orderOf(d, id) { return (d.restOrders || []).find((o) => o.id === id); }

  function buildLine(d, it) {
    const m = (d.restMenu || []).find((x) => x.id === it.menuItemId);
    if (!m) { const e = new Error('صنف غير موجود في المنيو'); e.status = 400; throw e; }
    if (m.available === false) { const e = new Error(`«${m.name}» غير متوفر حالياً`); e.status = 400; throw e; }
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    return {
      id: crypto.randomUUID(), menuItemId: m.id, name: m.name, qty,
      price: money(m.price), cost: money(m.cost), notes: String(it.notes || '').slice(0, 200),
      station: m.station, state: 'new', sentAt: null, readyAt: null, voidReason: null,
    };
  }

  /* ---------------- المعالج ---------------- */
  async function handle(req, res, url, rc) {
    const { route } = rc;
    const u = rc.user;
    if (!route.startsWith('GET /api/restaurant') && !route.startsWith('POST /api/restaurant')
      && !route.startsWith('PUT /api/restaurant') && !route.startsWith('PATCH /api/restaurant')) return false;

    const d = getDb();
    seedDefaults(d);
    const p = url.pathname;
    const q = url.searchParams;
    const parts = p.split('/').filter(Boolean); // ['api','restaurant',...]

    /* -------- الصالة والترابيزات -------- */
    if (route === 'GET /api/restaurant/tables') {
      if (guard(u, res)) return true;
      const tables = (d.restTables || []).filter((t) => t.active !== false).map((t) => {
        const o = t.currentOrderId ? orderOf(d, t.currentOrderId) : null;
        return { ...t, order: o ? { id: o.id, no: o.no, total: orderTotals(o).total, openedAt: o.openedAt, items: (o.items || []).filter((i) => i.state !== 'void').length } : null };
      });
      return sendJSON(res, 200, { tables }), true;
    }
    if (route === 'POST /api/restaurant/tables') {
      if (guard(u, res, { manager: true })) return true;
      const b = await readBody(req);
      if (!b.name) return sendError(res, 400, 'اسم الترابيزة مطلوب'), true;
      if ((d.restTables || []).some((t) => t.name === b.name && t.active !== false)) {
        return sendError(res, 409, 'الاسم مستخدم'), true;
      }
      const t = {
        id: crypto.randomUUID(), name: b.name, seats: Math.max(1, Number(b.seats) || 2),
        area: b.area || 'صالة', status: 'free', currentOrderId: null, seatedAt: null, active: true,
      };
      d.restTables.push(t);
      audit(u, 'restaurant.table.created', `ترابيزة ${t.name}`, { tableId: t.id });
      save();
      return sendJSON(res, 201, { table: t }), true;
    }
    if (route.startsWith('POST /api/restaurant/tables/') && p.endsWith('/status')) {
      if (guard(u, res)) return true;
      const id = parts[3];
      const t = tableOf(d, id);
      if (!t) return sendError(res, 404, 'الترابيزة مش موجودة'), true;
      const b = await readBody(req);
      if (!TABLE_STATES.includes(b.status)) return sendError(res, 400, 'حالة غير معروفة'), true;
      if (b.status === 'free' && t.currentOrderId) {
        return sendError(res, 409, 'فيه طلب مفتوح على الترابيزة'), true;
      }
      if (b.status === 'seated' && t.currentOrderId) {
        return sendError(res, 409, 'الترابيزة مشغولة بطلب مفتوح'), true;
      }
      t.status = b.status;
      if (b.status === 'free') { t.seatedAt = null; }
      save();
      return sendJSON(res, 200, { table: t }), true;
    }

    /* -------- المنيو -------- */
    if (route === 'GET /api/restaurant/menu') {
      if (guard(u, res)) return true;
      return sendJSON(res, 200, { menu: d.restMenu }), true;
    }
    if (route === 'POST /api/restaurant/menu') {
      if (guard(u, res, { manager: true })) return true;
      const b = await readBody(req);
      if (!b.name || !(Number(b.price) > 0)) return sendError(res, 400, 'الاسم والسعر مطلوبين'), true;
      const item = {
        id: crypto.randomUUID(), name: b.name, category: b.category || 'متنوع',
        price: money(b.price), cost: money(b.cost || 0),
        station: b.station === 'bar' ? 'bar' : 'kitchen',
        prepMinutes: Math.max(1, Number(b.prepMinutes) || 10),
        available: b.available !== false, system: 'restaurant',
      };
      d.restMenu.push(item);
      audit(u, 'restaurant.menu.created', `صنف ${item.name}`, { menuId: item.id });
      save();
      return sendJSON(res, 201, { item }), true;
    }
    if (route.startsWith('PUT /api/restaurant/menu/')) {
      if (guard(u, res, { manager: true })) return true;
      const id = parts[3];
      const item = d.restMenu.find((x) => x.id === id);
      if (!item) return sendError(res, 404, 'الصنف مش موجود'), true;
      const b = await readBody(req);
      if (b.name !== undefined) item.name = String(b.name).slice(0, 80);
      if (b.price !== undefined) item.price = money(b.price);
      if (b.cost !== undefined) item.cost = money(b.cost);
      if (b.category !== undefined) item.category = String(b.category).slice(0, 40);
      if (b.station !== undefined) item.station = b.station === 'bar' ? 'bar' : 'kitchen';
      if (b.available !== undefined) item.available = Boolean(b.available);
      audit(u, 'restaurant.menu.updated', `تعديل ${item.name}`, { menuId: item.id });
      save();
      return sendJSON(res, 200, { item }), true;
    }

    /* -------- الطلبات -------- */
    if (route === 'GET /api/restaurant/orders') {
      if (guard(u, res)) return true;
      const status = q.get('status');
      const tableId = q.get('tableId');
      const list = (d.restOrders || [])
        .filter((o) => (!status || o.status === status) && (!tableId || o.tableId === tableId))
        .slice(-100).reverse()
        .map((o) => ({ ...o, totals: orderTotals(o) }));
      return sendJSON(res, 200, { orders: list }), true;
    }
    if (route.startsWith('GET /api/restaurant/orders/')) {
      if (guard(u, res)) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      return sendJSON(res, 200, { order: { ...o, totals: orderTotals(o) } }), true;
    }
    if (route === 'POST /api/restaurant/orders') {
      if (guard(u, res, { noKitchen: true })) return true;
      const b = await readBody(req);
      const type = ORDER_TYPES.includes(b.type) ? b.type : 'dine_in';
      let table = null;
      if (type === 'dine_in') {
        table = tableOf(d, b.tableId);
        if (!table) return sendError(res, 404, 'الترابيزة مش موجودة'), true;
        if (table.currentOrderId) return sendError(res, 409, 'الترابيزة عليها طلب مفتوح'), true;
      }
      const lines = (b.items || []).map((it) => buildLine(d, it));
      d.restSeq.order = (d.restSeq.order || 1000) + 1;
      const order = {
        id: crypto.randomUUID(), no: d.restSeq.order, type, tableId: table ? table.id : null,
        items: lines, status: 'open', discount: 0, openedAt: now(), closedAt: null,
        openedBy: u.id, payments: [],
      };
      d.restOrders.push(order);
      if (table) {
        table.status = 'seated';
        table.currentOrderId = order.id;
        table.seatedAt = order.openedAt;
      }
      audit(u, 'restaurant.order.opened', `طلب #${order.no} (${type})`, { orderId: order.id });
      save();
      return sendJSON(res, 201, { order: { ...order, totals: orderTotals(order) } }), true;
    }
    if (route.startsWith('POST /api/restaurant/orders/') && p.endsWith('/items')) {
      if (guard(u, res, { noKitchen: true })) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      if (o.status !== 'open') return sendError(res, 409, 'الطلب مقفول'), true;
      const b = await readBody(req);
      for (const it of b.items || []) o.items.push(buildLine(d, it));
      audit(u, 'restaurant.order.items', `إضافة أصناف على #${o.no}`, { orderId: o.id });
      save();
      return sendJSON(res, 201, { order: { ...o, totals: orderTotals(o) } }), true;
    }
    if (route.startsWith('POST /api/restaurant/orders/') && p.endsWith('/send')) {
      if (guard(u, res, { noKitchen: true })) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      // الإرسال مرة واحدة: الأصناف المُرسلة لا تُرسل ثانياً، فلا تتضاعف التذاكر.
      const fresh = o.items.filter((i) => !i.sentAt && i.state !== 'void');
      for (const i of fresh) i.sentAt = now();
      o.sentAt = o.sentAt || now();
      if (fresh.length) audit(u, 'restaurant.order.sent', `إرسال ${fresh.length} صنف للمطبخ #${o.no}`, { orderId: o.id });
      save();
      return sendJSON(res, 200, {
        sent: fresh.length, resent: fresh.length === 0,
        order: { ...o, totals: orderTotals(o) },
      }), true;
    }
    if (route.startsWith('PATCH /api/restaurant/orders/') && parts[4] === 'items') {
      if (guard(u, res)) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      const line = o.items.find((i) => i.id === parts[5]);
      if (!line) return sendError(res, 404, 'السطر مش موجود'), true;
      const b = await readBody(req);
      // تعديل الكمية: مسموح قبل الإرسال فقط. بعد ما المطبخ بدأ، الكمية بقت
      // التزاماً على النار — تتغير بإلغاء من المدير أو بطلب إضافي.
      if (b.qty !== undefined) {
        if (line.sentAt) {
          return sendError(res, 409, 'الصنف اتبعت للمطبخ — الكمية ثابتة'), true;
        }
        const q = Math.floor(Number(b.qty));
        if (!Number.isFinite(q) || q < 0 || q > 99) return sendError(res, 400, 'كمية غير صالحة'), true;
        if (q === 0) {
          o.items = o.items.filter((i) => i.id !== line.id);
          audit(u, 'restaurant.line.removed', `#${o.no} شال ${line.name}`, { orderId: o.id });
        } else {
          line.qty = q;
          audit(u, 'restaurant.line.qty', `#${o.no} ${line.name} ×${q}`, { orderId: o.id, lineId: line.id });
        }
        save();
        return sendJSON(res, 200, { order: { ...o, totals: orderTotals(o) } }), true;
      }
      const next = String(b.state || '');
      if (!['cooking', 'ready', 'served', 'void'].includes(next)) return sendError(res, 400, 'حالة غير معروفة'), true;
      // الكاشير/الشيف يحرّك التحضير؛ الشيف لا يلغي (الإلغاء مال ومسؤولية).
      if (next === 'void') {
        if (!isManager(u)) {
          return sendError(res, 403, next === 'void' && ['cooking', 'ready'].includes(line.state)
            ? 'إلغاء صنف بعد بدء التحضير يحتاج مدير'
            : 'إلغاء صنف يحتاج مدير'), true;
        }
        if (!b.reason) return sendError(res, 400, 'سبب الإلغاء مطلوب'), true;
        line.voidReason = b.reason;
        line.voidBy = u.id;
      }
      if (next === 'ready') line.readyAt = now();
      line.state = next;
      audit(u, 'restaurant.line.state', `#${o.no} ${line.name}: ${next}`, { orderId: o.id, lineId: line.id });
      save();
      return sendJSON(res, 200, { order: { ...o, totals: orderTotals(o) } }), true;
    }
    if (route.startsWith('POST /api/restaurant/orders/') && p.endsWith('/pay')) {
      if (guard(u, res, { noKitchen: true })) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      if (o.status === 'paid') return sendError(res, 400, 'الطلب مدفوع بالفعل'), true;
      if (o.status === 'void') return sendError(res, 409, 'الطلب ملغي'), true;
      const unsent = o.items.filter((i) => !i.sentAt && i.state !== 'void');
      if (unsent.length) return sendError(res, 400, `فيه ${unsent.length} صنف لم يُرسل للمطبخ`), true;

      const b = await readBody(req);
      const method = PAY_METHODS.includes(b.method) ? b.method : 'cash';
      if (b.discount !== undefined) {
        if (!isManager(u)) return sendError(res, 403, 'الخصم للمدير'), true;
        o.discount = money(b.discount);
      }
      const tot = orderTotals(o);
      const paid = method === 'cash' ? money(b.paid === undefined ? tot.total : b.paid) : tot.total;
      if (method === 'cash' && paid < tot.total - 0.001) {
        return sendError(res, 400, 'المبلغ المستلم أقل من الإجمالي'), true;
      }

      // التقسيم: أجزاء متساوية بقرش دقيق، والباقي على آخر جزء — لا يضيع قرش.
      let split = null;
      if (b.split && Number(b.split.count) > 1) {
        const n = Math.min(20, Math.floor(Number(b.split.count)));
        const base = Math.floor((tot.total * 100) / n) / 100;
        const parts = Array.from({ length: n }, () => money(base));
        const rest = money(tot.total - money(base * n));
        parts[n - 1] = money(parts[n - 1] + rest);
        split = { count: n, parts };
      }

      o.status = 'paid';
      o.closedAt = now();
      o.paidBy = u.id;
      o.payment = {
        id: crypto.randomUUID(), at: o.closedAt, method, paid,
        change: method === 'cash' ? money(paid - tot.total) : 0,
        total: tot.total, split,
      };
      o.payments.push(o.payment);

      const shift = openShiftOf(d);
      if (method === 'cash') {
        cashMove(d, { type: 'in', amount: tot.total, reason: `مطعم #${o.no}`, user: u, shiftId: shift ? shift.id : null, origin: 'restaurant' });
      }

      if (o.tableId) {
        const t = tableOf(d, o.tableId);
        if (t) { t.status = 'dirty'; t.currentOrderId = null; t.seatedAt = null; }
      }
      audit(u, 'restaurant.order.paid', `دفع #${o.no} ${tot.total} (${method})`, { orderId: o.id });
      save();
      return sendJSON(res, 200, { order: { ...o, totals: tot } }), true;
    }
    if (route.startsWith('POST /api/restaurant/orders/') && p.endsWith('/void')) {
      if (guard(u, res, { manager: true })) return true;
      const o = orderOf(d, parts[3]);
      if (!o) return sendError(res, 404, 'الطلب مش موجود'), true;
      if (o.status === 'paid') return sendError(res, 409, 'لا يُلغي طلب مدفوع'), true;
      const b = await readBody(req);
      if (!b.reason) return sendError(res, 400, 'سبب الإلغاء مطلوب'), true;
      o.status = 'void';
      o.voidReason = b.reason;
      o.closedAt = now();
      if (o.tableId) {
        const t = tableOf(d, o.tableId);
        if (t) { t.status = 'free'; t.currentOrderId = null; t.seatedAt = null; }
      }
      audit(u, 'restaurant.order.void', `إلغاء #${o.no}: ${b.reason}`, { orderId: o.id });
      save();
      return sendJSON(res, 200, { order: o }), true;
    }

    /* -------- شاشة المطبخ -------- */
    if (route === 'GET /api/restaurant/kitchen') {
      if (guard(u, res)) return true;
      // التذاكر مشتقّة من الأصناف المُرسلة ولم تُقدَّم بعد — لا جدول تذاكر منفصل
      // يمكن أن يختلف عن الطلب.
      const tickets = [];
      for (const o of d.restOrders || []) {
        if (!['open', 'served'].includes(o.status)) continue;
        const live = o.items.filter((i) => i.sentAt && ['new', 'cooking', 'ready'].includes(i.state));
        if (!live.length) continue;
        tickets.push({
          orderId: o.id, no: o.no, tableId: o.tableId, type: o.type,
          tableName: o.tableId ? (tableOf(d, o.tableId) || {}).name || '' : '',
          openedAt: o.openedAt, sentAt: live[0].sentAt,
          items: live.map((i) => ({ id: i.id, name: i.name, qty: i.qty, notes: i.notes, station: i.station, state: i.state, sentAt: i.sentAt })),
        });
      }
      tickets.sort((a, b2) => new Date(a.sentAt) - new Date(b2.sentAt));
      return sendJSON(res, 200, { tickets, count: tickets.length }), true;
    }

    /* -------- الحجوزات -------- */
    if (route === 'GET /api/restaurant/reservations') {
      if (guard(u, res)) return true;
      const day = q.get('date');
      const list = (d.restReservations || [])
        .filter((r) => !day || String(r.at).slice(0, 10) === day)
        .slice(-100);
      return sendJSON(res, 200, { reservations: list }), true;
    }
    if (route === 'POST /api/restaurant/reservations') {
      if (guard(u, res, { noKitchen: true })) return true;
      const b = await readBody(req);
      const t = tableOf(d, b.tableId);
      if (!t) return sendError(res, 404, 'الترابيزة مش موجودة'), true;
      if (!b.at || Number.isNaN(new Date(b.at).getTime())) return sendError(res, 400, 'الوقت غير صالح'), true;
      if (!b.name || !b.phone) return sendError(res, 400, 'الاسم والموبايل مطلوبين'), true;
      const at = new Date(b.at).getTime();
      const minutes = Math.max(30, Number(b.minutes) || 90);
      const clash = (d.restReservations || []).some((r) => {
        if (r.tableId !== t.id || r.status === 'cancelled') return false;
        const rt = new Date(r.at).getTime();
        return Math.abs(rt - at) < Math.max(minutes, r.minutes || 90) * 60 * 1000;
      });
      if (clash) return sendError(res, 409, 'فيه حجز متعارض على نفس الترابيزة'), true;
      const r = {
        id: crypto.randomUUID(), tableId: t.id, at: new Date(at).toISOString(),
        name: b.name, phone: String(b.phone), partySize: Math.max(1, Number(b.partySize) || 2),
        minutes, status: 'booked', createdAt: now(), by: u.id,
      };
      d.restReservations.push(r);
      audit(u, 'restaurant.reservation', `حجز ${r.name} على ${t.name}`, { reservationId: r.id });
      save();
      return sendJSON(res, 201, { reservation: r }), true;
    }
    if (route.startsWith('POST /api/restaurant/reservations/') && p.endsWith('/cancel')) {
      if (guard(u, res)) return true;
      const r = (d.restReservations || []).find((x) => x.id === parts[3]);
      if (!r) return sendError(res, 404, 'الحجز مش موجود'), true;
      r.status = 'cancelled';
      save();
      return sendJSON(res, 200, { reservation: r }), true;
    }

    /* -------- الوردية والدرج -------- */
    if (route === 'GET /api/restaurant/shift') {
      if (guard(u, res)) return true;
      const shift = openShiftOf(d);
      return sendJSON(res, 200, { openShift: shift }), true;
    }
    if (route === 'POST /api/restaurant/shift') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      if (b.action === 'open') {
        if (openShiftOf(d)) return sendError(res, 409, 'في وردية مفتوحة بالفعل'), true;
        const shift = {
          id: crypto.randomUUID(), system: 'restaurant', openedAt: now(),
          openingCash: money(b.openingCash || 0), openedBy: u.id, closedAt: null,
        };
        d.shifts = d.shifts || [];
        d.shifts.push(shift);
        save();
        return sendJSON(res, 201, { shift }), true;
      }
      if (b.action === 'close') {
        const shift = openShiftOf(d);
        if (!shift) return sendError(res, 404, 'مفيش وردية مفتوحة'), true;
        shift.closedAt = now();
        shift.countedCash = money(b.countedCash || 0);
        const expected = expectedCash(d, shift);
        shift.expectedCash = expected;
        shift.difference = money(shift.countedCash - expected);
        audit(u, 'restaurant.shift.closed', `إغلاق مطعم بفرق ${shift.difference}`, { shiftId: shift.id });
        save();
        return sendJSON(res, 200, { shift }), true;
      }
      return sendError(res, 400, 'action لازم يكون open أو close'), true;
    }

    /* -------- ملخص اليوم -------- */
    if (route === 'GET /api/restaurant/summary') {
      if (guard(u, res)) return true;
      const range = q.get('range') || 'today';
      const from = range === 'week' ? Date.now() - 7 * 864e5 : new Date().setHours(0, 0, 0, 0);
      const paid = (d.restOrders || []).filter((o) => o.status === 'paid' && new Date(o.closedAt || o.openedAt).getTime() >= from);
      const gross = money(paid.reduce((a, o) => a + orderTotals(o).total, 0));
      const byMethod = {};
      for (const o of paid) byMethod[o.payment.method] = money((byMethod[o.payment.method] || 0) + o.payment.total);
      const itemCount = {};
      for (const o of paid) for (const i of o.items) {
        if (i.state === 'void') continue;
        itemCount[i.name] = (itemCount[i.name] || 0) + i.qty;
      }
      const top = Object.entries(itemCount).sort((a, b2) => b2[1] - a[1]).slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));
      const served = (d.restOrders || []).filter((o) => o.closedAt && o.status === 'paid');
      const prepMinutes = served.map((o) => {
        const ready = o.items.filter((i) => i.readyAt).map((i) => new Date(i.readyAt).getTime());
        if (!ready.length) return null;
        return (Math.max(...ready) - new Date(o.sentAt || o.openedAt).getTime()) / 60000;
      }).filter((x) => x !== null);
      return sendJSON(res, 200, {
        range, orders: paid.length, gross,
        byMethod,
        avgTicket: paid.length ? money(gross / paid.length) : 0,
        topItems: top,
        avgPrepMinutes: prepMinutes.length
          ? Math.round(prepMinutes.reduce((a, x) => a + x, 0) / prepMinutes.length) : 0,
        tables: {
          total: (d.restTables || []).length,
          seated: (d.restTables || []).filter((t) => t.status === 'seated').length,
        },
        voided: (d.restOrders || []).filter((o) => o.status === 'void').length,
      }), true;
    }

    return false;
  }

  // المتوقع في الدرج: افتتاحي + كاش الطلبات المدفوعة داخل الوردية + الحركات المعتمدة.
  function expectedCash(d, shift) {
    const from = new Date(shift.openedAt).getTime();
    const until = shift.closedAt ? new Date(shift.closedAt).getTime() : Infinity;
    const within = (iso) => { const t = new Date(iso).getTime(); return t >= from && t <= until; };
    let cash = Number(shift.openingCash) || 0;
    for (const o of d.restOrders || []) {
      if (o.status !== 'paid' || !o.payment || o.payment.method !== 'cash') continue;
      if (!within(o.payment.at)) continue;
      cash += o.payment.total;
    }
    for (const m of d.cashMovements || []) {
      if (m.status !== 'approved' || m.origin === 'restaurant') continue; // حركات البيع محسوبة فوق
      if (m.shiftId && m.shiftId !== shift.id) continue;
      if (!within(m.at)) continue;
      cash += m.type === 'in' ? m.amount : -m.amount;
    }
    return money(cash);
  }

  return { handle, seedDefaults, expectedCash, orderTotals };
};
