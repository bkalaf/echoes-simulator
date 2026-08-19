import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R13_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

const humanCultures = new Set([
  "CLT_ANCIENT_LEVANTINE_NABATAEAN_PHOENICIAN",
  "CLT_ARABIAN_PENINSULA_ARAB",
  "CLT_ASSYRIAN_SYRIAC",
  "CLT_LEVANTINE_ARAB",
  "CLT_MESOPOTAMIAN_SUMERIAN_BABYLONIAN",
]);

const mythosSpecies = new Set([
  "SPC_DIVINUS_APSARA",
  "SPC_DIVINUS_DEVA",
  "SPC_DIVINUS_DIWATA",
  "SPC_DIVINUS_ERINYS",
  "SPC_DIVINUS_GARUDA",
  "SPC_DIVINUS_VALKYRIE",
]);

describe("R13_B01 complete research gate", () => {
  it("publishes exact 50-unit and 82-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R13_B01", regionId: "R13", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 50, manifestBreeds: 82, resultUnits: 50, effectiveBreeds: 82,
        journalEntries: 150, sources: 50, citations: 150, evidence: 150,
        inheritanceEdges: 82, dimensionValuesExpected: 984, dimensionValuesMaterialized: 984,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(50);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(150);
    expect(readJsonl("sources.jsonl")).toHaveLength(50);
    expect(readJsonl("citations.jsonl")).toHaveLength(150);
    expect(readJsonl("evidence.jsonl")).toHaveLength(150);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(82);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(82);
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

  it("keeps exact-subject alignment and marks Human mappings as authored inference", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humanCultures.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe(mythosSpecies.has(journal.targetUnitId) ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }

    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humanCultures.has(decision.researchUnitId)) {
        expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
        expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      } else {
        expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
      }
    }
  });

  it("locks the amphibian, Human-history, and traditional-entity distinctions", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_AMBLYSTOMA_TIGRINUM")).toMatchObject({
      personalityId: "LAND_SPAWNING_SITE_DEPENDENCE",
      terrainSpecific: ["WOODLAND", "BURROW", "SOIL", "POND", "SWAMP"],
    });
    expect(decisions.get("SPC_AMBYSTOMA_MEXICANUM")).toMatchObject({
      personalityId: "CHANGE_DEVELOPMENTAL_PLASTICITY_EXPRESSION",
      terrainBroad: ["FRESHWATER"],
    });
    expect(decisions.get("SPC_SIPHONOPS_ANNULATUS")).toMatchObject({ personalityId: "CARE_PROVISIONING_EXPRESSION" });
    expect(decisions.get("SPC_TRICHOBATRACHUS_ROBUSTUS")).toMatchObject({ personalityId: "EMBODIMENT_WEAPON_BODY_CONFLICT" });
    expect(decisions.get("CLT_LEVANTINE_ARAB")).toMatchObject({ personalityId: "BOUNDARIES_LAND_BOUNDARY_WOUND" });
    expect(decisions.get("SPC_DIVINUS_GARUDA")).toMatchObject({ personalityId: "CARE_CREATED_SERVANT_CONFLICT" });

    const tigerEvidence = readJsonl("evidence.jsonl").filter((row) => row.researchUnitId === "SPC_AMBLYSTOMA_TIGRINUM");
    expect(tigerEvidence).toHaveLength(3);
    expect(tigerEvidence.map((row) => row.normalizationBridge).join(" ")).toMatch(/canonical spelling AMBLYSTOMA.*accepted genus.*Ambystoma/i);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 14)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
