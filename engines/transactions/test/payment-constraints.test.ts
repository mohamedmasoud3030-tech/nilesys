/**
 * Migration 0005 — money and enum invariants enforced by the DATABASE, not only by the service.
 *
 * Proposal 0007 §3 I2 (change comes only from cash and never exceeds the cash tendered)
 * and I8 (money is a positive integer in minor units; method is a closed set) were, until
 * this migration, guarantees of TypeScript code alone. A service bug, a migration script,
 * a psql session or a future second caller could each write a row that no CHECK rejected.
 *
 * These tests run through the SAME path production uses (`openPglite` in `engines/db/open.ts`):
 * migrations applied as owner, then `SET ROLE nile_app`. So each assertion proves the runtime
 * role — not just a superuser — is stopped by the database.
 *
 * SQLSTATE 23514 = check_violation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openPglite, type NileDb, type OpenedDatabase } from '../../db/open.js';
import { organization } from '../../platform/src/auth/schema.js';
import { withTenant } from '../../platform/src/db/with-tenant.js';
import {
  cashMovementResolutions,
  cashMovements,
  cashShiftClosures,
  cashShifts,
  payments,
  refunds,
  salesTransactions,
} from '../src/db/schema.js';

let opened: OpenedDatabase;
let db: NileDb;
let tenant: string;
let saleId: string;
let shiftId: string;
let movementId: string;
let paymentId: string;

/** Walk the cause chain: Drizzle wraps driver errors, so `code` is rarely on the top object. */
async function rejectsWith(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err, 'expected the database to reject this row, but it was accepted').not.toBeNull();
  let c: any = err;
  while (c && !c.code) c = c.cause;
  expect(c?.code, String(err)).toBe(code);
}

const inTx = <T>(fn: (tx: any) => Promise<T>) => withTenant(db, tenant, fn);

beforeAll(async () => {
  opened = await openPglite();
  db = opened.db;

  const [org] = (await db
    .insert(organization)
    .values({ name: 'ConstraintTenant', slug: 'constraint-tenant' })
    .returning({ id: organization.id })) as [{ id: string }];
  tenant = org.id;

  // Minimum graph the foreign keys require: one sale, one open shift, one cash movement, one payment.
  ({ saleId, shiftId, movementId } = await inTx(async (tx) => {
    const [sale] = await tx
      .insert(salesTransactions)
      .values({ tenantId: tenant, kind: 'sale', totalMinor: 1000, idempotencyKey: 'con-sale', requestHash: 'h', createdBy: tenant })
      .returning({ id: salesTransactions.id });
    const [shift] = await tx
      .insert(cashShifts)
      .values({ tenantId: tenant, registerCode: 'cons', openedBy: tenant, openingMinor: 0, idempotencyKey: 'con-shift', requestHash: 'h' })
      .returning({ id: cashShifts.id });
    const [movement] = await tx
      .insert(cashMovements)
      .values({ tenantId: tenant, shiftId: shift.id, direction: 'in', amountMinor: 1000 })
      .returning({ id: cashMovements.id });
    return { saleId: sale.id as string, shiftId: shift.id as string, movementId: movement.id as string };
  }));

  const [row] = await inTx(async (tx) =>
    tx
      .insert(payments)
      .values({
        tenantId: tenant,
        transactionId: saleId,
        method: 'cash',
        amountMinor: 1000,
        tenderedMinor: 1200,
        changeMinor: 200,
        shiftId,
        idempotencyKey: 'con-payment',
        requestHash: 'h',
        createdBy: tenant,
      })
      .returning({ id: payments.id }),
  );
  paymentId = row.id as string;
});

afterAll(() => opened.close());

const paymentRow = (over: Record<string, unknown> = {}) => ({
  tenantId: tenant,
  transactionId: saleId,
  method: 'cash',
  amountMinor: 1000,
  idempotencyKey: `p-${Math.random()}`,
  requestHash: 'h',
  createdBy: tenant,
  ...over,
});

describe('0005 payments constraints (I2, I8)', () => {
  it('accepts the valid row the service actually writes', async () => {
    expect(paymentId).toBeTruthy();
  });

  it('rejects amount_minor = 0', async () => {
    await rejectsWith(
      inTx(async (tx) => tx.insert(payments).values(paymentRow({ amountMinor: 0 }))),
      '23514',
    );
  });

  it('rejects a negative amount_minor (direction belongs in a separate column, not the sign)', async () => {
    await rejectsWith(
      inTx(async (tx) => tx.insert(payments).values(paymentRow({ amountMinor: -500 }))),
      '23514',
    );
  });

  it('rejects an unknown payment method', async () => {
    await rejectsWith(
      inTx(async (tx) => tx.insert(payments).values(paymentRow({ method: 'cheque' }))),
      '23514',
    );
  });

  it('rejects a receipt where tendered − change does not equal the amount covered', async () => {
    // 1000 handed over, 250 change returned ⇒ 750 of the sale is covered, not 1000.
    await rejectsWith(
      inTx(async (tx) =>
        tx.insert(payments).values(paymentRow({ amountMinor: 1000, tenderedMinor: 1000, changeMinor: 250 })),
      ),
      '23514',
    );
  });

  it('rejects change larger than the cash tendered', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx.insert(payments).values(paymentRow({ amountMinor: -250, tenderedMinor: 1000, changeMinor: 1250 })),
      ),
      '23514',
    );
  });

  it('rejects negative change', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx.insert(payments).values(paymentRow({ amountMinor: 1000, tenderedMinor: 1200, changeMinor: -200 })),
      ),
      '23514',
    );
  });

  it('rejects change recorded without a tendered amount', async () => {
    await rejectsWith(
      inTx(async (tx) => tx.insert(payments).values(paymentRow({ amountMinor: 1000, changeMinor: 50 }))),
      '23514',
    );
  });

  it('accepts a non-cash tender with no change at all', async () => {
    await inTx(async (tx) => tx.insert(payments).values(paymentRow({ method: 'card', amountMinor: 1000, externalRef: 'POS-1' })));
  });

  it('accepts exact cash with zero change', async () => {
    await inTx(async (tx) =>
      tx.insert(payments).values(paymentRow({ amountMinor: 1000, tenderedMinor: 1000, changeMinor: 0 })),
    );
  });
});

