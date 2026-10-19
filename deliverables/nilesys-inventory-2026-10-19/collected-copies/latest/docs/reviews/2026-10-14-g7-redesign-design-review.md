> **Publication note (2026-10-14):** published verbatim from the agent's local handoff folder with this note
> added on top. Status unchanged: **PROPOSED**, and the decision on `60342be` is still **REVISE**. The
> candidate is published only for reference, on branch `investigation/g7-runtime-role-boundary-incomplete`
> (same commit as the local `fix/g7-runtime-role-assertion`). The local evidence paths below map to this repository as:
> `/home/user/work/evidence/g7-adversarial-60342be-2026-10-14/` → `tools/spikes/g7-runtime-role/artifacts/adversarial-60342be/`.
> Results on PostgreSQL 15.18 and 17.10 were added later in
> [`2026-10-14-supabase-feasibility.md`](2026-10-14-supabase-feasibility.md) §3.

# G-7 runtime-role security: redesign review (DESIGN ONLY)

- **Date:** 2026-10-14
- **Repository:** `mohamedmasoud3030-tech/Mohamed-App-Factory`
- **Subject:** G-7 candidate `60342be628151ffebe23919ea69409e4b63eda99` (tree `ac97e27b6ecdd0afdcb5ffba55a04f115359d387`, parent `420c203`, base `main` `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8`). It is **LOCAL ONLY**: branch `fix/g7-runtime-role-assertion` has not been pushed and has no PR.
- **Status of this document:** PROPOSED. It is not an ADR and not accepted. **Current decision on `60342be`: REVISE.** Do not approve, publish or merge it as-is.
- **Scope kept separate:** PR #4 (`784e50c`, open) and docs branch `docs/source-of-truth-cleanup` (`84d8044`, local only) are untouched. The C3/M3 tests below do **not** depend on PR #4.
- **Independence limitation:** the author of this review also authored `420c203`/`60342be`, so it is **not independent**. Independent review is an approval condition (§9).
- **Evidence (preserved, outside any git repo):** `/home/user/work/evidence/g7-adversarial-60342be-2026-10-14/` with `MANIFEST.sha256`:
  - `review60b/`: fresh clone at `60342be`; probe scripts and raw outputs.
  - `review60m/`: throwaway merge `60342be` + PR #4 → `bed6d4e`; C3/M3 probe.
  - `design-catalog-facts/`: catalog-coverage and impact probes run for this review on a **separate throwaway** PostgreSQL 18.4 cluster (port 5434, since deleted).
- **What did not change:** no repository file, commit, ref, remote, or setting on the existing test server (port 5433). Repo heads after the work: factory `ebcfe72`, g7 `60342be`, cleanup `84d8044`, all with 0 tracked changes.

Labels used:
- **VERIFIED:** reproduced; the raw output is in the evidence directory.
- **DOCS:** from PostgreSQL or vendor documentation, not executed here.
- **INFERENCE:** reasoning, not executed.
- **UNVERIFIED:** not checked.

---

## 1. Summary

1. **The existing check is the wrong shape.** It compares a hand-picked list of privilege types (table privileges, schema CREATE, database CREATE) against `nile_app`, plus superuser/BYPASSRLS and three kinds of ownership.
   - PostgreSQL authority also comes from role attributes, role memberships (including predefined roles), ownership of any object class, ACLs on about 12 object classes (including columns and parameters), per-role settings, and `PUBLIC`.
   - A comparison list will always lag behind, and new versions add more: MAINTAIN in PG 17, `pg_signal_autovacuum_worker` in PG 18.
   - It never bounds `nile_app` itself (V17).
2. **Recommended architecture: an empty login plus a bounded `nile_app`.** This is a closed-world allow-list:
   - The runtime login may hold **nothing** except membership in `nile_app`.
   - `nile_app` may hold **nothing** except the object privileges in a committed, migration-derived manifest.
   - Both are checked structurally from catalogs, and startup fails closed.
   - The property "after `SET ROLE NONE` the login gains nothing `nile_app` lacks" then follows by construction instead of by enumeration. The residuals are `PUBLIC` grants and the abilities every login has over its own identity (§5).
3. **`pg_shdepend` is necessary but not sufficient.**
   - VERIFIED on PG 18.4: it records ownership, ACL and policy references for every object class tested, across every database in the cluster.
   - It does **not** record role memberships (including predefined roles), role attributes, per-role settings, grants to `PUBLIC`, or implicit `pg_database_owner` membership. Those need other catalogs (§4).
4. **`ALTER ROLE <login> IN DATABASE <db> SET role = nile_app` is a valid pooler mode, not a security boundary.** VERIFIED:
   - `SET ROLE NONE` still returns to the login.
   - A client startup option overrides it.
   - If the membership is missing or granted `WITH SET FALSE`, the session **silently continues as the login** with only a WARNING. This fails open; the startup-option path fails closed.
   - It is acceptable only together with the empty-login invariant and a per-connection identity check (§6).
5. **The honest claim (§8) can be strong but has limits.** It covers only the state at the time of the check, on the PostgreSQL majors exercised in CI. It excludes `PUBLIC` grants, provider-internal privileges, `pg_hba`/network, and the session-identity residuals.

---

## 2. Re-inspection of the reported evidence

