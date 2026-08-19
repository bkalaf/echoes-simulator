import { describe, expect, it } from "vitest";
import { buildV4BatchArtifacts } from "../../src/core/research/v4-batch.js";

const dimensions = {
  motivation: "RECIPROCAL", operatingStyle: "TEAMWORK", structureOrientation: "ORDERED",
  administrationMode: "CENTRALIZED", ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY",
  legitimacyBasis: "CHARTERED", authoritySource: "ELECTION", loquacity: "LIGHT_BANTER",
  emotionalTemperature: "COMPOSED", outlookOrientation: "OPTIMISTIC", collaborativePosture: "HELPFUL",
};

const manifest = {
  batchId: "R01_B01", regionId: "R01", units: [
    { unitType: "BEAST_SPECIES" as const, unitId: "SPC_A", populationKind: "BEAST" as const, initialRegion: "R01", groupIds: ["B01"], breedIds: ["BRD_A"] },
  ],
};

const journals = (["personalityId", "terrainBroad", "terrainSpecific"] as const).map((targetField) => ({
  journalEntryId: `JRN_${targetField}`, batchId: "R01_B01", timestamp: "2026-08-19T10:00:00Z",
  query: "exact species behavior habitat", searchResultChosen: "Exact species account",
  actualOpenedUrl: "https://example.org/species/a", title: "Species A", organization: "Example Museum",
  publisher: "Example Museum", locator: `${targetField} section`, boundedContext: `bounded ${targetField} context`,
  sourceFact: `direct ${targetField} fact`, targetUnitId: "SPC_A", targetField, accepted: true,
  rejectionReason: null, sourceOpened: true,
}));

const decisions = [{
  batchId: "R01_B01", researchUnitId: "SPC_A", personalityId: "P_A",
  personalityBridge: "Direct observable behavior maps narrowly to P_A.", terrainBroad: ["COASTAL"],
  terrainSpecific: ["ESTUARY"], journalEntryIds: {
    personalityId: "JRN_personalityId", terrainBroad: "JRN_terrainBroad", terrainSpecific: "JRN_terrainSpecific",
  }, status: "SIMULATION_READY" as const,
}];

