# Proposal 0003 — Option C Spike: adopted ledger and compliance back-office

| Field | Value |
| --- | --- |
| Status | **In progress — first pass complete; no kill criterion fired.** See [results](0004-option-c-results.md) |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture agent) |
| Reviewers | Mohamed (product owner), ChatGPT (technical strategist) |
| Scope | Define and bound the investigation of Option C: a permissively-licensed ERP owns the ledger and statutory compliance; our own TypeScript layer owns the domain and the user experience |
| Depends on | [`0002-open-source-reuse-audit.md`](0002-open-source-reuse-audit.md) · [`docs/adr/0009`](../../adr/0009-localization-arabic-rtl-first.md) |
| Decides | ADR-0008 (build vs. adopt) and the shape of Milestone 1 |

> **Numbering key (added on consolidation, 2026-10-14).** This document was written on a branch whose
> ADR numbers collided with `main`. Citations to decisions that now exist on `main` have been updated:
> localization → **ADR-0009** (originally ADR-0001), build vs. adopt → **ADR-0008** (originally ADR-0002).
> Other branch-era labels refer to records never created on `main`: "ADR-0003 (first application)" is
> pending; "ADR-0004 (tenancy)" is not needed because `main`'s ADR-0002 and ADR-0005 decide it. The
> unmodified original is at commit `e61cd06`; provenance in [docs/architecture/README.md](../README.md).

---

## 1. Why this spike exists

Mohamed selected Option C for investigation before committing. That was the right call, and new evidence
has since made it more important, not less. This document defines the spike so that it produces a
**measurable decision** rather than an open-ended evaluation.

### 1.1 What changed since proposal 0002

Proposal 0002 scored Option D (build everything) highest, with Option C second at a clear gap. Two things
have moved since:

**1. The Egyptian ETA module in Odoo Community is far more substantial than "a module exists" implies.**
I read the source (`addons/l10n_eg_edi_eta`) rather than trusting its presence:

| Evidence | Detail |
| --- | --- |
| Licence | **LGPL-3** — verified in `__manifest__.py`, authored by Odoo S.A. |
| Core integration | `models/account_move.py` — **37 KB** |
| API client | `lib/eta_client.py` |
| Serialization | `tools/eta_serialize.py` |
| **Test coverage** | `tests/test_edi_json.py` — **44 KB**, plus a shared test harness |
| Egyptian domain data | ETA **activity-type code table** and **unit-of-measure code table** as CSVs |
| Operational flows | `eta_submission`, `res_currency_rate` (FX), cancellation wizard, QR-code view, attachment handling, bilingual invoice report override, activity/UoM admin views |

This is a maintained specialist compliance asset covering code tables, FX, cancellation, QR codes and
signing — with a test suite larger than its own integration code. The honest implication: **"we will just
build ETA ourselves" is a multi-month project with permanent maintenance obligations**, because ETA's
requirements evolve and non-compliance is fined. My original estimate of "weeks, not quarters" in proposal
0002 §6.4 was optimistic and I am correcting it here.

**2. Mohamed's answers to the audit's questions.**

| Answer | Consequence |
| --- | --- |
| Purpose: **both** — a product for external customers, with his own companies as customer zero | Differentiation still matters (product), but the first deployment is internal, where total cost of ownership matters more than differentiation |
| **No external customers lined up yet** | The near-term value is an internal system that works; a 12-month platform build cannot be justified by a product with no validated demand |
| Arabic + RTL required (ADR-0009), Egypt compliance in scope | The compliance layer is not a future concern — it is a day-one requirement |

### 1.2 Revised scoring, stated honestly

Re-scoring Option C under the new evidence and Mohamed's answers (same weights as proposal 0002 §9):

| Criterion (weight) | D: build everything | C: adopted ledger |
| --- | --- | --- |
| Licensable with commercial clarity (20) | 5 → 100 | 3 → **4** → 80 |
| Differentiation / defensibility (20) | 5 → 100 | 5 → 100 |
| Egypt compliance: ETA + Arabic/RTL (15) | 4 → 60 | 5 → 75 |
| AI-agent modifiability (15) | 5 → 75 | 4 → 60 |
| Maintenance / upgrade tax (10) | 5 → 50 | 3 → 30 |
| Time to first revenue (10) | 3 → 30 | 3 → **4** → 40 |
| Accounting correctness risk (5) | 4 → 20 | 5 → 25 |
| Operational complexity (5) | 5 → 25 | 2 → **3** → 15 |
| **Total (max 500)** | **460** | **425** |

