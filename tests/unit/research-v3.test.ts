import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildV3ResearchQueue, validateV3ResearchRow } from "../../src/core/research/v3-contract.js";

const pack = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");

describe("V3 Breed research authority", () => {
  it("opens every August 17 Breed field for independent research except explicit PET policy nulls", () => {
    const archive = unzipSync(readFileSync(resolve(pack, "echoes_of_eidolon_breed_research_2026-08-17.zip")));
    const entry = Object.entries(archive).find(([name]) => name.endsWith("/breed_classifications.jsonl"))?.[1];
    expect(entry).toBeDefined();
    const breeds = strFromU8(entry!).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const queue = buildV3ResearchQueue(breeds);
    expect(breeds).toHaveLength(2056);
    expect(queue).toHaveLength(37_008);
    expect(queue.filter((task) => task.disposition === "POLICY_NULL")).toHaveLength(3_679);
    expect(queue.filter((task) => task.disposition === "UNRESOLVED")).toHaveLength(33_329);
    expect(queue.filter((task) => task.populationKind === "PET" && ["personalityId", ...taskDimensionFields].includes(task.field))).toSatisfy((tasks: typeof queue) => tasks.every((task) => task.disposition === "POLICY_NULL"));
  });

  it("rejects an unresolved or unsupported row as simulator semantic authority", () => {
    expect(() => validateV3ResearchRow({ breedId: "BRD_TEST", populationKind: "BEAST", fields: { motivation: { value: "RECIPROCAL", disposition: "UNRESOLVED", evidenceRefs: [] } } })).toThrow("BRD_TEST.motivation");
    expect(() => validateV3ResearchRow({ breedId: "BRD_TEST", populationKind: "BEAST", fields: { motivation: { value: "RECIPROCAL", disposition: "VERIFIED_VALUE", evidenceRefs: [] } } })).toThrow("evidence");
  });
});

const taskDimensionFields = ["motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture"];
