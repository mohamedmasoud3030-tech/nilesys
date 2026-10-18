/**
 * People (HR) persistence service — tenant-scoped via withTenant ⇒ RLS.
 *
 * Built on the EXISTING contracts, tables and pure engine only:
 *   - contracts: createEmployeeSchema, attendanceSchema (./contracts.ts)
 *   - tables:    employees, attendance_records, loans (./db/schema.ts, migration 0000;
 *                RLS enabled + forced; composite tenant FKs on employee_id)
 *   - math:      ./attendance.ts and ./payroll.ts (unchanged)
 * No schema or migration change: the payslip is COMPUTED, not stored, because
 * no payslip/payroll-run table exists. Persisting payroll runs (and deducting
 * loan installments) is a separate, owner-approved schema change.
 *
 * Tenant policy (shift start, rates, working days) has no table either, so it
 * is an explicit, validated argument — payroll.ts already states that rates
 * come from tenant policy and are never hardcoded.
 */
import { and, asc, eq, gt, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { DomainError } from '../../transactions/src/line.js';
import {
  computeLateMinutes,
  computeOvertimeMinutes,
  isCheckoutAfterCheckin,
  timeOfDayMinutes,
  type AttendanceStatus,
} from './attendance.js';
import { attendanceSchema, createEmployeeSchema } from './contracts.js';
import { attendanceRecords, employees, loans } from './db/schema.js';
import { computePayslip, loanSchedule, type Payslip } from './payroll.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_TIMES: readonly AttendanceStatus[] = ['ABSENT', 'LEAVE', 'HOLIDAY'];

/* ---------------- validation (strict refinements of the existing contracts) ---------------- */

const timeOfDay = z.string().refine((v) => timeOfDayMinutes(v) !== null, 'time must be HH:MM (00:00–23:59)');
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'day must be a real calendar date (YYYY-MM-DD)');

export const createEmployeeInputSchema = createEmployeeSchema
  .extend({
    name: z.string().trim().min(2).max(120),
    role: z.string().trim().min(1).max(60),
    phone: z.string().trim().max(20).optional(),
    baseSalaryMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const recordAttendanceInputSchema = attendanceSchema
  .extend({ day: calendarDay, checkIn: timeOfDay.optional(), checkOut: timeOfDay.optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (NO_TIMES.includes(v.status) && (v.checkIn || v.checkOut)) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: `${v.status} carries no check-in/check-out times` });
    }
  });

const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const payPolicySchema = z
  .object({
    workingDaysInMonth: z.number().int().min(1).max(31),
    scheduledStart: timeOfDay,
    standardMinutes: z.number().int().min(1).max(24 * 60).default(480),
    lateRatePerMinuteMinor: minor,
    overtimeRatePerMinuteMinor: minor,
    allowancesMinor: minor.optional(),
    otherDeductionsMinor: minor.optional(),
  })
  .strict();
export type PayPolicy = z.input<typeof payPolicySchema>;

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const details: Record<string, string> = {};
  for (const issue of r.error.issues) details[issue.path.join('.') || '_'] = issue.message;
  throw new DomainError('validation_failed', 'بيانات غير صالحة', details);
}

const notFound = () => new DomainError('employee_not_found', 'الموظف غير موجود');

/* ---------------- views ---------------- */

export interface EmployeeView {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  baseSalaryMinor: number;
  isActive: boolean;
}

export interface AttendanceView {
  employeeId: string;
  day: string;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
}

const toEmployee = (r: typeof employees.$inferSelect): EmployeeView => ({
  id: r.id,
  name: r.name,
  role: r.role,
  phone: r.phone,
  baseSalaryMinor: r.baseSalaryMinor,
  isActive: r.isActive,
});
const toAttendance = (r: typeof attendanceRecords.$inferSelect): AttendanceView => ({
  employeeId: r.employeeId,
  day: r.day,
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  status: r.status as AttendanceStatus,
});