describe('0005 refunds constraints (I8)', () => {
  const refundRow = (over: Record<string, unknown> = {}) => ({
    tenantId: tenant,
    paymentId,
    transactionId: saleId,
    amountMinor: 500,
    approvedBy: tenant,
    idempotencyKey: `r-${Math.random()}`,
    requestHash: 'h',
    ...over,
  });

  it('accepts a positive partial refund', async () => {
    await inTx(async (tx) => tx.insert(refunds).values(refundRow()));
  });

  it('rejects a zero-amount refund', async () => {
    await rejectsWith(inTx(async (tx) => tx.insert(refunds).values(refundRow({ amountMinor: 0 }))), '23514');
  });

  it('rejects a negative refund', async () => {
    await rejectsWith(inTx(async (tx) => tx.insert(refunds).values(refundRow({ amountMinor: -100 }))), '23514');
  });
});

describe('0005 shift constraints', () => {
  it('rejects a negative opening float', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx
          .insert(cashShifts)
          .values({ tenantId: tenant, registerCode: 'neg', openedBy: tenant, openingMinor: -1, idempotencyKey: `s-${Math.random()}`, requestHash: 'h' }),
      ),
      '23514',
    );
  });

  it('rejects a negative counted amount at close', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx
          .insert(cashShiftClosures)
          .values({ tenantId: tenant, shiftId, countedMinor: -1, expectedMinor: 0, differenceMinor: -1, closedBy: tenant }),
      ),
      '23514',
    );
  });

  it('rejects a closure whose difference is not counted − expected', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx.insert(cashShiftClosures).values({ tenantId: tenant, shiftId, countedMinor: 900, expectedMinor: 1000, differenceMinor: 0, closedBy: tenant }),
      ),
      '23514',
    );
  });

  it('accounts for a known difference (−100) instead of hiding it', async () => {
    await inTx(async (tx) =>
      tx.insert(cashShiftClosures).values({ tenantId: tenant, shiftId, countedMinor: 900, expectedMinor: 1000, differenceMinor: -100, closedBy: tenant }),
    );
  });
});

describe('0005 pending-cash resolution constraints (I11)', () => {
  it('rejects a resolution word outside the closed set', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx.insert(cashMovementResolutions).values({ tenantId: tenant, movementId, resolution: 'void' }),
      ),
      '23514',
    );
  });

  it('accepts posted and returned', async () => {
    for (const [i, resolution] of ['posted', 'returned'].entries()) {
      const [m] = await inTx(async (tx) =>
        tx
          .insert(cashMovements)
          .values({ tenantId: tenant, shiftId, direction: 'in', amountMinor: 100 + i })
          .returning({ id: cashMovements.id }),
      );
      await inTx(async (tx) => tx.insert(cashMovementResolutions).values({ tenantId: tenant, movementId: m.id, resolution }));
    }
  });
});

describe('0005 shift links are tenant-scoped (I3, I7)', () => {
  it('rejects a payment that names a shift belonging to another tenant', async () => {
    const [other] = (await db
      .insert(organization)
      .values({ name: 'OtherTenant', slug: `other-${Date.now()}` })
      .returning({ id: organization.id })) as [{ id: string }];
    const otherShift = await withTenant(db, other.id, async (tx: any) => {
      const [s] = await tx
        .insert(cashShifts)
        .values({ tenantId: other.id, registerCode: 'oth', openedBy: other.id, openingMinor: 0, idempotencyKey: `os-${Date.now()}`, requestHash: 'h' })
        .returning({ id: cashShifts.id });
      return s.id as string;
    });
    await rejectsWith(
      inTx(async (tx) => tx.insert(payments).values(paymentRow({ shiftId: otherShift }))),
      '23503', // foreign_key_violation: (tenant_id, shift_id) has no matching shift row
    );
  });

  it('accepts a non-cash tender with no shift at all', async () => {
    await inTx(async (tx) => tx.insert(payments).values(paymentRow({ method: 'card', shiftId: null })));
  });
});

describe('0005 the constraints are enforced on the runtime role, not only the owner', () => {
  it('runs as nile_app', async () => {
    const rows = (await db.execute(sql`SELECT current_user AS u`)) as any;
    expect(rows.rows[0].u).toBe('nile_app');
  });

  it('nile_app cannot slip an invalid payment in through a raw statement either', async () => {
    await rejectsWith(
      inTx(async (tx) =>
        tx.execute(
          sql`INSERT INTO payments (tenant_id, transaction_id, method, amount_minor, idempotency_key, request_hash, created_by)
              VALUES (${tenant}, ${saleId}, 'cash', 0, ${'raw-' + Math.random()}, 'h', ${tenant})`,
        ),
      ),
      '23514',
    );
  });
});
