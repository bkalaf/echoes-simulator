import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R25_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R25_B01 complete research gate", () => {
  it("publishes exact 80-unit and 80-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R25_B01", regionId: "R25", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 80, manifestBreeds: 80, resultUnits: 80, effectiveBreeds: 80, journalEntries: 240, sources: 80, citations: 240, evidence: 240, inheritanceEdges: 80, dimensionValuesExpected: 960, dimensionValuesMaterialized: 960 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",80],["research_journal.jsonl",240],["sources.jsonl",80],["citations.jsonl",240],["evidence.jsonl",240],["inheritance_edges.jsonl",80]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("90244");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("uses exact-species opened evidence throughout the Beast shard", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
  });

  it("locks representative invertebrate and reptile semantics and batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_HYMENOPUS_CORONATUS")).toMatchObject({ personalityId: "TRUTH_MIMICRY_EXPRESSION", terrainSpecific: ["RAIN_FOREST", "FOREST_EDGE", "FLOWERING_HABITAT"] });
    expect(decisions.get("SPC_LATICAUDA_COLUBRINA")).toMatchObject({ personalityId: "EXILE_TWO_HOME_CONFLICT" });
    expect(decisions.get("SPC_LYSMATA_AMBOINENSIS")).toMatchObject({ personalityId: "RECIPROCITY_CLEANING_MUTUALISM_EXPRESSION" });
    expect(decisions.get("SPC_MACROTERMES_BELLICOSUS")).toMatchObject({ personalityId: "HIERARCHY_REPRODUCTIVE_CASTE_EXPRESSION" });
    expect(decisions.get("SPC_MAGICICADA_SEPTENDECIM")).toMatchObject({ personalityId: "CONFORMITY_EMERGENCE_SYNCHRONY_EXPRESSION" });
    expect(decisions.get("SPC_MALAYOPYTHON_RETICULATUS")).toMatchObject({ personalityId: "FORCE_CONSTRICT_EXPRESSION" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(-3)).toEqual(["R23_B01", "R24_B01", "R25_B01"]);
    expect(architecture.completedRegionBatches).toHaveLength(28);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
