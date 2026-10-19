/**
 * Concurrent refunds of one sale — real PostgreSQL only.
 *
 * Defect (found 2026-10-18): createRefund serialised on `refund:<tenant>:<payment>`,
 * but the quantity limit is per SALE (sum of refunded stock movements of the
 * transaction). Two refunds of the same unit through two different payments of
 * one split-tender sale did not block each other, both read "0 already
 * refunded" and both committed: an item sold once was refunded twice (money
 * returned twice, stock restored twice). Reproduced 15/20 and 16/20 on PG 17.
 * A cash refund happened to be protected by the shift lock; card refunds were not.
 *
 * Contract proven here, for every mix of payment methods:
 * - refunded quantity per item never exceeds the quantity sold;
 * - each successful refund writes exactly one refund row, one stock movement
 *   per item and (cash only) one outbound cash movement — nothing for a loser;
 * - losers are refused with refund_quantity_exceeded / refund_over_limit, never
 *   silently recorded; an identical retry replays instead of refunding again;
 * - refunds that fit are NOT blocked by the extra serialisation.
 *
 * PGlite is a single connection and cannot show this; the file is skipped
 * unless NILE_TEST_PG_ADMIN_URL points at a disposable server.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ADMIN_URL, createPgHarness, type PgHarness } from '../../catalog/test/pg-harness.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, refunds, stockMovements } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { openShift } from '../src/shifts.js';

const WATER = 750;
const OIL = 8995;
let h: PgHarness;
let db: any;
let T: string;
let seq = 0;
const key = (p: string) => `${p}-${seq++}-${Date.now()}`;
const actor = () => ({ tenantId: T, userId: T });
const codeOf = (e: any) => { let c = e; while (c && !c.code) c = c.cause; return String(c?.code ?? e?.message); };
const outcome = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? (r.value.replayed ? 'replayed' : 'ok') : codeOf(r.reason));
const tally = (rs: PromiseSettledResult<any>[]) => rs.map(outcome).sort();

async function variant(price: number) {
  return withTenant(db, T, async (tx: any) => {
    const [i] = await tx.insert(catalogItems).values({ tenantId: T, nameAr: 'صنف', nameEn: 'Item', category: 'x', priceMinor: price, isActive: true }).returning({ id: catalogItems.id });
    const [v] = await tx.insert(catalogVariants).values({ tenantId: T, itemId: i.id, sku: key('RC'), labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }).returning({ id: catalogVariants.id });
    return v.id as string;
  });
}
const newShift = async () => (await openShift(db, actor(), { registerCode: key('rc-reg'), openingMinor: 0, idempotencyKey: key('rc-open') })).shift!.id as string;
const refund = (saleId: string, paymentId: string, variantId: string, quantity: string, shiftId?: string, idempotencyKey = key('rc-ref')) =>
  createRefund(db, actor(), { idempotencyKey, originalTransactionId: saleId, paymentId, items: [{ variantId, quantity }], ...(shiftId ? { shiftId } : {}) });

/** Everything a refund writes for one sale, read back as nile_app. */
async function ledger(saleId: string, variantId: string) {
  return withTenant(db, T, async (tx: any) => {
    const rows = await tx.select({ id: refunds.id, amount: refunds.amountMinor, paymentId: refunds.paymentId }).from(refunds).where(eq(refunds.transactionId, saleId));
    const [mv] = await tx.select({ qty: sql<string>`COALESCE(SUM(${stockMovements.quantity}::numeric),0)`, n: sql<string>`COUNT(*)` })
      .from(stockMovements).where(and(eq(stockMovements.transactionId, saleId), eq(stockMovements.variantId, variantId), eq(stockMovements.reason, 'refund')));
    const [stock] = await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, variantId));
    const ids = rows.map((r: any) => r.id);
    const cashOut = ids.length ? await tx.select({ amount: cashMovements.amountMinor, refundId: cashMovements.refundId }).from(cashMovements).where(sql`${cashMovements.refundId} IN (${sql.join(ids.map((i: string) => sql`${i}`), sql`, `)})`) : [];
    return { rows, refundedQty: Number(mv.qty), stockMoves: Number(mv.n), stock: Number(stock.s), cashOut };
  });
}

