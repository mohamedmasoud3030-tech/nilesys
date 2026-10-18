import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashShifts } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { getDailyReport } from '../src/reports.js';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let variantA: string;
let variantB: string;

function todayStr() {
  const d = new Date();
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'ReportA', slug: 'report-a' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id;
  const seed = await withTenant(db, A, async (tx: any) => {
    const [item1] = await tx.insert(catalogItems).values({ tenantId: A, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
    const [v1] = await tx.insert(catalogVariants).values({ tenantId: A, itemId: item1.id as string, sku: `WTR-${A.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }).returning({ id: catalogVariants.id });
    const [item2] = await tx.insert(catalogItems).values({ tenantId: A, nameAr: 'زيت', nameEn: 'Oil', category: 'food', priceMinor: 2000, isActive: true }).returning({ id: catalogItems.id });
    const [v2] = await tx.insert(catalogVariants).values({ tenantId: A, itemId: item2.id as string, sku: `OIL-${A.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '100.000' }).returning({ id: catalogVariants.id });
    return { v1: v1.id as string, v2: v2.id as string };
  });
  variantA = seed.v1; variantB = seed.v2;
});
afterAll(() => opened.close());

describe('daily reports — gross/refunds/net, by method', () => {
  it('calculates gross, refunds, net correctly for today', async () => {
    const today = todayStr();
    const shiftId = await withTenant(db, A, async (tx: any) => {
      const [s] = await tx.insert(cashShifts).values({ tenantId: A, registerCode: 'main', openedBy: A, openingMinor: 0, idempotencyKey: 'shift-report-001', requestHash: 'h1' }).returning({ id: cashShifts.id });
      return s.id as string;
    });
    // Sale 1: 2 water cash 2000
    const s1 = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'rep-chk-001',
      shiftId,
      lines: [{ variantId: variantA, quantity: '2' }],
      tenders: [{ method: 'cash', amountMinor: 2000 }],
    });
    // Sale 2: 1 oil card 2000
    const s2 = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'rep-chk-002',
      lines: [{ variantId: variantB, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 2000 }],
    });
    // Sale 3: 1 water card 1000 (will be partially refunded)
    const s3 = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'rep-chk-003',
      lines: [{ variantId: variantA, quantity: '1' }],
      tenders: [{ method: 'card', amountMinor: 1000 }],
    });
    const pays = await withTenant(db, A, async (tx: any) => {
      const { payments } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const rows = await tx.select().from(payments).where(eq(payments.transactionId, s3.sale.id));
      return rows;
    });
    const pay = pays[0];
    await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'rep-refund-001',
      originalTransactionId: s3.sale.id,
      paymentId: pay.id,
      items: [{ variantId: variantA, quantity: '1' }],
    });

    const report = await getDailyReport(db, A, { from: today, to: today });
    expect(report.grossMinor).toBe(2000 + 2000 + 1000); // 5000
    expect(report.grossCount).toBe(3);
    expect(report.refundsMinor).toBe(1000);
    expect(report.refundsCount).toBe(1);
    expect(report.netMinor).toBe(4000);
    // byMethod should include cash 2000 and card 3000 (2000+1000), but refunds not subtracted from byMethod (gross payments)
    const cash = report.byMethod.find((m) => m.method === 'cash');
    const card = report.byMethod.find((m) => m.method === 'card');
    expect(cash?.totalMinor).toBe(2000);
    expect(card?.totalMinor).toBe(3000);
  });

  it('tenant isolation: other tenant report is zero', async () => {
    const [other] = await db.insert(organization).values({ name: 'ReportOther', slug: 'report-other' }).returning({ id: organization.id }) as [{ id: string }];
    const today = todayStr();
    const rep = await getDailyReport(db, other.id, { from: today, to: today });
    expect(rep.grossMinor).toBe(0);
    expect(rep.refundsMinor).toBe(0);
    expect(rep.netMinor).toBe(0);
    expect(rep.grossCount).toBe(0);
  });

  it('date filtering: future date returns zero', async () => {
    const future = '2099-01-01';
    const rep = await getDailyReport(db, A, { from: future, to: future });
    expect(rep.grossMinor).toBe(0);
  });
});