I re-read `engines/db/open.ts` at `60342be` and every probe script and raw output. For each role reachable through `pg_has_role(subject, x, 'MEMBER')`, `assertRuntimeRole` computes:
- `privileged`: `rolsuper OR rolbypassrls`;
- `owns`: the current database, a schema, or a relation in a non-system schema;
- `extra`: one of SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on such a relation, schema CREATE, or database CREATE, held by the reachable role but not by `current_user`.

**Never inspected:**
- column, sequence, function, type, language, large-object, FDW, server, tablespace and parameter ACLs;
- MAINTAIN;
- CREATEROLE, CREATEDB, REPLICATION;
- ownership of functions, types, default ACLs, policies and large objects;
- per-role settings;
- `nile_app`'s own memberships and attributes.

Vector IDs are as printed in the raw output. **R1–R3 here are role-attribute vectors, unrelated to review-4 findings R1–R5.** "Control" means the same attack run by a plain member login without the extra capability.

| ID | Accepted capability | Reproduced? | What the evidence actually shows | Corrected severity / notes |
|---|---|---|---|---|
| V17 | `nile_app` itself in `pg_execute_server_program` | VERIFIED | Startup accepted; `COPY … TO PROGRAM` ran **as `nile_app`** with no role switch; marker file created | **HIGH.** The baseline role is never validated. |
| P1 | Login in `pg_execute_server_program` | VERIFIED | Accepted; OS command ran after `SET ROLE NONE` (marker true); control denied | **HIGH** |
| P2 | Login in `pg_write_server_files` | VERIFIED | Accepted; server file written; control denied | **HIGH** |
| P3 | Login in `pg_read_server_files` | VERIFIED | Accepted; `COPY … FROM '/etc/passwd'` succeeded; control denied | **HIGH** |
| C2 | Column `SELECT(password)` on `account` | VERIFIED, **with correction** | The probe first ran **`REVOKE SELECT ON "account" FROM nile_app`**. In the shipped schema `nile_app` already reads `account` (no RLS policy; only DELETE is revoked). No hash content was returned or printed, only "SUCCEEDED". | **Correction:** not an escalation in the shipped schema. It proves the check cannot see column ACLs: a MEDIUM coverage gap. The earlier "read password hashes, HIGH" overstated it. See O-1. |
| C1 | Column `UPDATE(hash)` on `drizzle.__drizzle_migrations` (+ schema USAGE) | VERIFIED | Accepted; UPDATE succeeded; control denied | MEDIUM: migration-history tampering |
| C3 | With PR #4: column `UPDATE(action)` on `audit_log` | VERIFIED (privilege check); VERIFIED (row rewrite, generic schema) | On Nile + PR #4 (`bed6d4e`): privilege check passed, UPDATE 0 (no tenant set). On a generic schema with Nile's pattern (FORCE RLS, `TO public` tenant policy, UPDATE revoked from `nile_app`): **UPDATE 2 once `app.tenant_id` was set**; both controls denied (`design-catalog-facts/out-impact.txt`) | **MEDIUM–HIGH:** defeats append-only for any tenant the attacker names. Row rewrite on Nile's own schema was not executed. |
| S1 | Sequence UPDATE (drizzle) | VERIFIED | `setval` returned 999999; control denied | LOW |
| F1 | EXECUTE on a SECURITY DEFINER function revoked from PUBLIC | VERIFIED (synthetic) | `purge_users` was **created by the probe**; Nile's migrations define no functions at all | Coverage gap; MEDIUM as a class, real impact depends on future functions |
| F2 | Login owns a function | VERIFIED: **not exploitable here** | Accepted, but `CREATE OR REPLACE` was denied (no CREATE on `public`) | Coverage gap; LOW |
| T1 | Login owns a type | VERIFIED, **with caveat** | Accepted; `ALTER TYPE … ADD VALUE` succeeded. **The control is invalid**: it failed with "type does not exist", not a permission error. The type is probe-created and unused by Nile. | Coverage gap; LOW |
| M1 / M2 | MAINTAIN on `audit_log` / `pg_maintain` | VERIFIED | `REINDEX` succeeded; controls denied | LOW–MEDIUM: availability. MAINTAIN also allows VACUUM/ANALYZE/CLUSTER/LOCK (DOCS). |
| M3 | With PR #4: MAINTAIN on `audit_log` | VERIFIED | `LOCK … ACCESS EXCLUSIVE` succeeded; control denied | LOW–MEDIUM: ledger DoS |
| P4 | `pg_signal_backend` | VERIFIED | Terminated the migration owner's session; control denied | LOW–MEDIUM |
| P5 | `pg_read_all_data` | VERIFIED: refused | Refused only **because** `drizzle` tables exist that `nile_app` cannot read | Correct but incidental. INFERENCE: if `nile_app` could read every table, it would be accepted. |
| R1 | CREATEROLE | VERIFIED | `CREATE ROLE` succeeded | MEDIUM on PG ≥16. On PG ≤15, CREATEROLE can grant any non-superuser role (e.g. `pg_execute_server_program`), so effectively HIGH (DOCS). |
| R2 | CREATEDB | VERIFIED | `CREATE DATABASE` succeeded; control denied | LOW |
| R3 | REPLICATION | VERIFIED | Physical replication slot created | MEDIUM. Slots retain WAL until the disk fills; the replication protocol can read the whole cluster (DOCS). |
| G1 | `SET` on `session_replication_role` | VERIFIED | Accepted; `SET … = replica` succeeded. **New (generic schema):** `SET ROLE NONE` → `replica` → `SET ROLE nile_app` → **inserted a row that violates a foreign key**; control error 23503 | MEDIUM: disables FK enforcement and ordinary triggers |
| U1 | Schema USAGE only | VERIFIED | Denied | none |
| X1 | TEMP | VERIFIED | Allowed through the `PUBLIC` default | Residual by design (§5) |

