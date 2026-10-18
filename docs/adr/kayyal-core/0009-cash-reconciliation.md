# ADR-0009 — Cash reconciliation and pending cash

**Status:** Accepted · **Date:** 2026-08-20 · **Sources:** PRD D29, D32, FR-3, FR-7, E31

## Context
When an operator sells above the recorded balance, the sale is held as `pending_stock_resolution`. But the buyer
has already paid: the money is physically in the drawer. Ignoring it until the owner posts the sale would make
every daily close show a shortage that does not exist.

## Decision
A **pending cash movement** is created immediately and linked to the pending sale.

| Counts toward | Pending cash |
|---|---|
| Revenue, profit, final party balance | **No** |
| The physical drawer's expected total | **Yes** |

The cash box shows two lines, never merged: `الرصيد المتوقع من العمليات المرحّلة` + `نقدية مستلمة من عمليات معلقة`
= `إجمالي المتوقع في الدرج`. The counted amount is compared against the **sum**.

On resolution the **same record** flips `pending → posted` atomically with the sale — an `UPDATE`, never an
`INSERT`. Voiding a pending sale that took money requires stating what happened to it: returned (the movement is
reversed, visibly) or retained (voiding is refused; post it properly).

## Alternatives rejected
- **Ignore the cash until posting** — guarantees a false shortage at every close.
- **Post the cash as normal revenue immediately** — reports a sale that has not been accepted into the ledger.
- **A separate "suspense" account** — correct in accounting terms, meaningless to a non-accountant owner.

## Consequences
`cash_movement` carries a `status`. Every cash query must be explicit about which status it includes — enforced by
the API contract and tests.

## Reversibility
**Medium.** The two-line presentation is a UI change; the data model change is small but real.

## Security implications
Closes a real fraud window: without pending cash, money received against an unposted sale is invisible to the
owner. Now it is visible from the moment it is taken, attributed to the operator who took it.
