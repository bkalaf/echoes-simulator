import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R09_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R09_B01 complete research gate", () => {
  it("publishes exact 17-unit and 42-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R09_B01", regionId: "R09", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 17, manifestBreeds: 42, resultUnits: 17, effectiveBreeds: 42,
        journalEntries: 51, sources: 16, citations: 51, evidence: 51,
        inheritanceEdges: 42, dimensionValuesExpected: 504, dimensionValuesMaterialized: 504,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(17);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(51);
    expect(readJsonl("sources.jsonl")).toHaveLength(16);
    expect(readJsonl("citations.jsonl")).toHaveLength(51);
    expect(readJsonl("evidence.jsonl")).toHaveLength(51);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(42);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(42);
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

  it("keeps Human inference separate from exact traditional-entity mappings", () => {
    const humans = new Set([
      "CLT_INUIT_YUPIK", "CLT_NEPAL_BHUTAN_HIMALAYAN_NEWAR", "CLT_SAMI_ARCTIC_URALIC",
      "CLT_TIBETAN", "CLT_TLINGIT",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
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
      }
    }
  });

  it("preserves source-bounded Mythos distinctions and advances the ledger once", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_ELEMENTUM_INCARNATUM")).toMatchObject({
      personalityId: "EMBODIMENT_FUNCTIONAL_BODY_EXPRESSION",
      terrainBroad: ["GENERALIST"], terrainSpecific: ["GENERALIST"],
    });
    expect(decisions.get("SPC_GIGAS_CYCLOPS")).toMatchObject({
      personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION",
      terrainSpecific: ["CAVE", "VOLCANIC", "ISLAND", "WORKSHOP"],
    });
    expect(decisions.get("SPC_GIGAS_FOMORIAN")).toMatchObject({
      personalityId: "POWER_COLONIAL_POWER_WOUND",
      terrainBroad: ["OCEAN", "COASTAL"],
    });
    expect(decisions.get("SPC_GIGAS_SAXATILIS")).toMatchObject({
      personalityId: "EMBODIMENT_WEAPON_BODY_CONFLICT",
      terrainBroad: ["GENERALIST"], terrainSpecific: ["GENERALIST"],
    });
    expect(decisions.get("SPC_GIGAS_TITAN")).toMatchObject({
      personalityId: "STATUS_FALLEN_DIVINITY_CONFLICT",
      terrainBroad: ["SUBTERRANEAN"],
    });

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 11)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01", "R07_B01", "R08_B01", "R09_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
