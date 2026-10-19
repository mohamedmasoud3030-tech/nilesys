# Admin lead capture and people service: delivery report (2026-10-18)

**Workers:** none launched. Native subagents are unavailable; I did all of this work myself, one task after
another. I made no pushes, merges, PRs, migrations or deployments.

## 1. Coordination check (before editing)
- Remote re-verified with `git ls-remote` and the PR API. Nothing changed since the previous session:
  `main` is still `52af469`, the only open PR is #5 (docs) and the last push was at 06:22Z.
- Files changed by each active branch compared with `main`:
  - `feat/nile-payments-engine` (primary agent): `engines/db/{migrations/0003,0004,meta,schema.ts,test/payments.pg.test.ts}`
    plus `engines/transactions/src/{db/payments-schema.ts,payments-service.ts}`.
  - `docs/resolve-source-of-truth-citations`: the files above plus `engines/transactions/src/{cash,costing,decimal,regrade}.ts`
    and `engines/README.md`.
  - `fix/nile-pool-error-listener` and `investigation/g7-*`: `engines/db/open.ts` plus tests.
- **No active branch touches** `with-tenant.ts`, `engines/platform/src/auth/*`, `apps/api/*`,
  `engines/catalog/*` or `engines/people/*`.
- I chose to **add four new files only**. Zero existing files were modified by Tasks 1–2. `with-tenant.ts`,
  auth, routing, schemas, migrations, `index.ts` barrels and `engines/README.md` are untouched.
- The services import `withTenant` from platform and `DomainError` from `transactions/src/line.ts` (read-only
  imports). `line.ts` is not changed by any active branch.

## 2. Task 1: Admin lead capture (DONE, service layer)
`engines/catalog/src/lead-service.ts`. It uses the existing `createLeadSchema`, the existing `Lead` /
`LeadStage` / `canMoveLead` and the existing `leads` table (migration 0000, RLS enabled + forced).

| Function | Behaviour |
|---|---|
| `captureLead(db, tenantId, input)` | Strict, normalising refinement of `createLeadSchema`: trims fields, stores the phone as digits with an optional `+`, and rejects a body that sends `tenantId`, `stage`, `id` or `createdAt`. Always inserts at `NEW` |
| `listLeads(db, tenantId, {stage?, source?, limit?})` | Newest first, limit 1–200 (default 50), filters validated |
| `moveLead(db, tenantId, leadId, to)` | Follows `canMoveLead`. The UPDATE only applies if the stage is still the one just read, so the loser of a race gets `lead_stage_conflict`. Another tenant's lead returns `lead_not_found` |

Isolation is enforced by the database: every query runs inside `withTenant` as `nile_app` (no RLS bypass).
Errors are `DomainError` codes, so the existing `toHttp` maps them without changes.

**Tests: `engines/catalog/test/lead-service.test.ts`, 19/19 on PGlite through `openPglite()` (the production
migration path).**
- Valid requests: normalisation, all 7 sources, a blank message stored as absent.
- Invalid input: 13 cases (unknown source, short name, bad or short phone, message over 1000 chars,
  client-sent `tenantId` or `stage`, missing field, non-object bodies, malformed tenant id). Each case
  asserts that nothing was written.
- Cross-tenant: each tenant lists only its own leads; no tenant context returns 0 rows; a direct
  cross-tenant insert is refused by RLS (`42501`); tenant A cannot move tenant B's lead, and B's lead is
  left unchanged.
- Pipeline: allowed moves, skips, reversals, terminal states, unknown stages.

## 3. Task 2: People service (DONE, service layer)
`engines/people/src/people-service.ts`. It uses the existing `createEmployeeSchema` and `attendanceSchema`,
the tables `employees`, `attendance_records` and `loans` (migration 0000), and the existing pure
`attendance.ts` / `payroll.ts`.

| Function | Behaviour |
|---|---|
| `createEmployee` / `listEmployees` | Strict input (rejects `tenantId` and `isActive` from the client). Inactive employees are hidden unless requested |
| `recordAttendance` | One row per employee per day (an existing unique constraint). A second call merges, so a morning check-in and an evening check-out become one record. The merged row must have check-out after check-in, or the whole write rolls back. ABSENT, LEAVE and HOLIDAY carry no times. Validates real calendar dates and HH:MM times. The employee must be active and belong to the tenant |
| `listAttendance` | One month at a time, tenant-scoped |
| `computeMonthlyPayslip` | **Computed, not stored.** Sums lateness and overtime from PRESENT/LATE days; only explicit ABSENT days count as absence. Takes the next loan installment from the schedule, never more than is owed. The tenant pay policy (start time, rates, working days) is an explicit, validated argument |

