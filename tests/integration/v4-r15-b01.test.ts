import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R15_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humanCultures = new Set([
  "CLT_BENGALI",
  "CLT_CAUCASUS_HIGHLAND_GEORGIAN_NORTH_CAUCASIAN",
  "CLT_GUJARATI",
  "CLT_HUNGARIAN_MAGYAR",
  "CLT_NORTH_AND_WEST_INDIAN_INDUS_GANGETIC",
  "CLT_ROMANIAN_MOLDOVAN",
  "CLT_RUSSIAN_EASTERN_EUROPEAN",
  "CLT_SINHALESE",
  "CLT_SOUTH_INDIAN_DRAVIDIAN",
  "CLT_SOUTH_SLAVIC",
]);

describe("R15_B01 complete research gate", () => {
  it("publishes exact 41-unit and 95-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R15_B01", regionId: "R15", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 41, manifestBreeds: 95, resultUnits: 41, effectiveBreeds: 95,
        journalEntries: 123, sources: 41, citations: 123, evidence: 123,
        inheritanceEdges: 95, dimensionValuesExpected: 1140, dimensionValuesMaterialized: 1140,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(41);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(123);
    expect(readJsonl("sources.jsonl")).toHaveLength(41);
    expect(readJsonl("citations.jsonl")).toHaveLength(123);
    expect(readJsonl("evidence.jsonl")).toHaveLength(123);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(95);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(95);
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.totalPopulation).toBe("107160");
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) {
        expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
      }
    }
  });

  it("separates direct primate mapping from qualified Human authored inference", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      if (humanCultures.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
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

  it("locks primate techniques, cooperative care, exact terrain, and bounded Human inference", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_DAUBENTONIA_MADAGASCARIENSIS")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("SPC_PAN_TROGLODYTES")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("SPC_NASALIS_LARVATUS")).toMatchObject({ terrainSpecific: ["MANGROVE", "SWAMP", "RIVER", "CANOPY"] });
    expect(decisions.get("SPC_TARSIUS_SPECTRUM")).toMatchObject({ personalityId: "COOPERATION_GROUP_DEFENSE_EXPRESSION" });
    expect(decisions.get("SPC_SAGUINUS_IMPERATOR")).toMatchObject({ personalityId: "CARE_CARRYING_EXPRESSION" });
    expect(decisions.get("CLT_SINHALESE")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("CLT_GUJARATI")).toMatchObject({ personalityId: "RECIPROCITY_FOOD_SHARING_EXPRESSION" });

    const journals = readJsonl("research_journal.jsonl");
    expect(journals.filter((row) => row.targetUnitId === "SPC_PAN_TROGLODYTES").map((row) => row.boundedContext).join(" ")).toMatch(/modify sticks, stones, leaves, and grass as tools/i);
    const humans = journals.filter((row) => humanCultures.has(row.targetUnitId));
    expect(humans).toHaveLength(30);
    expect(humans.every((row) => row.actualOpenedUrl.startsWith("https://"))).toBe(true);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 17)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01",
      "R14_B01", "R14_B02", "R15_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
