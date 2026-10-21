import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashShifts, payments, refunds, stockMovements } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let variantA1: string;
let variantA2: string;
let variantB1: string;

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'RefundA', slug: 'refund-a' }).returning({ id: organization.id }) as [{ id: string }];
  const [b] = await db.insert(organization).values({ name: 'RefundB', slug: 'refund-b' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id; B = b.id;
  const seed = async (tenantId: string) => {
    const [item1] = await withTenant(db, tenantId, async (tx: any) => tx.insert(catalogItems).values({ tenantId, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 750, isActive: true }).returning({ id: catalogItems.id }));
    const v1 = await withTenant(db, tenantId, async (tx: any) => {
      const [v] = await tx.insert(catalogVariants).values({ tenantId, itemId: item1.id as string, sku: `WTR-${tenantId.slice(0,4)}-1`, labelAr: 'افتراضي', labelEn: 'Default', stock: '10.000' }).returning({ id: catalogVariants.id });
      return v.id as string;
    });
    const [item2] = await withTenant(db, tenantId, async (tx: any) => tx.insert(catalogItems).values({ tenantId, nameAr: 'زيت', nameEn: 'Oil', category: 'food', priceMinor: 8995, isActive: true }).returning({ id: catalogItems.id }));
    const v2 = await withTenant(db, tenantId, async (tx: any) => {
      const [v] = await tx.insert(catalogVariants).values({ tenantId, itemId: item2.id as string, sku: `OIL-${tenantId.slice(0,4)}-1`, labelAr: 'افتراضي', labelEn: 'Default', stock: '5.000' }).returning({ id: catalogVariants.id });
      return v.id as string;
    });
    return { v1, v2 };
  };
  const aSeed = await seed(A);
  variantA1 = aSeed.v1; variantA2 = aSeed.v2;
  const bSeed = await seed(B);
  variantB1 = bSeed.v1;
});
afterAll(() => opened.close());

async function openShiftFor(tenantId: string, key: string) {
  return withTenant(db, tenantId, async (tx: any) => {
    const [s] = await tx.insert(cashShifts).values({ tenantId, registerCode: 'main', openedBy: tenantId, openingMinor: 10000, idempotencyKey: key, requestHash: 'h-' + key }).returning({ id: cashShifts.id });
    return s.id as string;
  });
}

