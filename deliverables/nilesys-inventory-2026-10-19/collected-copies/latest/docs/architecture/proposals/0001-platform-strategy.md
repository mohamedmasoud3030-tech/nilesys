# Proposal 0001 — Mohamed App Factory Platform Strategy

| Field | Value |
| --- | --- |
| Status | **Draft — awaiting decisions** |
| Date | 2026-10-13 |
| Author | Arena (implementation / architecture agent) |
| Reviewers | Mohamed (product owner), ChatGPT (technical strategist) |
| Scope | Repository architecture, module strategy, sequencing, first milestone |
| Supersedes | — |

> This document is a **proposal**, not a decision. Decisions extracted from it become numbered ADRs in
> `docs/adr/`. Where a decision is still open it is marked `⛔ DECISION REQUIRED` and listed in
> section 13.

---

## 1. Executive summary

The Mohamed App Factory is a sound idea, but the phrase "Build once → reuse many times" describes an
**outcome**, not a plan. Reuse is not designed up front; it is *discovered* by building the second and
third real application and noticing what repeated itself. Factories that try to plan reuse in advance
produce a framework with no users, and then the applications fight the framework forever.

My recommendation, in one paragraph:

> Build **one thin but complete application first** (property & rental), structured from day one as a
> **modular monolith inside a single monorepo**, where every capability lives behind a narrow, enforced
> module boundary. Build the second application's skeleton early enough to act as the *forcing function*
> that reveals which seams are real. Generalize only what two concrete consumers already need. Buy or
> adopt commodity infrastructure (auth, UI primitives, PDF, queue, search) and hand-build only the
> things that are the actual product (business workflows, accounting semantics, document outputs).

Concretely:

| Question | Recommendation |
| --- | --- |
| Repository model | **Single monorepo** (pnpm workspaces + Turborepo), modular monolith per app |
| Deployment model | **Separate deployable per application**; shared code, not a shared runtime |
| Language / stack | **TypeScript end-to-end**, PostgreSQL, Next.js shell + worker, Drizzle, Zod, Vitest, Playwright |
| Module strategy | Thin packages under `packages/*` from day one; **generality deferred**, boundaries enforced immediately |
| First milestone | **Milestone 0 — Walking Skeleton** (section 12), not a feature-complete module |

---

## 2. Assessment of the concept

### 2.1 What is genuinely right about this approach

1. **The capabilities listed really are shared.** Authentication, permissions, customers/parties,
   documents, files, notifications, audit, reporting, dashboards, and UI patterns are the same
   problem in 90% of business applications. This is not a hypothetical overlap.
2. **Two applications, not one, is the correct number to start with.** A single app cannot justify a
   platform; three apps would mean repeating mistakes twice. Two is the minimum that makes reuse
   observable.
3. **"AI-friendly repository" is a real architectural constraint, not a nice-to-have.** If AI agents do
   most of the implementation, then clarity, predictability, small files, one-way-to-do-things, and
   machine-checkable rules are *load-bearing*. They should be treated with the same seriousness as
   correctness. Most codebases fail AI agents through ambiguity, not through difficulty.
4. **GitHub as shared technical memory is correct**, provided it is enforced. Documents that are not
   updated in the same pull request as the code they describe decay within weeks.

### 2.2 The honest risk statement

The listed capability set (auth, users, roles, customers, accounting, invoicing, payments, expenses,
documents, files, notifications, reporting, dashboards, search, audit logs, UI components, workflows)
is not a "shared module list" — it is a **multi-year ERP roadmap**. Odoo, ERPNext, and NetSuite each
spent decades and hundreds of engineer-years on that list.

The factory only succeeds if we are ruthless about what is built versus adopted versus deferred.
Section 9 lists what must **not** be generalized early. That section is more important than the module
list in section 8.

---

## 3. Challenges to the stated approach

These are objections, ranked by how expensive they are to get wrong.

### C1 — The build-versus-adopt question has not been answered for the market as a whole

**The challenge:** For sales management and property/rental management specifically, mature
open-source ERP platforms (ERPNext/Frappe, Odoo Community) already provide parties, invoicing,
accounting, payments, documents, roles, reports, and multi-company support. Choosing to build a
factory instead is a legitimate decision, but it must be a *deliberate, recorded* one, not an
unexamined default.

**Why we probably still build:** ERP platforms are extremely hard for AI agents to modify safely
(large legacy codebases, metaprogrammed frameworks, weak type systems), their UX is generic, and they
cannot be shaped into a focused product for a specific market. Our advantage is not feature count —
it is *speed of adaptation and UX quality*.

**Recommendation:** Record this as ADR-0001 with explicit reasons, and revisit it once, before
Milestone 1. Do not relitigate it after that.

### C2 — "Build once → reuse many times" is a trap if used as a *plan*

Reuse planned in advance becomes speculative generality: abstractions with one imaginary consumer,
configurations nobody sets, and indirection that makes reading the code harder for both humans and
agents.

**Rule to adopt:** *Generalize at the second concrete consumer, not the first.* A capability may be
used by one application only, and that is fine. What must exist from the start is the **boundary**
(a clean, narrow interface), not the **generality** (feature flags, pluggable strategies,
multi-provider support).

### C3 — Building "the platform first" would be the classic failure

The most likely way this project fails is: six months of work on a beautiful shared library, no
application anyone can use, and an architecture designed around imagined requirements. The
countermeasure is that **application #1 is the primary deliverable** and the platform is its
by-product.

### C4 — Multi-tenancy is being treated as an implementation detail; it is not

