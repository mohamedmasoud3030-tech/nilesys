# Nile — current state, handoff and task tracker

**Status:** canonical (tier 4 in `AGENTS.md`). This is the **only** live status and handoff document.
Update it in the same PR as any change that alters what is below. Do not create per-agent status files.

- **Last verified:** 2026-10-14 19:38 UTC, by the coordinating engineering agent, using `git ls-remote` and the
  GitHub API against `mohamedmasoud3030-tech/Mohamed-App-Factory`.
- **Re-verify before acting:** run `git ls-remote origin` and check open PRs. If the remote differs from
  this file, the remote is right; fix this file.
- **Published vs. candidate:** only `main` and PR #4 were on GitHub when this file was last edited. Every
  other branch in §2 is a **candidate that is not merged into `main`**. This file was written before those
  candidates were pushed, so confirm each one with `git ls-remote origin`; a branch that is absent there is
  not published.

## 1. Repository state

| Item | Value | Verified how |
| --- | --- | --- |
| `main` | `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` (merge of PR #3) | `git ls-remote` |
| CI | **None.** There is no `.github/` workflow, so PRs show no checks | repository tree; GitHub API: 0 check runs on PR #4 |
| Tests on `main` | typecheck exit 0; `npm test` 9 files, 91/91 | run locally 2026-10-14 |
| Schema drift on `main` | `drizzle-kit check`: fine; `generate`: no changes | run locally 2026-10-14 |
| Hosting and production PostgreSQL | **UNRESOLVED.** No host, PostgreSQL major version or pooler has been chosen. Supabase was assessed as *conditionally viable, not chosen*; see D5 in §3 | review `2026-10-14-supabase-feasibility.md` (branch `handoff/2026-10-14-evidence`) |

## 2. Pull requests and branches

| Ref | Head | State | Notes |
| --- | --- | --- | --- |
| PR #4 `fix/nile-gate-ledger-append-only-demo-lock` | `784e50c` (base `ebcfe72`) | **OPEN, not merged**; 0 GitHub reviews | Fixes G-1, G-2. **Limitation: the only review is by the PR's author** ([APPROVE, author re-review](reviews/2026-10-14-pr4-review.md)); no independent reviewer was available. Known gaps, not merge blockers: 3 of the 8 locked demo paths (change-email, delete-user, revoke-session) have no committed test (P4-1); tables added later inherit UPDATE/DELETE for `nile_app` unless their migration revokes it (P4-4). Review-request text for the owner: [review §5](reviews/2026-10-14-pr4-review.md#5-independent-review-request-text-for-the-owner-to-post). **Merge needs the owner's authorisation** |
| `investigation/g7-runtime-role-boundary-incomplete` (same commit as the local-only branch `fix/g7-runtime-role-assertion`) | `60342be` (base `ebcfe72`) | **CANDIDATE, INCOMPLETE. Not merged into `main`; no PR.** | **Not a security fix.** It closes the unawaited `SET ROLE` and the table-owning-login cases, but the 2026-10-14 adversarial review found that its startup check still accepts runtime logins holding extra powers (17 of 18 tested vectors on PostgreSQL 17.10 and 18.4, including running OS commands through `pg_execute_server_program`). Decision: **REVISE**. Redesign: `docs/reviews/2026-10-14-g7-redesign-design-review.md` (PROPOSED) on branch `handoff/2026-10-14-evidence` |
| `docs/source-of-truth-cleanup` | its own head (check `git ls-remote`) | **Candidate, not merged into `main`. No PR has been opened.** | Documentation cleanup (this file, `AGENTS.md`, ADR-0010, evidence consolidation). Based on `ebcfe72`. Contains the three Odoo-evidence consolidation commits `d81cf97`, `bf23dad`, `ce6f328` (local branch `docs/consolidate-option-c-evidence` is an ancestor and needs no separate publication) |
| `handoff/2026-10-14-evidence` | its own head (check `git ls-remote`) | **Candidate, not merged into `main`; no PR.** Built on top of `docs/source-of-truth-cleanup` | Reviews (Supabase feasibility, G-7 redesign, publication audit), raw test evidence with checksums under `tools/spikes/`, sanitized scratch probes, and archived agent reports |
| `arena/bfcb5ed1-mohamed-app-factory` | `e61cd06` | Odoo evaluation branch; **HISTORICAL evidence, never merge wholesale** | Forked at `bb0cb4f`, 16 commits behind `main`. Its relevant files are imported (with provenance) by the cleanup branch. Keep the branch |
| `arena/01a06b01-…`, `feat/nile-engines-v1`, `feat/nile-engines-wave2-db`, `feat/nile-e2e-auth-sale` | `e74167b`, `3916924`, `949228f`, `b602a57` | **MERGED IN `main`** (each is an ancestor of `ebcfe72`) | Proposed for deletion; needs owner approval (see the cleanup inventory) |

## 3. Decisions

- **ACCEPTED:** ADR-0001…0007, ADR-0009, ADR-0010. ADR-0010 records the owner's D1: engines continue
  while the ledger provider is open.
- **PROPOSED:** ADR-0008 (build vs. adopt; Odoo conditionally recommended, **not adopted**); proposals
  0002–0007.
- **OPEN (owner):** D2 (ERPNext measurement), D3 (ETA credential ownership and a pilot), D4 (ledger budget
  and licence). See [proposal 0006](architecture/proposals/0006-ledger-decision-memo.md) §9.
- **OPEN (owner): D5 hosting.** No host is chosen. Supabase is *conditionally viable, not chosen*: its free
  IPv4 pooler (Supavisor) drops the `-c role=nile_app` startup option, so G-7's role switch needs either a
  direct (IPv6-only on Free) connection or an owner-approved `ALTER ROLE … IN DATABASE … SET role`; Data API
  exposure must be off; use PostgreSQL 17; no backups on Free. A test on a **disposable** project needs owner
  approval. Neon was not tested. Details: `docs/reviews/2026-10-14-supabase-feasibility.md` on branch
  `handoff/2026-10-14-evidence`.
- **ADR-vs-code gaps** (ADR-0001 Nx/pnpm/CI, ADR-0002 per-vertical apps, ADR-0003 Milestone 1 scope):
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §3.

## 4. Implementation status (from code at `ebcfe72`)

- **Implemented on `main` and tested:** tenancy with fail-closed RLS; Better Auth organizations and 14
  demo roles; the sale path (login → permission → tenant → persisted sale with lines, stock movements and
  an audit row; idempotent; atomic); catalog listing; generated migrations and runtime-role hardening.
- **Domain code only (no service, no API):** booking, people.
- **Not implemented:** payments (G-3), refunds, cash shifts, daily demo reset, any product UI, CI.

## 5. Next work, in order

| # | Task | Status | Gate |
| --- | --- | --- | --- |
| 1 | Owner reviews and authorises: PR #4 merge; whether to open a PR for `docs/source-of-truth-cleanup` (none opened yet); the deletion proposals | WAITING ON OWNER | — |
| 2 | **G-7:** fail explicitly unless the runtime role is exactly `nile_app`, and refuse a runtime login that could gain anything `nile_app` lacks; tests for wrong logins | **CANDIDATE, INCOMPLETE (REVISE)** on `investigation/g7-runtime-role-boundary-incomplete` `60342be`; not merged; not a fix | Candidate results: 6 PGlite + 14 real-PostgreSQL tests pass (111/111 on 15.18 rerun, 17.10 and 18.4; 115/115 merged with PR #4). These tests do **not** cover the adversarial vectors: the escalation matrix shows 17 of 18 accepted on 17.10/18.4 (15 accepted on 15.18, where 2 vectors do not exist). Next: owner approves the redesign, then implement it with the proposed real-PostgreSQL tests and an independent review |
| 2a | **N-1:** add a pool `error` listener in `openPostgres` (log and let the pool replace the client) with a real-PostgreSQL test that terminates an idle connection | PROPOSED: the next unblocked engine task (no migration) | Separate branch from `main`; not part of G-7 |
| 2b | **D5 hosting:** run the read-only hosted checks (role attributes, pooler role behaviour, grants to `anon`/`authenticated`, catalog inventory, dump/restore) on a disposable free Supabase project on PostgreSQL 17 with Data API exposure off | WAITING ON OWNER (creating cloud resources needs approval; nobody may use an existing project) | Plan in the Supabase feasibility review §6 |
| 3 | Payment engine per [proposal 0007](architecture/proposals/0007-payment-engine.md) (tests first; real-PG concurrency tests) | BLOCKED BY PR #4 merge | New branch from the then-current `main` |
| 4 | G-4 CHECK constraints; G-10 booking `EXCLUDE` constraint | BLOCKED BY PR #4 merge | Migration numbering: PR #4 owns `0002`; generate new migrations only after it merges |
| 5 | Add the 3 untested locked paths to `e2e-sale.test.ts` §6b (PR #4 review, risk 1) | BLOCKED BY PR #4 merge | — |
| 6 | CI workflow (typecheck, tests, drizzle check); closes part of the ADR-0001/0003 gap | PROPOSED | Pushing workflows needs owner action |
| 7 | Translate `prototypes/*` Arabic documents to English | PROPOSED | Low priority |
| 8 | Cashier UI | BLOCKED BY #3 merged and tested, plus the UI blockers in §6 | — |

## 6. Open findings register

IDs: **G-n** = [post-merge security gate](reviews/2026-10-14-post-merge-security-gate.md); **H-n** =
[review 0001](reviews/0001-nile-engines-db-auth-review.md) (disposition in
[`architecture/README.md`](architecture/README.md) §5); **P4-n** = [PR #4 review](reviews/2026-10-14-pr4-review.md) §3;
**N-n** = found after those reviews and recorded only here, with its evidence.

| ID | Severity | Summary | Status |
| --- | --- | --- | --- |
| G-1 (= H4) | High | Runtime role could rewrite or delete ledger and audit rows | FIXED ON PR #4 `784e50c`; OPEN on `main` |
| G-2 | High | One visitor could lock out or deface shared demo logins | FIXED ON PR #4 `784e50c`; OPEN on `main` |
| G-3 | Medium | A sale stores no payment | OPEN: payment engine (task 3). **Cashier-UI blocker** |
| G-4 (= H7) | Medium | No CHECK constraints on money, quantity and enum columns | OPEN (task 4). Required before public exposure |
| G-5 | Medium | Dev mode trusts any origin; per-boot secret; insecure cookies; no rate limit | OPEN: deployment configuration. Required before public exposure |
| G-6 | Low | Origin/CSRF checks are skipped under `NODE_ENV=test` | OPEN |
| G-7 | Low | Unawaited `SET ROLE` (a wrong login exits through unhandled rejections); the assertion accepts any non-bypass role, including a table-owning login; `RESET ROLE` reverts to the login (verified 2026-10-14 on PostgreSQL 18.4 at `ebcfe72`) | OPEN on `main`. Candidate `60342be` (`investigation/g7-runtime-role-boundary-incomplete`) is **INCOMPLETE, not a fix**: see G-7a |
| G-7a | High | The G-7 candidate's startup check accepts runtime logins that hold or can gain powers `nile_app` lacks: `pg_execute_server_program` (OS commands), `pg_read/write_server_files`, `pg_signal_backend`, CREATEROLE, CREATEDB, REPLICATION, MAINTAIN/`pg_maintain`, `SET` on `session_replication_role`, column/sequence/function grants; and it never bounds `nile_app` itself. On PostgreSQL 17.10 the check accepted 17 of 18 tested vectors, and in 15 of those the extra power was usable after `SET ROLE NONE` (adversarial review 2026-10-14; also run on 15.18 and 18.4) | OPEN: redesign PROPOSED (closed-world allow-list); needs owner approval |
| G-8 | Low | A failed `set-active` clears the caller's own active org | OPEN (fail-closed) |
| G-9 | Low | Idempotency keys are per tenant, not per user | OPEN (document) |
| G-10 (= H9) | Low | Booking overlap not enforced by the database | OPEN (task 4); before any booking API |
| G-11 | Low | OpenAPI document is public | OPEN (decide) |
| G-12…G-15 | Low/Info | `drizzle-kit push` false drift; no `db:migrate` script; dev-only audit warnings; non-uniform 400 body | OPEN |
| H12, H13 | Low | Deep cross-engine imports; modelling gaps | OPEN |
| P4-1 | — | Demo lock: change-email, delete-user and revoke-session are locked in code but have no committed test (scratch tests passed during review) | OPEN: task 5, after PR #4 merges |
| P4-4 | — | REVOKE applies only to the 5 tables listed in migration `0002`; any table created later inherits UPDATE/DELETE for `nile_app` | OPEN: rule in `AGENTS.md`; each new append-only table's migration must REVOKE |
| P4-2, P4-3, P4-5, P4-6 | — | No row locks (`FOR UPDATE`/`SHARE`) on append-only tables, so use advisory locks; append-only status transitions; `list-sessions` token exposure; reset must run as owner | OPEN: handled by task 3 and the rules in `AGENTS.md` |
| N-1 | Low | The runtime pool has no `error` listener: when PostgreSQL terminates an idle pooled connection (restart, admin kill), Node raises an unhandled `error` event and the API process exits (observed 2026-10-14, PostgreSQL 18.4, pg 8.23.1, `57P01`) | OPEN (task 2a) |
| E-receipt | — | Egyptian B2C e-receipts (the cashier tax regime) never measured for any provider | OPEN (evaluation) |

## 7. Approvals required from the owner

1. Merge PR #4, ideally after a second, independent reviewer (post the request text in
   [review §5](reviews/2026-10-14-pr4-review.md#5-independent-review-request-text-for-the-owner-to-post)).
2. G-7: do **not** merge or present `60342be` as a fix. Approve (or reject) the redesign in
   `docs/reviews/2026-10-14-g7-redesign-design-review.md`; the candidate stays on
   `investigation/g7-runtime-role-boundary-incomplete` for reference.
3. Decide whether to open a PR for `docs/source-of-truth-cleanup` (none exists yet) and then merge it.
4. Delete the four merged branches listed in §2, if wanted (optional; GitHub keeps PR refs).
5. Decide D2–D4 when ready. None of them blocks tasks 2–5.
6. D5 hosting: approve (or not) a disposable free Supabase test project (PostgreSQL 17, Data API exposure
   off); never an existing project.
7. Revoke any previously exposed GitHub tokens.
