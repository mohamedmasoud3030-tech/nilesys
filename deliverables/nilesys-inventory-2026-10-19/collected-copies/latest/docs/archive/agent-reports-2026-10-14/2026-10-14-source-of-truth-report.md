# Nile — engineering ownership, documentation cleanup and safe continuation: report

Date: 2026-10-14. Repository: `mohamedmasoud3030-tech/Mohamed-App-Factory` only.

## 1. Verified state: what is on GitHub, local only, or missing

| Artifact | Where it is | Evidence |
| --- | --- | --- |
| `main` = `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` | **GitHub** | `git ls-remote`; fresh clone |
| PR #4 `fix/nile-gate-ledger-append-only-demo-lock`, head `784e50c`, base `ebcfe72` | **GitHub**: open, not merged, mergeable `clean`; 0 reviews, 0 comments, 0 check runs | GitHub API |
| Odoo branch `arena/bfcb5ed1-mohamed-app-factory` @ `e61cd06` (contains `9082cc9`) | **GitHub**, untouched | `git ls-remote`; 7 commits not in `main`; forked at `bb0cb4f` |
| `docs/consolidate-option-c-evidence` @ `ce6f328` | **Local only** (never pushed). Its bundle verified; it is now the base of the cleanup branch | `git bundle verify`; 23/23 imported files blob-identical to `e61cd06` |
| **`docs/source-of-truth-cleanup` @ `0fb2f31`** | **Local only.** Bundle and patch series in `handoff/` | Applied to a fresh GitHub clone and tested |
| CI | **Missing.** There is no `.github/` in the repository | tree; API |
| Gate report, PR #4 review, payment design | Were local only; **now committed on the cleanup branch** | — |
| Stray local worktree `factory/odoo-ro` (a duplicate checkout of `e61cd06`) | Removed. It was local-only and never in the repository; the branch is intact on GitHub | `git worktree remove` |

## 2. Documentation hierarchy delivered (cleanup branch)

1. **`AGENTS.md`** (extended, not replaced) covers:
   - what Nile is and what belongs in the repository;
   - reading order and tiers 1–6, plus status labels;
   - standing gates: what is allowed and what is blocked;
   - safety, testing, migration and PR rules;
   - where to record decisions and handoffs.
2. **Accepted ADRs** (`docs/DECISIONS.md`): 0001–0007, 0009, and the new **0010**.
3. **`docs/ARCHITECTURE.md`**: current shape, engine status verified against the code, decision status,
   and the gaps between ADRs and code.
4. **`docs/STATUS.md`**: the only live handoff covering:
   - the `main` SHA, PRs and branches;
   - implementation status;
   - the next task and its gates;
   - the open findings register;
   - approvals needed from the owner.
5. **Proposals and reviews**: labelled non-binding.
6. **`docs/archive/`, `prototypes/`**: HISTORICAL.

`docs/README.md` indexes every document with its tier, location and status. `README.md` is now a short
project overview.

## 3. Cleanup inventory (full: `docs/reviews/2026-10-14-documentation-cleanup-inventory.md`)

- **A. Canonical:**
  - entry point and decisions: `AGENTS.md`, the ADRs and `DECISIONS.md`;
  - current state: `ARCHITECTURE.md`, `STATUS.md`, `docs/README.md`;
  - overview and engines: `README.md`, `engines/README.md`, `REUSE.md`;
  - process: the skills and `REFERENCES.md`;
  - evidence index: `docs/architecture/README.md`.
- **B. Historical, preserved and demoted:**
  - archived assessment (`git mv`); prototype docs (English banners);
  - the Odoo evidence (verbatim, with provenance); ADR-0008 (PROPOSED);
  - the two engine reviews; the gate report; the Odoo branch itself (kept).
- **C. Consolidated:**
  - ADR collisions resolved (localization → ADR-0009); the branch's second ADR index, proposal 0001 and
    old README were not imported (pinned links instead);
  - the three finding sets now feed **one** live register in `STATUS.md` §6;
  - roadmap fragments now live in `STATUS.md` §5;
  - D1 and ADR-0008's "no code" constraint are settled by ADR-0010;
  - the local payment design became proposal 0007.
- **D. Proposed for deletion (nothing deleted):** four remote branches fully contained in `main`
  (`arena/01a06b01-…`, `feat/nile-engines-v1`, `feat/nile-engines-wave2-db`, `feat/nile-e2e-auth-sale`).
  No tracked clutter exists: no `.env`, logs, dumps, build output or local data.

**Stale or misleading items found and fixed:**
1. The README described a "Sales / Property & Rental factory" with nonexistent `modules/` and
   `platform/` directories.
2. `engines/README.md` said "no DB, no HTTP", used a vague "(done)", and claimed "double-booking
   prevention" that the database does not enforce.
3. Code extracted from other repositories cites *their* ADRs. For example, `cash.ts` cites "ADR-0009", and
   ADR-0009 here is localization. A note now explains this in `engines/README.md`, `REUSE.md` and
   `AGENTS.md`.