How tenants are isolated (one deployment per customer / shared database with row scoping / schema per
tenant) determines the data model, the authentication model, the migration strategy, the backup and
restore story, the permission model, and the reporting layer. It is the single most expensive decision
to reverse — typically a full data migration plus auth rewrite.

It must be decided **before** Milestone 0, not during it. `⛔ DECISION REQUIRED — D-1`

### C5 — Accounting and invoicing are compliance products, not features

Money is not a CRUD problem. The following are non-negotiable and are usually discovered too late:

- **Exactness:** integer minor units (bigint) in the database; never floating point; explicit currency
  and rounding rules.
- **Immutability:** journal entries are append-only. Corrections are *reversals*, never updates or
  deletes. For a system that may be audited, "who changed this posting and when" must be answerable.
- **Periods:** a closed fiscal period stays closed; posting rules depend on a fiscal calendar.
- **Jurisdiction:** VAT/tax rates, invoice content requirements, e-invoicing formats (e.g. Peppol),
  document numbering rules, and legally required retention periods are **country-specific** and
  change over time. They are configuration and validation, not universal business logic.
- **Reconciliation:** the ledger, the invoices, and the bank/payment records must be reconcilable and
  must agree. Two sources of financial truth is a design defect.

I inspected the available JavaScript/TypeScript double-entry implementations before writing this
(reuse-before-build, as required by our principles). The findings were consistent: the credible
options are either tied to MongoDB/Mongoose, or are recent single-maintainer projects with negligible
adoption. None is a safe foundation to bet a company's books on. Proven *semantics* exist in
beancount / hledger / ledger-cli and in ERPNext and Odoo — adopt their **model**, not their code.

**Recommendation:** build a small, pure, extremely well-tested accounting kernel in TypeScript
(accounts, journal, postings, periods, reversal, trial balance), keep it free of framework and database
dependencies, and put an explicit adapter boundary around it so it can be replaced. Reuse libraries
for everything around it (money arithmetic, PDF, spreadsheets) and for nothing inside it.
This is the one place where "do not build from scratch" is wrong, and it should be an explicit,
recorded exception.

### C6 — Permissions should not become an authorization framework

A general ABAC/policy-engine implementation is a large project with weak tooling support and poor
debuggability. Start with **RBAC plus resource scoping** (role → permissions as data, permissions as
stable strings like `invoice:create`), behind a single `can(actor, action, resource)` chokepoint used
by both the server and the UI. Two hard rules:

- UI checks are **cosmetic only**; the server always re-checks.
- Because server and UI share the same package, "the button is visible but the API refuses" cannot
  happen by accident.

Revisit with a policy DSL only after real requirements (delegation, approval limits, row-level
ownership) appear.

### C7 — Generic metadata / dynamic entity systems are the classic trap in this domain

"Configurable entities" and "admin-defined forms" look like the ultimate reuse and are the most
reliable way to destroy type safety, testability, AI-agent navigability, and performance. They are
explicitly deferred (section 9) until there are at least three concrete cases that cannot be solved by
ordinary code.

### C8 — Documentation volume is not the same as shared technical memory

Six root-level documents written on day one and then abandoned are worse than two that are actually
maintained. Documentation must be **small, tiered, and enforced**: a document is updated in the same
pull request as the code it describes, and CI should check that a module has a contract document.

### C9 — With a non-technical product owner, quality must be machine-enforced

Mohamed cannot review code, and AI agents generate code faster than any human can read it. Therefore
"Definition of Done" cannot depend on review opinions. It must be *automated gates*: typecheck, lint,
boundary rules, unit tests, integration tests on a real database, end-to-end tests on critical flows,
build verification. If a rule matters, it must fail CI — otherwise it will be ignored by both agents
and humans.

### C10 — Undecided language/stack is an acceptable state *today* and an unacceptable state after Milestone 0

Every week of implementation on an undecided stack increases the cost of changing it. Lock it now.
`⛔ DECISION REQUIRED — D-2`

### C11 — Language localization has been conflated with working language

"Everything in the repository is English" is correct and I agree with it completely — code,
identifiers, comments, docs, commits, PRs. But *if real users will use the applications in Arabic
(or any non-English language)*, then internationalization and RTL support must exist in the UI layer
from the first screen. Retrofitting RTL into a component system that assumed left-to-right is
expensive and touches every single view. `⛔ DECISION REQUIRED — D-4`

### C12 — Repository conventions must be enforced by tooling, because agents silently drift

Agents (including me) will eventually import across module internals, create a second way to do
something, or duplicate a helper. Conventions stated only in prose decay. Boundary rules
(`core` imports nothing; packages never import apps; no deep imports into another package) must be
executable checks in CI.

---

## 4. Recommended high-level repository architecture

### 4.1 Shape

**One monorepo. One modular monolith per application. Shared packages, separate deployments.**

