import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R24_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set(["CLT_CARIBBEAN_INDIGENOUS_TAINO", "CLT_MAYA_CULTURAL_CONTINUUM", "CLT_MEXICA_AZTEC", "CLT_MIXTEC_NUU_SAVI", "CLT_ZAPOTEC"]);
const automata = new Set(["SPC_AUTOMATON_GARGOYLE", "SPC_AUTOMATON_HOMUNCULUS", "SPC_AUTOMATON_HOROLOGICUM", "SPC_AUTOMATON_LORICATUM", "SPC_AUTOMATON_SIMULACRUM", "SPC_AUTOMATON_STRAMENTARIUM"]);

describe("R24_B01 complete research gate", () => {
  it("publishes exact 46-unit and 56-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({
      batchId: "R24_B01", regionId: "R24", status: "PASS", criticalNulls: 0,
      unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0,
      twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 46, manifestBreeds: 56, resultUnits: 46, effectiveBreeds: 56, journalEntries: 138, sources: 49, citations: 138, evidence: 138, inheritanceEdges: 56, dimensionValuesExpected: 672, dimensionValuesMaterialized: 672 },
      regionPreview: { status: "PASS" },
    });
    for (const [name, count] of [["unit_results.jsonl",46],["research_journal.jsonl",138],["sources.jsonl",49],["citations.jsonl",138],["evidence.jsonl",138],["inheritance_edges.jsonl",56]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) {
      validateEffectiveBreedSemantics(row, personalityIds);
      expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort());
    }
    for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
      const preview = report.regionPreview.worlds[world];
      expect(preview.totalPopulation).toBe("63169");
      expect(preview.noResolvedPopulationIssues).toEqual([]);
      for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation);
    }
  });

  it("separates exact species, exact Culture, and exact traditional-entity evidence", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId, row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/, ""))!;
      expect(journal.sourceOpened).toBe(true);
      expect(journal.boundedContext.length).toBeGreaterThan(40);
      expect(journal.sourceFact.length).toBeGreaterThan(40);
      if (humans.has(journal.targetUnitId)) {
        expect(citation.subjectAlignment).toBe("EXACT_CULTURE");
        expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE");
      } else {
        expect(citation.subjectAlignment).toBe(automata.has(journal.targetUnitId) ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES");
        expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE");
      }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humans.has(decision.researchUnitId)) expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
    }
  });

  it("locks representative reptile, Culture, automaton, and batch-order semantics", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId, row]));
    expect(decisions.get("SPC_SPHENODON_PUNCTATUS")).toMatchObject({ personalityId: "BOUNDARIES_DOMAIN_BOUND_CONFLICT", terrainSpecific: ["WOODLAND", "ISLAND", "BURROW"] });
    expect(decisions.get("SPC_TRIBOLONOTUS_GRACILIS")).toMatchObject({ personalityId: "DUTY_NEST_DUTY_EXPRESSION" });
    expect(decisions.get("SPC_VARANUS_KOMODOENSIS")).toMatchObject({ personalityId: "PATIENCE_AMBUSH_PATIENCE_EXPRESSION" });
    expect(decisions.get("CLT_MEXICA_AZTEC")).toMatchObject({ personalityId: "COOPERATION_CIRCLE_DEPENDENT_POWER_CONFLICT" });
    expect(decisions.get("CLT_ZAPOTEC")).toMatchObject({ personalityId: "STEWARDSHIP_HABITAT_ENGINEERING_EXPRESSION" });
    expect(decisions.get("SPC_AUTOMATON_LORICATUM")).toMatchObject({ personalityId: "AUTHENTICITY_SHAPE_WITHOUT_SELF_CONFLICT" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(25, 27)).toEqual(["R23_B01", "R24_B01"]);
    expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(27);
    expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
