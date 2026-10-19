# Architecture Decision Records

> ## ⚠️ Numbering conflict with `main` — read before adding an ADR here
>
> `main` already carries **ADRs 0001–0006** (`docs/adr/` on `main`: technology stack, tenancy and
> deployment topology, Milestone 1 scope, ORM and database access, authentication/tenancy/RLS, REST and
> OpenAPI). This branch was authored in parallel and assumed an empty ADR space, so its numbering
> **collides**:
>
> | This branch | Collides with (`main`) | Action |
> | --- | --- | --- |
> | `0001-localization-arabic-rtl-first.md` | ADR-0001 technology stack | Renumber to **ADR-0007** when landing on `main` |
> | `0008-build-vs-adopt-ledger-substrate.md` (Proposed) | ADR-0002 tenancy and deployment topology | Renumber to **ADR-0008** — already numbered |
> | first application / pilot domain (pending) | ADR-0003 Milestone 1 target | Renumber to **ADR-0009** |
> | tenant isolation strategy (pending) | ADR-0004 ORM and database access | Not needed — `main`'s ADR-0002 + ADR-0005 already decide this |
>
> Accepted ADRs are immutable, so the resolution is a **renumber, never an edit**. Until the two
> document sets are reconciled, treat the filenames here as working identifiers, not final numbers.
> Surfaced per `AGENTS.md` ("material conflicts must be surfaced, never silently resolved"); details in
> [review 0001 §4](../reviews/0001-nile-engines-db-auth-review.md).

This directory holds the project's Architecture Decision Records (ADRs) — the durable record of *why*
the system is shaped the way it is.

## Why these exist

Decisions made in conversation are lost. Decisions recorded here survive, can be reviewed by a new agent
or a new colleague, and can be deliberately superseded later. If a structural choice is not written down,
it will be re-litigated — usually by an AI agent that has no way to know it was already decided.

## Numbering and status

- ADR numbers are assigned **when a decision is accepted**, in order. Numbers are never reused and never
  reordered, even if the proposals that led to them used different numbers.
- A decision found in `docs/architecture/proposals/` is **not** a decision until it appears here.
- Status values: `Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Deprecated`.

## Format (MADR, abbreviated)

```
# ADR-NNNN — Title

- Status: Accepted
- Date: YYYY-MM-DD
- Deciders: Mohamed (product owner), ChatGPT (technical strategist), Arena (implementation)
- Supersedes: —  /  Superseded by: —

## Context
What situation forced a decision. Facts, not preferences.

## Decision
The decision, in the active voice, stated so it can be checked.

## Consequences
What becomes easier. What becomes harder. What we are now committed to.

## Alternatives considered
What else was on the table, and the specific reason each was rejected.

## Review trigger
The condition under which this decision should be reopened. "Never" is an acceptable answer
if it is deliberate.
```

## Index

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-localization-arabic-rtl-first.md) | Arabic and RTL are first-class requirements, English remains the repository language | Accepted | 2026-10-13 |
| [0008](0008-build-vs-adopt-ledger-substrate.md) | Build vs. adopt: how the factory obtains its regulated core | **Proposed** — awaiting Mohamed; [all measurements complete](../architecture/proposals/0005-option-c-evidence.md) | 2026-10-14 |
| 0003 | First application and pilot domain | **Pending** — needs Mohamed's input (proposal 0003 §5) | — |
| 0004 | Tenant isolation strategy | **Pending** — build tenant-aware by default in the meantime | — |

Decisions still open, with their blocking state, are tracked in
[proposal 0001 §13](../architecture/proposals/0001-platform-strategy.md).
