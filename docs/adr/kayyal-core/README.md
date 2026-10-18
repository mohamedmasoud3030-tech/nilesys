# Architecture Decision Records

One record per decision that is important or expensive to reverse. Every ADR has: Context · Decision ·
Alternatives rejected · Consequences · Reversibility · Security implications.

`docs/ARCHITECTURE.md` holds the stack-level ADR-01…ADR-12 (language, framework, database, ORM, hosting…).
This folder holds the **domain and safety** decisions that outlive any technology choice.

| ADR | Title | Reversibility |
|---|---|---|
| [0001](0001-authentication.md) | Hybrid authentication | Medium-high |
| [0002](0002-tenant-isolation.md) | Tenant isolation | High |
| [0003](0003-database-access-model.md) | Server-only database access | Medium |
| [0004](0004-decimal-arithmetic.md) | Decimal arithmetic | **Very low** |
| [0005](0005-transaction-atomicity.md) | Transaction atomicity | Low |
| [0006](0006-costing-model.md) | Weighted moving average costing | **Low** |
| [0007](0007-regrade-allocation.md) | Regrade allocation by relative sales value | Medium |
| [0008](0008-historical-corrections.md) | Historical corrections and the closed-day boundary | Low |
| [0009](0009-cash-reconciliation.md) | Cash reconciliation and pending cash | Medium |
| [0010](0010-pwa-offline-policy.md) | PWA and offline policy | High |
| [0011](0011-buyers-directory.md) | Two-layer buyers directory | Medium |
| [0012](0012-audit-immutability.md) | Audit and immutability | **Very low** |
