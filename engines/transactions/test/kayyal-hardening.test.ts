/**
 * NILE ENGINE EXTRACTION
 * Extracted from bug-free-garbanzo (kayyal) tests/domain/hardening.test.ts @ 1343ffc (branch arena/01a087cd-bug-free-garbanzo,
 * blob 0d4724f) — boundary invariants for the extracted decimal/units/line/costing/regrade helpers. Import paths adapted only.
 * Source: github.com/mohamedmasoud3030-tech — extracted 2026-10-19, original repo untouched.
 */
/** Additional executable invariants for arithmetic and allocation helpers.
 * These tests cover boundary branches not represented by the worked examples.
 */
import { describe, expect, it } from 'vitest';

import {
  Decimal,
  ZERO_COST,
  ZERO_EGP,
  ZERO_KG,
  egp,
  egpPerKg,
  egpPerUnit,
  eq,
  gt,
  gte,
  isZero,
  kg,
  lt,
  outCost,
  outMoney,
  outWeight,
  percent,
  roundCost,
  roundMoney,
  roundWeight,
} from '../src/decimal.js';
import { applyCostAdjustment, applyInbound, applyOutbound, computeSaleProfit, stockValue } from '../src/costing.js';
import { computeDeductionKg, computeLine, DomainError, roundToScale } from '../src/line.js';
import { allocateRegrade, conserveWeight, resolveDeferredAllocation } from '../src/regrade.js';
import { fromPricePerKg, isPriceUnit, toPricePerKg, zeroPerKg } from '../src/units.js';

describe('decimal and unit boundary invariants', () => {
  it('refuses JavaScript-number, exponent, blank, and negative-only-forbidden inputs before financial arithmetic', () => {
    const unsafeKg = kg as unknown as (value: unknown) => unknown;
    expect(() => unsafeKg(1.25)).toThrow(/string/);
    expect(() => kg('1e3')).toThrow(/decimal string/);
    expect(() => egp(' ')).toThrow(/empty/);
    expect(() => kg('-0.01')).toThrow(/cannot be negative/);
    expect(() => egpPerKg('-0.000001')).toThrow(/cannot be negative/);
    expect(() => egpPerUnit('-1')).toThrow(/cannot be negative/);
    expect(() => percent('-0.001')).toThrow(/cannot be negative/);
  });

  it('uses fixed half-up serialization and Decimal comparisons rather than binary floating point', () => {
    expect(outMoney(roundMoney(new Decimal('1.005')))).toBe('1.01');
    expect(outWeight(roundWeight(new Decimal('2.345')))).toBe('2.35');
    expect(outCost(roundCost(new Decimal('3.1234565')))).toBe('3.123457');
    expect(outMoney(ZERO_EGP)).toBe('0.00');
    expect(outWeight(ZERO_KG)).toBe('0.00');
    expect(outCost(ZERO_COST)).toBe('0.000000');
    expect(isZero(ZERO_EGP)).toBe(true);
    expect(gt(egp('1.00'), egp('0.99'))).toBe(true);
    expect(gte(egp('1.00'), egp('1.00'))).toBe(true);
    expect(lt(egp('-0.01'), egp('0.00'))).toBe(true);
    expect(eq(egp('1.0'), egp('1.00'))).toBe(true);
  });

  it('converts price units only at the explicit boundary and does not reinterpret a quoted line', () => {
    expect(isPriceUnit('kg')).toBe(true);
    expect(isPriceUnit('ton')).toBe(true);
    expect(isPriceUnit('gram')).toBe(false);
    expect(outCost(toPricePerKg(egpPerUnit('1234.5678'), 'ton'))).toBe('1.234568');
    expect(fromPricePerKg(egpPerKg('1.234568'), 'ton')).toBe('1234.5680');
    expect(fromPricePerKg(egpPerKg('1.234568'), 'kg')).toBe('1.2346');
    expect(outCost(zeroPerKg())).toBe('0.000000');
  });
});

