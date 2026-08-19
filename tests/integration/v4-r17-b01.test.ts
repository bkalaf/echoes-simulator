import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R17_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humanCultures = new Set([
  "CLT_AFRICAN_AMERICAN",
  "CLT_AFRO_LATIN_AMERICAN_AFRO_BAHIAN",
  "CLT_CENTRAL_AND_GREAT_LAKES_AFRICAN_KONGO_BANTU_TWA",
  "CLT_EDO_BENIN_NIGER_DELTA",
  "CLT_FRANCOPHONE_CARIBBEAN_CREOLE",
  "CLT_GULF_VOLTA_WEST_AFRICAN_AKAN_GBE_GUR",
  "CLT_GULLAH_GEECHEE",
  "CLT_IGBO",
  "CLT_UPPER_GUINEA_MANDE_KRU_TEMNE",
  "CLT_YORUBA",
]);

describe("R17_B01 complete research gate", () => {
  it("publishes exact 48-unit and 107-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R17_B01", regionId: "R17", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: {
        manifestUnits: 48, manifestBreeds: 107, resultUnits: 48, effectiveBreeds: 107,
        journalEntries: 144, sources: 48, citations: 144, evidence: 144,
        inheritanceEdges: 107, dimensionValuesExpected: 1284, dimensionValuesMaterialized: 1284,
      },
      regionPreview: { status: "PASS" },
    });
    expect(readJsonl("unit_results.jsonl")).toHaveLength(48);
    expect(readJsonl("research_journal.jsonl")).toHaveLength(144);
    expect(readJsonl("sources.jsonl")).toHaveLength(48);
    expect(readJsonl("citations.jsonl")).toHaveLength(144);
    expect(readJsonl("evidence.jsonl")).toHaveLength(144);
    expect(readJsonl("inheritance_edges.jsonl")).toHaveLength(107);

    const effective = readJsonl("effective_breed_preview.jsonl");
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    expect(effective).toHaveLength(107);
    for (const row of effective) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      expect(preview.totalPopulation).toBe("120696");
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) {
        expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
      }
    }
  });

  it("separates exact-species evidence from qualified Human inference", () => {
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
        expect(decision.personalityBridge).toMatch(/direct behavior mapping/i);
      }
    }
  });

  it("locks incubation engineering, paternal care, carried water, and living traditions", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    for (const unitId of ["SPC_ALECTURA_LATHAMI", "SPC_LEIPOA_OCELLATA", "SPC_MACROCEPHALON_MALEO", "SPC_MEGAPODIUS_LAPEROUSE"]) {
      expect(decisions.get(unitId)).toMatchObject({ personalityId: "CONTROL_ENVIRONMENT_ENGINEERING_EXPRESSION" });
    }
    for (const unitId of ["SPC_CASUARIUS_BENNETTI", "SPC_CASUARIUS_CASUARIUS", "SPC_CASUARIUS_UNAPPENDICULATUS", "SPC_RHEA_AMERICANA", "SPC_RHEA_PENNATA"]) {
      expect(decisions.get(unitId)).toMatchObject({ personalityId: "PROTECTION_YOUNG_SHIELDING_EXPRESSION" });
    }
    for (const unitId of ["SPC_PTEROCLES_ALCHATA", "SPC_PTEROCLES_EXUSTUS", "SPC_PTEROCLES_NAMAQUA"]) {
      expect(decisions.get(unitId)).toMatchObject({ personalityId: "CARE_CARRYING_EXPRESSION" });
    }
    expect(decisions.get("CLT_GULLAH_GEECHEE")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("CLT_IGBO")).toMatchObject({ personalityId: "COOPERATION_CIRCLE_DEPENDENT_POWER_CONFLICT" });
    expect(decisions.get("CLT_YORUBA")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });

    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(0, 19)).toEqual([
      "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01",
      "R06_B01", "R07_B01", "R08_B01", "R09_B01", "R11_B01", "R12_B01", "R13_B01",
      "R14_B01", "R14_B02", "R15_B01", "R16_B01", "R17_B01",
    ]);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
