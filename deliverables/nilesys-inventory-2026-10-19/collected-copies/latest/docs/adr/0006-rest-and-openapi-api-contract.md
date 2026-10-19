# ADR-0006: REST and OpenAPI API contract

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decided by:** Mohamed (product owner), with ChatGPT (strategist) and Arena (implementation)
- **Supersedes:** n/a

## Context

ADR-0001 makes the web application (Next.js) and the backend (NestJS + Fastify)
independently deployable applications composed from the shared monorepo. The
API contract between them is a long-lived boundary and must be decided before
the first vertical slice. Milestone 1 (ADR-0003) is small and CRUD-oriented.

## Decision

Adopt **REST** as the external frontend/backend API style, with **OpenAPI** as
the machine-readable HTTP contract:

- **REST** is the API style.
- **OpenAPI** is the machine-readable contract.
- **`@nestjs/swagger`** is the implementation mechanism (code-first decorators
  producing the OpenAPI document).
- The frontend and backend remain **independently deployable**.
- **Generated TypeScript clients** are permitted but are an **implementation
  decision**, not an architectural requirement.
- DTO libraries and client generators are **not** specified at this level.

## Alternatives considered

- **tRPC** — rejected for M1: introduces tighter runtime/type coupling across
  the two independently deployable applications without a demonstrated
  requirement.
- **GraphQL** — rejected for M1: adds a query language and resolver
  infrastructure for a CRUD-oriented slice; premature per ADR-0001.

## Consequences

- The OpenAPI document is the single machine-readable contract between the
  Next.js app and the NestJS API.
- The contract is inspectable and testable independently of either app.
- Reversible and standard; no additional runtime infrastructure is introduced.

## Related

- ADR-0001 (technology stack)
- ADR-0003 (Milestone 1 target and scope)
