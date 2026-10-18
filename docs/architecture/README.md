# Ledger evidence: index, provenance, and status

This directory holds the evidence behind the open **build vs. adopt** question for Nile's regulated core
(double-entry ledger, Egyptian tax, ETA e-invoicing). The question itself is
[ADR-0008](../adr/0008-build-vs-adopt-ledger-substrate.md), which is **Proposed** and decides nothing.
The decisions still open, framed for the owner, are in
[proposal 0006](proposals/0006-ledger-decision-memo.md).

This material was consolidated on 2026-10-14 onto branch `docs/consolidate-option-c-evidence`, based on
`main` at `ebcfe72`. It came from branch `arena/bfcb5ed1-mohamed-app-factory` at `e61cd06`. That branch
was never rebased onto `main` and is 16 commits behind it, so it was not merged wholesale. Its files were
imported verbatim in one commit (`d81cf97`), then reconciled in a second commit (`bf23dad`). Each edit in
`bf23dad` is listed in its commit message and labelled in the file.

## 1. Evidence index

| Document | What it is | Status |
| --- | --- | --- |
| [ADR-0008](../adr/0008-build-vs-adopt-ledger-substrate.md) | The decision record: options, scored evidence, conditional recommendation (Option C) | Proposed; §10 records the consolidation corrections |
| [ADR-0009](../adr/0009-localization-arabic-rtl-first.md) | Arabic and RTL are first-class product requirements | Accepted (branch ADR-0001, renumbered) |
| [proposals/0002](proposals/0002-open-source-reuse-audit.md) | Open-source reuse audit: Odoo, ERPNext, Medusa, Cal.com and others | Desk research |
| [proposals/0003](proposals/0003-option-c-spike.md) | Spike plan: what to measure and the pass/fail criteria | Plan |
| [proposals/0004](proposals/0004-option-c-results.md) | Round-1 spike results | Partly superseded by 0005 |
| [proposals/0005](proposals/0005-option-c-evidence.md) | Round-2 measurements M1, M6, M8, M9, M10 | Main evidence; §3.4 carries a review note |
| [ADR-0010](../adr/0010-engines-continue-behind-ledger-provider-port.md) | Owner's D1: engines continue; ledger only behind a provider-neutral port | Accepted |
| [proposals/0006](proposals/0006-ledger-decision-memo.md) | Decision memo: viability, boundary, topology, ETA responsibility, owner decisions | Proposed |
| [proposals/0007](proposals/0007-payment-engine.md) | Payment engine design (Nile-owned, provider-neutral) | Proposed; implementation gated on the PR #4 merge |
| [reviews/0001](../reviews/0001-nile-engines-db-auth-review.md) | Review of the engines at `0811ae0` (before PR #3) | Historical; see §5 |
| [`tools/spikes/option-c/`](../../tools/spikes/option-c/README.md) | Probe scripts (Python / Node) and output artifacts | Reproducible only against a throwaway local Odoo 19 CE |
| [`tools/spikes/nile-review/`](../../tools/spikes/nile-review/probe-db-findings.mjs) | Probe for review 0001 | Reproduces only at `0811ae0` |

## 2. Facts, reported results, hypotheses, limitations, recommendations

**Facts: measured, with a committed script or artifact that shows it.**

- F1. With `l10n_eg` and `l10n_eg_edi_eta` configured, Odoo 19 CE posts a customer invoice with zero ETA
  validation errors. The journal entry balances, at a total of 11,400 (probe 4, `invoice_facts.json`).
  The document was not signed and was not submitted to ETA.
- F2. Odoo's JSON-RPC API has no idempotency. Sending the same create call twice produces two documents,
  and the median round trip was 508 ms (probe 5).
- F3. Odoo's HTML invoice report gets `dir="rtl"` from the report or user language. Only `ar_001` exists
  (there is no `ar_EG`). 208 of 209 accounts carry Arabic names (probe 6 and the HTML artifacts).
- F4. An independent PDF renderer shapes Arabic correctly, but the committed PNG has a left-to-right page
  layout (ADR-0008 §10, C4).
- F5. On `main`, Nile itself keeps one shared PostgreSQL database with row-level security as the tenant
  boundary (ADR-0002, ADR-0005), and that boundary is tested.

**Reported: measured on the source branch, but no script is committed.**

- R1. The free community upgrade path from 18 to 19 failed, so a paid Odoo upgrade service would be
  needed. The proposal also cites the vendor's terms: a 25 % surcharge if the database is four or more
  releases behind. That is a vendor claim, not checked here.
- R2. Per-tenant database operations on two tenants: clone 276 ms, dump 428 ms, restore 2,179 ms.

**Hypotheses: plausible, not demonstrated.**

- H-a. Odoo can produce a correctly laid out RTL Arabic PDF through its own report engine.
  Odoo's own PDF output was never produced, because the environment had no `wkhtmltopdf`.
- H-b. Live ETA submission succeeds with real taxpayer credentials and an eSeal.
- H-c. Per-tenant Odoo databases stay operable beyond two tenants.
- H-d. ERPNext could meet the same bar. It has not been measured at all.
- H-e. Odoo's POS e-receipt module (`l10n_eg_edi_pos`) covers Egypt's B2C e-receipt mandate for Nile's
  cashier use case. Nothing about it was measured, and it is not yet known which edition includes it.

**Limitations of this evidence.**

- One machine and one Odoo version. There was no concurrency testing and no more than two tenants.
- ETA was exercised only up to local validation. Signing, preproduction and production were never
  reached, and no credentials or certificates were used.
- The measurements cover B2B e-invoicing. B2C e-receipts, which govern point-of-sale sales, were not in
  scope.
- The probes include throwaway local default credentials (`admin`/`admin`). They are not real secrets.
  No database dumps or runtime state were committed.

**Recommendations, as stated by the source documents (not decisions).**

- ADR-0008 §6: Option C (Odoo behind a `LedgerProvider` port) **only if** a paid pilot with live ETA
  passes, Odoo's own RTL Arabic PDF passes, the upgrade cost is accepted, and an alternative is measured.
- Consolidation (proposal 0006): keep Nile's operational engines independent of this choice. **Accepted
  on 2026-10-14 as [ADR-0010](../adr/0010-engines-continue-behind-ledger-provider-port.md)** (owner's D1).
  The payment engine is designed as Nile-owned ([proposal 0007](proposals/0007-payment-engine.md)).

## 3. Provenance of imported files

Source: `arena/bfcb5ed1-mohamed-app-factory` at `e61cd06`. "Added in" is the source commit that first
added the file. "Blob" is the git blob ID at `e61cd06`, so `git cat-file -p <blob>` reproduces the
original bytes.

| Path here | Original path | Added in | Blob at `e61cd06` | Here |
| --- | --- | --- | --- | --- |
| `docs/adr/0008-build-vs-adopt-ledger-substrate.md` | same | `e61cd06` | `8f39648336` | edited in `bf23dad` |
| `docs/adr/0009-localization-arabic-rtl-first.md` | `docs/adr/0001-localization-arabic-rtl-first.md` | `9c85d8a` | `97066b2018` | edited in `bf23dad` (heading number only) |
| `docs/architecture/proposals/0002-open-source-reuse-audit.md` | same | `9c85d8a` | `e403d4f8d1` | edited in `bf23dad` |
| `docs/architecture/proposals/0003-option-c-spike.md` | same | `b00e984` | `48aab96757` | edited in `bf23dad` |
| `docs/architecture/proposals/0004-option-c-results.md` | same | `0ce506f` | `8532ce0e4b` | edited in `bf23dad` |
| `docs/architecture/proposals/0005-option-c-evidence.md` | same | `e61cd06` | `4c5085b8ed` | edited in `bf23dad` |
| `docs/reviews/0001-nile-engines-db-auth-review.md` | same | `aa41b97` | `efff68a45a` | edited in `bf23dad` |
| `tools/spikes/nile-review/probe-db-findings.mjs` | same | `aa41b97` | `36691b0451` | verbatim |
| `tools/spikes/option-c/README.md` | same | `0ce506f` | `8c93c49d28` | edited in `bf23dad` |
| `tools/spikes/option-c/artifacts/README.md` | same | `9082cc9` | `665d19e989` | edited in `bf23dad` |
| `tools/spikes/option-c/artifacts/arabic_invoice_probe.pdf` | same | `9082cc9` | `7e9dd72e96` | verbatim |
| `tools/spikes/option-c/artifacts/arabic_invoice_probe.png` | same | `9082cc9` | `03fd133c49` | verbatim |
| `tools/spikes/option-c/artifacts/invoice_facts.json` | same | `9082cc9` | `98828e7bdd` | verbatim |
| `tools/spikes/option-c/artifacts/odoo_invoice_report.html` | same | `9082cc9` | `deb08f1b92` | verbatim |
| `tools/spikes/option-c/artifacts/odoo_invoice_report_ar.html` | same | `9082cc9` | `d33dd9a0e9` | verbatim |
| `tools/spikes/option-c/artifacts/odoo_invoice_report_ar_userlang.html` | same | `9082cc9` | `d33dd9a0e9` | verbatim (byte-identical to `_ar.html`) |
| `tools/spikes/option-c/probe-1-initial.py` | same | `0ce506f` | `40dc05be52` | verbatim |
| `tools/spikes/option-c/probe-2-egyptian-localization.py` | same | `0ce506f` | `2f245e7ca0` | verbatim |
| `tools/spikes/option-c/probe-3-eta-configuration.py` | same | `0ce506f` | `4f54eac42b` | verbatim |
| `tools/spikes/option-c/probe-4-eta-configured-invoice.py` | same | `9082cc9` | `b840b6e253` | verbatim |
| `tools/spikes/option-c/probe-5-api-ergonomics.mjs` | same | `9082cc9` | `9d88a84dbc` | verbatim |
| `tools/spikes/option-c/probe-6-arabic-pdf.py` | same | `9082cc9` | `9af9dc4cba` | verbatim |
| `tools/spikes/option-c/probe-6-arabic-report.py` | same | `9082cc9` | `0c4594dbbc` | verbatim |

### Not imported, preserved on the source branch

| File at `e61cd06` | Reason |
| --- | --- |
| [`docs/architecture/proposals/0001-platform-strategy.md`](https://github.com/mohamedmasoud3030-tech/Mohamed-App-Factory/blob/e61cd06ea8a8a3b974c81627b692c23549355a3d/docs/architecture/proposals/0001-platform-strategy.md) | Re-argues the technology stack that accepted ADR-0001 already decides. ADR-0008 carries the live question |
| [`docs/adr/README.md`](https://github.com/mohamedmasoud3030-tech/Mohamed-App-Factory/blob/e61cd06ea8a8a3b974c81627b692c23549355a3d/docs/adr/README.md) | A second ADR index with conflicting numbering. `docs/DECISIONS.md` is the single index |
| [`README.md`](https://github.com/mohamedmasoud3030-tech/Mohamed-App-Factory/blob/e61cd06ea8a8a3b974c81627b692c23549355a3d/README.md) | The branch's repository README predates PRs #1–#3; `main`'s README is current |

## 4. Numbering map

| Branch label | Meaning | Here |
| --- | --- | --- |
| ADR-0001 (localization) | Arabic and RTL first | **ADR-0009** |
| ADR-0002 (build vs adopt) | Ledger substrate | **ADR-0008** |
| ADR-0003 (first application) | Planned, never written | none (`main`'s ADR-0003 covers Milestone 1 scope) |
| ADR-0004 (tenancy) | Planned, never written | none (`main`'s ADR-0002 and ADR-0005 decide it) |
| ADR-0007 (planned for localization in review 0001) | Superseded plan | `main`'s ADR-0007 is the roles ADR |

## 5. Review 0001 disposition on current `main` (`ebcfe72`)

Review 0001 reviewed `0811ae0` (PR #2). Its findings were addressed by PR #3, which followed the engines
review [`2026-10-14-engines-db-auth-review.md`](../reviews/2026-10-14-engines-db-auth-review.md) (finding
IDs F-n), and are cross-referenced below to the
[post-merge security gate](../reviews/2026-10-14-post-merge-security-gate.md) (finding IDs G-n). Live
status of every open finding: [`docs/STATUS.md`](../STATUS.md) §6. "Fixed" means the code changed and the
relevant test exists. It does not mean the system is production ready.

| Finding | Summary | Status |
| --- | --- | --- |
| H1 | Money: domain allows INT64, storage was 32-bit | Fixed by PR #3 |
| H2 | Two divergent schema sources | Fixed by PR #3 (migrations generated from the schema, drift check) |
| H3 | Cross-tenant referential integrity gap | Fixed by PR #3 (composite tenant foreign keys) |
| H4 | Audit trail editable or erasable by the app role | **Open on `main`**; fixed by PR #4 (open, not merged) |
| H5 | Auth absent / tenant-table collision | Fixed by PR #3 (Better Auth organizations) |
| H6 | No authorization model | Fixed by PR #3 (ADR-0007 roles) |
| H7 | No `CHECK` constraints on enum-like columns | **Open** (gate finding G-4) |
| H8 | Booleans stored as text | Fixed by PR #3 |
| H9 | Booking overlap not concurrency-safe (no `EXCLUDE`) | **Open** (gate finding G-10) |
| H10 | Production tenant path untested | Fixed by PR #3 (RLS suite runs as `nile_app` through `open.ts`) |
| H11 | No database plumbing | Fixed by PR #3 (client and migration path in `open.ts`) |
| H12 | Deep cross-engine imports | Open (Low) |
| H13 | Modelling gaps | Open (Low) |
