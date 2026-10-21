import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { closeShift, getShift, openShift } from '../src/shifts.js';
import { getDailyReport } from '../src/reports.js';

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear().toString().padStart(4, '0')}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
}

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let vA: string;

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'IntegA', slug: 'integ-a' }).returning({ id: organization.id }) as [{ id: string }];
  const [b] = await db.insert(organization).values({ name: 'IntegB', slug: 'integ-b' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id; B = b.id;
  const [item] = await withTenant(db, A, async (tx: any) => tx.insert(catalogItems).values({ tenantId: A, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id }));
  const [variant] = await withTenant(db, A, async (tx: any) => tx.insert(catalogVariants).values({ tenantId: A, itemId: item.id as string, sku: `WTR-${A.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '50.000' }).returning({ id: catalogVariants.id }));
  vA = variant.id as string;
  // B variant for isolation check
  const [itemB] = await withTenant(db, B, async (tx: any) => tx.insert(catalogItems).values({ tenantId: B, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id }));
  await withTenant(db, B, async (tx: any) => tx.insert(catalogVariants).values({ tenantId: B, itemId: itemB.id as string, sku: `WTRB-${B.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '50.000' }));
});
afterAll(() => opened.close());

describe('integration — checkout → refund → shift close → report (isolated PGlite)', () => {
  it('full workflow produces correct stock, cash, and report', async () => {
    const today = todayStr();
    // 1. open shift 5000
    const { shift } = await openShift(db, { tenantId: A, userId: A }, { registerCode: 'main', openingMinor: 5000, idempotencyKey: 'integ-shift-001' });
    const shiftId = shift!.id as string;
    expect(shift!.openingMinor).toBe(5000);

    // 2. checkout cash 3 units = 3000
    const c1 = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'integ-chk-001',
      shiftId,
      lines: [{ variantId: vA, quantity: '3' }],
      tenders: [{ method: 'cash', amountMinor: 3000 }],
    });
    expect(c1.sale.totalMinor).toBe(3000);
    // stock 50 -> 47
    let stock = await withTenant(db, A, async (tx: any) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return r.s;
    });
    expect(Number(stock)).toBe(47);

    // 3. checkout card 2 units =2000 (no shift needed)
    const c2 = await checkout(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'integ-chk-002',
      lines: [{ variantId: vA, quantity: '2' }],
      tenders: [{ method: 'card', amountMinor: 2000 }],
    });
    expect(c2.sale.totalMinor).toBe(2000);
    stock = await withTenant(db, A, async (tx: any) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return r.s;
    });
    expect(Number(stock)).toBe(45); // 47-2

    // 4. partial refund 1 unit from cash sale (1000) with shift
    const pays = await withTenant(db, A, async (tx: any) => {
      const { payments } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      return tx.select().from(payments).where(eq(payments.transactionId, c1.sale.id));
    });
    const pay = pays[0];
    const { refund } = await createRefund(db, { tenantId: A, userId: A }, {
      idempotencyKey: 'integ-refund-001',
      originalTransactionId: c1.sale.id,
      paymentId: pay.id,
      items: [{ variantId: vA, quantity: '1' }],
      shiftId,
    });
    expect(refund!.amountMinor).toBe(1000);
    // stock restored 45 ->46
    stock = await withTenant(db, A, async (tx: any) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await tx.select({ s: catalogVariants.stock }).from(catalogVariants).where(eq(catalogVariants.id, vA));
      return r.s;
    });
    expect(Number(stock)).toBe(46);

    // 5. close shift: expected = 5000 + 3000 -1000 =7000
    const { closure } = await closeShift(db, { tenantId: A, userId: A }, { shiftId, countedMinor: 7000 });
    expect(closure.expectedMinor).toBe(7000);
    expect(closure.differenceMinor).toBe(0);
    expect(closure.countedMinor).toBe(7000);

    // verify shift closed cannot accept cash
    try {
      await checkout(db, { tenantId: A, userId: A }, {
        idempotencyKey: 'integ-chk-003',
        shiftId,
        lines: [{ variantId: vA, quantity: '1' }],
        tenders: [{ method: 'cash', amountMinor: 1000 }],
      });
      expect.fail('should throw shift_closed');
    } catch (e: any) { expect(e.code).toBe('shift_closed'); }

    // 6. daily report: gross 5000, refunds 1000, net 4000, counts 2 gross 1 refund, byMethod cash 3000 card 2000
    const report = await getDailyReport(db, A, { from: today, to: today });
    expect(report.grossMinor).toBe(5000);
    expect(report.grossCount).toBe(2);
    expect(report.refundsMinor).toBe(1000);
    expect(report.refundsCount).toBe(1);
    expect(report.netMinor).toBe(4000);
    expect(report.byMethod.find((m) => m.method === 'cash')?.totalMinor).toBe(3000);
    expect(report.byMethod.find((m) => m.method === 'card')?.totalMinor).toBe(2000);

    // 7. tenant isolation: B report is zero, cannot see A shift
    const repB = await getDailyReport(db, B, { from: today, to: today });
    expect(repB.grossMinor).toBe(0);
    const shiftB = await getShift(db, B, shiftId);
    expect(shiftB).toBeNull();
  });

  it('append-only: nile_app cannot UPDATE financial records (42501)', async () => {
    // This is covered by rls.test, but we verify refunds/payments are included
    const { eq, sql } = await import('drizzle-orm');
    // Try to update a payment as nile_app (should be revoked)
    try {
      await withTenant(db, A, async (tx: any) => {
        const { payments } = await import('../src/db/schema.js');
        await tx.update(payments).set({ amountMinor: 9999 }).where(eq(payments.tenantId, A));
      });
      expect.fail('should have thrown 42501');
    } catch (e: any) {
      let code: any = e;
      while (code && !code.code) code = code.cause;
      expect(code?.code).toBe('42501');
    }
  });
});