async function loadEmployee(tx: any, employeeId: string, opts: { activeOnly: boolean }) {
  if (!UUID_RE.test(employeeId)) return null;
  const where = opts.activeOnly ? and(eq(employees.id, employeeId), eq(employees.isActive, true)) : eq(employees.id, employeeId);
  const [row] = await tx.select().from(employees).where(where).limit(1);
  return (row as typeof employees.$inferSelect | undefined) ?? null;
}

/* ---------------- employees ---------------- */

export async function createEmployee(db: AnyPgDatabase, tenantId: string, input: unknown): Promise<EmployeeView> {
  const data = parse(createEmployeeInputSchema, input);
  return withTenant(db, tenantId, async (tx: any) => {
    const [row] = await tx
      .insert(employees)
      .values({ tenantId, name: data.name, role: data.role, phone: data.phone || null, baseSalaryMinor: data.baseSalaryMinor })
      .returning();
    return toEmployee(row);
  });
}

export async function listEmployees(db: AnyPgDatabase, tenantId: string, opts: { includeInactive?: boolean } = {}): Promise<EmployeeView[]> {
  return withTenant(db, tenantId, async (tx: any) => {
    const rows = await tx
      .select()
      .from(employees)
      .where(opts.includeInactive ? undefined : eq(employees.isActive, true))
      .orderBy(asc(employees.name), asc(employees.id));
    return rows.map(toEmployee);
  });
}

/* ---------------- attendance ---------------- */

/**
 * Record (or complete) one employee-day. One row per (tenant, employee, day)
 * — enforced by `attendance_tenant_emp_day_uq`. A second call for the same
 * day merges: provided fields win, omitted times keep their stored value, so
 * a check-in in the morning and a check-out in the evening form one record.
 * The merged row must still satisfy check-out > check-in, otherwise the whole
 * write rolls back.
 */
export async function recordAttendance(db: AnyPgDatabase, tenantId: string, input: unknown): Promise<AttendanceView> {
  const data = parse(recordAttendanceInputSchema, input);
  return withTenant(db, tenantId, async (tx: any) => {
    // RLS hides other tenants' employees, so their ids are simply "not found";
    // the composite FK (tenant_id, employee_id) is a second, database-level guard.
    if (!(await loadEmployee(tx, data.employeeId, { activeOnly: true }))) throw notFound();

    const [existing] = await tx
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.employeeId, data.employeeId), eq(attendanceRecords.day, data.day)))
      .limit(1);

    const clearsTimes = NO_TIMES.includes(data.status);
    const merged = {
      checkIn: clearsTimes ? null : (data.checkIn ?? existing?.checkIn ?? null),
      checkOut: clearsTimes ? null : (data.checkOut ?? existing?.checkOut ?? null),
      status: data.status,
    };
    if (merged.checkIn && merged.checkOut && !isCheckoutAfterCheckin(merged.checkIn, merged.checkOut)) {
      throw new DomainError('invalid_attendance', 'وقت الانصراف يجب أن يكون بعد وقت الحضور', {
        checkIn: merged.checkIn,
        checkOut: merged.checkOut,
      });
    }
    if (merged.checkOut && !merged.checkIn) {
      throw new DomainError('invalid_attendance', 'لا يمكن تسجيل انصراف بدون حضور', { checkOut: merged.checkOut });
    }

    const [row] = existing
      ? await tx.update(attendanceRecords).set(merged).where(eq(attendanceRecords.id, existing.id)).returning()
      : await tx.insert(attendanceRecords).values({ tenantId, employeeId: data.employeeId, day: data.day, ...merged }).returning();
    return toAttendance(row);
  });
}

function monthBounds(month: string): { first: string; last: string } {
  return { first: `${month}-01`, last: `${month}-31` }; // `day` is text YYYY-MM-DD ⇒ lexical range is exact
}

