import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R25_B02");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const mythos = new Set(["SPC_CADAVER_AMBULANS", "SPC_CADAVER_OSSEUS"]);

describe("R25_B02 complete research gate", () => {
  it("publishes exact 51-unit and 51-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R25_B02", regionId: "R25", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 51, manifestBreeds: 51, resultUnits: 51, effectiveBreeds: 51, journalEntries: 153, sources: 61, citations: 153, evidence: 153, inheritanceEdges: 51, dimensionValuesExpected: 612, dimensionValuesMaterialized: 612 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",51],["research_journal.jsonl",153],["sources.jsonl",61],["citations.jsonl",153],["evidence.jsonl",153],["inheritance_edges.jsonl",51]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("147775");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("separates exact-species evidence from the two exact traditional entities", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      expect(citation.subjectAlignment).toBe(mythos.has(journal.targetUnitId) ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
  });

  it("locks representative semantics and the completed Region-batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_PHOTURIS_VERSICOLOR")).toMatchObject({ personalityId: "TRUTH_MIMICRY_EXPRESSION" });
    expect(decisions.get("SPC_PORTIA_FIMBRIATA")).toMatchObject({ personalityId: "CURIOSITY_PROBLEM_SOLVING_EXPRESSION" });
    expect(decisions.get("SPC_SCHISTOCERCA_GREGARIA")).toMatchObject({ personalityId: "FORCE_SWARM_EXPRESSION" });
    expect(decisions.get("SPC_TELEOPSIS_DALMANNI")).toMatchObject({ personalityId: "STATUS_ORNAMENT_RANK_EXPRESSION" });
    expect(decisions.get("SPC_CADAVER_AMBULANS")).toMatchObject({ personalityId: "AUTONOMY_ENSLAVEMENT_WOUND", terrainSpecific: ["TEMPLE"] });
    expect(decisions.get("SPC_CADAVER_OSSEUS")).toMatchObject({ personalityId: "MORTALITY_UNDEAD_CONTINUATION_CONFLICT", terrainSpecific: ["TEMPLE"] });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(-3)).toEqual(["R24_B01", "R25_B01", "R25_B02"]);
    expect(architecture.completedRegionBatches).toHaveLength(29);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
