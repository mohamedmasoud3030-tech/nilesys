# Phase 0 — execution board

| Field | Value |
| --- | --- |
| Status | **PROPOSED instrument** (tier 5). It authorises nothing on its own |
| Date | 2026-10-19 |
| Base | `docs/unified-plan-2026-10-19` `364b51f` (unmerged) |
| What it is | A working board for **Phase 0 only**. It says, task by task, who does what, in which order, and **what evidence closes it** |
| What it is not | A second product plan. `PRODUCT_PLAN.md` §4 defines *what* Phase 0 contains and *why*. This file only makes it executable |
| Live state | [`STATUS.md`](../STATUS.md) §5 remains the only authority on what is allowed right now |

> **Reading order for an agent:** `AGENTS.md` → `STATUS.md` → `PRODUCT_PLAN.md` → this file.
> A task on this board that `STATUS.md` §5 marks BLOCKED is BLOCKED, whatever this file says.

---

## 1. Why Phase 0 is the whole problem

Phase 1 needs eleven marketing features, thirteen cashier features and a UI. Every one of them is
**downstream of seven Phase-0 items**, and six of those seven are blocked on a decision only the owner
can make. The engine work is not the bottleneck:

| Bottleneck | Blocks |
| --- | --- |
| **Six owner decisions** (D-A…D-E, D5) | the payment model, the report, shift close, and where anything runs |
| **No CI** | every future PR is "trust me" |
| **The integration branch is not merged** | no UI can be built on an unmerged base |
| **Two security gates open** (G-5, G-7a) | public exposure |

So Phase 0 is deliberately small: **unblock, certify, merge.** Nothing else.

---

## 2. The board

Columns: **ID** (from `PRODUCT_PLAN.md` §4) · **Owner** = who must act · **Ready now?** · **Closes when**.

| ID | Task | Owner | Ready now? | Evidence that closes it |
| --- | --- | --- | --- | --- |
| **F0-1** | Answer D-A…D-D (D-E is decided: [ADR-0014](../adr/0014-collected-is-the-sales-total.md)) | Owner | ✅ **the only blocker on the critical path** | Each answer written into `STATUS.md` §3 with a date. One line each is enough |
| **F0-2** | Implement the answers (method list, permissions) | Agent | ⛔ blocked by F0-1; **D-E done** and migration `0005` done | One small PR per decision, each with a test that was red before it |
| **F0-3** | CI workflow | Agent prepares, **Owner approves the push** | ✅ **ready** — the reviewed draft is `deliverables/ci/nilesys-ci.yml` on `rescue/2026-10-19-workspace-archive` | A green run on GitHub Actions, and its URL |
| **F0-4** | Merge the integration branch | Agent opens the PR, **Owner merges** | ⛔ after F0-2 and F0-3 | PR description carries commit SHAs + the commands and their output |
| **F0-5** | N-1: pool `error` listener | Agent | ✅ **DONE** on `feat/plt-0005-payment-db-constraints` | Still owed: the live kill-a-backend test on a real server (`attachPoolErrorHandler` has 4 wiring tests) |
| **F0-6** | G-7a: closed-world role allow-list | Owner approves the design, agent builds | ⛔ waiting on approval | The 18-vector escalation matrix, all rejected, on PG 17 |
| **F0-7** | D5 hosting → then staging | Owner decides, agent builds | ⛔ waiting on a disposable Supabase project | `/api/health` returns 200 on staging with production roles |
| **F0-8** | G-5: deployment settings (origins, fixed secret, secure cookies, rate limit) | Agent | ✅ ready, but pointless before F0-7 | Tests proving the rejection happens in production mode |
| **F0-9** | Refresh the offerings registry — it still claimed payments live on an unmerged branch | Agent | ✅ **DONE** | `offerings.test.ts` 17/17; the POS entry now lists nine engine files |
| **F0-10** | Repository tooling | — | ✅ **done 2026-10-19** — npm, [ADR-0011](../adr/0011-repository-tooling-npm.md) | — |