```
mohamed-app-factory/
├── AGENTS.md                  # how agents work here (rules, commands, guardrails)
├── ARCHITECTURE.md            # system shape, boundaries, dependency rules
├── PRODUCT.md                 # what we build, for whom, non-goals, glossary
├── MODULES.md                 # catalog: module -> status, owner, dependencies
├── DECISIONS.md               # ADR index (one line per decision, links to docs/adr)
├── CONTRIBUTING.md            # workflow, PR rules, Definition of Done gate
├── README.md
│
├── apps/
│   ├── property/              # Application #1 (Milestone 0/1)
│   ├── sales/                 # Application #2 (skeleton at Milestone 2)
│   └── admin/                 # optional internal ops console (later)
│
├── packages/
│   ├── config-ts/ config-eslint/ config-vitest/     # tooling configs (no runtime code)
│   ├── core/                  # kernel: IDs, Money, dates/periods, Result, errors, Clock
│   ├── db/                    # connection, migration runner, tenancy, transaction boundary
│   ├── auth/ authorization/ audit/ settings/
│   ├── ui/ ui-patterns/
│   ├── parties/ files/ documents/ notifications/ jobs/
│   ├── accounting/ invoicing/ payments/ reporting/
│   ├── integrations/
│   └── testkit/               # factories, DB reset, auth-as-role helpers
│
├── tools/
│   ├── generators/            # scaffolds: new module, new migration, new report
│   └── scripts/
│
├── docs/
│   ├── adr/                   # 0001-....md (MADR format)
│   ├── modules/<module>.md    # one contract document per module
│   ├── playbooks/             # add-a-module, add-a-migration, add-a-permission, add-a-report
│   ├── runbooks/              # deploy, restore-backup, rotate-secrets, incident
│   ├── architecture/proposals/ # this document
│   └── glossary.md            # ubiquitous language (Invoice, Posting, Party, Lease, ...)
│
└── .github/workflows/
```

### 4.2 Module anatomy (the same in every package)

```
packages/invoicing/
├── src/
│   ├── domain/         # pure: entities, value objects, invariants, domain events. No I/O.
│   ├── application/    # use cases, ports (interfaces the outside world must implement)
│   ├── infrastructure/ # Drizzle repositories, provider adapters, implementations of ports
│   ├── api/            # contracts (Zod), HTTP handlers / server actions
│   ├── ui/             # React components for this module (optional)
│   ├── migrations/     # migrations owned by this module
│   └── index.ts        # PUBLIC SURFACE — the only import path for other packages
├── README.md           # contract: purpose, status, public API, events, permissions, deps
└── package.json
```

Why this shape: it is boring, repeatable, and *guessable*. An agent that has seen one module can
correctly extend any other module. That property is worth more than architectural elegance.

### 4.3 Dependency rules (machine-enforced in CI)

1. `apps/*` may import `packages/*` and their own local modules.
2. `packages/*` **never** import `apps/*`.
3. A package may import another package **only through its public entry point** — no deep imports
   (`@factory/invoicing/src/domain/...` is a CI failure).
4. `core` depends on nothing: no ORM, no React, no framework, no Node-specific runtime APIs.
5. `domain/` and `application/` never import `infrastructure/`, a framework, or a database client.
6. Cross-module coupling happens only through (a) public package APIs, (b) domain events via the
   outbox, or (c) shared identifiers. **Never** by querying another module's tables.
7. There are no circular dependencies, at any level.

Enforcement: dependency graph check (`dependency-cruiser` or `eslint-plugin-boundaries`) run as
`pnpm check:boundaries` in CI. This is one of the highest-value 50 lines of configuration in the whole
repository.

### 4.4 A note on "thin packages" vs "build step tax"

Use **source-first internal packages**: `package.json` `exports` point at TypeScript source, and the
consuming app's bundler/compiler resolves them directly. No per-package build step, no
`dist/` folder, no version bumping between packages in the monorepo. This removes almost all of the
overhead that usually makes teams regret fine-grained packages, and it makes the module boundary a
*conceptual* unit rather than a *release* unit.

Escape hatch: if a package ever genuinely needs an independent release cycle (external consumers), it
can be given a build step and published later. Keeping packages dependency-light keeps that door open.

---

## 5. Monorepo vs multiple repositories — recommendation

**Recommendation: a single monorepo.** Reasoning, in order of importance for *this* project:

