# PR draft: docs: single source of truth for agents; consolidate Odoo evidence; record D1

> **This PR does not exist on GitHub yet.** The branch is local only: no credentials were available, and
> none should be shared. Apply it with the instructions in §6, then open the PR with this text.

| Field | Value |
| --- | --- |
| Branch | `docs/source-of-truth-cleanup` |
| Base | `main` @ `ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8` (verified on GitHub 2026-10-14) |
| Head | `84d8044` (full SHA in §6) |
| Size | 45 files: 34 added, 10 modified, 1 moved; +23,424 / −42. Documentation and evidence only; no code, test, migration, schema or config changes |
| Merge | **Needs the owner's authorisation.** Independent of PR #4 (no shared files) |

## 1. Why

New agents had no single, current entry point. On `main`:
- the README described a pre-Nile "application factory";
- `engines/README.md` contradicted itself;
- the Odoo evidence existed only on a stale branch, with colliding ADR numbers;
- D1 was undecided;
- the security findings and the PR #4 review lived only in local files.

This PR gives one hierarchy:

| Order | Document | Role |
| --- | --- | --- |
| 1 | `AGENTS.md` | Rules for every agent |
| 2 | Accepted ADRs | Architecture |
| 3 | `docs/ARCHITECTURE.md` | Current architecture |
| 4 | `docs/STATUS.md` | Live state and next task |
| 5 | Proposals and reviews | Evidence only |
| 6 | `docs/archive/` | History only |

## 2. Commits

| Commit | What |
| --- | --- |
| `d81cf97` | Import 23 Odoo-evidence files verbatim from `arena/bfcb5ed1-mohamed-app-factory` @ `e61cd06` (blob-identical) |
| `bf23dad` | Reconcile: localization ADR becomes ADR-0009, citations updated, 6 broken links fixed, labelled corrections (RTL-layout overclaim, stale limitations) |
| `ce6f328` | ADR index (adds the missing 0007, plus 0008 and 0009), evidence provenance, ledger decision memo (proposal 0006) |
| `1a2ce95` | Demote stale material: archive the 2026-09 assessment (`git mv`); HISTORICAL banners; fix engines/README contradictions; rewrite README; English `.gitignore` comments |
| `adb76a3` | **ADR-0010 (Accepted):** the owner's D1. Engines continue; any ledger provider only behind a neutral port; no provider chosen |
| `4938001` | Commit the security-gate report (G-1…G-15), the PR #4 review and the payment design (proposal 0007) |
| `ddb6629` | `AGENTS.md` (extended), `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/README.md`, cleanup inventory |
| `5528709`, `0fb2f31` | Small label and formatting fixes |
| `8d3905a`, `84d8044` | `STATUS.md`: G-7 branch (local only; head `60342be`), PR #4 author-only review with untested locked paths (P4-1) and inherited UPDATE/DELETE (P4-4), finding N-1; PR #4 review §5 (review-request text); `ARCHITECTURE.md` G-7 status |

## 3. Files (excluding the 23 verbatim evidence files in `d81cf97`; their provenance is in `docs/architecture/README.md` §3)

| Status | File | Reason |
| --- | --- | --- |
| M | `AGENTS.md` | Nile scope, reading order, tiers, labels, gates, safety, migration and PR rules, where to record things |
| M | `README.md` | Project overview for Nile; actual layout; setup |
| M | `docs/DECISIONS.md` | Rows 0007–0010; numbering notes |
| M | `docs/REUSE.md` | In-code citations refer to source repositories; history labels |
| M | `engines/README.md` | Remove the "no DB/HTTP" contradiction and "(done)"; double-booking marked not DB-enforced |
| M | `.gitignore` | English comments only |
| M | `prototypes/README.md`, `prototypes/nilesys/README.md`, `prototypes/nilesys/REVIEW.md` | English HISTORICAL banners |
| M | `docs/reviews/2026-10-14-engines-db-auth-review.md` | HISTORICAL banner, cross-link |
| R | `docs/architecture-assessment.md` → `docs/archive/2026-09-04-architecture-assessment.md` | Archived (pre-code consultation) |
| A | `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/README.md`, `docs/archive/README.md` | Canonical hierarchy |
| A | `docs/adr/0010-engines-continue-behind-ledger-provider-port.md` | Records D1 |
| A | `docs/architecture/README.md`, `proposals/0006-ledger-decision-memo.md`, `proposals/0007-payment-engine.md` | Evidence index, ledger memo, payment design |
| A | `docs/reviews/2026-10-14-post-merge-security-gate.md`, `docs/reviews/2026-10-14-pr4-review.md`, `docs/reviews/2026-10-14-documentation-cleanup-inventory.md` | Evidence that canonical documents cite |

