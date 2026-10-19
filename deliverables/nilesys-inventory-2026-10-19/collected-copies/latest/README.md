# Nile Systems (Mohamed-App-Factory)

Nile Systems is a live catalogue of ready-made business systems for Egyptian businesses: POS, inventory,
restaurant, clinic, HR, courts booking and an admin site. Each comes with a public website and a real,
resettable demo that visitors can try (Arabic and English). This repository holds Nile's shared **engines**
and the API built on them. Product screens are built only on top of engines that exist and are tested.

> **AI agents and contributors: start with [`AGENTS.md`](AGENTS.md).** The current state, open pull
> requests and the next authorised task are in [`docs/STATUS.md`](docs/STATUS.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `engines/` | Domain engines: platform (tenancy, auth, locale), transactions, booking, catalog, people. Each has its domain code plus a Drizzle schema. See [`engines/README.md`](engines/README.md) |
| `engines/db/` | Generated SQL migrations, runtime-role hardening, and the single migrate-then-connect path (`open.ts`) |
| `apps/api/` | NestJS + Fastify REST API with OpenAPI at `/api/openapi.json` |
| `docs/` | Decisions (ADRs), architecture, status, reviews and evidence. Index: [`docs/README.md`](docs/README.md) |
| `tools/spikes/` | Evaluation probes and their artifacts (non-production evidence) |
| `prototypes/nilesys/` | The first plain-Node demo, kept as a UX and behaviour reference (HISTORICAL) |
| `.agents/skills/` | Procedural skills for agents (see `AGENTS.md`) |

## Setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run typecheck
npm test              # engines, RLS invariants, end-to-end sale path (PGlite, in-process PostgreSQL)
npm run api:dev       # API on :3000 with the demo tenant (PGlite on disk under apps/api/.local)
npm run api:smoke     # against a running API: cashier login → sale → receipt
npm run db:generate   # regenerate migrations after a schema change; then `npx drizzle-kit check`
```

Production uses PostgreSQL through `DATABASE_URL` (runtime login, a member of `nile_app`) and
`MIGRATION_DATABASE_URL` (owner login). See `engines/db/open.ts`.

## Architecture in one paragraph

A TypeScript modular monolith. Business rules live in the engines, persistence goes through Drizzle to
PostgreSQL, and every tenant-owned table is protected by row-level security under a non-superuser runtime
role. Authentication and roles use Better Auth organizations, and the API is REST with OpenAPI. Accounting
and tax (ledger, Egyptian Tax Authority) are reached only through a provider-neutral port. The provider
itself (Odoo, ERPNext or built in-house) is **not chosen**. Details:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

- [`AGENTS.md`](AGENTS.md): rules for every agent; read first.
- [`docs/STATUS.md`](docs/STATUS.md): current state, active work, next task, blockers.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): current architecture and decision status.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): index of Architecture Decision Records.
- [`docs/README.md`](docs/README.md): every document, its canonical location and status.