**Precondition for every vector:** something already granted the extra capability, through operator error, a provider console default, a later admin change, or a compromised admin account. G-7 guards against that misconfiguration turning an application compromise into a database, host or ledger compromise. It is not a defense against a malicious superuser.

**Observation O-1 (outside G-7; needs its own decision):** `nile_app` can SELECT every row of `account`, including password hashes, for all tenants. This may be required by Better Auth's global user model. It is recorded here only so the manifest review (N5) makes it a conscious decision.

**Original G-7 behavior, re-verified at `60342be`:**
- Results:
  - typecheck exit 0;
  - default suite 97 passed / 0 failed / 14 skipped (the real-PG file);
  - with `NILE_TEST_PG_ADMIN_URL`, 111/111 passed (VERIFIED, `review60b/out-vitest-*.json`).
- Behaviors covered:
  - the effective role is `nile_app`;
  - a non-member login fails with `UnsafeRuntimeRoleError`, not an unhandled rejection;
  - superuser, BYPASSRLS and owner logins are refused;
  - `RESET ROLE` stays `nile_app`.
- Mutation checks (14/14) date from the previous task and were **not** re-run in this one.

---

## 3. Recommended architecture

### 3.1 Options considered

| Option | Description | Verdict |
|---|---|---|
| A. Compare capabilities (current) | Enumerate privilege kinds; refuse if the login can reach one that `nile_app` lacks | **Reject.** Open-ended, version-fragile, blind to attributes, predefined roles, parameters and most object classes; never bounds `nile_app`. |
| **B. Empty login + bounded `nile_app`** | Closed-world allow-list for both roles (§3.2). Keeps NOLOGIN `nile_app` plus dedicated login(s), as in ADR-0005 §7 and migration `0001`. | **Recommended.** Fits the current migration-owner/runtime-login model; allows zero-downtime credential rotation (`login_v2` next to `login_v1`); matches Neon/RDS guidance to create app logins by SQL (§7). |
| C. `nile_app` is itself the LOGIN | No separate login, so `SET ROLE NONE` is a no-op | Acceptable alternative, but it changes ADR-0005 §7 and migration `0001`, and one password per role means a rotation window. It still needs every N-invariant below. Owner decision if preferred. |

### 3.2 Invariants for option B

The check runs as `nile_app`. VERIFIED readable by `nile_app`:
- `pg_roles`, `pg_auth_members`, `pg_shdepend`, `pg_db_role_setting`, `pg_parameter_acl`;
- `pg_default_acl`, `pg_largeobject_metadata`, `pg_init_privs`, `pg_policy`;
- `pg_database`, `pg_tablespace`, `pg_foreign_server`, `pg_publication`, `pg_user_mappings`.

VERIFIED **not** readable: `pg_authid`, `pg_user_mapping`, `pg_hba_file_rules`.

**L: runtime login (`session_user`)**

| # | Invariant | Catalog / check |
|---|---|---|
| L1 | `rolcanlogin` true; `rolsuper`, `rolbypassrls`, `rolcreaterole`, `rolcreatedb`, `rolreplication` all false | `pg_roles` |
| L2 | Direct memberships are exactly one row: `roleid = nile_app`, `admin_option = false`, `set_option = true` (PG16+). `inherit_option` may be either. With N2, the transitive closure is exactly `{nile_app}`. | `pg_auth_members`. Covers predefined roles, provider roles (`neon_superuser`, `rds_superuser`, …), and indirect, SET-only and INHERIT-only memberships. |
| L3+L4 | **Zero `pg_shdepend` rows of any deptype referencing the login, in any `dbid`**: owns nothing; named in no ACL, default ACL, policy or init-privs entry anywhere in the cluster | `pg_shdepend` (shared catalog). VERIFIED rows appear for: ownership of a database (dbid 0, which also implies implicit `pg_database_owner`), schema, table, sequence, function, type, large object, publication, user mapping and default-ACL; ACLs on table, **column** (`objsubid` = attnum), **MAINTAIN**, sequence, function (including a `pg_catalog` function), type, schema, database (0), tablespace (0), **parameter** (`pg_parameter_acl`, 0), default-ACL grantee, large object, language, FDW and server; **policies** (`r`); objects in another database (dbid = that database). |
| L5 | No per-role settings, except optionally exactly `role=nile_app` scoped to the app database (pooler mode, §6) | `pg_db_role_setting` (`setrole` = login; `setdatabase` = current or 0) |
| L6 | Identity on **every** pooled connection: `current_user = 'nile_app'`, `session_user` = the configured login, `current_setting('is_superuser') = 'off'` | Per-connection query; mechanism chosen at implementation, must fail closed |

