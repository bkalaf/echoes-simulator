import { describe, expect, it } from "vitest";
import { auditV4Shard, type AuditBatchArtifacts } from "../../src/core/research/v4-audit.js";
import { buildV4BatchArtifacts } from "../../src/core/research/v4-batch.js";

const dimensions = {
  motivation: "RECIPROCAL", operatingStyle: "TEAMWORK", structureOrientation: "ORDERED", administrationMode: "CENTRALIZED",
  ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY", legitimacyBasis: "CHARTERED", authoritySource: "ELECTION",
  loquacity: "LIGHT_BANTER", emotionalTemperature: "COMPOSED", outlookOrientation: "OPTIMISTIC", collaborativePosture: "HELPFUL",
};
const unit = { unitType: "BEAST_SPECIES" as const, unitId: "SPC_A", populationKind: "BEAST" as const, initialRegion: "R01", groupIds: ["B01"], breedIds: ["BRD_A"] };
const manifest = { batchId: "R01_B01", regionId: "R01", units: [unit] };
const journals = (["personalityId", "terrainBroad", "terrainSpecific"] as const).map((targetField) => ({
  journalEntryId: `JRN_${targetField}`, batchId: "R01_B01", timestamp: "2026-08-19T10:00:00Z", query: "exact species A behavior and habitat",
  searchResultChosen: "Species A account", actualOpenedUrl: "https://example.org/species/a", title: "Species A", organization: "Example Museum",
  publisher: "Example Museum", locator: `${targetField} section, paragraph 2`, boundedContext: `The exact Species A account documents bounded ${targetField} context.`,
  sourceFact: `Species A has a direct documented ${targetField} fact.`, targetUnitId: "SPC_A", targetField, accepted: true, rejectionReason: null, sourceOpened: true,
}));
const decision = { batchId: "R01_B01", researchUnitId: "SPC_A", personalityId: "P_A", personalityBridge: "Direct observable behavior maps narrowly to P_A; no inward psychology is inferred.",
  terrainBroad: ["COASTAL"], terrainSpecific: ["ESTUARY"], journalEntryIds: { personalityId: "JRN_personalityId", terrainBroad: "JRN_terrainBroad", terrainSpecific: "JRN_terrainSpecific" }, status: "SIMULATION_READY" as const };
const profile = { policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1" as const, personalityId: "P_A", family: "TEST", dimensions, overriddenFields: [] };
const built = buildV4BatchArtifacts({
  manifest, journals, decisions: [decision], effectiveProfiles: [profile], allCivicBreedIds: ["BRD_A"], totalInitialPopulation: 10n,
  propertyMapping: {
    AdministrationMode: { CONCORD: "CENTRALIZED", SCHISM: "DISTRIBUTED", RUIN: "DELEGATED" }, StructureOrientation: { CONCORD: "ORDERED", SCHISM: "NEUTRAL", RUIN: "CHAOS" },
    OperatingStyle: { CONCORD: "TEAMWORK", SCHISM: "SITUATIONAL", RUIN: "SOLO" }, Motivation: { CONCORD: "ALTRUISTIC", SCHISM: "RECIPROCAL", RUIN: "SELFISH" },
    AuthoritySource: { CONCORD: "APPOINTMENT", SCHISM: "ELECTION", RUIN: "DIVINE_MANDATE" }, LegitimacyBasis: { CONCORD: "CHARTERED", SCHISM: "ANCESTRAL", RUIN: "MARTIAL" },
    AllocationMode: { CONCORD: "PLANNED", SCHISM: "CUSTOMARY", RUIN: "MARKET" }, OwnershipMode: { CONCORD: "SINGLE_ENTITY", SCHISM: "SHARED_TITLE", RUIN: "COMMON_USE" },
    Loquacity: { CONCORD: "TALKATIVE", SCHISM: "LIGHT_BANTER", RUIN: "TO_THE_POINT" }, EmotionalTemperature: { CONCORD: "COMPOSED", SCHISM: "JOYFUL", RUIN: "IRRITABLE" },
    OutlookOrientation: { CONCORD: "OPTIMISTIC", SCHISM: "NEUTRAL", RUIN: "PESSIMISTIC" }, CollaborativePosture: { CONCORD: "HELPFUL", SCHISM: "WITHHOLDING", RUIN: "JUST_ENOUGH" },
  }, politicalRows: [{ administrationMode: "CENTRALIZED", legitimacyBasis: "CHARTERED", authoritySource: "ELECTION", politicalForm: "TEST_POLITY" }],
  economicRows: [{ ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY", economicForm: "TEST_ECONOMY" }],
});
const batch: AuditBatchArtifacts = { batchId: "R01_B01", manifestUnits: [unit], journals, decisions: [decision], unitResults: built.unitResults, sources: built.sources, citations: built.citations, evidence: built.evidence, inheritanceEdges: built.inheritanceEdges, effectiveBreeds: built.effectiveBreeds };
const shard = { auditShardId: "AUDIT_01", unitCount: 1, regions: ["R01"], units: [{ unitType: unit.unitType, unitId: unit.unitId, initialRegion: unit.initialRegion }] };

describe("V4 independent audit", () => {
  it("passes a complete, aligned evidence and inheritance graph", () => {
    const result = auditV4Shard({ shard, batches: [batch], personalityIds: new Set(["P_A"]), generatedAt: "2026-08-19T12:00:00Z" });
    expect(result).toMatchObject({ status: "PASS", counts: { auditedUnits: 1, passingUnits: 1, evidenceChains: 3, passingEvidenceChains: 3, inheritedBreeds: 1 } });
    expect(result.units[0]?.fields.every((field) => field.status === "PASS")).toBe(true);
  });

  it("fails exact subject drift and generic active sources", () => {
    const drifted: AuditBatchArtifacts = { ...batch, citations: batch.citations.map((row) => ({ ...row, subjectAlignment: "GENERIC_ANIMAL" })), sources: batch.sources.map((row) => ({ ...row, title: "Homepage", stableUrlOrIdentifier: "https://example.org/" })), journals: journals.map((row) => ({ ...row, actualOpenedUrl: "https://example.org/", locator: "Homepage" })) };
    const result = auditV4Shard({ shard, batches: [drifted], personalityIds: new Set(["P_A"]), generatedAt: "2026-08-19T12:00:00Z" });
    expect(result.status).toBe("FAIL");
    expect(result.units[0]?.fields.some((field) => field.messages.some((message) => /homepage/i.test(message)))).toBe(true);
    expect(result.units[0]?.fields.some((field) => field.messages.some((message) => /EXACT_SPECIES/.test(message)))).toBe(true);
  });

  it("fails when exact Breed inheritance is broadened", () => {
    const broadened: AuditBatchArtifacts = { ...batch, inheritanceEdges: [...batch.inheritanceEdges, { ...batch.inheritanceEdges[0]!, breedId: "BRD_UNRELATED" }] };
    const result = auditV4Shard({ shard, batches: [broadened], personalityIds: new Set(["P_A"]), generatedAt: "2026-08-19T12:00:00Z" });
    expect(result.units[0]).toMatchObject({ status: "FAIL_INHERITANCE", inheritance: { status: "FAIL_INHERITANCE" } });
  });
});