4. `docs/architecture/README.md` named the wrong source for the G-n finding IDs. This was my own error
   from the previous consolidation.
5. The gate report contradicted itself ("not pushed" vs. PR #4 opened). Its "(Hn)" labels clashed with
   review 0001's H-n IDs.
6. `DECISIONS.md` was missing ADR-0007.

**Gaps between accepted ADRs and code** (surfaced, not resolved):
- ADR-0001: npm, no Nx, no CI, no Next.js;
- ADR-0002: one API, not one app per vertical;
- ADR-0003: Milestone 1 lacks CI, a customer module, the design-system UI and boundary enforcement.

## 4. Odoo and D1

- **Odoo remains PROPOSED, not adopted. ERPNext has not been evaluated.**
- **Still unproven:**
  - live ETA transmission;
  - B2C e-receipts;
  - Odoo's own Arabic PDF with RTL layout (the independent PDF has an LTR page layout);
  - licensing, upgrades, tenant operations and credential responsibility.
- **D1 is the current direction**, recorded as **ADR-0010 (Accepted)**:
  - engines continue and own the operational records;
  - any provider is reached only through a neutral port;
  - provider failure never rolls back a sale;
  - building the port or any adapter is not yet authorised.

## 5. Validation (exact commands, actual results)

| Where | Command | Result |
| --- | --- | --- |
| cleanup @ `0fb2f31` | `npm ci` · `npm run typecheck` · `npx vitest run` | 187 packages · exit 0 · **91/91** (= `main`) |
| cleanup | `npx drizzle-kit check` · `npx drizzle-kit generate` | fine · no changes, clean tree |
| cleanup | Link script over all Markdown files | 144 links, 47 files, **0 broken** |
| cleanup | ADR script | 0001–0010 unique, headings match, index matches, no citations to nonexistent ADRs |
| cleanup | Diff review vs `ebcfe72` | 45 files (34 A / 10 M / 1 R), +23,424 / −42. No code, test, migration, schema or config change. Accepted ADRs untouched. No secrets or local paths. Every removed line checked: rules preserved |
| fresh GitHub clone | Apply bundle; `git am --keep-cr` patches | Both produce the identical tree. **Plain `git am` corrupts the evidence PDF** (verified) |

## 6. PR #4 review (separate)

**Verdict: APPROVE.** **Limitation:** the reviewer is the PR's author. **Independent review was not
available**; a second reviewer is recommended before the owner authorises the merge.

**File-level evidence** (full: `docs/reviews/2026-10-14-pr4-review.md`):
- `0002_ledger_append_only.sql`: 5 REVOKEs, which is minimal and correct.
- `auth.ts`: a before-hook on 8 paths, matched on normalised paths.
- Tests prove the claims, except for 3 locked paths.
- Fresh run at `784e50c`: typecheck exit 0, **95/95**, no drift.
- Adversarial scratch tests (not committed):
  - token from `list-sessions` → `revoke-session`: 403;
  - `change-email` and `delete-user`: 403;
  - 14 demo logins × 7 organization-mutating endpoints: all refused, organization intact.
- **Real PostgreSQL 18.4:**
  - migrated as a non-superuser owner (re-run is a no-op); the app runs as `nile_app`;
  - 5 tables have SELECT and INSERT only; UPDATE and DELETE give `42501`;
  - **row locks (`FOR UPDATE` / `FOR SHARE`) give `42501`**; advisory locks serialise correctly;
  - new tables inherit UPDATE and DELETE.

**Remaining risks (non-blocking):**
1. The committed tests cover 5 of the 8 locked paths.
2. No row locks on these tables: refunds and payments must use advisory locks.
3. The cash `pending → posted` change and sale voids must be appended rows.
4. Every new ledger table needs its own REVOKE.
5. `list-sessions` exposes raw tokens, which are unusable today.
6. The demo reset must run as the owner.
7. Pre-existing G-7 was observed again.

## 7. Next steps and approvals

| # | Who | Action |
| --- | --- | --- |
| 1 | **Owner** | Push the cleanup branch (bundle; commands in `docs-source-of-truth-cleanup-PR.md`), open its PR, review, authorise the merge |
| 2 | **Owner** | Authorise the PR #4 merge, ideally after an independent reviewer |
| 3 | **Owner** (optional) | Approve deleting the four merged branches |
| 4 | Engineering, allowed now (D1) | **G-7**: await `SET ROLE` and assert `current_user = nile_app` in `engines/db/open.ts`, with tests including a real-PostgreSQL wrong-login case. No migration, independent of PR #4 |
| 5 | Engineering, after the PR #4 merge | Payment engine per proposal 0007 (tests first, real-PG concurrency); then G-4 / G-10 migrations (PR #4 owns migration number `0002`) |

**Waiting on approval:** deletions, the PR #4 merge, and payment implementation. **Not done** in this
step: no merge, push, deletion, deploy or security-setting change.

Local files superseded by repository versions: `handoff/2026-10-14-consolidation-report.md`,
`handoff/2026-10-14-payment-engine-design.md` (now proposal 0007) and the earlier consolidation bundle
(contained in the new bundle).