1. **AI agents navigate one tree.** Cross-cutting understanding ("how does an invoice become a
   posting?") requires seeing both sides. Across repositories, an agent cannot follow the chain, and
   generated changes silently break the other side.
2. **Atomic cross-cutting changes.** Changing a shared contract and both consumers in one commit,
   one CI run, one review. In multi-repo this becomes a version-coordination project.
3. **One source of truth for schema and contracts.** Migrations, permission catalogs, and document
   template contracts stay consistent by construction.
4. **Refactoring is cheap, which is what makes "promote to a package" viable at all.** Moving a module
   between "app-specific" and "shared" must be a routine, low-risk operation. Multi-repo makes it a
   project.
5. **Small team, no competing release cadences.** Multi-repo exists to solve organizational problems
   (independent team autonomy, independent release cycles) that we do not have.

**Costs and mitigations:**

| Cost | Mitigation |
| --- | --- |
| CI gets slower as the repo grows | Turborepo affected-only task graph; run only what changed |
| Coupling can hide inside one repo | The dependency rules in §4.3 are enforced, not advisory |
| One repo = one blast radius for a bad commit | Per-app deployables; apps deploy independently of each other |
| Repo size | Applications are separate apps, not copies of a template |

**Explicitly rejected:** a shared runtime ("platform service") that all applications call at runtime.
Shared *libraries* keep deployment independent; a shared *service* couples their uptime, their
versioning, and their data, and would be a microservices move disguised as reuse.

**Hybrid model — when it becomes correct:** extract a package into its own repository only when it
(a) has an external consumer outside this team, or (b) needs a genuinely independent release cycle.
Neither is true today, and both remain cheap later because packages are dependency-light and
publishable-shaped.

---

## 6. Separating reusable from application-specific modules

Four classes. Every piece of code belongs to exactly one.

| Class | Example | Location | Rule |
| --- | --- | --- | --- |
| **Kernel** | Money, IDs, dates, Result, errors | `packages/core` | Zero business semantics, zero dependencies |
| **Business capability** | Parties, accounting, invoicing, documents | `packages/<name>` | Shared code, configured by apps; no app names in the code |
| **Application-specific** | Lease escalation rules, property inspection workflow | `apps/<app>/src/modules/<name>` | Not shared until a second consumer exists |
| **Glue** | Wiring, config, route registration | `apps/<app>/src/app` | Thin, no business logic |

### 6.1 The key position: location is not a claim of generality

I recommend placing capabilities in `packages/*` **from day one**, even when only one application uses
them. This looks like premature generalization and is not, for one reason:

> We are deferring **generality** (feature flags, pluggable strategies, multi-provider support,
> configuration options), not the **boundary**.

A module with one consumer and a narrow interface is excellent engineering. A module with one consumer
and eleven configuration options is speculative generality. The `packages/*` location costs almost
nothing (§4.4) and buys a stable import path, enforced seams, and testability in isolation. It also
means that when the second application appears, "promotion" is a **status change in a document**, not
a refactor across the repository.

### 6.2 Module status markers (how we avoid lying to ourselves)

Every module README and every `MODULES.md` row carries exactly one status:

- `experimental` — one consumer, API may change without notice.
- `stable` — two or more real consumers, API changes require an ADR.
- `deprecated` — superseded, with a migration path and a removal date.

"Stable" is earned by a second real consumer. This single convention replaces most architectural
gate-keeping, and it is unambiguous to both humans and agents.

### 6.3 The promotion protocol

1. Capability is implemented inside the consuming application (or as `experimental` in `packages/`).
2. A second application needs it → the second consumer is written **without modifying the package
   first**; note every friction point.
3. Extract the real common core, driven by the friction notes, not by imagination.
4. Add contract tests, a module document, and an ADR if the public API changes.
5. Mark `stable`.

### 6.4 Anti-patterns to reject in review

- `if (appName === 'sales')` inside a package.
- A package importing another package's internals.
- A generic `utils` package that accumulates unrelated helpers (it becomes a junk drawer; it should
  always be split by concern).
- Shared database tables queried directly by a module that does not own them.
- An abstraction introduced with exactly one implementation and no second consumer in sight.

---

## 7. Sharing strategy, per concern

### 7.1 Business logic

- **Model:** pure domain first. Entities, value objects, invariants, and domain events with no I/O.
  Use-case layer orchestrates; ports (interfaces) declare what the outside world must provide;
  infrastructure implements them.
- **Rule:** a domain function that touches the database, the clock, or the network is a bug. Inject
  `Clock`, `IdGenerator`, and repository ports instead. This makes business rules fast and trivial to
  test — and it is the single most important enabler of reliable AI-generated code, because the agent
  gets immediate, deterministic feedback.
- **Sharing:** pure functions and validated contracts are cheap to share. Workflows that only *look*
  similar are not — the differences (approval rules, tax treatment, numbering) are where reuse breaks
  down. Share the primitives, not the processes.

### 7.2 UI components

- **Do not build a design system from scratch.** Wrap a mainstream, headless-first component
  foundation (shadcn/ui-style primitives over Radix, or MUI) and own only the tokens, the layout
  shell, and the business-pattern components.
- **Three layers, deliberately separated:**
  1. `ui` — primitives, tokens, form controls, tables, dialogs, empty/error/loading states.
  2. `ui-patterns` — the reusable *business* screens: `ResourcePage` (list + detail + edit),
     `DataTable` (filter, sort, paginate, saved views, export), `EntityForm` (schema-driven
     validation, dirty-state handling, permission-aware fields), `MoneyField`, `DateRangePicker`,
     `ImportWizard`.
  3. `app-shell` — navigation, theme, tenant branding, command palette, layout.
- **This is where the factory wins biggest.** `ui-patterns` removes 60–80% of the code from every
  future CRUD screen. It is also where the i18n/RTL question (C11) must be answered up front.
- **Rule:** no application-specific business logic inside `ui`. Components take props and emit events.

### 7.3 Database schemas

- **One schema per module namespace**, in a single PostgreSQL database per application deployment.
  Table prefixes by module (`acct_`, `inv_`, `pty_`) so ownership is visible in every SQL statement.
- **Migrations are owned by the module that owns the table**, live in `packages/<module>/src/migrations/`,
  and are assembled and ordered by a central migration runner in `packages/db`. The app never authors
  migrations for another module's tables.
- **Cross-module references are by ID only.** No foreign keys into another module's tables (except to
  `core`-owned identities like `tenant` and `user`, where an FK is intentional and safe).
- **Tenant isolation is structural, not conventional.** Depending on D-1: either row-level security
  enforced by PostgreSQL policies, or physical separation. It must be impossible for a developer to
  forget a tenant filter — a forgotten `WHERE tenant_id = ...` is a data breach, not a bug.
- **Reporting reads views, not raw tables**, so reports remain stable when the write model evolves.
- Migrations: forward-only in production, with a documented restore path (§12). Every migration must
  be safe to run against a live database (expand → migrate → contract).

### 7.4 Document templates

- **Format:** HTML + CSS templates rendered to PDF via headless Chromium (Playwright) in a worker
  process. Rationale: templates become ordinary web code that agents and designers can write, CSS
  handles layout and pagination, and we reuse the same primitives as the UI. (Alternatives —
  a document service, or a typographic engine — add an external dependency or a language to the
  stack; revisit only if HTML/PDF proves insufficient.)
- **Contract:** each template declares a typed data contract (Zod schema). The template cannot
  reference a field that the contract does not guarantee — validated at build time.
- **Versioning:** templates are versioned artifacts. An issued invoice must always re-render
  byte-identically to what the customer received. The rendered PDF (and its template version) is
  stored with the document, not regenerated on demand.
