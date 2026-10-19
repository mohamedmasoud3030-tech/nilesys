# Nile Systems — consolidation report

Date: 2026-10-14. Coordinating agent: the single engineering agent for `mohamedmasoud3030-tech/Mohamed-App-Factory`.
Remote state was re-verified at the end of the work; nothing moved during it.

## 1. `main` SHA

`ebcfe722ebeaba1ed4eebef1c42eae9a7cb399a8`: the merge of PR #3. ADRs 0001–0007 exist; typecheck is clean
and 91/91 tests pass.

## 2. PR #4: status and verdict

- **Status:** open, not merged, mergeable. Head `784e50c`, base `ebcfe72`, no reviews or comments.
  https://github.com/mohamedmasoud3030-tech/Mohamed-App-Factory/pull/4
- **Verdict: APPROVE.** This is an *author re-review*: the same agent wrote the fix. A second, independent
  reviewer is recommended.
- **What was checked:**
  - Six files changed. The migration revokes UPDATE and DELETE from `nile_app` on the five ledger tables.
    Schema snapshots show no drift, and the golden test is untouched.
  - Typecheck clean; 95/95 tests pass.
  - Four extra adversarial tests (scratch only, not committed), all passing:
    - path bypasses of the demo lock (case, trailing slash, `//`, `%2D`, query string, `/./`) are all
      blocked;
    - an uppercase-email login is locked;
    - unlinking the last account, password reset and verification email are blocked;
    - switching the demo visitor's active organization is refused.
- **Notes, not blocking:**
  - (a) `list-sessions` shows other demo visitors' raw session tokens. They are unusable without the
    signing secret today, but would become exploitable if a bearer-token plugin were ever added.
  - (b) New ledger tables need their own REVOKE, because default privileges still grant UPDATE and
    DELETE.
  - (c) After merge, `nile_app` cannot use `SELECT … FOR UPDATE` on these tables; PostgreSQL requires
    UPDATE privilege for row locks. No current code does this.

## 3. Branch heads and ancestry

