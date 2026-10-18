/**
 * Checkout — sale + payments + cash movements in ONE tenant-scoped transaction.
 * Invariants I1-I4, I6-I9 from proposal 0007. Append-only, idempotent, tenant-isolated.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShiftClosures, cashShifts, payments, salesTransactions, stockMovements, transactionLines } from './db/schema.js';
import { DomainError } from './line.js';
import { mergeSaleLines, priceSale, type PricedLineInput } from './sale.js';
import type { CreateSaleInput } from './contracts.js';

export type TenderMethod = 'cash' | 'card' | 'wallet' | 'transfer';

export interface TenderInput {
  method: TenderMethod;
  amountMinor: number; // how much of total this tender covers
  tenderedMinor?: number; // cash only: how much handed
  changeMinor?: number;
  externalRef?: string;
}

export interface CheckoutInput {
  idempotencyKey: string;
  lines: Array<{ variantId: string; quantity: string }>;
  tenders: TenderInput[];
  shiftId?: string; // required if any cash tender — enforced in service (optional in Phase 2)
  registerCode?: string;
}

export interface CheckoutView {
  sale: {
    id: string;
    totalMinor: number;
    currency: string;
    lines: Array<{ variantId: string; nameAr: string; nameEn: string; quantity: string; unitPriceMinor: number; lineTotalMinor: number }>;
  };
  payments: Array<{ id: string; method: TenderMethod; amountMinor: number; changeMinor: number | null }>;
  replayed: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestHash(input: { lines: ReturnType<typeof mergeSaleLines>; tenders: TenderInput[]; shiftId?: string }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e.code === '23505' && (!e.constraint || e.constraint === constraint)) return true;
  }
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

async function loadCheckout(tx: any, saleId: string) {
  const [h] = await tx.select().from(salesTransactions).where(eq(salesTransactions.id, saleId)).limit(1);
  if (!h) return null;
  const lines = await tx.select().from(transactionLines).where(eq(transactionLines.transactionId, saleId)).orderBy(transactionLines.nameEn);
  const pays = await tx.select().from(payments).where(eq(payments.transactionId, saleId)).orderBy(payments.createdAt);
  return {
    sale: {
      id: h.id,
      totalMinor: h.totalMinor,
      currency: h.currency,
      lines: lines.map((l: any) => ({
        variantId: l.variantId, nameAr: l.nameAr, nameEn: l.nameEn, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, lineTotalMinor: l.lineTotalMinor,
      })),
    },
    payments: pays.map((p: any) => ({ id: p.id, method: p.method as TenderMethod, amountMinor: p.amountMinor, changeMinor: p.changeMinor })),
  };
}

export async function checkout(
  db: AnyPgDatabase,
  actor: { tenantId: string; userId: string },
  input: CheckoutInput,
): Promise<CheckoutView> {
  if (!UUID_RE.test(actor.tenantId) || !UUID_RE.test(actor.userId)) throw new DomainError('invalid_actor', 'سياق المستخدم غير صالح');
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError('invalid_idempotency_key', 'مفتاح العملية مطلوب');
  if (!input.tenders || input.tenders.length === 0) throw new DomainError('no_tender', 'طريقة الدفع مطلوبة');
  if (input.tenders.length > 10) throw new DomainError('too_many_tenders', 'عدد طرق الدفع كثير');

  const merged = mergeSaleLines(input.lines);
  const hash = requestHash({ lines: merged, tenders: input.tenders, shiftId: input.shiftId });

  // Validate tenders
  for (const t of input.tenders) {
    if (!['cash', 'card', 'wallet', 'transfer'].includes(t.method)) throw new DomainError('invalid_method', 'طريقة دفع غير صالحة');
    if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0) throw new DomainError('invalid_amount', 'مبلغ الدفع غير صالح');
    if (t.method === 'cash') {
      if (t.tenderedMinor !== undefined) {
        if (!Number.isSafeInteger(t.tenderedMinor) || t.tenderedMinor <= 0) throw new DomainError('invalid_tendered', 'المبلغ المستلم غير صالح');
        if (t.tenderedMinor < t.amountMinor) throw new DomainError('change_exceeds_tendered', 'الباقي لا يمكن أن يتجاوز المدفوع');
      }
    } else {
      if (t.tenderedMinor !== undefined || (t as any).changeMinor !== undefined) throw new DomainError('change_only_cash', 'الباقي للكاش فقط');
    }
    if (t.externalRef && t.externalRef.length > 200) throw new DomainError('external_ref_too_long', 'مرجع خارجي طويل');
  }

  const hasCash = input.tenders.some((t) => t.method === 'cash');
  if (hasCash && !input.shiftId) throw new DomainError('shift_required_for_cash', 'البيع النقدي يحتاج وردية مفتوحة');
  if (input.shiftId && !UUID_RE.test(input.shiftId)) throw new DomainError('invalid_shift', 'معرف الوردية غير صالح');

  const replayOrConflict = async (tx: any) => {
    const [prior] = await tx.select({ id: salesTransactions.id, requestHash: salesTransactions.requestHash }).from(salesTransactions).where(eq(salesTransactions.idempotencyKey, input.idempotencyKey)).limit(1);
    if (!prior) return null;
    if (prior.requestHash !== hash) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
    const loaded = await loadCheckout(tx, prior.id as string);
    if (!loaded) throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم');
    return { sale: loaded.sale, payments: loaded.payments, replayed: true } as CheckoutView;
  };

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      // Serialize cash operations per shift to prevent close vs sale race (needs advisory lock, not row lock due to REVOKE UPDATE)
      if (input.shiftId) await advisoryLock(tx, `shift:${actor.tenantId}:${input.shiftId}`);
      const replay = await replayOrConflict(tx);
      if (replay) return replay;

      // Shift check if cash and shiftId provided — enforce existence, closure checked in Phase 4
      if (hasCash && input.shiftId) {
        const [shift] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(and(eq(cashShifts.id, input.shiftId as string), eq(cashShifts.tenantId, actor.tenantId))).limit(1);
        if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
        const [closed] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId as string)).limit(1);
        if (closed) throw new DomainError('shift_closed', 'الوردية مغلقة');
      } else if (input.shiftId) {
        const [shift] = await tx.select({ id: cashShifts.id }).from(cashShifts).where(and(eq(cashShifts.id, input.shiftId as string), eq(cashShifts.tenantId, actor.tenantId))).limit(1);
        if (!shift) throw new DomainError('shift_not_found', 'الوردية غير موجودة');
        const [closed] = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, input.shiftId as string)).limit(1);
        if (closed) throw new DomainError('shift_closed', 'الوردية مغلقة');
      }

      // Catalog lookup
      const ids = merged.map((l) => l.variantId);
      const rows = await tx.select({
        variantId: catalogVariants.id, priceMinor: catalogItems.priceMinor, isActive: catalogItems.isActive, nameAr: catalogItems.nameAr, nameEn: catalogItems.nameEn, labelAr: catalogVariants.labelAr, labelEn: catalogVariants.labelEn,
      }).from(catalogVariants).innerJoin(catalogItems, and(eq(catalogItems.tenantId, catalogVariants.tenantId), eq(catalogItems.id, catalogVariants.itemId))).where(inArray(catalogVariants.id, ids));
      const byId = new Map(rows.map((r: any) => [r.variantId, r]));
      const toPrice: PricedLineInput[] = merged.map((l) => {
        const r: any = byId.get(l.variantId);
        if (!r || !r.isActive) throw new DomainError('unknown_item', 'صنف غير موجود', { variantId: l.variantId });
        const suffixAr = r.labelAr && r.labelAr !== 'افتراضي' ? ` — ${r.labelAr}` : '';
        const suffixEn = r.labelEn && r.labelEn !== 'Default' ? ` — ${r.labelEn}` : '';
        return { ...l, unitPriceMinor: r.priceMinor, nameAr: r.nameAr + suffixAr, nameEn: r.nameEn + suffixEn };
      });
      const priced = priceSale(toPrice);

      // Validate tenders sum
      const sumTenders = input.tenders.reduce((s, t) => s + t.amountMinor, 0);
      const sumChange = input.tenders.reduce((s, t) => {
        if (t.method === 'cash' && t.tenderedMinor !== undefined) return s + (t.tenderedMinor - t.amountMinor);
        return s;
      }, 0);
      // For cash, change = tendered - amount; for non-cash, change 0
      // Total tendered - change must equal total
      const netPaid = sumTenders;
      if (netPaid !== priced.totalMinor) throw new DomainError('tender_mismatch', `مجموع المدفوعات (${netPaid}) لا يساوي الإجمالي (${priced.totalMinor})`);
      for (const t of input.tenders) {
        if (t.method === 'cash' && t.tenderedMinor !== undefined) {
          const change = t.tenderedMinor - t.amountMinor;
          if (change < 0 || change > t.tenderedMinor) throw new DomainError('invalid_change', 'الباقي غير صالح');
        }
      }

      // Stock decrement
      for (const l of priced.lines) {
        const updated = await tx.update(catalogVariants).set({ stock: sql`${catalogVariants.stock} - ${l.quantity}::numeric` }).where(and(eq(catalogVariants.id, l.variantId), sql`${catalogVariants.stock} >= ${l.quantity}::numeric`)).returning({ id: catalogVariants.id });
        if (updated.length === 0) throw new DomainError('insufficient_stock', 'الكمية غير متوفرة', { variantId: l.variantId });
      }

      // Persist sale
      const [header] = await tx.insert(salesTransactions).values({
        tenantId: actor.tenantId, kind: 'sale', totalMinor: priced.totalMinor, currency: priced.currency, idempotencyKey: input.idempotencyKey, requestHash: hash, createdBy: actor.userId,
      }).returning({ id: salesTransactions.id });
      await tx.insert(transactionLines).values(priced.lines.map((l) => ({
        tenantId: actor.tenantId, transactionId: header.id, variantId: l.variantId, nameAr: l.nameAr, nameEn: l.nameEn, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, lineTotalMinor: l.lineTotalMinor,
      })));
      await tx.insert(stockMovements).values(priced.lines.map((l) => ({
        tenantId: actor.tenantId, variantId: l.variantId, direction: 'out', quantity: l.quantity, reason: 'sale', transactionId: header.id,
      })));

      // Payments + cash movements
      const payRows: any[] = [];
      const cashMoves: any[] = [];
      for (const t of input.tenders) {
        const change = t.method === 'cash' && t.tenderedMinor !== undefined ? t.tenderedMinor - t.amountMinor : null;
        const [p] = await tx.insert(payments).values({
          tenantId: actor.tenantId, transactionId: header.id, method: t.method, amountMinor: t.amountMinor, tenderedMinor: t.tenderedMinor ?? null, changeMinor: change, externalRef: t.externalRef ?? null, shiftId: t.method === 'cash' ? input.shiftId as string : null, idempotencyKey: `${input.idempotencyKey}#pay:${t.method}:${t.amountMinor}`, requestHash: createHash('sha256').update(JSON.stringify(t)).digest('hex'), createdBy: actor.userId,
        }).returning({ id: payments.id });
        payRows.push({ id: p.id, method: t.method, amountMinor: t.amountMinor, changeMinor: change });
        if (t.method === 'cash') {
          // Inbound is what the customer handed (tendered), outbound is change — net = amount (revenue)
          const inAmount = t.tenderedMinor ?? t.amountMinor;
          cashMoves.push({ tenantId: actor.tenantId, shiftId: input.shiftId as string, direction: 'in', status: 'posted', amountMinor: inAmount, paymentId: p.id });
          if (change !== null && change > 0) {
            cashMoves.push({ tenantId: actor.tenantId, shiftId: input.shiftId as string, direction: 'out', status: 'posted', amountMinor: change, paymentId: p.id });
          }
        }
      }
      if (cashMoves.length > 0) {
        await tx.insert(cashMovements).values(cashMoves.map((m: any) => ({ tenantId: m.tenantId, shiftId: m.shiftId, direction: m.direction, status: m.status, amountMinor: m.amountMinor, paymentId: m.paymentId })));
      }

      await tx.insert(auditLog).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'checkout', entity: 'sales_transactions', entityId: header.id, payload: JSON.stringify({ totalMinor: priced.totalMinor, payments: payRows.length }) });

      const saleView = {
        id: header.id, totalMinor: priced.totalMinor, currency: priced.currency,
        lines: priced.lines.map((l) => ({ variantId: l.variantId, nameAr: l.nameAr, nameEn: l.nameEn, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, lineTotalMinor: l.lineTotalMinor })),
      };
      return { sale: saleView, payments: payRows, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'sales_transactions_tenant_idem_uq')) {
      return withTenant(db, actor.tenantId, async (tx: any) => {
        const replay = await replayOrConflict(tx);
        if (!replay) throw err;
        return replay;
      });
    }
    throw err;
  }
}

export async function getCheckout(db: AnyPgDatabase, tenantId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withTenant(db, tenantId, (tx: any) => loadCheckout(tx, id));
}