- **Testing:** snapshot tests per template with realistic fixtures; a broken invoice template is a
  customer-facing incident.
- **Spreadsheets and editable documents** (Excel, Word) are exports, not templates: separate concern,
  separate library, lower priority.

### 7.5 Accounting functionality

- **Core ledger in `packages/accounting`**, framework-free, with: chart of accounts (hierarchical,
  typed), fiscal periods and period locks, journals (append-only), double-entry postings
  (balanced per currency), reversal instead of mutation, trial balance and account statements.
- **Money type in `packages/core`**: integer minor units + currency code; explicit rounding policy;
  no floats anywhere in the system, including the UI layer.
- **No posting logic inside invoicing.** `invoicing` emits domain events
  (`InvoiceIssued`, `PaymentRecorded`); `accounting` consumes them through a **posting-rules**
  configuration and writes the journal entry. This keeps the ledger a projection of business events
  rather than a tangle of cross-module UPDATEs, and it makes the ledger testable in isolation.
- **Jurisdiction is a separate, pluggable concern**: tax determination, invoice content requirements,
  e-invoicing formats, and numbering sequences are strategy implementations selected per tenant
  country. One country supported properly beats ten supported badly — start with the country that has
  a real user.
- **Explicitly out of scope until needed:** multi-company consolidation, multi-currency revaluation,
  deferred tax, budgets, fixed-asset depreciation, cost accounting. They are real ERP features, and
  each is a project.

### 7.6 Permissions

- **Model:** roles → permissions (data, not code) with resource scoping (tenant / organization /
  branch / own-records-only). Permissions are stable strings: `invoice:create`, `payment:record`,
  `report:profit_and_loss`.
- **Single chokepoint:** `can(actor, permission, resource)` in `packages/authorization`, used by the
  server on every mutating endpoint and by the UI to render. Because both sides share the package, a
  UI affordance can never contradict server enforcement by accident.
- **Non-negotiable rules:** (1) server-side check on every mutation, (2) UI checks are cosmetic,
  (3) every permission decision on a sensitive action is recorded in the audit log, (4) permissions
  are declared by the module that owns them and aggregated into a single catalog so the admin UI and
  tests can enumerate them, (5) a test asserts the default role set for a fresh tenant.
- **Deferred:** ABAC, policy DSLs, delegation, approval limits, field-level permissions.

### 7.7 Integrations

- **Pattern:** a **port** in the owning module (e.g. `PaymentProvider`, `EmailSender`,
  `ObjectStorage`, `AccountingExporter`) and **adapters** in `packages/integrations/<provider>`.
  Applications select adapters via configuration. Modules never import a vendor SDK directly.
- **Non-negotiable behaviors for any outbound integration:** timeouts, retries with exponential
  backoff, idempotency keys on writes, structured logging with correlation IDs, an outbox so a web
  request never blocks on a third party, and a dead-letter path with an operational view.
- **Inbound webhooks:** signature verification, replay protection, idempotent handlers, and an event
  log. Assume every provider will deliver the same event twice — because they will.
- **Secrets:** never in the database in plaintext, never in the repository. A secrets interface in
  `core` with environment/vault implementations; the local development fallback is explicit and
  obvious.
- **First integrations to actually build:** email (transactional), object storage, payments, and later
  bank statement import (CSV first; bank APIs are a per-country project).

---

## 8. The first 20 reusable building blocks

Ordered by **dependency and risk**, not by business glamour. Retrofitting anything in Tier 0 costs
10–100× more than building it first.

### Tier 0 — Platform spine (Milestone 0)

| # | Block | Why it is first |
| --- | --- | --- |
| 1 | **Monorepo + CI gates** (`config-*`, `tools/`, workflows) | Everything else assumes it; enforces C12 |
| 2 | **`core` kernel** — IDs, Money/Currency, dates & fiscal periods, Result/errors, Clock, validation conventions | Every module depends on it; wrong Money is unrecoverable |
| 3 | **`db`** — connection, transactions, migration runner, tenancy/RLS helpers | Defines how all persistence works |
| 4 | **`auth`** — identity, credentials, sessions, password policy, MFA-ready, behind an `AuthProvider` port | Needed by every screen; must not be DIY crypto |
| 5 | **`authorization`** — roles, permission catalog, `can()` chokepoint, resource scoping | Retrofitting authorization into existing endpoints is brutal |
| 6 | **`audit`** — append-only log, actor context, before/after diffs, query API | Retrofitting audit means the history never existed |
| 7 | **`settings`** — tenant/app settings, feature flags, numbering sequences | Document numbering and settings turn out to be needed by everything |
| 8 | **`ui`** — tokens, primitives, layout primitives, i18n/RTL foundation | Every screen; RTL retrofit is prohibitive (C11) |
| 9 | **`ui-patterns`** — `ResourcePage`, `DataTable`, `EntityForm`, filters, exports | Removes most code from every future screen |
| 10 | **`testkit`** — factories, DB reset, tenant seeding, `auth-as` helpers | Without it, agents cannot verify their own work |

### Tier 1 — Core business capabilities (Milestone 1)

