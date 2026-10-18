# Proposal 0002 — Open-Source Reuse Audit

| Field | Value |
| --- | --- |
| Status | **Draft — awaiting review** |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture agent) |
| Reviewers | Mohamed (product owner), ChatGPT (technical strategist) |
| Scope | Adopt an existing platform vs. integrate components vs. build custom; recommendation for the first application |
| Depends on | `0001-platform-strategy.md` |
| Evidence collected | 2026-10-13 (GitHub API metrics, repository source trees, license files, market research) |

> **Numbering key (added on consolidation, 2026-10-14).** This document was written on a branch whose
> ADR numbers collided with `main`. Citations to decisions that now exist on `main` have been updated:
> localization → **ADR-0009** (originally ADR-0001), build vs. adopt → **ADR-0008** (originally ADR-0002).
> Other branch-era labels refer to records never created on `main`: "ADR-0003 (first application)" is
> pending; "ADR-0004 (tenancy)" is not needed because `main`'s ADR-0002 and ADR-0005 decide it. The
> unmodified original is at commit `e61cd06`; provenance in [docs/architecture/README.md](../README.md).

> **Method.** Every candidate was evaluated against primary evidence, not reputation: license files were
> read directly, repository metrics came from the GitHub API on 2026-10-13, and the presence or absence
> of specific modules was verified against the actual source trees. Where a claim could not be verified,
> it is marked **UNVERIFIED**. Full evidence log in section 12.

---

## 1. Answer first

| Question | Verdict |
| --- | --- |
| Should we adopt an existing platform as the foundation for our applications? | **No — with one important exception.** No existing platform gives us a licensable, differentiable product foundation. |
| Should we integrate selected components? | **Yes — aggressively**, but filtered by license (MIT / Apache-2.0 only) and by domain fit. |
| Should we build custom? | **Yes, for the domain and the ledger.** Not for commodity infrastructure, and not for Egyptian e-invoicing compliance. |
| Which application first? | **Property & rental management** — but the decision hinges on customer access, not technology (section 10). |
| The one condition that flips everything | **If these applications are for Mohamed's own companies rather than external customers, adopt ERPNext/Odoo and stop building.** See section 10.3. |

The single most important new finding: **Arabic/RTL + Egyptian ETA e-invoicing is a legal requirement,
not a UX preference**, and it is the strongest argument for adopting a platform. Section 6 shows exactly
what that argument is worth, and how to neutralize it without buying an ERP.

---

## 2. Why this is three decisions, not one

"Adopt, integrate, or build" collapses three independent decisions that must be answered separately.
Answering them as one question is how projects end up rebuilding an ERP by accident, or purchasing one
and then rebuilding it anyway.

| # | Decision | Recommended answer |
| --- | --- | --- |
| **1** | **Product foundation** — what the applications and domain logic are written in | Build. Own TypeScript codebase. |
| **2** | **Compliance layer** — Egyptian e-invoicing, Arabic/RTL, Egyptian accounting standards | **Buy/integrate** for ETA. **Adopt RTL-first components** for UI. Never build e-invoicing from scratch. |
| **3** | **Component layer** — UI, auth, tables, PDF, queue, money | **Adopt MIT/Apache-2.0 components heavily.** Reuse is the default here. |

The mistake to avoid is treating decision 2 as if it forces the answer to decision 1. It does not. ETA
compliance is a narrow, purchasable integration; an ERP platform is a multi-decade commitment.

---

## 3. The hard filter — licensing

This filter is applied **first**, before any feature comparison, because a licensing problem cannot be
engineered around later. It eliminated more than half of the candidate field, including several projects
that would otherwise have looked attractive.

**The three license classes that matter to us:**

- **Permissive (MIT / Apache-2.0 / LGPL):** safe to build a proprietary product on, with normal care.
- **Copyleft (GPL):** safe for a hosted service (network use is not distribution), but shipping the
  software to be installed on a customer's own servers triggers source-disclosure obligations for our
  modifications.
- **Strong-network copyleft (AGPL) and source-available licenses (BUSL / SUL / MSCL):** providing our
  product as a hosted service triggers source disclosure of our modifications to that code, and
  source-available licenses add commercial-use restrictions. For a product whose entire value is the
  codebase we build, this is a strategic blocker.

### 3.1 Eliminated by license (verified from the license files)

