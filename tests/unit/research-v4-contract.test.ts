import { describe, expect, it } from "vitest";
import {
  PERSONALITY_DIMENSION_POLICY,
  reconcileResearchUnitIndex,
  validateBatchCompleteness,
  validateEffectiveBreedSemantics,
  validateResearchEvidence,
  validateV4Authority,
} from "../../src/core/research/v4-contract.js";

const completeDimensions = Object.fromEntries([
  "motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode",
  "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture",
].map((field) => [field, { value: "TOKEN", disposition: "OWNER_POLICY_VALUE", policyRef: PERSONALITY_DIMENSION_POLICY }]));

describe("V4 research architecture anti-shortcut gates", () => {
  it("rejects civic critical nulls, invalid personalities, and dimensions without policy provenance", () => {
    const base = { schemaVersion: "eidolon-effective-breed-semantics-v4", breedId: "BRD_TEST", populationKind: "BEAST", researchUnitId: "SPC_TEST", personalityId: "P_VALID", terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], dimensions: completeDimensions };
    expect(() => validateEffectiveBreedSemantics({ ...base, personalityId: null }, new Set(["P_VALID"]))).toThrow(/personalityId/i);
    expect(() => validateEffectiveBreedSemantics({ ...base, personalityId: "P_UNKNOWN" }, new Set(["P_VALID"]))).toThrow(/Personality Expression/i);
    expect(() => validateEffectiveBreedSemantics({ ...base, dimensions: { ...completeDimensions, motivation: { value: "TOKEN", disposition: "OWNER_POLICY_VALUE", policyRef: null } } }, new Set(["P_VALID"]))).toThrow(/policyRef/i);
  });

  it("rejects consolidation-generated evidence and generic fallback sources", () => {
    const evidence = { evidenceId: "E1", researchUnitId: "SPC_TEST", targetField: "terrainBroad", batchId: "R01_B01", journalEntryId: "J1", researchedAt: "2026-08-19T10:00:00Z", sourceOpened: true, sourceUrl: "https://animaldiversity.org/", sourceTitle: "Animal Diversity Web", locator: "homepage", boundedContext: "homepage", sourceFact: "generic", normalizationBridge: "generic", generatedBy: "CONSOLIDATION" };
    expect(() => validateResearchEvidence(evidence)).toThrow(/consolidation/i);
    expect(() => validateResearchEvidence({ ...evidence, generatedBy: "BATCH_RESEARCH" })).toThrow(/generic fallback/i);
  });

  it("requires exact unit and Breed coverage for a batch", () => {
    expect(() => validateBatchCompleteness({ unitIds: ["U1", "U2"], breedIds: ["B1", "B2"] }, { unitIds: ["U1"], effectiveBreedIds: ["B1", "B2"] })).toThrow(/unit/i);
    expect(() => validateBatchCompleteness({ unitIds: ["U1"], breedIds: ["B1", "B2"] }, { unitIds: ["U1"], effectiveBreedIds: ["B1"] })).toThrow(/Breed/i);
  });

  it("cannot use retired V3 as V4 authority", () => {
    expect(() => validateV4Authority({ schemaVersion: "eidolon-breed-research-v3-manifest", status: "RETIRED_FALSE_COMPLETION" })).toThrow(/retired/i);
  });

  it("reconciles unit identities without silently substituting drift", () => {
    expect(() => reconcileResearchUnitIndex({ units: [{ unitType: "BEAST_SPECIES", unitId: "SPC_A", populationKind: "BEAST", initialRegion: "R01", groupIds: ["B01"], breedIds: ["BRD_A"] }] }, [{ breedId: "BRD_A", populationKind: "BEAST", speciesId: "SPC_B", cultureId: null, groupId: "B01" }], [{ groupId: "B01", regionId: "R01" }])).toThrow(/drift/i);
  });
});