| Branch | Head | Relation to `main` |
| --- | --- | --- |
| `main` | `ebcfe72` | — |
| `fix/nile-gate-ledger-append-only-demo-lock` (PR #4) | `784e50c` | 1 commit on top of `ebcfe72` |
| `arena/bfcb5ed1-mohamed-app-factory` (Odoo) | `e61cd06` | Forked at `bb0cb4f`; **16 `main` commits missing**; 7 own commits (`bf3bce8`, `9c85d8a`, `b00e984`, `0ce506f`, `aa41b97`, `9082cc9`, `e61cd06`). Not mergeable wholesale; left untouched |
| `docs/consolidate-option-c-evidence` (new, local) | `ce6f328` | 3 commits on top of `ebcfe72` |
| `arena/01a06b01`, `feat/nile-e2e-auth-sale`, `feat/nile-engines-wave2-db`, `feat/nile-engines-v1` | various | Already merged into `main` |

## 4. Selected files and commits

All files come from the Odoo branch at `e61cd06`. Nothing was cherry-picked commit by commit; the files
were imported as a set, and each one's adding commit is recorded.

- **Imported, 23 files:**
  - proposals 0002–0005;
  - ADR-0008 (Proposed);
  - the localization ADR, now **ADR-0009**;
  - review 0001 and its probe;
  - `tools/spikes/option-c/`: README, 7 probe scripts, 7 artifacts including
    `arabic_invoice_probe.png` and `.pdf`.
- **Integrity:** every original measurement and artifact is byte-identical to the source. Blob IDs are
  listed per file in `docs/architecture/README.md` §3.
- **Not imported, still on the source branch, with permanent links in the index:**
  - proposal 0001 (re-argues the stack that accepted ADR-0001 decides);
  - the branch's second ADR index;
  - its outdated README.

## 5. Conflicts and obsolete material

- **ADR numbering:**
  - The branch's ADR-0001 (localization) collided with `main`'s ADR-0001. Its planned new number,
    ADR-0007, is now `main`'s roles ADR, so it became **ADR-0009**, with only the heading number changed.
  - Citations were updated where the meaning is certain: 6 to ADR-0009 and 8 to ADR-0008.
  - Labels for records never written ("ADR-0003 first application", "ADR-0004 tenancy") are explained by
    a numbering-key banner, not rewritten.
  - `DECISIONS.md` was also missing `main`'s ADR-0007; it has been added.
- **Six broken links on the source branch:** all fixed.
- **ADR-0008 corrections:** recorded in a labelled §10 addendum; the recommendation and status are
  unchanged.
  - Its "no application code until decided" conflicts with the engines-first direction. This is surfaced
    as owner decision D1.
  - It said `main` left tenancy open; in fact `main`'s ADR-0002 decides a shared database for
    Milestone 1.
  - Review 0001 describes a pre-PR #3 commit.
  - M9 and M10 have no committed scripts.
- **Overstated claim:** the Arabic PDF evidence shows correct Arabic letter shaping, but a
  **left-to-right page layout**. An RTL layout is not demonstrated. Reviewer notes were added; the
  original wording is kept.
- **Stale statements:**
  - two round-1 "known limitations" in the spike README are struck through and annotated;
  - the artifacts README mis-describes one HTML file, which does carry `dir="rtl"`.
- **Review 0001 status today:**
  - H1–H3, H5, H6, H8 and H10–H11 are fixed on `main`;
  - H4 is fixed by PR #4 (unmerged);
  - H7 and H9 (double booking) are open, as are the low-severity H12 and H13.

## 6. Integration branch

- **Branch:** `docs/consolidate-option-c-evidence` @ **`ce6f328933d02551a021b94d38ac7906228edea9`**,
  based on `main` `ebcfe72`.
  - `d81cf97`: verbatim import;
  - `bf23dad`: numbering, links and labelled corrections;
  - `ce6f328`: ADR index, provenance and decision memo.
- **Size:** 27 files, +22,472 lines, 0 deletions. Docs and spike tools only; no application code.
- **Checks:**
  - 59 relative links in 38 Markdown files resolve;
  - ADR numbers 0001–0009 are unique and match `DECISIONS.md`;
  - no tokens, keys, dumps or runtime state;
  - typecheck clean, 91/91 tests pass.
- **Not pushed:** no credential is available. Handoff file
  `handoff/docs-consolidate-option-c-evidence.bundle` (651,926 bytes) is verified and applies cleanly on
  `ebcfe72`. Not merged.

## 7. Consolidated ADR-0008 proposal and remaining decisions

- **Status:** ADR-0008 remains **Proposed**. Its recommendation is to adopt Odoo behind a `LedgerProvider`
  port **only if** all of these pass:
  - a paid pilot with live ETA submission;
  - Odoo's own Arabic PDF with RTL layout;
  - an accepted upgrade cost;
  - a measured alternative.
- **Odoo is viable, but not proven.**
  - Proven: invoices validate for ETA locally; the HTML report switches to RTL.
  - Proven: the API has **no** duplicate protection, so Nile must supply it.
  - Unproven: live ETA submission; Odoo's own Arabic PDF.
  - Never measured: B2C **e-receipts**, the tax regime that actually governs a cashier.
  - ERPNext has not been measured at all.
- **Memo:** `docs/architecture/proposals/0006-ledger-decision-memo.md`.
- **Owner decisions, in plain terms:**
  - **D1:** keep building Nile's engines while the accounting choice is open? Recommended: yes.
  - **D2:** measure ERPNext, time-boxed, before choosing? Recommended: yes.
  - **D3:** who holds each customer's tax credentials and signing key, and will one real business run a
    paid tax pilot? Recommended: the customer holds them, Nile operates the integration, and one
    consenting pilot business.
  - **D4:** budget and licence route for accounting reports. Recommended: decide after the pilot, with a
    legal opinion.

## 8. Payment engine: status and blockers

- **Status:** **design only** in `handoff/2026-10-14-payment-engine-design.md`. No code and no branch.
  - Nile-owned and independent of the accounting choice.
  - Covers shifts, split tender and change, refunds, and pending cash.
  - Every new table is append-only, with its own REVOKE.
  - Concurrency uses advisory locks, because row locks are unavailable after PR #4.
  - Required tests, including real two-connection race tests, are listed.
- **Blockers:**
  1. PR #4 must be merged (owner authorization).
  2. Then a new branch from the then-current `main`.
- **Cashier UI:** stays blocked until the payment engine and the gate pass.
- **Problems this design must solve:**
  - today's sale records no payment;
  - after PR #4, the cash table's `pending → posted` update would fail.

## 9. Exact next action

**Owner:** review and merge PR #4 (ideally after a second reviewer looks at it), and revoke the token
pasted earlier. Then answer D1–D4 in proposal 0006; D1 alone unblocks the payment engine.

**Engineering, after the merge:**

1. Publish `docs/consolidate-option-c-evidence` from the bundle and open it as a docs PR. It is
   independent of PR #4.
2. Branch `feat/nile-payments` from the new `main` and implement the payment design, tests first.
