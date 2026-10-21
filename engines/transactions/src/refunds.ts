/**
 * Refunds — partial/full linked to original sale/payment.
 * Invariants: cumulative refund ≤ payment amount, quantity ≤ original, stock restored atomically, idempotent, tenant-isolated.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShiftClosures, cashShifts, payments, refunds, salesTransactions, stockMovements, transactionLines } from './db/schema.js';
import { DomainError } from './line.js';
import { priceSale } from './sale.js';
import { lockShift } from './shifts.js';

export interface RefundActor { tenantId: string; userId: string; }
export interface RefundItem { variantId: string; quantity: string; }
export interface RefundInput {
  idempotencyKey: string;
  originalTransactionId: string;
  paymentId: string;
  items: RefundItem[]; // for stock restoration — must correspond to original sale lines
  reason?: string;
  shiftId?: string; // required if payment method is cash
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY_RE = /^\d{1,12}(\.\d{1,3})?$/;

function mergeRefundItems(items: RefundItem[]): { variantId: string; quantity: string }[] {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!UUID_RE.test(it.variantId)) throw new DomainError('invalid_variant', 'معرف الصنف غير صالح', { variantId: it.variantId });
    if (!QTY_RE.test(it.quantity) || Number(it.quantity) <= 0) throw new DomainError('invalid_quantity', 'الكمية غير صالحة', { quantity: it.quantity });
    const q = Number(it.quantity);
    map.set(it.variantId, (map.get(it.variantId) ?? 0) + q);
  }
  return Array.from(map.entries()).map(([variantId, qty]) => ({ variantId, quantity: qty.toFixed(3) })).sort((a, b) => a.variantId.localeCompare(b.variantId));
}

function hashRefund(input: { items: ReturnType<typeof mergeRefundItems>; paymentId: string; originalTransactionId: string; shiftId?: string }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
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
async function advisoryLock(tx: any, key: string) {
  const k = advisoryKey(key);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${k})`);
}

export async function createRefund(db: AnyPgDatabase, actor: RefundActor, input: RefundInput) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError('invalid_idempotency_key', 'مفتاح العملية مطلوب');
  if (!UUID_RE.test(input.originalTransactionId)) throw new DomainError('invalid_transaction', 'معرف الفاتورة غير صالح');
  if (!UUID_RE.test(input.paymentId)) throw new DomainError('invalid_payment', 'معرف الدفعة غير صالح');
  if (!input.items || input.items.length === 0) throw new DomainError('empty_refund', 'يجب تحديد الأصناف المراد إرجاعها');
  if (input.items.length > 200) throw new DomainError('too_many_items', 'عدد الأصناف كثير');
  if (input.shiftId && !UUID_RE.test(input.shiftId)) throw new DomainError('invalid_shift', 'معرف الوردية غير صالح');

  const merged = mergeRefundItems(input.items);
  const hash = hashRefund({ items: merged, paymentId: input.paymentId, originalTransactionId: input.originalTransactionId, shiftId: input.shiftId });

  const findPrior = async (tx: any) => {
    const [h] = await tx.select({ id: refunds.id, requestHash: refunds.requestHash }).from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
    return h as { id: string; requestHash: string } | undefined;
  };
  const loadRefund = async (tx: any, id: string) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, id)).limit(1);
    if (!r) return null;
    return { id: r.id, originalTransactionId: r.transactionId, paymentId: r.paymentId, amountMinor: r.amountMinor, reason: r.reason, shiftId: r.shiftId, createdAt: r.createdAt };
  };

  const replayOrConflict = async (tx: any) => {
    const prior = await findPrior(tx);
    if (!prior) return null;
    if (prior.requestHash !== hash) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
    const v = await loadRefund(tx, prior.id);
    return { refund: v, replayed: true };
  };

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      // Serialize every refund of the same SALE first: the quantity limit is per sale
      // (refunded stock movements of the transaction), so a per-payment lock alone let
      // two refunds of one unit through two payments of a split-tender sale both pass.
      // payment_mismatch below guarantees any refund touching this sale names it here.
      // Lock order is always sale -> payment -> shift (checkout/close take shift only): no cycle.
      // Advisory locks, not FOR UPDATE, which needs the UPDATE privilege nile_app lacks.
      await advisoryLock(tx, `refund-sale:${actor.tenantId}:${input.originalTransactionId}`);
      await advisoryLock(tx, `refund:${actor.tenantId}:${input.paymentId}`);
      if (input.shiftId) await lockShift(tx, actor.tenantId, input.shiftId);
      const replay = await replayOrConflict(tx);
      if (replay) return replay;

      // Load original sale + lines
      const [sale] = await tx.select().from(salesTransactions).where(and(eq(salesTransactions.id, input.originalTransactionId), eq(salesTransactions.tenantId, actor.tenantId))).limit(1);
      if (!sale) throw new DomainError('sale_not_found', 'الفاتورة الأصلية غير موجودة');
      const origLines = await tx.select().from(transactionLines).where(eq(transactionLines.transactionId, input.originalTransactionId));
      const origByVariant = new Map<string, typeof origLines[number]>();
      for (const l of origLines) origByVariant.set(l.variantId, l);

      // Load payment
      const [pay] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.tenantId, actor.tenantId))).limit(1);
      if (!pay) throw new DomainError('payment_not_found', 'الدفعة غير موجودة');
      if (pay.transactionId !== input.originalTransactionId) throw new DomainError('payment_mismatch', 'الدفعة لا تخص هذه الفاتورة');
      const isCash = pay.method === 'cash';

      // Shift check for cash refunds
      if (isCash) {
        if (!input.shiftId) throw new DomainError('shift_required_for_cash', 'الاسترجاع النقدي يحتاج وردية مفتوحة');
        const [shift] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(and(eq(cashShifts.id, input.shiftId as string), eq(cashShifts.tenantId, actor.tenantId))).limit(1);
        if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
        const [closed] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId as string)).limit(1);
        if (closed) throw new DomainError('shift_closed', 'الوردية مغلقة');
      } else if (input.shiftId) {
        // non-cash with shift supplied — allow but verify still open if provided
        const [shift] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(and(eq(cashShifts.id, input.shiftId as string), eq(cashShifts.tenantId, actor.tenantId))).limit(1);
        if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
        const [closed] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId as string)).limit(1);
        if (closed) throw new DomainError('shift_closed', 'الوردية مغلقة');
      }

      // Compute refund amount from merged items using original prices
      const priceInputs = merged.map((it) => {
        const orig = origByVariant.get(it.variantId);
        if (!orig) throw new DomainError('unknown_item', 'صنف غير موجود في الفاتورة الأصلية', { variantId: it.variantId });
        return { variantId: it.variantId, quantity: it.quantity, unitPriceMinor: orig.unitPriceMinor, nameAr: orig.nameAr, nameEn: orig.nameEn };
      });
      const priced = priceSale(priceInputs);
      const refundAmount = priced.totalMinor;

      // Cumulative amount check: sum refunds for this payment + new <= payment amount
      const [sumRow] = await tx.select({ sum: sql<number>`COALESCE(SUM(${refunds.amountMinor}),0)` }).from(refunds).where(and(eq(refunds.paymentId, input.paymentId), eq(refunds.tenantId, actor.tenantId)));
      const alreadyAmount = Number(sumRow?.sum ?? 0);
      if (alreadyAmount + refundAmount > Number(pay.amountMinor)) {
        throw new DomainError('refund_over_limit', `إجمالي المرتجعات (${alreadyAmount + refundAmount}) يتجاوز قيمة الدفعة (${pay.amountMinor})`);
      }

      // Cumulative quantity check per variant: already refunded qty via stockMovements + new qty <= original qty
      for (const it of merged) {
        const orig = origByVariant.get(it.variantId)!;
        const origQty = Number(orig.quantity);
        // Sum already refunded qty for this variant+transaction
        const [qRow] = await tx.select({ sum: sql<string>`COALESCE(SUM(${stockMovements.quantity}::numeric),0)` }).from(stockMovements).where(and(eq(stockMovements.transactionId, input.originalTransactionId), eq(stockMovements.variantId, it.variantId), eq(stockMovements.direction, 'in'), eq(stockMovements.reason, 'refund'), eq(stockMovements.tenantId, actor.tenantId)));
        const alreadyQty = Number(qRow?.sum ?? 0);
        const newQty = Number(it.quantity);
        if (alreadyQty + newQty > origQty + 1e-9) { // tolerate float
          throw new DomainError('refund_quantity_exceeded', `كمية الإرجاع للصنف تتجاوز الكمية المباعة`, { variantId: it.variantId, alreadyQty: String(alreadyQty), newQty: String(newQty), origQty: String(origQty) });
        }
      }

      // Create refund header
      const [hdr] = await tx.insert(refunds).values({
        tenantId: actor.tenantId,
        paymentId: input.paymentId,
        transactionId: input.originalTransactionId,
        amountMinor: refundAmount,
        reason: input.reason ?? null,
        shiftId: input.shiftId as string ?? null,
        approvedBy: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
      }).returning({ id: refunds.id });

      // Restore stock atomically: direction in, reason refund
      for (const it of merged) {
        await tx.update(catalogVariants).set({ stock: sql`${catalogVariants.stock} + ${it.quantity}::numeric` }).where(eq(catalogVariants.id, it.variantId));
        await tx.insert(stockMovements).values({
          tenantId: actor.tenantId,
          variantId: it.variantId,
          direction: 'in',
          quantity: it.quantity,
          reason: 'refund',
          transactionId: input.originalTransactionId,
        });
      }

      // Cash movement if cash refund
      if (isCash && input.shiftId) {
        await tx.insert(cashMovements).values({
          tenantId: actor.tenantId,
          shiftId: input.shiftId as string,
          direction: 'out',
          status: 'posted',
          amountMinor: refundAmount,
          refundId: hdr.id,
        });
      }

      await tx.insert(auditLog).values({
        tenantId: actor.tenantId, userId: actor.userId, action: 'refund.create', entity: 'refunds', entityId: hdr.id,
        payload: JSON.stringify({ amountMinor: refundAmount, paymentId: input.paymentId, originalTransactionId: input.originalTransactionId, items: merged.length }),
      });

      const v = await loadRefund(tx, hdr.id);
      return { refund: v, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'refunds_tenant_idem_uq')) {
      return withTenant(db, actor.tenantId, async (tx: any) => {
        const replay = await replayOrConflict(tx);
        if (!replay) throw err;
        return replay;
      });
    }
    throw err;
  }
}

export async function getRefund(db: AnyPgDatabase, tenantId: string, refundId: string) {
  if (!UUID_RE.test(refundId)) return null;
  return withTenant(db, tenantId, async (tx: any) => {
    const [r] = await tx.select().from(refunds).where(and(eq(refunds.id, refundId), eq(refunds.tenantId, tenantId))).limit(1);
    return r ?? null;
  });
}
