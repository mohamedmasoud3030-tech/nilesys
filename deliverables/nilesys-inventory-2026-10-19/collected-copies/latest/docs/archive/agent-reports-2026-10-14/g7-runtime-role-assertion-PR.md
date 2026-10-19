# PR draft: fix(db): require the runtime role to be exactly nile_app (G-7)

| Field | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/Mohamed-App-Factory` |
| Branch | `fix/g7-runtime-role-assertion` (**LOCAL ONLY: not pushed, no PR**) |
| Base | `main` @ `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` (`git ls-remote`, 2026-10-14 18:24 UTC) |
| Head | `60342be628151ffebe23919ea69409e4b63eda99` (tree `ac97e27b6ecdd0afdcb5ffba55a04f115359d387`) |
| Commits | `420c203` initial fix; `60342be` fixes found by reviewing `420c203` (history extended, not rewritten) |
| Files | `engines/db/open.ts`; new `engines/db/test/runtime-role.test.ts`, `engines/db/test/runtime-role.pg.test.ts` |
| Independent of | PR #4 (`784e50c`: no shared files; it isn't an ancestor) and the docs cleanup branch |

## 1. Problem (verified on PostgreSQL 18.4 at `ebcfe72`)

1. `openPostgres` ran `SET ROLE nile_app` from an un-awaited pool `connect` handler. A login that may not
   assume `nile_app` (for example the migration owner) failed through **unhandled promise rejections**.
2. `assertRuntimeRole` refused only superuser/BYPASSRLS roles. Any other role was accepted, including a
   login that owns the tables.
3. `RESET ROLE` returned a pooled connection to the login's own privileges.

With a correctly configured login, the old code did run queries as `nile_app`.

## 2. Change

- **Startup role.** `new pg.Pool({ connectionString, options: '-c role=nile_app' })`. PostgreSQL applies
  the role before the first query and refuses the connection (`42501`) if the login may not assume it.
  `RESET ROLE` returns to `nile_app`. A `PGOPTIONS` environment variable doesn't override it (tested by
  probe). An `options=` parameter in `DATABASE_URL` does override it, and the assertion then refuses to
  start (tested).
- **Assertion: one rule.** `current_user` must be `nile_app`. Then, for every role **reachable by
  `SET ROLE`** from `nile_app` and (Postgres) from the session login (`pg_has_role(.., 'MEMBER')`: itself,
  direct and indirect memberships, NOINHERIT memberships included), none may:
  - be a superuser or BYPASSRLS;
  - own the database, a non-system schema or a relation;
  - hold a table privilege (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER), schema CREATE
    or database CREATE that `nile_app` lacks.

  This matters because `SET ROLE NONE` returns any session to its login, so the login must gain nothing.
- **Cleanup and sanitization.** On startup failure the pool is closed (`pool.end()`) before re-throwing.
  Startup errors are re-wrapped with only the SQLSTATE and server message: node-postgres errors can carry
  the client object with the connection password.
- **PGlite.** Unchanged mechanism (awaited `SET ROLE`). The same rule applies to `nile_app`. The login
  isn't checked, because PGlite's built-in login is a superuser by design (documented).
- **Migration and runtime-login model: unchanged.** Migrations run as the owner over
  `MIGRATION_DATABASE_URL`; the runtime login needs only `GRANT nile_app TO <login>`. No migration or
  schema change.

## 3. Review of `420c203` (2026-10-14): findings, all fixed in `60342be`

Probed on real PostgreSQL 18.4 with the code exactly as committed at `420c203`:

| # | Case | `420c203` | Impact |
|---|---|---|---|
| R1 | Login owns the **database** (tables owned by another role) | accepted | after `SET ROLE NONE`: `DROP TABLE audit_log` succeeded |
| R2 | Login has a **direct grant** nile_app lacks (`DELETE` on `"user"`) | accepted | after `SET ROLE NONE`: `DELETE FROM "user"` succeeded |
| R3 | Login is a member of **`pg_write_all_data`** | accepted | same as R2 |
| R4 | **NOINHERIT** login able to `SET ROLE` to a more privileged role | accepted | same class |
| R5 | System-schema filter: a single backslash in the template literal sent `NOT LIKE 'pg_%'` (wildcard) | schemas such as `pgx_data` were skipped by every check | low for this repository (schemas `public`, `drizzle`) |

Confirmed correct at `420c203` and kept: indirect membership to an owner or BYPASSRLS role was refused;
superuser and BYPASSRLS logins were refused; the startup role, pool cleanup and error sanitization behaved
as designed. Migration-path errors are not re-wrapped, but no secret appeared in any tested failure
(malformed URL, refused connection): informational.

## 4. Tests: guarantees, not implementation

| File | Runs | Guarantees tested |
|---|---|---|
| `runtime-role.test.ts` (6) | always (PGlite) | runs as `nile_app`; refuses a non-`nile_app` role; refuses `nile_app` that is BYPASSRLS, owns a table, owns a table in a `pgx` schema (R5), or can `SET ROLE` to a stronger role |
| `runtime-role.pg.test.ts` (14) | only with `NILE_TEST_PG_ADMIN_URL` (disposable server, superuser); otherwise **skipped** | correct login starts; 8 concurrent queries on several backends all run as `nile_app`; `RESET ROLE` stays `nile_app`; **after `SET ROLE NONE` the login still cannot `DELETE FROM "user"`, `DROP TABLE audit_log` or disable RLS**. Refused: owner (non-member and member), non-member (clear error, no `cause`, no password), superuser, BYPASSRLS (and no connection left open), owner or BYPASSRLS via an intermediate role, database owner (R1), direct grant (R2), `pg_write_all_data` (R3), NOINHERIT (R4), schema/database CREATE, `options=` override; zero unhandled rejections; cleans up its database and roles |

## 5. Results (2026-10-14; Node 20.20.2, pg 8.23.1, PostgreSQL 18.4 embedded, local)

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run` (no PG env) | 97 passed, **14 skipped** (all of `runtime-role.pg.test.ts`, 0 ms) |
| `NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres npx vitest run` | **111/111**; the PG file's 14 tests ran (`passed`). The server listed the test database `nile_g7_705c9aee` during the run; 0 leftovers after |
| New review tests against `420c203` | 5 failed (R1–R4 and nile_app reaching a stronger role), 13 passed |
| Mutation check, isolated copy, 13 mutants (each check removed, membership reach limited to self, login or role not checked, old `SET ROLE` on `connect`, pool not closed, raw `cause` attached) plus R5 escaping | 14/14 caught |
| Real API (`apps/api/src/main.ts`) on PostgreSQL, separate owner and runtime logins | `api:smoke` 5/5; owner as `DATABASE_URL` exits 1 with `UnsafeRuntimeRoleError (42501 …)`, no unhandled rejection |
| Simulated merge with PR #4 (`784e50c` + `60342be`, throwaway worktree) | no conflicts; typecheck 0; **115/115** with real PostgreSQL |

