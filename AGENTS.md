# AGENTS.md — Nile Systems (repository `Mohamed-App-Factory`)

You are an engineering agent working in this repository. This file is the
authoritative entry point for how work is performed here. It is **not** the
sole normative source: accepted Architecture Decision Records (ADRs) outrank
it for architectural decisions (see precedence below).

## What this repository is

This repository is **Nile Systems**: a live catalogue of ready-made business
systems (POS, inventory, restaurant, clinic, HR, courts, admin) with public
websites and real, resettable Arabic/English demos. It contains Nile's shared
**engines** (`engines/`), the API built on them (`apps/api`), the decisions
and evidence behind them (`docs/`), and evaluation probes (`tools/spikes/`).

- **Belongs here:** Nile engines, API, product UIs built on tested engines,
  Nile documentation and evidence.
- **Does not belong here:** other projects or products, credentials, database
  dumps, runtime state, or code copied from other repositories without a
  provenance entry in `docs/REUSE.md`.
- **Build order (binding product rule):** engines first; a product screen is
  built only after its engine exists and is tested.
- The coordinating engineering agent owns architecture coordination. Other
  agents follow `docs/STATUS.md` and must not invent architecture decisions;
  they surface them (see "Architectural truth").

## First actions (read in this order)

1. This file, completely.
2. [`docs/STATUS.md`](docs/STATUS.md): verified current state, active PRs and
   branches, the next authorised task, blockers and open findings.
3. [`docs/DECISIONS.md`](docs/DECISIONS.md), then every ADR under `docs/adr/`
   that touches your task.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): current architecture,
   decision status, and known gaps between ADRs and code.
5. The engine or contract you will touch (`engines/README.md`, the code).
6. Skills: discover them (see "Skills") and load every one whose trigger
   matches your task.

[`docs/README.md`](docs/README.md) lists every document, its canonical
location and its status.

## Instruction precedence

When sources disagree, the higher-precedence source wins.

1. **Mechanical enforcement** — CI, lint, type checking, Nx dependency
   boundaries, database constraints, RLS, tests. Never overridable by prose.
2. **Accepted ADRs** — `docs/DECISIONS.md` + `docs/adr/*`.
3. **This file** (AGENTS.md).
4. **Activated skills** — `.agents/skills/*`.
5. **Other repository documentation.**
6. **External references** — inspiration only, never normative.

### Document tiers

| Tier | Documents | Binding? |
|---|---|---|
| 1 | `AGENTS.md` | Yes: process and safety rules for every agent |
| 2 | Accepted ADRs (`docs/DECISIONS.md`, `docs/adr/*`) | Yes: architecture. Outranks tier 1 on architectural questions |
| 3 | `docs/ARCHITECTURE.md`, `engines/README.md`, `docs/REUSE.md`, code contracts | Yes, while consistent with tiers 1–2 |
| 4 | `docs/STATUS.md` (current state, roadmap, task tracker) | Yes, for what is allowed or blocked right now |
| 5 | Proposals, Proposed ADRs, reviews and evaluation reports (`docs/architecture/`, `docs/reviews/`, `tools/spikes/`) | **No.** Evidence and recommendations only |
| 6 | Archived and historical material (`docs/archive/`, `prototypes/`) | **No.** Never overrides anything above |

A Proposed ADR or proposal never authorises work by itself. Citations inside
code extracted from other repositories (for example `docs/adr/0009-…` in
`engines/transactions/src/cash.ts`) refer to the source repository, not to
this one (see `docs/REUSE.md`).

### Status labels

Use exactly these labels for decisions, findings and work items:
`ACCEPTED`, `PROPOSED`, `REJECTED`, `SUPERSEDED`, `HISTORICAL`, `UNVERIFIED`,
`OPEN`, `FIXED ON <branch/commit>`, `MERGED IN <commit>`, `BLOCKED BY <x>`.
Never write "done", "complete" or "working" without naming the commit and the
verification evidence. A passing test alone does not make a finding fixed.

Material or consequential conflicts or ambiguities between sources must be
surfaced, never silently resolved. Trivial implementation ambiguity may be
resolved locally (see "Working rules").

An explicit user request directs the work, but if it conflicts with an
accepted ADR or an architectural invariant, surface the conflict instead of
silently breaking the architecture.

## Architectural truth

- Architectural decisions live in `docs/DECISIONS.md` (index) and
  `docs/adr/*` (records). These are the source of truth for accepted
  decisions.
- An accepted ADR is immutable: never silently contradict it, and never edit
  an accepted ADR to change its meaning — including not editing it to add a
  status marker. A consequential change requires a new, superseding ADR that
  links to the one it replaces.
- Unresolved consequential choices must be surfaced for a decision — never
  silently selected.
- Apply these rules using the `decision-governance` skill.

## Skills

Skills are procedural guidance in `.agents/skills/`, authored in the open
Agent Skills format. Load a skill's full instructions when its trigger matches
your task.

- If your harness auto-discovers `SKILL.md` files, use that.
- Otherwise, read `.agents/skills/README.md` (the manifest) and load each
  matching skill.

See `.agents/skills/README.md` for the complete current skill manifest and
triggers.

## Mandatory lifecycle

understand → plan → implement → test → review → verify

