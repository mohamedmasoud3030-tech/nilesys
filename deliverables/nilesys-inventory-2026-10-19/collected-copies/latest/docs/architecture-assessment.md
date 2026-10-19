# Mohamed App Factory — Architecture Assessment

- **Date:** 2026-09-04
- **Status:** Draft — for review by Mohamed and ChatGPT
- **Author:** Arena (senior implementation / architecture reviewer)
- **Stage:** Architectural consultation only. No application code written.

---

## 1. Scope

This document is the first architectural consultation for the Mohamed App
Factory. It assesses the strategy, challenges weak assumptions, proposes a
high-level repository architecture, and recommends a first milestone. It is
intentionally a *planning* artifact, not code.

---

## 2. Current state

The repository contains a single `README.md` (project title only). There is no
code, no documentation, and no decision history. Everything below is
greenfield and must be built in small, verifiable steps.

---

## 3. Overall assessment

The core idea is sound and matches a proven industry pattern: a **shared
platform core plus vertical applications built on top of it**. This is the
same shape used by Odoo (core + modules), ERPNext (Frappe framework + apps),
and Django/Laravel ecosystems (framework + reusable apps).

The strategy document already shows good instincts — "reuse before building,"
"simplicity," "avoid microservices," "small verifiable changes." These are the
right instincts and should be defended aggressively.

The main correction is one of *framing*: the project should be described as
**"build a modular monolith, extract shared modules when a second/third use
proves the seam"**, not **"build a generic framework first, then stamp out
apps."** The difference is subtle but is the single most important factor in
whether this succeeds or becomes an over-engineered, unmaintainable framework.

---

## 4. Assumptions I challenge

1. **"Build once → reuse many times" is premature generalization.** With only
   two applications, both in the same vertical (business operations), you do
   not yet know the true abstraction boundary. Reuse should *emerge* through
   the Rule of Three: build app #1 for itself, build app #2 honestly, and
   extract the shared module when the third use appears. Designing every
   capability as reusable from day one is exactly the over-engineering the
   principles warn against.

2. **The capability list conflates unlike things.** Authentication, audit logs,
   and files are *platform infrastructure* — safe and sensible to share early.
   Accounting, payments, and invoicing are *domain* capabilities with legal,
   fiscal, and regional variation — the worst possible candidates for early
   generalization. Listing them side by side as equal "shared capabilities"
   invites the wrong build order.

3. **Two apps in one vertical is a weak reuse signal.** Sales/Business
   Management and Property & Rental Management overlap so heavily (customers,
   invoicing, payments, expenses) that they will blur together. They should be
   treated as a single "business operations" vertical for now. The factory's
   generality claim is unproven until a *different* domain (healthcare,
   logistics, education) actually consumes the modules.

4. **"AI-friendly" via documentation is necessary but not sufficient.** Prose
   documentation rots, and AI agents will follow it only where the toolchain
   enforces it. Real AI-safety comes from: deterministic setup commands,
   enforced module boundaries (CI fails on an illegal import), strict type
   checking, and one-small-change-per-PR discipline. Docs plus enforcement —
   never docs alone.

5. **Centralized decision authority + autonomous AI execution risks
   architectural drift.** Mohamed makes product decisions, but technical
   decisions (stack, tenancy, schema) must be recorded as Architecture
   Decision Records (ADRs) and enforced in CI. Otherwise the result is "three
   agents, three patterns" and a codebase nobody can explain.

6. **Accounting/payments from scratch is the highest-risk item in the list.**
   It carries fiscal/legal liability, multi-currency, tax, and audit
   requirements. For v1 the factory should integrate with existing providers or
   build only a minimal double-entry ledger for what the first two apps
   actually need — and defer compliance/reporting. "Build once, reuse many" is
   precisely the wrong instinct here.

7. **First-order decisions are missing.** Tech stack, tenancy/deployment model,
   and whether the two applications are one product or two are unstated. The
   repository architecture cannot be concrete until these are recorded. Defaults
   are proposed in section 15 and must become ADRs.

