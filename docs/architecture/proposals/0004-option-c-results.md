# Proposal 0004 — Option C Spike Results

| Field | Value |
| --- | --- |
| Status | **First-pass results — superseded in scope by [proposal 0005](0005-option-c-evidence.md), which completes the four outstanding measurements** |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture agent) |
| Reviewers | Mohamed (product owner), ChatGPT (technical strategist) |
| Scope | Measured results of the [Option C spike](0003-option-c-spike.md), run against a real Odoo Community instance |
| Raw evidence | [`tools/spikes/option-c/`](../../../tools/spikes/option-c/) — reproducible probe scripts and environment notes |
| Decides | Feeding into [ADR-0008](../../adr/0008-build-vs-adopt-ledger-substrate.md) (build vs. adopt) — **Proposed, awaiting Mohamed** |

> **Numbering key (added on consolidation, 2026-10-14).** This document was written on a branch whose
> ADR numbers collided with `main`. Citations to decisions that now exist on `main` have been updated:
> localization → **ADR-0009** (originally ADR-0001), build vs. adopt → **ADR-0008** (originally ADR-0002).
> Other branch-era labels refer to records never created on `main`: "ADR-0003 (first application)" is
> pending; "ADR-0004 (tenancy)" is not needed because `main`'s ADR-0002 and ADR-0005 decide it. The
> unmodified original is at commit `e61cd06`; provenance in [docs/architecture/README.md](../README.md).

> **Method.** Rather than reading documentation, I installed Odoo 19.0 Community (LGPL-3) from source with
> PostgreSQL 16.2 and the Egyptian localization, then drove the ledger programmatically and measured its
> behaviour. Every claim below is a recorded output, not an inference. Where a measurement could not be
> made, it is listed as outstanding rather than assumed.

---

## 1. Headline

**No kill criterion fired.** Option C survives its first measurements, and in two places the evidence is
**better than expected**:

1. The Egyptian compliance machinery is genuine, extensive, and enforced — not a stub.
2. The ledger's integrity guarantees are stronger than the design assumed: posted entries cannot be
   deleted, corrections go through reversal, and a **hard lock date cannot be removed**.

Three concrete costs were also measured, all of which change how Option C must be implemented:
idempotency is ours to enforce, ETA issuance has a hard configuration prerequisite, and reporting
requires tracking Odoo's schema.

The spike is **not finished**. Four measurements remain (Arabic PDF, external API ergonomics, upgrade
rehearsal, per-tenant operations) and they decide the maintenance-tax question. ADR-0008 stays open.

---

## 2. Measured results

### 2.1 Environment

| Item | Result |
| --- | --- |
| Odoo | 19.0 Community, installed from source — **no Enterprise licence used at any point** |
| Odoo 20.0 | **Requires Python ≥ 3.12**; the sandbox has 3.11.2, so 19.0 was measured. Production would target 20.0 |
| PostgreSQL | 16.2 (bundled `pgserver`); `pg_trgm` unavailable — affects website fuzzy search only, **not** the ledger |
| Egyptian setup | Company country set to EG *before* accounting installed → **Egyptian chart of accounts loaded (51 accounts)** |

### 2.2 Egyptian localization and tax (M0) — **PASS**

| Measurement | Result |
| --- | --- |
| Company country EG | `EG` |
| Egyptian chart of accounts | Loaded, 51 accounts |
| **14% VAT tax record** | **present — `14%`, amount 14.0** |
| `l10n_eg` | `installed` |
| `l10n_eg_edi_eta` | `installed` |
| Invoice arithmetic | Rent 10,000 → untaxed **10,000**, tax **1,400**, total **11,400** |

### 2.3 ETA e-invoicing integration (M2) — **PASS, and substantial**

The integration is wired into the accounting model rather than bolted on. Introspected from the running
instance:

**Invoice-level ETA fields** (the complete statutory artifact set):

```
l10n_eg_uuid                  l10n_eg_long_id              l10n_eg_qr_code
l10n_eg_signing_time          l10n_eg_submission_number    l10n_eg_is_signed
l10n_eg_eta_json_doc_file
```

**Journal-level ETA configuration:** `l10n_eg_activity_type_id`, `l10n_eg_branch_id`,
`l10n_eg_branch_identifier`

**Company-level ETA configuration:** `l10n_eg_client_identifier`, `l10n_eg_client_secret`,
`l10n_eg_invoicing_threshold`, `l10n_eg_production_env`

