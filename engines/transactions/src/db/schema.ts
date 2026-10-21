/**
 * Transactions DB schema (Drizzle, ADR-0004).
 * Money = bigint minor units (money-minor.ts); quantities numeric(18,3).
 * Child rows use COMPOSITE foreign keys (tenant_id, parent_id) so a row can
 * never point at another tenant's parent (FK checks bypass RLS).
 */
import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenantIdColumn, tenantKey, tenantPolicy } from '../../../platform/src/db/tenancy.js';
import { catalogVariants } from '../../../catalog/src/db/schema.js';

const money = (name: string) => bigint(name, { mode: 'number' });

export const salesTransactions = pgTable(
  'sales_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    kind: text('kind').notNull(), // sale | purchase | return
    status: text('status').notNull().default('posted'), // draft | posted | void
    totalMinor: money('total_minor').notNull(),
    currency: text('currency').notNull().default('EGP'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** sha256 of the canonical request — same key + different body ⇒ 409. */
    requestHash: text('request_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('sales_transactions', t.tenantId, t.id),
    unique('sales_transactions_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('sales_transactions_created_idx').on(t.tenantId, t.createdAt),
    tenantPolicy(),
  ],
).enableRLS();

export const transactionLines = pgTable(
  'transaction_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    transactionId: uuid('transaction_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    /** Snapshots: a receipt must print what was sold, even after renames. */
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
    unitPriceMinor: money('unit_price_minor').notNull(),
    lineTotalMinor: money('line_total_minor').notNull(),
  },
  (t) => [
    foreignKey({ name: 'transaction_lines_txn_fk', columns: [t.tenantId, t.transactionId], foreignColumns: [salesTransactions.tenantId, salesTransactions.id] }),
    foreignKey({ name: 'transaction_lines_variant_fk', columns: [t.tenantId, t.variantId], foreignColumns: [catalogVariants.tenantId, catalogVariants.id] }),
    index('transaction_lines_txn_idx').on(t.tenantId, t.transactionId),
    tenantPolicy(),
  ],
).enableRLS();

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    variantId: uuid('variant_id').notNull(),
    warehouse: text('warehouse').notNull().default('main'),
    direction: text('direction').notNull(), // in | out | adjust
    quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
    costPerUnitMinor: money('cost_per_unit_minor'),
    reason: text('reason'),
    transactionId: uuid('transaction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'stock_movements_variant_fk', columns: [t.tenantId, t.variantId], foreignColumns: [catalogVariants.tenantId, catalogVariants.id] }),
    foreignKey({ name: 'stock_movements_txn_fk', columns: [t.tenantId, t.transactionId], foreignColumns: [salesTransactions.tenantId, salesTransactions.id] }),
    index('stock_movements_variant_idx').on(t.tenantId, t.variantId, t.createdAt),
    tenantPolicy(),
  ],
).enableRLS();

/** Cash drawer movements per shift (cash.ts domain). */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    shiftId: uuid('shift_id').notNull(),
    direction: text('direction').notNull(), // in | out
    status: text('status').notNull().default('pending'), // pending | posted — frozen at insert after 0003
    amountMinor: money('amount_minor').notNull(),
    // Added in 0003 — nullable for back-compat
    paymentId: uuid('payment_id'),
    refundId: uuid('refund_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantKey('cash_movements', t.tenantId, t.id), tenantPolicy()],
).enableRLS();

// ── Phase 2-4: POS checkout, refunds, shifts — prepared but not yet used by old sale path
// Tables are append-only (REVOKE UPDATE,DELETE in 0003) and tenant-isolated.
// See proposal 0007 for invariants I1-I12.

export const cashShifts = pgTable(
  'cash_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    registerCode: text('register_code').notNull().default('main'),
    openedBy: uuid('opened_by').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openingMinor: money('opening_minor').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    tenantKey('cash_shifts', t.tenantId, t.id),
    unique('cash_shifts_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('cash_shifts_open_idx').on(t.tenantId, t.registerCode, t.openedAt),
    check('cash_shifts_opening_nonneg', sql`${t.openingMinor} >= 0`),
    tenantPolicy(),
  ],
).enableRLS();

