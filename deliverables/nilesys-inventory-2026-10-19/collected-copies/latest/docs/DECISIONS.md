# Decisions

This is the index of Architecture Decision Records (ADRs). Accepted ADRs are immutable:
once accepted they are superseded by newer ADRs, never edited. Proposed ADRs may be revised.
Known gaps between accepted ADRs and the code are listed in [ARCHITECTURE.md](ARCHITECTURE.md) §3.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](adr/0001-technology-stack.md) | Technology stack (TypeScript, NestJS/Fastify, Next.js, Nx/pnpm, PostgreSQL) | Accepted | 2026-09-04 |
| [0002](adr/0002-tenancy-and-deployment-topology.md) | Tenancy and deployment topology | Accepted | 2026-09-04 |
| [0003](adr/0003-milestone-1-target-and-scope.md) | Milestone 1 target application and scope | Accepted | 2026-09-04 |
| [0004](adr/0004-orm-and-database-access.md) | ORM and database access (Drizzle ORM + Drizzle Kit) | Accepted | 2026-09-04 |
| [0005](adr/0005-authentication-organization-membership-tenant-context-and-rls.md) | Authentication, organization membership, tenant context, and RLS security boundary | Accepted | 2026-09-04 |
| [0006](adr/0006-rest-and-openapi-api-contract.md) | REST and OpenAPI API contract | Accepted | 2026-09-04 |
| [0007](adr/0007-roles-and-permissions-via-better-auth-access-control.md) | Roles and permissions via Better Auth access control | Accepted | 2026-10-14 |
| [0008](adr/0008-build-vs-adopt-ledger-substrate.md) | Build vs. adopt: how the factory obtains its regulated core (ledger) | **Proposed** — awaiting Mohamed's decision | 2026-10-14 |
| [0009](adr/0009-localization-arabic-rtl-first.md) | Arabic and RTL are first-class requirements; English remains the repository language | Accepted | 2026-10-13 |
| [0010](adr/0010-engines-continue-behind-ledger-provider-port.md) | Engine development continues; accounting is reached only through a provider-neutral port | Accepted | 2026-10-14 |

## Numbering notes

- ADR-0007 existed on `main` but was missing from this index; added on 2026-10-14.
- ADR-0008 and ADR-0009 came from branch `arena/bfcb5ed1-mohamed-app-factory` (commit `e61cd06`).
  ADR-0009 was numbered ADR-0001 on that branch, which collides with this repository's ADR-0001, and its
  planned number ADR-0007 is now the roles ADR. Only its heading number changed. It was accepted on that
  branch on 2026-10-13. Provenance: [architecture/README.md](architecture/README.md).
- The branch's ADR-0001 "build vs adopt" proposal (`docs/architecture/proposals/0001-platform-strategy.md`)
  was not imported because it conflicts with accepted ADR-0001 here. ADR-0008 is the live form of that
  question.