---

## 5. Key risks

| Risk | Impact | Mitigation |
|---|---|---|
| Building the framework before app #1 ships value | Analysis paralysis, dead abstraction | Walking-skeleton first (section 13); extract, don't pre-build |
| Over-generalizing accounting/payments | Liability, endless edge cases | Integrate providers first; minimal ledger; defer compliance |
| Blurred boundary between the two similar apps | Modules get polluted with app logic | Enforced dependency rule (section 6) |
| Docs drift from code | Agents misled | Docs live with code; CI checks; module READMEs |
| Concurrent AI agents editing one repo | Merge chaos, inconsistency | One agent / one change / one PR; review gate |
| Multi-tenancy retrofit | Expensive schema rewrite | Decide tenancy now (section 15); scope tenant data from day one |
| Module coupling via direct table access | Un-removable coupling | Public-API-only access; no cross-module foreign keys |

---

## 6. Recommended high-level architecture

**A modular monolith ("modulith") in a single repository.**

One deployable per application, sharing one codebase, with hard module
boundaries. This satisfies "reuse before building" and "simplicity" while
avoiding microservices entirely.

Proposed layout (draft — naming open for discussion):

```
/
├── apps/                    # vertical products (deployables)
│   ├── sales/               # Sales / Business Management
│   └── property-rental/     # Property & Rental Management
├── modules/                 # reusable business capabilities
│   ├── parties/             # customers, contacts, addresses
│   ├── invoicing/
│   ├── payments/
│   ├── expenses/
│   ├── accounting/
│   ├── reporting/
│   ├── dashboards/
│   ├── search/
│   ├── workflows/
│   └── integrations/
├── platform/                # cross-cutting infrastructure (core)
│   ├── auth/
│   ├── users/
│   ├── rbac/                # roles & permissions
│   ├── tenancy/
│   ├── audit/
│   ├── files/
│   ├── notifications/
│   └── settings/
├── shared/                  # design system, common utilities, contracts
│   ├── ui/
│   ├── common/
│   └── contracts/           # shared types, events, DTOs
├── docs/
│   ├── adr/                 # numbered Architecture Decision Records
│   └── ...                  # see section 12
├── AGENTS.md
├── ARCHITECTURE.md
├── MODULES.md
├── PRODUCT.md
├── DECISIONS.md
└── CONTRIBUTING.md
```

**Dependency rule (enforced in CI, not by convention):**

```
apps ──▶ modules ──▶ platform ──▶ shared
```

- Nothing may depend on `apps`.
- `modules` may depend on `platform` and `shared`.
- `platform` may depend only on `shared`.
- Cross-module references are allowed only through each module's **public
  API** (service layer, types, events, and migrations). Direct access to
  another module's database tables is forbidden.
- No cross-module foreign keys. Modules reference entities owned by other
  modules by stable ID and resolve relationships at the service layer. This
  keeps migrations independently evolvable.

**Data:** a single relational database (PostgreSQL is the recommended
default) per deployment. Each module owns its schema (naming prefix, e.g.
`invoicing_invoice`, or Postgres schemas if the tooling supports it cleanly).
A single migration runner applies all module migrations in order.

**Communication:** in-process calls first; a lightweight domain-event + outbox
pattern for cross-module side effects. No message broker in the first phase.

---

## 7. Monorepo vs. multiple repositories vs. hybrid

**Recommendation: a single monorepo now; keep the door open to extraction
later (this is the hybrid model — but only as a future option, not today).**

Reasons:

- Shared modules evolve in lockstep with the apps that consume them. Atomic
  cross-cutting changes (e.g., adding a field used by auth *and* invoicing)
  are trivial in a monorepo and painful across repos.
- One CI pipeline, one source of truth, one way to search the whole codebase —
  directly serving the "AI-friendly repository" goal.
- Cross-repo reuse requires versioning, publishing, and dependency management
  discipline that is expensive and pointless before the public APIs are stable.
