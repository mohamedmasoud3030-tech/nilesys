/**
 * Payments engine — shifts, tenders and refunds (proposal 0007).
 *
 * Design constraints that shape every function here:
 *
 *  - APPEND-ONLY. Migration 0004 revokes UPDATE and DELETE from nile_app on all
 *    five payments tables. Nothing here updates a row; closing a shift or
 *    refunding inserts a new one.
 *  - NO ROW LOCKS. PostgreSQL requires UPDATE privilege for SELECT … FOR
 *    UPDATE/SHARE and the runtime role has none (proposal 0007 fact F5).
 *    Cross-row invariants are serialised with a transaction-scoped ADVISORY
 *    lock instead.
 *  - IDEMPOTENT. Every write carries (idempotencyKey, requestHash). A replay
 *    with the same body returns the original row; the same key with a
 *    different body is a conflict.
 *  - ONE tenant-scoped transaction per operation (withTenant ⇒ RLS active).
 *    Any failure rolls back everything.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { salesTransactions } from './db/schema.js';
import {
  cashShifts, paymentTenders, payments, refunds, shiftClosures,
  TENDER_METHODS, type TenderMethod,
} from './db/payments-schema.js';
import { DomainError } from './line.js';

export interface PaymentActor { tenantId: string; userId: string }

export interface OpenShiftInput { register?: string; openingFloatMinor?: number; idempotencyKey: string }
export interface CloseShiftInput { shiftId: string; countedMinor: number; idempotencyKey: string }
export interface TenderInput { method: TenderMethod; amountMinor: number; changeMinor?: number; externalRef?: string }
export interface RecordPaymentInput { saleId: string; shiftId: string; tenders: TenderInput[]; idempotencyKey: string }
export interface RecordRefundInput { paymentId: string; amountMinor: number; method: TenderMethod; reason?: string; idempotencyKey: string }

const METHOD_SET: ReadonlySet<string> = new Set(TENDER_METHODS);

function hashOf(v: unknown): string {
  return createHash('sha256').update(JSON.stringify(v)).digest('hex');
}

/** True when a unique-constraint violation names `constraint`. */
function isUnique(err: unknown, constraint?: string): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e.code === '23505' && (!constraint || !e.constraint || e.constraint === constraint)) return true;
  }
  return false;
}

/**
 * Serialise operations on one logical key inside the current transaction.
 * Row locks are unavailable to the runtime role, so an advisory lock is the
 * only serialisation primitive it has. Transaction-scoped: released on commit
 * or rollback, so it cannot leak.
 */
