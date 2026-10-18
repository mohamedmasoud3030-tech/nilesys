/**
 * Payments engine — acceptance tests (proposal 0007 §6).
 *
 * Runs on PGlite through the SAME migration + connection path production uses
 * (open.ts): migrations applied as owner, queries executed as `nile_app`.
 *
 * Acceptance test 5 (concurrency) needs TWO real connections; PGlite has one,
 * so those cases are skipped unless NILE_TEST_PG_ADMIN_URL points at a
 * disposable PostgreSQL server — the same pattern as pool-resilience.pg.test.ts.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPglite, type NileDb, type OpenedDatabase } from '../open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import { catalogItems, catalogVariants } from '../../catalog/src/db/schema.js';
import { salesTransactions } from '../../transactions/src/db/schema.js';
import {
  cashShifts, paymentTenders, payments, refunds, shiftClosures,
} from '../../transactions/src/db/payments-schema.js';
import {
  closeShift, expectedInDrawer, openShift, recordPayment, recordRefund, settleTenders,
} from '../../transactions/src/payments-service.js';
import { DomainError } from '../../transactions/src/line.js';

const APPEND_ONLY = ['cash_shifts', 'shift_closures', 'payments', 'payment_tenders', 'refunds'];

let opened: OpenedDatabase;
let db: NileDb;
let A: string;
let B: string;
let saleA: string;
let saleB: string;
let actorA: { tenantId: string; userId: string };
let actorB: { tenantId: string; userId: string };

async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  let c: any = err;
  while (c && !c.code) c = c.cause;
  expect(c?.code, String(err)).toBe(code);
}
async function rejectsDomain(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err, 'expected a DomainError').toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

async function seedSale(tenantId: string, key: string, totalMinor: number) {
  return withTenant(db, tenantId, async (tx: any) => {
    const [item] = await tx.insert(catalogItems).values({ tenantId, nameAr: 'صنف', nameEn: 'Item', category: 'x', priceMinor: totalMinor }).returning();
    await tx.insert(catalogVariants).values({ tenantId, itemId: item.id, sku: `SKU-${key}`, labelAr: 'ا', labelEn: 'a', stock: '5' }).returning();
    const [s] = await tx
      .insert(salesTransactions)
      .values({ tenantId, kind: 'sale', totalMinor, idempotencyKey: key, requestHash: 'h', createdBy: tenantId })
      .returning();
    return s.id as string;
  });
}

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;
  [{ id: A }] = (await db.insert(organization).values({ name: 'A', slug: 'a' }).returning({ id: organization.id })) as [{ id: string }];
  [{ id: B }] = (await db.insert(organization).values({ name: 'B', slug: 'b' }).returning({ id: organization.id })) as [{ id: string }];
  actorA = { tenantId: A, userId: A };
  actorB = { tenantId: B, userId: B };
  saleA = await seedSale(A, 'pay-a', 10_000);
  saleB = await seedSale(B, 'pay-b', 10_000);
});
afterAll(() => opened.close());

/* ---------------------------------------------------------- 1. privileges */

describe('acceptance 1 — the runtime role cannot rewrite the payments ledger', () => {
  it('nile_app holds SELECT + INSERT but neither UPDATE nor DELETE on all five tables', async () => {
    for (const t of APPEND_ONLY) {
      const res = (await db.execute(sql`
        SELECT has_table_privilege(current_user, ${t}, 'SELECT')  AS s,
               has_table_privilege(current_user, ${t}, 'INSERT')  AS i,
               has_table_privilege(current_user, ${t}, 'UPDATE')  AS u,
               has_table_privilege(current_user, ${t}, 'DELETE')  AS d`)) as any;
      expect({ t, ...res.rows[0] }).toEqual({ t, s: true, i: true, u: false, d: false });
    }
  });

  it('an UPDATE or DELETE inside the own tenant is refused (42501)', async () => {
    const { shift } = await openShift(db, actorA, { openingFloatMinor: 500, idempotencyKey: 'sh-priv' });
    for (const t of APPEND_ONLY) {
      await rejectsWith(withTenant(db, A, (tx: any) => tx.execute(sql.raw(`UPDATE ${t} SET tenant_id = tenant_id`))), '42501');
      await rejectsWith(withTenant(db, A, (tx: any) => tx.execute(sql.raw(`DELETE FROM ${t}`))), '42501');
    }
    await withTenant(db, A, async (tx: any) => {
      expect((await tx.select().from(cashShifts)).length).toBeGreaterThan(0);
      void shift;
    });
  });
});

