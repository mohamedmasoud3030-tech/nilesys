/**
 * Record a sale — the first end-to-end persisted business operation.
 *
 * ONE tenant-scoped transaction (withTenant ⇒ RLS active) that:
 *   1. replays an existing sale for the same idempotency key (same body),
 *      or rejects a reused key with a different body (409);
 *   2. loads unit prices + names from the catalog (client prices are never
 *      accepted; another tenant's variant id is simply "not found" via RLS);
 *   3. prices the sale with the engine (Decimal, per-line rounding);
 *   4. decrements stock atomically and refuses to go negative;
 *   5. writes header + lines + stock movements + audit entry.
 * Any failure rolls back everything — no half-saved sales.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { withTenant, type AnyPgDatabase } from '../../platform/src/db/with-tenant.js';
import { auditLog } from '../../platform/src/db/schema.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { payments, salesTransactions, stockMovements, transactionLines } from './db/schema.js';
import { DomainError } from './line.js';
import { mergeSaleLines, priceSale, type PricedLineInput } from './sale.js';
import type { CreateSaleInput } from './contracts.js';

export interface SaleActor {
  tenantId: string;
  userId: string;
}

export interface SaleView {
  id: string;
  status: string;
  currency: string;
  totalMinor: number;
  createdAt: string;
  createdBy: string;
  lines: Array<{ variantId: string; nameAr: string; nameEn: string; quantity: string; unitPriceMinor: number; lineTotalMinor: number }>;
  /** مدفوعات الفاتورة — لازمة لبدء مرتجع من أي عميل HTTP (R1). المبالغ بالقروش. */
  payments: Array<{ id: string; method: string; amountMinor: number; tenderedMinor: number | null; changeMinor: number | null }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestHash(lines: ReturnType<typeof mergeSaleLines>): string {
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex');
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e.code === '23505' && (!e.constraint || e.constraint === constraint)) return true;
  }
  return false;
}

async function loadSale(tx: any, id: string): Promise<SaleView | null> {
  const [h] = await tx.select().from(salesTransactions).where(eq(salesTransactions.id, id)).limit(1);
  if (!h) return null;
  const lines = await tx
    .select()
    .from(transactionLines)
    .where(eq(transactionLines.transactionId, id))
    .orderBy(transactionLines.nameEn);
  const pays = await tx.select().from(payments).where(eq(payments.transactionId, id)).orderBy(payments.createdAt);
  return {
    id: h.id,
    status: h.status,
    currency: h.currency,
    totalMinor: h.totalMinor,
    createdAt: new Date(h.createdAt).toISOString(),
    createdBy: h.createdBy,
    lines: lines.map((l: any) => ({
      variantId: l.variantId,
      nameAr: l.nameAr,
      nameEn: l.nameEn,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
    })),
    payments: pays.map((pay: any) => ({
      id: pay.id,
      method: pay.method,
      amountMinor: pay.amountMinor,
      tenderedMinor: pay.tenderedMinor ?? null,
      changeMinor: pay.changeMinor ?? null,
    })),
  };
}

async function findByKey(tx: any, key: string) {
  const [h] = await tx
    .select({ id: salesTransactions.id, requestHash: salesTransactions.requestHash })
    .from(salesTransactions)
    .where(eq(salesTransactions.idempotencyKey, key))
    .limit(1);
  return h as { id: string; requestHash: string } | undefined;
}

