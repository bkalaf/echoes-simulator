import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R04_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R04_B01 complete research gate", () => {
  it("publishes exact 47-unit and 68-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R04_B01", regionId: "R04", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 47, manifestBreeds: 68, resultUnits: 47, effectiveBreeds: 68,
        journalEntries: 141, sources: 47, citations: 141, evidence: 141,
        inheritanceEdges: 68, dimensionValuesExpected: 816, dimensionValuesMaterialized: 816,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(47);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(141);
    expect(readJsonl("sources.jsonl")).toHaveLength(47);
    expect(readJsonl("citations.jsonl")).toHaveLength(141);
    expect(readJsonl("evidence.jsonl")).toHaveLength(141);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(68);

    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(68);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
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
      expect(BigInt(preview.totalPopulation)).toBeGreaterThan(0n);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("keeps Human claims bounded to authored exact-Culture inference and Mythos claims exact", () => {
    const humanUnitIds = new Set([
      "CLT_EAST_AFRICAN_BANTU_SWAHILI_COMORIAN", "CLT_ETHIOPIAN_ERITREAN_HIGHLANDS_AND_SOUTH",
      "CLT_INDIAN_OCEAN_CREOLE", "CLT_MAASAI_NILOTIC_EAST_AFRICA", "CLT_MALAGASY",
    ]);
    const mythosUnitIds = new Set([
      "SPC_AQUASPIRITUS_ADARO", "SPC_AQUASPIRITUS_KAPPA", "SPC_AQUASPIRITUS_KELPIE",
      "SPC_AQUASPIRITUS_NAIAD", "SPC_AQUASPIRITUS_RUSALKA", "SPC_AQUASPIRITUS_UNDINE",
      "SPC_AQUASPIRITUS_VODYANOY",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      if (humanUnitIds.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      }
      if (mythosUnitIds.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl").filter((row) => humanUnitIds.has(row.researchUnitId))) {
      expect(decision.inferenceClassification).toBe("EIDOLON_AUTHORED_INFERENCE");
      expect(decision.personalityBridge).toMatch(/not an inherent/i);
    }
  });

  it("records opened evidence and advances the locked run order exactly once", () => {
    const journals = readJsonl("research_journal.jsonl");
    expect(journals.every((row) => row.sourceOpened === true && row.actualOpenedUrl.startsWith("http"))).toBe(true);
    expect(new Set(journals.map((row) => row.journalEntryId)).size).toBe(141);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 6)).toEqual(["R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01"]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