| Project | License found | Domain | Why eliminated as a product foundation |
| --- | --- | --- | --- |
| **Twenty** | AGPL-3.0, with files marked `@license Enterprise` | CRM | AGPL network-use clause. **Its `twenty-ui` and `twenty-sdk` packages are MIT — reusable (see §7).** |
| **Directus** | Monospace Sustainable Core License 1.0 | Headless back-office | Source-available, not OSI open source |
| **NocoDB** | Sustainable Use License | No-code database | Source-available |
| **Akaunting** | Business Source License 1.1 | Accounting/invoicing | Source-available, commercial restrictions |
| **ToolJet** | AGPL-3.0 | Low-code builder | AGPL |
| **EspoCRM / SuiteCRM** | AGPL-3.0 | CRM | AGPL |
| **Bigcapital** | AGPL-3.0 | Accounting (TypeScript) | AGPL — but a useful **reference model** (§8) |
| **QloApps** | OSL-3.0 | Hotel PMS | Strong copyleft, and hotel-specific rather than property-rental |
| **MicroRealEstate** | **Sustainable Use License** | Rental management | Relicensed away from MIT (effective 2026-02); was the most credible rental OSS project |
| **metasfresh** | **No license detected** | ERP | Presence of a full codebase with no license = all rights reserved. Unusable |
| **Apache OFBiz** | Apache-2.0 | ERP | License fine; repository last pushed 2020-04 — effectively unmaintained |
| **Budibase** | GPLv3 overall (apps built with it are exempt) | Low-code | Usable as *internal tooling*, not as a product foundation |

> **A pattern worth naming:** the open-source business-software space has converged on
> "source-available + paid cloud" as its business model. Directus, NocoDB, Akaunting, MicroRealEstate,
> and Budibase have all moved this way. The practical consequence is that the number of genuinely
> reusable, genuinely open platforms is far smaller than the star counts suggest.

### 3.2 The trap that decides the ERP question

For the two serious full-ERP candidates, the licensing analysis produces a finding that is easy to miss
and decisive for us:

| | Odoo Community | ERPNext |
| --- | --- | --- |
| Framework license | LGPL-3.0 (verified from `LICENSE`) | Frappe framework MIT; ERPNext **GPL-3.0** |
| Proprietary product on top | Accepted practice in the ecosystem (Odoo SA itself sells proprietary Enterprise modules that plug into LGPL Community). **Requires legal review — not a court-tested guarantee.** | Custom Frappe apps are treated as separate works in practice. **Same caveat.** |
| Hosted SaaS use | Permitted | Permitted (no distribution → no source obligation) |
| Shipping to a customer's own server | Permitted (LGPL obligations on modified core files only) | **Triggers GPL source disclosure for our modifications** |

**The trap:** Odoo Community is free and LGPL, but it is missing the exact modules a financial system
needs. Verified directly against the `odoo/odoo` source tree on 2026-10-13:

| Module | In Odoo Community? | Consequence |
| --- | --- | --- |
| `account` (invoices, journals, taxes) | **Present** | Real double-entry accounting is available |
| `l10n_eg` (Egyptian chart of accounts) | **Present** | Egyptian setup is available |
| `l10n_eg_edi_eta` (ETA e-invoicing) | **Present** (has `models`, `wizards`, `tests`) | Egyptian e-invoicing is available — a genuine strength |
| `account_reports` (Balance Sheet, P&L, Ledger) | **Absent** | Financial statements are **Enterprise-only** |
| `account_accountant` (full accounting app) | **Absent** | Enterprise-only |
| `account_asset` (fixed assets), budgets | **Absent** | Enterprise-only |
| `sale_renting` (rental/subscriptions), `industry_fsm` | **Absent** | **There is no rental or property module in Community at all** |

So the honest accounting of "free Odoo" is: we would get the ledger core, the Egyptian localization, and
ETA submission — but we would have to obtain financial reporting and fixed assets from somewhere. In
practice that means the OCA community modules, **which are licensed AGPL-3.0** (verified:
`OCA/account-financial-reporting` = AGPL-3.0). Pulling those into a proprietary product either accepts
AGPL exposure on our reporting layer or forces a paid Enterprise licence.

**And the deepest problem:** Community has no rental/property capability whatsoever. If the first
application is property management, we write that domain ourselves on Odoo exactly as we would on our own
stack — while inheriting a Python/XML framework, an annual major-version upgrade, and an AGPL boundary
around the reporting we need.

**Conclusion:** adopting Odoo Community buys us ETA compliance and Arabic/RTL for free, and charges us a
crowded market, a framework hostile to fast AI-driven development, permanent upgrade tax, and a licensing
boundary cutting through the one area (financial reporting) where we can least afford ambiguity. Section 6
prices that trade-off properly.

---

## 4. Candidate evaluation — full platforms

Metrics from the GitHub API, 2026-10-13. Stars are a popularity signal, not a quality measure; they are
included because they are verifiable.

