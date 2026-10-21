# ADR-0002 — Tenant isolation

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D3, Part 4 Security, DoD #2

## Context
The MVP serves one yard, but the PRD requires that multi-yard later is not a rewrite, and that isolation survives
an application bug. A leaked ledger is an existential failure for a product whose entire value is trust.

## Decision
Defence in depth, four layers:
1. `yard_id NOT NULL` (indexed) on every tenant-scoped table.
2. **RLS enabled and `FORCE`d** on every tenant table, policies keyed on `current_setting('app.current_yard_id')`.
3. The runtime database role is **`NOSUPERUSER`, `NOBYPASSRLS`, and not the table owner**, with least-privilege grants and **no `DELETE`** on ledger tables.
4. Context is set per transaction with `SET LOCAL`, derived from the session — never from client input.

The central buyers directory is deliberately **outside** tenant scope (see ADR-0011).

## Alternatives rejected
- **Schema-per-tenant** — operationally heavy, painful migrations, no benefit at one tenant.
- **Database-per-tenant** — cost and operational load out of proportion.
- **Application-level filtering only** — one forgotten `WHERE` clause leaks a ledger.

## Consequences
Every query runs inside a transaction with context set. Connection pooling must use `SET LOCAL`, never `SET`.
Background jobs must establish context explicitly or operate on non-tenant tables only.

## Reversibility
**High.** Adding tenants is data, not structure.

## Security implications
This is the primary control against cross-tenant disclosure. Three release-blocking tests enforce it:
(A) deliberately removing `WHERE yard_id` reveals nothing · (B) a forged `yard_id` from the client changes nothing ·
(C) an operator calling an endpoint directly still cannot read cost, profit, cash or other days.
