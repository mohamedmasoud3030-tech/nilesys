# ADR-0002: Tenancy and deployment topology

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decided by:** Mohamed (product owner), with ChatGPT (strategist) and Arena (implementation)

## Context

Multiple vertical applications (Sales, Property & Rental, and future ones)
share one platform and set of reusable modules. Deployment topology (how apps
are deployed) and tenancy (how customers are isolated inside an app) are
separate concerns and must not be conflated.

## Decision

### Deployment topology

Each vertical application is an **independently deployable application**
composed from the shared monorepo/platform/modules (e.g. `apps/sales`,
`apps/property-rental`).

### Tenancy

Each application is **multi-tenant from day one**:

- A **customer organization is a tenant**.
- **Tenant ownership/scope is explicit** in all tenant-owned data.
- **Tenant isolation is enforced**, not merely documented.
- **Authentication and authorization establish the active tenant context
  before** any tenant-owned resource is accessed.
- Database queries, unique constraints, indexes, tests, and audit records
  **account for tenant scope** where applicable.
- **Cross-tenant access fails by default.**

### Milestone 1 operational simplicity

For Milestone 1, a **shared PostgreSQL database with enforced tenant-scoped
data** is sufficient. Do **not** introduce database-per-tenant infrastructure,
Kubernetes, or distributed services merely because the logical data model is
multi-tenant.

## Consequences

- Tenant-owned tables carry an organization/tenant scope column.
- Unique constraints become composite (`tenant_id` + natural key), preventing
  cross-tenant collisions.
- The test suite includes explicit cross-tenant isolation checks.
- Audit records carry tenant context.
- This avoids an expensive tenancy retrofit later, at the cost of slightly more
  verbose queries and constraints from day one.

## Related

- ADR-0001 (technology stack)
- ADR-0003 (Milestone 1 target and scope)
