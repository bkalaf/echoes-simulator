import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R19_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set(["CLT_KANAKA_MAOLI_HAWAIIAN", "CLT_MAORI", "CLT_MELANESIAN_PAPUAN", "CLT_MICRONESIAN", "CLT_POLYNESIAN_ISLANDS"]);
const mythos = new Set(["SPC_OGRUS_CHENOO", "SPC_OGRUS_ETTIN", "SPC_OGRUS_OGRE", "SPC_OGRUS_ONI", "SPC_OGRUS_TROLL"]);

describe("R19_B01 complete research gate", () => {
  it("publishes exact 22-unit and 47-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({ batchId: "R19_B01", regionId: "R19", status: "PASS", criticalNulls: 0, unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0, twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 22, manifestBreeds: 47, resultUnits: 22, effectiveBreeds: 47, journalEntries: 66, sources: 22, citations: 66, evidence: 66, inheritanceEdges: 47, dimensionValuesExpected: 564, dimensionValuesMaterialized: 564 }, regionPreview: { status: "PASS" } });
    for (const [name, count] of [["unit_results.jsonl",22],["research_journal.jsonl",66],["sources.jsonl",22],["citations.jsonl",66],["evidence.jsonl",66],["inheritance_edges.jsonl",47]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) { validateEffectiveBreedSemantics(row, personalityIds); expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort()); }
    for (const world of ["CONCORD","SCHISM","RUIN"]) { const preview = report.regionPreview.worlds[world]; expect(preview.totalPopulation).toBe("53017"); expect(preview.noResolvedPopulationIssues).toEqual([]); for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation); }
  });

  it("separates Human inference, Beast behavior, and exact-tradition Mythos evidence", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId,row]));
    for (const citation of readJsonl("citations.jsonl")) {
      const journal = journals.get(citation.citationId.replace(/^CIT_/,""))!;
      expect(journal.sourceOpened).toBe(true); expect(journal.boundedContext.length).toBeGreaterThan(40); expect(journal.sourceFact.length).toBeGreaterThan(40);
      if (humans.has(journal.targetUnitId)) { expect(citation.subjectAlignment).toBe("EXACT_CULTURE"); expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE"); }
      else if (mythos.has(journal.targetUnitId)) { expect(citation.subjectAlignment).toBe("EXACT_TRADITIONAL_ENTITY"); expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE"); }
      else { expect(citation.subjectAlignment).toBe("EXACT_SPECIES"); expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE"); }
    }
    for (const decision of readJsonl("research_decisions.jsonl")) {
      if (humans.has(decision.researchUnitId)) expect(decision.personalityBridge).toMatch(/not an inherent psychology/i);
      else if (mythos.has(decision.researchUnitId)) expect(decision.personalityBridge).toMatch(/direct traditional-entity mapping/i);
      else expect(decision.personalityBridge).toMatch(/direct behavior mapping/i);
    }
  });

  it("locks parrot cognition, cultural transmission, inward Mythos mappings, and batch order", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    for (const id of ["SPC_CACATUA_GALERITA","SPC_NESTOR_NOTABILIS","SPC_PSITTACUS_ERITHACUS"]) expect(decisions.get(id)).toMatchObject({ personalityId: "CURIOSITY_PROBLEM_SOLVING_EXPRESSION" });
    expect(decisions.get("SPC_PROBOSCIGER_ATERRIMUS")).toMatchObject({ personalityId: "EXPRESSION_TACTILE_EXPRESSION" });
    expect(decisions.get("SPC_STRIGOPS_HABROPTILUS")).toMatchObject({ personalityId: "RECOGNITION_COURTSHIP_DISPLAY_EXPRESSION" });
    expect(decisions.get("CLT_MICRONESIAN")).toMatchObject({ personalityId: "COLLECTIVE_MEMORY_TECHNIQUE_TRADITION" });
    expect(decisions.get("SPC_OGRUS_OGRE")).toMatchObject({ personalityId: "AMBIGUITY_UNFIXED_FORM_CONFLICT" });
    expect(decisions.get("SPC_OGRUS_TROLL")).toMatchObject({ personalityId: "BOUNDARIES_DOMAIN_BOUND_CONFLICT" });
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    expect(architecture.completedRegionBatches.slice(19, 21)).toEqual(["R18_B01","R19_B01"]); expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(21); expect(architecture.status).toBe("ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS");
  });
});
