# ADR-0012: Nile's marketing site and system sites live in this repository; Platform (LENA) links to them

- **Status:** Accepted
- **Date:** 2026-10-19
- **Decided by:** the LENA integration agent, under the owner's delegation of technical decisions on
  2026-10-19. Resolves **D-F** (`PRODUCT_PLAN.md` §10).

## Context

D-F asked whether the Nile marketing site (MKT-*) is built in the private `platform` repository (LENA) or as
`apps/marketing` here. The private repository was read (read-only) on 2026-10-19. The findings are in
[`REUSE.md`](../REUSE.md) under "Related material outside this repository":

- `platform` contains **no Nile code**. Its public site (`artifacts/lena`) is the LENA studio showcase. It
  has its own content model (`systems.ts`: property, wellness, rental, investment, hospitality, recycling,
  materials), a Vite/pnpm stack and its own deployment.
- Its open planning PRs state the same boundary in two places. PR #96 (`EXECUTION_PLAN.md`): "Platform =
  the gallery and the customer entry; it shows the independent apps, which gradually share capabilities
  proven in Nile; no full move of Nile into Platform and no database merge". PR #95 (`AGENTS.md`):
  "Creating this guidance does not approve moving Nile into Platform or combining their runtimes".
- The MKT-* content (systems, sites, activity picker, readiness) already comes from this repository: the
  prototype (`prototypes/nilesys`) and the offerings readiness registry (`engines/catalog`).
- `AGENTS.md` says product UIs built on tested engines belong here.

## Decision

1. The Nile marketing site is built here as `apps/marketing` (Next.js, ADR-0001). The seven system sites
   (phase 4) are built here too. Both read only this repository's API and registry.
2. The LENA site in `platform` links to the Nile site as one of its products. It never imports Nile code,
   shares its database or proxies its API. Any change to `platform` is a separate task in that repository
   and needs its own approval.
3. Branding follows the accepted owner decision "LENA is the umbrella brand and Nile is integrated into it".
   The Nile site carries LENA branding. That is a design choice and does not couple the code.

## Alternatives rejected

- **Build MKT-* inside `platform`.** That would couple a private Vite/pnpm app to this repository's
  engines and API. It contradicts both open planning PRs in `platform`, and it splits Nile's product
  surface over two repositories.

## Consequences

- Positive: one repository holds Nile's engines, API and every Nile screen. The two-repo boundary that the
  owner's own plans describe is kept.
- Negative: the LENA site must keep its link and description of Nile up to date by hand.
- Reversibility: medium. Moving a finished Next.js app later is possible but costly.
