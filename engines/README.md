# Nile Engines

Domain cores for the Nile demo platform. The domain files (`engines/*/src/*.ts`)
are pure TypeScript with no DB, HTTP or UI. Persistence lives next to them in
`engines/*/src/db/` and `engines/db/` (Drizzle + PostgreSQL RLS, ADR-0004/0005),
and the HTTP API in `apps/api` (NestJS/Fastify REST + OpenAPI, ADR-0001/0006).
Current implementation status and gaps: [`docs/STATUS.md`](../docs/STATUS.md).

**Rule: no product screen is built before its engine exists and is tested.**

| Engine | What it owns | Main sources |
|---|---|---|
| `platform/` | Tenant context (fail-closed, ADR-0002/0005), command idempotency, visitor branding, Arabic/date/phone locale utils | Terranex, starting, ADR-0005 |
| `transactions/` | Exact money (integer minor units = canonical storage; Decimal = in-domain arithmetic, bridged in `money-bridge.ts`), invoice lines, weighted-average costing, cash drawer/shifts, regrade allocation | bug-free-garbanzo (kayyal), Terranex |
| `booking/` | Resources, availability slots, domain-level overlap check (**not yet enforced by the database**: no `EXCLUDE` constraint, gate finding G-10), booking lifecycle state machine, booking codes, day grouping (Africa/Cairo) | larabeauty-, starting |
| `catalog/` | Items/variants/stock states, discounts, installment calculators, storefront validation, lead pipeline (all sites → one admin inbox) | starting, Nile benchmark |
| `people/` | Attendance/lateness/overtime, leave balances, loan schedules, payslips | larabeauty- |

## Persistence, auth & the first operational path (implemented on `main`)

- `engines/*/src/db/schema.ts` — module-owned Drizzle schemas (ADR-0004);
  tenant tables use `tenancy.ts` helpers (tenant FK, fail-closed policy,
  composite-FK key). `engines/db/schema.ts` aggregates them.
- `engines/db/migrations/` — **generated** by `npm run db:generate`
  (`0000_nile_engines.sql`) + custom `0001_security_hardening.sql`
  (runtime role `nile_app`, grants, FORCE RLS).
- `engines/db/open.ts` — the one migrate-then-connect path (PostgreSQL or
  PGlite); refuses to start if the runtime role can bypass RLS.
- `engines/platform/src/auth/` — Better Auth (ADR-0005) + Organization
  plugin, roles/permissions (ADR-0007), server-side request context.
- `engines/platform/src/db/with-tenant.ts` — the only tenant-scoped SQL path.
- Services: `transactions/src/sale-service.ts` (record/read sale),
  `catalog/src/catalog-service.ts` (list/create catalog).
- `apps/api` — NestJS + Fastify REST API, OpenAPI at `/api/openapi.json`.

Review that preceded this work: `docs/reviews/2026-10-14-engines-db-auth-review.md`.

Run from repo root:

```bash
npm install
npm run typecheck
npm test            # engines + RLS invariants + end-to-end sale path
npm run api:dev     # API on :3000 with demo tenant (PGlite on disk)
npm run api:smoke   # live: cashier login → sale → receipt
```

Extraction provenance for every file: [`docs/REUSE.md`](../docs/REUSE.md).

**Citations inside extracted files** (for example `docs/adr/0009-cash-reconciliation.md`,
`docs/FINANCIAL_RULES.md`, `ADR-0008`, decision IDs such as `D32`, golden IDs such as `G-10`) refer to the
**source repository** named in each file's provenance header, **not** to this repository's ADRs, documents
or findings. This repository's decisions are only those in [`docs/DECISIONS.md`](../docs/DECISIONS.md).
