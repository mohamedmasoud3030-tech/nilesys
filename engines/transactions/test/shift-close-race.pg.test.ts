/**
 * Shift close vs cash sale / cash refund — real PostgreSQL only.
 *
 * Defect (found 2026-10-18, reproduced 50/60 on PG 17): checkout and refunds
 * took the advisory lock `shift:<tenant>:<shift>`, closeShift took
 * `shift-close:<tenant>:<shift>`. Different keys never block each other, so a
 * sale could check "no closure yet", the close could sum the movements
 * without it, and both commit: cash in a closed shift, missing from the
 * reconciliation.
 *
 * Contract proven here: every cash movement attached to a shift is counted by
 * its closure exactly once, and an operation that loses the race is refused
 * with `shift_closed` — never silently recorded.
 *
 * PGlite is a single connection and cannot show this; the file is skipped
 * unless NILE_TEST_PG_ADMIN_URL points at a disposable server.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ADMIN_URL, createPgHarness, rawClient, waitForLockWaiters, type PgHarness } from '../../catalog/test/pg-harness.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { cashMovements, cashShiftClosures, payments, refunds } from '../src/db/schema.js';
import { checkout } from '../src/checkout.js';
import { createRefund } from '../src/refunds.js';
import { closeShift, openShift, shiftLockKey } from '../src/shifts.js';

const PRICE = 1000;
const OPENING = 5000;
let h: PgHarness;
let db: any;
let T: string;
let V: string;
let seq = 0;
const key = (p: string) => `${p}-${seq++}-${Date.now()}`;
const actor = () => ({ tenantId: T, userId: T });
const codeOf = (e: any) => { let c = e; while (c && !c.code) c = c.cause; return c?.code as string | undefined; };

async function newShift() {
  const { shift } = await openShift(db, actor(), { registerCode: key('reg'), openingMinor: OPENING, idempotencyKey: key('open') });
  return shift!.id as string;
}
const sale = (shiftId: string) =>
  checkout(db, actor(), { idempotencyKey: key('chk'), shiftId, lines: [{ variantId: V, quantity: '1' }], tenders: [{ method: 'cash', amountMinor: PRICE }] });

async function ledgerOf(shiftId: string) {
  return withTenant(db, T, async (tx: any) => {
    const [m] = await tx.select({
      inMinor: sql<string>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='in' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
      outMinor: sql<string>`COALESCE(SUM(CASE WHEN ${cashMovements.direction}='out' THEN ${cashMovements.amountMinor} ELSE 0 END),0)`,
      ins: sql<string>`COUNT(*) FILTER (WHERE ${cashMovements.direction}='in')`,
    }).from(cashMovements).where(and(eq(cashMovements.shiftId, shiftId), eq(cashMovements.status, 'posted')));
    const [p] = await tx.select({ n: sql<string>`COUNT(*)` }).from(payments).where(eq(payments.shiftId, shiftId));
    const [r] = await tx.select({ n: sql<string>`COUNT(*)` }).from(refunds).where(eq(refunds.shiftId, shiftId));
    const closures = await tx.select().from(cashShiftClosures).where(eq(cashShiftClosures.shiftId, shiftId));
    return { inMinor: Number(m.inMinor), outMinor: Number(m.outMinor), ins: Number(m.ins), payments: Number(p.n), refunds: Number(r.n), closures };
  });
}

describe.skipIf(!ADMIN_URL)('shift close vs cash operations (real PostgreSQL)', () => {
  beforeAll(async () => {
    h = await createPgHarness('shiftrace');
    db = h.opened.db;
    T = (await db.insert(organization).values({ name: 'ShiftRace', slug: key('shiftrace') }).returning({ id: organization.id }))[0].id;
    V = await withTenant(db, T, async (tx: any) => {
      const [i] = await tx.insert(catalogItems).values({ tenantId: T, nameAr: 'مياه', nameEn: 'Water', category: 'drinks', priceMinor: PRICE, isActive: true }).returning({ id: catalogItems.id });
      const [v] = await tx.insert(catalogVariants).values({ tenantId: T, itemId: i.id, sku: key('SR'), labelAr: 'افتراضي', labelEn: 'Default', stock: '100000.000' }).returning({ id: catalogVariants.id });
      return v.id as string;
    });
  }, 60_000);
  afterAll(async () => { await h?.dispose(); });

  it('closeShift waits for the same advisory lock that cash sales and refunds hold', async () => {
    const shiftId = await newShift();
    const holder = rawClient(h.loginUrl);
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1)', [shiftLockKey(T, shiftId)]);
      const closing = closeShift(db, actor(), { shiftId, countedMinor: OPENING });
      await waitForLockWaiters(h.observer, h.dbName, 1, 5_000); // throws if closeShift is not waiting
      await holder.query('COMMIT');
      const { closure } = await closing;
      expect(closure.expectedMinor).toBe(OPENING);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
  }, 30_000);

  it('concurrent sales, a refund and the close: each cash movement is reconciled exactly once', async () => {
    const ITER = 40;
    let raced = 0;
    for (let i = 0; i < ITER; i++) {
      const shiftId = await newShift();
      const prior = await sale(shiftId); // refundable cash sale, committed before the race
      const ops = await Promise.allSettled([
        sale(shiftId),
        sale(shiftId),
        createRefund(db, actor(), { idempotencyKey: key('ref'), originalTransactionId: prior.sale.id, paymentId: prior.payments[0]!.id, items: [{ variantId: V, quantity: '1' }], shiftId }),
        closeShift(db, actor(), { shiftId, countedMinor: 0 }),
      ]);
      const close = ops[3]!;
      expect(close.status, `iteration ${i}: close must succeed`).toBe('fulfilled');
      for (const op of ops.slice(0, 3)) {
        if (op.status === 'rejected') { raced++; expect(codeOf(op.reason), `iteration ${i}`).toBe('shift_closed'); }
      }
      const okSales = 1 + ops.slice(0, 2).filter((o) => o.status === 'fulfilled').length;
      const okRefunds = ops[2]!.status === 'fulfilled' ? 1 : 0;
      const l = await ledgerOf(shiftId);
      expect(l.closures, `iteration ${i}: one closure`).toHaveLength(1);
      // every committed cash movement on this shift is inside the closure — none after it
      expect(l.closures[0].expectedMinor, `iteration ${i}: closure = opening + in − out of ALL movements`).toBe(OPENING + l.inMinor - l.outMinor);
      // recorded once: one payment and one inbound movement per successful sale, one refund row per successful refund
      expect([l.payments, l.ins, l.refunds], `iteration ${i}`).toEqual([okSales, okSales, okRefunds]);
      expect(l.inMinor - l.outMinor).toBe(okSales * PRICE - okRefunds * PRICE);
    }
    console.log(`shift-close race: ${ITER} iterations, ${raced} operations refused with shift_closed`);
  }, 180_000);
});
