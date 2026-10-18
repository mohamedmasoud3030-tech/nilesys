/**
 * NILE ENGINE EXTRACTION
 * Extracted verbatim from bug-free-garbanzo (kayyal) src/domain/regrade.ts — stock regrade allocation (weight conservation).
 * Source: github.com/mohamedmasoud3030-tech — extracted 2026-10-13, original repo untouched.
 */
/**
 * Regrade allocation by relative sales value, with snapshots and deferred resolution.
 * Contract in this repository: the golden suite
 * `engines/transactions/test/golden.test.ts` — G-8 (allocation) and G-9
 * (deferred resolution). Those golden results may never change without an ADR
 * (see docs/REUSE.md).
 * Provenance note: the extraction source cited `docs/FINANCIAL_RULES.md` §6–§7
 * and `docs/adr/0007-regrade-allocation.md`. Neither exists in this repository,
 * and ADR-0007 here is "Roles and permissions via Better Auth access control",
 * not regrade allocation. Do not follow those paths; see the "Numbering notes"
 * in docs/DECISIONS.md. This is not unique to this file: `docs/FINANCIAL_RULES.md`
 * and source-repo ADR numbers 0004/0006/0008/0009 are cited across
 * `engines/transactions/` and are pending an owner decision.
 */
import {
  Decimal, type EGP, type EGPPerKg, type Kg,
  isZero, roundCost, roundMoney, SCALE,
} from './decimal.js';
import { DomainError } from './line.js';

export type AllocationMethod = 'relative_sales_value' | 'weight_fallback';

export interface RegradeOutputInput {
  readonly materialId: string;
  readonly kg: Kg;
  /** Reference sell price per kg, snapshotted at save time. null = no trustworthy price. */
  readonly refSellPricePerKg: EGPPerKg | null;
}

export interface AllocatedOutput {
  readonly materialId: string;
  readonly kg: Kg;
  readonly refSellPriceSnapshot: EGPPerKg | null;
  readonly allocatedValue: EGP;
  readonly allocatedCostPerKg: EGPPerKg;
}

export interface RegradeAllocation {
  readonly method: AllocationMethod;
  readonly consumedValue: EGP;
  readonly deferred: boolean;
  readonly outputs: readonly AllocatedOutput[];
  /** Held when deferred: the entire consumed value (D33, all-or-nothing). */
  readonly unallocatedValue: EGP | null;
}

export function conserveWeight(sourceKg: Kg, outputs: readonly { kg: Kg }[], lossKg: Kg): void {
  const sum = outputs.reduce<Decimal>((a, o) => a.plus(o.kg), new Decimal(0)).plus(lossKg);
  if (!sum.equals(sourceKg)) {
    throw new DomainError('regrade_weight_mismatch', 'مجموع النواتج لا يساوي الكمية المستهلكة', {
      source_kg: sourceKg.toFixed(SCALE.weight),
      outputs_plus_loss_kg: sum.toFixed(SCALE.weight),
      difference_kg: sourceKg.minus(sum).toFixed(SCALE.weight),
    });
  }
}

/**
 * Distribute `consumedValue` across outputs by relative sales value.
 * The residue from rounding is absorbed by the LAST output so that
 * Σ allocatedValue === consumedValue exactly (pinned by golden example G-8 in
 * `test/golden.test.ts`; the source's "FINANCIAL_RULES §6 / invariant DB-9"
 * document is not in this repository).
 */
function distribute(consumedValue: EGP, weights: readonly Decimal[], outputs: readonly RegradeOutputInput[], method: AllocationMethod): AllocatedOutput[] {
  const total = weights.reduce<Decimal>((a, w) => a.plus(w), new Decimal(0));
  const result: AllocatedOutput[] = [];
  let running = new Decimal(0);

  outputs.forEach((o, i) => {
    const w = weights[i] as Decimal;
    const isLast = i === outputs.length - 1;
    const value = isLast
      ? (consumedValue.minus(running) as Decimal)               // residue absorbed here
      : roundMoney(consumedValue.times(w).dividedBy(total));
    running = running.plus(value);
    result.push({
      materialId: o.materialId,
      kg: o.kg,
      refSellPriceSnapshot: method === 'relative_sales_value' ? o.refSellPricePerKg : null,
      allocatedValue: roundMoney(value),
      allocatedCostPerKg: roundCost(value.dividedBy(o.kg)),
    });
  });
  return result;
}

