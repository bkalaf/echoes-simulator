import { describe, expect, it } from "vitest";
import {
  AXIS_WEIGHTS,
  DEITIES,
  SCORE_AXES,
  assessAllDeities,
  judgeConfidence,
  type BreedEvidenceProfile,
  type EvidenceFragment,
  type ScoreAxis,
} from "../../src/core/research/breed-deity-affinity.js";

function fixture(): BreedEvidenceProfile {
  const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as unknown as Record<ScoreAxis, EvidenceFragment[]>;
  const add = (axis: ScoreAxis, fieldPath: string, text: string, basis: string) => fragments[axis].push({ sourceRecordId: "BRD_FIXTURE", sourceScope: "BREED", fieldPath, text, authorityWeight: 1, basis });
  add("PERSONALITY_ALIGNMENT", "v4Effective.personalityId", "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION", "PERSONALITY");
  add("BEHAVIOR_ALIGNMENT", "canonicalPayload.traits.0.text", "It modifies streams and creates habitat where unrelated species shelter.", "BEHAVIOR");
  add("ECOLOGICAL_ALIGNMENT", "canonicalPayload.traits.0.text", "It is an ecosystem engineer that creates wetland habitat.", "ECOLOGY");
  add("SYMBOLIC_ALIGNMENT", "canonicalPayload.text", "Its defining pattern is stewardship through habitat construction.", "CANONICAL_TEXT");
  add("CANONICAL_TEXT_SUPPORT", "canonicalPayload.text", "Its defining pattern is stewardship through habitat construction.", "CANONICAL_TEXT");
  return {
    breedId: "BRD_FIXTURE", breedName: "Fixture", speciesId: "SPC_FIXTURE", speciesName: "Fixture species", populationKind: "BEAST",
    cultureId: null, cultureName: null, groupId: "B00", groupName: "Fixture group", personalityId: "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION",
    personalityFamily: "STEWARDSHIP", dimensions: {}, primitiveBehavior: { aggression: 1, territorial: 2, parental: 3, social: 2, nesting: 3, intelligence: 4 },
    terrainBroad: ["WETLAND"], terrainSpecific: ["RIVER"], foodBroad: [], foodSpecific: [], text: "Creates habitat.", traits: ["Ecosystem engineer."], fragments, ecologyAvailable: true,
  };
}

describe("Breed primary-deity non-causal classification", () => {
  it("locks exactly 27 canonical deities in three equal pantheons", () => {
    expect(DEITIES).toHaveLength(27);
    expect(new Set(DEITIES.map((deity) => deity.deityName)).size).toBe(27);
    for (const pantheon of ["NINEFOLD_HEART", "NINEFOLD_WILD", "NINEFOLD_VEIL"]) expect(DEITIES.filter((deity) => deity.pantheon === pantheon)).toHaveLength(9);
  });

  it("compares all deities, preserves the required weights, and selects domain evidence", () => {
    expect(AXIS_WEIGHTS).toEqual({ PERSONALITY_ALIGNMENT: 30, BEHAVIOR_ALIGNMENT: 25, ECOLOGICAL_ALIGNMENT: 20, SYMBOLIC_ALIGNMENT: 15, CANONICAL_TEXT_SUPPORT: 10 });
    const candidates = assessAllDeities(fixture());
    expect(candidates).toHaveLength(27);
    expect(candidates[0]?.deityName).toBe("Damor");
    for (const candidate of candidates) expect(Object.values(candidate.effectiveWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
  });

  it("does not use PopulationKind or pantheon correspondence as a score", () => {
    const source = fixture();
    const expected = assessAllDeities(source).map((candidate) => [candidate.deityName, candidate.weightedScoreExact]);
    for (const populationKind of ["HUMAN", "BEAST", "PET", "MYTHOS"] as const) {
      const scores = assessAllDeities({ ...source, populationKind }).map((candidate) => [candidate.deityName, candidate.weightedScoreExact]);
      expect(scores).toEqual(expected);
    }
  });

  it("keeps evidence-free and inseparable results unresolved", () => {
    const source = fixture();
    const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as unknown as Record<ScoreAxis, EvidenceFragment[]>;
    const generic = { sourceRecordId: "BRD_FIXTURE", sourceScope: "BREED" as const, fieldPath: "canonicalPayload.text", text: "The canonical record contains identity evidence but no deity-domain signal.", authorityWeight: 1, basis: "CANONICAL_TEXT" };
    fragments.SYMBOLIC_ALIGNMENT.push(generic); fragments.CANONICAL_TEXT_SUPPORT.push(generic);
    const unresolved = { ...source, personalityId: null, personalityFamily: null, fragments, ecologyAvailable: false };
    const candidates = assessAllDeities(unresolved);
    expect(judgeConfidence(unresolved, candidates).confidence).toBe("REVIEW_REQUIRED");
  });
});
