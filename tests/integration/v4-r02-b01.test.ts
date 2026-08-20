import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R02_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R02_B01 complete research gate", () => {
  it("publishes exact 80-unit and 80-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R02_B01", regionId: "R02", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 80, manifestBreeds: 80, resultUnits: 80, effectiveBreeds: 80,
        journalEntries: 240, sources: 85, citations: 240, evidence: 240,
        inheritanceEdges: 80, dimensionValuesExpected: 960, dimensionValuesMaterialized: 960,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(80);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(240);
    expect(readJsonl("sources.jsonl")).toHaveLength(85);
    expect(readJsonl("citations.jsonl")).toHaveLength(240);
    expect(readJsonl("evidence.jsonl")).toHaveLength(240);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(80);

    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(80);
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
  });

  it("keeps known animal regressions repaired", () => {
    const effective = readJsonl("effective_breed_preview.jsonl");
    const byBreed = new Map(effective.map((row) => [row.breedId, row]));
    expect(byBreed.get("BRD_BANDED_MONGOOSE")?.personalityId).toBe("BELONGING_HERDING_EXPRESSION");
    expect(byBreed.get("BRD_ALPINE_IBEX")?.terrainSpecific).toEqual(expect.arrayContaining(["ALPINE", "CLIFF"]));
    expect(byBreed.get("BRD_ALPINE_IBEX")?.terrainSpecific).not.toEqual(expect.arrayContaining(["CANOPY"]));
  });

  it("records only opened exact-species evidence and advances the locked run order once", () => {
    const journals = readJsonl("research_journal.jsonl");
    expect(journals.every((row) => row.sourceOpened === true && row.actualOpenedUrl.startsWith("http"))).toBe(true);
    const citations = readJsonl("citations.jsonl");
    expect(citations.every((row) => row.subjectAlignment === "EXACT_SPECIES" && row.claimAlignment === "ACCEPTED_DIRECT_EVIDENCE")).toBe(true);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 3)).toEqual(["R01_B01", "R01_B02", "R02_B01"]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