| Project | License | Stars | Language | Arabic/RTL | Egypt ETA | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **Odoo** (Community) | LGPL-3.0 | 55.0k | Python | Built-in since v12 | `l10n_eg_edi_eta` in Community | Strongest compliance story; weakest product-foundation story |
| **Odoo** (Enterprise) | Proprietary, $24.90–61/user/month | — | Python | Yes | Yes | Rejected: per-user economics, resale restrictions, 25% surcharge if 4 releases behind |
| **ERPNext / Frappe** | GPL-3.0 / framework MIT | 40.1k | Python | Arabic UI + RTL supported | Via partner connectors (e.g. TaxBridge) | Best licence-clean ERP; same framework class as Odoo for AI work |
| **Dolibarr** | GPL-3.0 | 7.7k | PHP | Partial | No | Rejected: no Egypt localization, PHP, weaker accounting |
| **Tryton** | GPL-3.0 | 230 | Python | Partial | No | Rejected: strong accounting model, but tiny ecosystem and no local compliance |
| **iDempiere** | Not detected (NOASSERTION) | 666 | Java | No | No | Rejected: Java ERP, unverifiable license, no local compliance |
| **metasfresh** | **None detected** | 2.4k | Java | No | No | Rejected: no license file = unusable |
| **Apache OFBiz** | Apache-2.0 | 804 | Java | No | No | Rejected: unmaintained (last push 2020-04) |
| **LedgerSMB** | Not detected | 570 | Perl | No | No | Rejected: Perl, no local compliance |
| **Krayin CRM** | MIT | 24.0k | PHP (Laravel) | Unverified | No | Licence-clean but CRM-only, no accounting, wrong language |
| **Twenty** | AGPL-3.0 (+ EE files) | 58.3k | TypeScript | i18n present | No | Excluded by licence; **MIT sub-packages reusable** |
| **Dolibarr / EspoCRM / SuiteCRM** | GPL-3.0 / AGPL-3.0 | 3.5k–7.7k | PHP | Partial | No | Excluded |

### 4.1 Property & rental management — the decisive finding

**There is no credible open-source property-management platform to adopt.** This is the most
consequential finding in the audit, because it removes the "adopt" option for the domain Mohamed is
considering first.

| Project | Stars | License | Language | Last push | Verdict |
| --- | --- | --- | --- | --- | --- |
| QloApps | 14.4k | OSL-3.0 | PHP | 2026-10 | **Hotel PMS**, strong copyleft — wrong domain, unusable licence |
| MicroRealEstate | 1.2k | Sustainable Use License | JavaScript | 2026-09 | **Relicensed away from MIT** in 2026-02 |
| openkoda | 1.0k | MIT | Java | 2025-02 | Stale; generic low-code platform |
| open-condo (Condo) | 421 | MIT | JavaScript | 2026-10 | Active, MIT, property management SaaS — but 421 stars and small; a **reference model**, not a foundation |
| camelaissani/loca | 241 | MIT | JavaScript | 2022-01 | Abandoned |
| movinin | 229 | MIT | TypeScript | 2026-10 | Small; rental + mobile app |
| online-rental-property-manager | 178 | MIT | PHP | 2026-07 | AppGini-generated code, not a maintainable codebase |
| OpenKos | 113 | Apache-2.0 | PHP (Laravel) | 2026-10 | Boarding-house specific |
| orpms | 86 | GPL-2.0 | JavaScript | 2023-12 | Abandoned |
| OpenProperty | 24 | MIT | TypeScript | 2026-09 | New, tiny; built on Cloudflare Workers/D1 |

The comparison with the ERP space is stark: the largest property candidate is a hotel PMS under a strong
copyleft licence, and the best-licensed rental projects are 100–1,200 stars, several of them abandoned or
relicensed. **Nobody has built the thing we are considering building, at a scale worth adopting.** That is
simultaneously the risk in the domain (no free head start) and the opportunity in it (no free incumbent
either).

The commercial market, by contrast, is crowded but entirely US-centric SaaS priced per unit in USD
(AppFolio, Buildium, DoorLoop, Rent Manager, TenantCloud, Yardi Breeze). That is a market-shape argument,
not a technical one — and it belongs to Mohamed, not to me.

### 4.2 Accounting engines

| Candidate | License | Stars | Verdict |
| --- | --- | --- | --- |
| medici | MIT | 360 | Bound to MongoDB/Mongoose; negligible adoption. Not a foundation |
| ledgerline | (new project, strict TypeScript) | Small | Single-maintainer, no adoption. Watch, don't bet |
| ledgerstack-core | Not verifiable on GitHub | — | Cannot be verified — excluded |
| Bigcapital | AGPL-3.0 | 3.9k | Licence-excluded, but a useful **TypeScript reference model** |
| beancount / hledger / ledger-cli | GPL-2.0 / GPL-3.0 / C++ | 4.7k–6.1k | Mature **semantics**; not embeddable (licence + language) |