**N: runtime role `nile_app`**

| # | Invariant | Catalog / check |
|---|---|---|
| N1 | `rolcanlogin` false; the same five attributes false | `pg_roles` |
| N2 | **Member of nothing**: zero rows with `member = nile_app` | `pg_auth_members`; closes V17 and provider auto-grants |
| N3 | Owns nothing in any database | `pg_shdepend` deptype `o`, any dbid |
| N4 | Named in no policy (Nile's policies are `TO public`), no parameter ACL, no ACL in another database, and no per-role setting | `pg_shdepend` deptype `r`; deptype `a` with `classid = pg_parameter_acl` or `dbid ≠ current`; `pg_db_role_setting` |
| N5 | **Exact ACL manifest:** the multiset of (object identity, column, privilege, grant option) granted to `nile_app` in the current database equals a committed manifest, including the expected `pg_default_acl` entry from `0001` (`ALTER DEFAULT PRIVILEGES … TO nile_app`) | `pg_shdepend` deptype `a` (dbid = current) to locate objects; `aclexplode()` on `pg_class.relacl`, `pg_attribute.attacl`, `pg_proc.proacl`, `pg_type.typacl`, `pg_namespace.nspacl`, `pg_default_acl.defaclacl`, `pg_largeobject_metadata.lomacl`, `pg_language.lanacl`, `pg_foreign_*`, `pg_database.datacl`; `pg_identify_object()` for stable identities |

The manifest is generated by a real-PG CI test (apply all migrations to an empty database, dump `nile_app`'s ACL entries) and compared with the committed file. Any migration that changes grants must update the manifest in the same PR, so grant changes become a visible, reviewable diff. PR #4's `REVOKE UPDATE, DELETE` lines would appear in that diff.

**E: environment and `PUBLIC`.** These cannot be bounded per role, because `PUBLIC` applies to every role, `nile_app` included.

| # | Invariant | Check |
|---|---|---|
| E1 | `session_replication_role = origin` and `row_security = on` in the session as established | `current_setting()` |
| E2 | No parameter ACL grants `SET` or `ALTER SYSTEM` to `PUBLIC` | `aclexplode(pg_parameter_acl.paracl)` grantee 0 |
| E3 | `PUBLIC` holds no CREATE on any schema in the app database, and no CREATE on the database | `aclexplode` on `nspacl` / `datacl`, grantee 0 (the PG15+ defaults pass) |
| E4 | No SECURITY DEFINER function outside `pg_catalog`/`information_schema` is executable by `nile_app` (directly or via `PUBLIC`), unless it is on an explicit allow-list (empty today) | `pg_proc.prosecdef` + `has_function_privilege('nile_app', oid, 'EXECUTE')` |
| E5 | Installed extensions are on an allow-list (`plpgsql` today; Nile's migrations create none) | `pg_extension` |
| E6 | `lo_compat_privileges = off` | `current_setting()` |

**Placement:** L1–L5, N1–N5 and E1–E6 run once at startup inside `openPostgres` and fail closed with structured error codes (e.g. `G7_LOGIN_MEMBERSHIP`, `G7_ROLE_ACL_DRIFT`), never by message text alone. L6 runs on every new physical connection. The PGlite path keeps its current `current_user = nile_app` assertion; its built-in superuser is a test fixture.

Error objects must never carry `pg` clients or connection parameters, because of the N-1 finding: crash dumps and vitest serialization can expose the password.

---

## 4. Privilege-coverage matrix and blind spots

| Category | Where it lives | Recorded in `pg_shdepend`? (VERIFIED, 18.4) | Effective-privilege cross-check (used in tests) | Invariant |
|---|---|---|---|---|
| Superuser, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION, LOGIN | `pg_roles` | **No** | attempt the action | L1, N1 |
| Direct / indirect / SET-only / INHERIT-only membership; ADMIN option | `pg_auth_members` (`admin_option`, `inherit_option`, `set_option`) | **No** | `pg_has_role(r, x, 'MEMBER' / 'USAGE' / 'SET')` | L2, N2 |
| Predefined roles (16 on 18.4: `pg_checkpoint`, `pg_create_subscription`, `pg_database_owner`, `pg_execute_server_program`, `pg_maintain`, `pg_monitor`, `pg_read_all_data`, `pg_read_all_settings`, `pg_read_all_stats`, `pg_read_server_files`, `pg_signal_autovacuum_worker`, `pg_signal_backend`, `pg_stat_scan_tables`, `pg_use_reserved_connections`, `pg_write_all_data`, `pg_write_server_files`) | `pg_auth_members` | **No** | attempt (COPY PROGRAM / file / terminate / REINDEX) | L2, N2 (closed-world, so future predefined roles are covered) |
| Implicit `pg_database_owner` | `pg_database.datdba` | Yes, via database ownership (`o`, dbid 0) | `pg_has_role(r, 'pg_database_owner', 'MEMBER')` (VERIFIED true with 0 `pg_auth_members` rows) | L3/L4, N3 |
| Ownership: database, schema, table, sequence, function, type, large object, publication, user mapping, default ACL | each object's owner column | Yes (`o`) | attempt ALTER/DROP | L3/L4, N3 |
| Object ACLs: table, MAINTAIN, sequence, function (including `pg_catalog`), type, schema, language, FDW, server, large object | object ACL columns | Yes (`a`) | `has_table/sequence/function/type/schema/language/foreign_data_wrapper/server/largeobject_privilege` (all present on 18.4) | L4, N5 |
| **Column ACLs** | `pg_attribute.attacl` | Yes (`a`, `objsubid` = column number) | `has_column_privilege`, `has_any_column_privilege` | L4, N5 |
| Database and tablespace ACLs | `pg_database.datacl`, `pg_tablespace.spcacl` | Yes (`a`, dbid 0) | `has_database_privilege`, `has_tablespace_privilege` | L4, N4/N5 |
| **Parameter privileges** (SET / ALTER SYSTEM) | `pg_parameter_acl` (shared) | Yes (`a`, dbid 0) for named roles; **No** for `PUBLIC` | `has_parameter_privilege` | L4, N4, E2 |
| Default privileges | `pg_default_acl` | Yes: grantee `a`, `defaclrole` `o` | none (future objects) | L4, N5 |
| RLS policies naming a role | `pg_policy.polroles` | Yes (`r`) | n/a | L4, N4 |
| Objects in **other databases** | their own catalogs | Yes (rows with that dbid; only the object class is resolvable) | not inspectable from here | L4 ("zero rows"), N3/N4 |
| Per-role / per-database settings | `pg_db_role_setting` | **No** | `current_setting()` | L5, N4, E1 |
| **`PUBLIC` grants** (TEMP, CONNECT, EXECUTE on functions, USAGE on languages/types/`public` schema) | ACL entries with grantee 0 | **No** (VERIFIED: 0 rows added) | `aclexplode` grantee 0 | E2–E5; otherwise residual (§5) |
| SECURITY DEFINER functions | `pg_proc.prosecdef` | Only if granted to a named role | `has_function_privilege` | E4 |
| Extensions | `pg_extension` | n/a | n/a | E5 |

**Blind spots that remain after B:**
1. **Time of check vs time of use.** Grants made after startup are invisible until the next check; new memberships apply to existing sessions immediately (DOCS). Mitigation: re-run the check periodically and report it through readiness. This is residual, not closed.
2. **Provider code outside the catalogs.** Managed services can patch privilege checks (hooks, extensions such as RDS `rds_superuser` logic or Supabase `supautils`). UNVERIFIED for any provider.
3. **`PUBLIC` grants in other databases.** The login can CONNECT to every database that grants CONNECT to `PUBLIC` (VERIFIED on a default cluster: `postgres`, `template1`, the app database and others). Their contents are not inspectable from the app database. Mitigation (runbook): `REVOKE CONNECT ON DATABASE … FROM PUBLIC` for other databases. The startup check can at least list them via `has_database_privilege(session_user, d, 'CONNECT')`.
4. **Authentication and network** (`pg_hba`, TLS, password policy): `pg_hba_file_rules` is not readable (VERIFIED).
5. **Correctness of the manifest itself.** N5 proves `nile_app` has exactly what was reviewed, not that what was reviewed is right (see O-1).
6. **PostgreSQL versions not in CI.** Catalog columns differ: `set_option`/`inherit_option` exist from PG16; MAINTAIN from PG17. Coverage is claimed only for majors actually tested.

---

## 5. Empty login vs comparison: evaluation

**The empty login is the safer and more maintainable invariant.**
- **Closed world.** Anything not explicitly allowed is refused, including mechanisms added in future PostgreSQL versions, as long as they are expressed as memberships, attributes, ownership or ACLs. That is how PG 17 MAINTAIN, PG 18 `pg_signal_autovacuum_worker` and provider roles appear.
- **Few, stable sources.** Five catalogs and one rule (zero `pg_shdepend` rows) replace a growing per-privilege list.
- **Bounds `nile_app` too.** The comparison approach cannot express "`nile_app` must not be a member of `pg_execute_server_program`" (V17).
- **Explainable failures.** "Login has membership X" or "login is named in an ACL on Y" is actionable for an operator.
- **Cost.** It refuses some harmless configurations (for example a login with a stray grant on an unused table), and console-created managed logins. This is intentional: the fix is to create the login by SQL.

**Residuals even with the empty login.** These are not escalations beyond `nile_app` unless noted:

| Residual | Status |
|---|---|
| After `SET ROLE NONE`, the login can terminate or cancel **other sessions of the same login** (its own app pool); as `nile_app` it cannot | VERIFIED. Availability only; inherent to PostgreSQL. |
| A login can change **its own password** and **its own session defaults** (`ALTER ROLE <self> SET …`), for example removing pooler-mode `role=nile_app` | DOCS, not executed. Effect: persistence or DoS. L5 detects it at the next startup (fail closed = outage, not escalation). Needs a test (T-38). |
| `PUBLIC` privileges: TEMP on the database, CONNECT to other databases, EXECUTE on `PUBLIC` functions, catalog visibility | VERIFIED (TEMP, CONNECT). Shared equally with `nile_app`, so not "beyond `nile_app`"; reduce through runbook REVOKEs. |
| Visibility of its own sessions in `pg_stat_activity` | INFERENCE, low |

---

## 6. `ALTER ROLE <login> IN DATABASE <db> SET role = 'nile_app'`

| Scenario | Result | Source |
|---|---|---|
| Membership present, no startup option | `current_user = nile_app`, `session_user = login` | VERIFIED (5433 and 5434) |
| Then `RESET ROLE` | `nile_app` | VERIFIED |
| Then `DISCARD ALL` (PgBouncer's usual reset query) | `nile_app` | VERIFIED |
| Then `SET ROLE NONE` | **the login** | VERIFIED |
| Client sends `-c role=<login>` | **Overrides**: `current_user = login` | VERIFIED |
| Membership **revoked**, no startup option | **Connects as the login**, with only `WARNING: permission denied to set role "nile_app"` | VERIFIED (**fails open**) |
| Membership `WITH SET FALSE`, no startup option | Same: connects as the login with a WARNING | VERIFIED (**fails open**) |
| Membership revoked or SET FALSE, **with** startup option `-c role=nile_app` | Connection **fails** with 42501 | VERIFIED (fails closed) |
| Connecting to a different database | The setting does not apply (it is database-scoped) | DOCS |
| Behind PgBouncer / provider poolers | Should work, because no startup parameter is needed. PgBouncer otherwise rejects unknown startup parameters unless `ignore_startup_parameters` drops them. | DOCS / UNVERIFIED (no pooler tested) |

**Assessment.** It solves the pooler problem and nothing else.
- It does not stop `SET ROLE NONE`, and it can silently fail open.
- **Acceptable only with:** L1–L5 (so the login, if reached, holds only `PUBLIC` power), L6 on every connection (so a fail-open session is refused, not used), and L5 permitting exactly this one setting.
- **Recommendation:** default mode = startup option (fails closed). Documented "pooler mode" = `ALTER ROLE … IN DATABASE … SET role`. Both modes run the same invariants.

---

## 7. Deployment compatibility

- **Migration-owner model:** unchanged. The owner stays in `MIGRATION_DATABASE_URL`. A runtime URL pointing at the owner fails L3/L4. The owner's `ALTER DEFAULT PRIVILEGES … TO nile_app` is in the manifest.
- **Provisioning (runbook, SQL only):**
  ```sql
  CREATE ROLE <login> LOGIN PASSWORD '…';
  GRANT nile_app TO <login> WITH ADMIN FALSE, SET TRUE;
  ```
  Then optionally pooler mode. Recommended hardening: `REVOKE CONNECT` on other databases from `PUBLIC`, and `REVOKE TEMP ON DATABASE <app> FROM PUBLIC` if TEMP is unused (to confirm).
- **Neon:** roles created in the Console, CLI or API get `neon_superuser`, while roles created with SQL get only the default public-schema privileges ([Neon docs](https://neon.com/docs/manage/roles)). `neon_superuser` "allows creating databases, roles, and reading and writing data in all tables" ([Neon docs](https://neon.com/docs/manage/database-access)). B **refuses** console-created logins (L2): the login must be created by SQL. A third-party report says the membership cannot be revoked by users ([lifeodyssey/animichi#1915](https://github.com/lifeodyssey/animichi/issues/1915)); that is a single secondary source. Neon pooler behavior: UNVERIFIED.
- **Amazon RDS:** the master user is a member of `rds_superuser`, which holds `pg_monitor`, `pg_signal_backend`, `rds_replication` and others ([AWS docs](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.View.html)). The app login must be a separate SQL-created role. Whether RDS adds memberships to new roles: UNVERIFIED.
- **Supabase, Azure, GCP:** UNVERIFIED.
- **Poolers:** see §6. Transaction pooling plus `SET ROLE NONE` could leak a session state to the next client; `DISCARD ALL` restores `nile_app`, and L6 covers new connections. Untested.
- **Credential rotation:** create `login_v2` satisfying L1–L5, deploy, then drop `login_v1`.
- **Minimum PostgreSQL version:** the claim is limited to the majors in CI. Recommendation: PG ≥16 (needed for `set_option`/`inherit_option`); test 16, 17 and 18. If PG 15 must be supported, it needs version-conditional SQL and its own CI job.

---

## 8. Proposed security claim (exact text)

> At startup, Nile verifies against the connected PostgreSQL server (supported majors: those in CI) that:
> 1. the session's effective role is `nile_app`;
> 2. `nile_app` cannot log in; holds none of SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION; is a member of no role; owns no object in any database of the cluster; is named in no policy or parameter ACL; and holds exactly the object privileges listed in the committed manifest;
> 3. the session login holds none of those five attributes; is a member of `nile_app` only, without ADMIN OPTION; owns nothing and is named in no ACL, default ACL, policy or initial-privilege entry in any database of the cluster; and has no per-role setting other than `role = nile_app`;
> 4. `session_replication_role` is `origin`, `row_security` is `on`, `PUBLIC` holds no SET or ALTER SYSTEM privilege on any parameter and no CREATE on the database or any of its schemas, no SECURITY DEFINER function outside the allow-list is executable by `nile_app`, and only allow-listed extensions are installed.
>
> Every new connection verifies that its effective role is `nile_app` under the configured login. If any check fails, the application refuses to start or to use the connection.
>
> Consequently, as of the check, SQL executed through the runtime credential can use only `nile_app`'s manifest privileges, privileges granted to `PUBLIC`, and the abilities every PostgreSQL login has over its own identity: changing its own password and session defaults, and signalling its own sessions. This holds whether the SQL runs in an application session, after `SET ROLE NONE`, or over a new connection with the same credential.
>
> **Not claimed:**
> - changes made after the check;
> - privileges conferred by provider-specific code outside the system catalogs;
> - `PUBLIC` grants inside other databases;
> - authentication, `pg_hba` and network controls;
> - protection against superusers or provider administrators;
> - whether the manifest's business privileges are themselves appropriate;
> - PostgreSQL versions not exercised in CI.

This claim is the original G-7 intent, made precise. It is not weakened to fit `60342be`, which cannot make it.

---

## 9. Proposed tests (real PostgreSQL, never skipped in the security job)

**Test pattern for every unsafe case:**
1. **Positive control:** create the unsafe configuration, connect with a raw `pg` client exactly as the app would, and show the dangerous action **succeeds** (after `SET ROLE NONE` where relevant). If the control fails, the test fails: it is a broken test, not a pass.
2. **Rejection:** `openPostgres` rejects that login with the specific structured error code.
3. **Negative control:** a clean login is accepted, and the same action is **denied** for it.

C3/M3/G1 create their own throwaway table with UPDATE revoked from `nile_app`, so they do not depend on PR #4. After PR #4 merges, one extra test repeats them on `audit_log`.

| Test | Finding | Positive control (must succeed) | Expected rejection |
|---|---|---|---|
| T-01 | V17 | Grant `pg_execute_server_program` to `nile_app`; `COPY TO PROGRAM` as `nile_app` creates a marker | `G7_ROLE_MEMBERSHIP` (N2) |
| T-02 | P1 | Login in `pg_execute_server_program`; marker created after `SET ROLE NONE` | `G7_LOGIN_MEMBERSHIP` (L2) |
| T-03 | P2 | Login in `pg_write_server_files`; file written | L2 |
| T-04 | P3 | Login in `pg_read_server_files`; temp file read | L2 |
| T-05 | P4 | Login in `pg_signal_backend`; terminates another role's backend | L2 |
| T-06 | P5 | Login in `pg_read_all_data`; reads a table `nile_app` cannot read | L2 (not incidental: also with a schema where `nile_app` reads everything) |
| T-07 | M2 | Login in `pg_maintain`; REINDEX | L2 |
| T-08 | indirect | Login → intermediate role → `pg_read_server_files`; file read | L2 (closure) |
| T-09 | SET-only / INHERIT-only | `GRANT x TO login WITH INHERIT FALSE`; `SET ROLE x` then the action | L2 |
| T-10 | ADMIN | `GRANT nile_app TO login WITH ADMIN TRUE`; login grants `nile_app` to another role | `G7_LOGIN_MEMBERSHIP_ADMIN` |
| T-11 | provider role | A custom `neon_superuser`-like role with CREATEDB/CREATEROLE; login creates a role | L2 |
| T-12 | C1 | Column UPDATE on the drizzle migrations log; UPDATE succeeds | `G7_LOGIN_ACL` (L4) |
| T-13 | C2 | Shipped-schema variant: column grant on a table `nile_app` cannot read; SELECT succeeds | L4 (asserts detection, not hash access) |
| T-14 | C3 | Column UPDATE on an append-only test table; **rewrites rows with a tenant set** | L4 |
| T-15 | S1 | Sequence UPDATE; `setval` | L4 |
| T-16 | F1 | EXECUTE on a test SECURITY DEFINER function; it runs | L4; plus E4 when `nile_app`/PUBLIC can execute it |
| T-17 | M1/M3 | MAINTAIN on a test table; REINDEX and `LOCK ACCESS EXCLUSIVE` | L4 |
| T-18 | G1 | `SET ON PARAMETER session_replication_role`; **FK-violating insert succeeds** | L4 |
| T-19 | G1 (PUBLIC) | Same grant to `PUBLIC` | `G7_ENV_PARAMETER_ACL` (E2) |
| T-20 | F2 | Login owns a function | `G7_LOGIN_OWNS` (L3) |
| T-21 | T1 | Login owns a type; `ALTER TYPE` succeeds (valid control: a login that does not own it gets 42501) | L3 |
| T-22 | ownership (other DB) | Login owns another database; connects and creates there | L3 (dbid 0) |
| T-23 | ACL (other DB) | A grant to the login on a table in another database; reads it there | L4 (dbid other) |
| T-24 | default ACL | `ALTER DEFAULT PRIVILEGES … TO login`; a new table is readable by the login | L4 |
| T-25 | policy | `CREATE POLICY … TO login` that widens visibility; reads rows | L4 |
| T-26 | large object | Login owns or has SELECT on a large object; reads it | L3/L4 |
| T-27 | R1 | CREATEROLE; `CREATE ROLE` | `G7_LOGIN_ATTRIBUTE` (L1) |
| T-28 | R2 | CREATEDB; `CREATE DATABASE` | L1 |
| T-29 | R3 | REPLICATION; physical slot (dropped in cleanup) | L1 |
| T-30 | `nile_app` attributes | CREATEDB on `nile_app`; action as `nile_app` | N1 |
| T-31 | `nile_app` owns | `nile_app` owns a test table; DROP succeeds | N3 |
| T-32 | `nile_app` drift | Extra `GRANT TRUNCATE` / column UPDATE on an append-only table to `nile_app`; action succeeds | `G7_ROLE_ACL_DRIFT` (N5) |
| T-33 | `nile_app` setting | `ALTER ROLE nile_app SET …` | N4 |
| T-34 | env E1 | `ALTER DATABASE … SET session_replication_role = replica` (superuser); FK bypass shown | `G7_ENV_SETTING` |
| T-35 | env E5 | Install a non-allow-listed extension | `G7_ENV_EXTENSION` |
| T-36 | pooler fail-open | Pooler mode, then REVOKE the membership; connection lands as the login (assert the WARNING and `current_user = login`) | L6 refusal, not silent use |
| T-37 | override | `options=-c role=<login>` in `DATABASE_URL` | L6 refusal |
| T-38 | own-defaults | After `SET ROLE NONE`, the login runs `ALTER ROLE <self> SET work_mem …` (control succeeds) | Next startup refused by L5 |
| T-39 | U1, X1 | Schema USAGE only: denied (asserted). TEMP: allowed via `PUBLIC`, asserted as a documented residual | Accepted |
| T-40 | pooler mode accepted | `ALTER ROLE … SET role = nile_app` with no startup option | Accepted; `current_user = nile_app` after `RESET ROLE` and `DISCARD ALL` |

**Regression tests for the original G-7 behavior (kept or strengthened):**

| Test | Behavior |
|---|---|
| G-R1 | Clean login accepted; effective role `nile_app`; `RESET ROLE` stays `nile_app`. Also after `SET ROLE NONE` the login cannot delete users, drop `audit_log` or disable RLS (the existing positive test, kept). |
| G-R2 | Non-member login: `UnsafeRuntimeRoleError` (`G7_CANNOT_ASSUME_ROLE`); no unhandled rejection; process stays alive |
| G-R3 | Superuser login refused; BYPASSRLS login refused; table-owner/migration-owner login refused |
| G-R4 | The migration-owner URL used as the runtime URL is refused |
| G-R5 | Errors carry no password or `pg` client (serialize the error and assert the absence of `connectionParameters` and of the password string) |
| G-R6 | PGlite path still asserts `nile_app` |
| G-R7 | Manifest test: migrations applied to an empty database produce exactly the committed manifest |

**Mutation testing (required):** removing or weakening each invariant clause (L1 to E6, each attribute, the `admin_option` clause, each `pg_shdepend` deptype, the manifest comparison) must make at least one test fail. The result is judged by the vitest summary "N failed", and recorded.

---

## 10. Acceptance checklist

**Owner decisions (before implementation):**
- [ ] Architecture B (recommended) or C.
- [ ] Minimum PostgreSQL major and CI matrix (recommended 16, 17, 18).
- [ ] Target hosting provider or providers, and pooler.
- [ ] O-1 acknowledged (cross-tenant `account` read by `nile_app`).

**Implementation conditions:**
- [ ] Remote state re-checked first: `main`, PR #4 head and state, remote branches.
- [ ] Work on G-7's own line, never in PR #4 or the docs branch. Either new commits on top of `60342be` (no history rewrite) or a new branch from then-current `main`, chosen explicitly. `60342be` is never published alone as "fixed".
- [ ] All invariants of §3.2 with structured error codes; no secrets in errors.
- [ ] Committed manifest plus the G-R7 generator test; reviewed line by line.
- [ ] Every test in §9 present. Each unsafe case **asserts its positive control succeeded** before asserting rejection.
- [ ] Real-PG security job on every supported major. Reported as passed / failed / skipped with **0 skipped** in that job. Exact commands and counts recorded.
- [ ] Mutation results recorded (each clause killed).
- [ ] Merge simulation with PR #4 (whichever lands first) re-run, plus the `audit_log` C3/M3 variant.
- [ ] Runbook: SQL provisioning, pooler mode, recommended `PUBLIC` REVOKEs, rotation.
- [ ] Smoke test on the actual target provider (create the login by SQL; confirm L2/E5 pass; confirm a console-created login is refused). Until then, managed-PG compatibility stays UNVERIFIED in docs.
- [ ] `docs/STATUS.md`: G-7 relabelled from "IMPLEMENTED/FIXED ON BRANCH `60342be`" to PROPOSED / under revision now. After implementation, it carries the exact §8 claim and test counts, and says LOCAL ONLY until a push is verified.
- [ ] ADR-0005 §7 amendment drafted as PROPOSED; ACCEPTED only by the owner.
- [ ] No push, PR, merge, deploy or credential change without explicit owner authorization.

**Independent review requirements:**
- [ ] Reviewer is not the author of G-7 (a human with PostgreSQL security experience preferred; at minimum a different agent or model, with the limitation stated).
- [ ] Reviewer reproduces from the bundle or a fresh clone and verifies SHAs and trees.
- [ ] Reviewer writes **their own** escape probes (not only the author's tests), covering at least every row of §4.
- [ ] Reviewer confirms each VERIFIED / DOCS / UNVERIFIED label in this document and in the PR.
- [ ] Reviewer signs off on the manifest contents and on the §8 claim wording.
- [ ] Findings and sign-off are recorded in `docs/reviews/`. A passing test suite alone is not approval.
