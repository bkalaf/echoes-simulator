import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R11_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R11_B01 complete research gate", () => {
  it("publishes exact 31-unit and 65-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R11_B01", regionId: "R11", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 31, manifestBreeds: 65, resultUnits: 31, effectiveBreeds: 65,
        journalEntries: 93, sources: 31, citations: 93, evidence: 93,
        inheritanceEdges: 65, dimensionValuesExpected: 780, dimensionValuesMaterialized: 780,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(31);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(93);
    expect(readJsonl("sources.jsonl")).toHaveLength(31);
    expect(readJsonl("citations.jsonl")).toHaveLength(93);
    expect(readJsonl("evidence.jsonl")).toHaveLength(93);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(65);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(65);
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

  it("separates documented Human history and tradition from authored inference", () => {
    const humans = new Set([
      "CLT_ALBANIAN", "CLT_AMAZIGH_BERBER", "CLT_CATALAN", "CLT_CENTRAL_SAHARA_TOUBOU_TEBU",
      "CLT_EGYPTIAN_COPTIC", "CLT_GREEK_AEGEAN_BYZANTINE", "CLT_ITALIAN_CENTRAL_MEDITERRANEAN",
      "CLT_MAGHREBI_ARAB", "CLT_NUBIAN", "CLT_SPANISH_CASTILIAN",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
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

  it("locks the Aardvark cascade and African-manatee dam regression", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_ORYCTEROPUS_AFER")).toMatchObject({
      personalityId: "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION",
      terrainBroad: ["GRASSLAND", "FOREST", "DESERT", "SUBTERRANEAN"],
      terrainSpecific: ["SAVANNA", "WOODLAND", "SCRUBLAND", "BURROW", "SOIL"],
    });
    expect(decisions.get("SPC_TRICHECHUS_SENEGALENSIS")).toMatchObject({
      personalityId: "CHANGE_MIGRATION_CHANGE_WOUND",
      terrainBroad: ["FRESHWATER", "COASTAL", "WETLAND"],
      terrainSpecific: ["RIVER", "LAKE", "ESTUARY", "FLOODPLAIN"],
    });
    const africanManateeEvidence = readJsonl("research_journal.jsonl").filter((row) => row.targetUnitId === "SPC_TRICHECHUS_SENEGALENSIS");
    expect(africanManateeEvidence).toHaveLength(3);
    expect(africanManateeEvidence.map((row) => `${row.boundedContext} ${row.sourceFact}`).join(" ")).toMatch(/dam construction/i);
    expect(africanManateeEvidence.map((row) => row.actualOpenedUrl)).toEqual([
      "https://www.frontiersin.org/journals/conservation-science/articles/10.3389/fcosc.2026.1731928/full",
      "https://www.frontiersin.org/journals/conservation-science/articles/10.3389/fcosc.2026.1731928/full",
      "https://www.frontiersin.org/journals/conservation-science/articles/10.3389/fcosc.2026.1731928/full",
    ]);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 12)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01",
      "R07_B01", "R08_B01", "R09_B01", "R11_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
