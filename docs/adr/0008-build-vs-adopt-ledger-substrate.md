# ADR-0008 — Build vs. adopt: how the factory obtains its regulated core

- Status: **Proposed — awaiting Mohamed's decision**
- Date: 2026-10-14
- Deciders: **Mohamed (product owner, decides)** · ChatGPT (technical strategist) · Arena (implementation)
- Supersedes: — · Superseded by: —

> **Numbering.** Mohamed refers to this decision as "ADR-0002". On `main`, ADR-0002 is the tenancy
> decision, so this lands as **ADR-0008** — see the index in [`docs/DECISIONS.md`](../DECISIONS.md) and §10.
> Accepted ADRs are immutable; the resolution is a renumber, never an edit.
>
> **Status discipline.** This ADR is `Proposed`. Nothing here is decided, and nothing in this
> repository may be treated as a commitment to a platform until Mohamed accepts it. In particular,
> **adopting Odoo is *not* the presumptive outcome** — the recommendation below is conditional, and
> §6 states exactly what would overturn it.

---

## 1. Context

The factory is meant to build many business applications (sales, property and rental management, …) on
shared capabilities: authentication, users, roles, parties/customers, accounting, invoicing, payments,
expenses, documents, notifications, reporting, dashboards, search, audit, workflows.

Most of those are ordinary software. **Two are not:**

1. **Egyptian tax compliance.** ETA e-invoicing is mandatory. Invoices require a UUID, an Egypt Trust
   eSeal signature, a QR code, and Arabic content, submitted as JSON/XML through ETA's API. Penalties
   reach EGP 100,000. This is a *moving legal target* — the rules change, and a hand-built integration
   must be maintained against them forever.
2. **Double-entry correctness.** A ledger that is subtly wrong is worse than no ledger: it produces
   confident, wrong financial statements.

The build-vs-adopt question is therefore not "do we like Odoo". It is: **where do we buy our way out of
regulated, undifferentiated risk, and where must we own the product?**

Evidence available today:

| Source | What it established |
| --- | --- |
| [Proposal 0002](../architecture/proposals/0002-open-source-reuse-audit.md) | The open-source reuse landscape, licence positions and gaps |
| [Proposal 0004](../architecture/proposals/0004-option-c-results.md) | Option C spike, first pass: ledger behaviour, correction model, reporting coupling |
| [Proposal 0005](../architecture/proposals/0005-option-c-evidence.md) | **The completed measurements**: ETA invoice posting, Arabic documents, API ergonomics, the 18→19 upgrade rehearsal, per-tenant operations |
| [Review 0001](../reviews/0001-nile-engines-db-auth-review.md) | The Nile engines as they actually are: storage primitives done, integration not started |

Standing constraint from Mohamed: **no application code is written until this decision is reviewed.**

---

## 2. The decision, stated precisely

Three coupled questions. Answering only the first would be a mistake:

- **A. The regulated core** — do we build accounting + e-invoicing ourselves, or obtain them?
- **B. If we obtain them: at what depth?** A *substrate* we build everything inside, or a *component*
  behind a boundary we control?
- **C. Tenancy topology** — one database per tenant, or one database with row-level security? This is
  coupled to B, because an adopted substrate brings its own topology with it (§5.4).

---

## 3. Options

| | Option | Summary |
| --- | --- | --- |
| **A** | **Build everything** | Own ledger, own ETA integration, on the Nile engines (drizzle + PostgreSQL, currently storage primitives only) |
| **B** | **Adopt Odoo CE as the substrate** | The factory *becomes* Odoo modules; Odoo owns the ORM, data model, UI, reports, tenancy |
| **C** | **Adopt Odoo CE as a component behind a port** | The factory owns tenants, auth, domain model, UX and its own database; Odoo provides the regulated accounting core behind a `LedgerProvider` boundary |
| **D** | **Adopt a different platform** | ERPNext or similar — **not measured**; see §4 |

---

## 4. Why the comparison set matters — and its current weakness

The spike measured **one** candidate thoroughly. That is enough to price Odoo, but it is **not** enough
to conclude Odoo is the best platform, and this ADR will not pretend otherwise:

- ERPNext offers full Arabic/RTL, an Egyptian chart of accounts, and ETA e-invoicing through partner
  connectors. It is plausibly a candidate and is **entirely unmeasured** here.
- No credible open-source *property management* platform was found, which is relevant to the pilot
  domain but not to this decision.

**Therefore:** this ADR can responsibly recommend a *structure* (how to source the regulated core, and
what boundary to hold) without recommending that Odoo be the final component behind it. Choosing a
platform on a one-candidate comparison should be a knowing choice, not an accident.

---

## 5. What the measurements actually say

### 5.1 Odoo is strong where building would be most expensive

