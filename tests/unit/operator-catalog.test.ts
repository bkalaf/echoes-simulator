import { describe, expect, it } from "vitest";
import { loadAtlasPois } from "../../src/core/atlas/atlas-view.js";
import { filterBreedCatalog } from "../../src/ui/breed-detail.js";

describe("operator reference catalogs", () => {
  it("loads all POIs without introducing Settlement markers", () => {
    const pois = loadAtlasPois("resources/canonical");
    expect(pois).toHaveLength(92);
    expect(pois.every((poi) => poi.poiId.startsWith("POI-") && Number.isFinite(poi.latitude) && Number.isFinite(poi.longitude))).toBe(true);
    expect(pois[0]).not.toHaveProperty("settlementId");
  });

  it("supports exact Breed, Species common, scientific, and identifier search fields", () => {
    const catalog = [{ breedId: "BRD_AARDVARK", name: "Aardvark", speciesName: "Aardvark", scientificName: "Orycteropus afer", speciesId: "SPC_ORYCTEROPUS_AFER", populationKind: "BEAST", groupId: "G01", cultureId: null, factionObject: { CONCORD: 5, SCHISM: 3, RUIN: 4 }, dominantFaction: ["CONCORD" as const], primaryDeity: "Damor", provisionalDeity: null, deityClassificationStatus: "CLASSIFIED" as const }];
    for (const query of ["aardvark", "orycteropus", "brd_aardvark", "spc_orycteropus", "g01", "damor"]) expect(filterBreedCatalog(catalog, query)).toHaveLength(1);
  });
});