- The team is effectively two AI roles plus a non-technical owner; the
  coordination cost of multiple repos is not justified.

Do **not** split into multiple repos until one of these is true:

1. A module needs an independent release cadence consumed by teams outside
   this repository.
2. Different security/permission boundaries require physical isolation.
3. Build times become unmanageable and cannot be fixed by caching/incremental
   builds.

When splitting becomes necessary, the cleanest path is **contract first**:
stabilize the module's public API and events, add tests pinning that contract,
and only then extract — using workspace/package tooling so the extraction is
mechanical, not a rewrite.

---

## 8. Separating reusable modules from application-specific modules

Two mechanisms, equally important:

**a) Location by layer (from section 6).** `platform/` and `modules/` hold
reusable capability; `apps/` holds product logic, screens, and configuration.
An app is a *composition* of modules plus its own thin slice.

**b) A graduation path — extract, don't pre-build.** A capability begins its
life inside an app (e.g. `apps/sales/.../invoicing`). When a second app
genuinely needs it, it is *extracted* into `modules/invoicing` as a refactor,
kept green by the existing tests, and given a public API. Nothing is promoted
to `modules/` or `platform/` based on speculation — only on observed reuse.

Each reusable module exposes:

- a **public API** (service classes/functions, request/response types);
- **domain events** it emits;
- **its own migrations**;
- a **README** (scope, public API, dependencies, maturity status);
- a **manifest** declaring the permissions/resources it adds to the RBAC
  catalog.

Everything else inside the module is private, enforced by lint + CI.

---

## 9. Sharing strategy by artifact type

| Artifact | Approach |
|---|---|
| Business logic | Library modules with typed service APIs + domain events. Apps customize via extension points (hooks/strategies/configuration), never by forking module code. |
| UI components | One shared design system (`shared/ui`): primitives, forms, tables, dialogs. App screens *compose* shared components but are free to differ in layout. A shared component library must not force identical UIs. |
| Database schemas | Each module owns its schema namespace + migrations; one runner applies them. Apps add their own tables referencing module entities by stable ID. No cross-module FKs. |
| Document templates | Shared template *engine* + storage, but templates themselves are data (per-app/per-tenant, versioned), not code. Templates are never hardcoded in modules. |
| Accounting | Do not build a generic accounting engine first. Build a minimal double-entry ledger (chart of accounts, journal entries, postings, balances) scoped to real needs, and integrate/export to real accounting or payment providers for compliance. |
| Permissions | Shared RBAC engine in `platform/rbac` (subjects, roles, permissions, resource scoping). Apps and modules *declare* their permission catalog as data; core enforces centrally. |
| Integrations | Shared integration framework (webhooks in/out, OAuth client, retry, idempotency, credential storage), but each provider is a small concrete adapter. No "universal connector" abstraction. |

---

## 10. What must NOT be generalized early

- **Accounting/tax/legal compliance** — multi-country, multi-currency; wait for
  real requirements from 2–3 apps.
- **A generic reporting/BI engine** — build concrete reports for app #1 first.
- **A workflow/BPMN engine** — simple state machines first; generalize only
  with multiple genuine workflows.
- **A full notification-preferences platform** — email + in-app with a simple
  channel abstraction is enough.
- **A document-management system** (OCR, e-sign, versioning workflows) — a
  template engine + file storage is enough initially.
- **A plugin/scripting/app-store system** — likely never needed.
- **A payment abstraction over many gateways** — integrate 1–2 providers
  concretely first.
- **A theming/customization engine** and **a search indexing platform** — use
  the database + one search library.
- **Multi-tenancy beyond what is actually needed** — see section 15.

Rule of thumb: generalize on the *third* use; extract rather than pre-build.

---

## 11. First reusable building blocks (phased)

**Phase 0 — Foundation (prerequisite, not a feature):**
0. Repo scaffold: layout, CI, lint/format/typecheck/test, module-boundary
   enforcement, DB + migration runner, docs skeleton.

