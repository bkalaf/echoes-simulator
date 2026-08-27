import { describe, expect, it } from "vitest";
import {
  importSubmittedResearchCorpus,
  type CorpusImportOptions,
  type SubmittedResearchRecord,
} from "../../src/core/research/corpus-import.js";

const allTwoDerived = {
  motivation: { mean: 2, anchor: 2, value: "RECIPROCAL", tieBreakReason: null },
  operatingStyle: { mean: 2, anchor: 2, value: "SITUATIONAL", tieBreakReason: null },
  structureOrientation: { mean: 2, anchor: 2, value: "NEUTRAL", tieBreakReason: null },
  administrationMode: { mean: 2, anchor: 2, value: "DELEGATED", tieBreakReason: null },
  ownershipMode: { mean: 2, anchor: 2, value: "SHARED_TITLE", tieBreakReason: null },
  allocationMode: { mean: 2, anchor: 2, value: "PLANNED", tieBreakReason: null },
  legitimacyBasis: { mean: 2, anchor: 2, value: "ANCESTRAL", tieBreakReason: null },
  authoritySource: { mean: 2, anchor: 2, value: "APPOINTMENT", tieBreakReason: null },
  loquacity: { mean: 2, anchor: 2, value: "LIGHT_BANTER", tieBreakReason: null },
  emotionalTemperature: { mean: 2, anchor: 2, value: "COMPOSED", tieBreakReason: null },
  outlookOrientation: { mean: 2, anchor: 2, value: "NEUTRAL", tieBreakReason: null },
  collaborativePosture: { mean: 2, anchor: 2, value: "JUST_ENOUGH", tieBreakReason: null },
  aggressive: { mean: 2, anchor: 2, value: "NEUTRAL", tieBreakReason: null },
  socialEffort: { mean: 2, anchor: 2, value: "INFRASTRUCTURE", tieBreakReason: null },
  intellectualEffort: { mean: 2, anchor: 2, value: "BALANCED", tieBreakReason: null },
};

function semantic(recordType: SubmittedResearchRecord["recordType"], recordId: string): Record<string, unknown> {
  return {
    schemaVersion: "eidolon-record-classification-v1",
    recordType,
    recordId,
    name: recordId,
    text: "First substantive wiki paragraph for the exact record.\n\nSecond substantive wiki paragraph for the exact record.",
    geographicOrigin: null,
    presentation: { accent: null, appearance: "Supported appearance.", clothing: null, architecture: null },
    traits: [{ text: "Distinctive supported trait.", historicalFact: null, worldbuildingInterpretation: null, evidenceRefs: ["EV_TEST"] }],
    terrainBroad: ["FOREST"],
    terrainSpecific: ["WOODLAND"],
    foodBroad: ["PLANT"],
    foodSpecific: ["LEAVES"],
    primitiveBehavior: Object.fromEntries(["aggression", "territorial", "parental", "social", "nesting", "intelligence"].map((field) => [field, { score: 2, evidenceRefs: ["EV_TEST"], defaulted: true, rationale: "Neutral evidence." }])),
    derived: structuredClone(allTwoDerived),
    politicalForm: "FEUDAL_ORDER",
    economicForm: "SYNDICATE_CARTEL",
    factionScores: { CONCORD: 6, SCHISM: 14, RUIN: 4 },
    faction: "SCHISM",
    factionTie: [],
    parentInheritanceDecisions: [],
    sources: [{ sourceId: "SRC_TEST", title: "Test source", authorOrOrganization: "Test", publisher: null, urlOrIdentifier: "test://source", opened: true }],
    evidence: [{ evidenceId: "EV_TEST", sourceId: "SRC_TEST", targetField: "text", subjectAlignment: "EXACT_RECORD", locator: "test", boundedContext: "test", sourceFact: "test", normalizationOrInference: "none" }],
    defaultedFields: [],
    canonicalConflicts: [],
    status: "PASS",
  };
}

