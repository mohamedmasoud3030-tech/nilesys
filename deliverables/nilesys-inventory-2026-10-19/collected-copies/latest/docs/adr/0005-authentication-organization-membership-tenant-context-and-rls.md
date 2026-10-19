# ADR-0005: Authentication, organization membership, tenant context, and RLS security boundary

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decided by:** Mohamed (product owner), with ChatGPT (strategist) and Arena (implementation)
- **Supersedes:** n/a

## Context

Milestone 1 (ADR-0003) requires authentication and tenant scope for the Sales
walking skeleton. ADR-0001 fixes the stack (NestJS + Fastify backend,
TypeScript strict, no premature abstractions). ADR-0002 makes every app
multi-tenant from day one and requires authentication to establish the active
tenant context before any tenant-owned resource is accessed, with cross-tenant
access failing by default. ADR-0004 fixes Drizzle + PostgreSQL RLS as the
database-level fail-closed enforcement, with committed generated migrations and
no raw-SQL tenant-escape hatch.

A throwaway compatibility spike (2026-09-04, outside this repository) proved
Better Auth 1.7.2 mounts under NestJS 12 + Fastify 5 with cookie/session
round-trip intact (see section 8).

## Decision

### 1. Authentication library

Adopt **Better Auth** (MIT, self-hosted, TypeScript-native) with
`@better-auth/drizzle-adapter` (PostgreSQL `"pg"` provider) and **cookie-based,
database-backed sessions**, hosted in the `platform/auth` backend module.

Password hashing, session storage, and credential handling are **delegated to
Better Auth** — not hand-rolled. Sessions are DB-backed (revocable server-side).

### 2. Tenant / membership model

Use Better Auth's **Organization plugin** as the tenant/membership model:

- Better Auth **organization** = application **tenant** (customer organization).
- Better Auth **member** = an authenticated user's **membership in a tenant**.
- Session **`activeOrganizationId`** = the authenticated **active-tenant
  selection**.
- PostgreSQL **`app.tenant_id`** = the **server-validated active organization
  ID** used for RLS.

The data model **supports a user belonging to multiple organizations**
(Better Auth provides this membership model natively).

### 3. Milestone 1 product scope (non-goals)

Structural multi-organization membership does **not** expand Milestone 1
product scope. The following remain out of scope for M1:

- organization switcher UI (unless the walking slice itself requires it);
- invitations UI;
- teams;
- a custom RBAC system;
- organization administration surface beyond what is strictly necessary;
- the seeded/bootstrap M1 user may belong to **a single organization** in test
  data.

### 4. Active-tenant derivation (security invariant)

The active tenant used for RLS is derived from **authenticated server-side
state** (session → membership → `activeOrganizationId`), **never from an
arbitrary client-supplied tenant ID**. Any client-provided tenant hint is only
honored after validation against server-side membership.

### 5. Tenant-context establishment

Each tenant-scoped request opens a transaction whose **first statement** is:

```sql
SELECT set_config('app.tenant_id', $organizationId, true)
```

The third argument `true` makes the value **transaction-local** (reverts on
commit/rollback), so pooled connections cannot leak tenant context between
transactions. A single `withTenant(tenantId, fn)` helper is the **only**
tenant-scoped SQL path, so raw SQL cannot bypass scoping (ADR-0004).

### 6. RLS policies (fail-closed)

Tenant-owned tables enable RLS with:

```sql
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

`NULLIF(..., '')` with missing-ok (`true`) makes the policy **fail closed**:
unset context ⇒ `NULL` ⇒ no rows match ⇒ deny.

### 7. Database roles (hardening)

Two distinct PostgreSQL roles:

- **Runtime application role** — used by the running application. It is **not a
  superuser**, does **not** have `BYPASSRLS`, and is **not the owner** of
  tenant-owned tables.
- **Migration / owner role** — owns the schema and applies migrations.

`FORCE ROW LEVEL SECURITY` on tenant-owned tables is **evaluated as defense in
depth**, not relied upon as a substitute for runtime-role separation.

**RLS integration tests must execute application queries using the runtime
application role**, not the migration/table-owner role; otherwise the tests
give a false picture of production isolation.

### 8. NestJS / Fastify integration (compatibility proven)

Mount Better Auth's **official core handler** (`auth.handler`, a web
`Request → Response` handler) directly under NestJS + Fastify. The community
wrapper `@thallesp/nestjs-better-auth` is **not an architectural dependency**.

Spike evidence (2026-09-04): better-auth 1.7.2, `@better-auth/drizzle-adapter`
1.7.2, `@nestjs/*` 12.0.1, fastify 5.12.3, typescript 5.9.2 — sign-up returned
200 with `Set-Cookie: better-auth.session_token` (HttpOnly, SameSite=Lax), and
`get-session` resolved the session from that cookie.

Implementation note (from the spike): Fastify eagerly consumes the request body
stream, so the integration converts Fastify's parsed request into a web
`Request` and calls `auth.handler`; passing `req.raw` to `toNodeHandler` alone
would read an empty body under Fastify.

### 9. Fail-closed invariants (must be tested)

1. No tenant context → no tenant rows (deny).
2. Tenant A cannot read tenant B rows.
3. Tenant A cannot insert/update rows as tenant B.
4. Tenant context is transaction-local.
5. Pooled connections cannot retain tenant context between transactions.

## Alternatives considered

- **Hand-rolled auth** (Argon2id + session table + cookie) — rejected: recreates
  hashing, session storage, CSRF, rotation, revocation.
- **Lucia** — rejected: deprecated/archived by its author.
- **Auth.js / NextAuth** — rejected: coupled to the Next.js runtime; conflicts
  with backend-hosted auth (ADR-0001).
- **Passport.js** — viable NestJS-native fallback, but requires assembling
  session storage and hashing ourselves.
- **SaaS auth (Clerk/Auth0/Supabase)** — rejected for the platform layer:
  external dependency, per-user cost, not Postgres/Drizzle-first; revisit as a
  future *integration*.
- **Single-tenant-per-user custom membership** — rejected in favor of the
  mature Better Auth Organization plugin.

## Consequences

- Better Auth core + organization schemas (`user`, `session`, `account`,
  `verification`, `organization`, `member`, `invitation`, `team`) become
  Drizzle schema owned by `platform/auth`, with committed generated migrations
  (consistent with ADR-0004).
- Organization roles (owner/admin/member) exist in the plugin but are **out of
  M1 scope**.
- Runtime-role separation must be in place before RLS tests are meaningful.
- M1 serves the frontend through the API (same-origin cookies); `trustedOrigins`
  is configured for the independently-deployable case.

## Related

- ADR-0001 (technology stack)
- ADR-0002 (tenancy and deployment topology)
- ADR-0003 (Milestone 1 target and scope)
- ADR-0004 (ORM and database access)
