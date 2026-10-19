# Proposal 0007 — Payment engine design

| Field | Value |
| --- | --- |
| Status | **PROPOSED, design only.** No code, no branch. It becomes the implementation contract once its gate opens |
| Date | 2026-10-14 |
| Gate | Implementation starts **only after PR #4 is merged**, on a new branch from the then-current `main`. The cashier UI starts only after this engine and the gate pass |
| Base examined | `main` `ebcfe72`; PR #4 head `784e50c` |
| Depends on | [ADR-0010](../../adr/0010-engines-continue-behind-ledger-provider-port.md) (Accepted): engines own operational records; nothing in ADR-0008 |

## 1. What exists today (facts, with file references)

- **F1.** `recordSale` (`engines/transactions/src/sale-service.ts`) does several things in one
  transaction, all idempotent per tenant (key + request hash):
  - writes `sales_transactions`, `transaction_lines` and `stock_movements`, plus an `audit_log` row;
  - decrements stock atomically.

  It records **no payment**: no tender, no change and no drawer movement.
- **F2.** `cash_movements` (`engines/transactions/src/db/schema.ts`) has `shift_id NOT NULL`, but:
  - there is no shifts table and no foreign key to one;
  - it has no link to a sale or payment;
  - it has no composite tenant key;
  - its `status` column is meant to change from `pending` to `posted`.
- **F3.** The pure logic in `cash.ts` (extracted from kayyal) keeps a useful rule: pending cash counts in
  the drawer but **never as revenue**. Posting a pending movement is modelled as returning a new value.
- **F4.** PR #4 revokes UPDATE and DELETE on `audit_log`, `sales_transactions`, `transaction_lines`,
  `stock_movements` and `cash_movements` from `nile_app`. As a result:
  - the `pending → posted` *update* in F2 is impossible once PR #4 merges;
  - the `void` status on `sales_transactions` becomes unreachable;
  - tables created later still get UPDATE and DELETE through the default privileges in
    `0001_security_hardening.sql`.
