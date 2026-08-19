import { describe, expect, it } from "vitest";
import { ScopedRandom } from "../../src/core/determinism/scoped-random.js";
import {
  apportionLargestRemainder,
  ceilDiv,
  compareRatio,
  parsePopulation,
  serializePopulation,
} from "../../src/core/math/exact.js";

describe("scoped deterministic core", () => {
  it("pins stable output and isolates scopes", () => {
    const random = new ScopedRandom("published-test-seed");
    expect(random.integer({ world: "CONCORD", year: 75, purpose: "EVENT_JITTER", entityId: "WAVE_3" }, -2, 2)).toBe(2);
    random.integer({ world: "CONCORD", year: 75, purpose: "OTHER", entityId: "WAVE_3" }, 0, 100);
    expect(random.integer({ world: "CONCORD", year: 75, purpose: "EVENT_JITTER", entityId: "WAVE_3" }, -2, 2)).toBe(2);
  });

  it("preserves exact populations and rational boundaries", () => {
    const huge = 99_999_999_999_999_999_999n;
    expect(parsePopulation(serializePopulation(huge))).toBe(huge);
    expect(() => parsePopulation("01")).toThrow();
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(compareRatio(30n, 100n, 3n, 10n)).toBe(0);
    expect(compareRatio(50n, 100n, 1n, 2n)).toBe(0);
  });

  it("apportions with exact conservation", () => {
    const result = apportionLargestRemainder(10n, [1n, 1n, 1n], ["a", "b", "c"]);
    expect(result).toEqual([4n, 3n, 3n]);
    expect(result.reduce((sum, value) => sum + value, 0n)).toBe(10n);
  });
});