export const cashShiftClosures = pgTable(
  'cash_shift_closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    shiftId: uuid('shift_id').notNull().unique(),
    countedMinor: money('counted_minor').notNull(),
    expectedMinor: money('expected_minor').notNull(),
    differenceMinor: money('difference_minor').notNull(),
    closedBy: uuid('closed_by').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'cash_shift_closures_shift_fk', columns: [t.tenantId, t.shiftId], foreignColumns: [cashShifts.tenantId, cashShifts.id] }),
    check('cash_shift_closures_counted_nonneg', sql`${t.countedMinor} >= 0`),
    check('cash_shift_closures_difference_adds_up', sql`${t.differenceMinor} = ${t.countedMinor} - ${t.expectedMinor}`),
    tenantPolicy(),
  ],
).enableRLS();

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    transactionId: uuid('transaction_id').notNull(),
    method: text('method').notNull(), // cash | card | wallet | transfer
    amountMinor: money('amount_minor').notNull(),
    tenderedMinor: money('tendered_minor'),
    changeMinor: money('change_minor'),
    externalRef: text('external_ref'),
    shiftId: uuid('shift_id'), // required when method=cash — enforced in service, not DB (to allow card without shift)
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('payments', t.tenantId, t.id),
    unique('payments_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    foreignKey({ name: 'payments_txn_fk', columns: [t.tenantId, t.transactionId], foreignColumns: [salesTransactions.tenantId, salesTransactions.id] }),
    // I3/I7: a payment can only name a shift that belongs to the SAME tenant. Nullable, because a
    // card/wallet/transfer tender needs no shift; PostgreSQL skips the check when shift_id is null.
    foreignKey({ name: 'payments_shift_fk', columns: [t.tenantId, t.shiftId], foreignColumns: [cashShifts.tenantId, cashShifts.id] }),
    index('payments_txn_idx').on(t.tenantId, t.transactionId),
    check('payments_amount_positive', sql`${t.amountMinor} > 0`),
    check('payments_method_known', sql`${t.method} in ('cash', 'card', 'wallet', 'transfer')`),
    // I1/I2 at row level: amount covered = cash handed − change given. This one identity
    // subsumes "change ≥ 0", "change ≤ tendered" and "no phantom change without a tender".
    check(
      'payments_tender_identity',
      sql`${t.changeMinor} is null or (${t.tenderedMinor} is not null and ${t.tenderedMinor} - ${t.changeMinor} = ${t.amountMinor})`,
    ),
    tenantPolicy(),
  ],
).enableRLS();

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    paymentId: uuid('payment_id').notNull(),
    transactionId: uuid('transaction_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    reason: text('reason'),
    shiftId: uuid('shift_id'),
    approvedBy: uuid('approved_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantKey('refunds', t.tenantId, t.id),
    unique('refunds_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    foreignKey({ name: 'refunds_payment_fk', columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id] }),
    foreignKey({ name: 'refunds_txn_fk', columns: [t.tenantId, t.transactionId], foreignColumns: [salesTransactions.tenantId, salesTransactions.id] }),
    foreignKey({ name: 'refunds_shift_fk', columns: [t.tenantId, t.shiftId], foreignColumns: [cashShifts.tenantId, cashShifts.id] }),
    index('refunds_payment_idx').on(t.tenantId, t.paymentId),
    check('refunds_amount_positive', sql`${t.amountMinor} > 0`),
    tenantPolicy(),
  ],
).enableRLS();

export const cashMovementResolutions = pgTable(
  'cash_movement_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    movementId: uuid('movement_id').notNull().unique(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
    resolution: text('resolution').notNull(), // posted | returned
  },
  (t) => [
    foreignKey({ name: 'cash_movement_resolutions_movement_fk', columns: [t.tenantId, t.movementId], foreignColumns: [cashMovements.tenantId, cashMovements.id] }),
    check('cash_movement_resolutions_kind', sql`${t.resolution} in ('posted', 'returned')`),
    tenantPolicy(),
  ],
).enableRLS();