**The honest conclusion: the matrix no longer separates the two options.** The 35-point gap is well inside
the noise of my own scoring, and the two largest differences run in opposite directions (Option D wins on
maintenance and agent velocity; Option C wins on compliance and time to a working internal system). Only
measurement can decide this, which is exactly what the spike is for.

---

## 2. What Option C actually is

The common failure of "adopt an ERP and build a front-end" projects is that the adopted system slowly
becomes the application: custom scripting appears, business logic migrates into the ERP, and the project
turns into an ERP customization shop. Option C is defined here specifically to make that failure
structurally impossible.

### 2.1 Architecture

```
        OUR LAYER (TypeScript, MIT/Apache components, RTL-first)
  ┌──────────────────────────────────────────────────────────────┐
  │  domain: properties, units, leases, tenants, charges         │
  │  UI: Arabic RTL, MUI or Ant Design, Refine-based screens     │
  │  workflows: lease lifecycle, billing runs, reminders         │
  │  our reporting: read-only over ledger data                   │
  └───────────────┬──────────────────────────────┬───────────────┘
                  │ LedgerProvider port          │ read-only
                  │ (JSON-RPC)                   │ reporting views
                  ▼                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  ADOPTED LEDGER — Odoo Community (LGPL-3), stock, configured │
  │  chart of accounts · journals · invoices · taxes · payments  │
  │  ETA e-invoicing (l10n_eg_edi_eta) · Arabic/bilingual PDFs   │
  │  NO CUSTOM PYTHON MODULES — configuration only               │
  └──────────────────────────────────────────────────────────────┘
```

### 2.2 The central rule: zero custom modules in the adopted system

**We do not write Python modules for Odoo.** Configuration, data, and access only. If a requirement cannot
be met by configuration, it is met in our TypeScript layer, or the requirement is deferred — the adopted
system is never extended.

This single rule is what keeps Option C out of the failure mode:

| Without the rule | With the rule |
| --- | --- |
| Annual Odoo upgrades require migrating our Python modules | Upgrades are Odoo's problem; we upgrade a stock system |
| Business logic lives in two codebases | All logic lives in our TypeScript layer |
| Every change needs a running Odoo server to validate | Our layer stays fast, typechecked, and testable |
| The AGPL boundary becomes relevant (OCA modules) | Only LGPL-3 core is used; AGPL is never introduced |
| The project becomes an Odoo shop | The project stays a product with a ledger behind a port |

**Corollary — reporting:** financial statements are Enterprise-only in Community and the community
alternative (OCA) is AGPL-3.0. Therefore **our own reporting layer reads ledger data read-only** (database
views or API reads). Reading data carries no copyleft obligation; the cost is schema coupling, which is
accepted knowingly and confined to one reporting module.

### 2.3 Data ownership — one source of truth per fact

| Fact | Owner | Notes |
| --- | --- | --- |
| Journal entries, postings, balances | **Ledger** | Append-only; we never write entries directly, only through the port |
| Tax computation on invoices, ETA submission status, UUID/QR | **Ledger** | Statutory record must live where compliance is implemented |
| Customers/parties used for invoicing | **Ledger** (as accounting partners) | Mirrored from our `parties` module; mapping stored in our layer |
| Properties, units, leases, tenants, contracts | **Our layer** | Never duplicated into the ledger as structured data |
| Rent schedules, billing runs, reminders, work orders | **Our layer** | Drive invoice creation through the port |
| Screens, permissions for our users, Arabic UX | **Our layer** | Ledger UI is for accountants only |

### 2.4 The `LedgerProvider` port — capabilities to verify

Stated as capabilities with semantics, not as code:

