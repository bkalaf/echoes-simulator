import { describe, expect, it } from "vitest";
import {
  BREED_DIMENSION_BALANCE_POLICY,
  rebalanceBreedDimensions,
} from "../../src/core/research/breed-dimension-balance.js";
import {
  PERSONALITY_DIMENSION_POLICY,
  RAW_DIMENSIONS,
  type EffectiveBreedSemantics,
} from "../../src/core/research/v4-contract.js";

const factionValues = {
  CONCORD: "A",
  SCHISM: "B",
  RUIN: "C",
} as const;

const mapping = Object.fromEntries(
  RAW_DIMENSIONS.map((field) => [field[0]!.toUpperCase() + field.slice(1), factionValues]),
);

function row(index: number, motivation: "A" | "B" | "C"): EffectiveBreedSemantics {
  const balanced = ["A", "B", "C"][index % 3]!;
  return {
    schemaVersion: "eidolon-effective-breed-semantics-v4",
    breedId: `BRD_${String(index).padStart(2, "0")}`,
    populationKind: "BEAST",
    researchUnitId: "SPC_TEST",
    personalityId: "P_TEST",
    terrainBroad: ["FOREST"],
    terrainSpecific: ["WOODLAND"],
    dimensions: Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, {
      value: field === "motivation" ? motivation : balanced,
      disposition: "OWNER_POLICY_VALUE",
      policyRef: PERSONALITY_DIMENSION_POLICY,
    }])) as EffectiveBreedSemantics["dimensions"],
  };
}

describe("Breed dimension balance policy", () => {
  it("reaches an exact three-way split with the minimum number of field overrides", () => {
    const input = Array.from({ length: 9 }, (_, index) => row(index, index < 7 ? "A" : index === 7 ? "B" : "C"));
    const result = rebalanceBreedDimensions(input, mapping);

    expect(result.report.totalCivicBreeds).toBe(9);
    expect(result.report.targetPerValue).toBe(3);
    expect(result.report.byField.motivation).toMatchObject({
      before: { A: 7, B: 1, C: 1 },
      after: { A: 3, B: 3, C: 3 },
      changedAssignments: 4,
    });
    expect(result.report.totalChangedAssignments).toBe(4);
    expect(result.changes).toHaveLength(4);
    expect(result.changes.every((change) => change.field === "motivation" && change.before === "A")).toBe(true);

    for (const change of result.changes) {
      expect(result.rows.find((candidate) => candidate.breedId === change.breedId)?.dimensions.motivation).toEqual({
        value: change.after,
        disposition: "OWNER_BALANCED_VALUE",
        policyRef: BREED_DIMENSION_BALANCE_POLICY,
      });
    }
  });

  it("is deterministic regardless of input ordering and does not mutate its input", () => {
    const input = Array.from({ length: 9 }, (_, index) => row(index, index < 7 ? "A" : index === 7 ? "B" : "C"));
    const original = structuredClone(input);
    const forward = rebalanceBreedDimensions(input, mapping);
    const reversed = rebalanceBreedDimensions([...input].reverse(), mapping);

    expect(forward.rows).toEqual(reversed.rows);
    expect(forward.changes).toEqual(reversed.changes);
    expect(input).toEqual(original);
  });

  it("rejects a corpus that cannot be split equally rather than silently approximating it", () => {
    const input = Array.from({ length: 8 }, (_, index) => row(index, "A"));
    expect(() => rebalanceBreedDimensions(input, mapping)).toThrow(/divisible by three/i);
  });
});
