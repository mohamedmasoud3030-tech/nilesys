/**
 * NILE ENGINE EXTRACTION
 * Extracted verbatim from bug-free-garbanzo (kayyal) src/domain/cash.ts — cash drawer / shift-close math.
 * Source: github.com/mohamedmasoud3030-tech — extracted 2026-10-13, original repo untouched.
 */
/**
 * Cash box arithmetic, including pending cash.
 * Contract: docs/FINANCIAL_RULES.md §5, docs/adr/kayyal-core/0009-cash-reconciliation.md. Golden G-10, G-11, G-14.
 */
import { Decimal, type EGP, roundMoney } from './decimal.js';

export type CashStatus = 'pending' | 'posted';
export type CashDirection = 'in' | 'out';

export interface CashMovement {
  readonly id: string;
  readonly direction: CashDirection;
  readonly amount: EGP;
  readonly status: CashStatus;
  readonly transactionId?: string;
}

export interface DrawerPosition {
  /** From posted movements only — feeds revenue, profit and party balances. */
  readonly expectedPosted: EGP;
  /** Money received against unresolved sales — drawer only, never revenue (D32). */
  readonly pendingCash: EGP;
  /** What the physical count is compared against. */
  readonly expectedInDrawer: EGP;
}

export function computeDrawer(openingAmount: EGP, movements: readonly CashMovement[]): DrawerPosition {
  let posted = new Decimal(openingAmount);
  let pending = new Decimal(0);

  for (const m of movements) {
    if (m.status === 'posted') {
      posted = m.direction === 'in' ? posted.plus(m.amount) : posted.minus(m.amount);
    } else {
      // Pending movements are only ever inbound cash against an unresolved sale.
      pending = m.direction === 'in' ? pending.plus(m.amount) : pending.minus(m.amount);
    }
  }

  const expectedPosted = roundMoney(posted);
  const pendingCash = roundMoney(pending);
  return {
    expectedPosted,
    pendingCash,
    expectedInDrawer: roundMoney(expectedPosted.plus(pendingCash)),
  };
}

export function closeDifference(countedAmount: EGP, expectedInDrawer: EGP): EGP {
  return roundMoney(countedAmount.minus(expectedInDrawer));
}

/**
 * The pending → posted flip. Returns the SAME movement id with a new status —
 * never a new amount, never a second row (ADR-0009, invariant DB-5, golden G-14).
 */
export function postPendingCash(m: CashMovement): CashMovement {
  if (m.status !== 'pending') throw new Error('cash_movement_not_pending');
  return { ...m, status: 'posted' };
}
