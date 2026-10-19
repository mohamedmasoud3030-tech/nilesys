// TEMPORARY PROBE — lives only in /tmp/wt-dst, never committed.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { payments, salesTransactions } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { openShift, closeShift } from '../src/shifts.js';
import { createRefund } from '../src/refunds.js';
import { getDailyReport } from '../src/reports.js';

let opened: OpenedDatabase; let db: NileDb; let T: string; let V: string;
beforeAll(async () => {
  opened = await openPglite(); db = opened.db;
  const [o] = await db.insert(organization).values({ name: 'Probe', slug: 'probe-' + Date.now() }).returning({ id: organization.id }) as [{ id: string }];
  T = o.id;
  V = await withTenant(db, T, async (tx: any) => {
    const [i] = await tx.insert(catalogItems).values({ tenantId: T, nameAr: 'م', nameEn: 'W', category: 'd', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
    const [v] = await tx.insert(catalogVariants).values({ tenantId: T, itemId: i.id, sku: 'PRB-' + Date.now(), labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }).returning({ id: catalogVariants.id });
    return v.id as string;
  });
});
afterAll(() => opened.close());

async function saleAt(iso: string, minor: number, key: string) {
  await withTenant(db, T, async (tx: any) => {
    const [s] = await tx.insert(salesTransactions).values({ tenantId: T, kind: 'sale', totalMinor: minor, idempotencyKey: key, requestHash: 'h', createdBy: T, createdAt: new Date(iso) }).returning({ id: salesTransactions.id });
    await tx.insert(payments).values({ tenantId: T, transactionId: s.id, method: 'cash', amountMinor: minor, idempotencyKey: key + '-p', requestHash: 'h', createdBy: T, createdAt: new Date(iso) });
  });
}

describe('PROBE-DST — production getDailyReport beyond the April boundary', () => {
  it('P1 summer (+3): 2026-07-15T21:30Z is Cairo 07-16 00:30 → belongs to 07-16', async () => {
    await saleAt('2026-07-15T21:30:00Z', 111, 'p1-' + Date.now());
    expect((await getDailyReport(db, T, { from: '2026-07-15', to: '2026-07-15' })).grossMinor).toBe(0);
    expect((await getDailyReport(db, T, { from: '2026-07-16', to: '2026-07-16' })).grossMinor).toBe(111);
  });
  it('P2 25h day 2026-10-29: 00:30 (+3) and 23:30 (+2) both on 10-29; 10-30 00:00 (+2) not', async () => {
    await saleAt('2026-10-28T21:30:00Z', 300, 'p2a-' + Date.now()); // Cairo 10-29 00:30 +3
    await saleAt('2026-10-29T21:30:00Z', 400, 'p2b-' + Date.now()); // Cairo 10-29 23:30 +2 (after fall-back)
    await saleAt('2026-10-29T22:00:00Z', 500, 'p2c-' + Date.now()); // Cairo 10-30 00:00 +2
    expect((await getDailyReport(db, T, { from: '2026-10-29', to: '2026-10-29' })).grossMinor).toBe(700);
    expect((await getDailyReport(db, T, { from: '2026-10-30', to: '2026-10-30' })).grossMinor).toBe(500);
    expect((await getDailyReport(db, T, { from: '2026-10-28', to: '2026-10-28' })).grossMinor).toBe(0);
  });
});

describe('PROBE-POS — behaviours not covered by DST tests', () => {
  it('P3 split tender: two cash tenders with the same amount (500 + 500) for a 1000 sale', async () => {
    const { shift } = await openShift(db, { tenantId: T, userId: T }, { registerCode: 'p3', openingMinor: 0, idempotencyKey: 'p3-open-' + Date.now() });
    let outcome: string;
    try {
      const r = await checkout(db, { tenantId: T, userId: T }, { idempotencyKey: 'p3-chk-' + Date.now(), shiftId: shift!.id, lines: [{ variantId: V, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 500 }, { method: 'cash', amountMinor: 500 }] });
      outcome = `ok payments=${r.payments.length}`;
    } catch (e: any) { let c = e; while (c && !c.code) c = c.cause; outcome = `error ${c?.code ?? e.message}`; }
    console.log('P3 outcome:', outcome);
    expect(outcome).toBe('ok payments=2');
  });
  it('P4 net after same-day partial cash refund', async () => {
    const T2 = (await db.insert(organization).values({ name: 'P4', slug: 'p4-' + Date.now() }).returning({ id: organization.id }) as [{ id: string }])[0].id;
    const V2 = await withTenant(db, T2, async (tx: any) => {
      const [i] = await tx.insert(catalogItems).values({ tenantId: T2, nameAr: 'م', nameEn: 'W', category: 'd', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
      const [v] = await tx.insert(catalogVariants).values({ tenantId: T2, itemId: i.id, sku: 'P4-' + Date.now(), labelAr: 'افتراضي', labelEn: 'Default', stock: '10.000' }).returning({ id: catalogVariants.id });
      return v.id as string;
    });
    const { shift } = await openShift(db, { tenantId: T2, userId: T2 }, { registerCode: 'p4', openingMinor: 0, idempotencyKey: 'p4-open-' + Date.now() });
    const c = await checkout(db, { tenantId: T2, userId: T2 }, { idempotencyKey: 'p4-chk-' + Date.now(), shiftId: shift!.id, lines: [{ variantId: V2, quantity: '3' }], tenders: [{ method: 'cash', amountMinor: 3000, tenderedMinor: 5000 }] });
    await createRefund(db, { tenantId: T2, userId: T2 }, { idempotencyKey: 'p4-ref-' + Date.now(), originalTransactionId: c.sale.id, paymentId: c.payments[0]!.id, items: [{ variantId: V2, quantity: '1' }], shiftId: shift!.id });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const r = await getDailyReport(db, T2, { from: today, to: today });
    const { closure } = await closeShift(db, { tenantId: T2, userId: T2 }, { shiftId: shift!.id, countedMinor: 2000 });
    console.log('P4', JSON.stringify({ gross: r.grossMinor, refunds: r.refundsMinor, net: r.netMinor, byMethod: r.byMethod, expected: closure.expectedMinor, diff: closure.differenceMinor }));
    expect([r.grossMinor, r.refundsMinor, r.netMinor]).toEqual([3000, 1000, 2000]);
    expect(closure.expectedMinor).toBe(2000); // 0 + 5000 in − 2000 change − 1000 refund
  });
});
