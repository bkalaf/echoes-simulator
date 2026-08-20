import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R22_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set(["CLT_ABORIGINAL_AUSTRALIAN","CLT_MOCHE","CLT_MUISCA","CLT_OLMEC","CLT_PUREPECHA"]);

describe("R22_B01 complete research gate", () => {
  it("publishes exact 77-unit and 80-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R22_B01", regionId: "R22", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 77, manifestBreeds: 80, resultUnits: 77, effectiveBreeds: 80, journalEntries: 231, sources: 77, citations: 231, evidence: 231, inheritanceEdges: 80, dimensionValuesExpected: 960, dimensionValuesMaterialized: 960 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",77],["research_journal.jsonl",231],["sources.jsonl",77],["citations.jsonl",231],["evidence.jsonl",231],["inheritance_edges.jsonl",80]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD","SCHISM","RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("90241");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("keeps exact-species evidence separate from contextual Human inference", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId,row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/,""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humans.has(decision.researchUnitId)) expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      else expect(decision.personalityBridge).toMatch(/direct behavior mapping/i);
    }
  });

  it("locks representative ecology and Culture semantics plus batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    expect(decisions.get("SPC_ALCEDO_ATTHIS")).toMatchObject({ personalityId: "BOUNDARIES_TERRITORIAL_MARKING_EXPRESSION", terrainSpecific: ["RIVER","LAKE","ESTUARY","MANGROVE"] });
    expect(decisions.get("SPC_MELANERPES_FORMICIVORUS")).toMatchObject({ personalityId: "COOPERATION_CIRCLE_DEPENDENT_POWER_CONFLICT" });
    expect(decisions.get("SPC_NOTORYCTES_TYPHLOPS")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION", terrainSpecific: ["DUNES","SOIL","BURROW"] });
    expect(decisions.get("SPC_SEMNORNIS_RAMPHASTINUS")).toMatchObject({ personalityId: "COOPERATION_GROUP_DEFENSE_EXPRESSION", terrainSpecific: ["CLOUD_FOREST","MONTANE_FOREST","CANOPY","FOREST_EDGE"] });
    expect(decisions.get("CLT_ABORIGINAL_AUSTRALIAN")).toMatchObject({ personalityId: "BOUNDARIES_DOMAIN_BOUND_CONFLICT", terrainBroad: ["GENERALIST"], terrainSpecific: ["GENERALIST"] });
    expect(decisions.get("CLT_MOCHE")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(23, 25)).toEqual(["R21_B01","R22_B01"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(25);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
