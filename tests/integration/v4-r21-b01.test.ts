import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R21_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set(["CLT_ATLANTIS","CLT_AVALON","CLT_GARIFUNA","CLT_HISPANIC_AMERICAN_MESTIZO","CLT_IBERIAN_ATLANTIC_PORTUGUESE_CREOLE","CLT_JEWISH_DIASPORA","CLT_METIS","CLT_ROMANI","CLT_SHAMBHALA","CLT_YS"]);
const mythos = new Set(["SPC_GOBELINUS_MAIOR","SPC_GOBELINUS_ORCUS","SPC_GOBELINUS_TERRIBILIS","SPC_GOBELINUS_VULGARIS","SPC_GOLEM_FACTITIUS"]);

describe("R21_B01 complete research gate", () => {
  it("publishes exact 15-unit and 63-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R21_B01", regionId: "R21", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 15, manifestBreeds: 63, resultUnits: 15, effectiveBreeds: 63, journalEntries: 45, sources: 15, citations: 45, evidence: 45, inheritanceEdges: 63, dimensionValuesExpected: 756, dimensionValuesMaterialized: 756 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",15],["research_journal.jsonl",45],["sources.jsonl",15],["citations.jsonl",45],["evidence.jsonl",45],["inheritance_edges.jsonl",63]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD","SCHISM","RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("71064");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("separates contextual Human inference from exact-tradition Mythos evidence", () => {
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
        expect(mythos.has(journal.targetUnitId)).toBe(true);
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humans.has(decision.researchUnitId)) {
        expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
        expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      } else {
        expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
        expect(decision.personalityBridge).toMatch(/inward-facing direct traditional-entity mapping/i);
      }
    }
  });

  it("locks representative culture and Gobelinus semantics plus batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    expect(decisions.get("CLT_ATLANTIS")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("CLT_GARIFUNA")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("CLT_METIS")).toMatchObject({ personalityId: "COOPERATION_COOPERATIVE_HUNTING_EXPRESSION" });
    expect(decisions.get("CLT_ROMANI")).toMatchObject({ personalityId: "EXILE_FORCED_MIGRATION_WOUND", terrainBroad: ["GENERALIST"], terrainSpecific: ["GENERALIST"] });
    expect(decisions.get("SPC_GOBELINUS_VULGARIS")).toMatchObject({ personalityId: "BELONGING_DISPLACEMENT_WOUND", terrainSpecific: ["CAVE","MINE","TUNNEL","CASTLE"] });
    expect(decisions.get("SPC_GOLEM_FACTITIUS")).toMatchObject({ personalityId: "PROTECTION_PROTECTOR_AS_PERPETRATOR_WOUND" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(22, 24)).toEqual(["R20_B02","R21_B01"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(24);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