| Stage | Skill | Exit |
|---|---|---|
| Understand | `decision-governance` | Relevant ADRs read; conflicts surfaced |
| Plan | `implementation-planning` | Small, reversible, testable steps |
| Implement | `test-driven-development` | Code written against a failing test |
| Test | `test-driven-development` | Fresh test evidence for the change |
| Review | `code-review` | Findings recorded and resolved |
| Verify | `verification-before-completion` | Definition-of-Done evidence produced |

## Dependency and boundary rules

ADR-0001 is authoritative for dependency and architectural boundaries. Do not
restate or strengthen those rules here; if a task touches them, read ADR-0001
directly.

- Operational pointer: these rules become mechanical enforcement when the
  scaffold exists; until then, `code-review` checks conformance.

## Working rules

- Small, reversible changes. YAGNI. Reuse before building (check existing
  modules and mature libraries first).
- Keep documentation in sync with code, in the same change.
- No completion claim without fresh, applicable verification evidence — apply
  `verification-before-completion`.
- Material or consequential conflicts or ambiguities must be surfaced with
  the conflict, the specific rule, and the options. Trivial implementation
  ambiguity may be resolved locally when the choice is reversible and does
  not affect architecture, product behavior, security, data integrity, or an
  accepted decision (examples: local variable naming, non-semantic
  formatting, ordering of equivalent internal steps). Requiring escalation:
  architecture, security/authorization, tenancy, data model, external
  contracts, irreversible migrations, accepted ADR conflicts, and
  consequential product behavior.

## Allowed and blocked work (standing gates)

These rules hold until the stated condition is verified. The live status of
each gate is in `docs/STATUS.md`.

| Work | Rule |
|---|---|
| Engine work that is not payments | **Allowed** (ADR-0010) with tests first and a reviewable PR |
| Payment engine implementation | **Blocked until PR #4 is merged**; then on a new branch from the then-current `main`, per proposal 0007. Before that: design only |
| Cashier or any product UI | **Blocked** until its engine (for the cashier: payments) is merged and tested, and the gate findings marked as UI blockers in `docs/STATUS.md` are closed |
| Accounting/ledger provider (Odoo, ERPNext, in-house) | **No adoption, integration or adapter** without an owner decision (ADR-0008 is PROPOSED). Engines never import provider code (ADR-0010) |
| Live Egyptian Tax Authority submission | **Blocked.** Requires an owner decision and a consenting taxpayer's own credentials under written agreement |
| Merging any PR, deploying, deleting branches, rewriting history | **Only with the owner's explicit authorisation** |

## Safety rules

- Never request, print, commit or store tokens, passwords, signing keys, tax
  credentials or private keys. Local throwaway test credentials stay out of
  the repository.
- Never force-push, reset shared branches, delete branches, or overwrite
  another agent's commits. Never discard evidence; archive it instead
  (`docs/archive/README.md`).
- Do not change security-sensitive settings (auth configuration, trusted
  origins, roles and grants, RLS) without a reviewed PR that states the
  change.
- Mutation testing and destructive experiments only in isolated copies or
  throwaway databases.
- Verify the remote state yourself (`git ls-remote`, the GitHub API) before
  claiming a push, PR, merge or CI result. If something is only local, say so.

## Testing, migrations and pull requests

- Commands: `npm ci`, `npm run typecheck`, `npm test`; after a schema change
  `npm run db:generate` and `npx drizzle-kit check`. Never weaken, skip or
  delete a test to get a pass.
- Migrations are generated (`drizzle-kit generate`, or `--custom` for SQL
  drizzle cannot express) and applied by the owner role. Never use
  `drizzle-kit push` as a drift gate (it reports false drift on composite
  foreign keys).
- Every new append-only table needs `REVOKE UPDATE, DELETE … FROM nile_app`
  in the same migration plus a privilege test: default privileges otherwise
  grant them. The runtime role cannot use `SELECT … FOR UPDATE/SHARE` on
  append-only tables; serialise with advisory locks or unique constraints.
- Tenant-owned tables use composite `(tenant_id, id)` foreign keys and the
  tenancy helpers. PGlite has one connection: concurrency claims need a real
  PostgreSQL test with multiple connections.
- The repository has **no CI**. A PR description must list the exact
  commands run and their results, plus base and head SHAs.
- One concern per PR. Documentation changes ship in the same PR as the code
  they describe.

## Recording decisions, discoveries and handoffs

| What | Where |
|---|---|
| A new or changed architectural decision | A new ADR in `docs/adr/` plus a row in `docs/DECISIONS.md` (accepted ADRs are superseded, never edited) |
| An option analysis or evaluation | `docs/architecture/proposals/NNNN-*.md`, labelled PROPOSED |
| A review or verification | `docs/reviews/YYYY-MM-DD-*.md` |
| Current state, next task, blockers, findings | Update `docs/STATUS.md` in the same PR. Do **not** create a new status or handoff file per agent |
| Superseded documents | `git mv` to `docs/archive/` with a status banner |

## Portable process, repository-specific policy

- General engineering technique lives in skills (portable).
- Project architecture and accepted decisions live in ADRs and this file
  (repository-specific).
- Skills teach how to apply policy; they must not duplicate it.
- Rules that can be enforced deterministically migrate to tooling/CI when the
  scaffold exists. Prose is for judgment, never for what tooling can check.
