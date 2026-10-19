# ADR-0007: Roles and permissions via Better Auth access control

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decided by:** Arena (implementation), under the product owner's standing
  delegation of technical decisions (2026-10-13)
- **Amends:** ADR-0005 §3 / Consequences ("organization roles out of M1 scope")

## Context

ADR-0005 kept organization roles and any custom RBAC out of Milestone 1.
Nile's core promise, however, is one-click demo accounts **per role** in every
system (cashier vs. branch manager, reception vs. doctor, …) with visibly
different permissions. The first operational path (POS sale) already needs
"cashier may sell, storekeeper may not".

## Decision

1. Use **Better Auth's Organization access control** (`createAccessControl`,
   `ac.newRole`) — not a custom RBAC system. Statements and roles are declared
   in `engines/platform/src/auth/permissions.ts` and passed to the
   organization plugin.
2. A user's role lives in `member.role` (per tenant). Multiple roles are
   comma-separated (Better Auth convention); access = union.
3. Authorization is evaluated **server-side** on every request
   (`can(role, { resource: [action] })`) after the tenant is resolved from
   server state (ADR-0005 §4). Unknown roles grant nothing (fail closed).
4. The permission list returned by `/api/v1/me` is for display only and is
   never trusted on input.
5. RLS remains the tenant boundary; roles only restrict actions **inside** a
   tenant. A permission bug can never expose another tenant's data.

## Consequences

- One declaration serves the API guard, the demo accounts, and (later) the UI
  (hiding buttons a role cannot use).
- Adding a vertical = adding statements/roles in one file + tests in
  `engines/platform/test/permissions.test.ts`.
- Dynamic (DB-stored) roles remain off until a customer needs them.