function advisoryLock(tx: any, key: string) {
  return tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`);
}

async function findPrior(tx: any, table: any, key: string): Promise<{ id: string; requestHash: string } | undefined> {
  const [row] = await tx
    .select({ id: table.id, requestHash: table.requestHash })
    .from(table)
    .where(eq(table.idempotencyKey, key))
    .limit(1);
  return row as { id: string; requestHash: string } | undefined;
}

function replayOrConflict(prior: { id: string; requestHash: string } | undefined, hash: string) {
  if (!prior) return false;
  if (prior.requestHash !== hash) {
    throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
  }
  return true;
}

/* ------------------------------------------------------------------ shifts */

export async function openShift(db: AnyPgDatabase, actor: PaymentActor, input: OpenShiftInput) {
  const register = input.register ?? 'main';
  const openingFloatMinor = input.openingFloatMinor ?? 0;
  if (!Number.isSafeInteger(openingFloatMinor) || openingFloatMinor < 0) {
    throw new DomainError('invalid_float', 'الرصيد الافتتاحي لازم يكون عددًا صحيحًا غير سالب');
  }
  const hash = hashOf({ register, openingFloatMinor });

  return withTenant(db, actor.tenantId, async (tx: any) => {
    // Two concurrent openShift calls on the same register must yield exactly
    // one open shift (acceptance test 5). Serialise on the register, then let
    // the database decide.
    await advisoryLock(tx, `shift:${actor.tenantId}:${register}`);

    const prior = await findPrior(tx, cashShifts, input.idempotencyKey);
    if (replayOrConflict(prior, hash)) {
      const [s] = await tx.select().from(cashShifts).where(eq(cashShifts.id, prior!.id)).limit(1);
      return { shift: s, replayed: true };
    }

    // A register may hold at most one OPEN shift. "Open" = no closure row.
    const [open] = await tx
      .select({ id: cashShifts.id })
      .from(cashShifts)
      .leftJoin(shiftClosures, eq(shiftClosures.shiftId, cashShifts.id))
      .where(and(eq(cashShifts.register, register), sql`${shiftClosures.id} IS NULL`))
      .limit(1);
    if (open) {
      throw new DomainError('shift_already_open', 'فيه وردية مفتوحة بالفعل على هذا الصندوق');
    }

    const [shift] = await tx.insert(cashShifts).values({
      tenantId: actor.tenantId,
      register,
      openingFloatMinor,
      openedBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    }).returning();
    return { shift, replayed: false };
  });
}

/**
 * Drawer expectation computed INSIDE an existing transaction. Kept separate
 * from expectedInDrawer so callers that are already in a transaction (close
 * shift) never nest a second withTenant — nesting would open a second
 * connection and deadlock on single-connection backends such as PGlite.
 */
async function computeExpectedInDrawer(tx: any, shiftId: string): Promise<number> {
  const [s] = await tx.select().from(cashShifts).where(eq(cashShifts.id, shiftId)).limit(1);
  if (!s) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
  const [taken] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${paymentTenders.amountMinor} - ${paymentTenders.changeMinor}), 0)` })
    .from(paymentTenders)
    .innerJoin(payments, eq(payments.id, paymentTenders.paymentId))
    .where(and(eq(payments.shiftId, shiftId), eq(paymentTenders.method, 'cash')));
  const [refunded] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${refunds.amountMinor}), 0)` })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(eq(payments.shiftId, shiftId), eq(refunds.method, 'cash')));
  return s.openingFloatMinor + Number(taken!.total) - Number(refunded!.total);
}

/**
 * Expected cash in the drawer for a shift: opening float + cash taken
 * (amount − change) − cash already refunded. Non-cash tenders never touch the
 * drawer, and pending cash is excluded from posted revenue (cash.ts rule).
 */
export async function expectedInDrawer(db: AnyPgDatabase, actor: PaymentActor, shiftId: string): Promise<number> {
  return withTenant(db, actor.tenantId, (tx: any) => computeExpectedInDrawer(tx, shiftId));
}

export async function closeShift(db: AnyPgDatabase, actor: PaymentActor, input: CloseShiftInput) {
  if (!Number.isSafeInteger(input.countedMinor) || input.countedMinor < 0) {
    throw new DomainError('invalid_count', 'المبلغ المعدود لازم يكون عددًا صحيحًا غير سالب');
  }
  const hash = hashOf({ shiftId: input.shiftId, countedMinor: input.countedMinor });

  return withTenant(db, actor.tenantId, async (tx: any) => {
    await advisoryLock(tx, `shift:${actor.tenantId}:${input.shiftId}`);

    const prior = await findPrior(tx, shiftClosures, input.idempotencyKey);
    if (replayOrConflict(prior, hash)) {
      const [c] = await tx.select().from(shiftClosures).where(eq(shiftClosures.id, prior!.id)).limit(1);
      return { closure: c, replayed: true };
    }

    const [s] = await tx.select().from(cashShifts).where(eq(cashShifts.id, input.shiftId)).limit(1);
    if (!s) throw new DomainError('shift_not_found', 'الوردية غير موجودة');

    const expectedMinor = await computeExpectedInDrawer(tx, input.shiftId);
    const differenceMinor = input.countedMinor - expectedMinor;

    try {
      const [closure] = await tx.insert(shiftClosures).values({
        tenantId: actor.tenantId,
        shiftId: input.shiftId,
        countedMinor: input.countedMinor,
        expectedMinor,
        differenceMinor,
        countedBy: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
      }).returning();
      return { closure, replayed: false };
    } catch (err) {
      // UNIQUE (tenant_id, shift_id) — the shift was already closed with a
      // different key. That is a conflict, not a replay.
      if (isUnique(err, 'shift_closures_tenant_shift_uq')) {
        throw new DomainError('shift_already_closed', 'الوردية اتقفلت بالفعل');
      }
      throw err;
    }
  });
}

/* --------------------------------------------------------------- payments */

/**
 * Validate tenders and return the settled amount. Split tender is several
 * rows; the cash handed back is `changeMinor`, so what settles the sale is
 * Σ(amount − change). Invariant I1: that sum must equal the payment total
 * exactly, in integer minor units — no floating point anywhere.
 */
export function settleTenders(tenders: readonly TenderInput[]): { totalMinor: number } {
  if (tenders.length === 0) throw new DomainError('no_tenders', 'لازم طريقة دفع واحدة على الأقل');
  let total = 0;
  for (const t of tenders) {
    if (!METHOD_SET.has(t.method)) throw new DomainError('unknown_method', `طريقة دفع غير معروفة: ${t.method}`);
    if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) {
      throw new DomainError('invalid_amount', 'المبلغ لازم يكون عددًا صحيحًا موجبًا');
    }
    const change = t.changeMinor ?? 0;
    if (!Number.isSafeInteger(change) || change < 0) {
      throw new DomainError('invalid_change', 'الباقي لازم يكون عددًا صحيحًا غير سالب');
    }
    if (change > t.amountMinor) throw new DomainError('change_exceeds_amount', 'الباقي أكبر من المدفوع');
    if (t.method !== 'cash' && change > 0) throw new DomainError('change_only_for_cash', 'الباقي للنقد فقط');
    total += t.amountMinor - change;
  }
  if (total <= 0) throw new DomainError('zero_settlement', 'مجموع الدفع صفر');
  return { totalMinor: total };
}

export async function recordPayment(db: AnyPgDatabase, actor: PaymentActor, input: RecordPaymentInput) {
  const normalised = input.tenders.map((t) => ({
    method: t.method, amountMinor: t.amountMinor, changeMinor: t.changeMinor ?? 0, externalRef: t.externalRef ?? null,
  }));
  const { totalMinor } = settleTenders(input.tenders);
  const hash = hashOf({ saleId: input.saleId, shiftId: input.shiftId, tenders: normalised });

  return withTenant(db, actor.tenantId, async (tx: any) => {
    await advisoryLock(tx, `payment:${actor.tenantId}:${input.saleId}`);

    const prior = await findPrior(tx, payments, input.idempotencyKey);
    if (replayOrConflict(prior, hash)) {
      const [p] = await tx.select().from(payments).where(eq(payments.id, prior!.id)).limit(1);
      const ts = await tx.select().from(paymentTenders).where(eq(paymentTenders.paymentId, prior!.id));
      return { payment: p, tenders: ts, replayed: true };
    }

    // The sale must exist and belong to this tenant. RLS makes another
    // tenant's sale simply absent, so this is also the cross-tenant guard.
    const [sale] = await tx
      .select({ id: salesTransactions.id, totalMinor: salesTransactions.totalMinor })
      .from(salesTransactions)
      .where(eq(salesTransactions.id, input.saleId))
      .limit(1);
    if (!sale) throw new DomainError('sale_not_found', 'العملية غير موجودة');

    const [shift] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(eq(cashShifts.id, input.shiftId)).limit(1);
    if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');

    // Overpayment is refused: a payment may not exceed what the sale costs.
    if (totalMinor > sale.totalMinor) throw new DomainError('overpayment', 'المبلغ المدفوع أكبر من قيمة العملية');

    const [payment] = await tx.insert(payments).values({
      tenantId: actor.tenantId,
      saleId: input.saleId,
      shiftId: input.shiftId,
      totalMinor,
      createdBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    }).returning();

    const rows = await tx.insert(paymentTenders).values(
      normalised.map((t) => ({ tenantId: actor.tenantId, paymentId: payment!.id, method: t.method, amountMinor: t.amountMinor, changeMinor: t.changeMinor, externalRef: t.externalRef })),
    ).returning();

    return { payment, tenders: rows, replayed: false };
  });
}

/* ---------------------------------------------------------------- refunds */

/**
 * Refund against a payment. Partial refunds are several rows; the sum may
 * never exceed what the payment settled. That is a cross-row invariant, so it
 * is checked under an advisory lock on the payment — row locks are unavailable
 * to the runtime role (proposal 0007 fact F5).
 */
export async function recordRefund(db: AnyPgDatabase, actor: PaymentActor, input: RecordRefundInput) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new DomainError('invalid_amount', 'المبلغ لازم يكون عددًا صحيحًا موجبًا');
  }
  if (!METHOD_SET.has(input.method)) throw new DomainError('unknown_method', `طريقة دفع غير معروفة: ${input.method}`);
  const hash = hashOf({ paymentId: input.paymentId, amountMinor: input.amountMinor, method: input.method, reason: input.reason ?? null });

  return withTenant(db, actor.tenantId, async (tx: any) => {
    // Held for the whole transaction: two racing refunds on the same payment
    // serialise here, so the sum check below cannot be bypassed.
    await advisoryLock(tx, `refund:${actor.tenantId}:${input.paymentId}`);

    const prior = await findPrior(tx, refunds, input.idempotencyKey);
    if (replayOrConflict(prior, hash)) {
      const [r] = await tx.select().from(refunds).where(eq(refunds.id, prior!.id)).limit(1);
      return { refund: r, replayed: true };
    }

    const [payment] = await tx
      .select({ id: payments.id, totalMinor: payments.totalMinor })
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);
    if (!payment) throw new DomainError('payment_not_found', 'الدفعة غير موجودة');

    const [summed] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${refunds.amountMinor}), 0)` })
      .from(refunds)
      .where(eq(refunds.paymentId, input.paymentId));
    const already = Number(summed!.total);

    if (already + input.amountMinor > payment.totalMinor) {
      throw new DomainError('refund_exceeds_payment', 'المبلغ المرتجع أكبر من المدفوع');
    }

    const [refund] = await tx.insert(refunds).values({
      tenantId: actor.tenantId,
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      method: input.method,
      reason: input.reason ?? null,
      refundedBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    }).returning();
    return { refund, replayed: false };
  });
}