/* ------------------------------------------------- 2. RLS and composite FK */

describe('acceptance 2 — tenant isolation', () => {
  it('tenant A cannot pay against tenant B’s sale', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r2', idempotencyKey: 'sh-r2' });
    await rejectsDomain(
      recordPayment(db, actorA, { saleId: saleB, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 10_000 }], idempotencyKey: 'x-b' }),
      'sale_not_found',
    );
  });

  it('tenant A cannot attach a payment to tenant B’s shift — RLS hides it before the FK is reached', async () => {
    const shiftB = (await openShift(db, actorB, { register: 'b-reg-1', idempotencyKey: 'sh-b1' })).shift;
    // RLS makes B’s shift invisible to A, so the service reports shift_not_found.
    // The composite FK is the second line of defence and is asserted to exist below.
    await rejectsDomain(
      recordPayment(db, actorA, { saleId: saleA, shiftId: shiftB.id, tenders: [{ method: 'cash', amountMinor: 100 }], idempotencyKey: 'xfk' }),
      'shift_not_found',
    );
  });

  it('every payments table carries a composite (tenant_id, …) foreign key', async () => {
    const res = (await db.execute(sql`
      SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname IN ('payments','payment_tenders','refunds','shift_closures')
        AND con.contype = 'f' AND con.conkey IS NOT NULL AND array_length(con.conkey, 1) = 2
      ORDER BY con.conname`)) as any;
    // payments(shift), payments(sale), payment_tenders(payment), refunds(payment), shift_closures(shift)
    expect(res.rows.length).toBe(5);
  });

  it('tenant A cannot read tenant B’s shift', async () => {
    const shiftB = (await openShift(db, actorB, { register: 'b-reg-2', idempotencyKey: 'sh-b2' })).shift;
    await withTenant(db, A, async (tx: any) => {
      expect((await tx.select().from(cashShifts).where(sql`${cashShifts.id} = ${shiftB.id}`)).length).toBe(0);
    });
  });
});

/* --------------------------------------------------------- 3. idempotency */

describe('acceptance 3 — idempotency', () => {
  it('a replay of openShift returns the identical row and creates nothing new', async () => {
    const first = await openShift(db, actorA, { register: 'r3', openingFloatMinor: 200, idempotencyKey: 'sh-idem' });
    const again = await openShift(db, actorA, { register: 'r3', openingFloatMinor: 200, idempotencyKey: 'sh-idem' });
    expect(again.replayed).toBe(true);
    expect(again.shift.id).toBe(first.shift.id);
    await withTenant(db, A, async (tx: any) => {
      expect((await tx.select().from(cashShifts).where(sql`${cashShifts.idempotencyKey} = 'sh-idem'`)).length).toBe(1);
    });
  });

  it('the same key with a different body is a conflict, not a replay', async () => {
    await openShift(db, actorA, { register: 'r4', openingFloatMinor: 100, idempotencyKey: 'sh-conf' });
    await rejectsDomain(openShift(db, actorA, { register: 'r4', openingFloatMinor: 999, idempotencyKey: 'sh-conf' }), 'idempotency_conflict');
  });

  it('a payment replay returns the same payment and tenders', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r5', idempotencyKey: 'sh-r5' });
    const input = { saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash' as const, amountMinor: 10_000 }], idempotencyKey: 'pay-idem' };
    const first = await recordPayment(db, actorA, input);
    const again = await recordPayment(db, actorA, input);
    expect(again.replayed).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);
    expect(again.tenders.length).toBe(first.tenders.length);
  });
});

/* -------------------------------------------------------------- 4. money */

