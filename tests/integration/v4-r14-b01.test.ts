import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R14_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R14_B01 complete research gate", () => {
  it("publishes exact 80-unit and 80-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R14_B01", regionId: "R14", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 80, manifestBreeds: 80, resultUnits: 80, effectiveBreeds: 80,
        journalEntries: 240, sources: 80, citations: 240, evidence: 240,
        inheritanceEdges: 80, dimensionValuesExpected: 960, dimensionValuesMaterialized: 960,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(80);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(240);
    expect(readJsonl("sources.jsonl")).toHaveLength(80);
    expect(readJsonl("citations.jsonl")).toHaveLength(240);
    expect(readJsonl("evidence.jsonl")).toHaveLength(240);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(80);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(80);
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

  it("uses opened exact-species sources and direct mappings throughout", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(citation.subjectAlignment).toBe("EXACT_SPECIES");
      expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
    }
  });

  it("locks tool use, taxonomy, coral dependence, and lungfish parental-care limits", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_AMPHIOCTOPUS_MARGINATUS")).toMatchObject({
      personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION",
      terrainSpecific: ["CORAL_REEF", "MUDFLAT"],
    });
    expect(decisions.get("SPC_ASCAROSEPION_PFEFFERI")).toMatchObject({
      personalityId: "EXPRESSION_VISUAL_EXPRESSION",
    });
    expect(decisions.get("SPC_OXYMONACANTHUS_LONGIROSTRIS")).toMatchObject({
      personalityId: "LAND_DOMAIN_BOUND_CONFLICT",
      terrainSpecific: ["CORAL_REEF"],
    });

    const journals = readJsonl("research_journal.jsonl");
    const lungfish = journals.filter((row) => row.targetUnitId === "SPC_NEOCERATODUS_FORSTERI");
    expect(lungfish).toHaveLength(3);
    expect(lungfish.map((row) => row.boundedContext).join(" ")).toMatch(/do not guard eggs or young/i);

    const fourwing = journals.filter((row) => row.targetUnitId === "SPC_HIRUNDICHTHYS_AFFINIS");
    expect(fourwing).toHaveLength(3);
    expect(fourwing.every((row) => row.organization === "Food and Agriculture Organization of the United Nations")).toBe(true);
    expect(fourwing.every((row) => row.actualOpenedUrl.endsWith("/y4161e35.pdf"))).toBe(true);

    const orangeFilefish = journals.filter((row) => row.targetUnitId === "SPC_OXYMONACANTHUS_LONGIROSTRIS");
    expect(orangeFilefish).toHaveLength(3);
    expect(orangeFilefish.every((row) => row.organization === "FishBase")).toBe(true);
    expect(orangeFilefish.map((row) => row.boundedContext).join(" ")).toMatch(/exclusive diet of Acropora coral polyps/i);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 15)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01", "R14_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