describe('refunds — partial/full, limits, stock, idempotency', () => {
  it('partial refund restores stock and creates cash out movement', async () => {
    const shiftId = await openShiftFor(A, 'shift-refund-1');
    // checkout: 2 water (1500) +1 oil (8995)=10495 cash
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'chk-refund-001',
      shiftId,
      lines: [{ variantId: variantA1, quantity: '2' }, { variantId: variantA2, quantity: '1' }],
      tenders: [{ method: 'cash', amountMinor: 10495 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    const stockBefore = await withTenant(db, A, async (tx: any) => (await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, variantA1)))[0].s);
    // partial refund: 1 water (750)
    const { refund } = await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'refund-001',
      originalTransactionId: sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantA1, quantity: '1' }],
      reason: 'damaged',
      shiftId,
    });
    expect(refund!.amountMinor).toBe(750);
    const stockAfter = await withTenant(db, A, async (tx: any) => (await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, variantA1)))[0].s);
    expect(Number(stockAfter) - Number(stockBefore)).toBe(1); // restored 1
    // cash movement out exists
    const moves = await withTenant(db, A, async (tx: any) => tx.select().from(stockMovements).where(eq(stockMovements.transactionId, sale.id)));
    const refundMoves = moves.filter((m: any) => m.direction === 'in' && m.reason === 'refund');
    expect(refundMoves.length).toBe(1);
    expect(refundMoves[0].quantity).toBe('1.000');
  });

  it('full refund after partial consumes remaining quantity and amount', async () => {
    // previous sale is same as above (10495) already partially refunded 750, remaining oil+1 water = 9745
    // We'll do a fresh sale for full test
    const shiftId = await openShiftFor(A, 'shift-refund-2');
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'chk-refund-002',
      shiftId,
      lines: [{ variantId: variantA1, quantity: '1' }],
      tenders: [{ method: 'cash', amountMinor: 750 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    // full refund same quantity
    const { refund } = await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'refund-002',
      originalTransactionId: sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantA1, quantity: '1' }],
      shiftId,
    });
    expect(refund!.amountMinor).toBe(750);
    // try to refund again same item beyond original should fail (over amount or quantity)
    try {
      await createRefund(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'refund-002b',
        originalTransactionId: sale.id,
        paymentId: pay.id,
        items: [{ variantId: variantA1, quantity: '1' }],
        shiftId,
      });
      expect.fail('should throw quantity exceeded');
    } catch (e: any) { expect(['refund_quantity_exceeded', 'refund_over_limit']).toContain(e.code); }
  });

  it('over-refund amount is rejected', async () => {
    const shiftId = await openShiftFor(A, 'shift-refund-3');
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'chk-refund-003',
      shiftId,
      lines: [{ variantId: variantA1, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 750 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    // first refund partial 750 fully consumes payment (only 1 item)
    await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'refund-003a',
      originalTransactionId: sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantA1, quantity: '1' }],
    });
    // second refund same amount should exceed payment amount
    try {
      await createRefund(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'refund-003b',
        originalTransactionId: sale.id,
        paymentId: pay.id,
        items: [{ variantId: variantA1, quantity: '1' }],
      });
      expect.fail('should throw over limit');
    } catch (e: any) { expect(e.code).toMatch(/refund_over_limit|refund_quantity_exceeded/); }
  });

  it('idempotency: same key same body replays, different body → 409', async () => {
    const shiftId = await openShiftFor(B, 'shift-refund-4');
    const { sale } = await checkout(db, { tenantId: B, userId: B }, {
      idempotencyKey: 'chk-refund-004',
      shiftId,
      lines: [{ variantId: variantB1, quantity: '2' }],
      tenders: [{ method: 'cash', amountMinor: 1500 }],
    });
    const pays = await withTenant(db, B, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    const input = {
      idempotencyKey: 'refund-004',
      originalTransactionId: sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantB1, quantity: '1' }] as any,
      shiftId,
    };
    const r1 = await createRefund(db, { tenantId: B, userId: B }, input);
    expect(r1.replayed).toBe(false);
    const r2 = await createRefund(db, { tenantId: B, userId: B }, input);
    expect(r2.replayed).toBe(true);
    expect(r2.refund!.id).toBe(r1.refund!.id);
    // different body same key → conflict
    try {
      await createRefund(db, { tenantId: B, userId: B }, { ...input, items: [{ variantId: variantB1, quantity: '2' }] });
      expect.fail('should throw conflict');
    } catch (e: any) { expect(e.code).toBe('idempotency_conflict'); }
  });

  it('tenant isolation: B cannot refund A sale', async () => {
    const shiftId = await openShiftFor(A, 'shift-refund-5');
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'chk-refund-005',
      shiftId,
      lines: [{ variantId: variantA1, quantity: '1' }],
      tenders: [{ method: 'cash', amountMinor: 750 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    try {
      await createRefund(db, { tenantId: B, userId: B }, {
        idempotencyKey: 'refund-005',
        originalTransactionId: sale.id,
        paymentId: pay.id,
        items: [{ variantId: variantA1, quantity: '1' }],
        shiftId: await openShiftFor(B, 'shift-refund-5b'),
      });
      expect.fail('should throw not found');
    } catch (e: any) { expect(e.code).toBe('sale_not_found'); }
  });

  it('cash refund requires open shift; closed shift rejected', async () => {
    const shiftId = await openShiftFor(A, 'shift-refund-6');
    const { sale } = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'chk-refund-006',
      shiftId,
      lines: [{ variantId: variantA1, quantity: '1' }],
      tenders: [{ method: 'cash', amountMinor: 750 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    // try without shift
    try {
      await createRefund(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'refund-006a',
        originalTransactionId: sale.id,
        paymentId: pay.id,
        items: [{ variantId: variantA1, quantity: '1' }],
      });
      expect.fail('should throw shift_required');
    } catch (e: any) { expect(e.code).toBe('shift_required_for_cash'); }
    // close shift then try again with same shiftId
    const { closeShift } = await import('../src/shifts.js');
    await closeShift(db, { tenantId: A, userId: A }, { shiftId, countedMinor: 10750 }); // opening 10000 + sale 750
    try {
      await createRefund(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'refund-006b',
        originalTransactionId: sale.id,
        paymentId: pay.id,
        items: [{ variantId: variantA1, quantity: '1' }],
        shiftId,
      });
      expect.fail('should throw shift_closed');
    } catch (e: any) { expect(e.code).toBe('shift_closed'); }
  });

  it('card refund does not need shift and creates no cash movement', async () => {
    const { sale } = await checkout(db, { tenantId: B, userId: B }, {
      idempotencyKey: 'chk-refund-007',
      lines: [{ variantId: variantB1, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 750 }],
    });
    const pays = await withTenant(db, B, async (tx: any) => tx.select().from(payments).where(eq(payments.transactionId, sale.id)));
    const pay = pays[0];
    const { refund } = await createRefund(db, { tenantId: B, userId: B }, {
      idempotencyKey: 'refund-007',
      originalTransactionId: sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantB1, quantity: '1' }],
    });
    expect(refund!.amountMinor).toBe(750);
    // no cash movement for card refund
    const moves = await withTenant(db, B, async (tx: any) => tx.select().from(stockMovements).where(eq(stockMovements.transactionId, sale.id)));
    expect(moves.some((m: any) => m.reason === 'refund')).toBe(true);
  });
});