export async function recordSale(
  db: AnyPgDatabase,
  actor: SaleActor,
  input: CreateSaleInput,
): Promise<{ sale: SaleView; replayed: boolean }> {
  const merged = mergeSaleLines(input.lines);
  const hash = requestHash(merged);

  const replayOrConflict = async (tx: any) => {
    const prior = await findByKey(tx, input.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash) {
      throw new DomainError('idempotency_conflict', 'مفتاح العملية مستخدم لطلب مختلف');
    }
    return { sale: (await loadSale(tx, prior.id))!, replayed: true };
  };

  try {
    return await withTenant(db, actor.tenantId, async (tx: any) => {
      const replay = await replayOrConflict(tx);
      if (replay) return replay;

      // 2. Catalog lookup (RLS scopes it to this tenant).
      const ids = merged.map((l) => l.variantId);
      const rows = await tx
        .select({
          variantId: catalogVariants.id,
          priceMinor: catalogItems.priceMinor,
          isActive: catalogItems.isActive,
          nameAr: catalogItems.nameAr,
          nameEn: catalogItems.nameEn,
          labelAr: catalogVariants.labelAr,
          labelEn: catalogVariants.labelEn,
        })
        .from(catalogVariants)
        .innerJoin(catalogItems, and(eq(catalogItems.tenantId, catalogVariants.tenantId), eq(catalogItems.id, catalogVariants.itemId)))
        .where(inArray(catalogVariants.id, ids));
      const byId = new Map<string, (typeof rows)[number]>(rows.map((r: any) => [r.variantId, r]));

      const toPrice: PricedLineInput[] = merged.map((l) => {
        const r: any = byId.get(l.variantId);
        if (!r || !r.isActive) throw new DomainError('unknown_item', 'صنف غير موجود', { variantId: l.variantId });
        const suffixAr = r.labelAr && r.labelAr !== 'افتراضي' ? ` — ${r.labelAr}` : '';
        const suffixEn = r.labelEn && r.labelEn !== 'Default' ? ` — ${r.labelEn}` : '';
        return { ...l, unitPriceMinor: r.priceMinor, nameAr: r.nameAr + suffixAr, nameEn: r.nameEn + suffixEn };
      });

      // 3. Engine pricing.
      const priced = priceSale(toPrice);

      // 4. Atomic stock decrement — never below zero.
      for (const l of priced.lines) {
        const updated = await tx
          .update(catalogVariants)
          .set({ stock: sql`${catalogVariants.stock} - ${l.quantity}::numeric` })
          .where(and(eq(catalogVariants.id, l.variantId), sql`${catalogVariants.stock} >= ${l.quantity}::numeric`))
          .returning({ id: catalogVariants.id });
        if (updated.length === 0) {
          throw new DomainError('insufficient_stock', 'الكمية المطلوبة غير متوفرة في المخزون', { variantId: l.variantId });
        }
      }

      // 5. Persist.
      const [header] = await tx
        .insert(salesTransactions)
        .values({
          tenantId: actor.tenantId,
          kind: 'sale',
          totalMinor: priced.totalMinor,
          currency: priced.currency,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          createdBy: actor.userId,
        })
        .returning({ id: salesTransactions.id });
      await tx.insert(transactionLines).values(
        priced.lines.map((l) => ({
          tenantId: actor.tenantId,
          transactionId: header.id,
          variantId: l.variantId,
          nameAr: l.nameAr,
          nameEn: l.nameEn,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineTotalMinor: l.lineTotalMinor,
        })),
      );
      await tx.insert(stockMovements).values(
        priced.lines.map((l) => ({
          tenantId: actor.tenantId,
          variantId: l.variantId,
          direction: 'out',
          quantity: l.quantity,
          reason: 'sale',
          transactionId: header.id,
        })),
      );
      await tx.insert(auditLog).values({
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: 'sale.create',
        entity: 'sales_transactions',
        entityId: header.id,
        payload: JSON.stringify({ totalMinor: priced.totalMinor, lines: priced.lines.length }),
      });

      return { sale: (await loadSale(tx, header.id))!, replayed: false };
    });
  } catch (err) {
    // Two concurrent requests with the same key: the loser replays the winner.
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

export async function getSale(db: AnyPgDatabase, tenantId: string, id: string): Promise<SaleView | null> {
  if (!UUID_RE.test(id)) return null;
  return withTenant(db, tenantId, (tx: any) => loadSale(tx, id));
}
