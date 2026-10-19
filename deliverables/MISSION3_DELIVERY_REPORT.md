# Mission 3: Delivery Report (LENA parallel agent)

Date: 2026-10-18 · Repo: `mohamedmasoud3030-tech/nilesys` (local clone `/home/user/repos/nilesys`)
Branch: **`feat/nile-mission3-pos-fixes-pg-tests`**. Local only: nothing was pushed, merged, deployed or opened as a PR, and no migration was applied.

```
3e9469a chore(offerings): record prototype fixes and PG evidence truthfully
47d8bea test(pg): real-PostgreSQL tests for lead and people services; fix attendance races
43af873 fix(prototype): PERM-3, SALE-2, SALE-3, SALE-6, SHIFT-2, RESET-2 with regression tests
099dc14 ← feat/nile-lead-people-services (unchanged) ← 7a3207e ← a03cca9 ← c910b57 ← b0c17fc ← main 52af469
```

## Headline results

| Workstream | Result |
|---|---|
| A: legacy POS prototype | All **6 defects fixed**, plus 1 new seed defect found and fixed. 16 regression tests: **16/16 pass**. On the original server, 13 of the 15 original tests fail; the other 2 are positive controls. Historical review suite: **30/30 verdicts ✅** (before: 6 ❌). |
| B: real PostgreSQL | **13 new PG tests** (lead 7, people 6) on PostgreSQL 17.11: **13/13 pass, 10 consecutive clean runs**. They **found 2 real concurrency defects** in `recordAttendance` (mine, from mission 2), which are now fixed. They also prove the `moveLead` race guard: PGlite stays green when the guard is deleted, but the PG suite catches it. |
| C: integrity | Typecheck exits 0. Root vitest 141 passed + 13 skipped without PG (**baseline 141 preserved**); **154/154** with PG. Registry 17/17. Mission-2 commits are byte-identical (patch-ids match). No off-limits file touched. Trial merges into both active primary-agent branches: 0 conflicts, all green. |

## A: prototype fixes (`prototypes/nilesys` only)

| ID | Confirmed? | Fix | Now |
|---|---|---|---|
| PERM-3 | Yes (HR employee read 26 POS products, sold, read reports) | POS data routes require `user.system === 'pos'`. This also stops an **HR manager** from editing products or resetting, because `isManager` ignored the system. | 403 |
| SALE-2 | Yes | Stock sufficiency is checked before deduction, with repeated lines of the same product aggregated. Check and deduct happen in one synchronous tick, so there is no race: 18 concurrent requests on stock 8 → exactly 8 accepted. | 409, stock unchanged |
| SALE-3 | Yes | Cash `paid` must be ≥ total. A card sale is recorded at exactly the total. An omitted `paid` still defaults to the total. | 400 |
| SALE-6 | Yes | Barcodes must be unique among active products. A deactivated product frees its barcode. | 409 |
| SHIFT-2 | Yes | Each return is recorded in `sale.refunds` (time, amount, method). Expected cash = start + cash sales − cash refunds in the shift window. The discount is shared pro rata, and the last return takes the exact remainder. The shift screen now shows the server value `expectedCashNow` (`pos.js` had its own copy of the wrong formula). | diff 0 |
| RESET-2 | Yes | Deterministic demo user ids (a hash of system + username). | Session survives the reset |
| **SEED-1 (new)** | Found while testing SHIFT-2 | Today's seeded sales could be timestamped up to 59 minutes in the future, so they fell inside any shift opened now and inflated expected cash. That made the original close value wrong too. | No future sales |

The server now also honours the `DB_FILE` environment variable, so tests never write the repo's `data/db.json`.

`tests/review.test.js` → v3. Its "INFO" assertions were documenting the bugs, so they are now rewritten to assert the fixed behaviour. RET-4's assertion was already stale before this work (the behaviour was correct), and has been corrected.

`REVIEW.md` has a fix-status section appended; the historical text is unchanged.

**Not touched (off-limits / out of scope):** the transaction engine, payment service, migrations, `apps/api`, auth and tenancy. No prototype defect depended on them.

## B: real-PostgreSQL tests

**Setup:** a disposable cluster (`apt install postgresql` → `initdb` on 127.0.0.1:5471). The harness (`engines/catalog/test/pg-harness.ts`) follows the pool-resilience pattern:
- per-run database, owner and login roles (`NOSUPERUSER NOBYPASSRLS`);
- migrations run as the owner; queries go through `openPostgres`, so they run as `nile_app` under FORCE RLS;
- teardown drops everything, verified: 0 leftover databases or roles besides the shared `nile_app`.

The tests are skipped unless `NILE_TEST_PG_ADMIN_URL` is set. They live outside `engines/db`, which the primary agent's branches are changing.

**Deterministic races:** a third connection holds the row lock (or an uncommitted duplicate insert) until `pg_stat_activity` shows both service transactions blocked, then releases it.

| Test | Proves |
|---|---|
| lead: NEW→CONTACTED vs NEW→LOST (forced) | Exactly one wins; the loser gets `lead_stage_conflict`; no lost update |
| lead: same target twice (forced), plus a 25×4 unforced burst | One success per lead; losers get a domain error, never a raw SQL error |
| lead: isolation | B can't list or move A's lead; WITH CHECK rejects a cross-tenant insert (42501); no context → 0 rows; 40 interleaved A/B requests never bleed context across pooled connections |
| people: first record of an employee-day (forced) | **Was failing:** the loser got raw `23505`, which through the API would be a 5xx and lose the check-out. Now both succeed and merge into one row. |
| people: partial updates on an existing row (forced) | **Was failing:** a lost update (one field dropped). Now serialised. |
| people: isolation and FK | B can't see or record A's employee; the composite FK rejects a cross-tenant employee (23503); no context → 0 rows |