### 2.1 Suggested run order

```
F0-1 (owner, can start today, unblocks everything money-related)
  └─ F0-2 ─┐
F0-3 ──────┴─ F0-4 ─ F0-9 … then Phase 1 APIs
F0-5 (independent, small, do anytime)
F0-8 after F0-7
F0-6 after the owner reads the redesign (does not block Phase 1 authoring, does block anything public)
```

**Cheapest first win:** F0-3 and F0-5 together are one day of agent work and turn "we think it passes"
into "it passes on every push, and here is the run".

---

## 3. Definition of done for Phase 0

Phase 0 is finished when **all** of these are true, in this order:

1. `STATUS.md` §3 lists a dated answer for D-A, D-B, D-C, D-D, D-E and D5.
2. `integration/nile-2026-10-18` is in `main`.
3. GitHub Actions runs on `main` and is green: typecheck, tests on PostgreSQL 17 with **zero skips**,
   API smoke, gitleaks.
4. The real-PostgreSQL suite runs with nothing skipped, and its count is recorded in `STATUS.md` §1.
5. G-5 closed (or explicitly accepted in writing for a non-public staging box).
6. `offerings.ts` matches reality.
7. The cashier-UI blockers in `STATUS.md` §6 are all closed, because Phase 1 UI cannot start before that.

Two of these are the owner's. Five are the agent's. **None of them needs a new feature.**

---

## 4. The owner's six questions — plain language

These are the only decisions that stop the work. Every one of them is reversible, and for each there is a
technical recommendation that the owner may simply accept.

| ID | The question, without jargon | Recommended answer | What it costs to change later |
| --- | --- | --- | --- |
| **D-A** | How does a customer pay, and which ways do we accept? | Cash, bank card, mobile wallet, bank transfer — all four. Add the database guardrails in the same step | Adding a fifth method later: cheap. Removing one after shops use it: awkward |
| **D-B** | When someone types a cash amount wrong, what happens? | A **new correcting line**. The original is never edited | — (this is already the law of the system) |
| **D-C** | Who may close the till at the end of the day? | The cashier counts, the **manager approves** | Loosening it later is one permission change |
| **D-D** | Who may see the end-of-day report? | Manager and owner only — **not** the kitchen and not the storekeeper | Easy to widen |
| **D-E** | Does "total sales" mean money actually collected, or everything rung up? | **Money collected only**, and a refund is its own line | This one is the hard one: it decides what the number on the daily report *means*. Changing it later rewrites history in every report the owner has seen |
| **D5** | Where does it actually run, and on what database? | A **throwaway** Supabase trial project to measure, not an existing one | Medium: migration between providers is a day of work, not a rewrite |

> **D-E is the one to answer carefully.** It is the difference between "I sold 5,000 today" and
> "I collected 4,200 today, 800 is still owed". Both are legitimate; the product must pick one.

---

## 5. Where the payment engine actually stands

Detail, invariants and file references: [`proposals/0007`](../architecture/proposals/0007-payment-engine.md) §8.

Short version:

- **Built and tested:** checkout with split tenders, refunds with serialised locking, cash shifts with a
  locked close, the Cairo-time daily report, five new tables, append-only enforced by the database.
- **Missing and important:** `resolvePendingCash` — pending cash can be created and **never resolved**, so
  money would sit in the drawer for ever and never count as revenue. Also `recordPayment` (deposits),
  `getPaymentStatus`, and a drawer read endpoint.
- **Enforcement moved into the database** on this branch: migration `0005` — see
  `engines/db/migrations/0005_money_constraints.sql`.

---

## 6. How to keep this board honest

- Every row that says "ready" must name the ref or file that proves it can start.
- Every row that closes must name the command and its output, not a description of the output.
- No row is closed by a verbal assurance — including the agent's own.
- When `STATUS.md` §5 and this board disagree, `STATUS.md` wins and this board is corrected in the same change.
