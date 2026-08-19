import { describe, expect, it } from "vitest";
import { assessV3Research } from "../../src/core/research/v3-final-audit.js";

const terminalFields = Object.fromEntries([
  "traits", "foodBroad", "foodSpecific", "terrainBroad", "terrainSpecific", "personalityId",
  "motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode",
  "allocationMode", "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature",
  "outlookOrientation", "collaborativePosture",
].map((field) => [field, "RESOLVED_NULL"]));

describe("V3 final adversarial assessment", () => {
  it("accepts only a terminal corpus with complete evidence and bounded citations", () => {
    const result = assessV3Research({
      breeds: [{ breedId: "BRD_TEST", populationKind: "BEAST", ...Object.fromEntries(Object.keys(terminalFields).map((field) => [field, null])), fieldDispositions: terminalFields }],
      evidence: Object.keys(terminalFields).map((field) => ({ evidenceId: `E_${field}`, exactTargetEntity: "BRD_TEST", targetField: field, disposition: "RESOLVED_NULL", citationRefs: [`C_${field}`], researchQuestion: `Question ${field}`, queriesAttempted: ["query"], sourcesOpened: ["source"], factsFound: ["fact"], nullRationale: "No claim-aligned value was supported." })),
      citations: Object.keys(terminalFields).map((field) => ({ citationId: `C_${field}`, sourceId: "S_TEST", exactTargetEntity: "BRD_TEST", targetField: field, locator: "section", boundedContext: "Bounded relevant context", sourceFactParaphrase: "Clean fact paraphrase" })),
      sources: [{ sourceId: "S_TEST", canonicalUrlOrIdentifier: "https://example.test/source", title: "Source", publisherOrHost: "Publisher" }],
    }, { expectedBreedCount: 1, enforceMandatoryRegressions: false });

    expect(result).toMatchObject({ verdict: "ACCEPT_FINAL", safeToImport: true, researchCompletionClaimSupported: true, structuralIntegrityPassed: true, semanticEvidenceIntegrityPassed: true });
  });

  it("rejects unresolved fields and citations without bounded context", () => {
    const dispositions = { ...terminalFields, traits: "UNRESOLVED" };
    const result = assessV3Research({
      breeds: [{ breedId: "BRD_TEST", populationKind: "BEAST", fieldDispositions: dispositions }],
      evidence: [],
      citations: [],
      sources: [],
    }, { expectedBreedCount: 1, enforceMandatoryRegressions: false });

    expect(result.verdict).toBe("REJECT");
    expect(result.counts.unresolved).toBe(1);
    expect(result.semanticEvidenceIntegrityPassed).toBe(false);
  });
});
