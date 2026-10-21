/* ===== Nile Systems — نظام العيادة =====
 *
 * تطبيق مستقل داخل نفس المنصة: له مستخدموه (مدير/استقبال/طبيب)، مساراته تحت
 * /api/clinic، وبياناته في مجموعاته clinic*. لا يشارك نظام نقاط البيع في شيء
 * إلا درج النقدية العام — لأن فلوس العيادة لا تُطابَق في مكانين.
 *
 * القاعدة الحاكمة: ملف المريض واحد بالموبايل، والزيارة لا تُحصَّل قبل أن يصل
 * المريض ويُكتب تشخيصه.
 */
const crypto = require('crypto');

module.exports = function createClinic(ctx) {
  const { getDb, save, audit, sendJSON, sendError, readBody } = ctx;

  const now = () => new Date().toISOString();
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const APPt_STATES = ['booked', 'arrived', 'in_room', 'done', 'no_show', 'cancelled'];
  const PAY_METHODS = ['cash', 'card', 'wallet', 'transfer'];

  /* ---------------- البذور ---------------- */
  function seedDefaults(d) {
    let changed = false;
    const ensure = (k, v) => { if (d[k] === undefined) { d[k] = v; changed = true; } };

    ensure('clinicPatients', []);
    ensure('clinicDoctors', []);
    ensure('clinicAppointments', []);
    ensure('clinicVisits', []);
    ensure('clinicSeq', { patient: 1000, appt: 500 });

    if (d.clinicDoctors.length === 0) {
      // [الاسم, التخصص, سعر الكشف, اسم المستخدم المرتبط]
      const docs = [
        ['د. أحمد الشريف', 'باطنة', 300, 'doctor'],
        ['د. سلمى فؤاد', 'أطفال', 250, null],
        ['د. كريم منصور', 'أسنان', 400, null],
      ];
      d.clinicDoctors = docs.map(([name, specialty, fee, username]) => ({
        id: crypto.randomUUID(), name, specialty, fee, username,
        days: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'],
        active: true, system: 'clinic',
      }));
      changed = true;
    }

    if (d.clinicPatients.length === 0) {
      const people = [
        ['منى عبد الرحيم', '01001112233', 'female', 1988],
        ['أشرف كمال', '01005556677', 'male', 1975],
        ['سلمى حسن', '01112223344', 'female', 2015],
        ['رامي فؤاد', '01223334455', 'male', 1992],
        ['هند مصطفى', '01556667788', 'female', 1981],
      ];
      d.clinicSeq.patient = 1000;
      d.clinicPatients = people.map(([name, phone, gender, birthYear]) => {
        d.clinicSeq.patient += 1;
        return {
          id: crypto.randomUUID(), code: `P-${d.clinicSeq.patient}`, name, phone, gender, birthYear,
          notes: '', createdAt: now(), system: 'clinic',
        };
      });
      changed = true;
    }

    // يوم عمل نموذجي: مواعيد النهارده موجودة عشان الديمو ما يبدأش فاضي —
    // ومواعيد الاختبار تُحجز غداً على طبيب جديد، فلا تتعارض معها.
    if (d.clinicAppointments.length === 0) {
      const at = (h, m) => { const x = new Date(); x.setHours(h, m, 0, 0); return x.toISOString(); };
      const picks = [
        [0, 0, 11, 0, 'arrived'], [1, 1, 11, 0, 'booked'], [2, 0, 11, 30, 'booked'],
      ];
      d.clinicAppointments = picks
        .filter(([pi, di]) => d.clinicPatients[pi] && d.clinicDoctors[di])
        .map(([pi, di, h, mi, status]) => {
          d.clinicSeq.appt += 1;
          return {
            id: crypto.randomUUID(), no: d.clinicSeq.appt,
            patientId: d.clinicPatients[pi].id, doctorId: d.clinicDoctors[di].id,
            at: at(h, mi), minutes: 20, status, fee: d.clinicDoctors[di].fee,
            paid: 0, method: null, payments: [], createdAt: now(), createdBy: null, notes: '',
          };
        });
      changed = true;
    }
    return changed;
  }

  /* ---------------- أدوات ---------------- */
  const isClinicUser = (u) => u && u.system === 'clinic';
  const isManager = (u) => isClinicUser(u) && u.role === 'manager';
  const isDoctor = (u) => isClinicUser(u) && u.role === 'doctor';
  const isReception = (u) => isClinicUser(u) && u.role === 'reception';

  function guard(u, res, opts = {}) {
    if (!isClinicUser(u)) {
      sendError(res, 403, 'غير مسموح: مسارات العيادة لمستخدمي نظام العيادة فقط');
      return true;
    }
    if (opts.manager && !isManager(u)) { sendError(res, 403, 'للمدير بس'); return true; }
    if (opts.noDoctor && isDoctor(u)) { sendError(res, 403, 'الطبيب مش بيحصّل ولا بيعدّل الأسعار'); return true; }
    if (opts.noReception && isReception(u)) { sendError(res, 403, 'الاستقبال مش بيكتب روشتة'); return true; }
    return false;
  }

  const doctorOfUser = (d, u) => (d.clinicDoctors || []).find((x) => x.username && x.username === u.username) || null;
  const patientOf = (d, id) => (d.clinicPatients || []).find((p) => p.id === id) || null;
  const apptOf = (d, id) => (d.clinicAppointments || []).find((a) => a.id === id) || null;
  const doctorOf = (d, id) => (d.clinicDoctors || []).find((x) => x.id === id) || null;
  const visitOfAppt = (d, apptId) => (d.clinicVisits || []).find((v) => v.appointmentId === apptId) || null;

  function openShiftOf(d) {
    return (d.shifts || []).find((s) => s.system === 'clinic' && !s.closedAt) || null;
  }

  function cashMove(d, { type, amount, reason, user, shiftId }) {
    d.cashMovements = d.cashMovements || [];
    const m = {
      id: crypto.randomUUID(), at: now(), type, amount: money(amount), reason,
      origin: 'clinic', status: 'approved', shiftId: shiftId || null,
      userId: user ? user.id : null, userName: user ? user.name : '—',
    };
    d.cashMovements.push(m);
    return m;
  }

  // المتوقع في الدرج: الافتتاحي + الكاش المحصَّل داخل الوردية + حركات الدرج اليدوية.
  function expectedCash(d, shift) {
    const from = new Date(shift.openedAt).getTime();
    const until = shift.closedAt ? new Date(shift.closedAt).getTime() : Infinity;
    const within = (iso) => { const t = new Date(iso).getTime(); return t >= from && t <= until; };
    let cash = Number(shift.openingCash) || 0;
    for (const a of d.clinicAppointments || []) {
      for (const p of a.payments || []) {
        if (p.method !== 'cash' || !within(p.at)) continue;
        cash += Number(p.amount) || 0;
      }
    }
    for (const m of d.cashMovements || []) {
      if (m.origin !== 'clinic' || m.status !== 'approved') continue;
      if (!within(m.at)) continue;
      // حركات التحصيل مسجّلة أعلاه من المواعيد — لا تُجمع مرتين.
      if (/^clinic:pay:/.test(m.reason || '')) continue;
      cash += m.type === 'in' ? m.amount : -m.amount;
    }
    return money(cash);
  }

  function dayRange(q) {
    const date = q.get('date');
    if (date) return { from: new Date(`${date}T00:00:00`).getTime(), until: new Date(`${date}T23:59:59.999`).getTime(), date };
    const t = new Date();
    const from = new Date(t.setHours(0, 0, 0, 0)).getTime();
    return { from, until: from + 86400000 - 1, date: new Date(from).toISOString().slice(0, 10) };
  }

  /* ---------------- المعالج ---------------- */
  async function handle(req, res, url, rc) {
    const { route, user: u } = rc;
    if (!route.startsWith('GET /api/clinic') && !route.startsWith('POST /api/clinic')
      && !route.startsWith('PUT /api/clinic') && !route.startsWith('PATCH /api/clinic')) return false;
    // GET /api/clinic/bootstrap شبيه بالـ bootstrap العام لكن بلا منتجات.
    const d = getDb();
    if (!d.clinicPatients) seedDefaults(d);
    const p = url.pathname;
    const parts = p.split('/').filter(Boolean); // ['api','clinic',...]
    const q = url.searchParams;

    /* -------- المرضى -------- */
    if (route === 'GET /api/clinic/patients') {
      if (guard(u, res)) return true;
      const term = (q.get('q') || '').trim();
      const list = (d.clinicPatients || [])
        .filter((x) => !term || x.name.includes(term) || x.phone.includes(term) || x.code.includes(term))
        .map((x) => {
          const visits = (d.clinicVisits || []).filter((v) => v.patientId === x.id);
          return { ...x, visits: visits.length, lastVisitAt: visits.length ? visits[visits.length - 1].at : null };
        })
        .slice(-200).reverse();
      return sendJSON(res, 200, { patients: list, count: list.length }), true;
    }
    if (route === 'POST /api/clinic/patients') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      if (!b.name || !b.phone) return sendError(res, 400, 'الاسم والموبايل مطلوبين'), true;
      const phone = String(b.phone).trim();
      const existing = (d.clinicPatients || []).find((x) => x.phone === phone);
      // موبايل واحد = ملف واحد. نرجّع الملف الموجود بدل إنشاء نسخة ثانية منه.
      if (existing) {
        return sendJSON(res, 409, { error: 'فيه ملف بنفس الموبايل', patientId: existing.id, patient: existing }), true;
      }
      d.clinicSeq.patient = (d.clinicSeq.patient || 1000) + 1;
      const patient = {
        id: crypto.randomUUID(), code: `P-${d.clinicSeq.patient}`,
        name: String(b.name).slice(0, 80), phone,
        gender: b.gender === 'male' ? 'male' : b.gender === 'female' ? 'female' : 'unknown',
        birthYear: Number(b.birthYear) || null, notes: String(b.notes || '').slice(0, 400),
        createdAt: now(), system: 'clinic',
      };
      d.clinicPatients.push(patient);
      audit(u, 'clinic.patient.created', `مريض ${patient.name} (${patient.code})`, { patientId: patient.id });
      save();
      return sendJSON(res, 201, { patient }), true;
    }
    if (route.startsWith('GET /api/clinic/patients/')) {
      if (guard(u, res)) return true;
      const patient = patientOf(d, parts[3]);
      if (!patient) return sendError(res, 404, 'المريض مش موجود'), true;
      const visits = (d.clinicVisits || []).filter((v) => v.patientId === patient.id)
        .map((v) => ({ ...v, doctorName: (doctorOf(d, v.doctorId) || {}).name || '' }));
      const appts = (d.clinicAppointments || []).filter((a) => a.patientId === patient.id)
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .map((a) => ({ ...a, doctorName: (doctorOf(d, a.doctorId) || {}).name || '' }));
      const paid = money(appts.reduce((s, a) => s + (Number(a.paid) || 0), 0));
      const due = money(appts.filter((a) => ['booked', 'arrived', 'in_room', 'done'].includes(a.status))
        .reduce((s, a) => s + Math.max(0, (Number(a.fee) || 0) - (Number(a.paid) || 0)), 0));
      return sendJSON(res, 200, { patient, visits, appointments: appts, paid, due }), true;
    }

    /* -------- الأطباء -------- */
    if (route === 'GET /api/clinic/doctors') {
      if (guard(u, res)) return true;
      const today = dayRange(q);
      const list = (d.clinicDoctors || []).filter((x) => x.active !== false).map((x) => {
        const appts = (d.clinicAppointments || []).filter((a) => a.doctorId === x.id
          && new Date(a.at).getTime() >= today.from && new Date(a.at).getTime() <= today.until);
        return { ...x, todayCount: appts.length, todayDone: appts.filter((a) => a.status === 'done').length };
      });
      return sendJSON(res, 200, { doctors: list }), true;
    }
    if (route === 'POST /api/clinic/doctors') {
      if (guard(u, res, { manager: true })) return true;
      const b = await readBody(req);
      if (!b.name) return sendError(res, 400, 'اسم الطبيب مطلوب'), true;
      const doctor = {
        id: crypto.randomUUID(), name: String(b.name).slice(0, 80),
        specialty: String(b.specialty || 'عام').slice(0, 40), fee: money(b.fee || 0),
        username: b.username || null, days: b.days || ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'],
        active: true, system: 'clinic',
      };
      d.clinicDoctors.push(doctor);
      audit(u, 'clinic.doctor.created', `طبيب ${doctor.name}`, { doctorId: doctor.id });
      save();
      return sendJSON(res, 201, { doctor }), true;
    }
    if (route.startsWith('PUT /api/clinic/doctors/')) {
      if (guard(u, res, { manager: true })) return true;
      const doctor = doctorOf(d, parts[3]);
      if (!doctor) return sendError(res, 404, 'الطبيب مش موجود'), true;
      const b = await readBody(req);
      if (b.name !== undefined) doctor.name = String(b.name).slice(0, 80);
      if (b.specialty !== undefined) doctor.specialty = String(b.specialty).slice(0, 40);
      if (b.fee !== undefined) doctor.fee = money(b.fee);
      if (b.active !== undefined) doctor.active = Boolean(b.active);
      audit(u, 'clinic.doctor.updated', `تعديل ${doctor.name}`, { doctorId: doctor.id });
      save();
      return sendJSON(res, 200, { doctor }), true;
    }

    /* -------- المواعيد -------- */
    if (route === 'GET /api/clinic/appointments') {
      if (guard(u, res)) return true;
      const range = dayRange(q);
      const doctorId = q.get('doctorId');
      const list = (d.clinicAppointments || [])
        .filter((a) => new Date(a.at).getTime() >= range.from && new Date(a.at).getTime() <= range.until)
        .filter((a) => !doctorId || a.doctorId === doctorId)
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .map((a) => ({
          ...a,
          patientName: (patientOf(d, a.patientId) || {}).name || '',
          patientPhone: (patientOf(d, a.patientId) || {}).phone || '',
          doctorName: (doctorOf(d, a.doctorId) || {}).name || '',
          hasVisit: Boolean(visitOfAppt(d, a.id)),
          remaining: money(Math.max(0, (Number(a.fee) || 0) - (Number(a.paid) || 0))),
        }));
      return sendJSON(res, 200, { appointments: list, date: range.date }), true;
    }
    if (route === 'POST /api/clinic/appointments') {
      if (guard(u, res, { noDoctor: true })) return true;
      const b = await readBody(req);
      const patient = patientOf(d, b.patientId);
      if (!patient) return sendError(res, 404, 'المريض مش موجود'), true;
      const doctor = doctorOf(d, b.doctorId);
      if (!doctor) return sendError(res, 404, 'الطبيب مش موجود'), true;
      if (!b.at || Number.isNaN(new Date(b.at).getTime())) return sendError(res, 400, 'الوقت غير صالح'), true;
      const at = new Date(b.at).getTime();
      const minutes = Math.max(5, Number(b.minutes) || 20);
      const clash = (d.clinicAppointments || []).find((a) => {
        if (a.doctorId !== doctor.id || ['cancelled', 'no_show'].includes(a.status)) return false;
        const s = new Date(a.at).getTime();
        const e = s + (Number(a.minutes) || 20) * 60000;
        return at < e && at + minutes * 60000 > s;
      });
      if (clash) return sendError(res, 409, 'الطبيب عنده موعد في نفس التوقيت'), true;
      d.clinicSeq.appt = (d.clinicSeq.appt || 500) + 1;
      const appointment = {
        id: crypto.randomUUID(), no: d.clinicSeq.appt, patientId: patient.id, doctorId: doctor.id,
        at: new Date(at).toISOString(), minutes, status: 'booked',
        fee: money(doctor.fee), paid: 0, method: null, payments: [],
        createdAt: now(), createdBy: u.id, notes: String(b.notes || '').slice(0, 200),
      };
      d.clinicAppointments.push(appointment);
      audit(u, 'clinic.appointment.booked', `موعد #${appointment.no} — ${patient.name}`, { appointmentId: appointment.id });
      save();
      return sendJSON(res, 201, { appointment }), true;
    }
    if (route.startsWith('POST /api/clinic/appointments/') && p.endsWith('/status')) {
      if (guard(u, res)) return true;
      const a = apptOf(d, parts[3]);
      if (!a) return sendError(res, 404, 'الموعد مش موجود'), true;
      const b = await readBody(req);
      const next = String(b.status || '');
      if (!APPt_STATES.includes(next)) return sendError(res, 400, 'حالة غير معروفة'), true;
      if (next === 'cancelled' && a.paid > 0 && !isManager(u)) {
        return sendError(res, 403, 'إلغاء موعد مدفوع يحتاج مدير'), true;
      }
      // مسار طبيعي: محجوز → وصل → في الغرفة → تم. وأي حالة نهائية لا ترجع للخلف.
      if (['done', 'cancelled', 'no_show'].includes(a.status) && next !== a.status) {
        return sendError(res, 409, 'الموعد ده مقفول'), true;
      }
      a.status = next;
      if (next === 'arrived') a.arrivedAt = now();
      if (next === 'in_room') a.roomAt = now();
      if (next === 'done') a.doneAt = now();
      audit(u, 'clinic.appointment.status', `موعد #${a.no} → ${next}`, { appointmentId: a.id });
      save();
      return sendJSON(res, 200, { appointment: a }), true;
    }
    if (route.startsWith('POST /api/clinic/appointments/') && p.endsWith('/reschedule')) {
      if (guard(u, res, { noDoctor: true })) return true;
      const a = apptOf(d, parts[3]);
      if (!a) return sendError(res, 404, 'الموعد مش موجود'), true;
      const b = await readBody(req);
      if (!b.at || Number.isNaN(new Date(b.at).getTime())) return sendError(res, 400, 'الوقت غير صالح'), true;
      const at = new Date(b.at).getTime();
      const minutes = Number(a.minutes) || 20;
      const clash = (d.clinicAppointments || []).find((x) => {
        if (x.id === a.id || x.doctorId !== a.doctorId) return false;
        if (['cancelled', 'no_show'].includes(x.status)) return false;
        const s = new Date(x.at).getTime();
        return at < s + (Number(x.minutes) || 20) * 60000 && at + minutes * 60000 > s;
      });
      if (clash) return sendError(res, 409, 'الطبيب عنده موعد في نفس التوقيت'), true;
      a.previousAt = a.previousAt || [];
      a.previousAt.push(a.at);
      a.at = new Date(at).toISOString();
      a.status = 'booked';
      // المريض نفسه هو نفسه: الملف مربوط بالمعرّف، فإعادة الجدولة لا تمسّه.
      audit(u, 'clinic.appointment.rescheduled', `موعد #${a.no} اتنقل`, { appointmentId: a.id });
      save();
      return sendJSON(res, 200, { appointment: a }), true;
    }
    if (route.startsWith('POST /api/clinic/appointments/') && p.endsWith('/pay')) {
      // التحصيل للاستقبال والمدير — الطبيب يعالج ولا يحصّل.
      if (guard(u, res, { noDoctor: true })) return true;
      const a = apptOf(d, parts[3]);
      if (!a) return sendError(res, 404, 'الموعد مش موجود'), true;
      if (['no_show', 'cancelled'].includes(a.status)) return sendError(res, 409, 'الموعد ملغي أو المريض ما جاش — مفيش تحصيل'), true;
      if (a.status === 'booked') return sendError(res, 400, 'المريض لسه ما وصلش'), true;
      const b = await readBody(req);
      const method = PAY_METHODS.includes(b.method) ? b.method : 'cash';
      const remaining = money(a.fee - (Number(a.paid) || 0));
      if (remaining <= 0) return sendError(res, 409, 'الموعد مدفوع بالفعل'), true;
      const amount = money(b.amount === undefined ? remaining : b.amount);
      if (!(amount > 0)) return sendError(res, 400, 'المبلغ غير صالح'), true;
      if (amount > remaining + 0.001) return sendError(res, 400, 'المبلغ أكبر من المتبقي'), true;

      const payment = { id: crypto.randomUUID(), at: now(), amount, method, by: u.id };
      a.payments = a.payments || [];
      a.payments.push(payment);
      a.paid = money((Number(a.paid) || 0) + amount);
      a.method = method;

      const shift = openShiftOf(d);
      if (method === 'cash') {
        cashMove(d, {
          type: 'in', amount, reason: `clinic:pay:#${a.no}`,
          user: u, shiftId: shift ? shift.id : null,
        });
      }
      audit(u, 'clinic.appointment.paid', `تحصيل ${amount} لموعد #${a.no}`, { appointmentId: a.id });
      save();
      return sendJSON(res, 200, { appointment: a, payment, remaining: money(a.fee - a.paid) }), true;
    }
    if (route.startsWith('POST /api/clinic/appointments/') && p.endsWith('/visit')) {
      if (guard(u, res, { noReception: true })) return true;
      const a = apptOf(d, parts[3]);
      if (!a) return sendError(res, 404, 'الموعد مش موجود'), true;
      // الروشتة تُكتب مرة واحدة: نتحقق من وجودها أولاً حتى تكون الرسالة واضحة
      // (لو تحققنا من الحالة أولاً، موعد «تم» كان هيرجّع «المريض ما وصلش» وهي رسالة غلط).
      if (visitOfAppt(d, a.id)) return sendError(res, 409, 'فيه زيارة مسجّلة للموعد ده'), true;
      if (!['arrived', 'in_room'].includes(a.status)) {
        return sendError(res, 400, 'ما ينفعش كشف قبل ما المريض يوصل'), true;
      }
      const b = await readBody(req);
      if (!b.diagnosis) return sendError(res, 400, 'التشخيص مطلوب'), true;
      const prescription = (Array.isArray(b.prescription) ? b.prescription : [])
        .filter((x) => x && x.drug)
        .map((x) => ({
          drug: String(x.drug).slice(0, 80),
          dose: String(x.dose || '').slice(0, 60),
          duration: String(x.duration || '').slice(0, 60),
          notes: String(x.notes || '').slice(0, 200),
        }));
      const visit = {
        id: crypto.randomUUID(), appointmentId: a.id, patientId: a.patientId, doctorId: a.doctorId,
        complaint: String(b.complaint || '').slice(0, 400), diagnosis: String(b.diagnosis).slice(0, 400),
        prescription, followUpAt: b.followUpAt ? new Date(b.followUpAt).toISOString() : null,
        at: now(), by: u.id, editedAt: null,
      };
      d.clinicVisits.push(visit);
      a.status = 'done';
      a.doneAt = now();
      audit(u, 'clinic.visit.created', `زيارة ${(patientOf(d, a.patientId) || {}).name}`, { visitId: visit.id });
      save();
      return sendJSON(res, 201, { visit, appointment: a }), true;
    }
    if (route.startsWith('PATCH /api/clinic/visits/')) {
      if (guard(u, res, { noReception: true })) return true;
      const visit = (d.clinicVisits || []).find((v) => v.id === parts[3]);
      if (!visit) return sendError(res, 404, 'الزيارة مش موجودة'), true;
      const a = apptOf(d, visit.appointmentId);
      // بعد التحصيل، تعديل الزيارة مسؤولية مدير — لا يُعاد كتابة روشتة مدفوعة بلا أثر.
      if (a && a.paid > 0 && !isManager(u)) return sendError(res, 403, 'الزيارة اتحصّلت — التعديل للمدير'), true;
      const b = await readBody(req);
      if (b.diagnosis !== undefined) visit.diagnosis = String(b.diagnosis).slice(0, 400);
      if (b.complaint !== undefined) visit.complaint = String(b.complaint).slice(0, 400);
      if (b.followUpAt !== undefined) visit.followUpAt = b.followUpAt ? new Date(b.followUpAt).toISOString() : null;
      if (Array.isArray(b.prescription)) {
        visit.prescription = b.prescription.filter((x) => x && x.drug).map((x) => ({
          drug: String(x.drug).slice(0, 80), dose: String(x.dose || '').slice(0, 60),
          duration: String(x.duration || '').slice(0, 60), notes: String(x.notes || '').slice(0, 200),
        }));
      }
      visit.editedAt = now();
      visit.editedBy = u.id;
      audit(u, 'clinic.visit.updated', 'تعديل زيارة', { visitId: visit.id });
      save();
      return sendJSON(res, 200, { visit }), true;
    }

    /* -------- الوردية والدرج -------- */
    if (route === 'GET /api/clinic/shift') {
      if (guard(u, res)) return true;
      return sendJSON(res, 200, { openShift: openShiftOf(d) }), true;
    }
    if (route === 'POST /api/clinic/shift') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      if (b.action === 'open') {
        if (openShiftOf(d)) return sendError(res, 409, 'في وردية مفتوحة بالفعل'), true;
        const shift = {
          id: crypto.randomUUID(), system: 'clinic', openedAt: now(),
          openingCash: money(b.openingCash || 0), openedBy: u.id, closedAt: null,
        };
        d.shifts = d.shifts || [];
        d.shifts.push(shift);
        audit(u, 'clinic.shift.opened', `فتح وردية عيادة بـ ${shift.openingCash}`, { shiftId: shift.id });
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
        audit(u, 'clinic.shift.closed', `إغلاق وردية عيادة بفرق ${shift.difference}`, { shiftId: shift.id });
        save();
        return sendJSON(res, 200, { shift }), true;
      }
      return sendError(res, 400, 'action لازم يكون open أو close'), true;
    }

    /* -------- ملخص اليوم -------- */
    if (route === 'GET /api/clinic/summary') {
      if (guard(u, res)) return true;
      const range = dayRange(q);
      const inDay = (iso) => { const t = new Date(iso).getTime(); return t >= range.from && t <= range.until; };
      const appts = (d.clinicAppointments || []).filter((a) => inDay(a.at));
      const done = appts.filter((a) => a.status === 'done');
      const noShow = appts.filter((a) => a.status === 'no_show');
      const revenue = money(appts.reduce((s, a) => s + (Number(a.paid) || 0), 0));
      const byMethod = {};
      for (const a of appts) for (const p of a.payments || []) {
        if (!inDay(p.at)) continue;
        byMethod[p.method] = money((byMethod[p.method] || 0) + p.amount);
      }
      const diagnoses = {};
      for (const v of d.clinicVisits || []) {
        if (!inDay(v.at)) continue;
        diagnoses[v.diagnosis] = (diagnoses[v.diagnosis] || 0) + 1;
      }
      return sendJSON(res, 200, {
        date: range.date,
        appointments: appts.length,
        done: done.length,
        noShow: noShow.length,
        noShowRate: appts.length ? Math.round((noShow.length / appts.length) * 100) : 0,
        revenue,
        byMethod,
        avgTicket: done.length ? money(revenue / done.length) : 0,
        topDiagnoses: Object.entries(diagnoses).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([diagnosis, count]) => ({ diagnosis, count })),
        doctors: (d.clinicDoctors || []).map((x) => ({
          id: x.id, name: x.name,
          count: appts.filter((a) => a.doctorId === x.id).length,
        })),
      }), true;
    }

    return false;
  }

  return { seedDefaults, handle, expectedCash };
};
