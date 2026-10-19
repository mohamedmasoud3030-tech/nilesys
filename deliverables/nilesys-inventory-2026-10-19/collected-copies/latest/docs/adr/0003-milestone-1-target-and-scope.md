# ADR-0003: Milestone 1 target application and scope

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decided by:** Mohamed (product owner), with ChatGPT (strategist) and Arena (implementation)

## Context

The first implementation milestone must prove the factory architecture
(platform + reusable modules + vertical app) through one thin vertical slice.
Two candidate verticals exist: Sales / Business Management and Property &
Rental Management.

## Decision

Milestone 1 targets the **Sales / Business Management** application.

The goal is **not** to build a complete Sales product. The goal is to prove
the factory architecture end-to-end through a thin vertical slice ("walking
skeleton").

### Milestone 1 scope (constrained)

- Authentication
- Tenant scope
- Customer creation and viewing
- Audit logging
- Database migrations
- Design-system UI
- Automated tests
- CI
- Module-boundary enforcement

### Non-goals

- Do not pre-build unrelated platform capabilities.
- Do not generalize for Property/Rental prematurely.

## Consequences

- Defines the build order: platform core (auth, tenancy, audit, UI kit) →
  parties/customers → the Sales walking skeleton.
- Exercises every seam of the factory (layout, module system, database,
  migrations, auth, tenancy, audit, UI kit, testing, CI, boundaries) before any
  accounting, payments, or reporting is attempted.

## Related

- ADR-0001 (technology stack)
- ADR-0002 (tenancy and deployment topology)
