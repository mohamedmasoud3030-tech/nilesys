// TEMPORARY VERIFICATION PROBE — /tmp/wt-verify only, never committed.
// Real PostgreSQL concurrency for POS paths that the committed suite only runs on PGlite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ADMIN_URL, createPgHarness, type PgHarness } from '../../catalog/test/pg-harness.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { refunds, salesTransactions, stockMovements } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { openShift } from '../src/shifts.js';

let h: PgHarness; let db: any; let T: string; let n = 0;
const k = (p: string) => `${p}-${n++}-${Date.now()}`;
const A = () => ({ tenantId: T, userId: T });
const code = (e: any) => { let c = e; while (c && !c.code) c = c.cause; return String(c?.code ?? e?.message); };
const tally = (rs: PromiseSettledResult<any>[]) => rs.map((r) => (r.status === 'fulfilled' ? (r.value.replayed ? 'replayed' : 'ok') : code(r.reason))).sort().join(',');
async function variant(price: number, stock: string) {
  return withTenant(db, T, async (tx: any) => {
    const [i] = await tx.insert(catalogItems).values({ tenantId: T, nameAr: 'ص', nameEn: 'I', category: 'x', priceMinor: price, isActive: true }).returning({ id: catalogItems.id });
    const [v] = await tx.insert(catalogVariants).values({ tenantId: T, itemId: i.id, sku: k('SKU'), labelAr: 'ا', labelEn: 'D', stock }).returning({ id: catalogVariants.id });
    return v.id as string;
  });
}
const stockOf = (v: string) => withTenant(db, T, async (tx: any) => Number((await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, v)))[0].s));
const refundedQty = (sale: string, v: string) => withTenant(db, T, async (tx: any) => Number((await tx.select({ q: sql<string>`COALESCE(SUM(${stockMovements.quantity}::numeric),0)` }).from(stockMovements).where(and(eq(stockMovements.transactionId, sale), eq(stockMovements.variantId, v), eq(stockMovements.reason, 'refund'))))[0].q));
const refundRows = (sale: string) => withTenant(db, T, async (tx: any) => (await tx.select({ a: refunds.amountMinor }).from(refunds).where(eq(refunds.transactionId, sale))).map((r: any) => r.a));

