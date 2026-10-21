/**
 * Payments — settle a sale after it was rung up, and read its derived payment status.
 *
 * Contract: docs/architecture/proposals/0007-payment-engine.md §3 I5, I6, I10, §5
 * (`recordPayment`, `getPaymentStatus`).
 *
 * `checkout` settles a sale at the counter in one transaction. `recordPayment` covers the rest of the
 * business: a deposit, a balance paid on delivery, a booking paid in two parts. It is the same money
 * model — a `payments` row plus, for cash, a `cash_movements` row in an open shift.
 *
 * Payment status is DERIVED (I10). It is never stored, so two callers can never disagree and no
 * migration can leave a stale status behind. This file is the only implementation of the derivation.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { cashMovements, cashShiftClosures, cashShifts, payments, refunds, salesTransactions } from './db/schema.js';
import { DomainError } from './line.js';
import { lockShift } from './shifts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TENDER_METHODS = ['cash', 'card', 'wallet', 'transfer'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export interface PaymentActor {
  tenantId: string;
  userId: string;
}

export interface TenderInput {
  method: TenderMethod;
  /** The part of the sale this tender covers. */
  amountMinor: number;
  /** Cash only: what the customer handed over. */
  tenderedMinor?: number;
  externalRef?: string;
}

export interface RecordPaymentInput {
  idempotencyKey: string;
  transactionId: string;
  tender: TenderInput;
  /** Required when the tender is cash. */
  shiftId?: string;
}

/** I10 — the closed set. Nothing outside this union is a payment status. */
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded';

export interface PaymentStatusView {
  transactionId: string;
  totalMinor: number;
  /** Σ payments recorded against the sale. */
  paidMinor: number;
  /** Σ refunds recorded against the sale. */
  refundedMinor: number;
  /** paid − refunded: what the shop actually kept. */
  netPaidMinor: number;
  /** total − netPaid, floored at zero: what the customer still owes. */
  outstandingMinor: number;
  status: PaymentStatus;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: any = err; e; e = e.cause) if (e.code === '23505' && (!e.constraint || e.constraint === constraint)) return true;
  return false;
}

function advisoryKey(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) >>> 0;
  return h;
}

