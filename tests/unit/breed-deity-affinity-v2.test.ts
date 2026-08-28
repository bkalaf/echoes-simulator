import { describe, expect, it } from "vitest";
import { DEITIES, SCORE_AXES, type BreedEvidenceProfile, type EvidenceFragment, type ScoreAxis } from "../../src/core/research/breed-deity-affinity.js";
import {
  DEITY_EVIDENCE_PROFILES_V2,
  assessAllDeitiesV2,
  buildSignalFrequencyAudit,
  calibrationLookup,
  frequencyLookup,
  judgeConfidenceV2,
  type PersonalityFamilyAffinity,
} from "../../src/core/research/breed-deity-affinity-v2.js";

function fixture(text = "It is an ecosystem engineer that modifies streams and creates wetland habitat for unrelated species."): BreedEvidenceProfile {
  const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as Record<ScoreAxis, EvidenceFragment[]>;
  const add = (axis: ScoreAxis, fieldPath: string, value: string, basis: string) => fragments[axis].push({ sourceRecordId: "BRD_V2_FIXTURE", sourceScope: "BREED", fieldPath, text: value, authorityWeight: 1, basis });
  add("PERSONALITY_ALIGNMENT", "v4Effective.personalityId", "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION", "PERSONALITY");
  for (const axis of ["BEHAVIOR_ALIGNMENT", "ECOLOGICAL_ALIGNMENT", "SYMBOLIC_ALIGNMENT", "CANONICAL_TEXT_SUPPORT"] as const) add(axis, "canonicalPayload.traits.0.text", text, axis === "ECOLOGICAL_ALIGNMENT" ? "ECOLOGY" : "CANONICAL_TEXT");
  return {
    breedId: "BRD_V2_FIXTURE", breedName: "Fixture", speciesId: "SPC_FIXTURE", speciesName: "Fixture species", populationKind: "BEAST",
    cultureId: null, cultureName: null, groupId: "B00", groupName: "Fixture group", personalityId: "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION",
    personalityFamily: "STEWARDSHIP", dimensions: {}, primitiveBehavior: {}, terrainBroad: ["WETLAND"], terrainSpecific: ["RIVER"], foodBroad: [], foodSpecific: [],
    text, traits: [text], fragments, ecologyAvailable: true,
  };
}

function context(profiles: BreedEvidenceProfile[]) {
  const calibrationRows: PersonalityFamilyAffinity[] = [{ deityName: "Damor", family: "STEWARDSHIP", v2Strength: 54, tier: "MODERATE", semanticJustification: "Stewardship supports habitat creation but does not replace engineering evidence." }];
  const calibrations = calibrationLookup(calibrationRows);
  return { calibrations, frequencies: frequencyLookup(buildSignalFrequencyAudit(profiles, calibrations)) };
}

describe("Breed primary-deity V2 semantic calibration", () => {
  it("defines tiered specificity profiles for every frozen deity", () => {
    expect(Object.keys(DEITY_EVIDENCE_PROFILES_V2)).toHaveLength(27);
    for (const deity of DEITIES) {
      const profile = DEITY_EVIDENCE_PROFILES_V2[deity.deityName];
      expect(profile?.specificityReview.length).toBeGreaterThan(20);
      expect(new Set(profile?.signals.map((signal) => signal.tier))).toEqual(new Set(["DEFINING", "STRONG", "MODERATE", "WEAK", "CONTRADICTORY"]));
      expect(profile?.contradictoryEvidence.length).toBeGreaterThan(0);
    }
  });

  it("deduplicates repeated lexical synonyms from one canonical fact", () => {
    const source = fixture("This freshwater river water cycle supports stream spawning.");
    const { calibrations, frequencies } = context([source]);
    const rillan = assessAllDeitiesV2(source, frequencies, calibrations).find((candidate) => candidate.deityName === "Rillan")!;
    const factClusters = rillan.semanticEvidenceClusters.filter((cluster) => cluster.fieldPath === "canonicalPayload.traits.0.text");
    expect(factClusters.filter((cluster) => cluster.semanticCluster === "freshwater_habitat")).toHaveLength(1);
    expect(factClusters.find((cluster) => cluster.semanticCluster === "freshwater_habitat")?.rawLexicalMatches).toEqual(expect.arrayContaining(["freshwater", "river", "stream"]));
    expect(factClusters.some((cluster) => cluster.semanticCluster === "water_generic")).toBe(false);
  });

  it("bounds cross-axis reuse for one source fact while retaining every informed axis", () => {
    const source = fixture(); const { calibrations, frequencies } = context([source]);
    const damor = assessAllDeitiesV2(source, frequencies, calibrations).find((candidate) => candidate.deityName === "Damor")!;
    const engineering = damor.semanticEvidenceClusters.find((cluster) => cluster.semanticCluster === "ecosystem_engineering")!;
    expect(engineering.axesInformed.length).toBeGreaterThan(1);
    const factors = engineering.axesInformed.map((axis) => engineering.crossAxisFactors[axis]!);
    expect(factors[0]).toBe(1);
    for (let index = 1; index < factors.length; index += 1) expect(factors[index]).toBeLessThan(factors[index - 1]!);
  });

  it("compares all 27 deities without PopulationKind or pantheon scoring", () => {
    const source = fixture(); const { calibrations, frequencies } = context([source]);
    const expected = assessAllDeitiesV2(source, frequencies, calibrations).map((candidate) => [candidate.deityName, candidate.weightedScoreExact]);
    expect(expected).toHaveLength(27);
    expect(expected[0]?.[0]).toBe("Damor");
    for (const populationKind of ["HUMAN", "BEAST", "PET", "MYTHOS"] as const) expect(assessAllDeitiesV2({ ...source, populationKind }, frequencies, calibrations).map((candidate) => [candidate.deityName, candidate.weightedScoreExact])).toEqual(expected);
  });

  it("keeps signal specificity bounded and evidence-free ties unresolved", () => {
    const source = fixture(); const { calibrations, frequencies } = context([source]);
    for (const row of frequencies.values()) expect(row.specificityFactor).toBeGreaterThanOrEqual(0.72);
    for (const row of frequencies.values()) expect(row.specificityFactor).toBeLessThanOrEqual(1.25);
    const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as Record<ScoreAxis, EvidenceFragment[]>;
    const generic = { sourceRecordId: source.breedId, sourceScope: "BREED" as const, fieldPath: "canonicalPayload.text", text: "Canonical identity without a deity-domain fact.", authorityWeight: 1, basis: "CANONICAL_TEXT" };
    fragments.SYMBOLIC_ALIGNMENT.push(generic); fragments.CANONICAL_TEXT_SUPPORT.push(generic);
    const unresolved = { ...source, personalityId: null, personalityFamily: null, fragments, ecologyAvailable: false };
    const unresolvedContext = context([unresolved]); const candidates = assessAllDeitiesV2(unresolved, unresolvedContext.frequencies, unresolvedContext.calibrations);
    expect(judgeConfidenceV2(unresolved, candidates).confidence).toBe("REVIEW_REQUIRED");
  });
});
