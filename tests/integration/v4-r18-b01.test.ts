import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, validateEffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

const directory = resolve("artifacts/research-v4/batches/R18_B01");
const readJsonl = (name: string): Record<string, any>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const humans = new Set(["CLT_AFRIKANER", "CLT_ANGLOPHONE_ATLANTIC_CREOLE_MAROON", "CLT_SAN_KHOEKHOE", "CLT_SOUTHERN_AFRICAN_BANTU_NGUNI_SOTHO_TSWANA", "CLT_ZAMBEZI_ZIMBABWE_MOZAMBIQUE_BANTU"]);

describe("R18_B01 complete research gate", () => {
  it("publishes exact 46-unit and 87-Breed PASS artifacts", () => {
    const report = JSON.parse(readFileSync(resolve(directory, "batch_report.json"), "utf8"));
    expect(report).toMatchObject({ batchId: "R18_B01", regionId: "R18", status: "PASS", criticalNulls: 0, unresolvedCriticalFields: 0, invalidPersonalityIds: 0, invalidTerrainValues: 0, twelveDimensionMaterializationPercent: 100,
      counts: { manifestUnits: 46, manifestBreeds: 87, resultUnits: 46, effectiveBreeds: 87, journalEntries: 138, sources: 46, citations: 138, evidence: 138, inheritanceEdges: 87, dimensionValuesExpected: 1044, dimensionValuesMaterialized: 1044 }, regionPreview: { status: "PASS" } });
    for (const [name, count] of [["unit_results.jsonl",46],["research_journal.jsonl",138],["sources.jsonl",46],["citations.jsonl",138],["evidence.jsonl",138],["inheritance_edges.jsonl",87]] as const) expect(readJsonl(name)).toHaveLength(count);
    const personalityIds = new Set(registry.map((row) => row.personalityId));
    for (const row of readJsonl("effective_breed_preview.jsonl")) { validateEffectiveBreedSemantics(row, personalityIds); expect(Object.keys(row.dimensions).sort()).toEqual([...RAW_DIMENSIONS].sort()); }
    for (const world of ["CONCORD","SCHISM","RUIN"]) { const preview = report.regionPreview.worlds[world]; expect(preview.totalPopulation).toBe("98139"); expect(preview.noResolvedPopulationIssues).toEqual([]); for (const coverage of Object.values(preview.propertyCoverage) as any[]) expect(coverage.resolvedPopulation).toBe(preview.totalPopulation); }
  });

  it("keeps Human inference qualified and every species chain exact", () => {
    const journals = new Map(readJsonl("research_journal.jsonl").map((row) => [row.journalEntryId,row]));
    for (const citation of readJsonl("citations.jsonl")) { const journal = journals.get(citation.citationId.replace(/^CIT_/,""))!; expect(journal.sourceOpened).toBe(true); expect(journal.boundedContext.length).toBeGreaterThan(40); expect(journal.sourceFact.length).toBeGreaterThan(40); if (humans.has(journal.targetUnitId)) { expect(citation.subjectAlignment).toBe("EXACT_CULTURE"); expect(citation.claimAlignment).toBe(journal.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE"); } else { expect(citation.subjectAlignment).toBe("EXACT_SPECIES"); expect(citation.claimAlignment).toBe("ACCEPTED_DIRECT_EVIDENCE"); } }
    for (const decision of readJsonl("research_decisions.jsonl")) if (humans.has(decision.researchUnitId)) expect(decision.personalityBridge).toMatch(/not an inherent psychology/i); else expect(decision.personalityBridge).toMatch(/direct behavior mapping/i);
  });

  it("locks tool use, seed dispersal, desert endurance, and opened white-rhino authority", () => {
    const decisions = new Map(readJsonl("research_decisions.jsonl").map((row) => [row.researchUnitId,row]));
    expect(decisions.get("SPC_NEOPHRON_PERCNOPTERUS")).toMatchObject({ personalityId: "CURIOSITY_PROBLEM_SOLVING_EXPRESSION" });
    for (const id of ["SPC_TAPIRUS_BAIRDII","SPC_TAPIRUS_INDICUS","SPC_TAPIRUS_PINCHAQUE","SPC_TAPIRUS_TERRESTRIS"]) expect(decisions.get(id)).toMatchObject({ personalityId: "STEWARDSHIP_SEED_DISPERSAL_EXPRESSION" });
    expect(decisions.get("SPC_EQUUS_AFRICANUS")).toMatchObject({ personalityId: "PERSEVERANCE_DROUGHT_OR_COLD_ENDURANCE_EXPRESSION" });
    const whiteRhino = readJsonl("research_journal.jsonl").filter((row) => row.targetUnitId === "SPC_CERATOTHERIUM_SIMUM");
    expect(whiteRhino).toHaveLength(3); expect(whiteRhino.every((row) => row.actualOpenedUrl === "https://animals.sandiegozoo.org/animals/white-rhinoceros")).toBe(true);
    const architecture = JSON.parse(readFileSync(resolve("artifacts/simulator/v4/ARCHITECTURE_LOCK.json"), "utf8"));
    const r18Index = architecture.completedRegionBatches.indexOf("R18_B01");
    expect(r18Index).toBe(19); expect(architecture.completedRegionBatches[r18Index - 1]).toBe("R17_B01"); expect(architecture.completedRegionBatches.length).toBeGreaterThanOrEqual(20); expect(architecture.status).toBe("ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE");
  });
});
