import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R02_B02");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R02_B02 complete research gate", () => {
  it("publishes exact 37-unit and 54-Breed PASS artifacts with a cumulative R02 preview", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R02_B02", regionId: "R02", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 37, manifestBreeds: 54, resultUnits: 37, effectiveBreeds: 54,
        journalEntries: 111, sources: 39, citations: 111, evidence: 111,
        inheritanceEdges: 54, dimensionValuesExpected: 648, dimensionValuesMaterialized: 648,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(37);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(111);
    expect(readJsonl("sources.jsonl")).toHaveLength(39);
    expect(readJsonl("citations.jsonl")).toHaveLength(111);
    expect(readJsonl("evidence.jsonl")).toHaveLength(111);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(54);

    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(54);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.dominantFaction).toBeTruthy();
      expect(preview.politicalForm).toBeTruthy();
      expect(preview.economicForm).toBeTruthy();
      expect(BigInt(preview.totalPopulation)).toBeGreaterThan(0n);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
    const r02b01 = readJsonl("../R02_B01/effective_breed_preview.jsonl");
    expect(r02b01.length + effective.length).toBe(134);
  });

  it("keeps Human personality claims bounded to authored exact-Culture inference", () => {
    const humanUnitIds = new Set([
      "CLT_KIPCHAK_AND_NORTHERN_TURKIC", "CLT_MONGOL", "CLT_OGHUZ_TURKIC",
      "CLT_TAJIK_SOGDIAN", "CLT_UZBEK_TIMURID",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      if (!humanUnitIds.has(journal.targetUnitId)) continue;
      expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
      expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
    }
    for (const decision of readJsonl("research_decisions.jsonl").filter((row) => humanUnitIds.has(row.researchUnitId))) {
      expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
      expect(decision.personalityBridge).toMatch(/not an inherent/i);
    }
  });

  it("records opened evidence and advances the locked run order exactly once", () => {
    expect(readJsonl("research_journal.jsonl").every((row) => row.sourceOpened === true && row.actualOpenedUrl.startsWith("http"))).toBe(true);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 4)).toEqual(["R01_B01", "R01_B02", "R02_B01", "R02_B02"]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