**This confirms the exception recorded in proposal 0001:** there is no production-grade, licensable,
embeddable double-entry engine in TypeScript. We build the ledger kernel ourselves — and adopt the *model*
from beancount/hledger (invariants), Odoo/ERPNext (chart of accounts and posting structures), and
Bigcapital (a modern TypeScript accounting data model).

---

## 5. Candidate evaluation — components (the better use of reuse)

Most of the value in this audit is here. These are licence-clean, actively maintained, and reduce work we
had planned to do ourselves. Verified 2026-10-13.

| Need | Component | License | Stars | Last push | Replaces |
| --- | --- | --- | --- | --- | --- |
| Admin/CRUD framework | **Refine** | MIT | 35.9k | 2026-09 | A large part of our planned `ui-patterns` |
| Alternative / reference | React Admin | MIT | 27.0k | 2026-10 | — |
| Primitives | shadcn/ui + Radix | MIT | 125.5k / 19.4k | 2026-10 | Hand-built design system |
| Data tables | TanStack Table | MIT | 28.5k | 2026-10 | Custom grid |
| **RTL-first UI (Arabic)** | **MUI** | MIT | 99.2k | 2026-10 | Hand-built RTL support |
| **RTL-first UI (Arabic)** | **Ant Design** | MIT | 99.8k | 2026-10 | Hand-built RTL support |
| Authentication | **Better Auth** | MIT | 30.3k | 2026-10 | Hand-rolled identity |
| Authorization internals | Casbin | Apache-2.0 | 2.9k | 2026-10 | Hand-written RBAC engine (optional — behind `can()`) |
| Authorization (service) | OpenFGA / Cerbos | Apache-2.0 | 6.0k / 4.6k | 2026-10 | Defer — adds a service; revisit at real scale |
| Authorization | Oso | Apache-2.0 | 3.5k | **2025-02** | Declining activity — do not adopt |
| ORM / data access | Drizzle | Apache-2.0 | 36.0k | 2026-10 | Custom SQL layer |
| Validation | Zod | MIT | 44.1k | 2026-10 | Ad-hoc validation |
| UI kit (reuse candidate) | Twenty's `twenty-ui`, `twenty-sdk` | **MIT** | part of a 58.3k project | 2026-10 | React component library + app toolkit — **spike candidate** |

### 5.1 Two corrections to my own earlier recommendation

Being honest about where the evidence changed my position:

1. **`ui-patterns` should not be hand-built.** Proposal 0001 planned `ResourcePage`, `DataTable`, and
   `EntityForm` as our own packages. **Refine (MIT, 35.9k stars, TypeScript)** already provides the
   resource/list/detail/edit abstraction, and React Admin is a viable alternative. We should adopt one and
   own only the *business-pattern* layer on top (money fields, period pickers, RTL-aware layouts,
   permission-aware forms). This removes a large block of planned work.
2. **The UI foundation choice is now driven by RTL, not aesthetics.** Given Arabic + RTL is a hard
   requirement, **MUI or Ant Design** (both MIT, both ~99k stars, both with first-class built-in RTL
   support through a direction provider) are materially lower-risk than assembling RTL behaviour ourselves
   from Tailwind logical properties. This is a real trade-off against the shadcn/Radix style, and it should
   be settled in the stack comparison.

---

## 6. The Arabic/RTL and Egyptian compliance argument, priced honestly

This is the strongest case against my recommendation, so it deserves its own section rather than a
footnote.

### 6.1 What the requirement actually is

| Requirement | Detail | Consequence if missed |
| --- | --- | --- |
| **ETA e-invoicing** | Mandatory for registered taxpayers; JSON/XML submission, electronic signature (Egypt Trust eSeal), ETA-issued UUID, QR code on printed invoices, credit notes referencing the original invoice, near-real-time submission | **Fines reported up to EGP 100,000** |
| **Arabic documents** | Arabic is mandatory for official documents and tax invoices; English permitted as a secondary language | Legally deficient invoices; rejected filings |
| **Arabic/RTL UI** | Teams operate in Arabic daily; menus translate but layouts, tables, and printed invoices frequently break | Unusable product; rework across every screen |
| **Egyptian accounting standards** | Chart of accounts, 14% VAT, reporting expectations | Books that an accountant rejects |

### 6.2 What adoption would genuinely buy

