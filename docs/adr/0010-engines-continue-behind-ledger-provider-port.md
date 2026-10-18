# ADR-0010: Engine development continues; accounting is reached only through a provider-neutral port

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decided by:** Mohamed (product owner) approved decision D1 of
  [proposal 0006](../architecture/proposals/0006-ledger-decision-memo.md) on 2026-10-14. The boundary rules
  below are recorded by the coordinating engineering agent under the owner's standing delegation of
  technical decisions.
- **Resolves:** the conflict between ADR-0008's "no application code until this decision is reviewed"
  (ADR-0008 §1, §7, §10 C2) and the engines-first direction merged in PRs #1–#3.
- **Does not decide:** which accounting/ledger provider Nile uses. ADR-0008 remains **Proposed**.

## Context

ADR-0008 (Proposed) asks whether Nile builds or adopts its regulated core: the double-entry ledger,
Egyptian tax and ETA e-invoicing/e-receipts. Odoo has partial evidence and ERPNext none (see
`docs/architecture/README.md`). Meanwhile Nile's engines (tenancy, auth, catalog, sales, booking, people)
are implemented and tested on `main`. Halting them until a provider is chosen would stall everything
that does not depend on the provider.

## Decision

1. **Engine development continues** while the ledger-provider decision is open (D1).
2. **Nile engines own and persist the operational records** they produce: sales, payments and tenders,
   refunds, cash-drawer movements, stock movements, bookings. These are committed in Nile's database under
   its tenant isolation (ADR-0002, ADR-0005) and append-only rules.
3. **Any accounting or ledger provider is reached only through a provider-neutral port** (working name
   `LedgerProvider`). Engines, services and API code must not import provider SDKs, call provider APIs, or
   use provider-specific types, identifiers or field names. Provider references are stored as opaque
   strings.
4. **Provider failure never rolls back a committed operational record.** Posting to a provider is a
   separate, retryable step with its own status.
5. Building the port, an outbox, or any provider adapter is **not** authorised by this ADR. Each needs
   its own reviewed change when a provider decision or pilot requires it. The contract sketch in
   proposal 0006 §3.1 is non-binding.

## Consequences

- Payment, refund and cash-drawer work may proceed (subject to the gates in `AGENTS.md`) without waiting
  for ADR-0008.
- The provider decision stays reversible: adopting Odoo, ERPNext or an in-house ledger later changes an
  adapter, not the engines.
- Operational data must carry enough detail for later posting (amounts in integer minor units, currency,
  tax and item codes when ETA work starts). Those schema additions are planned when needed, not now.
- Reporting that needs statutory accounts remains blocked on ADR-0008.

## Related

- ADR-0002, ADR-0005 (tenancy and RLS), ADR-0008 (Proposed: build vs. adopt)
- [`docs/architecture/proposals/0006-ledger-decision-memo.md`](../architecture/proposals/0006-ledger-decision-memo.md)