| # | Block | Why |
| --- | --- | --- |
| 11 | **`parties`** — people/organizations, contacts, addresses, roles (customer, supplier, tenant, landlord) | Nearly every app needs "who"; a single Party model avoids duplication |
| 12 | **`files`** — storage port, uploads, attachments, signed URLs, scanning hook | Documents and attachments arrive immediately in both target apps |
| 13 | **`documents`** — versioned templates, render pipeline, PDF output, snapshot tests | Invoices, leases, statements are all the same machine |
| 14 | **`jobs`** — queue, scheduling, retries, idempotency, admin view | Recurring rent invoices and reminders are scheduled work |
| 15 | **`notifications`** — templated email/SMS/in-app, preferences, outbox-driven | Every workflow ends in a notification |
| 16 | **`accounting`** — chart of accounts, periods, journals, posting rules, trial balance | The hardest and most valuable shared module (C5) |
| 17 | **`invoicing`** — quote → invoice → credit note, numbering, tax, statuses, AR ledger | Directly used by both target applications |
| 18 | **`payments`** — recording, allocation to invoices, reconciliation, provider port | Closes the money loop; without allocation, AR is fiction |
| 19 | **`reporting`** — report registry, parameterized views, CSV/XLSX/PDF export, the first standard report set | Reports are the product's visible value to the customer |
| 20 | **`integrations`** — port/adapter kit, resilient HTTP client, webhook receiver, secrets access | Needed the moment anything external is touched |

**Deliberately not on the list yet:** search (PostgreSQL full-text search covers it initially),
dashboards (compose existing reports), expenses/purchases (Milestone 2, reuses invoicing machinery
mirrored), file import/CSV ingestion (extract it the second time it is written).

---

## 9. What must NOT be generalized early

Each item below has a cost in months. Each one is a decision to *defer*, with the trigger that
reopens it.

| Do not build | Do instead | Revisit when |
| --- | --- | --- |
| Generic metadata / dynamic entity / form-builder system | Ordinary typed tables and hand-written screens | Three concrete cases resist normal code |
| Workflow / BPMN engine | Explicit state machines per entity (`draft → issued → paid → void`) | Three workflows share a genuinely identical shape |
| Reporting/BI engine | Parameterized SQL views + exports | Users ask for ad-hoc pivoting |
| Custom design system | Wrap an existing headless component foundation | The wrapper proves insufficient in repeated real screens |
| Event sourcing / CQRS | Transactions + domain events via an outbox | Never, unless a hard requirement appears |
| Microservices / message broker | Modular monolith, one PostgreSQL | Independent scaling or team autonomy is a demonstrated need |
| Plugin / marketplace architecture | Internal packages and configuration | Third-party developers exist |
| Multi-currency consolidation, deferred tax, fixed assets | Single functional currency, correct single-currency books | A real user needs it, in writing |
| Approval workflows with multi-step routing | A status field plus an audit trail | Real organizational rules demand it |
| Notifications rule engine | Direct calls at the few places that need them | Notification rules are edited by users, not developers |
| i18n of *business content* (not UI) beyond one language | UI-level i18n; business data single-language | A customer uses the product in a second language |
| AI/LLM features inside the product | Nothing | The core transactional product is stable and adopted |
| Self-service tenant onboarding and billing | Manual provisioning by us | We have more tenants than we can onboard by hand |

The last row matters: a factory is not the same as a SaaS. Self-service signup, billing, and tenant
lifecycle management are a *product*, and they should not be built before there are customers.

---

## 10. Documentation and agent-instruction files

### 10.1 Root files (created in Milestone 0 — six, not twenty)

| File | Purpose | Update obligation |
| --- | --- | --- |
| `AGENTS.md` | How an agent works here: exact commands (setup, lint, test, migrate, run), hard rules, "never do X", PR checklist, where to look first | Whenever tooling or a rule changes |
| `ARCHITECTURE.md` | System shape, module map, dependency rules, request/data flows, tenancy model | When the shape changes |
| `PRODUCT.md` | Who the users are, what the applications do, non-goals, glossary of business terms | When product scope changes |
| `MODULES.md` | Catalog: module → status (`experimental`/`stable`/`deprecated`), owner, public API summary, dependencies | When a module is added or changes status |
| `DECISIONS.md` | Index of all ADRs, one line each, newest first | Every decision |
| `CONTRIBUTING.md` | Branch/PR/commit workflow, Definition of Done, review expectations | When the process changes |

Supported by `docs/adr/` (MADR format), `docs/modules/<module>.md` (the contract: purpose, public API,
data model, events, permissions, extension points, tests), `docs/playbooks/` (repeatable procedures:
add a module, add a migration, add a permission, add a report), `docs/runbooks/` (deploy, restore,
rotate secrets), and `docs/glossary.md` (ubiquitous language — a shared vocabulary is what prevents an
agent from inventing a second name for an existing concept).

### 10.2 Agent-specific design decisions

- **Nested `AGENTS.md` per package** *only where local rules genuinely differ*. Root rules +
  one file per non-obvious package beats twenty files restating the root.
- **Every rule must be executable.** If `AGENTS.md` says "packages must not import apps", CI must
  fail when they do. Prose rules that cannot fail a build are decoration.
- **Playbooks over explanations.** Agents follow procedures far more reliably than they generalize
  from principles. "To add a report: 1… 2… 3…" beats a paragraph on reporting philosophy.
- **`docs/modules/<module>.md` is a merge requirement** for any PR that changes a module's public
  API. Add it to the PR checklist; consider a CI check that a changed module has a document.
- **Decision records are not optional.** If a PR makes a structural choice (new dependency, new
  boundary, new abstraction), it must include an ADR. Keep them short: context, decision, consequences,
  alternatives rejected.

### 10.3 What to avoid

- Creating all six root documents with placeholder content on day one. Write them when they have
  something true to say; `AGENTS.md`, `ARCHITECTURE.md`, and `DECISIONS.md` come first.
- Documents that restate the code. Document *decisions, contracts, and procedures* — never
  line-by-line descriptions that rot immediately.
- A wiki or an external knowledge base. If it is not in the repository, an agent cannot see it, and
  it will be lost.

