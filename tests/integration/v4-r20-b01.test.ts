import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R20_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R20_B01 complete research gate", () => {
  it("publishes exact 80-unit and 80-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R20_B01", regionId: "R20", status: "PASS", criticalNulls: 0,
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
    for (const world of ["CONCORD","SCHISM","RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("90244");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("uses only opened exact-species evidence with direct behavior mappings", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId,row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/,""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      expect(decision.personalityBridge).toMatch(/direct behavior mapping/i);
    }
  });

  it("locks representative behavior semantics and sequential architecture", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    for (const id of ["SPC_CASTOR_CANADENSIS","SPC_CASTOR_FIBER"]) expect(decisions.get(id)).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    for (const id of ["SPC_FUKOMYS_DAMARENSIS","SPC_HETEROCEPHALUS_GLABER"]) expect(decisions.get(id)).toMatchObject({ personalityId: "BELONGING_COLONY_EXPRESSION" });
    for (const id of ["SPC_CENTURIO_SENEX","SPC_HYPSIGNATHUS_MONSTROSUS"]) expect(decisions.get(id)).toMatchObject({ personalityId: "RECOGNITION_COURTSHIP_DISPLAY_EXPRESSION" });
    for (const id of ["SPC_OCHOTONA_COLLARIS","SPC_OCHOTONA_PRINCEPS"]) expect(decisions.get(id)).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("SPC_MYOTIS_VIVESI")).toMatchObject({ terrainBroad: ["OCEAN","COASTAL","SUBTERRANEAN"], terrainSpecific: ["PELAGIC","COASTAL_CLIFF","ISLAND","CAVE"] });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(20, 22)).toEqual(["R19_B01","R20_B01"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(22);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
