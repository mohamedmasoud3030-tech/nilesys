# Documentation index

Every document has one canonical location and one status. Tiers follow [`AGENTS.md`](../AGENTS.md):
tiers 1–4 are binding; tiers 5–6 are evidence or history and never authorise work by themselves. If a
document is not listed here, it is not authoritative. Add it here in the same PR that creates it.

## Binding (tiers 1–4)

| Tier | Document | Purpose | Status |
| --- | --- | --- | --- |
| 1 | [`AGENTS.md`](../AGENTS.md) | Rules for every agent: reading order, gates, safety, testing, where to record things | CANONICAL |
| 2 | [`DECISIONS.md`](DECISIONS.md) + [`adr/`](adr/) | Architecture decisions. ACCEPTED: 0001–0007, 0009, 0010. PROPOSED: 0008 | CANONICAL |
| 3 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current architecture, engine status, decision status, ADR-vs-code gaps | CANONICAL |
| 3 | [`../engines/README.md`](../engines/README.md) | What each engine owns; persistence and API layout; run commands | CANONICAL |
| 3 | [`REUSE.md`](REUSE.md) | Provenance of every extracted engine file; meaning of in-code citations | CANONICAL |
| 4 | [`STATUS.md`](STATUS.md) | Verified state, PRs and branches, next task, gates, open findings register | CANONICAL (the only live status file) |
| — | [`../README.md`](../README.md) | Project overview, layout, setup | CANONICAL (overview only) |
| — | [`../.agents/skills/`](../.agents/skills/README.md), [`agent-system/REFERENCES.md`](agent-system/REFERENCES.md) | Procedural skills and their external sources | CANONICAL (process) |

## Evidence and proposals (tier 5, non-binding)

| Document | Purpose | Status |
| --- | --- | --- |
| [`architecture/README.md`](architecture/README.md) | Ledger evidence index: facts, hypotheses, limitations, provenance, review-0001 disposition | CANONICAL index of the evidence |
| [`architecture/proposals/0002`](architecture/proposals/0002-open-source-reuse-audit.md)…[`0005`](architecture/proposals/0005-option-c-evidence.md) | Open-source audit; Odoo spike plan, results and measurements | PROPOSED / evidence (imported from `e61cd06`, provenance recorded) |
| [`architecture/proposals/0006-ledger-decision-memo.md`](architecture/proposals/0006-ledger-decision-memo.md) | Ledger decision memo and owner decisions D1–D4 | PROPOSED (D1 decided → ADR-0010) |
| [`architecture/proposals/0007-payment-engine.md`](architecture/proposals/0007-payment-engine.md) | Payment engine design | PROPOSED; implementation gated on the PR #4 merge |
| [`reviews/2026-10-14-pr4-review.md`](reviews/2026-10-14-pr4-review.md) | PR #4 review with real-PostgreSQL evidence | Verdict APPROVE (by the PR's author; independent review not available) |
| [`reviews/2026-10-14-post-merge-security-gate.md`](reviews/2026-10-14-post-merge-security-gate.md) | Security gate on `ebcfe72`; source of G-1…G-15 | HISTORICAL evidence; live status in `STATUS.md` |
| [`reviews/2026-10-14-engines-db-auth-review.md`](reviews/2026-10-14-engines-db-auth-review.md) | Review before PR #3 (F-n) | HISTORICAL |
| [`reviews/0001-nile-engines-db-auth-review.md`](reviews/0001-nile-engines-db-auth-review.md) | Independent review of the same code (H-n) | HISTORICAL |
| [`reviews/2026-10-14-documentation-cleanup-inventory.md`](reviews/2026-10-14-documentation-cleanup-inventory.md) | What this cleanup kept, demoted, consolidated and proposes to delete | HISTORICAL once its PR merges |
| [`../tools/spikes/option-c/`](../tools/spikes/option-c/README.md), [`../tools/spikes/nile-review/`](../tools/spikes/nile-review/probe-db-findings.mjs) | Probe scripts and artifacts | Evidence; not production code |

## History (tier 6, never overrides the above)

| Document | Status |
| --- | --- |
| [`archive/`](archive/README.md), including the 2026-09-04 architecture assessment | HISTORICAL |
| [`../prototypes/`](../prototypes/README.md) (plain-Node Nile demo, its README and review; Arabic) | HISTORICAL / UX reference |

## Naming conventions

- ADRs: `adr/NNNN-kebab-title.md`; the next free number is in `DECISIONS.md`.
- Proposals: `architecture/proposals/NNNN-*.md` (a separate sequence from ADRs).
- Reviews: `reviews/YYYY-MM-DD-*.md`. The older `reviews/0001-*` keeps its name because other documents
  link to it.
