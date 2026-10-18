# ADR-0006 — Weighted moving average costing

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D12, F6, FR-8, V5

## Context
The owner's central question is "did I profit?". Scrap is fungible, bought in mixed lots from informal suppliers
with no lot identity. Any costing method that requires tracking which kilo came from which purchase is fiction here.

## Decision
**Perpetual weighted moving average per material**, recomputed on every posted inbound movement. Each sale line
stores a **cost snapshot** taken at posting time, so the profit of a past sale never changes.

Presented to the owner as **approximate** (`تقريبي`), with the arithmetic visible in one tap.

## Alternatives rejected
- **FIFO / LIFO** — require lot tracking the yard cannot and will not maintain.
- **Standard cost** — needs a costing discipline that does not exist.
- **"Sale price − last purchase price"** — simpler and the owner may find it more intuitive; kept as the documented fallback if V5 fails.
- **Full absorption costing** — requires allocating labour and overhead; explicitly out of scope (D13).

## Consequences
A sudden price swing moves the average gradually rather than immediately, which can surprise. Mitigated by showing
the arithmetic. Corroborated by convergence across six independent specialist systems (F6) — a widely-used pattern,
not a formal standard, and not proof of fit in Egypt.

## Reversibility
**Low.** Historical cost snapshots would have to be recomputed, and the PRD forbids rewriting closed periods.
V5 must be tested early in the pilot.

## Security implications
None directly. Trust implications are severe: a profit figure the owner cannot explain is a figure he will stop
believing, taking the rest of the product with it.