- **F5.** PostgreSQL requires UPDATE privilege for `SELECT … FOR UPDATE / FOR SHARE` (PostgreSQL 18
  docs, SELECT, "Description"). **Verified on PostgreSQL 18.4** against the PR #4 migrations
  ([PR #4 review](../../reviews/2026-10-14-pr4-review.md) §2 rows 9–11). So after PR #4, **`nile_app` cannot row-lock** the append-only tables. At
  `784e50c`, no non-test code uses row locks, so PR #4 is unaffected. This is a constraint on new code.

## 2. Scope

**In scope:**

- cash shifts (open, close, counted vs. expected);
- tenders: cash, card terminal, mobile wallet and bank transfer. Non-cash methods are recorded with an
  external reference only; there is no gateway integration;
- split tender and change;
- full and partial refunds;
- pending-cash handling;
- payment status derived for each sale.

**Out of scope:**

- online gateways (a later `PaymentGateway` port);
- customer credit and installments (a later extension);
- ledger posting (outbox, added once ADR-0008 is decided);
- ETA e-receipt submission ([proposal 0006](0006-ledger-decision-memo.md) §1);
- any UI.

## 3. Invariants

| # | Invariant | Enforced by |
| --- | --- | --- |
| I1 | A checked-out sale is fully paid: Σ tenders − change = sale total | Service, plus a test over generated cases |
| I2 | Change comes only from cash, and change ≤ cash tendered | Service + `CHECK (change_minor >= 0 AND change_minor <= tendered_minor)` |
| I3 | Every cash tender, change and cash refund creates a `cash_movements` row in an **open** shift of the same tenant and register | Service + composite foreign key to the shift |
| I4 | Append-only: payments, refunds, shifts, closures, movements and resolutions are insert-only; corrections are compensating rows | `REVOKE UPDATE, DELETE` on **each new table** in the same migration (PR #4 follow-up), with a test per table running as `nile_app` |
| I5 | Total refunded for a payment ≤ that payment's amount | Service under a lock (I9), plus a concurrency test on real PostgreSQL |
| I6 | Every command is idempotent per tenant (same key returns the same result; same key with a different body returns 409) | `unique(tenant_id, idempotency_key)` + `request_hash`, the existing pattern |
| I7 | No cross-tenant references | Composite `(tenant_id, id)` foreign keys on every child, plus RLS (`tenantPolicy`) |
| I8 | Money is integer minor units and positive; direction is a separate column; enum columns are constrained | `bigint` + `CHECK (amount_minor > 0)` + `CHECK (method IN (…))`. This closes G-4 for the new tables |
| I9 | Concurrent refunds on one sale, and concurrent open or close on one register, are serialized | `pg_advisory_xact_lock(hashtextextended(tenant_id || ':' || key, 0))`, since F5 rules out row locks, plus a two-connection test |
| I10 | Payment status (`unpaid`, `paid`, `partially_refunded`, `refunded`) is **derived** from rows, never stored | Query or view |
| I11 | Pending cash is in the drawer but not in revenue, and resolving it appends a row | `cash_movement_resolutions` table; `computeDrawer` reads movements joined to resolutions |
| I12 | At most one open shift per (tenant, register) | Advisory lock on open, plus a check that no shift lacks a closure. Two-table state cannot use a partial unique index |

## 4. Data model (proposed migration `0003_payments`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `cash_shifts` | `id`, `tenant_id`, `register_code`, `opened_by`, `opened_at`, `opening_minor`, `idempotency_key`, `request_hash` | `tenantKey`; a shift is open while it has no closure row |
| `cash_shift_closures` | `shift_id` (unique), `tenant_id`, `counted_minor`, `expected_minor`, `difference_minor`, `closed_by`, `closed_at` | `expected` and `difference` come from `computeDrawer` / `closeDifference` at close time |
| `payments` | `id`, `tenant_id`, `transaction_id`, `method`, `amount_minor`, `tendered_minor`, `change_minor`, `external_ref`, `shift_id` (required when `method = 'cash'`), `idempotency_key`, `request_hash`, `created_by`, `created_at` | `CHECK` per I2 and I8; composite foreign keys to sale and shift |
| `refunds` | `id`, `tenant_id`, `payment_id`, `transaction_id`, `amount_minor`, `reason`, `shift_id` (cash), `approved_by`, `idempotency_key`, `request_hash`, `created_at` | A goods return also writes a `return` transaction and inbound `stock_movements` |
| `cash_movements` (existing) | add `payment_id`, `refund_id` (nullable), composite foreign key `(tenant_id, shift_id) → cash_shifts` | Demo data is reset daily, so existing rows are rewritten on reset. Production backfill: none exists yet |
| `cash_movement_resolutions` | `movement_id` (unique), `tenant_id`, `resolved_at`, `resolution` (`posted` / `returned`) | Replaces the `status` update. The `status` column stays, frozen at insert |

All tables get `enableRLS()` + `tenantPolicy()`, and FORCE RLS is applied by the existing hardening loop.
The REVOKEs go in the **same** migration.

## 5. Service API (engine level)

```ts
openShift(db, actor, { registerCode, openingMinor, idempotencyKey }): Promise<ShiftView>
checkout(db, actor, {
  sale: SaleInput,
  tenders: TenderInput[],
  shiftId?: string,
  idempotencyKey: string,
}): Promise<CheckoutView>
// sale + payments + cash movements + audit row in ONE transaction; replaces recordSale for POS
recordPayment(db, actor, { transactionId, tender, shiftId?, idempotencyKey }): Promise<PaymentView>
// settle later (bookings, deposits)
refund(db, actor, { paymentId, amountMinor, reason, shiftId?, returnLines?, idempotencyKey }): Promise<RefundView>
resolvePendingCash(db, actor, { movementId, resolution, idempotencyKey }): Promise<void>
closeShift(db, actor, { shiftId, countedMinor, idempotencyKey }): Promise<ShiftClosureView>
getDrawer(db, tenantId, shiftId): Promise<DrawerPosition> // existing cash.ts math
getPaymentStatus(db, tenantId, transactionId): Promise<PaymentStatus>
```

HTTP mapping, with permissions from ADR-0007:

| Endpoint | Allowed for |
| --- | --- |
| `POST /shifts` | cashier |
| `POST /shifts/:id/close` | cashier, own shift |
| `POST /checkout` | cashier |
| `POST /sales/:id/payments` | cashier |
| `POST /payments/:id/refunds` | manager / owner only |
| `GET /shifts/:id/drawer` | cashier (own shift), manager |

Error messages are bilingual, using the existing `DomainError` pattern.

## 6. Acceptance tests (required before calling the engine done)

1. **Privileges:** as `nile_app`, UPDATE and DELETE fail on every new table and on `cash_movements`.
2. **RLS and composite foreign keys:** another tenant's sale, payment or shift cannot be referenced or read.
3. **Idempotency:** a replay returns the identical result; the same key with a different body returns 409.
4. **Money:** split tender with change across generated cases; I1 and I2 hold; negative and zero
   amounts are rejected by the database.
5. **Concurrency, on real PostgreSQL with two connections (PGlite has one connection and cannot test
   this):**
   - two refunds racing on the same payment can never exceed it;
   - two `openShift` calls on one register yield exactly one open shift.
6. **Drawer:** the kayyal golden cases still pass. Pending cash appears in `expectedInDrawer` and not in
   `expectedPosted`, both before and after resolution.
7. **Shift close:** the difference equals counted − expected, and closing twice is idempotent.
8. **Mutation check, in an isolated copy:** removing a REVOKE, a `CHECK` or the advisory lock must make
   a test fail.

## 7. Blockers and decisions

- **Blocker:** PR #4 is not merged. Merging it is the owner's action and requires explicit authorization.
  Live status: [`docs/STATUS.md`](../../STATUS.md).
- **Owner decisions:** none required to build the engine. Product defaults, all reversible:
  - all four methods enabled (cash, card terminal, mobile wallet, bank transfer);
  - refunds need a manager;
  - one register per branch at launch.
- **Before commercial launch, separately:** G-4 for existing tables, G-10 double booking, and the
  B2C e-receipt question (proposal 0006 §1).