const input = {
  manifest, journals, decisions,
  effectiveProfiles: [{ policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1" as const, personalityId: "P_A", family: "TEST", dimensions, overriddenFields: [] }],
  allCivicBreedIds: ["BRD_A"], totalInitialPopulation: 10n,
  propertyMapping: {
    AdministrationMode: { CONCORD: "CENTRALIZED", SCHISM: "DISTRIBUTED", RUIN: "DELEGATED" },
    StructureOrientation: { CONCORD: "ORDERED", SCHISM: "NEUTRAL", RUIN: "CHAOS" },
    OperatingStyle: { CONCORD: "TEAMWORK", SCHISM: "SITUATIONAL", RUIN: "SOLO" },
    Motivation: { CONCORD: "ALTRUISTIC", SCHISM: "RECIPROCAL", RUIN: "SELFISH" },
    AuthoritySource: { CONCORD: "APPOINTMENT", SCHISM: "ELECTION", RUIN: "DIVINE_MANDATE" },
    LegitimacyBasis: { CONCORD: "CHARTERED", SCHISM: "ANCESTRAL", RUIN: "MARTIAL" },
    AllocationMode: { CONCORD: "PLANNED", SCHISM: "CUSTOMARY", RUIN: "MARKET" },
    OwnershipMode: { CONCORD: "SINGLE_ENTITY", SCHISM: "SHARED_TITLE", RUIN: "COMMON_USE" },
    Loquacity: { CONCORD: "TALKATIVE", SCHISM: "LIGHT_BANTER", RUIN: "TO_THE_POINT" },
    EmotionalTemperature: { CONCORD: "COMPOSED", SCHISM: "JOYFUL", RUIN: "IRRITABLE" },
    OutlookOrientation: { CONCORD: "OPTIMISTIC", SCHISM: "NEUTRAL", RUIN: "PESSIMISTIC" },
    CollaborativePosture: { CONCORD: "HELPFUL", SCHISM: "WITHHOLDING", RUIN: "JUST_ENOUGH" },
  },
  politicalRows: [{ administrationMode: "CENTRALIZED", legitimacyBasis: "CHARTERED", authoritySource: "ELECTION", politicalForm: "TEST_POLITY" }],
  economicRows: [{ ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY", economicForm: "TEST_ECONOMY" }],
};

const humanManifest = {
  batchId: "R01_B02", regionId: "R01", units: [
    { unitType: "HUMAN_CULTURE" as const, unitId: "CLT_A", populationKind: "HUMAN" as const, initialRegion: "R01", groupIds: ["H01"], breedIds: ["BRD_H"] },
  ],
};

const humanJournals = journals.map((row) => ({
  ...row,
  journalEntryId: row.journalEntryId.replace("JRN_", "JRN_H_"),
  batchId: "R01_B02",
  actualOpenedUrl: row.targetField === "personalityId" ? "https://example.org/culture/history" : "https://example.org/culture/homeland",
  targetUnitId: "CLT_A",
}));

const humanDecision = [{
  ...decisions[0]!, batchId: "R01_B02", researchUnitId: "CLT_A",
  inferenceClassification: "EIDOLON_AUTHORED_INFERENCE" as const,
  journalEntryIds: {
    personalityId: "JRN_H_personalityId", terrainBroad: "JRN_H_terrainBroad", terrainSpecific: "JRN_H_terrainSpecific",
  },
}];

describe("V4 Region batch finalization", () => {
  it("materializes exact research, evidence, inheritance, dimensions, and simulation readiness", () => {
    const built = buildV4BatchArtifacts(input);
    expect(built.unitResults).toHaveLength(1);
    expect(built.sources).toHaveLength(1);
    expect(built.citations).toHaveLength(3);
    expect(built.evidence).toHaveLength(3);
    expect(built.inheritanceEdges).toHaveLength(1);
    expect(built.effectiveBreeds).toHaveLength(1);
    expect(Object.keys(built.effectiveBreeds[0]!.dimensions)).toHaveLength(12);
    expect(built.report).toMatchObject({ status: "PASS", counts: { manifestUnits: 1, manifestBreeds: 1 }, criticalNulls: 0, unresolvedCriticalFields: 0, invalidPersonalityIds: 0 });
    for (const preview of Object.values(built.report.regionPreview.worlds)) {
      expect(preview.totalPopulation).toBe("10");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.dominantFaction).not.toBeNull();
      expect(preview.politicalForm).toBe("TEST_POLITY");
      expect(preview.economicForm).toBe("TEST_ECONOMY");
    }
  });

  it("fails closed when any manifest unit or critical journal field is missing", () => {
    expect(() => buildV4BatchArtifacts({ ...input, decisions: [] })).toThrow(/coverage|missing/i);
    expect(() => buildV4BatchArtifacts({ ...input, journals: journals.slice(0, 2) })).toThrow(/journal|terrainSpecific/i);
  });

  it("preserves Human authored inference and per-field sources without treating it as direct psychology", () => {
    const built = buildV4BatchArtifacts({
      ...input, manifest: humanManifest, journals: humanJournals, decisions: humanDecision,
      allCivicBreedIds: ["BRD_H"],
    });
    expect(built.sources).toHaveLength(2);
    expect(built.citations.find((row) => row.citationId === "CIT_JRN_H_personalityId")?.claimAlignment).toBe("EIDOLON_AUTHORED_INFERENCE");
    expect(built.citations.filter((row) => row.citationId !== "CIT_JRN_H_personalityId").every((row) => row.claimAlignment === "ACCEPTED_DIRECT_EVIDENCE")).toBe(true);
  });

  it("uses cumulative effective Breeds for the Region preview while keeping batch counts exact", () => {
    const prior = buildV4BatchArtifacts(input).effectiveBreeds[0]!;
    const built = buildV4BatchArtifacts({
      ...input,
      manifest: { ...manifest, units: [{ ...manifest.units[0]!, unitId: "SPC_B", breedIds: ["BRD_B"] }] },
      journals: journals.map((row) => ({ ...row, targetUnitId: "SPC_B" })),
      decisions: [{ ...decisions[0]!, researchUnitId: "SPC_B" }],
      allCivicBreedIds: ["BRD_A", "BRD_B"], totalInitialPopulation: 10n,
      regionEffectiveBreeds: [prior],
    });
    expect(built.report.counts.effectiveBreeds).toBe(1);
    for (const preview of Object.values(built.report.regionPreview.worlds)) expect(preview.totalPopulation).toBe("10");
  });

  it("requires explicit authored inference classification for Human Culture decisions", () => {
    expect(() => buildV4BatchArtifacts({
      ...input, manifest: humanManifest, journals: humanJournals,
      decisions: [{ ...humanDecision[0]!, inferenceClassification: "DIRECT_BEHAVIOR_MAPPING" }],
      allCivicBreedIds: ["BRD_H"],
    })).toThrow(/authored inference/i);
  });
});
