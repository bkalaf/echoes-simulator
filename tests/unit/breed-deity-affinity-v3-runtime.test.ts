import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBreedCatalog } from "../../src/core/breeds/breed-catalog.js";

const canonicalDirectory = resolve(process.cwd(), "resources/canonical");

describe("Breed primary-deity V3 runtime authority", () => {
  it("covers the complete 2,062-Breed V4 authority and exposes the six recovered records", async () => {
    const catalog = await loadBreedCatalog(canonicalDirectory);
    expect(catalog).toHaveLength(2062);
    expect(new Set(catalog.map((breed) => breed.breedId)).size).toBe(2062);
    expect(catalog.filter((breed) => breed.deityClassificationStatus === "REVIEW_REQUIRED")).toHaveLength(292);

    const expected = new Map([
      ["BRD_CLOCKWORK_AUTOMATON", "Orun-IX"],
      ["BRD_HUMAN_ITALIAN_CENTRAL_MEDITERRANEAN_SAMMARINESE", "Miren"],
      ["BRD_HUMAN_OGHUZ_TURKIC_CRIMEAN_TATAR", "Sterna"],
      ["BRD_OREAD", "Kharad"],
      ["BRD_SATYR", "Selen"],
      ["BRD_SCALY_TAILED_POSSUM", "Kharad"],
    ]);
    for (const [breedId, deity] of expected) {
      const breed = catalog.find((candidate) => candidate.breedId === breedId);
      expect(breed, breedId).toBeDefined();
      expect(breed?.deityClassificationStatus).toBe("CLASSIFIED");
      expect(breed?.primaryDeity).toBe(deity);
      expect(breed?.provisionalDeity).toBeNull();
    }
  });

  it("keeps unresolved affinities visibly provisional rather than promoting them", async () => {
    const catalog = await loadBreedCatalog(canonicalDirectory);
    const unresolved = catalog.filter((breed) => breed.deityClassificationStatus === "REVIEW_REQUIRED");
    expect(unresolved.length).toBeGreaterThan(0);
    for (const breed of unresolved) {
      expect(breed.primaryDeity).toBeNull();
      expect(breed.provisionalDeity).toBeTruthy();
    }
  });
});
