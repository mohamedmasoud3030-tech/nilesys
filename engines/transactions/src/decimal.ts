/**
 * NILE ENGINE EXTRACTION
 * Extracted verbatim from bug-free-garbanzo (kayyal) src/domain/decimal.ts — branded Decimal money/quantity types. Do not change rounding/scale without an ADR (see test/golden.test.ts).
 * Source: github.com/mohamedmasoud3030-tech — extracted 2026-10-13, original repo untouched.
 */
/**
 * Decimal primitives — the only place arithmetic on money or weight is allowed.
 * Contract: docs/adr/kayyal-core/0004-decimal-arithmetic.md, docs/FINANCIAL_RULES.md §1
 *
 * RULES ENFORCED HERE:
 *  - No JS `number` ever holds a money or weight value.
 *  - Values cross every boundary as strings.
 *  - Rounding is half-up and happens ONLY through these helpers.
 */
import Decimal from 'decimal.js';

// Half-up rounding, ample internal precision (FINANCIAL_RULES §1.6)
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpPos: 40, toExpNeg: -40 });

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** Weight in kilograms — the canonical unit. Tons are never stored. */
export type Kg = Brand<Decimal, 'Kg'>;
/** A money amount in Egyptian pounds. */
export type EGP = Brand<Decimal, 'EGP'>;
/** A price expressed per kilogram. */
export type EGPPerKg = Brand<Decimal, 'EGPPerKg'>;
/** A price as the human entered it, in the line's own unit. */
export type EGPPerUnit = Brand<Decimal, 'EGPPerUnit'>;
/** A percentage, e.g. 5.25 meaning 5.25 %. */
export type Percent = Brand<Decimal, 'Percent'>;

export const SCALE = {
  money: 2,
  weight: 2,
  unitPrice: 4,
  perKg: 6,
  cost: 6,
  percent: 3,
} as const;

/** Reject anything that is not a finite decimal string. Never accepts a JS number. */
function parse(value: string, what: string): Decimal {
  if (typeof value !== 'string') throw new TypeError(`${what}: value must be a string, never a number`);
  const trimmed = value.trim();
  if (trimmed === '') throw new TypeError(`${what}: empty value`);
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new TypeError(`${what}: not a decimal string: ${value}`);
  const d = new Decimal(trimmed);
  if (!d.isFinite()) throw new TypeError(`${what}: not finite`);
  return d;
}

export const kg = (v: string): Kg => {
  const d = parse(v, 'kg');
  if (d.isNegative()) throw new RangeError('kg: weight cannot be negative');
  return d as Kg;
};
export const egp = (v: string): EGP => parse(v, 'egp') as EGP;
export const egpPerKg = (v: string): EGPPerKg => {
  const d = parse(v, 'egpPerKg');
  if (d.isNegative()) throw new RangeError('egpPerKg: price cannot be negative');
  return d as EGPPerKg;
};
export const egpPerUnit = (v: string): EGPPerUnit => {
  const d = parse(v, 'egpPerUnit');
  if (d.isNegative()) throw new RangeError('egpPerUnit: price cannot be negative');
  return d as EGPPerUnit;
};
export const percent = (v: string): Percent => {
  const d = parse(v, 'percent');
  if (d.isNegative()) throw new RangeError('percent: cannot be negative');
  return d as Percent;
};

export const ZERO_KG = kg('0');
export const ZERO_EGP = egp('0');
export const ZERO_COST = egpPerKg('0');

/** Round half-up to a fixed scale. The ONLY rounding entry point. */
export const round = (d: Decimal, scale: number): Decimal => d.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);

export const roundMoney = (d: Decimal): EGP => round(d, SCALE.money) as EGP;
export const roundWeight = (d: Decimal): Kg => round(d, SCALE.weight) as Kg;
export const roundCost = (d: Decimal): EGPPerKg => round(d, SCALE.cost) as EGPPerKg;

/** Serialize for the database or an API response — always a fixed-scale string. */
export const out = (d: Decimal, scale: number): string => round(d, scale).toFixed(scale);
export const outMoney = (d: EGP | Decimal): string => out(d, SCALE.money);
export const outWeight = (d: Kg | Decimal): string => out(d, SCALE.weight);
export const outCost = (d: EGPPerKg | Decimal): string => out(d, SCALE.cost);

export const isZero = (d: Decimal): boolean => d.isZero();
export const gt = (a: Decimal, b: Decimal): boolean => a.greaterThan(b);
export const gte = (a: Decimal, b: Decimal): boolean => a.greaterThanOrEqualTo(b);
export const lt = (a: Decimal, b: Decimal): boolean => a.lessThan(b);
export const eq = (a: Decimal, b: Decimal): boolean => a.equals(b);

export { Decimal };
