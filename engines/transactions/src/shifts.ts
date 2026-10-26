/**
 * Cash shifts — open / close with reconciliation.
 * Append-only, tenant-isolated, idempotent.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { cashMovements, cashShiftClosures, cashShifts } from './db/schema.js';
import { DomainError } from './line.js';

export interface ShiftActor { tenantId: string; userId: string; }

export interface OpenShiftInput {
  registerCode?: string; // default main
  openingMinor: number;
  idempotencyKey: string;
}

export interface CloseShiftInput {
  shiftId: string;
  countedMinor: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashOpen(input: { registerCode: string; openingMinor: number }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: any = err; e; e = e.cause) if (e.code === '23505' && (!e.constraint || e.constraint === constraint)) return true;
  return false;
}

function advisoryKey(str: string): number {
  // 32-bit hash for pg_advisory_xact_lock (single int argument expects bigint, but we use int hash)
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) >>> 0;
  return h;
}
/**
 * The ONE advisory-lock key for every cash operation on a shift: cash sale
 * (checkout), cash refund and close. They must share it, or a sale can commit
 * into a shift whose closure has already summed the movements without it.
 * (Row locks are unavailable: nile_app has no UPDATE, which FOR UPDATE needs.)
 */
export function shiftLockKey(tenantId: string, shiftId: string): number {
  return advisoryKey(`shift:${tenantId}:${shiftId}`);
}

/** Serialises cash operations on one shift until the transaction ends. */
export async function lockShift(tx: any, tenantId: string, shiftId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${shiftLockKey(tenantId, shiftId)})`);
}

async function advisoryLock(tx: any, key: string) {
  const k = advisoryKey(key);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${k})`);
}

export async function openShift(db: AnyPgDatabase, actor: ShiftActor, input: OpenShiftInput) {
  const registerCode = input.registerCode ?? 'main';
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError('invalid_idempotency_key', 'مفتاح العملية مطلوب');
  if (input.openingMinor < 0 || input.openingMinor > 30_000_000_00) throw new DomainError('invalid_amount', 'مبلغ الافتتاح غير صالح');
  const hash = hashOpen({ registerCode, openingMinor: input.openingMinor });

  const findPrior = async (tx: any) => {
    const [h] = await tx.select({ id: cashShifts.id, requestHash: cashShifts.requestHash }).from(cashShifts).where(eq(cashShifts.idempotencyKey, input.idempotencyKey)).limit(1);
    return h as { id: string; requestHash: string } | undefined;
  };
  const loadView = async (tx: any, id: string) => {
    const [r] = await tx.select().from(cashShifts).where(eq(cashShifts.id, id)).limit(1);
    return r ? { id: r.id, registerCode: r.registerCode, openingMinor: r.openingMinor, openedAt: r.openedAt, openedBy: r.openedBy } : null;
  };

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      await advisoryLock(tx, `shift-open:${actor.tenantId}:${registerCode}`);
      const prior = await findPrior(tx);
      if (prior) {
        if (prior.requestHash !== hash) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
        const v = await loadView(tx, prior.id);
        return { shift: v, replayed: true };
      }
      // Enforce single open shift per register: if there's an open shift (no closure), reject
      const openShifts = await tx
        .select({ id: cashShifts.id })
        .from(cashShifts)
        .where(and(eq(cashShifts.tenantId, actor.tenantId), eq(cashShifts.registerCode, registerCode)));
      // Filter to those without closure — do existence check per shift
      for (const s of openShifts) {
        const [c] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, s.id)).limit(1);
        if (!c) {
          // There's still an open shift for this register
          throw new DomainError('shift_already_open', 'يوجد وردية مفتوحة لهذا الجهاز');
        }
      }

      const [row] = await tx.insert(cashShifts).values({ tenantId: actor.tenantId, registerCode, openedBy: actor.userId, openingMinor: input.openingMinor, idempotencyKey: input.idempotencyKey, requestHash: hash }).returning({ id: cashShifts.id });
      const v = await loadView(tx, row.id);
      return { shift: v, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'cash_shifts_tenant_idem_uq')) {
      return withTenant(db, actor.tenantId, async (tx: any) => {
        const prior = await findPrior(tx);
        if (!prior) throw err;
        if (prior.requestHash !== hash) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
        const v = await loadView(tx, prior.id);
        return { shift: v, replayed: true };
      });
    }
    throw err;
  }
}

