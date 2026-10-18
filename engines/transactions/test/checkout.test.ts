import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShifts, payments, salesTransactions } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;

async function seedCatalog(tenantId: string) {
  return withTenant(db, tenantId, async (tx: any) => {
    const [water] = await tx.insert(catalogItems).values({ tenantId, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 750, isActive: true }).returning({ id: catalogItems.id });
    const [oil] = await tx.insert(catalogItems).values({ tenantId, nameAr: 'زيت', nameEn: 'Oil', category: 'food', priceMinor: 8995, isActive: true }).returning({ id: catalogItems.id });
    const [v1] = await tx.insert(catalogVariants).values({ tenantId, itemId: water.id as string, sku: `WTR-${tenantId.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '10.000' }).returning({ id: catalogVariants.id });
    const [v2] = await tx.insert(catalogVariants).values({ tenantId, itemId: oil.id as string, sku: `OIL-${tenantId.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '5.000' }).returning({ id: catalogVariants.id });
    return { v1: v1.id as string, v2: v2.id as string };
  });
}

let variantsA: { v1: string; v2: string };
let variantsB: { v1: string; v2: string };

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'CheckoutA', slug: 'checkout-a' }).returning({ id: organization.id }) as [{ id: string }];
  const [b] = await db.insert(organization).values({ name: 'CheckoutB', slug: 'checkout-b' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id; B = b.id;
  variantsA = await seedCatalog(A);
  variantsB = await seedCatalog(B);
});
afterAll(() => opened.close());

describe('checkout — sale + payments in one transaction', () => {
  it('creates sale + payment + cash movement when shift provided (cash)', async () => {
    // open a shift for tenant A
    const shiftId = await withTenant(db, A, async (tx: any) => {
      const [s] = await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'main', openedBy: A, openingMinor: 10000, idempotencyKey: 'shift-1', requestHash: 'h1' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    const input = {
      idempotencyKey: 'chk-0001',
      shiftId,
      lines: [
        { variantId: variantsA.v1, quantity: '2' }, // 2*750=1500
        { variantId: variantsA.v2, quantity: '1' }, // 1*8995=8995 → total 10495
      ],
      tenders: [{ method: 'cash' as const, amountMinor: 10495, tenderedMinor: 11000, changeMinor: 505 }],
    };
    const { sale, replayed } = await checkout(db, { tenantId: A, userId: A }, input);
    expect(replayed).toBe(false);
    expect(sale.totalMinor).toBe(10495);
    expect(sale.lines).toHaveLength(2);

    // payment row exists
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    expect(pays).toHaveLength(1);
    expect(pays[0].amountMinor).toBe(10495);

    // cash movement exists (in + out for change)
    const moves = await withTenant(db, A, async (tx: any) => tx.select().from(cashMovements).where(eq(cashMovements.shiftId, shiftId)));
    // one in for sale (tendered 11000), one out for change 505 => 2
    expect(moves.length).toBe(2);
    const inMove = moves.find((m: any) => m.direction === 'in');
    expect(inMove.amountMinor).toBe(11000);
    const outMove = moves.find((m: any) => m.direction === 'out');
    expect(outMove.amountMinor).toBe(505);
  });

  it('tender mismatch is rejected and nothing is saved', async () => {
    const bad = {
      idempotencyKey: 'chk-bad-1',
      lines: [{ variantId: variantsA.v1, quantity: '1' }], // 750
      tenders: [{ method: 'card' as const, amountMinor: 500 }], // mismatch — use card to avoid shift requirement
    };
    try { await checkout(db, { tenantId: A, userId: A }, bad); expect.fail('should have thrown'); } catch (e: any) { expect(e.code).toBe('tender_mismatch'); }
    // sale not created
    const found = await withTenant(db, A, async (tx: any) => tx.select().from(salesTransactions).where(eq(salesTransactions.idempotencyKey, 'chk-bad-1')));
    expect(found.length).toBe(0);
  });

  it('idempotent replay does not double-decrement stock', async () => {
    const key = 'chk-replay-1';
    const input = {
      idempotencyKey: key,
      lines: [{ variantId: variantsA.v1, quantity: '1' }], // 750
      tenders: [{ method: 'card' as const, amountMinor: 750 }],
    };
    const stockBefore = await withTenant(db, A, async (tx: any) => (await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, variantsA.v1)))[0].s);
    const r1 = await checkout(db, { tenantId: A, userId: A }, input);
    expect(r1.replayed).toBe(false);
    const r2 = await checkout(db, { tenantId: A, userId: A }, input);
    expect(r2.replayed).toBe(true);
    expect(r2.sale.id).toBe(r1.sale.id);
    const stockAfter = await withTenant(db, A, async (tx: any) => (await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, variantsA.v1)))[0].s);
    // stock decremented once only: 1 unit
    const diff = Number(stockBefore) - Number(stockAfter);
    expect(diff).toBe(1);
  });

  it('tenant isolation: B cannot pay for A products and vice versa', async () => {
    const input = {
      idempotencyKey: 'chk-cross-1',
      lines: [{ variantId: variantsA.v1, quantity: '1' }],
      tenders: [{ method: 'card' as const, amountMinor: 750 }],
    };
    try { await checkout(db, { tenantId: B, userId: B }, input); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('unknown_item'); }
  });

  it('insufficient stock rolls back completely (no sale, no payment)', async () => {
    // variantsB.v2 has 5 stock, try 10
    const input = {
      idempotencyKey: 'chk-stock-1',
      lines: [{ variantId: variantsB.v2, quantity: '10' }], // stock 5
      tenders: [{ method: 'card' as const, amountMinor: 8995 * 10 }],
    };
    try { await checkout(db, { tenantId: B, userId: B }, input); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('insufficient_stock'); }
    const found = await withTenant(db, B, async (tx: any) => tx.select().from(salesTransactions).where(eq(salesTransactions.idempotencyKey, 'chk-stock-1')));
    expect(found.length).toBe(0);
  });

  it('idempotency conflict: same key, different body → 409', async () => {
    const key = 'chk-conflict-1';
    const base = { idempotencyKey: key, lines: [{ variantId: variantsA.v1, quantity: '1' }], tenders: [{ method: 'card' as const, amountMinor: 750 }] };
    await checkout(db, { tenantId: A, userId: A }, base);
    const diff = { idempotencyKey: key, lines: [{ variantId: variantsA.v1, quantity: '2' }], tenders: [{ method: 'card' as const, amountMinor: 1500 }] };
    try { await checkout(db, { tenantId: A, userId: A }, diff); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('idempotency_conflict'); }
  });
});