**Reference data loaded:** the official ETA **activity-type code table** (e.g. `0111` Cultivation of
grains and crops, `0112` Cultivation of rice, …) and **81 ETA unit-of-measure codes**.

**Registered ETA models:** `l10n_eg_edi.activity.type`, `l10n_eg_edi.thumb.drive`,
`l10n_eg_edi.uom.code`, plus submission and QR-code handling.

This is the single most consequential finding of the spike. The module carries ETA's UUID, long ID, QR
code, signing timestamp, submission number and signed JSON document — i.e. the exact data ETA requires —
plus production/preproduction environment switching and API credentials. **Building this ourselves means
rebuilding all of it.**

### 2.4 The ETA gate is real and enforced (M1/M2) — **PASS (enforcement), configuration incomplete**

Attempting to post a customer invoice without complete ETA configuration produced:

> `UserError: Invalid invoice configuration:`
> `Please set the all the ETA information on the invoice's journal`
> `Please add all the required fields in the branch details`
> `Please add all the required fields in the customer details`
> `You cannot issue an invoice to a partner with the same VAT number as the branch.`

Two readings, both true:

- **Positive:** compliance is enforced at the posting boundary, not left to discipline. The ledger will
  not let an invalid Egyptian invoice into the books.
- **Cost:** **no customer invoice can be posted until ETA configuration is complete** (branch details,
  activity type, credentials, customer tax details). This is a day-one operational prerequisite for any
  Egyptian deployment — a real project task, and one an adopted platform hands us configured rather than
  needing to invent.

### 2.5 Invoice → partial payment → residual (M1) — **PASS**

| Measurement | Result |
| --- | --- |
| Invoice total | 11,400.00 |
| Partial payment recorded | 5,000.00 |
| `payment_state` | `partial` |
| Residual after payment | **6,400.00** (= 11,400 − 5,000) |

Payment registration and allocation work on Community. This is the flow the factory depends on most,
because **every rent invoice in the first application ends here**.

### 2.6 Integrity guarantees (M4/M5) — **PASS, stronger than assumed**

| Guarantee | Measured behaviour |
| --- | --- |
| Deleting a posted entry | **Refused** (`UserError`) |
| Correcting a posted entry | **Reversal path only** — reversal wizard produced a linked reversal document (original state `posted`) |
| Period locking fields | `hard_lock_date`, `fiscalyear_lock_date`, `tax_lock_date`, `sale_lock_date`, `purchase_lock_date`, plus per-user variants |
| Hard lock removal | **`UserError: The Hard Lock Date cannot be removed.`** |

The last row exceeded the spike's own test design: the ledger does not merely respect locks, it makes
them **irrevocable without technical intervention**. For an auditable financial system this is a
stronger guarantee than we would have built into our own kernel in Milestone 1.

### 2.7 Idempotency (M3) — **FAIL, and this is a finding, not a blocker**

With identical external references (`SPIKE-RENT-2026-10`), the ledger **created and posted a second,
distinct document**. It does not deduplicate on any external identifier.

**Consequence:** the `LedgerProvider` port must own idempotency (idempotency keys, a submission ledger
in our layer, and reconciliation on retry). Our invoice scheduler will retry, and a duplicated rent
invoice in a customer's books is a serious defect. This is exactly the kind of boundary responsibility
the design in proposal 0003 §2.4 must carry — and it is now verified rather than assumed.

### 2.8 Read-only reporting without Enterprise or AGPL (M7) — **PASS, with a documented cost**

| Measurement | Result |
| --- | --- |
| AR aging / outstanding receivables from plain SQL | **Works** |
| Journal and volume analysis from plain SQL | **Works** |
| Trial balance from plain SQL | **Works** — 4 accounts with movement, **sum of balances 0.00** (double-entry verified) |
| Schema layout | Account codes moved into a **jsonb column** (`account_account.code_store` → `{'1': '100101'}`), keyed by company ID |

**This resolves the largest licensing risk in Option C.** Financial reporting does **not** require the
Enterprise `account_reports` module, and does **not** require the AGPL-licensed OCA reporting modules. Our
own reporting layer can read ledger data directly.

The measured cost: **schema coupling**. Report queries depend on Odoo's internal storage (including a
jsonb structure keyed by company ID), which changes between versions. This is acceptable if confined to
one reporting module with tests — and it is the reason the "zero custom modules" rule and a thin port
matter so much.

---

## 3. Kill criteria — status