**Deleted:** nothing. **Proposed for deletion (owner approval):** the four fully merged remote branches
(`arena/01a06b01-mohamed-app-factory`, `feat/nile-engines-v1`, `feat/nile-engines-wave2-db`,
`feat/nile-e2e-auth-sale`).

## 4. Verification (run at `0fb2f31`, 2026-10-14; delta to head `84d8044` re-checked)

`0fb2f31..84d8044` changes only `docs/STATUS.md`, `docs/ARCHITECTURE.md` and
`docs/reviews/2026-10-14-pr4-review.md` (`git diff --stat`), so the code checks below still apply. The
link check was re-run at `84d8044`: 146 relative links, 0 broken. When `fix/g7-runtime-role-assertion` is
pushed or merged, update its `STATUS.md` §2 row, which currently (correctly) says "LOCAL ONLY".

| Command | Result |
| --- | --- |
| `npm ci` | 187 packages |
| `npm run typecheck` | exit 0 |
| `npx vitest run` | 9 files, 91/91 passed (identical to `main`) |
| `npx drizzle-kit check` / `npx drizzle-kit generate` | "Everything's fine" / "No schema changes"; tree clean |
| Link check (script: every relative Markdown link must resolve) | 144 links in 47 files, 0 broken |
| ADR consistency | 0001–0010 unique; headings match filenames; `DECISIONS.md` rows match files; canonical docs cite only existing ADRs |
| Evidence integrity | 23/23 imported files blob-identical to `e61cd06` at `d81cf97`; artifacts unchanged at head |
| Diff review | No code, test, migration, schema or config change; accepted ADRs 0001–0007 untouched; ADR-0009 differs from its original only in the heading number; no tokens, keys or local paths in added lines |
| Stale-claim scan | No "no application code" or stop-engine instruction in binding docs; no stale "not pushed" claims; D1 not described as open; `main` SHA consistent |

There is no CI on this repository, so no automated checks will appear on the PR.

## 5. Statements this PR makes and does not make

- **Odoo is not adopted.** ADR-0008 remains PROPOSED; ERPNext has not been evaluated.
- Local invoice posting does not prove live ETA transmission. B2C e-receipts, Arabic RTL invoice layout,
  licensing, upgrades, tenant operations and credential responsibility remain open.
- **D1 is the current direction** (ADR-0010). Payment implementation stays blocked until PR #4 merges.

## 6. How to apply (choose one)

**A. Bundle (lossless, recommended).** File: `docs-source-of-truth-cleanup.bundle`.

```bash
git fetch origin
git bundle verify docs-source-of-truth-cleanup.bundle      # requires ebcfe72 locally
git fetch docs-source-of-truth-cleanup.bundle docs/source-of-truth-cleanup:docs/source-of-truth-cleanup
git log --oneline -1 docs/source-of-truth-cleanup           # expect 84d8044
git rev-parse docs/source-of-truth-cleanup                 # expect 84d8044213b7c1e06efe0229d5aa75949b5a6bda
git push origin docs/source-of-truth-cleanup                # then open a PR into main with this text
```

**B. Patch series.** Folder: `patches/`, 11 files. **You must use `--keep-cr`.** Plain `git am` corrupts the
binary evidence file `tools/spikes/option-c/artifacts/arabic_invoice_probe.pdf` (verified).

```bash
git checkout -b docs/source-of-truth-cleanup origin/main    # origin/main must be ebcfe72
git am --keep-cr patches/*.patch
```

Both methods were tested on a fresh clone of GitHub `main`. Both produce the identical tree, provided
`--keep-cr` is used for method B.
