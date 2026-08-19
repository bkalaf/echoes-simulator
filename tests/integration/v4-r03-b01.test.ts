import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R03_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));

describe("R03_B01 complete research gate", () => {
  it("publishes exact 19-unit and 55-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R03_B01", regionId: "R03", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 19, manifestBreeds: 55, resultUnits: 19, effectiveBreeds: 55,
        journalEntries: 57, sources: 21, citations: 57, evidence: 57,
        inheritanceEdges: 55, dimensionValuesExpected: 660, dimensionValuesMaterialized: 660,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(19);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(57);
    expect(readJsonl("sources.jsonl")).toHaveLength(21);
    expect(readJsonl("citations.jsonl")).toHaveLength(57);
    expect(readJsonl("evidence.jsonl")).toHaveLength(57);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(55);

    const effective = readJsonl("effective_breed_preview.jsonl");
    expect(effective).toHaveLength(55);
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

  it("keeps Human claims bounded to exact-Culture authored inference and Mythos claims direct", () => {
    const humanUnitIds = new Set([
      "CLT_ENGLISH_ANGLO", "CLT_FRENCH_FRANCOPHONE", "CLT_IRISH_GAELIC",
      "CLT_SCOTS_ULSTER_SCOTS", "CLT_WELSH_BRITTONIC_CELTIC",
    ]);
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      if (humanUnitIds.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
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
    expect(readJsonl("research_journal.jsonl").every((row) => row.sourceOpened === true && row.actualOpenedUrl.startsWith("http"))).toBe(true);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches).toEqual(["R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01"]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