**Fix** (`engines/people/src/people-service.ts`, my mission-2 file): read the existing row with `FOR UPDATE`, and retry once on `attendance_tenant_emp_day_uq`.

**Mutation checks:**
- Removing `FOR UPDATE` → the existing-row test fails.
- Removing the retry → the first-record and burst tests fail.
- Removing the `moveLead` `WHERE stage = from` guard → 3 PG tests fail, while the **PGlite suite still passes 19/19**. Concurrency is only claimed where real PG proved it.

## C: commands and results

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | 11 files passed, 2 skipped · **141 passed, 13 skipped** |
| `NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5471/postgres npx vitest run` | 13 files · **154/154** |
| same, PG files only, ×10 | 13/13 each run, 0 unhandled errors |
| `npx vitest run --config tools/nile-offerings/vitest.config.ts` · `npx tsc -p tools/nile-offerings/tsconfig.json` | 17/17 · exit 0 |
| `cd prototypes/nilesys && node --test tests/regression.test.js` | 16/16 (same file on the original `server.js`: 13 of the 15 original tests fail) |
| `node tests/review.test.js` (against a /tmp copy on :3210) | 31 tests pass, 30/30 verdicts ✅ |
| `git patch-id` of a03cca9 / 7a3207e / 099dc14 vs the delivered patches | identical |
| Trial merge → `origin/feat/nile-payments-engine` (c489a23) | 0 conflicts · tsc 0 · **174 passed + 2 todo**, incl. `payments.pg.test.ts` 22 on real PG |
| Trial merge → `origin/fix/nile-pool-error-listener` (29390fa) | 0 conflicts · tsc 0 · **159/159**, incl. `pool-resilience.pg.test.ts` |
| `git ls-remote origin` | main / payments / pool / docs heads unchanged since mission 2 |

**Pre-existing issues (not regressions):**
1. `review.test.js` v2 had stale or characterization assertions (RET-4 failed before any change).
2. Running `node --test` on it fails intermittently with "Unable to deserialize cloned data". This is a Node 20 runner bug with the Arabic child output; running it as `node tests/review.test.js` is reliable.
3. On main, `openPostgres` fires `SET ROLE nile_app` without awaiting it. pg prints "client.query() when the client is already executing a query is deprecated", and the pattern is safe only while pg queues queries; pg@9 removes that queue.
4. On main, `openPostgres` has no `pool.on('error')` listener (N-1). It made harness teardown crash intermittently until the harness waited for backends to disconnect. The primary agent's branch fixes it.

**Regressions: none found.**

**Toolchain note:** this repo uses npm (`package-lock.json`, no pnpm lockfile, pnpm not installed). The pnpm-only rule belongs to the LENA platform repo.

**Registry** (`tools/nile-offerings/offerings.ts`):
- pos evidence now includes the regression suite. Its mustNotClaim now lists what was fixed and what remains open, instead of "6 confirmed defects".
- admin and hr evidence now includes the PG tests.
- Statuses are unchanged (all still `in-progress`; no API or screen exists).

## Files changed (10)
`prototypes/nilesys/{server.js, public/assets/js/pos.js, tests/regression.test.js (new), tests/review.test.js, REVIEW.md}` ·
`engines/catalog/test/{pg-harness.ts, lead-service.pg.test.ts}` (new) · `engines/people/test/people-service.pg.test.ts` (new) ·
`engines/people/src/people-service.ts` · `tools/nile-offerings/offerings.ts`

## Artifacts (new names; earlier deliverables untouched)
- `deliverables/nilesys-patches-mission3/0001–0003*.patch`: `git am` onto `099dc14` reproduces the tip exactly.
- `deliverables/nilesys-feat-nile-mission3-pos-fixes-pg-tests.bundle`: self-contained; verified. Heads: the mission-3 branch, `feat/nile-lead-people-services`, `feat/nile-offerings-readiness`.

## Unresolved risks
1. **Prototype is still a demo:** plaintext passwords (C1), no tenants (C2), reset wipes every system (C3), in-memory sessions (H4), non-atomic saves (H5), no idempotency (H3). Report totals still ignore partial returns (DIAG-2/H1 reports half; only the shift half was in scope).
2. **SALE-3 policy is a choice:** reject cash underpayment. REVIEW left "reject or warn" to the owner.
3. **Discounted returns are now refunded pro rata.** Before, the full line price was refunded, so a fully returned discounted sale refunded more than was paid. Any refund amount on a discounted sale changes accordingly.
4. **Sessions created before this deploy break once:** their user ids were random; ids are stable after the first reset.
5. **The PG tests need a disposable superuser cluster and are skipped in CI unless `NILE_TEST_PG_ADMIN_URL` is set.** Nothing in CI runs them yet.
6. **Not built:** HTTP routes for the lead and people services, public-site tenant resolution and `requestLeave`, as in mission 2. `http.ts` should map `*_not_found` → 404 and `*_conflict` → 409 (owner of `apps/api`).
7. **The GitHub PAT used in the sandbox must be revoked by the owner.** It is not stored in the repo config or in any deliverable.
