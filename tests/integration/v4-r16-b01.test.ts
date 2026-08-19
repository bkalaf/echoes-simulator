import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R16_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humanCultures = new Set([
  "CLT_BALINESE",
  "CLT_INDIAN_OCEAN_MUSLIM_CAPE_MALAY_MALDIVIAN",
  "CLT_JAVA_JAVANESE_SUNDANESE",
  "CLT_KHMER",
  "CLT_LOWLAND_FILIPINO_TAGALOG_VISAYAN",
  "CLT_MARITIME_AUSTRONESIAN_MALAYIC_BORNEAN_TIMORESE",
  "CLT_MYANMAR_MAINLAND_SOUTHEAST_ASIAN_HIGHLAND",
  "CLT_TAI_THAI_LAO_LANNA",
  "CLT_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD",
  "CLT_VIETNAMESE",
]);

describe("R16_B01 complete research gate", () => {
  it("publishes exact 13-unit and 51-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R16_B01", regionId: "R16", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 13, manifestBreeds: 51, resultUnits: 13, effectiveBreeds: 51,
        journalEntries: 39, sources: 13, citations: 39, evidence: 39,
        inheritanceEdges: 51, dimensionValuesExpected: 612, dimensionValuesMaterialized: 612,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(13);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(39);
    expect(readJsonl("sources.jsonl")).toHaveLength(13);
    expect(readJsonl("citations.jsonl")).toHaveLength(39);
    expect(readJsonl("evidence.jsonl")).toHaveLength(39);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(51);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(51);
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.totalPopulation).toBe("57528");
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) {
        expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
      }
    }
  });

  it("separates qualified Human inference from direct traditional-entity mapping", () => {
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
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humanCultures.has(decision.researchUnitId)) {
        expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
        expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      } else {
        expect(decision.inferenceClassification).toBe("DIRECT_BEHAVIOR_MAPPING");
        expect(decision.personalityBridge).toMatch(/direct traditional-entity mapping/i);
      }
    }
  });

  it("locks hydraulic traditions, boundary wounds, and exact dragon-form tensions", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("CLT_BALINESE")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("CLT_KHMER")).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("CLT_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("CLT_MYANMAR_MAINLAND_SOUTHEAST_ASIAN_HIGHLAND")).toMatchObject({ personalityId: "BOUNDARIES_LAND_BOUNDARY_WOUND" });
    expect(decisions.get("SPC_DRACO_MOO")).toMatchObject({
      personalityId: "AMBIGUITY_BLESSING_CURSE_CONFLICT",
      terrainSpecific: ["CAVE", "POND", "RIVER", "ISLAND", "COASTAL_CLIFF"],
    });
    expect(decisions.get("SPC_DRACO_NAGA")).toMatchObject({ personalityId: "AMBIGUITY_UNFIXED_FORM_CONFLICT" });

    const humans = readJsonl("research_journal.jsonl").filter((row) => humanCultures.has(row.targetUnitId));
    expect(humans).toHaveLength(30);
    expect(humans.every((row) => row.actualOpenedUrl.startsWith("https://"))).toBe(true);

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 18)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01",
      "R14_B01", "R14_B02", "R15_B01", "R16_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
