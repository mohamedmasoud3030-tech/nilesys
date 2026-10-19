# Integration probes, 2026-10-18 (evidence only; NOT committed to any branch)

**Environment:** Node 20.20.2, PostgreSQL 17.11 (disposable local cluster).

## How to run

1. Copy the two probe files into `engines/transactions/test/` of a checkout of `e94ecc4`.
2. Copy the PG harness alongside them as `zz-pg-harness.ts`:
   `git show c72f746:engines/catalog/test/pg-harness.ts > engines/transactions/test/zz-pg-harness.ts`
3. Run:
   - `npx vitest run engines/transactions/test/zz-probe.test.ts`
   - `NILE_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5471/postgres npx vitest run engines/transactions/test/zz-race.pg.test.ts`

## Observed

**`zz-probe.test.ts`:**

| Probe | On e94ecc4 | With mutant M1 (fixed UTC+2) |
|---|---|---|
| P1 summer | PASS | FAIL |
| P2 25-hour day | PASS | FAIL |
| P3 split cash 500+500 | FAIL (23505) | — |
| P4 net and expected cash | PASS | — |

The DST suite's own 7 tests all PASS under M1.

**`zz-race.pg.test.ts`** (real PG):

| Run | Result |
|---|---|
| R1 | closeShift completed while the checkout lock key was held (keys differ) |
| R2 | control: checkout blocked |
| R3 | 60 iterations, 51 both-succeeded, 50 sale cash committed into a closed shift with expected=0 |

## Other files

| File | Contents |
|---|---|
| `dst-typecheck-errors.txt` | `tsc --noEmit` on e94ecc4: 37 errors |
| `parity-matrix-c72f746+e94ecc4.txt` | Prototype parity on the merge-tree result: identical to c72f746 |
