# ADR-0007 — Regrade allocation by relative sales value

**Status:** Accepted (supersedes weight allocation, rejected by the owner) · **Date:** 2026-08-20
**Sources:** PRD D21, D27, D28, D33, FR-9

## Context
Sorting is where the yard creates margin: one cheap mixed input becomes several outputs of wildly different value.
Splitting the input's cost between them is a joint-cost problem.

## Decision
Allocate the consumed cost **in proportion to the relative sales value of the outputs**, using each output's
reference sell price **snapshotted at the moment of the regrade**.

- The allocation method and every price snapshot are **stored with the entry**. A past regrade is always read from its snapshot and **never re-derived** from today's prices.
- If any output lacks a reference price, **defer the whole allocation** (all-or-nothing) and hold the consumed value as `unallocated_regrade_cost`; never allocate among the priced outputs only.
- On later resolution, split each output's share between **quantity already sold** (→ historical unattributed cost, in the current period, added to no inventory; those sales keep showing `غير محسوب`) and **quantity still in stock** (→ inventory only). Never rewrite past sales; never load their cost onto remaining stock.

## Alternatives rejected
- **Pro rata by weight** — the original design, correctly rejected: it gives a 100 kg copper output and a 900 kg iron output the same cost per kg, producing a fantasy profit on one and a guaranteed loss on the other.
- **Allocating only among priced outputs when one lacks a price** — pushes the full cost onto them and reproduces the same distortion.
- **Net realizable value with processing cost deducted** — requires processing cost, out of scope (D13).

## Consequences
Depends on reference sell prices being maintained (V16). Mitigated by showing snapshot prices and resulting cost
per kg **before** saving, and by blocking-with-a-prompt rather than guessing.

## Reversibility
**Medium.** Past allocations are frozen by design, so a future method change applies prospectively only.

## Security implications
None directly. Integrity implication: an unexplainable cost per kg is indistinguishable from a manipulated one,
which is why the snapshot exists.