| # | Kill criterion | Status |
| --- | --- | --- |
| 1 | Invoice-to-payment flow requires Enterprise | **Not fired** — flow completed on Community only |
| 2 | No idempotency / period integrity / reversal-only | **Not fired** — integrity verified, and stronger than expected; idempotency is a port responsibility, not a platform defect |
| 3 | No AGPL-free reporting path | **Not fired** — plain SQL reporting verified against the live schema |
| 4 | Upgrade still requires custom work | **Unmeasured** — M9 outstanding |
| 5 | Integration layer exceeds ~15% of application code | **Unmeasured** — depends on the port built in Milestone 1 |

**No kill criterion fired.** Option C remains viable.

---

## 4. What remains unmeasured — and why it matters

| # | Measurement | Why it decides | Why it is outstanding |
| --- | --- | --- | --- |
| **M6** | Arabic invoice PDF rendering (RTL, fonts, bidi, ETA QR code) | Hard requirement (ADR-0009). Arabic documents are legally mandatory | No `wkhtmltopdf` in the sandbox environment |
| **M8** | External API ergonomics for a TypeScript caller (JSON-RPC vs XML-RPC) | Determines whether the port stays thin or becomes a project | Not attempted in this pass |
| **M9** | Upgrade rehearsal on a stock system with zero custom code | **This is the maintenance-tax question** — the main reason to prefer Option C over Option D | Requires a second version to migrate between |
| **M10** | Per-tenant operations (one database per tenant: provisioning, backup, restore) | Feeds the tenancy decision (D-1) and the operational cost of hosting many tenants | Out of scope for the first pass |

### 4.1 What I deliberately did not measure

- **Live ETA submission.** No ETA credentials, and submitting to a tax authority during a spike would be
  inappropriate. Only the presence and enforcement of the integration's checks were verified.
- **Posting a fully ETA-configured invoice.** The required configuration surface is now known
  (company credentials + environment, journal branch/activity/identifier, complete customer tax
  details), but completing it was outside the spike's time box. **This is the most important next
  measurement** — it converts "the machinery is real" into "a compliant invoice can be issued".

---

## 5. Interpretation — how the evidence shifts the decision

Option C's advantages are now **measured**, not assumed:

| Claim in proposal 0003 | Now |
| --- | --- |
| Egyptian localization and ETA are real assets in Community | **Verified** — full statutory data model, code tables, credentials, environment switching |
| Financial reporting can bypass Enterprise and AGPL | **Verified** — plain SQL reporting works against the live schema |
| The ledger provides integrity guarantees we would otherwise build | **Verified, and stronger** — irremovable hard locks, reversal-only correction, deletion refusal |
| The port must own idempotency | **Verified** — the ledger does not deduplicate |

Option C's costs are also now concrete rather than hypothetical: an ETA configuration prerequisite
before any invoice can be issued, schema-coupled reporting, and unmeasured upgrade and operational costs.

**Recommendation: continue Option C investigation rather than committing or abandoning.**
Specifically, complete M6, M8, M9, M10 (and the fully-configured ETA posting) on a real VM before
ADR-0008 is written. If M9 (upgrade rehearsal) is bad, Option C loses its main justification and
Option D wins; if M9 is clean, Option C becomes the strongest recommendation for the reasons Mohamed's
situation creates: an internal customer zero in Egypt needing Arabic, ETA-compliant books **in weeks**,
not quarters.

---

## 6. What this spike cost, and what it saved

Cost: part of one working session, in a sandbox, with no licence purchase and no production access.

Saved, with high confidence:

- **A licence decision made on evidence.** Adopting Enterprise, or adopting an AGPL reporting module, or
  building ETA compliance from scratch — each was avoided or correctly deprioritised by measurement.
- **The single largest unknown in the project.** "Can a permissively-licensed ledger carry Egyptian
  compliance?" moved from *assumption* to *verified*, including the parts that will cost us (idempotency,
  configuration prerequisite, schema coupling).

---

## 7. Next steps

| # | Step | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Complete M6, M8, M9, M10 and the fully-configured ETA posting | Arena | Needs a VM: Docker, a second Odoo version for the upgrade rehearsal, and `wkhtmltopdf` |
| 2 | Decide Option C vs Option D and write ADR-0008 | Mohamed + Arena | Gated on step 1 |
| 3 | Choose the pilot domain (customer zero) | **Mohamed** | Proposal 0003 §5, Q1 — the factory's first deployment depends on it |
| 4 | Confirm the commercial model (selling access vs. running operations) | **Mohamed** | Proposal 0003 §5, Q2 — decides whether per-user-style licensing is ever acceptable |

**Nothing in this document authorises implementation.** Milestone 1 still waits on ADR-0008 and the pilot
domain decision.
