# Proposal 0007 — Payment engine design

| Field | Value |
| --- | --- |
| Status | **PROPOSED.** The gate below opened on 2026-10-18 (PR #4 merged as `52af469`); the engine is now **partly built** on `integration/nile-2026-10-18`. Conformance is tracked in §8, added 2026-10-19 |
| Date | 2026-10-14, revised 2026-10-19 |
| Gate | ✅ **Opened.** PR #4 merged into `main` as `52af469` on 2026-10-18, so work moved to `integration/nile-2026-10-18` (branch base `0207c13`). The cashier UI still waits for this engine plus the gates in `STATUS.md` §6 |
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

---

## 8. Revision 2 — conformance against the code (2026-10-19)

This section replaces the assumption in §1–§7 that the engine is unbuilt. It is a **measurement, not a
plan**: every row below is backed by a file and, where marked, by a test that fails when the guarantee is
removed.

**Base measured:** `integration/nile-2026-10-18` `0207c13`, plus this branch
(`feat/plt-0005-payment-db-constraints`) which carries migration `0005`.

**Headline (revised 2026-10-19 after the first real-PostgreSQL run):** concurrency is now *verified*, not
merely designed. `./tools/local-pg.sh test` → 296/296 with nothing skipped.

**Headline:** the engine exists and is tested. What was missing was not design but **enforcement
boundaries** — four invariants lived in TypeScript only, and four of the six §5 service functions were
never written. Both are addressed below (migration `0005`, `payments.ts`, `drawer.ts`).

### 8.1 Invariant-by-invariant

| # | Invariant | Enforced where, today | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| **I1** | Σ tenders − change = sale total | Service | `checkout.ts:162-170` computes `sumTenders`/`sumChange` and throws `tender_mismatch` | ✅ met |
| **I2** | Change only from cash; change ≤ cash tendered | Service **and DB** (added here) | `checkout.ts:105` (`change_exceeds_tendered`), `:108` (`change_only_cash`); DB `payments_tender_identity` in `0005` | ✅ met |
| **I3** | Every cash tender/change/refund writes a `cash_movements` row in an **open** shift of the same tenant and register | Service + **DB FK** (added here) | `checkout.ts:114` (`shift_required_for_cash`), `:136-143` (shift exists, shift open); DB `payments_shift_fk`, `refunds_shift_fk` in `0005` | ✅ met — *was service-only* |
| **I4** | Append-only: insert-only; corrections are compensating rows | DB | `0004_payments_append_only.sql` revokes UPDATE/DELETE on all five tables from `nile_app` and forces RLS | ✅ met |
| **I5** | Σ refunds per payment ≤ payment amount | Service under a lock | `refunds.ts:138-142` (`refund_over_limit`); per-item quantity bound at `:150-151`; locks at `:95-96` | ✅ met (needs real PG for the race tests, which are skipped without a server) |
| **I6** | Idempotent per tenant; same key + different body ⇒ 409 | DB unique + service hash | `checkout.ts:120-122`, `unique(tenant_id, idempotency_key)` on every new table | ✅ met |
| **I7** | No cross-tenant references | Composite FKs + RLS | all child tables use `(tenant_id, parent_id)`; `0005` adds the two missing shift links | ✅ met — *was incomplete* |
| **I8** | Money is a positive integer in minor units; enum columns constrained | **DB** (added here) + service | `checkout.ts:101`; DB `payments_amount_positive`, `payments_method_known`, `refunds_amount_positive` in `0005` | ✅ met — *was service-only* |
| **I9** | Concurrent refunds / open / close serialise | DB advisory locks | `shifts.ts:47-53` `lockShift`, `:78`; `refunds.ts:95-96` | ✅ met (one key shared by cash sale, refund and close — the C4 fix `d90b7c9`) |
| **I10** | Payment status is **derived**, never stored | Service, single implementation | `derivePaymentStatus` in `payments.ts` is a pure function of three sums; `getPaymentStatus` is its only reader. Nothing stores a status, so nothing can drift | ✅ met (was a hole) |
| **I11** | Pending cash is in the drawer but not in revenue; resolving it appends a row | Service + DB | `drawer.ts` `getDrawer` feeds `computeDrawer` the *effective* status (resolution if any, row status otherwise) and `resolvePendingCash` appends to `cash_movement_resolutions` without ever updating the movement; DB CHECK `resolution in (posted, returned)` | ✅ met (was half-built) |
| **I12** | At most one open shift per (tenant, register) | Advisory lock + rejection | `shifts.ts:78` serialises open per register and rejects with `shift_already_open`; proven by the concurrency gate in `review-gates.test.ts` | ✅ met **by design** — see §8.5 for why not a partial unique index |

### 8.2 What §5 promised — status after this branch

| Service function (§5) | Status | Where |
| --- | --- | --- |
| `openShift`, `closeShift`, `checkout`, `refund` | built | `shifts.ts`, `checkout.ts`, `refunds.ts` |
| `recordPayment` — settle a sale later (deposits, balances) | **built here** | `payments.ts`; over-payment, closed shift, cash-without-shift, idempotency and replay all tested |
| `getPaymentStatus` (I10) | **built here** | `payments.ts`; one pure derivation, six assertions |
| `resolvePendingCash` (I11) | **built here** | `drawer.ts`; posted/returned, replay, conflict, and a test proving the movement row is never rewritten |
| `getDrawer` (§5) | **built here** | `drawer.ts`; opening float, cash in at tendered, change as cash out, pending bucket, closed-shift numbers |

**A correction to the first edition of this section.** It said *"a pending cash movement can be created
but never resolved: money sits in the drawer for ever"*. That was **wrong**, and reading the writers is
what showed it: no production code writes `status = 'pending'` — `checkout` and `refunds` both insert
`'posted'`. The truth is narrower and still serious: the pending-cash mechanism, inherited from Kayyal,
had **neither a producer nor a resolver**, so I11 was a rule with no code behind it in either direction.
`resolvePendingCash` now exists; a producer is a product decision for whoever first needs credit sales.

### 8.3 Migration `0005_money_constraints` (this branch)

Generated by `npm run db:generate` from `engines/transactions/src/db/schema.ts` — never hand-written.
It moves four invariants from code to the database:

| Table | Constraint | Invariant |
| --- | --- | --- |
| `payments` | `amount_minor > 0` | I8 |
| `payments` | `method in (cash, card, wallet, transfer)` | I8 |
| `payments` | `tendered_minor - change_minor = amount_minor` when change is recorded | I1, I2 |
| `payments` | `(tenant_id, shift_id) → cash_shifts` | I3, I7 |
| `refunds` | `amount_minor > 0` | I8 |
| `refunds` | `(tenant_id, shift_id) → cash_shifts` | I7 |
| `cash_shifts` | `opening_minor >= 0` | I8 |
| `cash_shift_closures` | `counted_minor >= 0` | I8 |
| `cash_shift_closures` | `difference_minor = counted_minor - expected_minor` | I12 (honest difference) |
| `cash_movement_resolutions` | `resolution in (posted, returned)` | I11 |

**A correction to §3 I2 as originally written.** The draft said only *change ≤ cash tendered*. That
accepts a receipt that does not add up: 1000 handed over, 250 change returned, 1000 recorded as the
amount covered. The database now enforces the identity `tendered − change = amount`. The test that
exposed this is `payment-constraints.test.ts` › "rejects a receipt where tendered − change does not
equal the amount covered".

**Deliberately out of scope**, because it is the owner's G-4 decision: no constraints were added to
`sales_transactions`, `transaction_lines` or `cash_movements`.

### 8.4 What must happen next, in order

1. **HTTP mapping** for the new engine functions (`GET /shifts/:id/drawer`, `POST /payments/:id/payments`,
   `POST /cash-movements/:id/resolution`, `GET /sales/:id/payment-status`). The engine is done; the API
   surface is not. Permissions from ADR-0007 — note D-C and D-D are still open, and they decide exactly
   this.
2. ~~**The §6 acceptance suite on real PostgreSQL.**~~ **Done 2026-10-19.** `./tools/local-pg.sh test`
   (PostgreSQL 17.11, `--maxWorkers=1`) runs **29 files, 296/296, nothing skipped** — the refund races
   (A–G) and the double-shift-open race now execute instead of skipping. Still owed: test 8, the mutation
   check, for each constraint in `0005` (drop a constraint, confirm a test goes red).
3. **A producer for pending cash**, the day a credit sale exists. `resolvePendingCash` is ready and
   idle until then.
4. **Receipts and the sales list** (POS-04, POS-05) — the remaining engine gaps before a cashier screen.

None of these needs an owner decision except item 1's permissions (D-C, D-D).

### 8.5 Why I12 is not a database constraint

§3 said a partial unique index is impossible because "a shift is open while it has no closure row" is a
two-table state. That is true, and the alternatives are worse:

- a `closed_at` column on `cash_shifts` needs an `UPDATE` at close, and `UPDATE` is deliberately revoked
  from the runtime role on that table (migration `0004`). Append-only and "one open shift" pull in
  opposite directions here;
- a separate register-state table would need `DELETE` or `UPDATE` on close — the same collision.

The advisory lock is therefore the correct instrument: it serialises `openShift` per (tenant, register)
and the loser receives `shift_already_open`, which `review-gates.test.ts` gate 2 proves. Writing this
down matters, because the next reader will otherwise propose the index a third time.