/** One lock family for every money write against a sale: settle, pay later, refund. */
async function lockSale(tx: any, tenantId: string, transactionId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${advisoryKey(`sale-money:${tenantId}:${transactionId}`)})`);
}

/**
 * The single derivation. `status` is a pure function of the three sums, so it cannot drift
 * from the rows that produced it.
 */
export function derivePaymentStatus(totalMinor: number, paidMinor: number, refundedMinor: number): PaymentStatus {
  const netPaid = paidMinor - refundedMinor;
  if (paidMinor === 0) return 'unpaid';
  if (refundedMinor > 0) return netPaid <= 0 ? 'refunded' : 'partially_refunded';
  return netPaid >= totalMinor ? 'paid' : 'partially_paid';
}

/**
 * The transaction-scoped core. Every caller inside an open transaction MUST use this one:
 * `withTenant` opens a new connection scope, and opening one inside another deadlocks on a
 * single-connection engine (PGlite), which is exactly how this module first failed its tests.
 */
async function paymentStatusTx(tx: any, tenantId: string, transactionId: string): Promise<PaymentStatusView | null> {
  {
    const [sale] = await tx
      .select({ id: salesTransactions.id, totalMinor: salesTransactions.totalMinor })
      .from(salesTransactions)
      .where(and(eq(salesTransactions.id, transactionId), eq(salesTransactions.tenantId, tenantId)))
      .limit(1);
    if (!sale) return null;

    const [paidRow] = await tx
      .select({ sum: sql<number>`COALESCE(SUM(${payments.amountMinor}),0)` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.transactionId, transactionId)));
    const [refundRow] = await tx
      .select({ sum: sql<number>`COALESCE(SUM(${refunds.amountMinor}),0)` })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.transactionId, transactionId)));

    const totalMinor = Number(sale.totalMinor);
    const paidMinor = Number(paidRow?.sum ?? 0);
    const refundedMinor = Number(refundRow?.sum ?? 0);
    const netPaidMinor = paidMinor - refundedMinor;
    return {
      transactionId,
      totalMinor,
      paidMinor,
      refundedMinor,
      netPaidMinor,
      outstandingMinor: Math.max(0, totalMinor - netPaidMinor),
      status: derivePaymentStatus(totalMinor, paidMinor, refundedMinor),
    };
  }
}

export async function getPaymentStatus(
  db: AnyPgDatabase,
  tenantId: string,
  transactionId: string,
): Promise<PaymentStatusView | null> {
  if (!UUID_RE.test(transactionId)) return null;
  return withTenant(db, tenantId, (tx: any) => paymentStatusTx(tx, tenantId, transactionId));
}

/**
 * Settle part or all of an existing sale. Cash tenders need an open shift, exactly like checkout.
 * Idempotent per tenant: the same key with the same body replays; a different body is a conflict.
 */
export async function recordPayment(db: AnyPgDatabase, actor: PaymentActor, input: RecordPaymentInput) {
  if (!actor?.tenantId || !UUID_RE.test(actor.tenantId) || !UUID_RE.test(actor.userId)) {
    throw new DomainError('invalid_actor', 'سياق المستخدم غير صالح');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError('invalid_idempotency_key', 'مفتاح العملية مطلوب');
  if (!UUID_RE.test(input.transactionId)) throw new DomainError('invalid_transaction', 'معرف الفاتورة غير صالح');
  const t = input.tender;
  if (!t || !TENDER_METHODS.includes(t.method)) throw new DomainError('invalid_method', 'طريقة دفع غير صالحة');
  if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) throw new DomainError('invalid_amount', 'مبلغ الدفع غير صالح');
  if (t.method !== 'cash' && (t.tenderedMinor !== undefined || (t as any).changeMinor !== undefined)) {
    throw new DomainError('change_only_cash', 'الباقي للكاش فقط');
  }
  if (t.method === 'cash' && !input.shiftId) throw new DomainError('shift_required_for_cash', 'البيع النقدي يحتاج وردية مفتوحة');
  if (t.tenderedMinor !== undefined && (!Number.isSafeInteger(t.tenderedMinor) || t.tenderedMinor < t.amountMinor)) {
    throw new DomainError('invalid_tendered', 'المبلغ المستلم غير صالح');
  }

  const change = t.method === 'cash' && t.tenderedMinor !== undefined ? t.tenderedMinor - t.amountMinor : null;
  const hash = createHash('sha256')
    .update(JSON.stringify({ transactionId: input.transactionId, tender: t, shiftId: input.shiftId ?? null }))
    .digest('hex');

  const replay = async (tx: any) => {
    const [prior] = await tx
      .select({ id: payments.id, requestHash: payments.requestHash, amountMinor: payments.amountMinor })
      .from(payments)
      .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (!prior) return null;
    if (prior.requestHash !== hash) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
    const view = await paymentStatusTx(tx, actor.tenantId, input.transactionId);
    return { paymentId: prior.id as string, amountMinor: prior.amountMinor as number, replayed: true, sale: view };
  };

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      await lockSale(tx, actor.tenantId, input.transactionId);

      const early = await replay(tx);
      if (early) return early;

      const [sale] = await tx
        .select()
        .from(salesTransactions)
        .where(and(eq(salesTransactions.id, input.transactionId), eq(salesTransactions.tenantId, actor.tenantId)))
        .limit(1);
      if (!sale) throw new DomainError('sale_not_found', 'الفاتورة غير موجودة');
      if (sale.kind !== 'sale') throw new DomainError('invalid_transaction', 'الفاتورة ليست عملية بيع');

      if (t.method === 'cash') {
        const [shift] = await tx
          .select()
          .from(cashShifts)
          .where(and(eq(cashShifts.id, input.shiftId as string), eq(cashShifts.tenantId, actor.tenantId)))
          .limit(1);
        if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
        const [closed] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId as string)).limit(1);
        if (closed) throw new DomainError('shift_closed', 'الوردية مغلقة');
        await lockShift(tx, actor.tenantId, input.shiftId as string);
      }

      const [paidRow] = await tx
        .select({ sum: sql<number>`COALESCE(SUM(${payments.amountMinor}),0)` })
        .from(payments)
        .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.transactionId, input.transactionId)));
      const [refundRow] = await tx
        .select({ sum: sql<number>`COALESCE(SUM(${refunds.amountMinor}),0)` })
        .from(refunds)
        .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.transactionId, input.transactionId)));
      const paid = Number(paidRow?.sum ?? 0);
      const refunded = Number(refundRow?.sum ?? 0);
      const outstanding = Math.max(0, Number(sale.totalMinor) - (paid - refunded));
      if (t.amountMinor > outstanding) {
        throw new DomainError(
          'payment_exceeds_outstanding',
          `المبلغ المطلوب (${t.amountMinor}) يتجاوز المتبقي على الفاتورة (${outstanding})`,
        );
      }

      const [pay] = await tx
        .insert(payments)
        .values({
          tenantId: actor.tenantId,
          transactionId: input.transactionId,
          method: t.method,
          amountMinor: t.amountMinor,
          tenderedMinor: t.tenderedMinor ?? null,
          changeMinor: change,
          externalRef: t.externalRef ?? null,
          shiftId: t.method === 'cash' ? (input.shiftId as string) : null,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          createdBy: actor.userId,
        })
        .returning({ id: payments.id });

      if (t.method === 'cash') {
        const inAmount = t.tenderedMinor ?? t.amountMinor;
        await tx.insert(cashMovements).values({
          tenantId: actor.tenantId,
          shiftId: input.shiftId as string,
          direction: 'in',
          status: 'posted',
          amountMinor: inAmount,
          paymentId: pay.id,
        });
        if (change !== null && change > 0) {
          await tx.insert(cashMovements).values({
            tenantId: actor.tenantId,
            shiftId: input.shiftId as string,
            direction: 'out',
            status: 'posted',
            amountMinor: change,
            paymentId: pay.id,
          });
        }
      }

      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'record_payment',
        entity: 'payments',
        entityId: pay.id,
        payload: JSON.stringify({ transactionId: input.transactionId, amountMinor: t.amountMinor, method: t.method }),
      });

      const view = await paymentStatusTx(tx, actor.tenantId, input.transactionId);
      return { paymentId: pay.id as string, amountMinor: t.amountMinor, replayed: false, sale: view };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'payments_tenant_idem_uq')) {
      return withTenant(db, actor.tenantId, async (tx: any) => {
        const prior = await replay(tx);
        if (!prior) throw err;
        return prior;
      });
    }
    throw err;
  }
}
