import { describe, expect, it } from "vitest";
import { mergeBreedRows, validateZipEntries } from "../../src/core/inputs/importer.js";

describe("V3 Breed research precedence", () => {
  it("keeps V3 terminal nulls while retaining only whitelisted legacy metadata", () => {
    const merged = mergeBreedRows(
      { breedId: "BRD_TEST", name: "Test", speciesId: "SPC_TEST", populationKind: "BEAST", groupId: "B01", cultureId: null, personalityId: null, terrainBroad: [], administrationMode: null },
      { breedId: "BRD_TEST", name: "Test", speciesId: "SPC_TEST", populationKind: "BEAST", groupId: "B01", cultureId: "", personalityId: "REJECTED_OLD", terrainBroad: "[\"FOREST\"]", administrationMode: "CENTRALIZED", regionId: "R01", parentBreedId: "BRD_PARENT" },
    );
    expect(merged.personalityId).toBeNull();
    expect(merged.terrainBroad).toEqual([]);
    expect(merged.administrationMode).toBeNull();
    expect(merged.regionId).toBe("R01");
    expect(merged.provenance.personalityId).toBe("V3_RESEARCH");
    expect(merged.provenance.regionId).toBe("LEGACY_METADATA");
  });

  it("does not treat legacy semantic identity columns as competing authority", () => {
    const merged = mergeBreedRows(
      { breedId: "A", name: "One", speciesId: "S", populationKind: "BEAST", groupId: "B01", cultureId: null },
      { breedId: "A", name: "Stale legacy name", speciesId: "STALE", populationKind: "HUMAN", groupId: "H24", cultureId: "CLT_STALE", regionId: "R01" },
    );
    expect(merged).toMatchObject({ name: "One", speciesId: "S", populationKind: "BEAST", groupId: "B01", cultureId: null, regionId: "R01" });
    expect(() => mergeBreedRows({ breedId: "A" }, { breedId: "B" })).toThrow(/breedId/i);
  });

  it("rejects unsafe ZIP names", () => {
    expect(() => validateZipEntries(["../escape.json"])).toThrow(/unsafe/i);
    expect(() => validateZipEntries(["/absolute.json"])).toThrow(/unsafe/i);
  });
});