Verified strengths of the Odoo route specifically:

- Arabic and RTL support built into the platform since v12, with Arabic PDF report rendering and fonts.
- `l10n_eg_edi_eta` **present in Community**, with models, wizards, and tests — an ETA integration we
  would not have to write.
- `l10n_eg` Egyptian chart of accounts present in Community.
- The largest local partner ecosystem in Egypt (reported at 173 Odoo partners), which matters for support
  and hiring.
- ERPNext offers a comparable Arabic/RTL story with ETA handled through partner-built connectors
  (e.g. TaxBridge), and a growing Egyptian partner base.

### 6.3 Why it still does not win

Four reasons, in order of weight:

1. **ETA is a narrow, purchasable integration; an ERP is not.** Writing an ETA submission module is a
   bounded problem — build the invoice JSON, sign it, submit it, store the UUID and QR. It is exactly the
   kind of work that should sit behind an `EInvoicingProvider` port with a certified local provider behind
   it, maintained by a specialist, rather than being the reason to adopt a 17 GB Python framework. Buying
   compliance is cheap; inheriting a platform is not.
2. **The licensing boundary cuts through the middle of what we need.** Financial statements — the thing a
   business user looks at first — are Enterprise-only in Odoo Community, and the community replacement is
   AGPL-3.0. We would be adopting a platform to avoid writing compliance code, and then writing or paying
   for the reporting layer anyway, plus carrying legal ambiguity around it.
3. **No rental/property capability exists in Community at all** (verified). For application #1 we would
   write the domain from scratch on Odoo's stack — so the platform's value reduces to "we didn't write an
   accounting core", while its costs remain: annual version upgrades, OCA version lag (reported community
   experience: good coverage on 17.0, low on 18.0), and a Python/XML framework with runtime-only feedback.
4. **It removes our differentiation and adds a crowded channel.** There are ~173 Odoo partners in Egypt.
   An Odoo-based product competes with every one of them on the same platform, and the differentiator
   becomes implementation services rather than a product. Meanwhile, AI-driven development speed — our
   actual operating advantage — is worth less on a framework where changes can only be validated by
   running a server.

### 6.4 How we neutralize the compliance risk instead

| Risk | Mitigation | Cost estimate |
| --- | --- | --- |
| ETA e-invoicing | Integrate a certified provider/SDK behind an `EInvoicingProvider` port; build one `jurisdiction-eg` module for VAT 14%, invoice content rules, numbering | Weeks, not quarters — **must be verified with a real spike** |
| Arabic/RTL UI | Choose an RTL-first foundation (MUI or Ant Design, both MIT and RTL-capable by design); logical CSS properties; Playwright screenshot tests **in Arabic** as a CI gate | Near-zero if decided before the first screen; prohibitive after |
| Arabic PDF rendering | HTML/CSS → PDF via headless Chromium with Arabic-capable fonts (Noto Sans Arabic / Cairo), bidi-aware layout; snapshot tests per template | Low, with tests |
| Egyptian accounting standards | A dedicated jurisdiction module: Egyptian chart of accounts, VAT 14%, required invoice fields, retention rules | Moderate, scoped |
| Getting it wrong anyway | Hire/consult a local accountant **and** an ETA integration specialist during Milestone 1 — cheaper than any platform licence | Small, fixed |

**Net position:** the compliance argument justifies adopting *components and providers*, and justifies
making RTL a first-class architectural constraint from day one (recorded as ADR-0009). It does not justify
adopting a platform.

---

## 7. Evaluation of the AI-agent-modifiability criterion

This criterion carries unusual weight here, because AI agents are the primary implementers. It is the
criterion most often omitted from build-vs-adopt comparisons.

| Factor | Odoo / ERPNext | Our own TypeScript stack |
| --- | --- | --- |
| Static type checking | No (Python without comprehensive hints) | **Yes — errors caught before running** |
| Validation of a change | Run the server, click through | Typecheck + unit test in seconds |
| Framework quirks | XML views, ORM inheritance, QWeb, metaprogramming | Ordinary TypeScript |
| Agent training data | **Excellent** — both are extremely well documented and widely represented | Good (generic React/TypeScript) |
| Change blast radius | Module inheritance chains across a large framework | Module boundary enforced in CI |
| Realistic agent feedback loop | Slow | Fast |

**Counterpoint, stated fairly:** agents genuinely do know Odoo and Frappe well, and their documentation
is excellent — this is a real advantage that is usually underestimated. But our operating model depends on
*fast, deterministic verification* (proposal 0001, C9). A stack where a change can only be validated by
running a server and clicking through screens removes exactly the automated feedback loop that makes
agent-driven development reliable. On a factory intended to produce many applications, that difference
compounds across every feature.

