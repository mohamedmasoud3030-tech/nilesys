# Supabase as Nile's free-tier PostgreSQL host, under G-7: feasibility review

- **Date:** 2026-10-14
- **Status:** PROPOSED (evaluation only; tier 5 in `AGENTS.md`, not a decision). Hosting is **D5, UNRESOLVED** in `docs/STATUS.md`.
- **Repository state assessed:** `main` `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8`; PR #4 `784e50cb085f6d7d23c018cc5e9183746ff8109b` (open, 0 reviews);
  G-7 candidate `60342be628151ffebe23919ea69409e4b63eda99` (branch `investigation/g7-runtime-role-boundary-incomplete`).
- **Independence:** written by the same agent that wrote the G-7 candidate; not an independent review.
- **What was not done:** no Supabase project, database, branch or paid resource was created; no existing project was
  touched; no repository code or migration was changed. Every database test ran on throwaway local clusters that
  were deleted afterwards.
- **Evidence:** [`tools/spikes/supabase-feasibility/`](../../tools/spikes/supabase-feasibility/README.md) (raw outputs, probes, checksums) and
  [`tools/spikes/g7-runtime-role/`](../../tools/spikes/g7-runtime-role/README.md) (adversarial review evidence).

Labels: **VERIFIED** (reproduced or read in source; evidence linked), **DOCS** (vendor documentation, not executed),
**PASS / FAIL** (a test that ran), **NOT VERIFIED** (not checked), **NOT RUN**.

## Verdict

Supabase is **conditionally viable but not yet the simplest viable host**. Do not choose it without one approved test
on a disposable project (§6). Independently of the host, the G-7 candidate is **not a fix** (REVISE): in the
adversarial matrix its startup check accepted 17 of 18 escalation vectors on PostgreSQL 17.10 and 18.4.

Conditions if Supabase is chosen later: PostgreSQL 17; Data API exposure off (or `public` not exposed); `nile_app`
created by the `postgres` role; either a direct connection or the server-side role setting (S3); scheduled external
backups; G-7 redesigned and independently reviewed first.

## 1. Supavisor and PostgreSQL version

