/**
 * NILE ENGINE EXTRACTION
 * Extracted verbatim from bug-free-garbanzo (kayyal) src/domain/costing.ts — weighted-average stock costing.
 * Source: github.com/mohamedmasoud3030-tech — extracted 2026-10-13, original repo untouched.
 */
/**
 * Weighted moving average costing and sale profit.
 * Contract: docs/FINANCIAL_RULES.md §4, docs/adr/kayyal-core/0006-costing-model.md. Golden G-5…G-7, G-12.
 */
import {
  Decimal, type EGP, type EGPPerKg, type Kg,
  gt, isZero, roundCost, roundMoney, SCALE,
} from './decimal.js';

export interface StockState {
  readonly quantityKg: Kg;
  readonly avgCostPerKg: EGPPerKg;
}

/** Perpetual weighted moving average, applied on every posted inbound line. */
export function applyInbound(state: StockState, inKg: Kg, costPerKgIn: EGPPerKg): StockState {
  const newQty = state.quantityKg.plus(inKg);
  if (isZero(newQty)) return state; // FINANCIAL_RULES §4: avg unchanged
  const newValue = state.quantityKg.times(state.avgCostPerKg).plus(inKg.times(costPerKgIn));
  return {
    quantityKg: newQty as Kg,
    avgCostPerKg: roundCost(newValue.dividedBy(newQty)),
  };
}

/** Outbound at the current average. Never produces a negative balance (D22, INV-1). */
export function applyOutbound(state: StockState, outKg: Kg): StockState {
  const newQty = state.quantityKg.minus(outKg);
  if (newQty.isNegative()) {
    throw new Error('stock_would_go_negative');
  }
  return { quantityKg: newQty as Kg, avgCostPerKg: state.avgCostPerKg };
}

export interface SaleProfit {
  readonly costSnapshotPerKg: EGPPerKg;
  readonly costAmount: EGP;
  readonly grossProfit: EGP | null; // null => "غير محسوب"
  readonly marginPct: Decimal | null;
  readonly uncomputable: boolean;
}

/**
 * Profit for one sale line. A zero cost snapshot reports "غير محسوب",
 * never a fabricated 100 % margin (E19, golden G-7).
 */
export function computeSaleProfit(netKg: Kg, lineTotal: EGP, avgCostPerKg: EGPPerKg): SaleProfit {
  const costAmount = roundMoney(netKg.times(avgCostPerKg));
  if (isZero(avgCostPerKg)) {
    return { costSnapshotPerKg: avgCostPerKg, costAmount, grossProfit: null, marginPct: null, uncomputable: true };
  }
  const grossProfit = roundMoney(lineTotal.minus(costAmount));
  const marginPct = gt(lineTotal, new Decimal(0))
    ? grossProfit.dividedBy(lineTotal).times(100).toDecimalPlaces(SCALE.percent, Decimal.ROUND_HALF_UP)
    : null;
  return { costSnapshotPerKg: avgCostPerKg, costAmount, grossProfit, marginPct, uncomputable: false };
}

export function stockValue(state: StockState): EGP {
  return roundMoney(state.quantityKg.times(state.avgCostPerKg));
}

/**
 * Closed-day cost adjustment (ADR-0008, FINANCIAL_RULES §8, golden G-12).
 * Corrects the average prospectively; never rewrites the closed day.
 */
export function applyCostAdjustment(state: StockState, deltaValue: EGP): StockState {
  if (isZero(state.quantityKg)) return state; // delta goes wholly to the P&L line
  const newValue = state.quantityKg.times(state.avgCostPerKg).plus(deltaValue);
  if (newValue.isNegative()) throw new Error('cost_adjustment_would_go_negative');
  return { quantityKg: state.quantityKg, avgCostPerKg: roundCost(newValue.dividedBy(state.quantityKg)) };
}