---

## 8. What we should take from each project regardless of the decision

Reuse is not only code. These are models worth adopting outright, at zero licensing cost:

| Source | What to take |
| --- | --- |
| **beancount / hledger** | Ledger invariants: append-only journal, reversals not edits, balanced postings, period closing semantics |
| **Odoo `account`** | Chart-of-accounts structure, journal types, tax/report structure, and the `l10n_eg` Egyptian account tree and ETA invoice field requirements |
| **ERPNext** | Practical document/workflow patterns for quotes → invoices → payments → credit notes |
| **Bigcapital** | A modern TypeScript accounting data model — reference for our schema design |
| **OpenCondo** | A real property-management domain model (tickets, resident contacts, properties, payments) under MIT |
| **Refine / React Admin** | The resource/list/detail/edit abstraction — adopt the library, not just the idea |
| **AppFolio / Buildium / TenantCloud** | Feature baselines to benchmark against (public documentation only) — a requirements checklist, not code |
| **Twenty's MIT packages** | `twenty-ui` components and `twenty-sdk` app toolkit |

---

## 9. Decision matrix

Weights reflect this specific project: a codebase we intend to reuse across many applications, developed
primarily by AI agents, for an Arabic-language market. Scores are 1 (poor) to 5 (excellent) — a decision
aid, not arithmetic truth. Maximum = 500.

| Criterion (weight) | A: Odoo CE foundation | B: ERPNext foundation | C: Custom product + adopted accounting back-office | **D: Custom + MIT components + bought ETA** | E: AGPL platform, open-core |
| --- | --- | --- | --- | --- | --- |
| Licensable with commercial clarity (20) | 3 | 3 | 3 | **5** | 2 |
| Differentiation / defensibility (20) | 2 | 2 | **5** | **5** | 4 |
| Egypt compliance: ETA + Arabic/RTL (15) | **5** | 4 | **5** | 4 | 2 |
| AI-agent modifiability (15) | 2 | 2 | 4 | **5** | **5** |
| Maintenance / upgrade tax (10) | 2 | 2 | 3 | **5** | 3 |
| Time to first revenue (10) | 4 | 4 | 3 | 3 | 4 |
| Accounting correctness risk (5) | 4 | **5** | **5** | 4 | 1 |
| Operational complexity (5) | 2 | 2 | 2 | **5** | 2 |
| **Total** | **295** | **285** | **390** | **460** | **310** |

Reading of the matrix:

- **Option D wins**, and its wins are concentrated in exactly the criteria that matter most to a
  multi-application factory: licensing clarity, differentiation, agent velocity, and low maintenance tax.
  Its weakness is time to first revenue — the honest cost of building the compliance layer ourselves.
- **Option A (Odoo Community) is the compliance champion** (5/5) and the weakest on differentiation and
  agent velocity — an Odoo-based product competes with ~173 local partners on the same platform.
- **Option C is a credible fallback**, not a rejection. Running a mature accounting core as a back-office
  ledger while we own the domain UX directly addresses the compliance risk. It scores second. It is
  discussed with its decision rule in §9.1.
- **Option E is not viable** for our purpose: AGPL platforms (Twenty, EspoCRM) have no accounting engine,
  no ETA support, and no Arabic compliance — we would build everything that matters anyway, and open-source
  our differentiators.

### 9.1 Option C — the honest middle path, and its decision rule

**Shape:** our TypeScript applications own all domain data and UX. A mature accounting/ERP system
(Odoo Community or ERPNext) owns **the ledger and statutory compliance only**, reached through a port
(`LedgerProvider`), with postings flowing one way and all reporting read from the ledger.

**Advantages:** eliminates accounting-authoring risk and the ETA/Arabic-document risk almost entirely;
keeps our product's UX and domain differentiation; MTD for the first application drops significantly.

