# Documentation and artifact cleanup inventory (2026-10-14)

| Field | Value |
| --- | --- |
| Branch | `docs/source-of-truth-cleanup`, based on `main` `ebcfe72` |
| Scope | Every tracked file on `main` (108 files), branch `arena/bfcb5ed1-mohamed-app-factory` @ `e61cd06`, PR #4 @ `784e50c`, and the local consolidation bundle (`ce6f328`) |
| Status | HISTORICAL once this PR merges. Live state is in [`docs/STATUS.md`](../STATUS.md) |

Nothing was deleted. One file was moved (`git mv`, history preserved). Deletions are only proposed
(category D) and need the owner's approval.

## A. Canonical: keep and maintain

| Path | Why | Change in this PR |
| --- | --- | --- |
| `AGENTS.md` | Entry point for every agent | Extended: what Nile is, reading order, tiers, status labels, gates, safety, migration and PR rules, where to record things. Existing precedence, lifecycle and skills sections kept |
| `docs/DECISIONS.md`, `docs/adr/0001–0007` | Accepted decisions | Index gains 0007 (was missing), 0008, 0009, 0010. Accepted ADR files untouched |
| `docs/adr/0010-…` | Records the owner's D1 | New |
| `docs/ARCHITECTURE.md` | Current architecture and decision status, incl. ADR-vs-code gaps | New |
| `docs/STATUS.md` | Single live handoff, task tracker and findings register | New |
| `docs/README.md` | Documentation index with canonical locations and statuses | New |
| `README.md` | Project overview | Rewritten: Nile, actual layout, setup, links |
| `engines/README.md`, `docs/REUSE.md` | Engine layout; provenance | Contradictions fixed; in-code citation note |
| `.agents/skills/*`, `docs/agent-system/REFERENCES.md` | Process skills and sources | Unchanged (9 inbound links; moving would only cause churn) |
| `docs/architecture/README.md` | Evidence index for the ledger question | Updated: ADR-0010, proposal 0007, correct source of the G-n IDs |

## B. Historical evidence: preserve but demote

| Path | Label | Change |
| --- | --- | --- |
| `docs/archive/2026-09-04-architecture-assessment.md` (was `docs/architecture-assessment.md`) | HISTORICAL | Moved with `git mv`; banner added. It says "no application code written" and frames the product as Sales / Property & Rental |
| `prototypes/README.md`, `prototypes/nilesys/README.md`, `prototypes/nilesys/REVIEW.md` | HISTORICAL / UX reference | English banners. The review cites local paths (`/home/user/nilesys`, backup tarball) that are not in the repository |
| `prototypes/nilesys/**` (code, tests) | HISTORICAL / UX reference | Unchanged; the reference for Arabic/RTL UX and cashier behaviour |
| `docs/adr/0008-…` | PROPOSED | §10 C2 marked resolved by ADR-0010 |
| `docs/architecture/proposals/0002–0005`, `tools/spikes/option-c/**`, `tools/spikes/nile-review/**`, `docs/adr/0009-…` (branch ADR-0001), `docs/reviews/0001-…` | Evidence (from `e61cd06`) | Imported verbatim in `d81cf97`; reconciled with labelled notes in `bf23dad`; provenance in `docs/architecture/README.md` §3 |
| `docs/reviews/2026-10-14-engines-db-auth-review.md` | HISTORICAL | Banner: findings addressed by PR #3; cross-link to the overlapping review 0001 |
| `docs/reviews/2026-10-14-post-merge-security-gate.md` | HISTORICAL evidence | New repository copy of the author's local gate report; edits listed in its banner |
| `docs/reviews/2026-10-14-pr4-review.md` | Review | New |
| Branch `arena/bfcb5ed1-mohamed-app-factory` @ `e61cd06` | HISTORICAL evidence | **Kept.** Not merged (16 commits behind `main`). Files not imported remain reachable at the pinned commit |

## C. Duplicate or superseded: consolidated

| Duplicate or superseded material | Consolidated into | Provenance kept |
| --- | --- | --- |
| Branch ADR-0001 (localization) colliding with `main`'s ADR-0001 | `docs/adr/0009-…` (heading renumbered only) | Blob ID and original path in `docs/architecture/README.md` §3 |
| Branch `docs/adr/README.md` (second ADR index) | `docs/DECISIONS.md` | Not imported; pinned link |
| Branch proposal 0001 (re-argues the accepted stack) | ADR-0008 carries the live question | Not imported; pinned link |
| Branch root `README.md` (pre-PR #3) | `README.md` on `main` | Not imported; pinned link |
| Two reviews of the same code (`reviews/0001-…` H-n; `reviews/2026-10-14-engines-db-auth-review.md` F-n), plus the gate report (G-n) | One live findings register: `docs/STATUS.md` §6 | All three kept, cross-linked, labelled HISTORICAL |
| Roadmap fragments in `docs/REUSE.md` ("Not yet extracted"), the gate report §7, the local handoff reports | `docs/STATUS.md` §5 | `REUSE.md` section kept, marked as extraction history |
| Engine status claims in `engines/README.md` ("(done)", "double-booking prevention") and the root README (`modules/`, `platform/`) | `docs/ARCHITECTURE.md` §2 and `docs/STATUS.md` §4 | Original wording visible in git history |
| D1 open in proposal 0006, plus ADR-0008's "no application code" constraint | ADR-0010 (ACCEPTED) | Proposal 0006 and ADR-0008 annotated |
| Local-only payment design (`handoff/2026-10-14-payment-engine-design.md`) | `docs/architecture/proposals/0007-payment-engine.md` | References updated to verified facts |

## D. Proposed for removal: needs owner approval (nothing removed)

| Exact item | Reason | Risk if removed |
| --- | --- | --- |
| Remote branch `arena/01a06b01-mohamed-app-factory` @ `e74167b` | Fully merged: ancestor of `main` `ebcfe72` | None to code; commits stay in `main` |
| Remote branch `feat/nile-engines-v1` @ `3916924` | Fully merged (PR #1); GitHub keeps `refs/pull/1/head` | None |
| Remote branch `feat/nile-engines-wave2-db` @ `949228f` | Fully merged (PR #2); `refs/pull/2/head` kept | None |
| Remote branch `feat/nile-e2e-auth-sale` @ `b602a57` | Fully merged (PR #3); `refs/pull/3/head` kept | None |

**Considered and explicitly kept:**

| Item | Why it was kept |
| --- | --- |
| `tools/spikes/option-c/artifacts/odoo_invoice_report_ar_userlang.html` | Byte-identical to `_ar.html`, but that identity is itself a measured result |
| The Odoo branch | Evidence |
| `prototypes/nilesys/**` | UX reference |
| All tests, migrations, snapshots and schemas | Never deleted in a cleanup |

No temporary logs, local environment files, dumps or generated build output are tracked on `main`
(checked: no `.env*`, `*.log`, `*.dump`, `node_modules`, `dist`, or `.local` paths in the tree).

## Language follow-up

`prototypes/README.md`, `prototypes/nilesys/README.md` and `prototypes/nilesys/REVIEW.md` are in Arabic.
The repository rule is English. They are HISTORICAL with English banners; translation is task 7 in
`docs/STATUS.md`.
