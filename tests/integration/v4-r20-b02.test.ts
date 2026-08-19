import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R20_B02");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R20_B02 complete research gate", () => {
  it("publishes exact 4-unit and 5-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R20_B02", regionId: "R20", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 4, manifestBreeds: 5, resultUnits: 4, effectiveBreeds: 5, journalEntries: 12, sources: 4, citations: 12, evidence: 12, inheritanceEdges: 5, dimensionValuesExpected: 60, dimensionValuesMaterialized: 60 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",4],["research_journal.jsonl",12],["sources.jsonl",4],["citations.jsonl",12],["evidence.jsonl",12],["inheritance_edges.jsonl",5]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD","SCHISM","RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("95884");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("uses only opened exact-tradition evidence with inward mappings", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId,row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/,""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      expect(decision.personalityBridge).toMatch(/inward-facing direct traditional-entity mapping/i);
      expect(decision.personalityBridge).toMatch(/not a generic monster stereotype/i);
    }
  });

  it("locks plant-spirit semantics and sequential architecture", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    expect(decisions.get("SPC_PHYTOSPIRITUS_AMBULANS")).toMatchObject({ personalityId: "PROTECTION_WORLD_SHIELD_CONFLICT", terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"] });
    expect(decisions.get("SPC_PHYTOSPIRITUS_ARBOREUS")).toMatchObject({ personalityId: "LAND_LAND_AS_BODY_CONFLICT", terrainBroad: ["FOREST","MOUNTAIN"] });
    expect(decisions.get("SPC_PHYTOSPIRITUS_OREAD")).toMatchObject({ personalityId: "LAND_DOMAIN_BOUND_CONFLICT", terrainSpecific: ["MONTANE_FOREST","CAVE"] });
    expect(decisions.get("SPC_PHYTOSPIRITUS_PUTREFACIENS")).toMatchObject({ personalityId: "CHANGE_FORM_SURRENDER_CONFLICT", terrainSpecific: ["FARMLAND"] });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(21, 23)).toEqual(["R20_B01","R20_B02"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(23);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