describe('acceptance 4 — split tender and change, in integer minor units', () => {
  it('splits across methods and returns the change; the settled sum is exact', () => {
    // 100.00 EGP bill: 50.00 cash from a 70.00 note (20.00 back) + 50.00 card.
    const { totalMinor } = settleTenders([
      { method: 'cash', amountMinor: 7_000, changeMinor: 2_000 },
      { method: 'card', amountMinor: 5_000 },
    ]);
    expect(totalMinor).toBe(10_000);
  });

  it('refuses zero, negative and non-integer amounts', () => {
    expect(() => settleTenders([{ method: 'cash', amountMinor: 0 }])).toThrowError(DomainError);
    expect(() => settleTenders([{ method: 'cash', amountMinor: -1 }])).toThrowError(DomainError);
    expect(() => settleTenders([{ method: 'cash', amountMinor: 10.5 }])).toThrowError(DomainError);
    expect(() => settleTenders([])).toThrowError(DomainError);
  });

  it('refuses change larger than the tender, and change on non-cash methods', () => {
    expect(() => settleTenders([{ method: 'cash', amountMinor: 100, changeMinor: 101 }])).toThrowError(DomainError);
    expect(() => settleTenders([{ method: 'card', amountMinor: 100, changeMinor: 1 }])).toThrowError(DomainError);
  });

  it('the database itself rejects a non-positive amount and negative change (CHECK)', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r6', idempotencyKey: 'sh-r6' });
    const { payment } = await recordPayment(db, actorA, {
      saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 100 }], idempotencyKey: 'pay-chk',
    });
    await rejectsWith(
      withTenant(db, A, (tx: any) => tx.insert(paymentTenders).values({ tenantId: A, paymentId: payment.id, method: 'cash', amountMinor: 0 })),
      '23514',
    );
    await rejectsWith(
      withTenant(db, A, (tx: any) => tx.insert(paymentTenders).values({ tenantId: A, paymentId: payment.id, method: 'cash', amountMinor: 100, changeMinor: -1 })),
      '23514',
    );
    await rejectsWith(
      withTenant(db, A, (tx: any) => tx.insert(payments).values({
        tenantId: A, saleId: saleA, shiftId: shift.id, totalMinor: 0, createdBy: A, idempotencyKey: 'bad-total', requestHash: 'x',
      })),
      '23514',
    );
  });

  it('an overpayment is refused', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r7', idempotencyKey: 'sh-r7' });
    await rejectsDomain(
      recordPayment(db, actorA, { saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 999_999 }], idempotencyKey: 'pay-over' }),
      'overpayment',
    );
  });
});

/* ------------------------------------------------------------- 6. drawer */

describe('acceptance 6 — drawer expectation', () => {
  it('float plus cash taken minus cash refunded, and card never counts', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r8', openingFloatMinor: 1_000, idempotencyKey: 'sh-r8' });
    expect(await expectedInDrawer(db, actorA, shift.id)).toBe(1_000);

    // 60.00 of a 100.00 bill paid in cash from 100.00 (40.00 change), 40.00 by card.
    const { payment } = await recordPayment(db, actorA, {
      saleId: saleA, shiftId: shift.id,
      tenders: [{ method: 'cash', amountMinor: 10_000, changeMinor: 4_000 }, { method: 'card', amountMinor: 4_000 }],
      idempotencyKey: 'pay-r8',
    });
    expect(await expectedInDrawer(db, actorA, shift.id)).toBe(1_000 + 6_000);

    await recordRefund(db, actorA, { paymentId: payment.id, amountMinor: 2_000, method: 'cash', idempotencyKey: 'ref-r8' });
    expect(await expectedInDrawer(db, actorA, shift.id)).toBe(1_000 + 6_000 - 2_000);
  });
});

/* --------------------------------------------------------- 7. shift close */