export async function closeShift(db: AnyPgDatabase, actor: ShiftActor, input: CloseShiftInput) {
  if (!UUID_RE.test(input.shiftId)) throw new DomainError('invalid_shift', 'معرف الوردية غير صالح');
  if (input.countedMinor < 0 || input.countedMinor > 100_000_000_00) throw new DomainError('invalid_amount', 'المبلغ المعدود غير صالح');

  return withTenant(db, actor.tenantId, async (tx: any) => {
    await lockShift(tx, actor.tenantId, input.shiftId);
    const [shift] = await tx.select().from(cashShifts).where(and(eq(cashShifts.id, input.shiftId), eq(cashShifts.tenantId, actor.tenantId))).limit(1);
    if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
    const [already] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId)).limit(1);
    if (already) throw new DomainError('shift_already_closed', 'الوردية مغلقة بالفعل');

    // Expected = opening + sum(in posted) - sum(out posted)
    const [sums] = await tx
      .select({
        sumIn: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='in' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
        sumOut: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='out' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
      })
      .from(cashMovements)
      .where(and(eq(cashMovements.tenantId, actor.tenantId), eq(cashMovements.shiftId, input.shiftId), eq(cashMovements.status, 'posted')));
    const expectedMinor = (shift.openingMinor as number) + Number(sums?.sumIn ?? 0) - Number(sums?.sumOut ?? 0);
    const differenceMinor = input.countedMinor - expectedMinor;

    const [closure] = await tx
      .insert(cashShiftClosures)
      .values({ tenantId: actor.tenantId, shiftId: input.shiftId, countedMinor: input.countedMinor, expectedMinor, differenceMinor, closedBy: actor.userId })
      .returning({ id: cashShiftClosures.id, shiftId: cashShiftClosures.shiftId, countedMinor: cashShiftClosures.countedMinor, expectedMinor: cashShiftClosures.expectedMinor, differenceMinor: cashShiftClosures.differenceMinor, closedAt: cashShiftClosures.closedAt });

    return {
      closure: {
        id: closure.id,
        shiftId: closure.shiftId,
        openingMinor: shift.openingMinor,
        expectedMinor: closure.expectedMinor,
        countedMinor: closure.countedMinor,
        differenceMinor: closure.differenceMinor,
        closedAt: closure.closedAt,
      },
    };
  });
}

/** Shared shift view: header + closure (if any) + server-expected drawer cash. */
async function loadShiftView(tx: any, tenantId: string, shift: any, closure: any) {
  const [sums] = await tx
    .select({
      sumIn: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='in' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
      sumOut: sql<number>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='out' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
    })
    .from(cashMovements)
    .where(and(eq(cashMovements.tenantId, tenantId), eq(cashMovements.shiftId, shift.id), eq(cashMovements.status, 'posted')));
  const expected = (shift.openingMinor as number) + Number(sums?.sumIn ?? 0) - Number(sums?.sumOut ?? 0);
  return {
    id: shift.id as string,
    registerCode: shift.registerCode as string,
    openingMinor: shift.openingMinor as number,
    openedAt: shift.openedAt as Date,
    openedBy: shift.openedBy as string,
    isClosed: !!closure,
    closure: closure ? { countedMinor: closure.countedMinor, expectedMinor: closure.expectedMinor, differenceMinor: closure.differenceMinor, closedAt: closure.closedAt, closedBy: closure.closedBy } : null,
    expectedMinor: expected,
  };
}

export async function getShift(db: AnyPgDatabase, tenantId: string, shiftId: string) {
  if (!UUID_RE.test(shiftId)) return null;
  return withTenant(db, tenantId, async (tx: any) => {
    const [shift] = await tx.select().from(cashShifts).where(eq(cashShifts.id, shiftId)).limit(1);
    if (!shift) return null;
    const [closure] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, shiftId)).limit(1);
    return loadShiftView(tx, tenantId, shift, closure ?? null);
  });
}

/**
 * The currently-open shift for one register (G-02) — how a fresh device or a
 * cleared browser session re-attaches to the shift that is already open on
 * the server instead of being locked out of cash sales. Tenant comes from
 * the caller's server-side context only (RLS + explicit filter); the
 * register code merely selects WHICH register of that same tenant.
 * Returns null when no shift is open for the register.
 */
export async function getCurrentShift(db: AnyPgDatabase, tenantId: string, registerCode = 'main') {
  return withTenant(db, tenantId, async (tx: any) => {
    const rows = await tx
      .select({ shift: cashShifts, closureId: cashShiftClosures.id })
      .from(cashShifts)
      .leftJoin(cashShiftClosures, eq(cashShiftClosures.shiftId, cashShifts.id))
      .where(and(eq(cashShifts.tenantId, tenantId), eq(cashShifts.registerCode, registerCode), sql`${cashShiftClosures.id} IS NULL`))
      .orderBy(sql`${cashShifts.openedAt} DESC`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return loadShiftView(tx, tenantId, row.shift, null);
  });
}