**Disadvantages, stated plainly:** it violates the single-source-of-financial-truth rule from proposal 0001
(§7.5) unless the boundary is enforced ruthlessly; it doubles the operational surface (two systems, one of
which we don't control); it reintroduces the AGPL boundary if we use OCA reporting modules; and every
customization to the adopted system is subject to its annual upgrade cycle.

**Decision rule:** option D remains the default. We run **one bounded spike** (§11, P3) to determine
whether ETA submission is genuinely a few weeks of work behind a provider. **If the spike shows ETA
integration is a multi-month project, or if it cannot be bought from a certified provider, we switch to
Option C.** That is a falsifiable trigger, not a preference.

---

## 10. First application — evidence-based recommendation

### 10.1 Recommendation

**Property & rental management first** — conditional on Mohamed having access to real paying users in that
domain (see §10.2).

**Evidence supporting it:**

| Evidence | Weight |
| --- | --- |
| **No open-source incumbent in the domain** — the best candidates are a hotel PMS under a strong copyleft licence and a handful of projects under 1,200 stars, several abandoned or relicensed. There is no free alternative to compete against. | Strongest |
| **The commercial incumbents are all US-centric**, priced per unit in USD, with no Arabic/ETA-native offering — a local gap we can own | Strong |
| **The domain exercises the hardest shared pillars at once**: recurring invoices, money/rounding, fiscal periods, document generation, scheduled jobs, notifications, reporting — i.e. it validates the factory rather than dodging it | Strong |
| Data model is legible and bounded (property → unit → lease → charge → payment → statement) | Moderate |

**Evidence against the alternative (sales/business management first):**

| Evidence | Weight |
| --- | --- |
| Mature platforms already exist and are free or cheap (Odoo, ERPNext, Zoho, Dolibarr) — we would compete directly with 40k+ star projects on generic CRM + invoicing + accounting | Strong |
| The strong open-source CRM candidates are AGPL (Twenty, EspoCRM, SuiteCRM), so we could not reuse them anyway — we would be rebuilding an ERP that already exists | Strong |
| Generic "sales management" is an unbounded scope (CRM, quotes, inventory, purchasing, HR) with no natural edge | Moderate |

**If sales/business management is first, this is what I recommend instead:** run it on ERPNext as an
internal deployment, and don't build it. Which brings us to the fork.

### 10.2 The condition that decides it

The technology evidence above is necessary but not sufficient. The decisive input is **customer access**:

- **If Mohamed has (or can reach) property/rental customers** — agencies, landlords, compound managers,
  building owners — build it. The recommendation in §10.1 stands, and the factory gets its first real
  forcing function.
- **If the nearest real users are sales/business-management users** (his own or clients'), the evidence
  flips: the economics of building generic business management against free ERPs are poor, and a delay to
  find a property customer is more expensive than changing domains.

### 10.3 The fork that must be answered before anything is built

There is a possibility that changes every recommendation in this document, and it belongs to Mohamed:

> **Are these applications products for external customers, or automation for Mohamed's own companies?**

| If the answer is… | Then the correct action is… |
| --- | --- |
| **Selling to external customers** (a product business) | Build custom with MIT/Apache components, buy ETA compliance, RTL-first UI — Option D. This whole document applies. |
| **Running Mohamed's own businesses** (internal systems) | **Adopt ERPNext or Odoo and stop building.** No licence fee, Arabic/RTL built in, ETA through a local partner, and a factory would be years of avoidable work for zero differentiating value. |
| **Both** | Build the product (Option D), and use it inside his own companies as customer zero. This is the strongest position of the three, and the one I would choose. |

I want to be direct about this, because it is the largest single risk in the project: if the underlying
need is internal automation, the entire "factory" concept is the wrong tool, and no amount of good
architecture will fix that. Discovering it now costs one question; discovering it in eight months costs the
project.

### 10.4 Proposed first slice (unchanged in shape from proposal 0001, revised for compliance)

Property → unit → lease → **recurring rent invoice** → **ETA-compliant Arabic PDF invoice** →
**payment recorded and allocated** → tenant ledger → AR aging report — with permissions, audit, and Arabic
RTL throughout. This single slice tests every risky pillar at once, including both compliance
requirements, and gives a real accountant and a real property manager something to accept or reject.

---

## 11. Proposed next steps

| # | Step | Owner | Blocking |
| --- | --- | --- | --- |
| P1 | Review this audit and answer the fork in §10.3 and the customer-access condition in §10.2 | **Mohamed** | Everything |
| P2 | Written stack comparison + ADR-0002 (deferred deliberately: the RTL requirement and this audit change its inputs, so deciding it earlier would have been wasted work). Includes the MUI/Ant Design vs shadcn/Tailwind RTL decision and the Refine adoption | ChatGPT + Arena | Milestone 0 |
| P3 | **ETA spike** — one bounded investigation with a certified Egyptian provider/SDK: can e-invoice submission sit behind an `EInvoicingProvider` port in weeks? This is the trigger for Option C | Arena | Milestone 1 |
| P4 | Legal review of the Odoo/ERPNext derivative-work question — **only if** we pursue Option A, B, or C. Not required for Option D | Mohamed | Conditional |
| P5 | ADR-0008 (build vs adopt), ADR-0003 (first application), ADR-0004 (tenancy) after P1 | Arena | Milestone 0 |

**Explicitly not started:** any implementation, any repository scaffolding. Per Mohamed's instruction, the
first-application decision is reviewed before implementation begins.

---

## 12. Evidence log

All metrics retrieved 2026-10-13.

| Evidence | Source |
| --- | --- |
| Repository metrics (stars, licence, language, last push, archived) | GitHub REST API, `repos/{owner}/{repo}` |
| Odoo Community module presence/absence (`account`, `l10n_eg`, `l10n_eg_edi_eta`, `account_reports`, `account_asset`, `account_accountant`, `sale_renting`, `industry_fsm`) | `GET /repos/odoo/odoo/contents/addons/...` |
| Odoo licence text (LGPLv3) | `GET /repos/odoo/odoo/contents/LICENSE` |
| Twenty licence (AGPL-3.0 + `@license Enterprise` files, MIT sub-packages) | `GET /repos/twentyhq/twenty/contents/LICENSE` |
| Directus licence (Monospace Sustainable Core License 1.0) | `GET /repos/directus/directus/contents/license` |
| Akaunting licence (Business Source License) | `GET /repos/akaunting/akaunting/contents/LICENSE.txt` |
| NocoDB licence (Sustainable Use License) | `GET /repos/nocodb/nocodb/contents/LICENSE.md` |
| Budibase licence (GPLv3 overall; built apps exempt) | `GET /repos/Budibase/budibase/contents/LICENSE` |
| Medusa licence (MIT except Enterprise Edition) | `GET /repos/medusajs/medusa/contents/LICENSE` |
| MicroRealEstate relicensing (MIT → Sustainable Use License, February 2026) | `GET /repos/microrealestate/microrealestate/contents/LICENSE.md` |
| `OCA/account-financial-reporting` licence AGPL-3.0 | GitHub API |
| Odoo Enterprise pricing, edition differences, version-lag surcharge | Odoo pricing comparisons, 2026 (multiple independent sources) |
| Odoo Community accounting-report gaps, OCA/MIS Builder replacements | Odoo forum threads, OCA/Reddit community reports |
| Odoo Community licensing and SaaS viability (LGPL; proprietary modules permitted) | Community/partner discussion — **interpretation, not legal advice** |
| Egypt: ETA mandatory e-invoicing, 14% VAT, Arabic mandatory on official documents, penalties up to EGP 100,000, Odoo's Egyptian partner count | Egypt ERP market analyses, 2026 (multiple independent sources) |
| ERPNext Egypt: Arabic/RTL support, ETA via partner connectors (TaxBridge), local partners | Egyptian ERPNext partner sites, 2026 |
| Property-management OSS landscape | GitHub topics, self-hosting community discussions, vendor comparison articles |
| Commercial property-management market pricing | 2026 property-management software comparisons |

**Limitations of this audit — stated so the review is honest:**

1. **Presence is not quality.** `l10n_eg_edi_eta` exists in Odoo Community and has models, wizards, and
   tests; its real-world completeness against ETA's current requirements is **UNVERIFIED**. A spike would
   settle it.
2. **Licence interpretations are not legal advice.** The derivative-work question for Odoo/ERPNext custom
   modules follows widespread ecosystem practice, not a court ruling. Any decision to ship on those
   platforms needs a lawyer's opinion.
3. **Star counts and last-push dates are proxies.** They measure attention, not fitness.
4. **Adoption/MENA market data comes from vendor-side and marketing sources** and should be treated as
   directional.
5. **I did not test any candidate hands-on.** Everything here is source, licence, and documentation
   evidence. A hands-on spike of the two or three finalists would be the appropriate next step if the
   build decision is reversed.

---

## 13. Summary

1. **Reuse is the right instinct, and it was applied to the wrong layer.** The evidence says: adopt
   *components* (Refine, MUI/Ant Design, Better Auth, Drizzle, Zod, Casbin, TanStack), not *platforms*.
2. **Licensing eliminates more than half the field**, including most of the strongest-looking candidates
   (Twenty, Directus, NocoDB, Akaunting, MicroRealEstate). Most mature open business software today is
   source-available, not open source.
3. **The ERP trap is real and precise**: Odoo Community's freedom comes with Enterprise-only financial
   statements and an AGPL-licensed community replacement — and no rental module at all.
4. **Arabic/RTL and ETA compliance is the genuine argument for adopting**, and it is answered by buying a
   narrow integration and choosing an RTL-first UI foundation — not by inheriting a platform.
5. **Property & rental management is the recommended first application**, on the evidence that no credible
   open-source rival exists and the commercial market is US-centric — conditional on customer access.
6. **The one question that overrides everything else:** product business or internal automation. If it is
   internal, adopt ERPNext and stop building.