describe('acceptance 7 — closing a shift', () => {
  it('difference equals counted − expected, and a replay is idempotent', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r9', openingFloatMinor: 500, idempotencyKey: 'sh-r9' });
    await recordPayment(db, actorA, {
      saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 3_000 }], idempotencyKey: 'pay-r9',
    });
    const first = await closeShift(db, actorA, { shiftId: shift.id, countedMinor: 3_600, idempotencyKey: 'close-r9' });
    expect(first.closure.expectedMinor).toBe(3_500);
    expect(first.closure.differenceMinor).toBe(100);

    const again = await closeShift(db, actorA, { shiftId: shift.id, countedMinor: 3_600, idempotencyKey: 'close-r9' });
    expect(again.replayed).toBe(true);
    expect(again.closure.id).toBe(first.closure.id);
  });

  it('a second close with a different count is a conflict, not a second closure', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r10', idempotencyKey: 'sh-r10' });
    await closeShift(db, actorA, { shiftId: shift.id, countedMinor: 0, idempotencyKey: 'close-r10a' });
    await rejectsDomain(closeShift(db, actorA, { shiftId: shift.id, countedMinor: 999, idempotencyKey: 'close-r10b' }), 'shift_already_closed');
    await withTenant(db, A, async (tx: any) => {
      expect((await tx.select().from(shiftClosures).where(sql`${shiftClosures.shiftId} = ${shift.id}`)).length).toBe(1);
    });
  });

  it('the database enforces one closure per shift (23505)', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r11', idempotencyKey: 'sh-r11' });
    await withTenant(db, A, (tx: any) => tx.insert(shiftClosures).values({
      tenantId: A, shiftId: shift.id, countedMinor: 0, expectedMinor: 0, differenceMinor: 0, countedBy: A,
      idempotencyKey: 'raw-close-1', requestHash: 'x',
    }));
    await rejectsWith(
      withTenant(db, A, (tx: any) => tx.insert(shiftClosures).values({
        tenantId: A, shiftId: shift.id, countedMinor: 1, expectedMinor: 0, differenceMinor: 1, countedBy: A,
        idempotencyKey: 'raw-close-2', requestHash: 'y',
      })),
      '23505',
    );
  });
});

/* ------------------------------------------------------- refund invariant */

describe('refunds never exceed the payment', () => {
  it('partial refunds accumulate and the excess is refused', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r12', idempotencyKey: 'sh-r12' });
    const { payment } = await recordPayment(db, actorA, {
      saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 5_000 }], idempotencyKey: 'pay-r12',
    });
    await recordRefund(db, actorA, { paymentId: payment.id, amountMinor: 2_000, method: 'cash', idempotencyKey: 'ref-1' });
    await recordRefund(db, actorA, { paymentId: payment.id, amountMinor: 3_000, method: 'cash', idempotencyKey: 'ref-2' });
    await rejectsDomain(
      recordRefund(db, actorA, { paymentId: payment.id, amountMinor: 1, method: 'cash', idempotencyKey: 'ref-3' }),
      'refund_exceeds_payment',
    );
    await withTenant(db, A, async (tx: any) => {
      const rows = await tx.select().from(refunds).where(sql`${refunds.paymentId} = ${payment.id}`);
      expect(rows.length).toBe(2);
      expect(rows.reduce((s: number, r: any) => s + r.amountMinor, 0)).toBe(5_000);
    });
  });

  it('a refund replay is idempotent and does not double-count', async () => {
    const { shift } = await openShift(db, actorA, { register: 'r13', idempotencyKey: 'sh-r13' });
    const { payment } = await recordPayment(db, actorA, {
      saleId: saleA, shiftId: shift.id, tenders: [{ method: 'cash', amountMinor: 4_000 }], idempotencyKey: 'pay-r13',
    });
    const input = { paymentId: payment.id, amountMinor: 1_000, method: 'cash' as const, idempotencyKey: 'ref-idem' };
    const first = await recordRefund(db, actorA, input);
    const again = await recordRefund(db, actorA, input);
    expect(again.replayed).toBe(true);
    expect(again.refund.id).toBe(first.refund.id);
  });
});

/* ------------------------------- 5. concurrency (needs real PostgreSQL) */

const ADMIN_URL = process.env.NILE_TEST_PG_ADMIN_URL;
// NOT IMPLEMENTED — recorded honestly rather than faked. Acceptance test 5
// requires two racing refunds on one payment and two racing openShift calls on
// one register, each driven from an INDEPENDENT connection. PGlite exposes a
// single connection, so it cannot express the race. The advisory-lock design is
// in place (advisoryLock in payments-service.ts) but is UNVERIFIED until this
// runs against a disposable PostgreSQL server via NILE_TEST_PG_ADMIN_URL.
// Marked .todo so it shows as pending and never as a pass.
describe.todo('acceptance 5 — concurrency on real PostgreSQL (two connections)', () => {
  it.todo('two racing refunds on one payment can never exceed it');
  it.todo('two racing openShift calls on one register yield exactly one open shift');
});
void ADMIN_URL;
