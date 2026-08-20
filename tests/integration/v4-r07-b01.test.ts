import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R07_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R07_B01 complete research gate", () => {
  it("publishes exact 20-unit and 64-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R07_B01", regionId: "R07", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 20, manifestBreeds: 64, resultUnits: 20, effectiveBreeds: 64,
        journalEntries: 60, sources: 20, citations: 60, evidence: 60,
        inheritanceEdges: 64, dimensionValuesExpected: 768, dimensionValuesMaterialized: 768,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(20);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(60);
    expect(readJsonl("sources.jsonl")).toHaveLength(20);
    expect(readJsonl("citations.jsonl")).toHaveLength(60);
    expect(readJsonl("evidence.jsonl")).toHaveLength(60);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(64);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(64);
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
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("keeps Human culture inference separate from direct Mythos mapping", () => {
    const humans = new Set([
      "CLT_BALTIC", "CLT_BASQUE", "CLT_FINNIC",
      "CLT_GERMAN_DUTCH_FLEMISH_CONTINENTAL_WEST_GERMANIC", "CLT_NORDIC",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humans.has(decision.researchUnitId)) {
        expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
        expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      } else {
        expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      }
    }
  });

  it("preserves exact-source distinctions and advances the Region ledger once", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_SANGUIVORUS_YARAMAYHAWHO")).toMatchObject({
      personalityId: "APPETITE_AMBUSH_FEEDING_EXPRESSION", terrainBroad: ["FOREST"], terrainSpecific: ["CANOPY"],
    });
    expect(decisions.get("SPC_VERSIPELLIS_SELKIE")).toMatchObject({
      personalityId: "LAND_ROOTEDNESS_VERSUS_FREEDOM_CONFLICT", terrainBroad: ["OCEAN", "COASTAL"], terrainSpecific: ["ISLAND"],
    });
    const edges = readJsonl("inheritance_edges.jsonl");
    expect(edges.filter((row) => row.researchUnitId === "CLT_GERMAN_DUTCH_FLEMISH_CONTINENTAL_WEST_GERMANIC")).toHaveLength(29);
    expect(edges.filter((row) => row.researchUnitId === "CLT_NORDIC")).toHaveLength(9);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 9)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01", "R07_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