function submitted(ordinal: number, recordType: SubmittedResearchRecord["recordType"] = "TAXONOMY", id = `TAX_FAMILY_TEST_${ordinal}`): SubmittedResearchRecord {
  const rawPayload = semantic(recordType, id);
  if (recordType === "TAXONOMY") Object.assign(rawPayload, { taxonomyType: ordinal === 1 ? "KINGDOM" : "FAMILY" });
  if (recordType === "SPECIES_GROUP") Object.assign(rawPayload, { groupId: id, speciesKind: "BEAST" });
  if (recordType === "SPECIES") Object.assign(rawPayload, { speciesKind: "BEAST", taxonomyDependencyIds: [] });
  if (recordType === "BREED") Object.assign(rawPayload, {
    breedId: id,
    speciesId: "SPC_TEST",
    cultureId: null,
    parentBreedId: null,
    populationKind: "BEAST",
    groupId: "B01",
    personalityId: "PERSONALITY_TEST",
    dependencyRecordIds: ["SPC_TEST", "B01"],
  });
  return {
    ordinal,
    recordType,
    recordId: id,
    sourceBatch: Math.ceil(ordinal / 1_000),
    sourceArchive: `BATCH_${String(Math.ceil(ordinal / 1_000)).padStart(2, "0")}.zip`,
    sourceFilename: `records/${String(ordinal).padStart(4, "0")}_${id}.json`,
    sourceSha256: `sha-${ordinal}`,
    rawPayload,
    reviewFilename: `reviews/${String(ordinal).padStart(4, "0")}_${id}.review.json`,
    rawReviewPayload: { recordType, recordId: id, verdict: "PASS", findings: [] },
    evidenceFilename: `evidence/${String(ordinal).padStart(4, "0")}_${id}.evidence.json`,
    rawEvidencePayload: { recordType, recordId: id, evidence: rawPayload.evidence },
    sourcesFilename: `sources/${String(ordinal).padStart(4, "0")}_${id}.sources.json`,
    rawSourcesPayload: { recordType, recordId: id, sources: rawPayload.sources },
  };
}

const options: CorpusImportOptions = {
  corpusVersion: "TEST_CORPUS_V1",
  sourcePackage: "test.zip",
  sourcePackageSha256: "a".repeat(64),
  importedAt: "2026-08-25T00:00:00.000Z",
  applicationVersion: "0.1.0",
  schemaVersion: "eidolon-research-corpus-import-v1",
  expectedRecordCounts: { TAXONOMY: 0, SPECIES: 0, CULTURE: 0, SPECIES_GROUP: 0, BREED: 0 },
  expectedOrdinalStart: 1,
  expectedOrdinalEnd: 0,
  externalDependencyIds: new Set(["SPC_TEST", "B01"]),
  personalityIds: new Set(["PERSONALITY_TEST"]),
  baselineCanonicalById: new Map(),
};