| Measured | Result |
| --- | --- |
| Egyptian chart of accounts | 209 accounts, 14% VAT, loaded correctly when country is set first |
| ETA validation contract | Implemented faithfully from source: journal + branch + customer address + building number + VAT + UoM code (`C62`) + tax code (`t1_v009`) + product code/barcode. **A fully configured invoice posts with zero errors** |
| Ledger integrity | 10,000 + 1,400 = 11,400; journal entry balances to 0.0; partial payments and residual tracking correct; correction is reversal-only |
| Arabic *data* | 208 of 209 account names carry Arabic translations; `l10n_eg/i18n/ar.po` ships |

Each of those is months of work to replicate, and the ETA contract specifically is a maintenance
obligation that never ends.

### 5.2 Odoo is weak where the product must differentiate

- **RTL is conditional, not automatic.** Report direction follows the *report language or the viewing
  user's language* — an Arabic invoice viewed by an English-language user renders left-to-right. Egypt
  has no `ar_EG` record; the best available is generic `ar_001`.
- **The API is untyped with no idempotency.** Sending the same external reference twice created two
  documents. Every integration must own validation, deduplication, mapping and error translation.
- **Upgrading costs money and cadence.** The free 18→19 CLI path fails deterministically; the supported
  path is the paid Upgrade Service, and being four or more releases behind adds a **25% licence
  surcharge**. This is a recurring operating cost, not a one-off.
- **Financial reports are Enterprise-only.** The community replacement is OCA MIS Builder (AGPL-3),
  whose copyleft implications for a hosted product need a deliberate decision.

### 5.3 Per-tenant operations are cheap to run, expensive to multiply

A configured tenant clones in **276 ms**; backup is 428 ms; restore 2.2 s; the restored ledger is
verified intact. Isolation is total — separate databases cannot reference each other, so cross-tenant
leakage is impossible rather than merely prevented. The cost is N databases to back up, monitor and
upgrade in lockstep, and every upgrade cost in §5.2 multiplies by the tenant count.

### 5.4 The topology fork is real and unresolved

If the factory owns its database (option C), tenancy stays an open question the factory controls — and
Mohamed's standing instruction to *build tenant-aware by default so neither path closes* remains
honoured. If Odoo becomes the substrate (option B), **per-tenant databases come with it**, and that
choice is made for us by the platform before the product's tenant economics are known.

---

## 6. Recommendation

**Option C — adopt the regulated core as a component behind a port, and do not make Odoo the substrate.**

The reasoning is one sentence: *Odoo's value is concentrated in the part of the system users never
differentiate on, and its weaknesses are concentrated in the part they experience.*

Concretely, the factory would:

1. Keep ownership of **tenants, authentication, authorization, the domain model, the UI and the user
   experience** — the parts that differentiate, and the parts where Arabic-first is a hard requirement.
2. Define a **`LedgerProvider` port** (already proposed in the architecture work) with the semantics the
   domain needs: post an invoice, record a payment, reverse, query balances, submit to ETA, report
   status. Never let Odoo's JSON shapes leak past it.
3. Implement that port against Odoo CE **behind the boundary**, owning all four things Odoo will not give
   us: schema validation, **idempotency keys**, mapping, and error translation (§5.2).
4. **Ratify the choice of component only after a paid pilot** that answers the one question this
   environment cannot: a real ETA submission with real credentials, and a real Arabic PDF out of Odoo's
   own wkhtmltopdf pipeline.

**Conditions on this recommendation** (all must hold):

- The pilot in (4) succeeds, including a live ETA submission and an Arabic PDF produced by Odoo's own
  report path.
- RTL is treated as a **product requirement with tests**, not a configuration hope: every generated
  document must be asserted to carry `dir="rtl"` and correct shaping in both languages.
- The upgrade cadence and its cost (including the Upgrade Service and the surcharge) are accepted as a
  recurring line item, with a named owner.
- At least one alternative platform is measured before the component is finalised — **or** Mohamed
  consciously accepts a one-candidate comparison (§4).

**What would overturn this recommendation:**

| If | Then |
| --- | --- |
| A time-boxed ERPNext (or equivalent) measurement lands materially better on RTL, API typing or upgrade cost | Reconsider option B/D; the port boundary is what makes that switch affordable, so build it either way |
| The pilot shows live ETA submission or Arabic PDFs fail in Odoo's own pipeline | Option C loses most of its value; option A or an alternative connector becomes credible again |
| Tenant economics turn out to be "many small tenants" | Per-tenant databases (the substrate's topology) become untenable and the single-database RLS design gains decisive weight |
| Owning ETA compliance in-house is judged acceptable risk | Option A stops being unreasonable, though the ongoing maintenance obligation should be priced first |

---

## 7. Consequences

**Easier.** Regulated accounting and ETA compliance are obtained rather than invented. The port keeps
the ledger swappable, which makes the platform choice reversible. The factory keeps its own database,
so tenancy stays a controlled decision. Arabic-first UX is owned rather than negotiated with a
framework.

**Harder.** Two systems of record must be reconciled through a boundary that must own idempotency
itself. Odoo's per-tenant database model still has to be operated (276 ms provisioning is cheap;
upgrade coordination across tenants is not). The port has to be designed before anything is built, and
it will be tempting to leak Odoo's shapes through it.

