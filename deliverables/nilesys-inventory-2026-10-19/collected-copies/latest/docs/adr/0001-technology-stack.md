# ADR-0001: Technology stack

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decided by:** Mohamed (product owner), with ChatGPT (strategist) and Arena (implementation)

## Context

The App Factory is a greenfield platform for building reusable business
applications (Sales / Business Management, Property & Rental Management, and
future verticals). The stack must be:

- strong enough for accounting, invoicing, and permission-heavy business logic;
- enforceable so AI coding agents cannot silently violate module boundaries;
- low-operational-overhead (no microservices, no distributed infrastructure);
- productive for a small team (non-technical owner + two AI roles).

Alternatives considered: **C#/.NET** and **Python/Django**.

## Decision

Adopt a **TypeScript-first modular monolith**:

- **Backend/application layer:** Node.js + **NestJS**, using the **Fastify**
  adapter. Express is used only if a concrete compatibility reason requires it.
- **Web application:** React + **Next.js**.
- **Monorepo/workspace:** **Nx + pnpm**, specifically for machine-enforced
  project/module dependency boundaries, deterministic commands, and an
  AI-agent-friendly project graph.
- **Database:** **PostgreSQL**.
- **TypeScript runs in strict mode.**

### Architectural constraints (binding)

1. This is a **modular monolith**, not microservices.
2. Business/domain logic belongs in **backend modules**, not in Next.js pages
   or server actions.
3. **apps** may depend on **modules**; **modules** may depend on
   **platform/shared** infrastructure; reverse dependencies are **forbidden**.
4. Boundaries are **enforced in CI**, not merely documented.
5. Prefer **explicit public module APIs/contracts** over direct cross-module
   imports into internals.
6. **Do not** introduce distributed infrastructure, message brokers, or
   premature generic abstractions in Milestone 1.

### References

Treat the following as references to learn from, not codebases to copy blindly:
NestJS, Next.js, Nx, Fastify, and mature TypeScript architecture references
such as `Sairyss/domain-driven-hexagon`.

## Alternatives considered

- **C#/.NET** — excellent modular-monolith support (EF Core, NetArchTest),
  strong typing, stable business libraries. Rejected for now: heavier for a
  small team, and a second language would fragment UI/server reuse.
- **Python/Django** — fastest iteration and best admin. Rejected: weaker type
  safety and weaker machine-enforced module boundaries, which are priorities
  for an AI-executed codebase.

## Consequences

- **Positive:** one language across UI and server maximizes design-system and
  type reuse; strict typing catches agent errors at compile time; Nx enforces
  the dependency graph; Fastify gives strong performance and ecosystem.
- **Negative/trade-off:** the JS/TS ecosystem moves fast, so dependency and
  versioning discipline is required from day one.

## Non-goals

- No microservices, message brokers, or distributed tracing in Milestone 1.
- No multi-language codebase.
- No premature generic abstractions or "framework building" for its own sake.

## Deferred (surface as separate ADRs, do not silently choose)

- ORM / database-access layer
- Authentication implementation
- Test runner and testing strategy
- API contract approach
- Deployment platform
