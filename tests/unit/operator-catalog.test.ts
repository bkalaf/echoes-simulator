import { describe, expect, it } from "vitest";
import { loadAtlasPois } from "../../src/core/atlas/atlas-view.js";
import { loadBreedCatalog } from "../../src/core/breeds/breed-catalog.js";

describe("operator reference catalogs", () => {
  it("loads all POIs without introducing Settlement markers", () => {
    const pois = loadAtlasPois("resources/canonical");
    expect(pois).toHaveLength(92);
    expect(pois.every((poi) => poi.poiId.startsWith("POI-") && Number.isFinite(poi.latitude) && Number.isFinite(poi.longitude))).toBe(true);
    expect(pois[0]).not.toHaveProperty("settlementId");
  });

  it("supports exact Breed, Species common, scientific, and identifier search fields", async () => {
    const catalog = await loadBreedCatalog("resources/canonical");
    expect(catalog).toHaveLength(2_062);
    expect(catalog.find((breed) => breed.breedId === "BRD_AARDVARK")).toMatchObject({
      name: "Aardvark",
      speciesName: "Aardvark",
      scientificName: "Orycteropus afer",
      speciesId: "SPC_ORYCTEROPUS_AFER",
      factionObject: { CONCORD: expect.any(Number), SCHISM: expect.any(Number), RUIN: expect.any(Number) },
      dominantFaction: expect.arrayContaining([expect.stringMatching(/^(CONCORD|SCHISM|RUIN)$/)]),
    });
    expect(catalog.find((breed) => breed.breedId === "BRD_RED_HANDFISH")).toMatchObject({
      name: "Red handfish",
      speciesName: "Red handfish",
      scientificName: "Thymichthys politus",
      speciesId: "SPC_THYMICHTHYS_POLITUS",
    });
    expect(catalog.find((breed) => breed.breedId === "BRD_VOGELKOP_SUPERB_BIRD_OF_PARADISE")).toMatchObject({
      name: "Vogelkop superb bird-of-paradise",
      speciesName: "Vogelkop superb bird-of-paradise",
      scientificName: "Lophorina niedda",
      speciesId: "SPC_LOPHORINA_NIEDDA",
    });
    expect(catalog.every((breed) => breed.factionObject && Array.isArray(breed.dominantFaction))).toBe(true);
  }, 20_000);
});
