# ADR-0008 — Historical corrections and the closed-day boundary

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D26, FR-10, E23, E24

## Context
A purchase recorded at the wrong weight or price has already contaminated the material's average cost and possibly
the cost snapshots of every sale after it. Correcting it retroactively would change numbers the owner has already
counted, reported and acted on.

## Decision
**One hard boundary: the daily close.**

| Situation | Mechanism |
|---|---|
| Original is in an **open** day | Reverse and re-enter, then **replay** that material's postings forward in deterministic order `(business_date, created_at, id)`, recomputing the running average and each subsequent sale's cost snapshot. |
| Original is in a **closed** day | **No rewrite.** A **cost adjustment** dated today, with the difference reported as `فروق تصحيح مشتريات سابقة` in the current period. |

Replay is bounded to one material from one point forward. If it would drive the balance negative at any step, the
reversal is blocked and the cost-adjustment route is offered.

## Alternatives rejected
- **Always replay from the beginning** — silently changes signed-off history; destroys trust faster than a known error.
- **Never replay** — leaves obvious same-day typos uncorrectable, which users would route around by deleting.
- **Allow editing in place** — forbidden by D15.

## Consequences
Two mechanisms to build and explain. The app must always state in one sentence which route it is taking and why.

## Reversibility
**Low.** Once corrections have been posted under these rules, changing them creates ambiguity about what past
figures mean.

## Security implications
Strongly positive: closed periods become tamper-evident. There is no code path — for any role — that alters a
figure inside a closed day.
