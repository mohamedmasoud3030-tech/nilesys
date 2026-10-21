/**
 * Drawer, pending cash, settle-later payments and the derived payment status.
 *
 * Covers proposal 0007 §3 I10 (status is derived) and I11 (pending cash is in the box, never revenue,
 * and is resolved by appending a row), and §5 `getDrawer` / `recordPayment` / `getPaymentStatus`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openPglite, type NileDb, type OpenedDatabase } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShifts, payments, salesTransactions } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { closeShift, openShift } from '../src/shifts.js';
import { createRefund } from '../src/refunds.js';
import { getDrawer, resolvePendingCash, drawerDifference } from '../src/drawer.js';
import { derivePaymentStatus, getPaymentStatus, recordPayment } from '../src/payments.js';

let opened: OpenedDatabase;
let db: NileDb;
let tenant: string;
let water: string; // price 1000
let oil: string; // price 2000
let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${seq++}`;
const actor = () => ({ tenantId: tenant, userId: tenant });

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [org] = (await db.insert(organization).values({ name: 'PayDrawer', slug: 'pay-drawer' }).returning({ id: organization.id })) as [{ id: string }];
  tenant = org.id;
  const seed = await withTenant(db, tenant, async (tx: any) => {
    const [i1] = await tx.insert(catalogItems).values({ tenantId: tenant, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
    const [v1] = await tx.insert(catalogVariants).values({ tenantId: tenant, itemId: i1.id, sku: `W-${tenant.slice(0, 4)}`, labelAr: 'ا', labelEn: 'a', stock: '100.000' }).returning({ id: catalogVariants.id });
    const [i2] = await tx.insert(catalogItems).values({ tenantId: tenant, nameAr: 'زيت', nameEn: 'Oil', category: 'food', priceMinor: 2000, isActive: true }).returning({ id: catalogItems.id });
    const [v2] = await tx.insert(catalogVariants).values({ tenantId: tenant, itemId: i2.id, sku: `O-${tenant.slice(0, 4)}`, labelAr: 'ا', labelEn: 'a', stock: '100.000' }).returning({ id: catalogVariants.id });
    return { v1: v1.id as string, v2: v2.id as string };
  });
  water = seed.v1;
  oil = seed.v2;
});
afterAll(() => opened.close());

async function newShift(openingMinor = 0, registerCode = `r${seq++}`) {
  const { shift } = await openShift(db, actor(), { registerCode, openingMinor, idempotencyKey: key('shift') });
  return shift!.id as string;
}

describe('getDrawer (I11 read side)', () => {
  it('reports the opening float before anything is sold', async () => {
    const shiftId = await newShift(1000);
    const d = await getDrawer(db, tenant, shiftId);
    expect([d!.openingMinor, d!.expectedPosted, d!.pendingCash, d!.expectedInDrawer]).toEqual([1000, 1000, 0, 1000]);
    expect(d!.closed).toBe(false);
  });

  it('counts cash in at what the customer handed over and change as cash out', async () => {
    const shiftId = await newShift(0);
    await checkout(db, actor(), {
      idempotencyKey: key('chk'),
      shiftId,
      lines: [{ variantId: water, quantity: '2' }],
      tenders: [{ method: 'cash', amountMinor: 2000, tenderedMinor: 2500 }],
    });
    const d = await getDrawer(db, tenant, shiftId);
    expect([d!.cashInMinor, d!.cashOutMinor]).toEqual([2500, 500]);
    expect(d!.expectedPosted).toBe(2000);
    expect(d!.expectedInDrawer).toBe(2000);
  });

  it('ignores a card tender: no cash enters the box', async () => {
    const shiftId = await newShift(500);
    await checkout(db, actor(), {
      idempotencyKey: key('chk'),
      lines: [{ variantId: oil, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 2000 }],
    });
    const d = await getDrawer(db, tenant, shiftId);
    expect([d!.cashInMinor, d!.cashOutMinor, d!.expectedInDrawer]).toEqual([0, 0, 500]);
  });

  it('returns null for a shift that does not exist, and never leaks another tenant’s shift', async () => {
    expect(await getDrawer(db, tenant, '11111111-1111-1111-1111-111111111111')).toBeNull();
    const [other] = (await db.insert(organization).values({ name: 'Other', slug: `o-${Date.now()}` }).returning({ id: organization.id })) as [{ id: string }];
    const shiftId = await newShift(700);
    expect(await getDrawer(db, other.id, shiftId)).toBeNull();
  });

  it('a closed shift still reports the numbers it was closed with', async () => {
    const shiftId = await newShift(0);
    await checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: water, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] });
    const closed = await closeShift(db, actor(), { shiftId, countedMinor: 1000 });
    expect(closed.closure.differenceMinor).toBe(0);
    const d = await getDrawer(db, tenant, shiftId);
    expect(d!.closed).toBe(true);
    expect(d!.closure!.countedMinor).toBe(1000);
    expect(drawerDifference(1000, d!)).toBe(0);
  });
});

describe('pending cash (I11)', () => {
  /** Simulates a future credit/held payment: money in the box that is not yet revenue. */
  async function pendingMovement(shiftId: string, amountMinor: number) {
    return withTenant(db, tenant, async (tx: any) => {
      const [m] = await tx.insert(cashMovements).values({ tenantId: tenant, shiftId, direction: 'in', status: 'pending', amountMinor }).returning({ id: cashMovements.id });
      return m.id as string;
    });
  }

  it('pending cash sits in the drawer and stays out of posted revenue', async () => {
    const shiftId = await newShift(0);
    await pendingMovement(shiftId, 1500);
    const d = await getDrawer(db, tenant, shiftId);
    expect(d!.pendingCash).toBe(1500);
    expect(d!.expectedPosted).toBe(0);
    expect(d!.expectedInDrawer).toBe(1500);
  });

  it('resolving as posted moves it into posted revenue without editing the movement row', async () => {
    const shiftId = await newShift(0);
    const movementId = await pendingMovement(shiftId, 1500);
    const { drawer, replayed } = await resolvePendingCash(db, actor(), { movementId, resolution: 'posted' });
    expect(replayed).toBe(false);
    expect([drawer.pendingCash, drawer.expectedPosted, drawer.expectedInDrawer]).toEqual([0, 1500, 1500]);

    const [row] = await withTenant(db, tenant, async (tx: any) => tx.select().from(cashMovements).where(eq(cashMovements.id, movementId)));
    expect(row.status).toBe('pending'); // frozen at insert: the ledger row was never rewritten
  });

  it('resolving as returned takes the money out of the box entirely', async () => {
    const shiftId = await newShift(0);
    const movementId = await pendingMovement(shiftId, 1500);
    const { drawer } = await resolvePendingCash(db, actor(), { movementId, resolution: 'returned' });
    expect([drawer.pendingCash, drawer.expectedPosted, drawer.expectedInDrawer]).toEqual([0, 0, 0]);
  });

  it('replays the same resolution and refuses a different one', async () => {
    const shiftId = await newShift(0);
    const movementId = await pendingMovement(shiftId, 900);
    await resolvePendingCash(db, actor(), { movementId, resolution: 'posted' });
    expect((await resolvePendingCash(db, actor(), { movementId, resolution: 'posted' })).replayed).toBe(true);
    await expect(resolvePendingCash(db, actor(), { movementId, resolution: 'returned' })).rejects.toMatchObject({ code: 'resolution_conflict' });
  });

  it('refuses to resolve a movement that is not pending', async () => {
    const shiftId = await newShift(0);
    const { sale } = await checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: water, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] });
    const [movement] = await withTenant(db, tenant, async (tx: any) =>
      tx.select().from(cashMovements).where(eq(cashMovements.paymentId, (tx as any).paymentId ?? '00000000-0000-0000-0000-000000000000')).limit(1),
    ).catch(() => [undefined]);
    void sale;
    void movement;
    const [anyPosted] = await withTenant(db, tenant, async (tx: any) =>
      tx.select().from(cashMovements).where(eq(cashMovements.status, 'posted')).limit(1),
    );
    await expect(resolvePendingCash(db, actor(), { movementId: anyPosted.id, resolution: 'posted' })).rejects.toMatchObject({ code: 'movement_not_pending' });
  });

  it('refuses an invalid resolution word before touching the database', async () => {
    const shiftId = await newShift(0);
    const movementId = await pendingMovement(shiftId, 100);
    await expect(
      resolvePendingCash(db, actor(), { movementId, resolution: 'void' as any }),
    ).rejects.toMatchObject({ code: 'invalid_resolution' });
  });
});