## 6. Not verified and residual risk

- Connection poolers (PgBouncer and similar) and managed PostgreSQL services. A pooler that rejects or
  drops the `options` startup parameter makes startup fail closed, not open. A provider that needs its own
  `options=` in the URL (some do, for routing) would be refused until the options are merged; that's a
  deployment decision, not done here.
- Not covered by the rule: column-level grants, sequences, functions (including SECURITY DEFINER), and
  PostgreSQL 17 `MAINTAIN`.
- The assertion runs at startup. Privileges granted afterwards are not detected.
- Wrong-password behaviour was not exercised: the local server uses trust authentication.
- There is no CI on the repository; all results above are local.

Separate finding N-1 (no pool `error` listener; the process exits when PostgreSQL ends an idle
connection) is out of scope; see `docs/STATUS.md`.

## 7. How to apply (choose one)

**A. Bundle (recommended).**

```bash
git fetch origin                                              # origin/main must be ebcfe72
git bundle verify g7-runtime-role-assertion.bundle
git fetch g7-runtime-role-assertion.bundle fix/g7-runtime-role-assertion:fix/g7-runtime-role-assertion
git rev-parse fix/g7-runtime-role-assertion                   # expect 60342be628151ffebe23919ea69409e4b63eda99
git push origin fix/g7-runtime-role-assertion                 # then open a PR into main with this text
```

**B. Patches.** `git checkout -b fix/g7-runtime-role-assertion origin/main && git am --keep-cr g7-patches/*.patch`
(2 files). Both paths were verified on a fresh clone of `main`: identical trees per commit.

Do not merge without the owner's authorisation and, if possible, a reviewer other than the author. The
`420c203`-era package is kept in `superseded-2026-10-14/`.
