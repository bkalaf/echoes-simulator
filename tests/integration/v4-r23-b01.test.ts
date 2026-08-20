import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R23_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set([
  "CLT_AMAZONIAN_INDIGENOUS_MARAJOARA_SHIPIBO",
  "CLT_AYMARA_TIWANAKU",
  "CLT_GUARANI_CHACO",
  "CLT_MAPUCHE",
  "CLT_QUECHUA_INCA_CONTINUUM",
]);

describe("R23_B01 complete research gate", () => {
  it("publishes exact 57-unit and 66-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R23_B01", regionId: "R23", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 57, manifestBreeds: 66, resultUnits: 57, effectiveBreeds: 66, journalEntries: 171, sources: 59, citations: 171, evidence: 171, inheritanceEdges: 66, dimensionValuesExpected: 792, dimensionValuesMaterialized: 792 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",57],["research_journal.jsonl",171],["sources.jsonl",59],["citations.jsonl",171],["evidence.jsonl",171],["inheritance_edges.jsonl",66]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD","SCHISM","RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("74450");
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
        expect(citation.subjectAlignment).toBe(journal.targetUnitId.startsWith("SPC_CHIMAERA_") ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
  });

  it("locks representative ecology and Culture semantics plus batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    expect(decisions.get("SPC_CHIMAERA_MAPINGUARI")).toMatchObject({ personalityId: "PROTECTION_GUARDIAN_CURSE_CONFLICT", terrainSpecific: ["RAIN_FOREST","RIVER"] });
    expect(decisions.get("SPC_CHIMAERA_MINOTAUR")).toMatchObject({ personalityId: "FORCE_CHARGE_EXPRESSION", terrainBroad: ["BUILT_ENVIRONMENT","SUBTERRANEAN"] });
    expect(decisions.get("SPC_CHIMAERA_TENGU")).toMatchObject({ personalityId: "BOUNDARIES_DOMAIN_BOUND_CONFLICT", terrainSpecific: ["MONTANE_FOREST","ALPINE","TEMPLE"] });
    expect(decisions.get("SPC_CHIMAERA_TIKBALANG")).toMatchObject({ personalityId: "DOUBT_MAKER_DECEPTION_CONFLICT" });
    expect(decisions.get("CLT_AYMARA_TIWANAKU")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("CLT_QUECHUA_INCA_CONTINUUM")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(24, 26)).toEqual(["R22_B01","R23_B01"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(26);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