describe('derived payment status (I10)', () => {
  it('is a pure function of the three sums', () => {
    expect(derivePaymentStatus(1000, 0, 0)).toBe('unpaid');
    expect(derivePaymentStatus(1000, 400, 0)).toBe('partially_paid');
    expect(derivePaymentStatus(1000, 1000, 0)).toBe('paid');
    expect(derivePaymentStatus(1000, 1000, 300)).toBe('partially_refunded');
    expect(derivePaymentStatus(1000, 1000, 1000)).toBe('refunded');
  });

  it('a fresh cash sale is paid, with nothing outstanding', async () => {
    const shiftId = await newShift(0);
    const { sale } = await checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: water, quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 2000 }] });
    const st = await getPaymentStatus(db, tenant, sale.id);
    expect([st!.paidMinor, st!.refundedMinor, st!.outstandingMinor, st!.status]).toEqual([2000, 0, 0, 'paid']);
  });

  it('a refund makes it partially_refunded, and a full refund refunded', async () => {
    const shiftId = await newShift(0);
    const { sale, payments: pays } = await checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: water, quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 2000 }] });
    await createRefund(db, actor(), { idempotencyKey: key('ref'), originalTransactionId: sale.id, paymentId: pays[0]!.id, shiftId, items: [{ variantId: water, quantity: '1' }] });
    let st = await getPaymentStatus(db, tenant, sale.id);
    expect([st!.refundedMinor, st!.netPaidMinor, st!.status]).toEqual([1000, 1000, 'partially_refunded']);

    await createRefund(db, actor(), { idempotencyKey: key('ref'), originalTransactionId: sale.id, paymentId: pays[0]!.id, shiftId, items: [{ variantId: water, quantity: '1' }] });
    st = await getPaymentStatus(db, tenant, sale.id);
    expect([st!.netPaidMinor, st!.outstandingMinor, st!.status]).toEqual([0, 2000, 'refunded']);
  });

  it('returns null for an unknown sale and for another tenant', async () => {
    expect(await getPaymentStatus(db, tenant, '22222222-2222-2222-2222-222222222222')).toBeNull();
    const [other] = (await db.insert(organization).values({ name: 'Other2', slug: `o2-${Date.now()}` }).returning({ id: organization.id })) as [{ id: string }];
    const shiftId = await newShift(0);
    const { sale } = await checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: water, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] });
    expect(await getPaymentStatus(db, other.id, sale.id)).toBeNull();
  });
});

