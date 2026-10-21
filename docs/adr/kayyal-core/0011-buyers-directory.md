# ADR-0011 — Two-layer buyers directory

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D19, D30, D31, FR-16, R16, R18

## Context
The owner needs to build a selling network. His own buyers live in his head; the buyers he does not yet know are
invisible to him. One layer cannot serve both needs: shared knowledge must be curated centrally, private knowledge
must never leave the yard.

## Decision
Two layers over the same buyer.

**A — Central directory (ours).** Factories, foundries, recyclers, wholesalers, specialist buyers. Not
tenant-scoped: readable by every authenticated yard user, writable **only** by `platform_admin`. Carries a
verification status and last-verified date, both always displayed. Administrative fields — internal source, who
entered, who verified, verification note — are stored for governance and **never returned to a yard user** (D30).

**B — Yard relationship layer (theirs).** Contact person, direct number, last contact, last quoted price, materials
actually accepted, minimum quantity, payment terms, transport, notes, favourite / unsuitable. Tenant-isolated and
invisible to every other yard.

**Hard boundaries:** no marketplace · no in-app quotes · no negotiation · no orders · no payments · no commission ·
no auto-matching · no buyer accounts or buyer-facing views · no yard-to-yard visibility.

## Alternatives rejected
- **A single private list per yard** — the original 2.1 design; leaves every owner to discover the same buyers alone.
- **A shared editable directory (wiki model)** — one careless or malicious edit degrades every yard's data.
- **A marketplace** — explicitly rejected by the owner (D2) and a fundamentally different product and liability.

## Consequences
The first cross-tenant data in the product, and an **ongoing operational commitment**: curation is a service, not a
shipped feature (R18). Rollout is staged: البحيرة → الإسكندرية → القاهرة والجيزة.

## Reversibility
**Medium.** Layer B stands alone if the central layer is ever abandoned; the split is deliberate.

## Security implications
Two distinct risks: (1) leaking a yard's private relationship data — prevented by the same RLS as the ledger;
(2) exposing administrative provenance — prevented by excluding those columns from every API response shape, tested
as a release gate. An `unverified` entity must never be rendered as confirmed (D31).