**We commit to.** Not writing application code until this ADR is ratified. Not letting Odoo's data model
become the factory's domain model. Paying for the upgraded path instead of pretending the free one
works. Measuring at least one alternative before the component is final.

---

## 8. Open questions

| # | Question | Blocks |
| --- | --- | --- |
| 1 | Is the one-candidate comparison acceptable, or should ERPNext be measured first? | Finalising the component (not the structure) |
| 2 | Which tenancy topology — per-tenant database or single database with RLS? | Coupled to option B vs C. `main`'s ADR-0002 decides a shared database for Milestone 1; the post-Milestone-1 topology and the external ledger's own topology remain open (§10, C3) |
| 3 | Financial reporting: MIS Builder (AGPL-3) or build? | A hosted product needs a licence position before this ships |
| 4 | Who owns ETA credential handling and the eSeal certificate operationally? | The last unmeasured mile in proposal 0005 §7 |

---

## 9. Review trigger

Reopen this ADR when **any** of the following occurs:

- The paid pilot completes (success or failure) — this is the primary trigger.
- A live ETA submission is attempted for the first time.
- The first real tenant is provisioned, making the operating cost concrete.
- An alternative platform is measured, changing the comparison set.
- Odoo announces a release boundary that forces an upgrade decision.

**Do not** reopen it merely because a later spike makes Odoo look better or worse in isolation: the
structure recommended here — own the product, rent the regulated core, hold the boundary — is designed
to survive that.

---

## 10. Consolidation addendum (2026-10-14)

Added when this Proposed ADR was landed on `main`'s history (branch `docs/consolidate-option-c-evidence`,
from `ebcfe72`). The original text is preserved at commit `e61cd06` of
`arena/bfcb5ed1-mohamed-app-factory`. The recommendation in §6 is **unchanged** and the status remains
**Proposed**. The corrections below are factual; none of them decides anything.

| # | Statement in this ADR | Correction | Evidence |
| --- | --- | --- | --- |
| C1 | Review 0001: "storage primitives done, integration not started" (§1) | True of the reviewed commit `0811ae0` only. PR #3 (`ebcfe72`) added Better Auth, the request→tenant path, role checks, generated migrations and a persisted sale; PR #4 (open) fixes review 0001's H4 (editable audit log) | `docs/reviews/2026-10-14-engines-db-auth-review.md`; disposition table in `docs/architecture/README.md` |
| C2 | "Standing constraint: no application code is written until this decision is reviewed" (§1, §7) | Conflicts with later direction: Mohamed set an engines-first plan and merged PRs #1–#3. Surfaced as decision **D1** in proposal 0006. **Resolved 2026-10-14 by [ADR-0010](0010-engines-continue-behind-ledger-provider-port.md)**: engine work continues and the ledger stays behind a provider-neutral port | Merge history of `main` |
| C3 | "`main`'s ADR-0002 leaves [tenancy topology] open" (§8 Q2) | ADR-0002 (Accepted) decides a shared PostgreSQL database with enforced tenant scope for Milestone 1 and rules out database-per-tenant for it; ADR-0005 makes RLS the boundary. Open: topology after Milestone 1, and how an external ledger lays out its tenants | `docs/adr/0002-…`, `docs/adr/0005-…` |
| C4 | "an independent render proves a shaped RTL Arabic PDF is achievable" (proposal 0005 §3.4) | The committed PNG shows correct Arabic **shaping** and in-line ordering, but a **left-to-right page layout**: paragraphs are left-aligned and the table's first column (`البند`) is on the left. RTL page layout is therefore **not** demonstrated by this artifact | `tools/spikes/option-c/artifacts/arabic_invoice_probe.png` |
| C5 | M9 (upgrade) and M10 (per-tenant operations) are reported as measured | No probe script for M9 or M10 is committed. The results are recorded observations, not reproducible from the repository | `tools/spikes/option-c/` contents |
| C6 | Localization ADR planned as ADR-0007 (review 0001 §4; branch ADR index) | `main`'s ADR-0007 is now the roles ADR, so the localization ADR landed as **ADR-0009** | `docs/DECISIONS.md` |

