# PR draft: fix(db): require the runtime role to be exactly nile_app (G-7)

| Field | Value |
| --- | --- |
| Repository | `mohamedmasoud3030-tech/Mohamed-App-Factory` |
| Branch | `fix/g7-runtime-role-assertion` (**local only: not pushed, no PR**) |
| Base | `main` @ `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` (re-checked with `git ls-remote` 2026-10-14) |
| Head | `420c203da55bc703f5f07c4f8707630e8425b136` (1 commit) |
| Files | `engines/db/open.ts` (+95 / −16); new `engines/db/test/runtime-role.test.ts`, `engines/db/test/runtime-role.pg.test.ts` |
| Independent of | PR #4 (no migration, no overlap) and the docs cleanup PR |
| Finding | G-7 in `docs/reviews/2026-10-14-post-merge-security-gate.md` (on the docs cleanup branch) |

## 1. Problem (verified on PostgreSQL 18.4 at `ebcfe72` before the fix)

1. `openPostgres` ran `SET ROLE nile_app` from an un-awaited pool `connect` handler. With a login that
   may not assume `nile_app` (for example the migration owner), the failure surfaced as **2 unhandled
   promise rejections**, not as a startup error.
2. `assertRuntimeRole` only refused superuser/BYPASSRLS roles. **Any other role was accepted**,
   including a non-superuser login that owns the tables (owners are exempt from non-forced RLS and keep
   UPDATE/DELETE on the append-only tables).
3. `RESET ROLE` on a pooled connection **returned to the login's own privileges**.

For accuracy: with a correctly configured login, the old code did run queries as `nile_app` (3
sequential and 6 concurrent queries checked), matching the gate's observation A1.

## 2. Change

- **`openPostgres`:** the role is requested as a connection startup option
  (`new pg.Pool({ connectionString, options: '-c role=nile_app' })`). PostgreSQL applies it before the
  first query, refuses the connection (`42501`) if the login may not assume the role, and `RESET ROLE`
  returns to `nile_app`. The startup assertion runs inside `try`; on failure the pool is closed and the
  error is re-thrown.
- **No secret in errors:** node-postgres errors carry the client object, including the connection
  password. Startup errors are re-wrapped with only the SQLSTATE code and server message; no `cause`.
- **`assertRuntimeRole(db, { checkLogin })`:** requires `current_user = 'nile_app'`. It refuses a
  runtime role, or (Postgres, `checkLogin`) a session login, that can become a superuser, a BYPASSRLS
  role or the owner of any relation, using `pg_has_role(.., 'MEMBER')`, which covers every role
  reachable by `SET ROLE`.
- **PGlite:** unchanged mechanism (awaited `SET ROLE`), stricter assertion. Its built-in login is a
  superuser by design, so only the effective role is checked there (documented in the file header).
- **Deployment notes (in the file header):** an `options=` parameter in `DATABASE_URL` overrides the
  startup role, and a pooler that drops startup options leaves sessions as the login. In both cases the
  assertion refuses to start (tested for the first).

Compatibility with the migration model: migrations still run as the owner over
`MIGRATION_DATABASE_URL`; the runtime login only needs `GRANT nile_app TO <login>`, as before. No
migration or schema change.

## 3. Tests

| File | Runs | Cases |
| --- | --- | --- |
| `runtime-role.test.ts` | always (PGlite) | `openPglite` runs as `nile_app`; a non-superuser, non-bypass role that is not `nile_app` is refused |
| `runtime-role.pg.test.ts` | when `NILE_TEST_PG_ADMIN_URL` points at a disposable server (superuser login); otherwise **reported as skipped** | Builds a random database with owner, runtime, stranger and BYPASSRLS logins; migrates as the non-superuser owner. (1) Member login starts; 8 concurrent queries on several backends all run as `nile_app` with `session_user` = the login; `RESET ROLE` stays `nile_app`. (2) Owner as runtime login refused, both as a non-member (42501) and as a member ("owns tables"). (3) Non-member refused with a clear error that has no `cause` and does not contain the password. (4) Superuser refused. (5) BYPASSRLS member refused, and no connection of that login stays open. (6) `options=` override refused. (7) Zero unhandled rejections across the file. Drops its database and roles afterwards |

### Results (2026-10-14, Node 20.20.2, pg 8.23.1, PostgreSQL 18.4 embedded, local)

| Command | Result |
| --- | --- |
| Same new tests against the **unmodified** `open.ts` | 7 failed, 1 passed (the "runs as nile_app" case) |
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run` (no PG env) | 10 files passed, 1 skipped; **93 passed, 7 skipped** (91 existing + 2 new) |
| `NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres npx vitest run` | 11 files; **100/100** |
| Mutation check (isolated copy; each mutant must fail a test) | 6/6 caught: no exact-role check; no login-owner check; no login-privilege check; old `SET ROLE` on `connect`; raw error attached as `cause`; pool not closed on failure |
| Real API (`apps/api/src/main.ts`) on real PostgreSQL, owner and runtime logins separate | `api:smoke` 5/5: login, tenant/role, catalog, sale HTTP 201, receipt read back; the server's only session is the runtime login |
| Real API with the owner as `DATABASE_URL` | exits 1 with `UnsafeRuntimeRoleError: runtime login cannot assume the runtime role "nile_app" (42501 …)`; no unhandled rejection |

Not verified: behaviour behind a connection pooler (PgBouncer and similar) and on managed PostgreSQL
services. The design fails closed there, but this was not run. There is no CI on the repository.

## 4. Out of scope (recorded in `docs/STATUS.md` as N-1)

The runtime pool has no `error` listener: when PostgreSQL terminates an idle pooled connection, Node
raises an unhandled `error` event and the process exits. Pre-existing and separate; proposed as the next
unblocked task.

## 5. How to apply (choose one)

**A. Bundle (recommended).**

```bash
git fetch origin                                              # origin/main must be ebcfe72
git bundle verify g7-runtime-role-assertion.bundle
git fetch g7-runtime-role-assertion.bundle fix/g7-runtime-role-assertion:fix/g7-runtime-role-assertion
git rev-parse fix/g7-runtime-role-assertion                   # expect 420c203da55bc703f5f07c4f8707630e8425b136
git push origin fix/g7-runtime-role-assertion                 # then open a PR into main with this text
```

**B. Patch.** `git checkout -b fix/g7-runtime-role-assertion origin/main && git am --keep-cr g7-patches/*.patch`

Both paths were verified on a fresh clone of `main`: same tree as `420c203`.

Do not merge without the owner's authorisation and, if possible, a reviewer other than the author.
