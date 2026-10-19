# Review 0001 — Nile engines: database integration, authentication, and tenant isolation

| Field | Value |
| --- | --- |
| Status | **Review complete — for action** |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture reviewer) |
| Reviewed commit | `0811ae0` (merge of PR #2, `feat/nile-engines-wave2-db`) |
| Reviewed scope | `engines/**`, `engines/db/migrations/0001_nile_engines.sql`, `docs/adr/0001`–`0006`, `AGENTS.md`, `docs/REUSE.md` |
| Method | Read every file; ran the suite; wrote an independent probe against a real PostgreSQL (PGlite) applying the real migration; generated migrations from the Drizzle schemas with `drizzle-kit` to test the two sources of truth against each other |
| Evidence | [`tools/spikes/nile-review/probe-db-findings.mjs`](../../tools/spikes/nile-review/probe-db-findings.mjs) — reproducible |
| Branch | `arena/bfcb5ed1-mohamed-app-factory` (not merged to `main`, by instruction) |


> **Consolidation note (2026-10-14).** Historical review of `0811ae0` (PR #2), imported unchanged except
> for this note and one link fix. Most findings were fixed by PR #3 (`ebcfe72`); H4 is fixed by PR #4
> (open). Per-finding status on current `main`: [docs/architecture/README.md](../architecture/README.md);
> live register: [docs/STATUS.md](../STATUS.md) §6. Overlapping review of the same code on `main`:
> [2026-10-14-engines-db-auth-review.md](2026-10-14-engines-db-auth-review.md).
> The renumbering plan in §4 is superseded: the localization ADR landed as **ADR-0009**, because `main`'s
> ADR-0007 is now the roles ADR. The probe applies `engines/db/migrations/0001_nile_engines.sql`, which no
> longer exists on `main`; it reproduces only at `0811ae0`.

---

## 1. Verdict in one page

**What I verified myself, and it holds up:**

- `npm run typecheck` — clean.
- `npm test` — **49/49 tests pass** (6 files), including 4 real-PostgreSQL RLS tests.
- The **fail-closed tenant isolation is genuinely correct**, and I confirmed it independently rather
  than trusting the suite: with no tenant context the runtime role sees **zero rows**; tenant B cannot
  read tenant A; tenant A cannot insert rows as tenant B; a duplicate idempotency key is rejected
  **within** a tenant while the same key is accepted across tenants.
- `set_config('app.tenant_id', …, true)` (transaction-local) is the right mechanism, and I confirmed it
  reverts on `COMMIT` — so a pooled connection cannot leak context.
- The money domain layer is `BigInt`/INT64-based with golden tests guarding financial results.
- Testing as a **non-owner, non-superuser runtime role** (ADR-0005 §7) is a sophisticated choice that
  most teams get wrong.

**What is not there, contrary to the wave-2 summary:**

| Claim | Reality |
| --- | --- |
| "Wave 2 — persistence & contracts (done)" | Schemas + one hand-written SQL file + a helper exist. **There is no integration**: no DB client, no migration runner, no `drizzle.config`, no `drizzle-kit`, no `db:migrate` script, no repository layer, and **no code anywhere calls `withTenant`** (grep: zero callers). |
| "ADR-0004: Drizzle Kit generates committed migrations" | Not implemented. The single migration is hand-written and **already diverges** from the Drizzle schemas (finding H2). |
| ADR-0005: Better Auth owns `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `team` | **None of those tables exist.** Authentication is not implemented. |
| Demo seed, "14 role accounts" (`demo-seed.ts`) | Cannot run — it is a spec, and there is no auth layer and no account tables to seed. |
| User permissions | **No authorization exists anywhere in the codebase.** `role` is carried in `TenantContext` and never read. |

**The most consequential single finding:** the domain money layer validates to `INT64_MAX`
(`money-minor.ts`), the Zod contracts constrain only a minimum (`z.number().int().min(0)`), and the new
database columns are **32-bit `integer`** — a maximum of **21,474,836.47 EGP** per transaction. The
engine and its storage disagree by a factor of ~4.3 billion, and a property-vertical contract can
realistically exceed that ceiling today.

---

## 2. Findings

Severity: **Blocker** (must be decided before the first real data) · **High** (fix before feature work
on the affected seam) · **Medium** · **Low**.

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| H1 | **Blocker** | Money: domain validates to INT64, storage is 32-bit | N2; `money-minor.ts:37,80,105`; `contracts.ts` |
| H2 | **High** | Two sources of truth for the schema, already divergent — regeneration would drop the per-tenant uniques | `drizzle-kit generate` output vs migration |
| H3 | **High** | Cross-tenant referential integrity gap in six relationships | N1 |
| H4 | **High** | The audit trail is mutable (and erasable) by the runtime application role | N3 |
| H5 | **High** | Auth layer absent; the tenant table may collide with Better Auth's `organization` | migration inventory; ADR-0005 §Consequences |
| H6 | **Medium** | No authorization model — `role` is decorative | repo-wide grep: zero permission checks |
| H7 | **Medium** | Enum-like columns have no `CHECK`; the database accepts `'BANANA'` | N4 |
| H8 | **Medium** | `is_active` / `is_demo` stored as `text`: `'false'` is truthy in JavaScript | N5 |
| H9 | **Medium** | Booking overlap is not concurrency-safe (no `EXCLUDE` constraint) | N6 |
| H10 | **Medium** | The production tenant path (`withTenant`) is untested; the RLS suite tests a different mechanism | N7; grep: zero callers |
| H11 | Medium | No DB plumbing: no client, no migration runner, no repositories | inventory |
| H12 | Low | Cross-engine deep relative imports into `platform/src/db/schema.js` internals | `engines/*/src/db/schema.ts:6` |
| H13 | Low | Assorted modelling gaps (`payload text`, missing `updated_at`, missing actor columns) | schema read |

---

### H1 — Money: the domain layer and the database disagree by design (Blocker)

| Layer | Constraint | Maximum |
| --- | --- | --- |
| Domain (`money-minor.ts`) | `BigInt` validated against `INT64_MAX = 9_223_372_036_854_775_807n` | ~9.2 × 10^18 minor units |
| Contract (`contracts.ts`) | `z.number().int().min(0)` — **no upper bound** | 2^53 (JS safe integer) |
| Storage (migration + Drizzle) | `integer` (32-bit) | **2,147,483,647 minor units = 21,474,836.47 EGP** |

Probe evidence (N2): `2147483647` accepted; `2147483648` → `integer out of range`.

Why this is a blocker rather than a task: it is a **data-model decision**, and changing a money column
after real transactions exist is an expensive migration. It also matters specifically for this factory's
stated verticals — a property sale or a multi-year contract in EGP will exceed 21.5 million today, and
the failure would surface at the worst moment (posting a sale), as a runtime database error, not a
validation error.

**Remedy (needs a decision, then one migration):** store money as `bigint` (or `numeric(20,0)`), state the
maximum explicitly in the Zod contracts, and add a test that the contract, the engine and the column
agree on the same bound. Do not leave three different limits in place.

### H2 — Two sources of truth for the schema, already divergent (High)

ADR-0004 designates Drizzle schemas as the source of truth and requires **generated, committed**
migrations. Reality: the schemas declare **no** composite uniques and **no** indexes, while
`0001_nile_engines.sql` declares four composite `UNIQUE`s and four indexes.

I generated migrations from the TypeScript schemas with `drizzle-kit` and compared:

```
drizzle-kit generate → 0000_nile_from_ts.sql
  sales_transactions  9 columns 0 indexes 1 fks
  bookings            9 columns 0 indexes 1 fks
  … every table: 0 indexes
```

The committed migration's `sales_transactions` ends with `UNIQUE (tenant_id, idempotency_key)`; the
generated one has no such constraint. The same applies to `UNIQUE (tenant_id, code)` (bookings),
`UNIQUE (tenant_id, sku)` (catalog_variants), `UNIQUE (tenant_id, employee_id, day)`
(attendance_records), and all four indexes.

**Consequence:** the next `drizzle-kit generate` diffed against a real database produces a migration that
**drops per-tenant uniqueness** — including the database-level idempotency guarantee that makes the sale
path safe against retries. Whichever source is wrong, one of them lies about the schema today.

**Remedy:** declare the uniques (`unique().on(...)` / `uniqueIndex`) and indexes in the Drizzle schemas,
add `drizzle.config.ts` + `drizzle-kit` + a `db:migrate` script, reconcile against the applied migration,
and add a CI check that regeneration produces an empty diff. This is also finding H11's fix.

### H3 — Cross-tenant referential integrity gap (High)

RLS `WITH CHECK` validates a row's **own** `tenant_id`. Foreign keys are single-column and PostgreSQL
performs referential checks **outside** RLS. Therefore a row owned by tenant A can reference a parent
owned by tenant B.

Probe evidence (N1): tenant A successfully inserted a `transaction_lines` row with
`tenant_id = A` and `transaction_id = <tenant B's transaction>`. The same applies to
`bookings.resource_id`, `catalog_variants.item_id`, and `attendance_records` / `leave_requests` / `loans`
→ `employees.id`.

No data leaks directly (A still cannot read B's rows), but the isolation model has a hole: A can attach
records to B's aggregates, and any later join or aggregate that trusts the FK crosses the boundary.

**Remedy:** composite foreign keys — `UNIQUE (tenant_id, id)` on parents, then
`FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)`. Six relationships affected.

### H4 — The audit trail can be edited or erased by the application (High)

`audit_log` has RLS for tenant scope, and the test grants the runtime role
`SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`.

Probe evidence (N3): as the runtime role, an audit row was **updated** (`action` overwritten) and then
**deleted**. Nothing prevents it.

For a factory whose premise is auditable financial records, an audit trail the application can rewrite is
not an audit trail. This is also what ADR-0002 promises ("audit records carry tenant context") and what
Milestone 1 lists as scope.

**Remedy:** `REVOKE UPDATE, DELETE ON audit_log FROM <runtime role>` (keep `INSERT`, `SELECT`), plus a
test asserting the revocation fails. Consider writing audit rows through a `SECURITY DEFINER` function so
the app never needs direct table rights.

### H5 — Authentication is absent, and the tenant table may collide with the auth library (High)

ADR-0005 §2 makes Better Auth's **organization** the application tenant, and §Consequences says Better
Auth's schemas become Drizzle schema owned by `platform/auth`. The migration contains **none** of
`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `team`. Instead it
defines its own `organizations` table (plural, with an `is_demo` column).

That is a live collision: two tables for one concept, and an unresolved question about which one the
auth library owns. It also creates a **chicken-and-egg** problem that must be designed, not discovered:

> With fail-closed RLS on `organizations` (and on any future `member` table), how does the runtime role
> answer *"which tenants does this user belong to?"* **before** a tenant context exists?

`resolveTenantContext()` takes `memberships` as an argument — so the answer must come from somewhere
outside the tenant-scoped path. That somewhere does not exist yet.

**Remedy — this needs an ADR (superseding or extending ADR-0005), because AGENTS.md forbids silently
choosing:** decide whether Better Auth's `organization`/`member` tables **are** the tenant tables
(Better Auth permits table-name overrides, so `organizations` can remain the physical name with
`is_demo` as an extension column), and specify how memberships are read pre-tenant — either a
user-scoped RLS policy on `member`, a `SECURITY DEFINER` resolver, or deriving it from the session — with
a test proving a user cannot enumerate another user's memberships.

### H6 — No authorization model; `role` is decorative (Medium, but blocking for step 3)

A repo-wide search for permission checks (`can(`, `hasPermission`, `ctx.role`, `authorize`) returns
**nothing**. `TenantContext.role` is populated by `resolveTenantContext()` and never read by any code.
ADR-0005 §3 deliberately defers "a custom RBAC system", and that is a legitimate deferral — but it has
two unaddressed consequences:

1. `demo-seed.ts` defines **14 role accounts** across seven systems (`cashier`, `storekeeper`, `doctor`,
   `kitchen`, …). Those roles exist in name only; nothing enforces them. A demo where every role can do
   everything is misleading to a reviewer.
2. The first operational path (login → saved sale) has authorization decisions in it from day one:
   who may record a sale, who may void one, who may see cost prices. Without a chokepoint, those become
   implicit "everyone".

**Remedy — decide explicitly, either way:** (a) a minimal `can(role, action)` chokepoint with a small
policy table, fail-closed default, and tests — roughly a day of work and it prevents the "permissions
retrofit" that ADR-0005 wanted to avoid; or (b) a recorded decision that M1 has exactly one privileged
role and every mutation is audited, with the demo accounts relabelled accordingly. What must not happen
is leaving a decorative `role` field in place while the UI implies roles work.

### H7 / H8 / H9 — Database-level guarantees weaker than the code implies

| # | Probe evidence | Remedy |
| --- | --- | --- |
| H7 | `bookings.status = 'BANANA'` and `stock_movements.direction = 'sideways'` **accepted** | `CHECK` constraints (or enum tables) generated from the same source as the Zod unions, plus a drift test between contract and constraint |
| H8 | `is_active` stored as `text`; value `"false"` has JavaScript truthiness **`true`** | `boolean` columns; a naive `if (row.isActive)` currently treats a deactivated resource/item/employee as active |
| H9 | Two identical overlapping bookings **accepted** by the database | `EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&)` with `btree_gist`; keep the engine's check for friendly UX, but the constraint is what makes it safe under concurrency |

H9 deserves emphasis because `engines/booking` documents "double-booking prevention" as a capability. The
engine's availability check is application-level: two concurrent requests both read "free" and both
insert. The database must be the arbiter.

### H10 — The production tenant path is untested (Medium)

`withTenant()` is described as "the only tenant-scoped SQL path". Grep shows **zero callers**, and the RLS
suite sets context with `set_config(..., false)` — session-scoped, not the transaction-local `true` the
helper uses.

Probe evidence (N7): session-scoped context **persisted into a later statement** (rows stayed visible),
while transaction-local context saw rows inside the transaction and **zero after `COMMIT`**. So the helper
is correct — but the suite proves *isolation*, not *transaction-locality*, and nothing exercises the
helper at all.

**Remedy:** an integration test that drives `withTenant` through a real client on one connection, asserting
(a) rows visible inside, (b) zero rows after, (c) a following transaction for another tenant cannot see
the previous tenant's rows.

### H12 / H13 — Boundary and modelling nits (Low)

- All four engine DB schemas import `'../../../platform/src/db/schema.js'` — a deep relative import into
  another engine's internals, which ADR-0001 §5 discourages, and the engine `index.ts` files do not export
  their DB schemas at all, so consumers *must* deep-import. Proper subpath exports plus Nx boundary rules
  fix this mechanically.
- `audit_log.payload` is `text` — `jsonb` is queryable and validates.
- No `updated_at` on mutable tables (`bookings`, `catalog_items`, `catalog_variants`, `employees`).
- Only `sales_transactions` carries an actor (`created_by`); the other transactional tables do not, which
  limits what an audit trail can reconstruct.

---

## 3. Answers to the three requested steps

### Step 1 — Review engines ↔ database integration

**There is no integration to review yet; there are integration *primitives*.** The seam consists of:
Drizzle schemas (incomplete, per H2), one hand-written SQL migration, and a single correct-but-unused
`withTenant()` helper. What is missing is the entire path between a domain call and a row: a DB client
with pool configuration, a migration runner, repositories that call `withTenant`, error/transaction
semantics, and tests of that path. **"Wave 2 done" overstates the state — accurately it is "storage
primitives done; integration not started".**

### Step 2 — Verify authentication, permissions, and tenant isolation

| Concern | Verdict |
| --- | --- |
| **Tenant isolation** | **Verified and sound.** Fail-closed RLS with `FORCE ROW LEVEL SECURITY`, correct `NULLIF(…, '')` fail-closed comparison, non-owner runtime role, per-tenant uniques. I confirmed no-context ⇒ zero rows, cross-tenant read denied, cross-tenant insert denied. Two gaps to close: H3 (composite FKs) and H10 (test the production path). |
| **Authentication** | **Not implemented.** No identity, session, membership, or invitation tables; `demo-seed.ts` cannot run; nothing calls `resolveTenantContext()`. |
| **Permissions** | **Not implemented.** Zero authorization checks exist; `role` is decorative; no role→permission mapping; the 14 demo roles are unenforced. This is a deliberate ADR-0005 deferral that needs an explicit decision (H6). |

### Step 3 — The first operational path (login → a saved sale)

**It is buildable, and — importantly — it does not depend on the Odoo decision.** The sale itself is
Nile-domain (`sales_transactions`); an adopted ledger (Option C) or a hand-built one (Option D) sits
*behind* the sale, not inside it. So the first operational path can proceed in parallel with the four
outstanding Odoo measurements. What it *does* depend on, in order:

1. **H1 money storage decision** — before the first real transaction exists (Blocker).
2. **H5 auth reconciliation** — which table is the tenant, and how memberships are read pre-tenant
   (High; needs an ADR).
3. **Customers/parties in the model** — ADR-0003 puts "customer creation and viewing" in Milestone 1
   scope, but **no `customers`/`parties` table exists**; the only customer-shaped data is
   `leads.customer_name`/`customer_phone` as free text. The sale path needs a real party.
4. **H6 authorization posture** — decide the chokepoint or the compensating control.
5. **H2/H11 DB plumbing** — `drizzle.config`, generated migrations, client, repositories behind
   `withTenant`, plus the H3/H4/H10 fixes and tests.
6. **Then** the API edge (NestJS/Fastify + OpenAPI per ADR-0001/0006) and the UI.

Steps 1–4 are decisions, not code. Once they are recorded, steps 5–6 are a straightforward, testable
walking skeleton — the same shape recommended in the architecture assessment already on `main`.

---

## 4. Reconciliation: two document worlds now exist

`main` carries ADRs 0001–0006 (dated 2026-09-04) and `docs/architecture-assessment.md`. My branch carries
proposals 0001–0004, a spike, and its own `docs/adr/`. Both are legitimate; they were authored in
parallel and have never been reconciled. Three concrete conflicts to resolve **before** either is merged:

1. **ADR numbering collision (my error to declare).** My branch's
   `docs/adr/0001-localization-arabic-rtl-first.md` collides with `main`'s ADR-0001 (technology stack),
   and the pending build-vs-adopt decision was provisionally numbered ADR-0002, which on `main` is
   tenancy. **Renumbering plan:** the localization decision becomes **ADR-0007** on `main`, the
   build-vs-adopt decision **ADR-0008**, and so on from the next free number. Accepted ADRs are immutable
   per AGENTS.md, so the fix is a renumber, never an edit of existing records.
2. **Stack divergence.** `main`'s ADR-0001 specifies **Nx + pnpm + NestJS + Next.js**; the repository
   currently uses **npm, a single package, no Nx**, and none of the framework layer yet. That is
   consistent with "engines first", but the engines sit *inside* one package rather than being
   workspace-isolated, so ADR-0001 §4 ("boundaries enforced in CI") is currently prose only.
3. **The Arabic/RTL decision is unrecorded.** The codebase already implements it — bilingual
   `name_ar`/`name_en` and `labelAr`/`labelEn` columns, Arabic locale utilities, `Africa/Cairo` day
   grouping, Arabic messages in the catalog engine — but no ADR records that Arabic/RTL is a first-class
   requirement. The implementation is ahead of the record; the record (renumbered ADR-0007) should catch
   up, because it is what stops a future agent from shipping an LTR-only screen.

Neither world is wrong. But per AGENTS.md's own instruction — *material conflicts must be surfaced, never
silently resolved* — this is exactly such a conflict, and it is now surfaced.

---

## 5. What I did not verify (stated so this review is not over-read)

- **No live concurrency test.** H9 was verified as *absence of a constraint* plus two accepted overlapping
  rows; the interleaving race itself was not executed (PGlite is single-connection).
- **No NestJS/Fastify layer exists to test**, so the ADR-0006 API contract is unexercised, and the
  Better Auth compatibility spike described in ADR-0005 §8 could not be re-run (its evidence is a
  throwaway spike outside this repository).
- **No production database.** All DB evidence comes from PGlite (WASM PostgreSQL 17-line) applying the
  real migration as a non-owner role. PGlite is the same engine the project's own RLS tests use, but
  connection pooling, `pgbouncer`, and role/`GRANT` configuration were not exercised.
- **Business-domain correctness of the engines was not audited.** I read the money, tenant, idempotency,
  and schema layers closely; `booking`, `catalog`, `people`, and `payroll` were read for interface and
  schema purposes only, not line-by-line for domain correctness.
- **`prototypes/nilesys`** (explicitly "not production code") was not reviewed.

---

## 6. Recommendation

1. **Do not start the first operational path until H1 and H5 are decided.** Both are cheap to decide now
   and expensive later; neither is a coding task.
2. **Fix the four mechanical DB defects in one small wave** — H2 (schema/migration reconciliation with
   regenerated migrations), H3 (composite FKs), H4 (audit immutability), H10 (test the production tenant
   path). These are self-contained, testable, and reversible, and they make the security claims that
   ADR-0002/ADR-0004/ADR-0005 make actually true.
3. **Record three decisions as ADRs before code:** money storage range (H1), auth/tenant table
   reconciliation and pre-tenant membership resolution (H5), and the M1 authorization posture (H6).
4. **Keep the good parts exactly as they are**: fail-closed RLS, `FORCE RLS`, non-owner runtime role,
   per-tenant uniqueness, transaction-local tenant context, golden money tests. This is the strongest
   part of the repository and it should be the template for everything added later.
