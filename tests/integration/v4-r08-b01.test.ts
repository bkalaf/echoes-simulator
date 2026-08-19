import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R08_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R08_B01 complete research gate", () => {
  it("publishes exact 54-unit and 76-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R08_B01", regionId: "R08", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 54, manifestBreeds: 76, resultUnits: 54, effectiveBreeds: 76,
        journalEntries: 162, sources: 54, citations: 162, evidence: 162,
        inheritanceEdges: 76, dimensionValuesExpected: 912, dimensionValuesMaterialized: 912,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(54);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(162);
    expect(readJsonl("sources.jsonl")).toHaveLength(54);
    expect(readJsonl("citations.jsonl")).toHaveLength(162);
    expect(readJsonl("evidence.jsonl")).toHaveLength(162);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(76);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(76);
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
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) {
        expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
      }
    }
  });

  it("keeps Human inference distinct from animal behavior and Norse tradition", () => {
    const humans = new Set([
      "CLT_AINU", "CLT_JAPANESE", "CLT_KOREAN", "CLT_NORTHERN_HAN_CHINESE",
      "CLT_SOUTHERN_HAN_CHINESE_WU_MIN_YUE_HAKKA",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else if (journal.targetUnitId === "SPC_ALFAR_VARIABILIS") {
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
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
    expect(decisions.get("SPC_EREMOPHILA_ALPESTRIS")).toMatchObject({
      personalityId: "COURAGE_FEIGNED_INJURY_EXPRESSION",
      terrainBroad: ["GRASSLAND", "DESERT", "POLAR_ICE", "COASTAL"],
      terrainSpecific: ["PRAIRIE", "HOT_DESERT", "TUNDRA", "DUNES"],
    });
    expect(decisions.get("SPC_SETOPHAGA_PETECHIA")).toMatchObject({
      personalityId: "PERFECTION_ERROR_CORRECTION_EXPRESSION",
      terrainBroad: ["FOREST", "WETLAND", "FRESHWATER"],
      terrainSpecific: ["FOREST_EDGE", "MARSH", "BOG", "RIVER"],
    });
    expect(decisions.get("CLT_AINU")).toMatchObject({
      personalityId: "LAND_REMOVAL_WOUND",
      inferenceClassification: "EIDOLON_AUTHORED_INFERENCE",
    });
    const edges = readJsonl("inheritance_edges.jsonl");
    expect(edges.filter((row) => row.researchUnitId === "CLT_SOUTHERN_HAN_CHINESE_WU_MIN_YUE_HAKKA")).toHaveLength(13);
    expect(edges.filter((row) => row.researchUnitId === "SPC_ALFAR_VARIABILIS")).toHaveLength(5);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 10)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01", "R07_B01", "R08_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