| # | Finding | Label |
| --- | --- | --- |
| S1 | Supavisor (`supabase/supavisor` @ `5df5caf`) accepts the client startup option `-c role=nile_app` but forwards only `search_path` upstream, in session and transaction mode. Line references and blob SHAs: [`supavisor-source-provenance.md`](../../tools/spikes/supabase-feasibility/supavisor-source-provenance.md) | VERIFIED (source); deployed version NOT VERIFIED |
| S2 | Through the free IPv4 pooler, G-7's role switch therefore never applies: the session runs as the login and `assertRuntimeRole` refuses it. The app fails closed and does not start | VERIFIED (source + local E7 PASS) |
| S3 | Workaround: `ALTER ROLE <login> IN DATABASE <db> SET role nile_app`. A non-superuser owner can set it (E8 PASS on 15/17/18). If the membership is missing, PostgreSQL connects anyway with a notice (fails open); G-7's assertion then refuses (E9 PASS). Not a security boundary: `SET ROLE NONE` still returns to the login (design review §6) | PASS locally; hosted NOT VERIFIED; it is a database setting and needs owner approval |
| S4 | A direct connection keeps the startup option, but on the free plan it is IPv6-only; IPv4 is a paid add-on | DOCS |
| S5 | Hosted Supabase runs PostgreSQL 15.19 or 17.11 (changelog, from 2026-09-28); no PostgreSQL 18 (supabase/postgres issue #2392). Nile's earlier evidence is on 18.4 | DOCS |
| S6 | In transaction mode, pooled server connections are shared between clients of the same user; whether Supavisor resets session state between clients | NOT VERIFIED |

Sources (DOCS): supabase.com/docs/guides/database/connecting-to-postgres; /guides/database/postgres/roles;
/guides/database/postgres/roles-superuser; /guides/api/securing-your-api; /guides/platform/backups;
/guides/platform/upgrading; supabase.com/pricing; supabase.com/changelog/postgres-15-19-17-11-breaking-changes;
github.com/orgs/supabase/discussions/45329; github.com/supabase/supautils.

## 2. Compatibility with G-7 and the free tier

| # | Finding | Label |
| --- | --- | --- |
| C1 | A non-superuser CREATEROLE owner (like Supabase's `postgres`) can create `nile_app` and the runtime login, grant the membership, apply migrations 0000–0002 and re-run them safely (E1–E3). Emulation only: Supabase's supautils layer is not reproduced | PASS on 15.18 / 17.10 / 18.4 |
| C2 | E0: on PostgreSQL 16+, the owner can grant `nile_app` only if it created the role itself. If another role (dashboard, platform) creates it first, setup fails with `42501 permission denied to grant role`. **`nile_app` must be created by `postgres`** | VERIFIED (17.10, 18.4); on 15.18 the grant works |
| C3 | E12: on 17 the creating owner keeps an implicit membership in `nile_app` with ADMIN (INHERIT FALSE, SET FALSE). A closed-world allow-list (design review option B) must account for it | VERIFIED (17.10, 18.4) |
| C4 | E11: on 15 a non-superuser CREATEROLE owner **can** grant `pg_read_server_files` (the P1–P3 family); on 17 it cannot. Prefer 17. Whether Supabase's 15 allows it | VERIFIED locally; hosted NOT VERIFIED |
| C5 | E6: with Supabase's **legacy** default privileges, `anon` gets SELECT on all 21 Nile tables including `account` (password hashes), and `anon` read the `user` table (Better Auth tables have no RLS). With the **new** default (no automatic exposure; new projects since 2026-05-30, all projects from 2026-10-30, existing tables keep their grants) it passes | FAIL (legacy) / PASS (new default). CRITICAL if the Data API is on with legacy grants |
| C6 | Platform roles that bypass RLS (`service_role`, `postgres`), the 14 `tenant_isolation` policies written `TO public` (they also apply to `anon`), and supautils powers that are invisible in the catalogs | DOCS; behaviour NOT VERIFIED |
| C7 | ADR-0005 rejects Supabase only as an **auth** provider; using Supabase purely as a PostgreSQL host does not conflict | VERIFIED (ADR text) |
| C8 | The real-PostgreSQL G-7 test suite needs a superuser admin, so it cannot run on hosted Supabase as written | VERIFIED (test code) |
| C9 | Free plan: 500 MB database, 2 projects, paused after 1 week of inactivity, no backups (use `pg_dump`/`supabase db dump`), IPv6-only direct connection, PITR paid | DOCS |
| C10 | Portability is good: plain SQL migrations, no Supabase-specific features. On restore, custom-role passwords are not kept; md5 roles must be re-passworded after upgrades | DOCS |
| C11 | Neon (not tested here) may be simpler on connectivity: IPv4 unpooled endpoint, PostgreSQL 14–18; its PgBouncer pooler rejects `options`, so G-7 would use the unpooled endpoint there too | DOCS only |

## 3. Test results

Commands (each per version; port differs). Full script: [`probes/run-version.sh`](../../tools/spikes/supabase-feasibility/probes/run-version.sh).

```
initdb -D <data> -U postgres --auth=trust -E UTF8
pg_ctl -D <data> -o "-p <port> -k /tmp/supa-eval -c listen_addresses=127.0.0.1" -w start
npx tsx .probe/supa-emul.mts                     # in the merged tree (60342be + PR #4 staged), fresh cluster, first
NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres NODE_OPTIONS=--max-old-space-size=1024 \
  npx vitest run --reporter=json --outputFile=...  # in the G-7 tree, then in the merged tree
npx tsx .probe/matrix.mts                        # G-7 tree; adversarial matrix, port from PGPORT_TEST
pg_ctl -D <data> -m fast -w stop && rm -rf <data>
npx tsc ; npx vitest run                         # once per tree, no database
```

Trees: G-7 = fresh clone detached at `60342be`; merged = clone at `60342be` with `git merge --no-commit --no-ff 784e50c`
staged (0 conflicts). Binaries: `@embedded-postgres/linux-x64` 15.18, 17.10, 18.4. Node 20.20.2, pg 8.23.1.

| Check | PG 15.18 | PG 17.10 | PG 18.4 |
| --- | --- | --- | --- |
| `tsc`, G-7 / merged | exit 0 / 0 | same | same |
| `vitest` without a database, G-7 / merged | 97 passed + 14 skipped / 101 + 14 skipped | same | same |
| G-7 tree on a real database | run 1: Vitest wrote an incomplete report (exit 1, 0 failures, 3 PGlite-only tests unfinished; preserved as `*.run1-incomplete.*`); **rerun 111/111** | 111/111 | 111/111 |
| Merged tree on a real database | 115/115 | 115/115 | 115/115 |
| `runtime-role.pg.test.ts` | 14/14 | 14/14 | 14/14 |
| Emulation E1–E5, E7–E9 | PASS | PASS | PASS |
| E6 legacy / new default | FAIL / PASS | FAIL / PASS | FAIL / PASS |
| Adversarial matrix: vectors accepted by the startup check | 15 (M1/M2 do not exist on 15) | 17 of 18 | 17 of 18 |

The PG 17 emulation **first run is preserved unedited** in `artifacts/pg17-run1-nile_app-preexisting/`. It failed
E1–E3, E5 and E8 only because the vitest runs had already created `nile_app` as superuser in the same cluster, which
is exactly the E0 requirement (C2). The run order was then fixed (emulation first, on a fresh cluster) and rerun.

Minimum checks:

| Check | Result |
| --- | --- |
| The correct login becomes `nile_app` | PASS |
| A login that cannot assume the role fails closed | PASS |
| Superuser, BYPASSRLS and owner logins are rejected | PASS |
| Logins with excess memberships are rejected | **FAIL**: only `pg_read_all_data` is refused; P1–P4, M1/M2, R1–R3, G1, C1, C2, S1, F1, F2, T1, U1 are accepted, and 15 of them were usable after `SET ROLE NONE` (P1 ran an OS command, P2 wrote a server file) |
| Adversarial escalations are covered by tests | **FAIL** |
| Ledger append-only (with PR #4) | PASS (10/10 UPDATE/DELETE denied, INSERT kept) |
| Migrations run, reruns are safe | PASS |
| Tests do not depend on privileges Supabase lacks | **FAIL** for the test harness (superuser admin); PASS for the app's runtime path |

## 4. Unresolved blockers

1. G-7 must be redesigned (any host): [`2026-10-14-g7-redesign-design-review.md`](2026-10-14-g7-redesign-design-review.md), PROPOSED.
2. Hosted behaviour is unverified: deployed Supavisor, supautils, platform catalog, whether `postgres` can grant the
   server-file roles, IPv6 reachability from the eventual app host.
3. Data API exposure (C5).
4. The real-PostgreSQL test harness has no non-superuser mode (C8).

## 5. Owner decisions

1. D5 hosting stays open until §6 runs.
2. Approve or reject the G-7 redesign.
3. A hosted test needs connection details. Agents must not ask for credentials; the owner runs the probe, or chooses
   another mechanism.

## 6. Proposed hosted test (needs owner approval; disposable project only)

Create one **new** free Supabase project on PostgreSQL 17 with Data API exposure off. Never use an existing project.
Then, read-only where possible:

| # | Check |
| --- | --- |
| H1 | Attributes of `postgres` (`rolsuper`, `rolcreaterole`, `rolbypassrls`) and visible supautils settings |
| H2 | As `postgres`: create `nile_app` and a runtime login, grant membership; record `pg_auth_members` (C2, C3) |
| H3 | Connect with `-c role=nile_app` directly (needs IPv6) and through Supavisor session mode (expect S2); then set S3 and reconnect |
| H4 | Transaction mode: state reset between clients (S6) |
| H5 | Migrations 0000–0002 as `postgres`, then rerun |
| H6 | Grants of `anon`/`authenticated` on Nile tables (C5) |
| H7 | Catalog inventory for the closed-world allow-list: roles, memberships, extensions, event triggers, default ACLs |
| H8 | Can `postgres` grant `pg_execute_server_program` / `pg_read_server_files` to the login (C4) |
| H9 | `pg_dump` and restore into a local cluster; role passwords |

Delete the project afterwards (owner action).
