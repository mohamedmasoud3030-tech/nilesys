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
| [0011](adr/0011-repository-tooling-npm.md) | Repository tooling stays on npm; Nx + pnpm not adopted now (supersedes ADR-0001's workspace bullet only) | Accepted | 2026-10-19 |
| [0012](adr/0012-nile-sites-live-in-nilesys.md) | Nile's marketing site and system sites live in this repository; Platform (LENA) links to them | **Superseded by 0013** | 2026-10-19 |
| [0013](adr/0013-marketing-site-in-lena-platform.md) | The Nile marketing site is part of the LENA Digital site in `platform` (owner decision; system sites still open) | Accepted | 2026-10-19 |
| [0014](adr/0014-collected-is-the-sales-total.md) | "Total sales" means money collected, not money rung up; a refund is its own line (resolves D-E) | Accepted | 2026-10-19 |

## Numbering notes

- `adr/kayyal-core/0001…0012` are **reference copies of another product's decisions** (Kayyal, repository
  `bug-free-garbanzo`). They are not this repository's ADRs and do not use its number space. See
  [adr/kayyal-core/README.md](adr/kayyal-core/README.md).

- ADR-0007 existed on `main` but was missing from this index; added on 2026-10-14.
- ADR-0008 and ADR-0009 came from branch `arena/bfcb5ed1-mohamed-app-factory` (commit `e61cd06`).
  ADR-0009 was numbered ADR-0001 on that branch, which collides with this repository's ADR-0001, and its
  planned number ADR-0007 is now the roles ADR. Only its heading number changed. It was accepted on that
  branch on 2026-10-13. Provenance: [architecture/README.md](architecture/README.md).
- The branch's ADR-0001 "build vs adopt" proposal (`docs/architecture/proposals/0001-platform-strategy.md`)
  was not imported because it conflicts with accepted ADR-0001 here. ADR-0008 is the live form of that
  question.