export async function listAttendance(
  db: AnyPgDatabase,
  tenantId: string,
  query: { employeeId: string; month: string },
): Promise<AttendanceView[]> {
  const month = parse(monthSchema, query.month);
  return withTenant(db, tenantId, async (tx: any) => {
    if (!(await loadEmployee(tx, query.employeeId, { activeOnly: false }))) throw notFound();
    const { first, last } = monthBounds(month);
    const rows = await tx
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.employeeId, query.employeeId), gte(attendanceRecords.day, first), lte(attendanceRecords.day, last)))
      .orderBy(asc(attendanceRecords.day));
    return rows.map(toAttendance);
  });
}

/* ---------------- payroll (computed, read-only) ---------------- */

/**
 * Next installment of a loan from its schedule (`loanSchedule`), located by the
 * amount already repaid. If the repaid amount does not line up with the
 * schedule (manual adjustment), fall back to the regular installment capped at
 * what remains — never more than is owed.
 */
export function nextLoanInstallment(totalMinor: number, months: number, remainingMinor: number): number {
  if (remainingMinor <= 0) return 0;
  const schedule = loanSchedule(totalMinor, months);
  let repaid = totalMinor - remainingMinor;
  for (const installment of schedule) {
    if (repaid === 0) return Math.min(installment, remainingMinor);
    if (repaid < 0) break;
    repaid -= installment;
  }
  return Math.min(schedule[0] ?? remainingMinor, remainingMinor);
}

export interface MonthlyPayslip {
  employee: EmployeeView;
  month: string;
  attendance: { recordedDays: number; absentDays: number; lateMinutes: number; overtimeMinutes: number };
  loanInstallmentMinor: number;
  payslip: Payslip;
}

/**
 * Compute (do not persist) an employee's payslip for a month from recorded
 * attendance, active loans and the supplied tenant policy. Only explicit
 * ABSENT records count as absence — unrecorded days are not assumed absent.
 */
export async function computeMonthlyPayslip(
  db: AnyPgDatabase,
  tenantId: string,
  query: { employeeId: string; month: string; policy: PayPolicy },
): Promise<MonthlyPayslip> {
  const month = parse(monthSchema, query.month);
  const policy = parse(payPolicySchema, query.policy);
  return withTenant(db, tenantId, async (tx: any) => {
    const employee = await loadEmployee(tx, query.employeeId, { activeOnly: false });
    if (!employee) throw notFound();
    const { first, last } = monthBounds(month);
    const days: Array<typeof attendanceRecords.$inferSelect> = await tx
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.employeeId, employee.id), gte(attendanceRecords.day, first), lte(attendanceRecords.day, last)));
    const openLoans: Array<typeof loans.$inferSelect> = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.employeeId, employee.id), gt(loans.remainingMinor, 0)));

    let absentDays = 0;
    let lateMinutes = 0;
    let overtimeMinutes = 0;
    for (const d of days) {
      if (d.status === 'ABSENT') absentDays += 1;
      if (d.status !== 'PRESENT' && d.status !== 'LATE') continue;
      lateMinutes += computeLateMinutes(policy.scheduledStart, d.checkIn ?? undefined);
      overtimeMinutes += computeOvertimeMinutes(d.checkIn ?? undefined, d.checkOut ?? undefined, policy.standardMinutes);
    }
    const loanInstallmentMinor = openLoans.reduce((sum, l) => sum + nextLoanInstallment(l.totalMinor, l.months, l.remainingMinor), 0);

    const payslip = computePayslip({
      baseSalaryMinor: employee.baseSalaryMinor,
      workingDaysInMonth: policy.workingDaysInMonth,
      absentDays,
      lateMinutes,
      lateRatePerMinuteMinor: policy.lateRatePerMinuteMinor,
      overtimeMinutes,
      overtimeRatePerMinuteMinor: policy.overtimeRatePerMinuteMinor,
      loanInstallmentMinor,
      otherDeductionsMinor: policy.otherDeductionsMinor,
      allowancesMinor: policy.allowancesMinor,
    });
    return {
      employee: toEmployee(employee),
      month,
      attendance: { recordedDays: days.length, absentDays, lateMinutes, overtimeMinutes },
      loanInstallmentMinor,
      payslip,
    };
  });
}