---

## 11. Recommended technology stack (D-2, recommendation attached)

This is a decision, so here is a recommendation with reasoning rather than a menu.

| Concern | Recommendation | Rationale |
| --- | --- | --- |
| Language | **TypeScript, strict mode, everywhere** | One language across UI, API, domain, tooling; types are the best available guardrail for AI-generated code; largest library ecosystem for business UI |
| Runtime | Node.js LTS | Boring, sufficient; no need for anything exotic |
| Repository tooling | **pnpm workspaces + Turborepo** | Fast, simple, minimal config, good agent familiarity |
| Database | **PostgreSQL** | Transactions, constraints, row-level security, JSONB, full-text search, window functions, mature backups. One database covers OLTP + reporting + search + queue for a long time |
| Data access | **Drizzle** (SQL-first) + Zod contracts | Keeps SQL visible for reporting/RLS; no heavy codegen daemon; thin repository layer keeps it replaceable |
| Application shape | **Next.js (App Router) as the app shell** + a separate worker process from the same codebase | One deployable per app, batteries included for forms/auth/routing; a separate worker keeps PDF generation, emails, and recurring invoices out of the request path |
| Business logic location | `packages/*` — framework-free | Keeps the option of a separate API (Fastify) later a thin adapter, not a rewrite. Trigger: a mobile app or an external consumer appears |
| Background work | `pg-boss` (PostgreSQL-backed) | Avoids introducing Redis/another broker; sufficient throughput for this domain |
| Validation | Zod | One schema definition used for API contracts, forms, and template data contracts |
| Testing | Vitest (unit/domain), Testcontainers-style real Postgres (integration), Playwright (e2e on critical flows) | Deterministic domain tests are the agent's feedback loop; e2e only for money-critical paths |
| PDF | Playwright/Chromium in the worker | Templates are HTML/CSS; same skills for design and code |
| Auth | A maintained library behind an `AuthProvider` port | The **port** is the architectural decision; the vendor is replaceable. Corporate SSO across many tenants would justify a dedicated identity provider later |
| Observability | Structured logs (pino) + OpenTelemetry traces + error tracking | Financial workflows require "what happened" to be answerable |

**The one alternative worth considering** is a Vite SPA + explicit Fastify API instead of Next.js. It is
easier to reason about and to test over HTTP, and this product has no SEO or public-content needs.
I am not recommending it because Next.js gives more for free (routing, forms, auth integration,
server rendering of data-heavy screens) with a smaller amount of custom code — and less custom code is
what makes an AI-run factory survive.

**What the stack must not become:** a Python/TypeScript polyglot where business rules live in two
places, or a JavaScript frontend with a *separate* backend business layer. One language, one place for
each rule.

---

## 12. First concrete implementation milestone

### Milestone 0 — Walking Skeleton (recommended first milestone)

**Goal:** prove the whole pipeline end-to-end with one thin capability, on one application, deployed
and verified. Not a module. Not a feature set. A complete, thin vertical slice that establishes every
convention the factory will reuse.

**Scope (deliberately small):**

1. Monorepo scaffold: pnpm workspaces, Turborepo, `packages/config-*`, `.github/workflows` CI.
2. `packages/core`: IDs, Money, Currency, dates/fiscal periods, Result/errors, Clock — with tests.
3. `packages/db`: connection, transaction helper, migration runner, tenancy helper; migration for the
   first tables.
4. `packages/auth` (behind its port): sign in, sign out, session, password policy.
5. `packages/authorization`: two roles, a permission catalog, `can()` enforced server-side.
6. `packages/audit`: automatic auditing of writes with actor and diff.
7. `packages/ui` + `ui-patterns`: app shell, `ResourcePage`, `DataTable`, `EntityForm` — enough for one
   real screen, with the i18n/RTL decision applied (not retrofitted).
8. `packages/testkit`: factories, DB reset, tenant seed, `auth-as` helpers.
9. `packages/parties`: the first real module — customers, minimal but complete.
10. `apps/property`: one deployed environment, seeded tenant, one full CRUD flow plus a denial path.
11. Documentation: `AGENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md` + ADRs 0001–0008, `MODULES.md`,
    `CONTRIBUTING.md`, `docs/modules/parties.md`, and the first playbooks.

**Definition of Done — all must be demonstrably true:**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green in CI on a clean clone.
- [ ] Boundary rules (`.dependency-cruiser` or equivalent) fail CI on a deliberately introduced
      violation — **verified by test, not by assertion**.
- [ ] A user can sign in, and sees only the navigation their role permits.
- [ ] An integration test proves a forbidden action returns 403 **even when the UI check is bypassed**.
- [ ] Creating and editing a customer writes an audit record with actor, entity, before/after.
- [ ] The migration pipeline runs forward on a fresh database and is documented in a runbook,
      including the restore path.
- [ ] One Playwright test covers: sign in → create customer → see it in a filtered list → denied
      action → confirm audit trail.
- [ ] A staged deployment is reachable at a URL, with a documented deploy and rollback procedure.
- [ ] An agent with no prior context can read `AGENTS.md` and add a field to a customer screen
      (schema → migration → domain → API → UI → test) without asking a question. **This is the
      factory's actual acceptance test.**

That last checkbox is not decoration. The product being built is *the ability to build applications*,
so the honest measure of Milestone 0 is a new agent's ability to extend it unaided.

### Milestone 1 — First real business slice (property & rental)

Property → unit → lease → **recurring rent invoice** → rendered PDF → **payment recorded and
allocated** → tenant ledger → AR aging report, with permissions and audit throughout. This single
slice exercises dates and recurrence, money and rounding, documents and templates, scheduled jobs,
notifications, accounting postings, permissions, and reporting — i.e. every risky pillar of the
factory — with a real user able to say whether it is correct.

