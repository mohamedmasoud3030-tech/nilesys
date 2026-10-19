# ADR-0004 — Decimal arithmetic

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD §9.2 · ADR-06 · FINANCIAL_RULES.md

## Context
Binary floating point cannot represent 0.1 exactly. In a system whose only purpose is to tell an owner whether he
profited, a silently wrong number is worse than a crash: it is believed.

## Decision
- **Postgres `numeric`** for every money, weight, price, cost and percentage column (precisions in DATABASE_CONTRACT.md).
- **`decimal.js`** for all arithmetic in TypeScript.
- Values cross every boundary — DB, API, JSON — as **strings**, never as JavaScript `number`.
- **Branded types** (`Kg`, `Ton`, `EGP`, `EGPPerKg`) so a per-ton price cannot be used as a per-kg price.
- **Banned:** `parseFloat`, `Number()`, `+ - * /` on money or weight values. Enforced by an automated lint guard **and** tests.
- Rounding is explicit and centralized: **round per line to 2 dp, then sum** — never sum then round.

## Alternatives rejected
- **Integer minor units (piastres)** — workable for money, but weights need 2 dp and average cost 6 dp; mixed scales invite the very bugs we are avoiding.
- **`number` with careful rounding** — "careful" is not a control.
- **`Decimal` from Prisma** — ties the decision to an ORM (see ADR-04).

## Consequences
Slightly more verbose code. Every developer and agent must respect the string boundary. This is why it is a
release-gated automated guard, not a convention.

## Reversibility
**Very low.** Changing later means a data migration and re-verification of every historical figure. This is the
single most expensive decision in the system to get wrong.

## Security implications
Indirect but real: rounding drift is a classic vector for undetected value leakage, and an owner who catches the
system being wrong once will stop trusting all of it.