**No schema or migration was needed.** No table exists for payroll runs or pay policy, so the payslip is
computed and the policy is passed in. Persisting payroll runs is a separate schema decision that needs the
owner's approval.

**Tests: `engines/people/test/people-service.test.ts`, 27/27 on PGlite.**
- Employees: valid and invalid creation, the inactive filter.
- Attendance: merge, rollback on an invalid merge, check-out without check-in, ABSENT clearing times,
  5 invalid inputs, an invalid month.
- Cross-tenant: recording for another tenant's employee writes nothing in either tenant; the composite
  foreign key blocks a direct insert (`23503`); RLS blocks inserting as another tenant (`42501`); reads and
  payslips for another tenant's employee return `employee_not_found`; no tenant context returns 0 rows; a
  malformed tenant id is refused before the database is touched.
- Payslip: a hand-checked case (net **260,667** minor units) asserted against both the pure engine and
  explicit numbers; computing it twice gives the same result; invalid policies are rejected.

## 4. Verification evidence
| Check | Result |
|---|---|
| `npm run typecheck` (my branch) | exit 0 |
| `npx vitest run` (my branch) | **141/141**, 11 files (baseline 95 + 19 + 27) |
| Mutation check (8 mutants) | **7 killed.** 1 equivalent: "honour a client-sent stage" can't be reached because the strict schema rejects `stage` first. The strict-schema mutant itself is killed |
| Trial merge with `origin/feat/nile-payments-engine` | **0 conflicts**, typecheck 0, **161 passed + 2 todo**, run against their migrations 0003/0004 |
| Trial merge with `origin/docs/resolve-source-of-truth-citations` | 0 conflicts |
| Offerings registry (updated) | 17/17 |

Trial merges ran in throwaway worktrees, which I then removed. Nothing was committed to other branches.

## 5. Files
Branch `feat/nile-lead-people-services` (local, **not pushed**), built on top of `feat/nile-offerings-readiness`,
which is preserved unchanged:

| Commit | Files |
|---|---|
| `a03cca9` | `engines/catalog/src/lead-service.ts`, `engines/catalog/test/lead-service.test.ts` (new) |
| `7a3207e` | `engines/people/src/people-service.ts`, `engines/people/test/people-service.test.ts` (new) |
| `099dc14` | `tools/nile-offerings/{offerings.ts,offerings.test.ts,README.md}`: admin and HR now show as in progress with code evidence, and a new rule requires every in-progress entry to cite an `engines/` or `apps/` file |

Deliverables:
- `deliverables/nilesys-patches/0001–0005*.patch`: `git am` onto `52af469`.
- `deliverables/nilesys-feat-nile-lead-people-services.bundle`: contains both branches.
- `deliverables/nilesys-feat-nile-offerings-readiness.bundle`: the original, kept.

## 6. Not done, on purpose, and why
- **No `apps/api` endpoints.** `controllers.ts` and `app.ts` are shared routing, and the primary agent's next
  step is the payments API in those same files. The integration needs only `requireContext`,
  `parseBody`/`toHttp` and the existing permissions: `lead: read/manage`, `employee: read/manage`,
  `attendance: record/read`.
- **Public lead form tenant resolution is an owner decision.** An anonymous site has no session, so the API
  needs a server-side mapping from site to tenant. Edge rate limiting is also needed; the contract comment
  already assumes it.
- **Optional `http.ts` follow-up:** map `lead_not_found` and `employee_not_found` to 404 and
  `lead_stage_conflict` to 409. Today they fall back to 422.
- **Not proven on multi-connection PostgreSQL:** the `lead_stage_conflict` race (PGlite has a single
  connection). The logic is a conditional UPDATE; a real-Postgres test fits the existing `*.pg.test.ts`
  harness.
- **Pre-existing finding, not mine to fix:** `engines/platform/src/locale/phone.ts` says "Egyptian phone
  normalization" in its header but only normalises **Omani** numbers. That's why lead capture uses a neutral
  8–15 digit rule.

## 7. Next actions
1. Owner: approve pushing `feat/nile-lead-people-services` and opening a PR (both stacked branches).
2. Owner: decide how a public site resolves its tenant.
3. After the payments API lands: one PR that adds the lead and people endpoints with e2e tests.
4. Revoke the GitHub token pasted in chat.