**Phase 1 — Platform core (needed by app #1, safe to share):**
1. Authentication (sessions/tokens, password hashing, reset)
2. Users & identity (profile, status, email verification)
3. Roles & Permissions (RBAC engine + catalog + enforcement)
4. Tenancy / organization scope (if multi-tenant — decide first)
5. Audit log (append-only who/what/when)
6. Settings & feature flags
7. UI design system + core components
8. Notifications (email + in-app)
9. Files & documents (storage abstraction, upload, metadata, access control)

**Phase 2 — Shared business capabilities (used by 2+ apps):**
10. Parties/customers (organizations, persons, contacts, addresses)
11. Invoicing (lifecycle, line items, numbering, PDF)
12. Payments (payment records, gateway adapter, reconciliation)
13. Expenses (claim → approve → pay)
14. Accounting core (chart of accounts, journal, double-entry postings)
15. Reporting (concrete report definitions + renderers)
16. Dashboards (widget registry + data providers)
17. Search (unified module indexing)

**Phase 3 — Advanced (only when demonstrated need exists):**
18. Workflows/approvals (state machines + tasks)
19. Integrations framework (webhooks, OAuth client, retry/idempotency)

Build only what apps #1 and #2 actually need; the rest stays a backlog.

---

## 12. Documentation and agent-instruction files

- **AGENTS.md** — the AI entry point: how to work in the repo, commands,
  conventions, module map, definition of done, boundary rules.
- **README.md** — human entry point: what the project is, quickstart.
- **ARCHITECTURE.md** — high-level architecture, dependency rule, module
  boundaries, tenancy model (with diagrams).
- **MODULES.md** — catalog of modules: purpose, public API, dependencies,
  maturity status (draft/stable/deprecated).
- **PRODUCT.md** — vision, target apps, shared-vs-vertical scope.
- **DECISIONS.md** — index of ADRs.
- **docs/adr/NNNN-*.md** — immutable Architecture Decision Records (context,
  decision, consequences). Superseded, never edited.
- **CONTRIBUTING.md** — human process: PRs, review, definition of done, commit
  conventions.
- **docs/GLOSSARY.md** — ubiquitous language (what is a "party", "posting",
  "tenant").
- **Module-level READMEs** — one per module: scope + public API.
- Config: `.editorconfig`, `.gitignore`, CI workflow, lint/format/typecheck.

Docs must change in the same PR as the code they describe, or they will rot and
mislead the agents that rely on them.

---

## 13. First concrete milestone — the walking skeleton

Do not start with infrastructure for its own sake. Build the thinnest
end-to-end slice that exercises every seam of the factory:

> **Milestone 1 (Sales app):** CI is green with lint + typecheck + tests +
> module-boundary checks. Migrations run. A user can register, log in, create
> and view a Customer, and the action is recorded in the audit log — all in the
> UI built from the design system. ADRs 0001–0004 recorded (stack, modular
> monolith, database, tenancy).

This single slice proves the repository layout, module system, database,
migrations, auth, parties, audit, UI kit, testing, CI, and documentation —
before any accounting, payments, or reporting is attempted.

---

## 14. Working agreement (ChatGPT ↔ Arena)

ChatGPT proposes architecture/stack options with research; Arena reviews,
challenges, records the ADR, and implements. Disagreements are resolved in the
ADR with options considered and reasons — never silently in code.

---

## 15. Open decisions requiring ADRs (with proposed defaults)

| Decision | Proposed default | Status |
|---|---|---|
| Tech stack | Strongly-typed, single language across UI + server (TypeScript recommended; C#/.NET a strong alternative) | To decide |
| Repo model | Monorepo, modular monolith | Proposed here |
| Database | PostgreSQL, one DB per deployment, module-owned migrations | To decide |
| Tenancy | Decide explicitly. Default: apps are separate products; scope tenant-owned data by `organization_id` from day one to keep multi-tenancy additive | To decide |
| First app | Sales / Business Management | To decide |
| One product or two | Two apps sharing one platform, independently deployable | To decide |