describe('line and stock boundary invariants', () => {
  it('rejects zero/net-zero weights and deductions at or over gross while preserving exact deduction facts', () => {
    let invalidWeight: unknown;
    try {
      computeLine({
        grossKg: kg('0'), deductionType: 'none', deductionValue: new Decimal(0),
        unitPrice: egpPerUnit('1'), priceUnit: 'kg',
      });
    } catch (error) { invalidWeight = error; }
    expect(invalidWeight).toMatchObject({ code: 'invalid_weight' });

    let invalidPercent: unknown;
    try { computeDeductionKg(kg('10.00'), 'percent', percent('100.000')); } catch (error) { invalidPercent = error; }
    expect(invalidPercent).toMatchObject({ code: 'invalid_deduction' });

    let invalidKg: unknown;
    try {
      computeLine({
        grossKg: kg('10.00'), deductionType: 'kg', deductionValue: kg('10.00'),
        unitPrice: egpPerUnit('1'), priceUnit: 'kg',
      });
    } catch (error) { invalidKg = error; }
    expect(invalidKg).toMatchObject({ code: 'invalid_deduction', details: { gross_kg: '10.00', deduction_kg: '10.00' } });
    expect(outWeight(computeDeductionKg(kg('10.00'), 'none', new Decimal('999')))).toBe('0.00');
    expect(roundToScale(new Decimal('9.995'), 2).toFixed(2)).toBe('10.00');
  });

  it('keeps outbound stock at its existing average, blocks a negative balance, and treats zero quantity cost adjustment as P&L only', () => {
    const original = { quantityKg: kg('10.00'), avgCostPerKg: egpPerKg('7.500000') };
    const afterOutbound = applyOutbound(original, kg('4.00'));
    expect(outWeight(afterOutbound.quantityKg)).toBe('6.00');
    expect(outCost(afterOutbound.avgCostPerKg)).toBe('7.500000');
    expect(() => applyOutbound(original, kg('10.01'))).toThrow('stock_would_go_negative');
    expect(applyCostAdjustment({ quantityKg: kg('0'), avgCostPerKg: egpPerKg('0') }, egp('-999.99')))
      .toEqual({ quantityKg: kg('0'), avgCostPerKg: egpPerKg('0') });
    expect(() => applyCostAdjustment(original, egp('-75.01'))).toThrow('cost_adjustment_would_go_negative');

    const zeroInbound = applyInbound({ quantityKg: kg('0'), avgCostPerKg: egpPerKg('12.000000') }, kg('0'), egpPerKg('99.000000'));
    expect(outCost(zeroInbound.avgCostPerKg)).toBe('12.000000');
    expect(outMoney(stockValue(afterOutbound))).toBe('45.00');
  });

  it('does not invent margin percent for a non-positive sale total even when a cost exists', () => {
    const loss = computeSaleProfit(kg('2.00'), egp('-1.00'), egpPerKg('5.000000'));
    expect(outMoney(loss.costAmount)).toBe('10.00');
    expect(outMoney(loss.grossProfit!)).toBe('-11.00');
    expect(loss.marginPct).toBeNull();
    expect(loss.uncomputable).toBe(false);
  });
});

describe('regrade allocation guards', () => {
  it('makes weight conservation an explicit precondition and reports the exact discrepancy', () => {
    expect(() => conserveWeight(kg('10.00'), [{ kg: kg('4.00') }, { kg: kg('5.00') }], kg('1.00'))).not.toThrow();
    try {
      conserveWeight(kg('10.00'), [{ kg: kg('4.00') }, { kg: kg('5.00') }], kg('0.50'));
      throw new Error('expected conservation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'regrade_weight_mismatch',
        details: { source_kg: '10.00', outputs_plus_loss_kg: '9.50', difference_kg: '0.50' },
      });
    }
  });

  it('uses documented all-or-nothing deferral or weight fallback and preserves every cent through residue assignment', () => {
    const deferred = allocateRegrade(kg('3.00'), egpPerKg('10.000000'), [
      { materialId: 'known', kg: kg('1.00'), refSellPricePerKg: egpPerKg('5.000000') },
      { materialId: 'unknown', kg: kg('2.00'), refSellPricePerKg: null },
    ]);
    expect(deferred).toMatchObject({ deferred: true, outputs: [], unallocatedValue: egp('30.00') });

    const fallback = allocateRegrade(kg('3.00'), egpPerKg('10.000000'), [
      { materialId: 'one', kg: kg('1.00'), refSellPricePerKg: egpPerKg('0') },
      { materialId: 'two', kg: kg('2.00'), refSellPricePerKg: egpPerKg('0') },
    ]);
    expect(fallback.method).toBe('weight_fallback');
    expect(fallback.outputs.map((output) => outMoney(output.allocatedValue))).toEqual(['10.00', '20.00']);
    expect(fallback.outputs.map((output) => output.refSellPriceSnapshot)).toEqual([null, null]);
    let noOutputs: unknown;
    try { allocateRegrade(kg('1.00'), egpPerKg('1.000000'), []); } catch (error) { noOutputs = error; }
    expect(noOutputs).toMatchObject({ code: 'regrade_weight_mismatch' });
  });

  it('caps sold quantity at the original regrade output and assigns no inventory cost to a fully sold output', () => {
    const resolved = resolveDeferredAllocation(egp('30.00'), [
      { materialId: 'fully-sold', originalKg: kg('1.00'), refSellPricePerKg: egpPerKg('1.000000'), soldKgSinceRegrade: kg('9.00') },
      { materialId: 'remaining', originalKg: kg('2.00'), refSellPricePerKg: egpPerKg('1.000000'), soldKgSinceRegrade: kg('0.00') },
    ]);
    const sold = resolved.outputs[0]!;
    expect(sold).toMatchObject({ soldKg: kg('1.00'), remainingKg: kg('0.00') });
    expect(outMoney(sold.unattributedValue)).toBe('10.00');
    expect(outMoney(sold.toInventoryValue)).toBe('0.00');
    expect(outMoney(resolved.totalUnattributed.plus(resolved.totalToInventory))).toBe('30.00');
    let zeroReferences: unknown;
    try {
      resolveDeferredAllocation(egp('1.00'), [
        { materialId: 'zero', originalKg: kg('1.00'), refSellPricePerKg: egpPerKg('0'), soldKgSinceRegrade: kg('0') },
      ]);
    } catch (error) { zeroReferences = error; }
    expect(zeroReferences).toMatchObject({ code: 'missing_reference_price' });
  });
});
