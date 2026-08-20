import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R14_B02");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humanCultures = new Set([
  "CLT_CHAD_SUDAN_INTERIOR",
  "CLT_HAUSA_KANURI_SAHEL",
  "CLT_SENEGAMBIAN_FULANI_WOLOF_SERER",
  "CLT_SOMALI_CUSHITIC_HORN",
  "CLT_SONGHAI",
]);

describe("R14_B02 complete research gate", () => {
  it("publishes exact 22-unit and 38-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R14_B02", regionId: "R14", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 22, manifestBreeds: 38, resultUnits: 22, effectiveBreeds: 38,
        journalEntries: 66, sources: 22, citations: 66, evidence: 66,
        inheritanceEdges: 38, dimensionValuesExpected: 456, dimensionValuesMaterialized: 456,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(22);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(66);
    expect(readJsonl("sources.jsonl")).toHaveLength(22);
    expect(readJsonl("citations.jsonl")).toHaveLength(66);
    expect(readJsonl("evidence.jsonl")).toHaveLength(66);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(38);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(38);
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.totalPopulation).toBe("133106");
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) {
        expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
      }
    }
  });

  it("separates direct animal mapping from qualified Human authored inference", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
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

  it("locks observational learning, Senegambian evidence, and institutional Songhai mapping", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_TOXOTES_JACULATRIX")).toMatchObject({
      personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION",
      terrainSpecific: ["MANGROVE", "ESTUARY", "RIVER"],
    });
    expect(decisions.get("SPC_THAUMOCTOPUS_MIMICUS")).toMatchObject({ personalityId: "TRUTH_MIMICRY_EXPRESSION" });
    expect(decisions.get("CLT_SONGHAI")).toMatchObject({ personalityId: "CONTROL_RESOURCE_CONTROL_EXPRESSION" });
    expect(decisions.get("CLT_SENEGAMBIAN_FULANI_WOLOF_SERER")).toMatchObject({ personalityId: "RISK_SOCIAL_RISK_SHARING_EXPRESSION" });

    const journals = readJsonl("research_journal.jsonl");
    const archer = journals.filter((row) => row.targetUnitId === "SPC_TOXOTES_JACULATRIX");
    expect(archer.map((row) => row.boundedContext).join(" ")).toMatch(/improved accuracy after observing skilled fish/i);
    const senegambia = journals.filter((row) => row.targetUnitId === "CLT_SENEGAMBIAN_FULANI_WOLOF_SERER");
    expect(senegambia).toHaveLength(3);
    expect(senegambia.every((row) => row.organization === "Smithsonian Institution")).toBe(true);
    expect(senegambia.every((row) => row.actualOpenedUrl.endsWith("FESTBK1990_13.pdf"))).toBe(true);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 16)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01",
      "R14_B01", "R14_B02",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
