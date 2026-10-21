# ADR-0014 — "Total sales" means money collected, and a refund is its own line

| Field | Value |
| --- | --- |
| Status | **Accepted** — 2026-10-19 |
| Decided by | The owner delegated the decision (`بالمنطق اتخذ الاختيار المناسب`), the reasoning is recorded here and is open to revision by a later ADR |
| Supersedes | nothing. Resolves **D-E** in `PRODUCT_PLAN.md` §10 |
| Affects | `engines/transactions/src/reports.ts`, every report screen, every KPI the owner is shown |

## Context

`getDailyReport` returned `grossMinor` = Σ `sales_transactions.total_minor` for sales rung up in the
period. That is **billed** money: it counts a sale whether or not a pound was collected. Two things in
the product contradict it:

1. The engine already refuses to treat unresolved cash as revenue. `cash_movements.status = pending`
   sits in the drawer and never in `expectedPosted` (`cash.ts`, invariant I11 of proposal 0007). A
   report that counted billed sales would claim revenue the drawer denies, on the same screen.
2. A refund is recorded as its own `refunds` row, and until now was subtracted from a billed total —
   mixing a flow (what was collected) with a balance (what was invoiced).

The owner's own statement of the promise is: *"في آخر اليوم يعرف المالك: ما دخل، ما خرج، ما تبقّى في
الصندوق، وما رُبح فعلًا"* — what **came in**. Not what was rung up.

## Decision

**The sales total the owner reads is money collected.** Concretely, in `DailyReport`:

- `collectedMinor` — Σ `payments.amount_minor` in the period.
- `refundsMinor` — Σ `refunds.amount_minor` in the period, reported as its own line.
- `netCollectedMinor` = `collectedMinor − refundsMinor` — **this is "إجمالي المبيعات"**.
- `billedMinor` — Σ sale totals, still reported, so nothing is hidden; it is not the headline.
- `outstandingMinor` — over the sales of the period, Σ max(0, total − paid + refunded). A balance,
  measured on the sales of the period wherever the money arrived.

`grossMinor`, `grossCount` and `netMinor` stay as deprecated aliases so no existing caller silently
changes meaning. A caller that wants the old number keeps getting the old number, under a name that
says what it is.

## Rejected alternatives

- **Billed as the total (the previous behaviour).** Rejected because it makes the report contradict the
  drawer whenever money is owed, and because a refund then silently changes the meaning of the day's
  headline instead of appearing as its own line.
- **Report both numbers with no headline.** Rejected: two numbers with no authority is how a business
  ends up quoting whichever one flatters the month. One of them has to be *the* number.

## Consequences

- Every report screen must label the figure "المحصّل" (collected), not "المبيعات".
- A day with 5,000 rung up and 800 owed now reads 4,200, with 800 shown as outstanding. That is a
  truthful but smaller number than before, and it is the point.
- `resolvePendingCash` matters more, not less: pending cash is money in the box that this ADR refuses
  to call revenue until it is resolved.
- Reversing this decision later means re-teaching the owner what the number means. It is cheap in code
  and expensive in trust — which is why the reasoning is written down here rather than only in a commit.