describe("non-blocking research corpus import", () => {
  it("accounts for all 6,011 records when one malformed Breed is quarantined", () => {
    const records = Array.from({ length: 6_011 }, (_, index) => submitted(index + 1));
    records[4_000] = submitted(4_001, "BREED", "BRD_MALFORMED");
    (records[4_000]!.rawPayload.primitiveBehavior as Record<string, { score: number }>).aggression!.score = 9;
    const result = importSubmittedResearchCorpus(records, {
      ...options,
      expectedRecordCounts: { TAXONOMY: 6_010, SPECIES: 0, CULTURE: 0, SPECIES_GROUP: 0, BREED: 1 },
      expectedOrdinalEnd: 6_011,
    });
    expect(result.ledger).toHaveLength(6_011);
    expect(result.reconciliation).toHaveLength(6_011);
    expect(result.ledger.filter((row) => row.canonicalMaterialized)).toHaveLength(6_010);
    expect(result.ledger.find((row) => row.recordId === "BRD_MALFORMED")?.importDisposition).toBe("QUARANTINED_SCHEMA_ERROR");
    expect(result.overallStatus).toBe("COMPLETED_WITH_BLOCKERS");
  }, 10_000);

  it("reports an invalid enum and completes without coercing or losing raw input", () => {
    const record = submitted(1);
    record.rawPayload.terrainBroad = ["NEAREST_FOREST"];
    const result = importSubmittedResearchCorpus([record], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1 });
    const ledger = result.ledger[0]!;
    expect(result.findings.some((finding) => finding.code === "INVALID_ENUM" && finding.submittedValue === "NEAREST_FOREST")).toBe(true);
    expect(ledger.rawPayload.terrainBroad).toEqual(["NEAREST_FOREST"]);
    expect((ledger.canonicalPayload?.terrainBroad as string[])).toEqual([]);
    expect(result.overallStatus).toBe("COMPLETED_WITH_BLOCKERS");
  });

  it("defers a missing parent relationship and still materializes safe fields", () => {
    const record = submitted(1);
    record.rawPayload.parentInheritanceDecisions = [{ parentRecordId: "TAX_ORDER_MISSING", field: "text", decision: "NARROW", rationale: "Explicit parent." }];
    const result = importSubmittedResearchCorpus([record], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1 });
    expect(result.ledger[0]?.importDisposition).toBe("DEFERRED_RELATIONSHIP");
    expect(result.ledger[0]?.canonicalMaterialized).toBe(true);
    expect(result.findings.some((finding) => finding.code === "MISSING_DEPENDENCY")).toBe(true);
  });

  it("preserves and quarantines a failed review without aborting peers", () => {
    const failed = submitted(1);
    failed.rawReviewPayload = { recordType: "TAXONOMY", recordId: failed.recordId, verdict: "FAIL", findings: [{ severity: "BLOCKER", code: "FAILED_EXACT_REVIEW", field: "text", message: "Unsafe.", requiredFix: "Research again." }] };
    const result = importSubmittedResearchCorpus([failed, submitted(2)], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 2 }, expectedOrdinalEnd: 2 });
    expect(result.ledger[0]?.importDisposition).toBe("QUARANTINED_REVIEW_FAILURE");
    expect(result.ledger[0]?.rawPayload).toEqual(failed.rawPayload);
    expect(result.ledger[1]?.canonicalMaterialized).toBe(true);
    expect(result.overallStatus).toBe("COMPLETED_WITH_BLOCKERS");
  });

  it("recomputes a derived mismatch from primitive authority and reports a warning", () => {
    const record = submitted(1);
    ((record.rawPayload.derived as Record<string, { value: string }>).motivation!).value = "SELFISH";
    const result = importSubmittedResearchCorpus([record], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1 });
    expect(result.findings.some((finding) => finding.code === "DERIVED_VALUE_MISMATCH" && finding.field === "derived.motivation.value")).toBe(true);
    expect(((result.ledger[0]?.canonicalPayload?.derived as Record<string, { value: string }>).motivation!).value).toBe("RECIPROCAL");
    expect(result.ledger[0]?.importDisposition).toBe("IMPORTED_WITH_WARNINGS");
  });

  it("is idempotent and can recover a corrected quarantined record", () => {
    const invalid = submitted(1);
    (invalid.rawPayload.primitiveBehavior as Record<string, { score: number }>).aggression!.score = -1;
    const first = importSubmittedResearchCorpus([invalid], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1 });
    const same = importSubmittedResearchCorpus([invalid], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1, previousLedger: first.ledger });
    expect(same.ledger).toHaveLength(1);
    expect(same.ledger[0]?.idempotencyStatus).toBe("UNCHANGED");

    const fixed = submitted(1);
    const recovered = importSubmittedResearchCorpus([fixed], { ...options, expectedRecordCounts: { ...options.expectedRecordCounts, TAXONOMY: 1 }, expectedOrdinalEnd: 1, previousLedger: first.ledger });
    expect(recovered.ledger[0]?.idempotencyStatus).toBe("RECOVERED_AND_IMPORTED");
    expect(recovered.ledger[0]?.canonicalMaterialized).toBe(true);
  });

  it("audits exact before/after values and never silently drops records", () => {
    const record = submitted(1, "BREED", "BRD_CHANGED");
    const baseline = { ...record.rawPayload, terrainBroad: ["DESERT"] };
    const result = importSubmittedResearchCorpus([record], {
      ...options,
      expectedRecordCounts: { ...options.expectedRecordCounts, BREED: 1 },
      expectedOrdinalEnd: 1,
      baselineCanonicalById: new Map([[record.recordId, baseline]]),
    });
    expect(result.changeAudit).toContainEqual(expect.objectContaining({ recordId: "BRD_CHANGED", field: "terrainBroad", before: ["DESERT"], after: ["FOREST"] }));
    expect(result.ledger).toHaveLength(result.reconciliation.length);
    expect(new Set(result.reconciliation.map((row) => row.sourceFilename)).size).toBe(1);
  });
});
