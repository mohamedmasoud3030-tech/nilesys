/**
 * Payments DB schema (Drizzle, ADR-0004) — proposal 0007.
 *
 * APPEND-ONLY BY DESIGN. Since migration 0002 the runtime role `nile_app` holds
 * no UPDATE or DELETE on ledger tables, and new tables inherit those privileges
 * through the default privileges in 0001 — so the hardening migration for this
 * file REVOKEs them explicitly (gap P4-4). Every state transition is therefore
 * a NEW ROW, never an edit:
 *
 *   opening a shift  → INSERT into cash_shifts
 *   closing a shift  → INSERT into shift_closures   (UNIQUE (tenant_id, shift_id)
 *                                                    ⇒ at most one close per shift)
 *   taking a payment → INSERT into payments + N × payment_tenders
 *   refunding        → INSERT into refunds
 *
 * No row locking: PostgreSQL requires UPDATE privilege for SELECT … FOR
 * UPDATE/SHARE and `nile_app` no longer has it (proposal 0007 fact F5, verified
 * on PostgreSQL 18.4). Cross-row invariants that need serialisation use
 * advisory locks instead — see payments-service.ts.
 *
 * Money = bigint minor units. Child rows use COMPOSITE foreign keys
 * (tenant_id, parent_id) because PostgreSQL checks foreign keys WITHOUT
 * applying RLS.
 */
import {
  bigint, check, foreignKey, index, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenantIdColumn, tenantKey, tenantPolicy } from '../../../platform/src/db/tenancy.js';
import { salesTransactions } from './schema.js';

const money = (name: string) => bigint(name, { mode: 'number' });

/** Tender methods. Non-cash methods carry an external reference only — there
 *  is no gateway integration (proposal 0007 §2). */
export const TENDER_METHODS = ['cash', 'card', 'wallet', 'bank'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

/** A register/terminal within a branch. One register per branch at launch. */
export const cashShifts = pgTable(
  'cash_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    register: text('register').notNull().default('main'),
    /** Float the drawer starts with; counts toward expected, is not revenue. */
    openingFloatMinor: money('opening_float_minor').notNull().default(0),
    openedBy: uuid('opened_by').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('cash_shifts', t.tenantId, t.id),
    unique('cash_shifts_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('cash_shifts_open_idx').on(t.tenantId, t.register, t.openedAt),
    check('cash_shifts_float_non_negative', sql`${t.openingFloatMinor} >= 0`),
    tenantPolicy(),
  ],
).enableRLS();

/**
 * Closing a shift. Append-only: one row per close, and the unique key makes a
 * second close of the same shift impossible at the database level, so the
 * service can treat a replay as idempotent and a genuinely different close as
 * a conflict.
 */
export const shiftClosures = pgTable(
  'shift_closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    shiftId: uuid('shift_id').notNull(),
    countedMinor: money('counted_minor').notNull(),
    expectedMinor: money('expected_minor').notNull(),
    /** counted − expected. Negative = shortage, positive = overage. */
    differenceMinor: money('difference_minor').notNull(),
    countedBy: uuid('counted_by').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    tenantKey('shift_closures', t.tenantId, t.id),
    unique('shift_closures_tenant_shift_uq').on(t.tenantId, t.shiftId),
    unique('shift_closures_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: 'shift_closures_shift_fk',
      columns: [t.tenantId, t.shiftId],
      foreignColumns: [cashShifts.tenantId, cashShifts.id],
    }),
    check('shift_closures_counted_non_negative', sql`${t.countedMinor} >= 0`),
    check(
      'shift_closures_difference_consistent',
      sql`${t.differenceMinor} = ${t.countedMinor} - ${t.expectedMinor}`,
    ),
    tenantPolicy(),
  ],
).enableRLS();

/**
 * A payment against one sale. One payment per sale is NOT enforced here: a sale
 * may be settled in several payments (e.g. part cash now, part card later).
 * The invariant that matters — refunds never exceed what was taken — is
 * enforced in payments-service.ts under an advisory lock.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    saleId: uuid('sale_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    totalMinor: money('total_minor').notNull(),
    currency: text('currency').notNull().default('EGP'),
    createdBy: uuid('created_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('payments', t.tenantId, t.id),
    unique('payments_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: 'payments_sale_fk',
      columns: [t.tenantId, t.saleId],
      foreignColumns: [salesTransactions.tenantId, salesTransactions.id],
    }),
    foreignKey({
      name: 'payments_shift_fk',
      columns: [t.tenantId, t.shiftId],
      foreignColumns: [cashShifts.tenantId, cashShifts.id],
    }),
    index('payments_sale_idx').on(t.tenantId, t.saleId),
    check('payments_total_positive', sql`${t.totalMinor} > 0`),
    tenantPolicy(),
  ],
).enableRLS();

/**
 * One tender of a payment. Split tender = several rows. `changeMinor` is the
 * cash handed back, so the amount that actually settles the sale is
 * amountMinor − changeMinor. The service asserts Σ(amount − change) equals
 * payments.totalMinor exactly.
 */
export const paymentTenders = pgTable(
  'payment_tenders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    paymentId: uuid('payment_id').notNull(),
    method: text('method').notNull(),
    amountMinor: money('amount_minor').notNull(),
    changeMinor: money('change_minor').notNull().default(0),
    /** Terminal/transaction reference for non-cash methods. Free text. */
    externalRef: text('external_ref'),
  },
  (t) => [
    tenantKey('payment_tenders', t.tenantId, t.id),
    foreignKey({
      name: 'payment_tenders_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('payment_tenders_payment_idx').on(t.tenantId, t.paymentId),
    check('payment_tenders_amount_positive', sql`${t.amountMinor} > 0`),
    check('payment_tenders_change_non_negative', sql`${t.changeMinor} >= 0`),
    check('payment_tenders_change_ne_exceeds_amount', sql`${t.changeMinor} <= ${t.amountMinor}`),
    check(
      'payment_tenders_method_known',
      sql`${t.method} IN ('cash', 'card', 'wallet', 'bank')`,
    ),
    check(
      'payment_tenders_change_only_for_cash',
      sql`${t.method} <> 'cash' OR ${t.changeMinor} >= 0`,
    ),
    check(
      'payment_tenders_non_cash_needs_ref_when_referenced',
      sql`${t.externalRef} IS NULL OR length(${t.externalRef}) > 0`,
    ),
    tenantPolicy(),
  ],
).enableRLS();

/**
 * A refund against a payment. Append-only, so partial refunds are several rows.
 * `refunds_total_le_payment` cannot be expressed as a row CHECK (it is a sum
 * across rows), so it is enforced under an advisory lock in the service and
 * pinned by the concurrency acceptance test.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    paymentId: uuid('payment_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    method: text('method').notNull(),
    reason: text('reason'),
    refundedBy: uuid('refunded_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('refunds', t.tenantId, t.id),
    unique('refunds_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    foreignKey({
      name: 'refunds_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    index('refunds_payment_idx').on(t.tenantId, t.paymentId),
    check('refunds_amount_positive', sql`${t.amountMinor} > 0`),
    check('refunds_method_known', sql`${t.method} IN ('cash', 'card', 'wallet', 'bank')`),
    tenantPolicy(),
  ],
).enableRLS();