describe.skipIf(!ADMIN_URL)('concurrent refunds of one sale (real PostgreSQL)', () => {
  beforeAll(async () => {
    h = await createPgHarness('refundrace');
    db = h.opened.db;
    T = (await db.insert(organization).values({ name: 'RefundRace', slug: key('refundrace') }).returning({ id: organization.id }))[0].id;
  }, 60_000);
  afterAll(async () => { await h?.dispose(); });

  it('A: card + card — the same unit refunded through both payments at once is refunded once (x20)', async () => {
    for (let i = 0; i < 20; i++) {
      const water = await variant(WATER); const oil = await variant(OIL);
      const sale = await checkout(db, actor(), { idempotencyKey: key('rcA'), lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 4872 }, { method: 'card', amountMinor: 4873 }] });
      const stockAfterSale = (await ledger(sale.sale.id, water)).stock;
      const rs = await Promise.allSettled(sale.payments.map((p: any) => refund(sale.sale.id, p.id, water, '1')));
      expect(tally(rs), `iteration ${i}`).toEqual(['ok', 'refund_quantity_exceeded']);
      const l = await ledger(sale.sale.id, water);
      expect([l.rows.length, l.rows[0]?.amount, l.refundedQty, l.stockMoves, l.stock - stockAfterSale], `iteration ${i}`).toEqual([1, WATER, 1, 1, 1]);
      // the other payment cannot refund it afterwards either
      const other = sale.payments.find((p: any) => p.id !== l.rows[0].paymentId)!;
      await expect(refund(sale.sale.id, other.id, water, '1')).rejects.toMatchObject({ code: 'refund_quantity_exceeded' });
    }
  }, 120_000);

  it('B: card + cash — different methods (and different locks) still refund the unit once (x20)', async () => {
    for (let i = 0; i < 20; i++) {
      const shiftId = await newShift();
      const water = await variant(WATER); const oil = await variant(OIL);
      const sale = await checkout(db, actor(), { idempotencyKey: key('rcB'), shiftId, lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 4872 }, { method: 'cash', amountMinor: 4873 }] });
      const card = sale.payments.find((p: any) => p.method === 'card')!; const cash = sale.payments.find((p: any) => p.method === 'cash')!;
      const rs = await Promise.allSettled([refund(sale.sale.id, card.id, water, '1'), refund(sale.sale.id, cash.id, water, '1', shiftId)]);
      expect(tally(rs), `iteration ${i}`).toEqual(['ok', 'refund_quantity_exceeded']);
      const l = await ledger(sale.sale.id, water);
      expect([l.rows.length, l.refundedQty, l.stockMoves], `iteration ${i}`).toEqual([1, 1, 1]);
      // cash leaves the drawer only if the cash refund won, and then exactly once
      const cashWon = l.rows[0].paymentId === cash.id;
      expect(l.cashOut.map((m: any) => m.amount), `iteration ${i}`).toEqual(cashWon ? [WATER] : []);
    }
  }, 120_000);

  it('C: the same refund request sent three times at once is recorded once and replayed twice', async () => {
    const water = await variant(WATER);
    const sale = await checkout(db, actor(), { idempotencyKey: key('rcC'), lines: [{ variantId: water, quantity: '2' }], tenders: [{ method: 'card', amountMinor: 1500 }] });
    const idem = key('rcC-ref');
    const rs = await Promise.allSettled([0, 1, 2].map(() => refund(sale.sale.id, sale.payments[0]!.id, water, '1', undefined, idem)));
    expect(tally(rs)).toEqual(['ok', 'replayed', 'replayed']);
    const ids = new Set(rs.map((r: any) => r.value.refund.id));
    expect(ids.size).toBe(1);
    const l = await ledger(sale.sale.id, water);
    expect([l.rows.length, l.refundedQty, l.stockMoves]).toEqual([1, 1, 1]);
  });

  it('D: refunds that fit are not blocked — 2 units sold, one refunded through each payment at once', async () => {
    const water = await variant(WATER);
    const sale = await checkout(db, actor(), { idempotencyKey: key('rcD'), lines: [{ variantId: water, quantity: '2' }], tenders: [{ method: 'card', amountMinor: 750 }, { method: 'wallet', amountMinor: 750 }] });
    const stockAfterSale = (await ledger(sale.sale.id, water)).stock;
    const rs = await Promise.allSettled(sale.payments.map((p: any) => refund(sale.sale.id, p.id, water, '1')));
    expect(tally(rs)).toEqual(['ok', 'ok']);
    const l = await ledger(sale.sale.id, water);
    expect([l.rows.length, l.rows.reduce((s: number, r: any) => s + r.amount, 0), l.refundedQty, l.stock - stockAfterSale]).toEqual([2, 1500, 2, 2]);
  });

  it('E: four concurrent refunds of 1 unit through one payment, 2 units sold — exactly two succeed', async () => {
    const water = await variant(WATER);
    const sale = await checkout(db, actor(), { idempotencyKey: key('rcE'), lines: [{ variantId: water, quantity: '2' }], tenders: [{ method: 'card', amountMinor: 1500 }] });
    const rs = await Promise.allSettled([0, 1, 2, 3].map(() => refund(sale.sale.id, sale.payments[0]!.id, water, '1')));
    const t = tally(rs);
    expect(t.filter((x) => x === 'ok')).toHaveLength(2);
    expect(t.filter((x) => x !== 'ok').every((x) => x === 'refund_over_limit' || x === 'refund_quantity_exceeded'), t.join(',')).toBe(true);
    const l = await ledger(sale.sale.id, water);
    expect([l.rows.length, l.refundedQty, l.stockMoves]).toEqual([2, 2, 2]);
  });

  it('F: sequential limits are unchanged — amount above the payment, quantity after a full refund', async () => {
    const water = await variant(WATER); const oil = await variant(OIL);
    const sale = await checkout(db, actor(), { idempotencyKey: key('rcF'), lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 4872 }, { method: 'card', amountMinor: 4873 }] });
    const [p1, p2] = sale.payments;
    await expect(refund(sale.sale.id, p1!.id, oil, '1')).rejects.toMatchObject({ code: 'refund_over_limit' }); // 8995 > 4872
    await refund(sale.sale.id, p1!.id, water, '1');
    await expect(refund(sale.sale.id, p2!.id, water, '1')).rejects.toMatchObject({ code: 'refund_quantity_exceeded' });
    const l = await ledger(sale.sale.id, water);
    expect([l.rows.length, l.refundedQty]).toEqual([1, 1]);
  });
});
