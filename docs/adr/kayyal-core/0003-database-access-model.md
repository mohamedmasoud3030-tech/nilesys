# ADR-0003 — Server-only database access

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD Part 4 Security, FR-2, FR-3, D32 · ADR-04

## Context
Supabase's headline pattern is the browser querying Postgres directly through PostgREST with RLS as the guard.
Every financial write in this product is a multi-table posting whose arithmetic must not be computable or
assertable by the client.

## Decision
**The browser never talks to the database.** All access goes through the Next.js server using Drizzle over a direct
Postgres connection. The Supabase Data API is **not** a parallel path to financial tables: unnecessary grants are
revoked, application tables live in a non-exposed schema, and `service_role` is **forbidden in normal runtime**.
Administrative operations are separated from yard runtime explicitly.

## Alternatives rejected
- **PostgREST from the client** — would require trusting client-computed totals or duplicating all arithmetic in SQL policies.
- **GraphQL gateway** — machinery without a second consumer.
- **Stored procedures for everything** — testability and reviewability suffer; the domain logic belongs in typed, unit-tested code.

## Consequences
Slightly more code than "just call the database from the client", and the server is on the critical path for every
write. In exchange, authorization and arithmetic are provable in one place.

## Reversibility
**Medium.** The domain layer is framework-free; the transport could change.

## Security implications
Removes an entire class of attack: a client cannot craft a write that bypasses validation, invent a total, or reach
a table the UI does not use. Combined with ADR-0002, there is no un-audited route to financial data.
