# ADR-0005 — Transaction atomicity

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD FR-3, FR-9, FR-10, D22, D32 · ADR-10

## Context
A single posting touches stock, weighted-average cost, cash, party balance, profit snapshots, sequential numbering
and the audit log. Any partial application corrupts the ledger permanently and invisibly.

## Decision
One `postTransaction()` service, one database transaction, in a fixed order:
1. `SET LOCAL` the authorization context.
2. Idempotency check — if this key already posted, return the existing result unchanged.
3. `SELECT … FOR UPDATE` affected `stock_balance` rows **ordered by material id** (deadlock avoidance).
4. Validate, including the non-negative stock invariant.
5. Take the next sequential number from a per-yard counter row, locked in the same transaction.
6. Write transaction, lines, stock movements, cash movements, party balance changes, audit entry.
7. Commit, or roll back entirely.

Backed by schema-level guarantees: `CHECK (quantity_kg >= 0)`, unique `(yard_id, type, number)`, unique
`(yard_id, idempotency_key)`. The `pending → posted` cash flip is an `UPDATE` inside this same transaction — never
an insert (ADR-0009).

## Alternatives rejected
- **Eventual consistency / event sourcing with async projections** — a stock balance that is briefly wrong is a wrong number shown to a man deciding a price.
- **Application-level locks** — do not survive multiple processes.
- **Optimistic concurrency with retries** — more complex than row locks at this scale.

## Consequences
All financial writes funnel through one service — deliberately a bottleneck, because it is the auditable place.

## Reversibility
**Low**, and correctly so; this is the core.

## Security implications
Prevents duplicate postings from retries (a real money bug) and makes the non-negative stock invariant structural
rather than aspirational.
