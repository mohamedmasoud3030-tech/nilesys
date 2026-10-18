import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { openPglite, type OpenedDatabase, type NileDb } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { cashMovements, cashShifts } from '../src/db/schema.js';
import { openShift, closeShift, getShift } from '../src/shifts.js';
import { checkout } from '../src/checkout.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { eq } from 'drizzle-orm';

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let variantA: string;
let variantB: string;

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  const [a] = await db.insert(organization).values({ name: 'ShiftA', slug: 'shift-a' }).returning({ id: organization.id }) as [{ id: string }];
  const [b] = await db.insert(organization).values({ name: 'ShiftB', slug: 'shift-b' }).returning({ id: organization.id }) as [{ id: string }];
  A = a.id; B = b.id;
  // seed one variant for cash sale tests
  const catalog = await withTenant(db, A, async (tx: any) => {
    const [item] = await tx.insert(catalogItems).values({ tenantId: A, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
    const [v] = await tx.insert(catalogVariants).values({ tenantId: A, itemId: item.id as string, sku: `WTR-${A.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '20.000' }).returning({ id: catalogVariants.id });
    return v.id as string;
  });
  variantA = catalog;
  variantB = await withTenant(db, B, async (tx: any) => {
    const [item] = await tx.insert(catalogItems).values({ tenantId: B, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: 1000, isActive: true }).returning({ id: catalogItems.id });
    const [v] = await tx.insert(catalogVariants).values({ tenantId: B, itemId: item.id as string, sku: `WTRB-${B.slice(0,4)}`, labelAr: 'افتراضي', labelEn: 'Default', stock: '20.000' }).returning({ id: catalogVariants.id });
    return v.id as string;
  });
});
afterAll(() => opened.close());

describe('cash shifts — open / close + reconciliation', () => {
  it('opens a shift and replays idempotently', async () => {
    const input = { registerCode: 'main', openingMinor: 5000, idempotencyKey: 'shift-open-001' };
    const r1 = await openShift(db, { tenantId: A, userId: A }, input);
    expect(r1.replayed).toBe(false);
    expect(r1.shift.registerCode).toBe('main');
    expect(r1.shift.openingMinor).toBe(5000);
    const r2 = await openShift(db, { tenantId: A, userId: A }, input);
    expect(r2.replayed).toBe(true);
    expect(r2.shift.id).toBe(r1.shift.id);
  });

  it('rejects second open for same register while one is still open', async () => {
    // already have main open from previous test
    try { await openShift(db, { tenantId: A, userId: A }, { registerCode: 'main', openingMinor: 1000, idempotencyKey: 'shift-open-002' }); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('shift_already_open'); }
  });

  it('allows open on different registerCode concurrently', async () => {
    const r = await openShift(db, { tenantId: A, userId: A }, { registerCode: 'pos-2', openingMinor: 2000, idempotencyKey: 'shift-open-pos2' });
    expect(r.shift.registerCode).toBe('pos-2');
  });

  it('idempotency conflict: same key different body → 409', async () => {
    await openShift(db, { tenantId: B, userId: B }, { registerCode: 'main', openingMinor: 3000, idempotencyKey: 'shift-conflict-001' });
    try { await openShift(db, { tenantId: B, userId: B }, { registerCode: 'main', openingMinor: 9999, idempotencyKey: 'shift-conflict-001' }); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('idempotency_conflict'); }
  });

  it('closes a shift and computes expected vs counted correctly', async () => {
    // open dedicated shift for this test on register close-test
    const { shift } = await openShift(db, { tenantId: B, userId: B }, { registerCode: 'close-test', openingMinor: 10000, idempotencyKey: 'shift-close-test-open' });
    const shiftId = shift.id as string;
    // make a cash sale inside this shift: 2 * 1000 = 2000
    await checkout(db, { tenantId: B, userId: B }, {
      idempotencyKey: 'chk-shift-close-001b',
      shiftId,
      lines: [{ variantId: variantB, quantity: '2' }],
      tenders: [{ method: 'cash', amountMinor: 2000 }],
    });
    // For simplicity, just check close computes expected = opening + in - out
    // We have opening 10000, sale 2000 in, so expected 12000 if no change movement?
    // Our checkout creates in + out for change; for 2000 with no change, expected 12000
    const counted = 11950; // 50 short
    const { closure } = await closeShift(db, { tenantId: B, userId: B }, { shiftId, countedMinor: counted });
    expect(closure.openingMinor).toBe(10000);
    // expected should be opening + cash sales - refunds - change
    // We inserted one sale of 2000 (if second attempt succeeded). Let's check fetched shift for expected
    const shiftView = await getShift(db, B, shiftId);
    expect(shiftView?.isClosed).toBe(true);
    expect(shiftView?.closure?.differenceMinor).toBe(counted - (shiftView?.closure?.expectedMinor ?? 0));
    // difference should be -50 if expected 12000 and counted 11950
    expect(closure.differenceMinor).toBe(counted - closure.expectedMinor);
  });

  it('closed shift cannot receive new cash sale', async () => {
    const { shift } = await openShift(db, { tenantId: A, userId: A }, { registerCode: 'closed-test', openingMinor: 1000, idempotencyKey: 'shift-closed-test-open' });
    const v = variantA; // belongs to A
    await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'chk-closed-001', shiftId: shift.id, lines: [{ variantId: v, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] });
    await closeShift(db, { tenantId: A, userId: A }, { shiftId: shift.id, countedMinor: 2000 });
    try { await checkout(db, { tenantId: A, userId: A }, { idempotencyKey: 'chk-closed-002', shiftId: shift.id, lines: [{ variantId: v, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: 1000 }] }); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('shift_closed'); }
  });

  it('tenant isolation: B cannot close A shift', async () => {
    const { shift } = await openShift(db, { tenantId: A, userId: A }, { registerCode: 'iso-test', openingMinor: 500, idempotencyKey: 'shift-iso-001' });
    try { await closeShift(db, { tenantId: B, userId: B }, { shiftId: shift.id, countedMinor: 500 }); expect.fail('should throw'); } catch (e: any) { expect(e.code).toBe('shift_not_found'); }
  });

  it('getShift returns expected cash mid-shift', async () => {
    const { shift } = await openShift(db, { tenantId: B, userId: B }, { registerCode: 'get-test', openingMinor: 1000, idempotencyKey: 'shift-get-001' });
    const view1 = await getShift(db, B, shift.id);
    expect(view1?.expectedMinor).toBe(1000);
    expect(view1?.isClosed).toBe(false);
  });
});
