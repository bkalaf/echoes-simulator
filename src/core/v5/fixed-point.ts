import type { FactionVector } from "./types.js";

const FACTION_KEYS = ["CONCORD", "SCHISM", "RUIN"] as const;

export function assertInteger(value: number, label = "value"): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

export function divideRoundedAway(numerator: bigint, positiveDenominator: bigint): bigint {
  if (positiveDenominator <= 0n) throw new Error("Denominator must be positive");
  if (numerator === 0n) return 0n;
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / positiveDenominator;
  const remainder = absolute % positiveDenominator;
  const rounded = remainder * 2n >= positiveDenominator ? quotient + 1n : quotient;
  return sign * rounded;
}

export function divideFloorNonNegative(numerator: bigint, positiveDenominator: bigint): bigint {
  if (numerator < 0n || positiveDenominator <= 0n) throw new Error("Floor division requires nonnegative numerator and positive denominator");
  return numerator / positiveDenominator;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  assertInteger(value); assertInteger(minimum); assertInteger(maximum);
  if (minimum > maximum) throw new Error("Invalid clamp bounds");
  return Math.min(maximum, Math.max(minimum, value));
}

export function scaled(coefficient: number, score: number): number {
  assertInteger(coefficient, "coefficient"); assertInteger(score, "score");
  return Number(divideRoundedAway(BigInt(coefficient) * BigInt(score), 1000n));
}

export function weightedMean(...terms: readonly (readonly [number, number])[]): number {
  if (terms.reduce((sum, [, weight]) => sum + weight, 0) !== 10_000) throw new Error("Weighted mean weights must total 10000");
  let numerator = 0n;
  for (const [value, weight] of terms) {
    assertInteger(value); assertInteger(weight);
    numerator += BigInt(value) * BigInt(weight);
  }
  return Number(divideRoundedAway(numerator, 10_000n));
}

export function ratioScore(numerator: bigint, denominator: bigint, zeroFallback: number): number {
  assertInteger(zeroFallback, "zeroFallback");
  if (denominator < 0n || numerator < 0n) throw new Error("ratioScore inputs must be nonnegative");
  if (denominator === 0n) return clamp(zeroFallback, 0, 1000);
  return clamp(Number(divideRoundedAway(numerator * 1000n, denominator)), 0, 1000);
}

export function blend(prior: number, target: number, inertiaBps: number): number {
  [prior, target, inertiaBps].forEach((value) => assertInteger(value));
  if (inertiaBps < 0 || inertiaBps > 10_000) throw new Error("Inertia must be BPS");
  return Number(divideRoundedAway(BigInt(prior) * BigInt(inertiaBps) + BigInt(target) * BigInt(10_000 - inertiaBps), 10_000n));
}

export function largestRemainder(total: bigint, weights: readonly bigint[], stableKeys: readonly string[]): bigint[] {
  if (total < 0n || weights.length !== stableKeys.length || weights.some((weight) => weight < 0n)) throw new Error("Invalid largest-remainder input");
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  if (denominator === 0n) return weights.map(() => 0n);
  const result = weights.map((weight) => total * weight / denominator);
  let left = total - result.reduce((sum, value) => sum + value, 0n);
  const ranked = weights.map((weight, index) => ({ index, remainder: total * weight % denominator, key: stableKeys[index]! }))
    .sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; left > 0n; index += 1, left -= 1n) result[ranked[index % ranked.length]!.index] += 1n;
  return result;
}

export function normalizedVectorWeightedMean(...terms: readonly (readonly [FactionVector, number])[]): FactionVector {
  if (terms.reduce((sum, [, weight]) => sum + weight, 0) !== 10_000) throw new Error("Vector weights must total 10000");
  const raw = FACTION_KEYS.map((key) => {
    const sum = terms.reduce((value, [vector, weight]) => value + BigInt(assertInteger(vector[key])) * BigInt(assertInteger(weight)), 0n);
    return sum < 0n ? 0n : sum;
  });
  const apportioned = largestRemainder(1000n, raw, [...FACTION_KEYS]);
  return { CONCORD: Number(apportioned[0]), SCHISM: Number(apportioned[1]), RUIN: Number(apportioned[2]) };
}

export function normalizeFactionVector(input: Readonly<Record<(typeof FACTION_KEYS)[number], number>>): FactionVector {
  const weights = FACTION_KEYS.map((key) => BigInt(Math.max(0, assertInteger(input[key], key))));
  if (weights.every((value) => value === 0n)) return { CONCORD: 334, SCHISM: 333, RUIN: 333 };
  const normalized = largestRemainder(1000n, weights, [...FACTION_KEYS]);
  return { CONCORD: Number(normalized[0]), SCHISM: Number(normalized[1]), RUIN: Number(normalized[2]) };
}

export function factionCompatibility(a: FactionVector, b: FactionVector): number {
  const distance = FACTION_KEYS.reduce((sum, key) => sum + Math.abs(assertInteger(a[key]) - assertInteger(b[key])), 0);
  return clamp(1000 - Number(divideRoundedAway(BigInt(distance), 2n)), 0, 1000);
}

export function thresholdChance(pressure: number, threshold: number, maximumChanceBps: number): number {
  [pressure, threshold, maximumChanceBps].forEach((value) => assertInteger(value));
  if (pressure < threshold) return 0;
  if (threshold >= 1000) return clamp(maximumChanceBps, 0, 10_000);
  const chance = divideRoundedAway(BigInt(pressure - threshold) * BigInt(maximumChanceBps), BigInt(1000 - threshold));
  return clamp(Number(chance), 0, maximumChanceBps);
}

export function populationWeightedScore(rows: readonly { population: bigint; score: number }[], zeroFallback = 0): number {
  const population = rows.reduce((sum, row) => sum + row.population, 0n);
  if (population === 0n) return zeroFallback;
  return clamp(Number(divideRoundedAway(rows.reduce((sum, row) => sum + row.population * BigInt(assertInteger(row.score)), 0n), population)), 0, 1000);
}
