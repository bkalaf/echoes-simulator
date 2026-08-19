import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R01_B02");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R01_B02 complete research gate", () => {
  it("publishes exact 38-unit and 41-Breed PASS artifacts with a cumulative R01 preview", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R01_B02", regionId: "R01", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 38, manifestBreeds: 41, resultUnits: 38, effectiveBreeds: 41,
        journalEntries: 114, citations: 114, evidence: 114, inheritanceEdges: 41,
        dimensionValuesExpected: 492, dimensionValuesMaterialized: 492,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(38);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(114);
    expect(readJsonl("citations.jsonl")).toHaveLength(114);
    expect(readJsonl("evidence.jsonl")).toHaveLength(114);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(41);
    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(41);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    const humanUnitIds = new Set(["CLT_ANISHINAABE", "CLT_DINE_NAVAJO", "CLT_HAUDENOSAUNEE", "CLT_HOPI", "CLT_MISSISSIPPIAN_EASTERN_WOODLANDS"]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      const expected = humanUnitIds.has(journal.targetUnitId) && journal.targetField === "personalityId"
        ? "EIDOLON_AUTHORED_INFERENCE"
        : "ACCEPTED_DIRECT_EVIDENCE";
      expect(citation.claimAlignment).toBe(expected);
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
    const r01b01 = readJsonl("../R01_B01/effective_breed_preview.jsonl");
    expect(r01b01.length + effective.length).toBe(121);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches).toEqual(["R01_B01", "R01_B02"]);
  });
});
