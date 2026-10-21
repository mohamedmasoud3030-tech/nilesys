/* ===== Nile Systems — نظام حجز الملاعب =====
 *
 * تطبيق مستقل: مساراته /api/courts، وبياناته في مجموعاته court*. وظيفته أن
 * يجيب على سؤال واحد بسرعة: الملعب فاضي ولا محجوز في الساعة دي؟
 *
 * القواعد الحاكمة: لا تقاطعات، السعر يُحسب في الخادم لا في المتصفح، والعربون
 * يُرد بحركة درج حقيقية لو الإلغاء جاء في الوقت المسموح.
 */
const crypto = require('crypto');

module.exports = function createCourts(ctx) {
  const { getDb, save, audit, sendJSON, sendError, readBody } = ctx;

  const now = () => new Date().toISOString();
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const HOLD_MINUTES = 60;      // الحجز غير المؤكد يسقط بعد ساعة
  const FREE_CANCEL_HOURS = 12; // إلغاء قبل 12 ساعة يرد العربون

  /* ---------------- البذور ---------------- */
  function seedDefaults(d) {
    let changed = false;
    const ensure = (k, v) => { if (d[k] === undefined) { d[k] = v; changed = true; } };

    ensure('courtsList', []);
    ensure('courtBookings', []);
    ensure('courtSeq', { booking: 1000 });

    if (d.courtsList.length === 0) {
      // [الاسم, النوع, سعر الساعة, من, إلى]
      const rows = [
        ['ملعب 1', 'football', 300, '14:00', '24:00'],
        ['ملعب 2', 'football', 300, '14:00', '24:00'],
        ['ملعب بادل 1', 'padel', 250, '10:00', '23:00'],
        ['ملعب بادل 2', 'padel', 220, '10:00', '23:00'],
      ];
      d.courtsList = rows.map(([name, kind, pricePerHour, openFrom, openTo]) => ({
        id: crypto.randomUUID(), name, kind, pricePerHour, openFrom, openTo, active: true, system: 'courts',
      }));
      changed = true;
    }
    return changed;
  }

  /* ---------------- أدوات ---------------- */
  const isCourtsUser = (u) => u && u.system === 'courts';
  const isManager = (u) => isCourtsUser(u) && u.role === 'manager';

  function guard(u, res, opts = {}) {
    if (!isCourtsUser(u)) {
      sendError(res, 403, 'غير مسموح: مسارات الملاعب لمستخدمي نظام الملاعب فقط');
      return true;
    }
    if (opts.manager && !isManager(u)) { sendError(res, 403, 'للمدير بس'); return true; }
    return false;
  }

  const courtOf = (d, id) => (d.courtsList || []).find((x) => x.id === id) || null;
  const bookingOf = (d, id) => (d.courtBookings || []).find((x) => x.id === id) || null;

  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const startMs = (date, from) => new Date(`${date}T${from}:00`).getTime();

  // حجز غير مؤكد يسقط بعد ساعة: الحالة المحسوبة هي المرجع في الجدول والتقارير.
  function effectiveStatus(b) {
    if (b.status !== 'held') return b.status;
    const created = new Date(b.createdAt).getTime();
    return Date.now() - created > HOLD_MINUTES * 60000 ? 'expired' : 'held';
  }

  function openShiftOf(d) {
    return (d.shifts || []).find((s) => s.system === 'courts' && !s.closedAt) || null;
  }

  function cashMove(d, { type, amount, reason, user, origin }) {
    d.cashMovements = d.cashMovements || [];
    const shift = openShiftOf(d);
    const m = {
      id: crypto.randomUUID(), at: now(), type, amount: money(amount), reason,
      origin: origin || 'courts', status: 'approved', shiftId: shift ? shift.id : null,
      userId: user ? user.id : null, userName: user ? user.name : '—',
    };
    d.cashMovements.push(m);
    return m;
  }

  function expectedCash(d, shift) {
    const from = new Date(shift.openedAt).getTime();
    const until = shift.closedAt ? new Date(shift.closedAt).getTime() : Infinity;
    const within = (iso) => { const t = new Date(iso).getTime(); return t >= from && t <= until; };
    let cash = Number(shift.openingCash) || 0;
    for (const m of d.cashMovements || []) {
      if (m.origin !== 'courts' || m.status !== 'approved') continue;
      if (!within(m.at)) continue;
      cash += m.type === 'in' ? m.amount : -m.amount;
    }
    return money(cash);
  }

  function eachSlot(court) {
    const slots = [];
    const from = toMinutes(court.openFrom);
    const to = toMinutes(court.openTo);
    for (let t = from; t < to; t += 60) {
      slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    }
    return slots;
  }

  /* ---------------- المعالج ---------------- */
  async function handle(req, res, url, rc) {
    const { route, user: u } = rc;
    if (!route.startsWith('GET /api/courts') && !route.startsWith('POST /api/courts')
      && !route.startsWith('PUT /api/courts') && !route.startsWith('PATCH /api/courts')) return false;
    const d = getDb();
    if (!d.courtsList) seedDefaults(d);
    const p = url.pathname;
    const parts = p.split('/').filter(Boolean); // ['api','courts',...]
    const q = url.searchParams;
    const today = () => new Date().toISOString().slice(0, 10);

    /* -------- الملاعب -------- */
    if (route === 'GET /api/courts') {
      if (guard(u, res)) return true;
      return sendJSON(res, 200, { courts: (d.courtsList || []).filter((x) => x.active !== false) }), true;
    }
    if (route === 'POST /api/courts') {
      if (guard(u, res, { manager: true })) return true;
      const b = await readBody(req);
      if (!b.name) return sendError(res, 400, 'اسم الملعب مطلوب'), true;
      const court = {
        id: crypto.randomUUID(), name: String(b.name).slice(0, 60),
        kind: b.kind === 'padel' ? 'padel' : 'football',
        pricePerHour: money(b.pricePerHour || 0),
        openFrom: /^\d{2}:\d{2}$/.test(b.openFrom) ? b.openFrom : '14:00',
        openTo: /^\d{2}:\d{2}$/.test(b.openTo) ? b.openTo : '24:00',
        active: true, system: 'courts',
      };
      if (toMinutes(court.openTo) <= toMinutes(court.openFrom)) {
        return sendError(res, 400, 'مواعيد العمل غير صالحة'), true;
      }
      d.courtsList.push(court);
      audit(u, 'courts.created', `ملعب ${court.name}`, { courtId: court.id });
      save();
      return sendJSON(res, 201, { court }), true;
    }
    if (route.startsWith('PUT /api/courts/')) {
      if (guard(u, res, { manager: true })) return true;
      // /api/courts/<id> → ['api','courts',id] (بخلاف /api/courts/bookings/<id>).
      const court = courtOf(d, parts[2]);
      if (!court) return sendError(res, 404, 'الملعب مش موجود'), true;
      const b = await readBody(req);
      if (b.name !== undefined) court.name = String(b.name).slice(0, 60);
      if (b.kind !== undefined) court.kind = b.kind === 'padel' ? 'padel' : 'football';
      if (b.pricePerHour !== undefined) court.pricePerHour = money(b.pricePerHour);
      if (b.openFrom !== undefined) court.openFrom = b.openFrom;
      if (b.openTo !== undefined) court.openTo = b.openTo;
      if (b.active !== undefined) court.active = Boolean(b.active);
      audit(u, 'courts.updated', `تعديل ${court.name}`, { courtId: court.id });
      save();
      return sendJSON(res, 200, { court }), true;
    }

    /* -------- جدول اليوم -------- */
    if (route === 'GET /api/courts/grid') {
      if (guard(u, res)) return true;
      const date = q.get('date') || today();
      const courts = (d.courtsList || []).filter((x) => x.active !== false).map((c) => {
        const slots = eachSlot(c).map((slot) => {
          const s = toMinutes(slot);
          const hit = (d.courtBookings || []).find((b2) => b2.courtId === c.id && b2.date === date
            && !['cancelled', 'expired'].includes(effectiveStatus(b2))
            && s >= toMinutes(b2.from) && s < toMinutes(b2.to));
          return {
            slot,
            state: hit ? effectiveStatus(hit) : 'free',
            bookingId: hit ? hit.id : null,
            customerName: hit ? hit.customerName : null,
          };
        });
        return { ...c, slots };
      });
      return sendJSON(res, 200, { date, courts }), true;
    }

    /* -------- الحجوزات -------- */
    if (route === 'GET /api/courts/bookings') {
      if (guard(u, res)) return true;
      const date = q.get('date');
      // بحث واحد يجيب بالموبايل أو بالاسم — الاستقبال يسمع الاسم في التليفون
      // قبل ما يعرف الرقم.
      const term = (q.get('q') || q.get('phone') || '').trim();
      const list = (d.courtBookings || [])
        .filter((b) => (!date || b.date === date)
          && (!term || b.phone.includes(term) || String(b.customerName).includes(term)))
        .sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from))
        .slice(-200)
        .map((b) => ({
          ...b, status: effectiveStatus(b),
          courtName: (courtOf(d, b.courtId) || {}).name || '',
        }));
      return sendJSON(res, 200, { bookings: list }), true;
    }
    if (route === 'POST /api/courts/bookings') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      const court = courtOf(d, b.courtId);
      if (!court) return sendError(res, 404, 'الملعب مش موجود'), true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return sendError(res, 400, 'التاريخ غير صالح'), true;
      if (!/^\d{2}:\d{2}$/.test(b.from || '') || !/^\d{2}:\d{2}$/.test(b.to || '')) {
        return sendError(res, 400, 'وقت البداية والنهاية مطلوبين'), true;
      }
      if (!b.customerName || !b.phone) return sendError(res, 400, 'الاسم والموبايل مطلوبين'), true;

      const from = toMinutes(b.from);
      const to = toMinutes(b.to);
      const minutes = to - from;
      if (minutes <= 0) return sendError(res, 400, 'وقت النهاية لازم يكون بعد البداية'), true;
      if (minutes < 60) return sendError(res, 400, 'أقل مدة حجز ساعة'), true;
      if (minutes % 30 !== 0) return sendError(res, 400, 'المدة بمضاعفات النصف ساعة'), true;
      if (from < toMinutes(court.openFrom) || to > toMinutes(court.openTo)) {
        return sendError(res, 400, `الحجز خارج مواعيد العمل (${court.openFrom}–${court.openTo})`), true;
      }

      const clash = (d.courtBookings || []).find((x) => x.courtId === court.id && x.date === b.date
        && !['cancelled', 'expired'].includes(effectiveStatus(x))
        && from < toMinutes(x.to) && to > toMinutes(x.from));
      if (clash) return sendError(res, 409, 'الملعب محجوز في التوقيت ده'), true;

      // السعر يُحسب هنا من سعر الملعب — أي سعر جاي من المتصفح يُتجاهل.
      const amount = money(court.pricePerHour * (minutes / 60));
      const deposit = money(b.deposit === undefined ? 0 : b.deposit);
      if (deposit < 0) return sendError(res, 400, 'العربون غير صالح'), true;
      if (deposit > amount) return sendError(res, 400, 'العربون أكبر من قيمة الحجز'), true;
      const method = ['cash', 'card', 'wallet', 'transfer'].includes(b.method) ? b.method : 'cash';

      d.courtSeq.booking = (d.courtSeq.booking || 1000) + 1;
      const booking = {
        id: crypto.randomUUID(), no: d.courtSeq.booking, courtId: court.id, date: b.date,
        from: b.from, to: b.to, minutes, customerName: String(b.customerName).slice(0, 60),
        phone: String(b.phone).slice(0, 20), amount, deposit, method,
        status: b.confirmed ? 'confirmed' : 'held', note: String(b.note || '').slice(0, 200),
        createdAt: now(), createdBy: u.id, cancelledAt: null, cancelReason: null, depositRefunded: 0,
      };
      d.courtBookings.push(booking);
      if (deposit > 0 && method === 'cash') {
        cashMove(d, { type: 'in', amount: deposit, reason: `courts:deposit:#${booking.no}`, user: u });
      }
      audit(u, 'courts.booked', `حجز #${booking.no} ${court.name} ${b.from}-${b.to}`, { bookingId: booking.id });
      save();
      return sendJSON(res, 201, { booking }), true;
    }
    if (route.startsWith('GET /api/courts/bookings/')) {
      if (guard(u, res)) return true;
      const b = bookingOf(d, parts[3]);
      if (!b) return sendError(res, 404, 'الحجز مش موجود'), true;
      return sendJSON(res, 200, { booking: { ...b, status: effectiveStatus(b), courtName: (courtOf(d, b.courtId) || {}).name || '' } }), true;
    }
    if (route.startsWith('POST /api/courts/bookings/') && p.endsWith('/confirm')) {
      if (guard(u, res)) return true;
      const b = bookingOf(d, parts[3]);
      if (!b) return sendError(res, 404, 'الحجز مش موجود'), true;
      const st = effectiveStatus(b);
      if (st === 'cancelled') return sendError(res, 409, 'الحجز ملغي'), true;
      if (st === 'expired') return sendError(res, 409, 'الحجز انتهت مدته — اعمل حجز جديد'), true;
      b.status = 'confirmed';
      b.confirmedAt = now();
      audit(u, 'courts.confirmed', `تأكيد حجز #${b.no}`, { bookingId: b.id });
      save();
      return sendJSON(res, 200, { booking: b }), true;
    }
    if (route.startsWith('POST /api/courts/bookings/') && p.endsWith('/cancel')) {
      if (guard(u, res)) return true;
      const b = bookingOf(d, parts[3]);
      if (!b) return sendError(res, 404, 'الحجز مش موجود'), true;
      const bd = await readBody(req);
      if (!bd.reason) return sendError(res, 400, 'سبب الإلغاء مطلوب'), true;
      if (effectiveStatus(b) === 'cancelled') return sendError(res, 409, 'الحجز ملغي بالفعل'), true;
      if (effectiveStatus(b) === 'played') return sendError(res, 409, 'الحجز اتلعب — مش بيتلغي'), true;

      const hoursLeft = (startMs(b.date, b.from) - Date.now()) / 3600000;
      const refundable = b.deposit > 0 && hoursLeft >= FREE_CANCEL_HOURS;
      b.status = 'cancelled';
      b.cancelledAt = now();
      b.cancelReason = String(bd.reason).slice(0, 200);
      b.cancelledBy = u.id;
      b.hoursBeforeStart = Math.round(hoursLeft * 10) / 10;
      if (refundable) {
        b.depositRefunded = b.deposit;
        cashMove(d, {
          type: 'out', amount: b.deposit,
          reason: `courts:refund:#${b.no}`, user: u,
        });
      }
      audit(u, 'courts.cancelled', `إلغاء #${b.no}${refundable ? ' مع رد العربون' : ' بلا رد'}`, { bookingId: b.id });
      save();
      return sendJSON(res, 200, { booking: b, refunded: refundable ? b.deposit : 0 }), true;
    }
    if (route.startsWith('POST /api/courts/bookings/') && p.endsWith('/play')) {
      if (guard(u, res)) return true;
      const b = bookingOf(d, parts[3]);
      if (!b) return sendError(res, 404, 'الحجز مش موجود'), true;
      const st = effectiveStatus(b);
      if (st === 'cancelled') return sendError(res, 409, 'الحجز ملغي'), true;
      if (st === 'expired') return sendError(res, 409, 'الحجز انتهت مدته'), true;
      b.status = 'played';
      b.playedAt = now();
      audit(u, 'courts.played', `لعب #${b.no}`, { bookingId: b.id });
      save();
      return sendJSON(res, 200, { booking: b }), true;
    }

    /* -------- الوردية -------- */
    if (route === 'GET /api/courts/shift') {
      if (guard(u, res)) return true;
      return sendJSON(res, 200, { openShift: openShiftOf(d) }), true;
    }
    if (route === 'POST /api/courts/shift') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      if (b.action === 'open') {
        if (openShiftOf(d)) return sendError(res, 409, 'في وردية مفتوحة بالفعل'), true;
        const shift = {
          id: crypto.randomUUID(), system: 'courts', openedAt: now(),
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
        shift.expectedCash = expectedCash(d, shift);
        shift.difference = money(shift.countedCash - shift.expectedCash);
        audit(u, 'courts.shift.closed', `إغلاق وردية ملاعب بفرق ${shift.difference}`, { shiftId: shift.id });
        save();
        return sendJSON(res, 200, { shift }), true;
      }
      return sendError(res, 400, 'action لازم يكون open أو close'), true;
    }

    /* -------- التقارير -------- */
    if (route === 'GET /api/courts/summary') {
      if (guard(u, res)) return true;
      const range = q.get('range') === 'week' ? 'week' : (q.get('date') ? 'date' : 'today');
      const date = range === 'date' ? q.get('date') : today();
      const days = range === 'week'
        ? Array.from({ length: 7 }, (_, i) => {
          const x = new Date(); x.setDate(x.getDate() - i);
          return x.toISOString().slice(0, 10);
        }) : [date];
      const inDays = (b) => days.includes(b.date);
      const booked = (d.courtBookings || []).filter((b) => inDays(b) && ['confirmed', 'played', 'held'].includes(effectiveStatus(b)));
      const revenue = money(booked.reduce((s, b) => s + (Number(b.amount) || 0), 0));
      const deposits = money(booked.reduce((s, b) => s + (Number(b.deposit) || 0), 0));
      const refunds = money((d.courtBookings || []).filter(inDays)
        .reduce((s, b) => s + (Number(b.depositRefunded) || 0), 0));

      const courts = (d.courtsList || []).filter((x) => x.active !== false).map((c) => {
        const availableMinutes = days.reduce((s, day) => s + (toMinutes(c.openTo) - toMinutes(c.openFrom)), 0);
        const usedMinutes = booked.filter((b) => b.courtId === c.id).reduce((s, b) => s + (Number(b.minutes) || 0), 0);
        return {
          id: c.id, name: c.name, kind: c.kind,
          booked: booked.filter((b) => b.courtId === c.id).length,
          usedMinutes, availableMinutes,
          occupancy: availableMinutes ? Math.round((usedMinutes / availableMinutes) * 100) : 0,
        };
      });

      const hours = {};
      for (const b of booked) hours[b.from] = (hours[b.from] || 0) + 1;
      return sendJSON(res, 200, {
        range, date, days,
        bookings: booked.length,
        revenue, deposits, refunds,
        net: money(deposits - refunds),
        courts,
        peakHours: Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([from, count]) => ({ from, count })),
      }), true;
    }

    return false;
  }

  return { seedDefaults, handle, expectedCash, effectiveStatus };
};
