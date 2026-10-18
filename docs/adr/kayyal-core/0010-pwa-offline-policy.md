# ADR-0010 — PWA and offline policy

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D23, FR-14, V8, S-09

## Context
An offline-first architecture is expensive: queueing, batch sync, conflict resolution, number reconciliation, and
a large testing surface. Nobody has yet measured the network inside a real Egyptian scrap yard.

## Decision
**Resilient-online, not offline-first.** In the MVP, Serwist provides:
- an installable, cached app shell that always opens;
- safe caching of static assets and reference data (materials, prices, favourites, recent parties, directory);
- local draft persistence so a dead battery loses nothing;
- resilient retry of an **interrupted save** via an IndexedDB outbox with a client-generated idempotency key.

**Explicitly not in the MVP:** a full multi-device transaction queue, an offline accounting engine, offline
reconciliation. That is S-09, unlocked by the V8 field test.

Server-assigned sequential numbers and client idempotency keys ship **now**, even though only strictly needed
later, so S-09 is an extension rather than a redesign.

## Alternatives rejected
- **Full offline-first now** — expensive, unvalidated, and delays the parts that certainly matter.
- **No offline handling at all** — a dropped connection mid-save would lose a real transaction; unacceptable.
- **A local-first sync engine (ElectricSQL, PowerSync, RxDB)** — powerful, but pushes financial logic toward the client, contradicting ADR-0003.

## Consequences
If the pilot yard genuinely has no signal for long stretches, the MVP will frustrate there until S-09. This
trade-off is stated in the PRD and accepted.

## Reversibility
**High** — purely additive.

## Security implications
Local drafts and the outbox may contain business data on a shared device. They must hold no cost, profit or cash
totals for an operator, must be cleared on logout, and must never contain a PIN or session token.
