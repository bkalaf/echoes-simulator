import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R12_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R12_B01 complete research gate", () => {
  it("publishes exact 34-unit and 34-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R12_B01", regionId: "R12", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 34, manifestBreeds: 34, resultUnits: 34, effectiveBreeds: 34,
        journalEntries: 102, sources: 34, citations: 102, evidence: 102,
        inheritanceEdges: 34, dimensionValuesExpected: 408, dimensionValuesMaterialized: 408,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(34);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(102);
    expect(readJsonl("sources.jsonl")).toHaveLength(34);
    expect(readJsonl("citations.jsonl")).toHaveLength(102);
    expect(readJsonl("evidence.jsonl")).toHaveLength(102);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(34);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(34);
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

  it("keeps Beast species and Mythos traditions on exact-subject direct evidence", () => {
    const mythos = new Set([
      "SPC_LOCUS_CURUPIRA", "SPC_LOCUS_DOMOVOI", "SPC_LOCUS_KAPRE", "SPC_LOCUS_LESHY",
      "SPC_LOCUS_MIMISPIRIT", "SPC_LOCUS_MMOATIA", "SPC_PARVULUS_BROWNIE",
      "SPC_PELAGICUS_NINGYO", "SPC_PELAGICUS_PONATURI", "SPC_PELAGICUS_SAPIENS",
      "SPC_PELAGICUS_SIYOKOY", "SPC_PELAGICUS_TRITON",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(citation.subjectAlignment).toBe(mythos.has(journal.targetUnitId) ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
    }
  });

  it("locks taxonomic and traditional-entity distinctions", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_SQUALUS_CARCHARIAS")).toMatchObject({
      personalityId: "PATIENCE_AMBUSH_PATIENCE_EXPRESSION",
      terrainBroad: ["OCEAN", "COASTAL"],
      terrainSpecific: ["PELAGIC", "ISLAND"],
    });
    const whiteSharkEvidence = readJsonl("research_journal.jsonl").filter((row) => row.targetUnitId === "SPC_SQUALUS_CARCHARIAS");
    expect(whiteSharkEvidence).toHaveLength(3);
    expect(whiteSharkEvidence.map((row) => `${row.boundedContext} ${row.sourceFact}`).join(" ")).toMatch(/Linnaeus originally named the species Squalus carcharias/i);

    expect(decisions.get("SPC_LOCUS_MIMISPIRIT")).toMatchObject({
      personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION",
      terrainBroad: ["MOUNTAIN", "SUBTERRANEAN"],
      terrainSpecific: ["CLIFF", "CAVE"],
    });
    expect(decisions.get("SPC_LOCUS_MMOATIA")).toMatchObject({
      personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION",
      terrainBroad: ["FOREST"],
    });
    expect(decisions.get("SPC_PELAGICUS_TRITON")).toMatchObject({
      personalityId: "EXPRESSION_WORLD_CHANGING_VOICE_CONFLICT",
    });

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 13)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
