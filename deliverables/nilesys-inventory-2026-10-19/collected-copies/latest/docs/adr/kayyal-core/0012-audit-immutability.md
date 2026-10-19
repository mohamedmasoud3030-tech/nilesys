# ADR-0012 — Audit and immutability

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D15, FR-10, FR-12, Part 4 Security

## Context
The product's core promise is that the owner can trust the record. A record that can be quietly edited or deleted —
by anyone, including us — is not a record.

## Decision
- **Nothing that affects money or weight is ever hard-deleted.** The runtime database role holds **no `DELETE` grant** on ledger tables.
- Correction is by **reversal** (a new entry referencing the original) or a **documented adjustment**. The original stays visible, marked.
- The **audit log is append-only**: actor, server time, device time, action, entity, before/after values, reason, linked reversal. No update or delete path exists in the application or in the grants.
- Closed days are immutable (ADR-0008). Historical snapshots — prices, costs, allocation methods — are never re-derived.
- The audit log is owner-readable and cannot be cleared by any in-app action.

## Alternatives rejected
- **Soft-delete flags on the primary records** — invites "just filter it out" and loses the reason.
- **Audit via database triggers only** — captures rows, not intent; the reason and the actor's role matter as much as the diff.
- **External append-only log service** — extra infrastructure for a single-yard MVP; Postgres with revoked grants is sufficient and verifiable.

## Consequences
Data grows monotonically — irrelevant at this scale. Mistakes stay visible, which is the point: a visible reversal
is a feature, not clutter.

## Reversibility
**Very low.** Once a business relies on the record being immutable, weakening it is a breach of the core promise.

## Security implications
The strongest available control against internal manipulation, and the mechanism that makes operator accountability
real. Also the reason `service_role` is banned from runtime: a path that bypasses RLS also bypasses attribution.
