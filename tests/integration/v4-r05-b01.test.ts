import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R05_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R05_B01 complete research gate", () => {
  it("publishes exact 20-unit and 23-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R05_B01", regionId: "R05", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 20, manifestBreeds: 23, resultUnits: 20, effectiveBreeds: 23,
        journalEntries: 60, sources: 21, citations: 60, evidence: 60,
        inheritanceEdges: 23, dimensionValuesExpected: 276, dimensionValuesMaterialized: 276,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(20);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(60);
    expect(readJsonl("sources.jsonl")).toHaveLength(21);
    expect(readJsonl("citations.jsonl")).toHaveLength(60);
    expect(readJsonl("evidence.jsonl")).toHaveLength(60);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(23);

    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(23);
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

  it("keeps every Mythos claim direct and attached to an opened exact-tradition source", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      expect(journal.sourceOpened).toBe(true);
      expect(journal.actualOpenedUrl).toMatch(/^https?:\/\//);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(20);
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      expect(decision.personalityBridge.length).toBeGreaterThan(40);
    }
  });

  it("records the shared ghost unit without weakening Breed inheritance and advances the ledger once", () => {
    const shared = readJsonl("inheritance_edges.jsonl").filter((row) => row.researchUnitId === "SPC_SPECTRUM_REVENIENS");
    expect(shared.map((row) => row.breedId).sort()).toEqual([
      "BRD_GHOSTS_GHOST", "BRD_GHOSTS_POLTERGEIST", "BRD_GHOSTS_SPECTER", "BRD_GHOSTS_WRAITH",
    ]);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 7)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
