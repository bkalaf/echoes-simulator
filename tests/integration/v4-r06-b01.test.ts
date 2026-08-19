import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R06_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R06_B01 complete research gate", () => {
  it("publishes exact 10-unit and 23-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R06_B01", regionId: "R06", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 10, manifestBreeds: 23, resultUnits: 10, effectiveBreeds: 23,
        journalEntries: 30, sources: 13, citations: 30, evidence: 30,
        inheritanceEdges: 23, dimensionValuesExpected: 276, dimensionValuesMaterialized: 276,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(10);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(30);
    expect(readJsonl("sources.jsonl")).toHaveLength(13);
    expect(readJsonl("citations.jsonl")).toHaveLength(30);
    expect(readJsonl("evidence.jsonl")).toHaveLength(30);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(23);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(23);
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

  it("separates authored Human inference from direct Mythos evidence", () => {
    const humanIds = new Set(["CLT_KURDISH", "CLT_PASHTUN", "CLT_PERSIAN_IRANIAN", "CLT_PUNJABI_SIKH", "CLT_RAJASTHANI"]);
    const mythosIds = new Set(["SPC_CAELESTIS_NEPHILIM", "SPC_CAELESTIS_NUNTIUS", "SPC_GENIALIS_DJINN", "SPC_GENIALIS_IFRIT", "SPC_GENIALIS_PERI"]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humanIds.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      }
      if (mythosIds.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humanIds.has(decision.researchUnitId)) {
        expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
        expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      } else {
        expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      }
    }
  });

  it("inherits shared evidence to every mapped Breed and advances the ledger once", () => {
    const edges = readJsonl("inheritance_edges.jsonl");
    expect(edges.filter((row) => row.researchUnitId === "SPC_CAELESTIS_NUNTIUS")).toHaveLength(5);
    expect(edges.filter((row) => row.researchUnitId === "CLT_PERSIAN_IRANIAN")).toHaveLength(8);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 8)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