describe('recordPayment — settling a sale later', () => {
  /** A sale rung up with no money taken: what a deposit or a held order looks like. */
  async function unpaidSale(variantId: string, quantity: string) {
    return withTenant(db, tenant, async (tx: any) => {
      const price = variantId === water ? 1000 : 2000;
      const total = price * Number(quantity);
      const [s] = await tx.insert(salesTransactions).values({
        tenantId: tenant, kind: 'sale', totalMinor: total, idempotencyKey: key('unpaid'), requestHash: 'h', createdBy: tenant,
      }).returning({ id: salesTransactions.id, totalMinor: salesTransactions.totalMinor });
      return { id: s.id as string, totalMinor: s.totalMinor as number };
    });
  }

  it('takes a deposit, then the balance, and derives partially_paid then paid', async () => {
    const sale = await unpaidSale(oil, '1'); // 2000 owed
    let st = await getPaymentStatus(db, tenant, sale.id);
    expect(st!.status).toBe('unpaid');

    const shiftId = await newShift(0);
    await recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 500 } });
    st = await getPaymentStatus(db, tenant, sale.id);
    expect([st!.paidMinor, st!.outstandingMinor, st!.status]).toEqual([500, 1500, 'partially_paid']);

    await recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'card', amountMinor: 1500 } });
    st = await getPaymentStatus(db, tenant, sale.id);
    expect([st!.paidMinor, st!.outstandingMinor, st!.status]).toEqual([2000, 0, 'paid']);
  });

  it('rejects paying more than is outstanding', async () => {
    const sale = await unpaidSale(water, '1'); // 1000 owed
    const shiftId = await newShift(0);
    await expect(
      recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 1001 } }),
    ).rejects.toMatchObject({ code: 'payment_exceeds_outstanding' });
  });

  it('rejects a cash payment with no open shift, and one against a closed shift', async () => {
    const sale = await unpaidSale(water, '1');
    await expect(
      recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, tender: { method: 'cash', amountMinor: 500 } }),
    ).rejects.toMatchObject({ code: 'shift_required_for_cash' });

    const shiftId = await newShift(0);
    await closeShift(db, actor(), { shiftId, countedMinor: 0 });
    await expect(
      recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 500 } }),
    ).rejects.toMatchObject({ code: 'shift_closed' });
  });

  it('replays the same request and refuses the same key with a different body', async () => {
    const sale = await unpaidSale(oil, '1');
    const shiftId = await newShift(0);
    const k = key('pay');
    const first = await recordPayment(db, actor(), { idempotencyKey: k, transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 500 } });
    const again = await recordPayment(db, actor(), { idempotencyKey: k, transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 500 } });
    expect([first.replayed, again.replayed, again.paymentId]).toEqual([false, true, first.paymentId]);
    await expect(
      recordPayment(db, actor(), { idempotencyKey: k, transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 600 } }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('cash payments reach the drawer; card payments do not', async () => {
    const sale = await unpaidSale(oil, '1');
    const shiftId = await newShift(0);
    await recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 800, tenderedMinor: 1000 } });
    let d = await getDrawer(db, tenant, shiftId);
    expect([d!.cashInMinor, d!.cashOutMinor, d!.expectedInDrawer]).toEqual([1000, 200, 800]);

    await recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, tender: { method: 'card', amountMinor: 1200 } });
    d = await getDrawer(db, tenant, shiftId);
    expect(d!.expectedInDrawer).toBe(800);
  });

  it('rejects a zero or negative payment at the service boundary', async () => {
    const sale = await unpaidSale(water, '1');
    const shiftId = await newShift(0);
    await expect(
      recordPayment(db, actor(), { idempotencyKey: key('pay'), transactionId: sale.id, shiftId, tender: { method: 'cash', amountMinor: 0 } }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });
});
