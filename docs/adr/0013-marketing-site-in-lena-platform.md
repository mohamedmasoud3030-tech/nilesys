# ADR-0013: The Nile marketing site is part of the LENA Digital site in the `platform` repository

- **Status:** Accepted
- **Date:** 2026-10-19
- **Decided by:** Mohamed (product owner). On 2026-10-19 he corrected ADR-0012: «الموقع التسويقي قولنا
  هنستخدم LENA Digital مستودع platform» ("for the marketing site we said we would use LENA Digital, the
  `platform` repository"). Recorded by the LENA integration agent.
- **Supersedes:** [ADR-0012](0012-nile-sites-live-in-nilesys.md). ADR-0012 was a technical decision taken
  under delegation, and it contradicted an owner decision. D-F is a product decision, so the owner's
  answer stands.
- **Resolves:** D-F (`PRODUCT_PLAN.md` §10): option **(1)**.

## Decision

1. **Where it lives.** The Nile marketing experience (MKT-01…MKT-11) is built **inside the LENA Digital
   site** in the private `platform` repository (`artifacts/lena`). It uses that site's own stack, design and
   deployment. There is **no `apps/marketing` in this repository.** This matches the owner decisions
   "LENA is the umbrella brand and Nile is integrated into it" and "the prototype is the face". It also
   matches the earlier plan option of a `#nile-systems` section in `platform/artifacts/lena`
   (`docs/plan/001-pos-implementation-ready.md`, Phase 1).
2. **What this repository provides.** It provides data and actions over HTTP. No code is shared and no
   database is shared.
   - **Readiness and catalogue:** the honest "ready / soon" badges (MKT-11) and the system cards (MKT-03,
     MKT-04) need one source of truth. That source stays in this repository (`engines/catalog`, offerings
     readiness registry). A public, read-only endpoint is added for it. It is new work under the Phase 1
     APIs.
   - **Lead intake (MKT-09):** the LENA site's enquiry form posts to this repository's lead endpoint. The
     production origin allow-list (G-5, F0-8) must include the LENA site's origin.
   - **One-click demo (MKT-08):** the LENA site links to the demo of each ready Nile system, which is served
     by this repository's apps.
3. **What stays here.** Nile's engines, its API, and the product apps built on them (starting with the
   cashier, POS-*) stay in this repository, on npm (ADR-0011). References to `apps/marketing` in ADR-0011
   §2 now mean "the first Nile UI app" (the cashier).
4. **Not decided here: where the seven system sites live (phase 4, `PRODUCT_PLAN.md` §2.2, §8).** This
   question goes back to the owner.
5. **Boundaries.** Work in `platform` is done in that repository, on its own branch, under its own
   `AGENTS.md`, and needs the owner's approval for that repository. Its open planning PRs still apply: no
   move of Nile into Platform, no combined runtime, no database merge. Read-only access was confirmed on
   2026-10-19, and no change has been made to `platform`.

## Consequences

- Positive: one public brand surface (LENA). The marketing work reuses the existing LENA design system and
  deployment, and Nile stays a clean backend plus product apps.
- Negative: MKT-* work spans two repositories. The badges depend on a public endpoint that must be built
  and kept stable. The contract is versioned under `/api/v1`. Lighthouse and SEO (MKT-10) are measured on
  the LENA site.
- Reversibility: medium.