| Capability | Semantics that must hold |
| --- | --- |
| Ensure partner | Idempotent by our party ID; returns the ledger partner ID |
| Issue invoice | Idempotent by our invoice ID (retry must not double-post); returns ledger document ID and ETA status |
| Void or cancel invoice | **Reversal, never deletion**; respects ETA cancellation rules and the three-day window |
| Record payment | Allocatable to one or more invoices; partial payments supported |
| Read account balances / trial balance / account statement | Read-only; date-bounded; per fiscal period |
| Read outstanding receivables (aging) | Read-only; drives our dashboards |
| Fiscal period status | Closed periods reject posting; our layer must never attempt it |
| Every write | Carries an idempotency key and an actor identity for audit |

---

## 3. Spike plan

### 3.1 Timebox and environment

| Item | Plan |
| --- | --- |
| Timebox | **3 working days** of agent time; hard stop. Day 4 is the report, not more investigation |
| Environment | One cloud VM, Ubuntu LTS, Docker Compose: Odoo Community (current stable) + PostgreSQL. Egyptian company profile with 14% VAT, `l10n_eg` chart of accounts, Arabic (ar_EG) enabled |
| Out of scope | Any production deployment, any multi-tenant provisioning, any purchase, any legal opinion |
| Artefacts | A completed measurement table (§3.3), raw evidence, and a recommendation |

### 3.2 Steps

| Day | Step | Output |
| --- | --- | --- |
| 1 | Install and configure stock Odoo Community with the Egyptian localization; enable Arabic; **confirm no Enterprise feature is required for the invoice-to-payment flow**; confirm the external API works and document exactly how (JSON-RPC vs XML-RPC) | A working stock instance + notes |
| 2 | Drive it from outside Odoo, from a throwaway TypeScript script: ensure partner → issue invoice → verify ETA submission path and QR/UUID handling → record a partial payment → record the balance → attempt a post into a closed period (expect refusal) → retry the same invoice twice (**expect exactly one invoice**) → void by reversal | Measurement table rows filled with pass/fail, not opinion |
| 3 | Arabic invoice PDF quality check (render, inspect, compare against ETA content requirements); read-only reporting test (can we reconstruct trial balance, AR aging and a per-tenant statement from the database/API?); measure upgrade cost on a stock system with zero custom code; sketch the per-tenant operations model | Measurement table completed + operations sketch |
| 4 | Write the report: measured results, unresolved unknowns, recommendation, and the ADR | `0004-option-c-results.md` + ADR-0008 |

### 3.3 Measurements and pass criteria

| # | Measurement | Pass criterion | Why it decides |
| --- | --- | --- | --- |
| M1 | Issue invoice + record payment with **zero Enterprise features** | Pass | If this needs Enterprise, Option C's economics change completely (per-user resale licence) |
| M2 | ETA submission path reachable from Community | Pass, with the integration point named | The core compliance claim of Option C |
| M3 | Idempotency: same invoice submitted twice | Exactly one document | Our scheduler may retry; duplication in a ledger is unacceptable |
| M4 | Closed-period posting refused | Refused with a clear error | We must be able to rely on the ledger's integrity guarantees |
| M5 | Reversal-only correction path | Reversal, never delete | Audit integrity (proposal 0001, C5) |
| M6 | Arabic invoice PDF renders correctly | Correct RTL, fonts, and bidi; required fields present | Hard requirement per ADR-0009 |
| M7 | Reporting reconstruction from read-only access | Trial balance + AR aging + tenant statement reproducible | Replaces Enterprise `account_reports` **without** AGPL |
| M8 | External API ergonomics for a TS caller | Documented, workable without generated clients | Determines whether the port stays thin |
| M9 | Upgrade rehearsal on stock + zero custom code | One version upgrade completed without code changes | Quantifies the maintenance tax |
| M10 | Per-tenant operations model | One database per tenant, documented provisioning/backup/restore | Feeds the tenancy decision (D-1) |

### 3.4 Kill criteria — when we stop and choose Option D

The spike is a decision instrument, not a commitment. Any of the following ends Option C:

1. **M1 fails** — the invoice-to-payment flow requires an Enterprise licence. Per-user resale licensing
   destroys the product economics.
2. **M3, M4 or M5 fails** — the ledger cannot guarantee idempotency, period integrity, or reversal-only
   correction. These are correctness guarantees we are adopting precisely to avoid building.
3. **M7 fails and no AGPL-free reporting path exists** — if financial reporting requires either an
   Enterprise licence or AGPL modules, the licensing advantage of Option C disappears.