describe.skipIf(!ADMIN_URL)('VERIFY real PG concurrency', () => {
  beforeAll(async () => {
    h = await createPgHarness('verify'); db = h.opened.db;
    T = (await db.insert(organization).values({ name: 'Verify', slug: k('verify') }).returning({ id: organization.id }))[0].id;
  }, 60_000);
  afterAll(async () => { await h?.dispose(); });

  it('C1 same idempotency key x6 concurrently', async () => {
    const v = await variant(1000, '100.000');
    const input = { idempotencyKey: k('c1-idem'), lines: [{ variantId: v, quantity: '1' }], tenders: [{ method: 'card' as const, amountMinor: 1000 }] };
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => checkout(db, A(), input)));
    const sales = await withTenant(db, T, async (tx: any) => (await tx.select({ id: salesTransactions.id }).from(salesTransactions).where(eq(salesTransactions.idempotencyKey, input.idempotencyKey))).length);
    console.log(`ROW|C1|${tally(rs)}|sales=${sales}|stock=${await stockOf(v)}`);
    expect([sales, await stockOf(v)]).toEqual([1, 99]);
  });

  it('C2 oversell: stock 3, six concurrent sales of 1', async () => {
    const v = await variant(1000, '3.000');
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => checkout(db, A(), { idempotencyKey: k('c2'), lines: [{ variantId: v, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 1000 }] })));
    console.log(`ROW|C2|${tally(rs)}|stock=${await stockOf(v)}`);
    expect(await stockOf(v)).toBe(0);
  });

  it('C3 two concurrent refunds of the same unit via the SAME payment', async () => {
    const v = await variant(1000, '10.000');
    const c = await checkout(db, A(), { idempotencyKey: k('c3'), lines: [{ variantId: v, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 1000 }] });
    const rs = await Promise.allSettled([0, 1].map(() => createRefund(db, A(), { idempotencyKey: k('c3r'), originalTransactionId: c.sale.id, paymentId: c.payments[0]!.id, items: [{ variantId: v, quantity: '1' }] })));
    console.log(`ROW|C3|${tally(rs)}|refundedQty=${await refundedQty(c.sale.id, v)}|refunds=${JSON.stringify(await refundRows(c.sale.id))}|stock=${await stockOf(v)}`);
    expect(await refundedQty(c.sale.id, v)).toBe(1);
  });

  it('C4 two concurrent refunds of the same unit via two DIFFERENT card payments (x20)', async () => {
    let over = 0; const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const water = await variant(750, '10.000'); const oil = await variant(8995, '10.000');
      const c = await checkout(db, A(), { idempotencyKey: k('c4'), lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 4872 }, { method: 'card', amountMinor: 4873 }] });
      const rs = await Promise.allSettled(c.payments.map((p: any) => createRefund(db, A(), { idempotencyKey: k('c4r'), originalTransactionId: c.sale.id, paymentId: p.id, items: [{ variantId: water, quantity: '1' }] })));
      const q = await refundedQty(c.sale.id, water);
      if (q > 1) over++;
      seen.push(`${tally(rs)}/q=${q}/stock=${await stockOf(water)}/refunded=${(await refundRows(c.sale.id)).reduce((a: number, b: number) => a + b, 0)}`);
    }
    console.log(`ROW|C4|iterations=20|water_sold=1|over_refunded=${over}|sample=${seen.slice(0, 3).join(' ; ')}`);
    expect(over, 'water sold once must be refunded at most once').toBe(0);
  }, 120_000);

  it('C5 same as C4 with two CASH payments on one shift (x20)', async () => {
    let over = 0; const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { shift } = await openShift(db, A(), { registerCode: k('c5reg'), openingMinor: 0, idempotencyKey: k('c5open') });
      const water = await variant(750, '10.000'); const oil = await variant(8995, '10.000');
      const c = await checkout(db, A(), { idempotencyKey: k('c5'), shiftId: shift!.id, lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 4872 }, { method: 'cash', amountMinor: 4873 }] });
      const rs = await Promise.allSettled(c.payments.map((p: any) => createRefund(db, A(), { idempotencyKey: k('c5r'), originalTransactionId: c.sale.id, paymentId: p.id, items: [{ variantId: water, quantity: '1' }], shiftId: shift!.id })));
      const q = await refundedQty(c.sale.id, water); if (q > 1) over++;
      seen.push(`${tally(rs)}/q=${q}`);
    }
    console.log(`ROW|C5|iterations=20|over_refunded=${over}|sample=${seen.slice(0, 3).join(' ; ')}`);
    expect(over).toBe(0);
  }, 120_000);

  it('C4s control: the same two refunds SEQUENTIALLY', async () => {
    const water = await variant(750, '10.000'); const oil = await variant(8995, '10.000');
    const c = await checkout(db, A(), { idempotencyKey: k('c4s'), lines: [{ variantId: water, quantity: '1' }, { variantId: oil, quantity: '1' }], tenders: [{ method: 'card', amountMinor: 4872 }, { method: 'card', amountMinor: 4873 }] });
    const out: string[] = [];
    for (const p of c.payments) { try { await createRefund(db, A(), { idempotencyKey: k('c4sr'), originalTransactionId: c.sale.id, paymentId: p.id, items: [{ variantId: water, quantity: '1' }] }); out.push('ok'); } catch (e) { out.push(code(e)); } }
    console.log(`ROW|C4s|${out.join(',')}|q=${await refundedQty(c.sale.id, water)}`);
    expect(await refundedQty(c.sale.id, water)).toBe(1);
  });
});
