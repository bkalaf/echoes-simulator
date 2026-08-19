import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateV3ResearchRow, type ResearchField, type V3FieldResult } from "../../src/core/research/v3-contract.js";

const checkpoint = JSON.parse(readFileSync("artifacts/simulator/remediation/research/fresh_regression_research.json", "utf8")) as {
  sources: { sourceId: string; boundedContext: string; contextType: string }[];
  fieldResults: ({ breedId: string; field: ResearchField } & V3FieldResult)[];
  remainingScope: { canonicalReady: boolean };
};

describe("fresh mandatory-regression research checkpoint", () => {
  it("has bounded source context and terminal field records without prohibited regressions", () => {
    const sourceIds = new Set(checkpoint.sources.map((source) => source.sourceId));
    expect(sourceIds.size).toBe(checkpoint.sources.length);
    expect(checkpoint.sources.every((source) => source.contextType === "PARAPHRASE" && source.boundedContext.length > 20)).toBe(true);
    for (const result of checkpoint.fieldResults) {
      expect(result.evidenceRefs.every((ref) => sourceIds.has(ref))).toBe(true);
      validateV3ResearchRow({ breedId: result.breedId, populationKind: result.breedId.startsWith("BRD_HUMAN_") ? "HUMAN" : "BEAST", fields: { [result.field]: result } });
    }
    expect(checkpoint.fieldResults.find((row) => row.breedId === "BRD_FLOWERHORN_CICHLID" && row.field === "terrainSpecific")?.value).not.toContain("WORKSHOP");
    expect(checkpoint.fieldResults.find((row) => row.breedId === "BRD_MALAYAN_TAPIR" && row.field === "terrainSpecific")?.value).toEqual(expect.not.arrayContaining(["CITY", "VILLAGE"]));
    expect(checkpoint.remainingScope.canonicalReady).toBe(false);
  });
});
