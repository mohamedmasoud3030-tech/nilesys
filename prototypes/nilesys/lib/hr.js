/* ===== Nile Systems — نظام الموارد البشرية =====
 *
 * تطبيق مستقل: مستخدموه (مدير/موارد بشرية/موظف)، مساراته /api/hr، وبياناته في
 * مجموعاته hr*. يفترض تسجيلاً يدوياً للحضور في هذه المرحلة (بصمة/كارت خارج النطاق).
 *
 * القواعد الحاكمة: مرتب معتمد لا يُعاد حسابه، ومرتب مصروف لا يُعدَّل، وصرف الشهر
 * يخصم من الخزينة مرة واحدة بمفتاح الشهر.
 */
const crypto = require('crypto');

module.exports = function createHr(ctx) {
  const { getDb, save, audit, sendJSON, sendError, readBody } = ctx;

  const now = () => new Date().toISOString();
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const today = () => new Date().toISOString().slice(0, 10);
  const LATE_AFTER = '09:15';        // بعد كده = متأخر
  const workdayValue = (base) => money((Number(base) || 0) / 30);

  /* ---------------- البذور ---------------- */
  function seedDefaults(d) {
    let changed = false;
    const ensure = (k, v) => { if (d[k] === undefined) { d[k] = v; changed = true; } };

    ensure('hrEmployees', []);
    ensure('hrAttendance', []);
    ensure('hrLeaves', []);
    ensure('hrPayroll', []);
    ensure('hrSeq', { emp: 1000 });

    if (d.hrEmployees.length === 0) {
      // [الاسم, الوظيفة, الأساسي, البدلات, تاريخ التعيين, حساب الدخول]
      const rows = [
        ['نادين حسام', 'محاسبة', 6000, 500, '2024-03-01', 'employee'],
        ['محمود عزت', 'كاشير', 4500, 300, '2024-06-15', null],
        ['سارة لبيب', 'مسؤولة مخزن', 5200, 400, '2023-11-05', null],
        ['عمرو دسوقي', 'سائق توصيل', 4000, 250, '2025-01-20', null],
      ];
      d.hrEmpSeq = 1000;
      d.hrEmployees = rows.map(([name, jobTitle, baseSalary, allowances, hireDate, username]) => {
        d.hrSeq.emp += 1;
        return {
          id: crypto.randomUUID(), code: `E-${d.hrSeq.emp}`, name, phone: '', jobTitle,
          baseSalary, allowances, hireDate, username: username || null,
          active: true, system: 'hr', createdAt: now(),
        };
      });
      changed = true;
    }
    return changed;
  }

  /* ---------------- أدوات ---------------- */
  const isHrUser = (u) => u && u.system === 'hr';
  const isManager = (u) => isHrUser(u) && u.role === 'manager';
  const isHrOfficer = (u) => isHrUser(u) && (u.role === 'hr' || u.role === 'manager');
  const isEmployee = (u) => isHrUser(u) && u.role === 'employee';

  function guard(u, res, opts = {}) {
    if (!isHrUser(u)) {
      sendError(res, 403, 'غير مسموح: مسارات الموارد البشرية لمستخدمي النظام فقط');
      return true;
    }
    if (opts.manager && !isManager(u)) { sendError(res, 403, 'للمدير بس'); return true; }
    if (opts.officer && !isHrOfficer(u)) { sendError(res, 403, 'للموارد البشرية أو المدير'); return true; }
    return false;
  }

  const empOf = (d, id) => (d.hrEmployees || []).find((e) => e.id === id) || null;
  // حساب الموظف يرى سجله فقط: نربطه بالكود أو باسم المستخدم.
  const empOfUser = (d, u) => (d.hrEmployees || []).find((e) => e.username === u.username) || null;

  const toMin = (hhmm) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const daysInMonth = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  };

  function workdaysInMonth(month) {
    const [y, m] = month.split('-').map(Number);
    const total = daysInMonth(month);
    const out = [];
    for (let day = 1; day <= total; day += 1) {
      const dt = new Date(y, m - 1, day);
      const iso = `${month}-${String(day).padStart(2, '0')}`;
      if (dt.getDay() === 5) continue; // الجمعة راحة
      out.push(iso);
    }
    return out;
  }

  function cashMove(d, { type, amount, reason, user }) {
    d.cashMovements = d.cashMovements || [];
    const m = {
      id: crypto.randomUUID(), at: now(), type, amount: money(amount), reason,
      origin: 'hr', status: 'approved', shiftId: null,
      userId: user ? user.id : null, userName: user ? user.name : '—',
    };
    d.cashMovements.push(m);
    return m;
  }

  /* ---------------- الحساب ---------------- */
  // غياب الشهر لموظف: أيام مسجّلة غياب + نصف يوم لكل تسجيل بلا انصراف
  // + أيام الإجازات المرفوضة. الإجازة المعتمدة لا تُحسب غياباً.
  function absenceDays(d, empId, month) {
    let days = 0;
    const details = [];
    const inMonth = (date) => String(date).slice(0, 7) === month;
    for (const a of d.hrAttendance || []) {
      if (a.employeeId !== empId || !inMonth(a.date)) continue;
      if (a.status === 'absent') { days += 1; details.push({ date: a.date, kind: 'absent', value: 1 }); }
      else if (!a.out && !a.fixed) { days += 0.5; details.push({ date: a.date, kind: 'no_checkout', value: 0.5 }); }
    }
    const approvedDays = new Set();
    for (const l of d.hrLeaves || []) {
      if (l.employeeId !== empId) continue;
      if (l.status === 'approved') {
        for (const day of workdaysInMonth(month)) if (day >= l.from && day <= l.to) approvedDays.add(day);
      }
      if (l.status === 'rejected') {
        for (const day of workdaysInMonth(month)) {
          if (day >= l.from && day <= l.to && !approvedDays.has(day)) {
            days += 1; details.push({ date: day, kind: 'rejected_leave', value: 1 });
          }
        }
      }
    }
    return { days, details };
  }

  function lateDaysCount(d, empId, month) {
    return (d.hrAttendance || []).filter((a) => a.employeeId === empId
      && String(a.date).slice(0, 7) === month && a.status === 'late').length;
  }

  function buildRow(d, emp, month, opts = {}) {
    const dayValue = workdayValue(emp.baseSalary);
    const abs = absenceDays(d, emp.id, month);
    const lateDays = lateDaysCount(d, emp.id, month);
    // التأخير: قيمة ربع يوم عن كل يوم تأخير — عقوبة أقل من الغياب وأشد من لا شيء.
    const lateDeduction = money(Math.round(lateDays * (dayValue / 4)));
    const absenceDeduction = money(Math.round(abs.days * dayValue));
    const base = money(emp.baseSalary);
    const allowances = money(emp.allowances);
    const bonus = money(opts.bonus || 0);
    const advance = money(opts.advance || 0);
    const net = money(base + allowances + bonus - absenceDeduction - lateDeduction - advance);
    return {
      id: crypto.randomUUID(), month, employeeId: emp.id, employeeName: emp.name, code: emp.code,
      base, allowances, bonus, absenceDeduction, lateDeduction, advance, net,
      dayValue, absenceDays: abs.days, absenceDetails: abs.details, lateDays,
      status: 'draft', createdAt: now(), approvedAt: null, paidAt: null, cashMovementId: null,
    };
  }

  /* ---------------- المعالج ---------------- */
  async function handle(req, res, url, rc) {
    const { route, user: u } = rc;
    if (!route.startsWith('GET /api/hr') && !route.startsWith('POST /api/hr')
      && !route.startsWith('PUT /api/hr') && !route.startsWith('PATCH /api/hr')) return false;
    const d = getDb();
    if (!d.hrEmployees) seedDefaults(d);
    const p = url.pathname;
    const parts = p.split('/').filter(Boolean); // ['api','hr',...]
    const q = url.searchParams;

    // الموظف يرى سجله فقط — والفحص هنا قبل أي مسار يرجع بيانات،
    // لا بعده (فحص متأخر كان يسمح له بقراءة سجل زميله فعلاً).
    if (isEmployee(u) && route.startsWith('GET /api/hr')) {
      const me = empOfUser(d, u);
      const wanted = q.get('employeeId');
      if (wanted && (!me || wanted !== me.id)) return sendError(res, 403, 'ما ينفعش تشوف سجل غيرك'), true;
    }

    /* -------- الموظفون -------- */
    if (route === 'GET /api/hr/employees') {
      if (guard(u, res)) return true;
      const me = isEmployee(u) ? empOfUser(d, u) : null;
      const list = (d.hrEmployees || [])
        .filter((e) => !isEmployee(u) || (me && e.id === me.id))
        .filter((e) => !q.get('active') || Boolean(e.active) === (q.get('active') === '1'))
        .map((e) => ({ ...e, dayValue: workdayValue(e.baseSalary) }));
      return sendJSON(res, 200, { employees: list }), true;
    }
    if (route === 'POST /api/hr/employees') {
      if (guard(u, res, { officer: true })) return true;
      const b = await readBody(req);
      if (!b.name || !(Number(b.baseSalary) >= 0)) return sendError(res, 400, 'الاسم والراتب الأساسي مطلوبين'), true;
      d.hrSeq.emp = (d.hrSeq.emp || 1000) + 1;
      const emp = {
        id: crypto.randomUUID(), code: b.code || `E-${d.hrSeq.emp}`, name: String(b.name).slice(0, 80),
        phone: String(b.phone || ''), jobTitle: String(b.jobTitle || 'موظف').slice(0, 60),
        baseSalary: money(b.baseSalary), allowances: money(b.allowances || 0),
        hireDate: b.hireDate || today(), username: b.username || null,
        active: true, system: 'hr', createdAt: now(),
      };
      d.hrEmployees.push(emp);
      audit(u, 'hr.employee.created', `موظف ${emp.name}`, { employeeId: emp.id });
      save();
      return sendJSON(res, 201, { employee: emp }), true;
    }
    if (route.startsWith('PUT /api/hr/employees/')) {
      if (guard(u, res, { manager: true })) return true;
      const emp = empOf(d, parts[3]);
      if (!emp) return sendError(res, 404, 'الموظف مش موجود'), true;
      const b = await readBody(req);
      if (b.name !== undefined) emp.name = String(b.name).slice(0, 80);
      if (b.jobTitle !== undefined) emp.jobTitle = String(b.jobTitle).slice(0, 60);
      if (b.baseSalary !== undefined) emp.baseSalary = money(b.baseSalary);
      if (b.allowances !== undefined) emp.allowances = money(b.allowances);
      if (b.active !== undefined) emp.active = Boolean(b.active);
      audit(u, 'hr.employee.updated', `تعديل ${emp.name}`, { employeeId: emp.id });
      save();
      return sendJSON(res, 200, { employee: emp }), true;
    }

    /* -------- الحضور -------- */
    if (route === 'GET /api/hr/attendance') {
      if (guard(u, res)) return true;
      const date = q.get('date') || today();
      const me = isEmployee(u) ? empOfUser(d, u) : null;
      const list = (d.hrAttendance || [])
        .filter((a) => !isEmployee(u) || (me && a.employeeId === me.id))
        .filter((a) => (q.get('employeeId') ? a.employeeId === q.get('employeeId') : a.date === date))
        .map((a) => ({ ...a, employeeName: (empOf(d, a.employeeId) || {}).name || '', jobTitle: (empOf(d, a.employeeId) || {}).jobTitle || '' }))
        .sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
      // لوحة اليوم: كل الموظفين النشطين بحالتهم
      const board = date === today() || q.get('board') === '1'
        ? (d.hrEmployees || []).filter((e) => e.active !== false).map((e) => {
          const rec = list.find((a) => a.employeeId === e.id);
          const leave = (d.hrLeaves || []).find((l) => l.employeeId === e.id && l.status === 'approved'
            && date >= l.from && date <= l.to);
          return {
            employeeId: e.id, name: e.name, code: e.code, jobTitle: e.jobTitle,
            state: rec ? rec.status : (leave ? 'leave' : 'not_in'),
            in: rec ? rec.in : null, out: rec ? rec.out : null, attendanceId: rec ? rec.id : null,
          };
        })
        : null;
      return sendJSON(res, 200, { date, attendance: list, board }), true;
    }
    if (route === 'POST /api/hr/attendance') {
      if (guard(u, res, { officer: true })) return true;
      const b = await readBody(req);
      const emp = empOf(d, b.employeeId);
      if (!emp) return sendError(res, 404, 'الموظف مش موجود'), true;
      const date = b.date || today();
      if ((d.hrAttendance || []).some((a) => a.employeeId === emp.id && a.date === date)) {
        return sendError(res, 409, 'فيه تسجيل حضور للموظف في اليوم ده'), true;
      }
      const inAt = b.in || null;
      const status = b.status === 'absent' ? 'absent' : b.status === 'leave' ? 'leave'
        : (inAt && toMin(inAt) > toMin(LATE_AFTER) ? 'late' : 'present');
      const rec = {
        id: crypto.randomUUID(), employeeId: emp.id, date, in: inAt, out: b.out || null,
        status, note: String(b.note || '').slice(0, 200), fixed: false, createdAt: now(), by: u.id,
      };
      d.hrAttendance.push(rec);
      audit(u, 'hr.attendance', `حضور ${emp.name} ${date} (${status})`, { attendanceId: rec.id });
      save();
      return sendJSON(res, 201, { attendance: rec }), true;
    }
    if (route.startsWith('POST /api/hr/attendance/') && p.endsWith('/fix')) {
      if (guard(u, res, { officer: true })) return true;
      const rec = (d.hrAttendance || []).find((a) => a.id === parts[3]);
      if (!rec) return sendError(res, 404, 'التسجيل مش موجود'), true;
      const b = await readBody(req);
      if (!b.reason) return sendError(res, 400, 'سبب التصحيح مطلوب'), true;
      if (b.in !== undefined) rec.in = b.in || null;
      if (b.out !== undefined) rec.out = b.out || null;
      rec.note = String(b.reason).slice(0, 200);
      rec.fixed = true;
      rec.fixedBy = u.id;
      rec.fixedAt = now();
      if (rec.status !== 'absent' && rec.status !== 'leave') {
        rec.status = rec.in && toMin(rec.in) > toMin(LATE_AFTER) ? 'late' : 'present';
      }
      audit(u, 'hr.attendance.fixed', `تصحيح حضور ${rec.date}`, { attendanceId: rec.id });
      save();
      return sendJSON(res, 200, { attendance: rec }), true;
    }

    /* -------- الإجازات -------- */
    if (route === 'GET /api/hr/leaves') {
      if (guard(u, res)) return true;
      const me = isEmployee(u) ? empOfUser(d, u) : null;
      const list = (d.hrLeaves || [])
        .filter((l) => !isEmployee(u) || (me && l.employeeId === me.id))
        .filter((l) => !q.get('status') || l.status === q.get('status'))
        .map((l) => ({ ...l, employeeName: (empOf(d, l.employeeId) || {}).name || '' }))
        .slice(-200).reverse();
      return sendJSON(res, 200, { leaves: list }), true;
    }
    if (route === 'POST /api/hr/leaves') {
      if (guard(u, res)) return true;
      const b = await readBody(req);
      // الموظف يطلب لنفسه فقط.
      let empId = b.employeeId;
      if (isEmployee(u)) {
        const me = empOfUser(d, u);
        if (!me) return sendError(res, 404, 'مفيش ملف موظف مربوط بحسابك'), true;
        if (empId && empId !== me.id) return sendError(res, 403, 'ما ينفعش تطلب إجازة لغيرك'), true;
        empId = me.id;
      }
      const emp = empOf(d, empId);
      if (!emp) return sendError(res, 404, 'الموظف مش موجود'), true;
      if (!b.from || !b.to || b.to < b.from) return sendError(res, 400, 'تواريخ الإجازة غير صالحة'), true;
      const kind = ['annual', 'sick', 'unpaid'].includes(b.kind) ? b.kind : 'annual';
      const leave = {
        id: crypto.randomUUID(), employeeId: emp.id, from: b.from, to: b.to, kind,
        status: 'pending', reason: String(b.reason || '').slice(0, 200), createdAt: now(), by: u.id,
        decidedAt: null, decidedBy: null,
      };
      d.hrLeaves.push(leave);
      audit(u, 'hr.leave.requested', `إجازة ${emp.name} ${b.from}→${b.to}`, { leaveId: leave.id });
      save();
      return sendJSON(res, 201, { leave }), true;
    }
    if (route.startsWith('POST /api/hr/leaves/') && p.endsWith('/decide')) {
      if (guard(u, res, { officer: true })) return true;
      const leave = (d.hrLeaves || []).find((l) => l.id === parts[3]);
      if (!leave) return sendError(res, 404, 'الإجازة مش موجودة'), true;
      if (leave.status !== 'pending') return sendError(res, 409, 'الإجازة محسومة بالفعل'), true;
      const b = await readBody(req);
      leave.status = b.approve ? 'approved' : 'rejected';
      leave.decidedAt = now();
      leave.decidedBy = u.id;
      audit(u, 'hr.leave.decided', `إجازة ${leave.status}`, { leaveId: leave.id });
      save();
      return sendJSON(res, 200, { leave }), true;
    }

    /* -------- المرتبات -------- */
    if (route === 'POST /api/hr/payroll/run') {
      if (guard(u, res, { officer: true })) return true;
      const b = await readBody(req);
      const month = b.month || today().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return sendError(res, 400, 'صيغة الشهر YYYY-MM'), true;
      const existing = (d.hrPayroll || []).filter((r) => r.month === month);
      if (existing.some((r) => r.status !== 'draft')) {
        return sendError(res, 409, 'فيه مرتبات معتمدة أو مصروفة للشهر ده — مش هتتحسب تاني'), true;
      }
      // المسودات تُعاد بحساب نظيف؛ لا تكرار.
      d.hrPayroll = (d.hrPayroll || []).filter((r) => r.month !== month);
      const rows = (d.hrEmployees || []).filter((e) => e.active !== false)
        .map((e) => buildRow(d, e, month, {
          bonus: (b.bonus && b.bonus[e.id]) || 0,
          advance: (b.advance && b.advance[e.id]) || 0,
        }));
      d.hrPayroll.push(...rows);
      audit(u, 'hr.payroll.run', `حساب مرتبات ${month} (${rows.length} موظف)`, { month });
      save();
      return sendJSON(res, 201, { month, rows, total: money(rows.reduce((s, r) => s + r.net, 0)) }), true;
    }
    if (route.startsWith('GET /api/hr/payroll/')) {
      if (guard(u, res)) return true;
      const month = parts[3];
      const rows = (d.hrPayroll || []).filter((r) => r.month === month);
      if (isEmployee(u)) {
        const me = empOfUser(d, u);
        return sendJSON(res, 200, { month, rows: rows.filter((r) => me && r.employeeId === me.id) }), true;
      }
      return sendJSON(res, 200, {
        month, rows,
        total: money(rows.reduce((s, r) => s + r.net, 0)),
        status: rows.length ? rows[0].status : 'none',
      }), true;
    }
    if (route.startsWith('POST /api/hr/payroll/') && p.endsWith('/approve')) {
      if (guard(u, res, { officer: true })) return true;
      const month = parts[3];
      const rows = (d.hrPayroll || []).filter((r) => r.month === month);
      if (!rows.length) return sendError(res, 404, 'مفيش مرتبات للشهر ده'), true;
      if (rows.some((r) => r.status === 'paid')) return sendError(res, 409, 'المرتبات اتصرفت بالفعل'), true;
      if (rows.every((r) => r.status === 'approved')) return sendError(res, 409, 'معتمدة بالفعل'), true;
      for (const r of rows) { r.status = 'approved'; r.approvedAt = now(); r.approvedBy = u.id; }
      audit(u, 'hr.payroll.approved', `اعتماد مرتبات ${month}`, { month });
      save();
      return sendJSON(res, 200, { month, rows, total: money(rows.reduce((s, r) => s + r.net, 0)) }), true;
    }
    if (route.startsWith('POST /api/hr/payroll/') && p.endsWith('/pay')) {
      if (guard(u, res, { manager: true })) return true;
      const month = parts[3];
      const rows = (d.hrPayroll || []).filter((r) => r.month === month);
      if (!rows.length) return sendError(res, 404, 'مفيش مرتبات للشهر ده'), true;
      if (rows.some((r) => r.status === 'paid')) return sendError(res, 409, 'الشهر ده اتصرف قبل كده'), true;
      if (rows.some((r) => r.status !== 'approved')) return sendError(res, 409, 'لازم اعتماد المرتبات قبل الصرف'), true;
      const total = money(rows.reduce((s, r) => s + r.net, 0));
      const movement = cashMove(d, { type: 'out', amount: total, reason: `hr:salary:${month}`, user: u });
      for (const r of rows) {
        r.status = 'paid'; r.paidAt = now(); r.paidBy = u.id; r.cashMovementId = movement.id;
      }
      audit(u, 'hr.payroll.paid', `صرف مرتبات ${month} — ${total}`, { month, cashMovementId: movement.id });
      save();
      return sendJSON(res, 200, { month, rows, total, movement }), true;
    }

    /* -------- سجل الموظف نفسه -------- */
    if (route === 'GET /api/hr/me') {
      if (guard(u, res)) return true;
      const me = empOfUser(d, u);
      if (!me) return sendError(res, 404, 'مفيش ملف موظف مربوط بحسابك'), true;
      const attendance = (d.hrAttendance || []).filter((a) => a.employeeId === me.id).slice(-31).reverse();
      const leaves = (d.hrLeaves || []).filter((l) => l.employeeId === me.id).slice(-20).reverse();
      const payroll = (d.hrPayroll || []).filter((r) => r.employeeId === me.id).slice(-12).reverse();
      return sendJSON(res, 200, { employee: me, attendance, leaves, payroll }), true;
    }
    /* -------- لوحة اليوم والتقارير -------- */
    if (route === 'GET /api/hr/day') {
      // لوحة اليوم تعرض حالات كل الزملاء — للموارد البشرية والمدير فقط.
      if (guard(u, res, { officer: true })) return true;
      const date = q.get('date') || today();
      const recs = (d.hrAttendance || []).filter((a) => a.date === date);
      const emps = (d.hrEmployees || []).filter((e) => e.active !== false);
      const leaves = (d.hrLeaves || []).filter((l) => l.status === 'approved' && date >= l.from && date <= l.to);
      const board = emps.map((e) => {
        const rec = recs.find((a) => a.employeeId === e.id);
        const onLeave = leaves.some((l) => l.employeeId === e.id);
        return {
          employeeId: e.id, name: e.name, code: e.code, jobTitle: e.jobTitle,
          state: rec ? rec.status : (onLeave ? 'leave' : 'absent_not_recorded'),
          in: rec ? rec.in : null, out: rec ? rec.out : null,
          missingOut: Boolean(rec && !rec.out),
        };
      });
      return sendJSON(res, 200, {
        date,
        present: board.filter((b) => b.state === 'present').length,
        late: board.filter((b) => b.state === 'late').length,
        absent: board.filter((b) => b.state === 'absent').length,
        leave: board.filter((b) => b.state === 'leave').length,
        noCheckout: board.filter((b) => b.missingOut).length,
        notRecorded: board.filter((b) => b.state === 'absent_not_recorded').length,
        board,
      }), true;
    }

    return false;
  }

  return { seedDefaults, handle };
};