### Milestone 2 — Second application thin slice (the forcing function)

A deliberately thin `apps/sales` slice: customer → quote → invoice. Its purpose is **not** to deliver a
sales product; it is to force the extraction of `parties`, `invoicing`, `documents`, and `ui-patterns`
into genuinely stable shared modules. The friction encountered while building it is the design input
for the shared APIs — which is exactly why it must come early and stay thin.

### Sequencing principle

Platform capabilities are built **only when a real screen in a real application needs them**. Anything
built "for later" is a liability until proven otherwise.

---

## 13. Open decisions

> **Status update — 2026-10-13.** Answers received from Mohamed, and one decision added. See
> [proposal 0002](0002-open-source-reuse-audit.md) for the audit that now gates the first application,
> and [`docs/adr/`](../../adr/) for decisions that have been formally accepted.

| ID | Decision | Owner | Status | Blocking | Recommendation |
| --- | --- | --- | --- | --- | --- |
| **D-1** | Tenant/deployment model: single-tenant per customer, multi-tenant with row-level security, or schema-per-tenant | Mohamed (business) + ChatGPT + Arena | **Open** — build tenant-aware by default so no path closes | Milestone 0 | Multi-tenant-capable data model (`tenant_id` everywhere + RLS), deployment flexibility retained; decide commercially, build for it structurally |
| **D-2** | Language and stack (section 11) | Mohamed + ChatGPT + Arena | **Deferred** — written comparison + ADR required first | Milestone 0 | TypeScript + PostgreSQL, revised by the audit's RTL finding (see proposal 0002 §5.1) |
| **D-3** | Which application is genuinely first, judged by real user pressure | **Mohamed** | **Deferred** — gated on the open-source reuse audit and on customer access | Milestone 0 | Property & rental (proposal 0002 §10), conditional on having reachable customers in that domain |
| **D-4** | End-user languages | **Mohamed** | ✅ **Decided** | — | **Arabic + RTL are first-class requirements.** Recorded as [ADR-0001](../../adr/0001-localization-arabic-rtl-first.md) |
| **D-5** | Authentication: library vs dedicated identity provider; is corporate SSO (SAML/OIDC) ever required? | Mohamed + Arena | Open | Milestone 0 | Library behind a port (Better Auth evaluated in proposal 0002 §5); keep the escape hatch |
| **D-6** | Hosting target and deployment topology | Arena + Mohamed | Open | Milestone 0 | Decide jointly; keep it boring (one managed Postgres, one container host) |
| **D-7** | First country's tax/invoice rules (VAT, e-invoicing, retention) | Mohamed (business) | Partially known — Egypt: ETA e-invoicing mandatory, 14% VAT, Arabic mandatory on tax invoices | Milestone 1 | One country done properly, as a jurisdiction module |
| **D-8** | Build-versus-adopt for the whole platform (C1) | Mohamed | **Audited** — awaiting review | Before Milestone 1 | Build custom on permissively-licensed components; buy ETA compliance (proposal 0002 §1, §9) |
| **D-9** | Product business vs. internal automation for Mohamed's own companies | **Mohamed** | ✅ **Decided — both** | Everything | Build the product; use Mohamed's own companies as customer zero. See proposal 0003 §4 for the discipline this requires |
| **D-10** | Build-vs-adopt end state (Option C vs Option D) | Mohamed + Arena | **Spike first pass done — no kill criterion fired** | Milestone 1 | Decided by measurements, not preference — [proposal 0003](0003-option-c-spike.md) / [results](0004-option-c-results.md). Four measurements outstanding (Arabic PDF, API ergonomics, upgrade rehearsal, per-tenant operations) |

---

## 14. ADRs this proposal should produce

ADRs are numbered **when they are accepted**, in order — a decision proposed in this document is not a
decision until it appears in [`docs/adr/`](../../adr/). The candidate decisions below are the ones I expect
this proposal to generate; the numbering will be assigned at acceptance. See
[`docs/adr/README.md`](../../adr/README.md) for the current index.

- Build a custom factory instead of adopting an existing ERP platform *(now informed by proposal 0002)*
- Single monorepo, modular monolith, one deployable per application
- TypeScript end-to-end with PostgreSQL *(revised by the RTL requirement — see proposal 0002 §5.1)*
- Tenant isolation strategy
- Money representation: integer minor units, currency-aware, no floats
- Double-entry accounting kernel built in-house, isolated behind adapters
- Authorization model: RBAC with resource scoping behind a single `can()` chokepoint
- Module boundaries and dependency rules, machine-enforced in CI
- Reuse policy: generalize at the second consumer; module status markers
- Document generation: HTML/CSS to PDF via headless Chromium, versioned templates
- Egyptian jurisdiction: ETA e-invoicing behind a provider port, VAT 14%, bilingual documents

---

## 15. Summary of my position

1. The concept is right; the sequencing in the original framing is the risk.
2. Build **one real application** first, with enforced internal boundaries — not a platform.
3. Single **monorepo**, modular monolith, one deployable per app, shared libraries only.
4. Defer **generality**, establish **boundaries** — and earn "stable" with a second consumer.
5. Hand-build **only** accounting semantics and business workflows; adopt everything commodity.
6. Money, tenancy, permissions, and audit are the four decisions that cannot be retrofitted cheaply.
   Get them right in Milestone 0.
7. The factory's real test is whether a fresh agent can extend it unaided — so make that an explicit,
   checkable acceptance criterion rather than an aspiration.
