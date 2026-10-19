# Nile — Post-Merge Verification & Security Gate (after PR #3)

> **Status: HISTORICAL evidence (repository copy, added 2026-10-14).** Verification of `main` at `ebcfe72`.
> It is the source of the gate finding IDs **G-1…G-15** used in [`docs/STATUS.md`](../STATUS.md). These are
> unrelated to the golden example IDs `G-n` inside `engines/transactions`, which come from the source
> repository. The parenthetical `(Hn)` labels in §3 are this gate's own hypothesis numbers, **not** the
> H-n findings of review 0001. Live status of each finding is tracked in `docs/STATUS.md`, not here.
>
> Edits from the author's local report, all listed here: sandbox paths removed; §4's stale "Not merged and
> not pushed" corrected to the verified state; §7's owner-only operational steps (credential revocation,
> local bundle commands) removed. No finding, measurement or verdict was changed. The scratch harnesses
> named below (`.scratch/*`) were **not committed**, so those observations cannot be re-run from the
> repository as-is.

Date: 2026-10-14 · Repo: `mohamedmasoud3030-tech/Mohamed-App-Factory` · Scope: Nile only (no Odoo, no cashier UI, nothing merged)

## 1. SHAs

| Item | SHA |
|---|---|
| `origin/main` HEAD verified (= PR #3 merge commit) | `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` |
| PR #3 head / base | `b602a5701ea6` / `0811ae075bfb` |
| Newer commits on `main` / open PRs at verification time | none / none |
| **Fix commit (Phase 3)** — branch `fix/nile-gate-ledger-append-only-demo-lock`, parent `ebcfe72` | `784e50cb085f6d7d23c018cc5e9183746ff8109b` |

**Branch status (updated):** pushed to `origin` (remote SHA `784e50c`, identical to local). Opened as **PR #4** for review (https://github.com/mohamedmasoud3030-tech/Mohamed-App-Factory/pull/4): open, **not merged**. `main` is unchanged at `ebcfe72`. The repo has no CI workflows, so no automated checks run on the PR.

## 2. Commands and exact outcomes

Verification ran in an isolated detached worktree of `origin/main` (`git worktree add --detach`, `npm ci`). Scratch harnesses live in `.scratch/` (untracked, never committed).

| # | Command / action | Outcome |
|---|---|---|
| 1 | `git fetch origin --prune` + GitHub API (PR #3, commits, PR list) | main = `ebcfe72`, no newer commits, no open PRs |
| 2 | `git diff --stat 0811ae0 ebcfe72` | 45 files, +10786/−1312 |
| 3 | `npm run typecheck` | exit 0 |
| 4 | `npm test` | 9 files, **91/91** passed |
| 5 | `npm run db:generate` / `npx drizzle-kit check` | "No schema changes" / "Everything's fine" |
| 6 | Migrated PGlite + `drizzle-kit push --strict` (dry run) + `pg_get_constraintdef` | Only diff = 9 composite FKs drop/re-add; DB FKs match code exactly → tooling false positive |
| 7 | `npm audit` | 4 moderate, all dev-only (drizzle-kit → esbuild 0.18) |
| 8 | Server from main (`PORT=3100`, fresh PGlite): `GET /api/health` · `GET /api/v1/me` (anon) · `npm run api:smoke` | 200 `{"ok":true}` · 401 · smoke 5/5 ✅ |
| 9 | **Real PostgreSQL 18.4** (npm `embedded-postgres` binaries, port 5433). Roles: `nile_owner` (non-superuser, CREATEROLE, owns DB), `nile_login` (runtime login, `GRANT nile_app` after migrate) | Migrations applied as non-superuser owner (2); all tables owned by `nile_owner`; `nile_app` NOSUPERUSER NOBYPASSRLS |
| 10 | `.scratch/pg-gate.test.ts` via `openPostgres` (production path), main code | 13/13 ran; observations in §3 (H1, H3 confirmed) |
| 11 | `.scratch/h7-misconfig.mts` with login = `nile_owner` / `postgres` / `nile_login` | owner → exit (unhandled rejection 42501) · superuser → runs as `nile_app` · login → `nile_app` |
| 12 | `.scratch/pg-auth.test.ts` (full HTTP stack on real PG), main code | 5/5 ran; role matrix 0 mismatches; H4 confirmed |
| 13 | `.scratch/origin-and-b3.mts` (outside vitest, so the origin check is live) + `curl` against the :3100 dev server | Fixed list: `Origin: evil` → 403 INVALID_ORIGIN, no Origin → 403. Dev server: `Origin: evil` → **200** |
| 14 | HTTP bounds probes on :3100 (`qty "0"`, `"-1"`, number, 12 digits, injected price/tenant, empty, unknown variant, malformed JSON, bad UUID) | 422 / 400 / 400 / 409 stock / 400 / 400 / 400 / 422 / 400 / 404 |
| 15 | Fix branch: `npm run typecheck`; `npm test`; `db:generate`; `drizzle-kit check` | exit 0; **95/95** (91 + 4 new); no drift; fine |
| 16 | Mutation checks in the worktree (M0–M4, §4) | Each mutation is caught; restoring the fix → 40/40 |
| 17 | Real-PG **in-place upgrade**: DB built at main with data → code at `784e50c` → migrate as owner twice | migrations 2→3, second run no-op; sales 39 / audit 38 / moves 68 preserved; runtime has no UPDATE/DELETE on the 5 ledger tables, keeps UD on `catalog_variants` |
| 18 | pg-gate + pg-auth re-run on the fix (fresh DB for pg-auth) | 13/13 and 5/5; D1 ledger probes now `denied 42501`; B4 abuse now 403, next visitor still logs in |

## 3. Findings

Severity is judged in Nile's context: public demo with a public shared password; money and audit data.

| ID | Sev | Location (file:line @ `ebcfe72`) | Repro / test | Observed | Expected | Status |
|---|---|---|---|---|---|---|
| **G-1** (H1) | **High** | `engines/db/migrations/0001_security_hardening.sql:17,20` (full DML to `nile_app`); `:46` revokes DELETE only on organization/user/account | `pg-gate.test.ts` D1, as `nile_app` inside `withTenant`, real PG | `UPDATE audit_log` ALLOWED, `DELETE audit_log` ALLOWED, `UPDATE transaction_lines SET unit_price_minor=1` ALLOWED, `DELETE stock_movements` ALLOWED | Runtime cannot rewrite or delete audit/ledger history | **Fixed on branch `784e50c` (unmerged)**: migration `0002_ledger_append_only.sql`. Verified on real PG, including in-place upgrade. Regression tests `rls.test.ts` "append-only ledger and audit (0002)" |
| **G-2** (H4) | **High** | `engines/platform/src/auth/auth.ts:38-44` (no restriction for shared logins) | `pg-auth.test.ts` B4 | `change-password` 200 → next visitor with `demo1234` **401**; `revoke-sessions` 200 → other visitor 401; `organization/leave` 200 → every later visitor 403; `update-user` 200 (defacement) | One visitor cannot lock out or deface shared demo logins | **Fixed on branch `784e50c` (unmerged)**: Better Auth before-hook → 403 `SHARED_DEMO_ACCOUNT_LOCKED`; real tenants unaffected. Regression tests `e2e-sale.test.ts` §6b |
| G-3 (H2) | Medium | `engines/transactions/src/sale-service.ts:151-184` inserts header, lines, movements, audit only; `cash_movements` (`engines/transactions/src/db/schema.ts:81`) unused | code read + DB counts in C1/C2 | A sale stores no payment (method, tendered, change) | The cashier flow persists payment atomically with the sale | Open. This is a missing engine feature, so it is outside Phase 3 scope |
| G-4 (H3) | Medium | `0000_nile_engines.sql:97` price, `:111` stock, `:143/:186` kind (text), `:145` total, `:133/:161` direction (text), `:162/:177` quantity: no CHECK | `pg-gate.test.ts` D2 | DB accepts `stock=-5`, `price_minor=-1`, `kind='banana'`, `total=-100`, `quantity=0` (on the fix, ledger UPDATEs are blocked by privilege, but INSERT/owner paths still have no CHECK) | DB rejects impossible values (defence in depth) | Open |
| G-5 (H5) | Medium | `apps/api/src/main.ts:13,16,26-28`; `auth.ts:41,43` | `curl` :3100 with `Origin: https://evil.example` | Dev mode reflects any Origin → cross-origin `update-user` **200**; per-boot random secret; non-secure cookies; no rate limit. All depend on `NODE_ENV=production` | Any public deployment (including the demo) uses a fixed origin list, a stable secret, secure cookies and rate limits | Open (deployment config). With a fixed list the origin check works: 403 verified |
| G-6 | Low | Better Auth skips the origin check when `NODE_ENV=test` (`@better-auth/core/dist/env/env-impl.mjs:36`, `better-auth/dist/context/create-context.mjs:211`); vitest sets it | `pg-auth` B5 (200 in vitest) vs `origin-and-b3.mts` (403 outside vitest) | The suite cannot detect origin/CSRF regressions | Origin protection has test coverage | Open |
| G-7 (H7) | Low | `engines/db/open.ts:78` (unawaited `SET ROLE`); `:44-55` (`assertRuntimeRole` accepts any non-super, non-bypass role) | `h7-misconfig.mts` | Wrong login (`nile_owner`) → process exits through an *unhandled rejection* (exit 1); fail-closed only because of Node's default. 10 concurrent pooled connections were all `nile_app` (A1) | Explicit startup failure; assert `current_user = nile_app` | Open |
| G-8 | Low | Better Auth `organization/set-active`; Nile `request-context.ts:25` | `origin-and-b3.mts` | A failed set-active to a non-member org returns 403 **and clears the caller's own active org** → `/me` 403 `no_active_tenant` until re-select/re-login | Failed call leaves the session unchanged | Open (fail-closed, self-only; the UI must handle `no_active_tenant`) |
| G-9 (H9) | Low | `engines/transactions/src/db/schema.ts:30` (unique tenant+key) | design review | The same key reused by another user in the same tenant returns that sale (replay) or 409 | Acceptable if keys are client-random UUIDs | Open (document) |
| G-10 (H10) | Low | `engines/README.md:13` "double-booking prevention" | code read | Domain-level only; no booking API or DB `EXCLUDE` constraint | Claim matches implementation | Open (add `EXCLUDE` before any booking API) |
| G-11 (H11) | Low | `apps/api/src/app.ts:68` | `GET /api/openapi.json` → 200 anon | Public API contract | Decide explicitly | Open (info) |
| G-12 | Low | drizzle-kit 0.31.11 `push` | §2 #6 | False drift on composite FKs | — | Open: do not use `push` as a drift gate; use `generate` + `check` |
| G-13 | Low | no `db:migrate` script; `0001_security_hardening.sql:11` needs owner with CREATEROLE | §2 #9, #17 | Migrations only at app boot; CREATEROLE requirement undocumented | Documented migration step | Open |
| G-14 | Low | dev dependencies | `npm audit` | 4 moderate, dev-only | — | Open |
| G-15 | Info | Fastify body parser | malformed JSON probe | 400 with Fastify shape `{statusCode,message}`, not the Nile error envelope | Uniform envelope | Open |

**Checked and found sound (with evidence):**
- **Tenant isolation, real PG:** read 0, cross-tenant insert 42501, update/delete 0 rows, cross-tenant FK 23503, 0 rows without context (A3). 40 interleaved transactions isolated; idle pooled connections carry no `app.tenant_id` (A2). Every pooled connection is `nile_app` (A1).
- **Runtime cannot:** TRUNCATE, disable RLS, `SET row_security=off`, CREATE in `public` (PG18), read `drizzle.*`, delete organization, or `SET ROLE nile_owner` (D1).
- **Concurrency, real PG:**
  - 20 concurrent sales against stock 5 → exactly 5 succeed, stock 0.000 (C1).
  - 10 concurrent duplicates → one sale, 9 replays (C2).
  - Same key with different bodies → 1 ok + 5 `idempotency_conflict` (C3).
  - 30 opposite-order carts → no deadlock (C4).
- **Atomicity:** injected failure at the audit insert (last write) or at stock_movements (mid-way) → nothing persisted, stock unchanged, key reusable (C5, C6).
- **Money bounds:** price > 2^53 → `invalid_price`; total > MAX_SAFE → `amount_out_of_range`; nothing persisted (C7). Money columns are bigint and quantities numeric(18,3) (D3, 17 columns).
- **Authentication:**
  - Sign-up disabled (400, user count unchanged); wrong password 401.
  - Cookie `HttpOnly; SameSite=Lax`.
  - All 4 product routes return 401 anonymously.
  - Sign-out kills the cookie; a role change applies on the next request; a deleted membership → 403 (B1, B5).
- **Authorization:** effective HTTP matrix for 14 demo roles × 4 routes matches `can()` with 0 mismatches (B2). Escalation attempts are all refused: self→owner, create/update/delete org, invite, remove member, switch or read another tenant (B3).

## 4. Fixes (Phase 3, Critical/High only)

Branch `fix/nile-gate-ledger-append-only-demo-lock` @ `784e50cb085f6d7d23c018cc5e9183746ff8109b` (parent `ebcfe72`). Pushed and opened as **PR #4**; **not merged** (verified 2026-10-14).

| File | Change |
|---|---|
| `engines/db/migrations/0002_ledger_append_only.sql` (+ `meta/0002_snapshot.json`, `meta/_journal.json`, generated by `drizzle-kit generate --custom`) | `REVOKE UPDATE, DELETE` from `nile_app` on `audit_log`, `sales_transactions`, `transaction_lines`, `stock_movements`, `cash_movements`. No runtime code updates or deletes these tables (the only runtime UPDATE is the stock decrement on `catalog_variants`) |
| `engines/platform/src/auth/auth.ts` | Better Auth `hooks.before` refuses `change-password`, `change-email`, `update-user`, `delete-user`, `revoke-session(s)`, `revoke-other-sessions`, `organization/leave` for the seeded shared demo logins (`DEMO_ACCOUNTS`) → 403 `SHARED_DEMO_ACCOUNT_LOCKED` |
| `engines/db/test/rls.test.ts` | New: privilege matrix + in-tenant UPDATE/DELETE → 42501 on all 5 tables. Test 3b now probes cross-tenant UPDATE/DELETE on `catalog_variants`, so a privilege error cannot mask the RLS filter (same intent, still meaningful) |
| `apps/api/test/e2e-sale.test.ts` | New §6b: locked endpoints → 403, with password, name, other sessions and membership intact; a non-demo user can still change their password |

**Mutation evidence** (isolated worktree; restored to pristine `ebcfe72` afterwards):

| Mutation | Result |
|---|---|
| M0: new tests on unpatched main | 3 failed |
| M1: `audit_log` REVOKE removed | 2 failed |
| M2: `/change-password` removed from locked paths | 1 failed |
| M3: guard matches no account | 1 failed |
| M4: fix restored | 40/40 |

A passing test is not treated as proof on its own. The fixes were also confirmed on real PostgreSQL, through an in-place upgrade and HTTP (§2 #17–18).

## 5. Remaining blockers and unverified areas

**Blockers for the cashier UI**
1. G-1 and G-2 are fixed only on the PR #4 branch; `main` still has both. PR #4 needs review → owner-authorised merge.
2. G-3: no payment engine. Under the binding rule "no product screen before its engine is ready and tested", the cashier screen needs payment recorded atomically with the sale (method, tendered, change), with tests.

**Required before any public exposure (not UI blockers):** G-5 production config; G-4 CHECK constraints; a daily demo reset that runs as owner.

**Unverified (no evidence collected):**
- A real production host (`NODE_ENV=production`, TLS, secure cookies, rate limiting) and browser-level SameSite behaviour.
- PostgreSQL < 15 and managed-PG role restrictions (CREATEROLE).
- Load beyond about 40 concurrent transactions.
- Booking, HR, catalog-management DB paths (no APIs yet).
- CI: the repository has no CI workflows, so no automated checks run on PRs.
- Odoo: handled by another agent; not touched or assumed.

## 6. Verdict

**NOT READY — BLOCKERS REMAIN**

The sales/tenant/auth core is sound under real PostgreSQL and real concurrency. But both High fixes are not on `main` yet, and the payment engine the cashier screen depends on does not exist.

## 7. Recommended next action

1. Independent review of PR #4, then an owner-authorised merge.
2. Next engine task: **payments inside the sale transaction**
   ([proposal 0007](../architecture/proposals/0007-payment-engine.md)), plus a CHECK-constraints migration
   (G-4) and the `nile_app` assertion fix (G-7), each with regression tests.
3. Only then start the cashier UI.