export function allocateRegrade(
  consumedKg: Kg,
  sourceAvgCostPerKg: EGPPerKg,
  outputs: readonly RegradeOutputInput[],
): RegradeAllocation {
  if (outputs.length === 0) throw new DomainError('regrade_weight_mismatch', 'لا توجد أصناف ناتجة');
  const consumedValue = roundMoney(consumedKg.times(sourceAvgCostPerKg));

  // D28/D33 — all-or-nothing deferral. Partially allocating among priced outputs
  // would push the whole cost onto them and reproduce the distortion we exist to prevent.
  if (outputs.some((o) => o.refSellPricePerKg === null)) {
    return { method: 'relative_sales_value', consumedValue, deferred: true, outputs: [], unallocatedValue: consumedValue };
  }

  const notionals = outputs.map((o) => o.kg.times(o.refSellPricePerKg as EGPPerKg));
  const notionalTotal = notionals.reduce<Decimal>((a, n) => a.plus(n), new Decimal(0));

  if (isZero(notionalTotal)) {
    // Every reference price is zero → weight fallback, stated on screen (FR-9).
    const weights = outputs.map((o) => o.kg as Decimal);
    return {
      method: 'weight_fallback', consumedValue, deferred: false,
      outputs: distribute(consumedValue, weights, outputs, 'weight_fallback'), unallocatedValue: null,
    };
  }

  return {
    method: 'relative_sales_value', consumedValue, deferred: false,
    outputs: distribute(consumedValue, notionals, outputs, 'relative_sales_value'), unallocatedValue: null,
  };
}

// ---------------------------------------------------------------------------
// Deferred resolution (D33) — the correction the owner insisted on.
// ---------------------------------------------------------------------------

export interface DeferredResolutionInput {
  readonly materialId: string;
  /** ORIGINAL output quantity recorded at the regrade — never today's stock. */
  readonly originalKg: Kg;
  /** Snapshot if one existed at save time, otherwise the value the owner supplies now. */
  readonly refSellPricePerKg: EGPPerKg;
  /** Outbound of this material between the regrade and the resolution, from the ledger. */
  readonly soldKgSinceRegrade: Kg;
}

export interface ResolvedOutput {
  readonly materialId: string;
  readonly originalKg: Kg;
  readonly soldKg: Kg;
  readonly remainingKg: Kg;
  readonly allocatedValue: EGP;
  /** Historical cost of quantities already sold — current period, NOT inventory. */
  readonly unattributedValue: EGP;
  /** The only portion that enters current inventory cost. */
  readonly toInventoryValue: EGP;
}

export interface DeferredResolution {
  readonly consumedValue: EGP;
  readonly outputs: readonly ResolvedOutput[];
  readonly totalUnattributed: EGP;
  readonly totalToInventory: EGP;
}

export function resolveDeferredAllocation(
  consumedValue: EGP,
  inputs: readonly DeferredResolutionInput[],
): DeferredResolution {
  const notionals = inputs.map((o) => o.originalKg.times(o.refSellPricePerKg));
  const notionalTotal = notionals.reduce<Decimal>((a, n) => a.plus(n), new Decimal(0));
  if (isZero(notionalTotal)) throw new DomainError('missing_reference_price', 'لا توجد أسعار مرجعية صالحة');

  const outputs: ResolvedOutput[] = [];
  let runningValue = new Decimal(0);
  let unattributedSum = new Decimal(0);
  let toInventorySum = new Decimal(0);

  inputs.forEach((o, i) => {
    const isLast = i === inputs.length - 1;
    const value = isLast
      ? (consumedValue.minus(runningValue) as Decimal)
      : roundMoney(consumedValue.times(notionals[i] as Decimal).dividedBy(notionalTotal));
    runningValue = runningValue.plus(value);

    const soldKg = (o.soldKgSinceRegrade.greaterThan(o.originalKg) ? o.originalKg : o.soldKgSinceRegrade) as Kg;
    const remainingKg = o.originalKg.minus(soldKg) as Kg;

    // Sold share is historical, unattributed cost; the remainder is the ONLY part
    // that may touch inventory (D33). Residue stays inside this output.
    const unattributed = roundMoney(value.times(soldKg).dividedBy(o.originalKg));
    const toInventory = roundMoney(value.minus(unattributed));

    unattributedSum = unattributedSum.plus(unattributed);
    toInventorySum = toInventorySum.plus(toInventory);

    outputs.push({
      materialId: o.materialId, originalKg: o.originalKg, soldKg, remainingKg,
      allocatedValue: roundMoney(value), unattributedValue: unattributed, toInventoryValue: toInventory,
    });
  });

  return {
    consumedValue,
    outputs,
    totalUnattributed: roundMoney(unattributedSum),
    totalToInventory: roundMoney(toInventorySum),
  };
}