4. **M9 fails** — if upgrades on a stock system still require custom work, the maintenance tax is real and
   Option C loses its main operational justification.
5. **The integration layer exceeds ~15% of application code** — if the port and its mapping logic grow
   beyond a thin boundary, the two-system cost has stopped being worth it and we are building a bridge we
   will maintain forever.

### 3.5 What cannot be determined without a live environment

Recorded explicitly so the review is honest about the limits of desk research:

- Whether Odoo Community's ETA integration is **complete and currently compliant** against ETA's live
  requirements (the code is substantial and tested; live compliance is **UNVERIFIED**).
- Real-world Arabic PDF rendering quality without manual inspection.
- Actual effort to build the `LedgerProvider` boundary in TypeScript.
- Upgrade effort in practice, per version, over a multi-year horizon.
- Operational cost per tenant at realistic data volumes.

---

## 4. Sequencing advice given Mohamed's answers

Mohamed's answers were "both" (product plus internal customer zero) and "no external customers lined up
yet". That combination is the strongest strategic position available and also the most dangerous, because
nothing external forces the plan to become real.

### 4.1 The risk, named

> Building a factory for a product with no external customers, justified by internal use, is the classic
> way to spend a year and produce neither a product nor a working internal system.

### 4.2 Two rules that address it

**Rule 1 — customer zero means a real user, not a placeholder.** Every capability in the factory must be
exercised first by a real person in one of Mohamed's own companies, with a real workflow, doing real work.
If nobody would actually use it this month, it does not get built this month.

**Rule 2 — a demand gate before Milestone 2.** Before the factory is extended for a second application, at
least one of the following must be true: an external customer is running a pilot, or a signed agreement /
letter of intent exists, or Mohamed's own company has used the first application in production for at least
one full billing cycle. The gate is deliberately about *external confirmation*, not enthusiasm.

**Rule 3 — the domain must be chosen by pain, not by interest.** With no external customer, picking
"sales management" or "property management" on market reasoning alone is guessing. The correct selector is:
*which of Mohamed's own businesses has a painful, recurring, unpaid-software problem right now?* That
answer also produces the fastest and most honest pilot.

### 4.3 Practical consequence for the first deployment

If Option C passes the spike, Mohamed gets a working, Arabic, ETA-compliant ledger for his own company in
**weeks**, with our domain layer built on top of it incrementally. If Option C fails the spike, we commit
to Option D — with the corrected understanding that we are also committing to authoring and maintaining
Egyptian e-invoicing compliance ourselves, and that this must be planned as a first-class workstream rather
than a task.

---

## 5. Open input needed from Mohamed

| # | Input | Blocks |
| --- | --- | --- |
| Q1 | Which of Mohamed's own businesses should be customer zero, and what is its most painful recurring manual process? | Milestone 1 domain and the pilot |
| Q2 | Is the product ambition priced on **selling** access to other businesses, or on running operations for them? This changes whether per-user-style pricing is even acceptable | The Option C economics (M1) |
| Q3 | Is there an accountant (internal or external) who will accept or reject the books? Customer zero needs one | Milestone 1 acceptance |
| Q4 | Does Mohamed's own company already use any accounting or invoicing system that we would need to migrate from or coexist with? | Option C integration scope |

---

## 6. Summary

1. Option C deserves this spike because **new evidence** (a substantial, LGPL-3, well-tested Egyptian ETA
   module inside Odoo Community) and **Mohamed's answers** (internal customer zero, Egypt compliance,
   no external customers yet) have closed most of the gap between Option C and Option D.
2. The spike is **three days, ten measurements, five kill criteria**. It exists to produce a decision, not
   a preference.
3. Option C's defining rule is **zero custom modules in the adopted system** — configuration only,
   everything else in our TypeScript layer, reporting read-only. Without that rule, Option C degrades into
   being an ERP customization shop, and Option D becomes the better answer.
4. If the spike passes, the first deployment lands in weeks instead of quarters. If it fails, Option D's
   commitment to authoring Egyptian e-invoicing compliance is explicit and planned, not underestimated.
5. Rules 1–3 in §4 keep the "customer zero" strategy from becoming a year of building with nothing to show.
