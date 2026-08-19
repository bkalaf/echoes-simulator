const POPULATION_PATTERN = /^(0|[1-9][0-9]*)$/;

export function serializePopulation(value: bigint): string {
  if (value < 0n) throw new Error("Population cannot be negative");
  return value.toString(10);
}

export function parsePopulation(value: string): bigint {
  if (!POPULATION_PATTERN.test(value)) throw new Error(`Invalid population string: ${value}`);
  return BigInt(value);
}

export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new Error("floorDiv requires a nonnegative numerator and positive denominator");
  return numerator / denominator;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new Error("ceilDiv requires a nonnegative numerator and positive denominator");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

export function compareRatio(aNumerator: bigint, aDenominator: bigint, bNumerator: bigint, bDenominator: bigint): -1 | 0 | 1 {
  if (aDenominator <= 0n || bDenominator <= 0n) throw new Error("Ratio denominators must be positive");
  const difference = aNumerator * bDenominator - bNumerator * aDenominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function mulRatioFloor(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return floorDiv(value * numerator, denominator);
}

export function mulRatioCeil(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return ceilDiv(value * numerator, denominator);
}

export function apportionLargestRemainder(total: bigint, weights: readonly bigint[], stableKeys: readonly string[]): bigint[] {
  if (total < 0n || weights.length !== stableKeys.length || weights.some((weight) => weight < 0n)) throw new Error("Invalid apportionment input");
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal === 0n) return weights.map(() => 0n);
  const base = weights.map((weight) => (total * weight) / weightTotal);
  let remaining = total - base.reduce((sum, value) => sum + value, 0n);
  const ranking = weights.map((weight, index) => ({ index, remainder: (total * weight) % weightTotal, key: stableKeys[index] ?? "" }))
    .sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) base[ranking[index % ranking.length]!.index] += 1n;
  return base;
}
