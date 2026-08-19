import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvFile } from "../../src/core/inputs/importer.js";
import { reconcileResearchUnitIndex } from "../../src/core/research/v4-contract.js";

describe("V4 architecture lock", () => {
  it("reconciles all 1,219 units and 1,773 civic Breeds against the current registry", () => {
    const pack = resolve("ECHOES_OF_EIDOLON_RESEARCH_V4_CODEX_PROMPT_PACK_2026-08-19");
    const unitIndex = JSON.parse(readFileSync(resolve(pack, "units/RESEARCH_UNIT_INDEX.json"), "utf8"));
    const ownerPack = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
    const breeds = parseCsvFile(resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv"));
    const assignments = parseCsvFile(resolve(ownerPack, "INPUTS/region_species_group_assignments(1).csv"));
    expect(reconcileResearchUnitIndex(unitIndex, breeds, assignments.map((row) => ({ groupId: row.groupId!, regionId: row.regionId! })))).toEqual({ units: 1219, civicBreeds: 1773 });
  });

  it("defines every required V4 record and marks simulation-critical fields", () => {
    const schema = JSON.parse(readFileSync(resolve("resources/contracts/research-v4.schema.json"), "utf8"));
    expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining(["researchUnit", "researchJournal", "source", "citation", "evidence", "unitResult", "inheritanceEdge", "personalityPolicyProfile", "effectiveBreedSemantics", "auditFinding"]));
    expect(schema.simulationCritical).toHaveLength(15);
    expect(schema.authoringEnrichment).toEqual(["traits", "foodBroad", "foodSpecific"]);
  });
});
