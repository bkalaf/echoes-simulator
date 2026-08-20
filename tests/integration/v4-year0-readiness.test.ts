import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS } from "../../src/core/research/v4-contract.js";

const report = JSON.parse(readFileSync(resolve("resources/canonical/integrity/year0_readiness.json"), "utf8"));

describe("V4 canonical year-0 readiness", () => {
  it("calculates all 72 SettlementWorlds with complete denominator and governing context", () => {
    expect(report).toMatchObject({ status: "PASS", worlds: 3, physicalSettlements: 24, settlementWorlds: 72, propertyChecks: 864, noResolvedPopulationIssues: 0, nullDominantFaction: 0, nullPoliticalForm: 0, nullEconomicForm: 0, nullDominantBreed: 0 });
    expect(report.settlementWorldResults).toHaveLength(72);
    for (const row of report.settlementWorldResults) {
      expect(row).toMatchObject({ dominantFaction: expect.any(String), politicalForm: expect.any(String), economicForm: expect.any(String), dominantBreed: expect.any(String) });
      expect(row.criticalFailures).toEqual([]);
      expect(Object.keys(row.propertyCoverage)).toHaveLength(RAW_DIMENSIONS.length);
      expect(Object.values(row.propertyCoverage).every((coverage: any) => coverage.resolvedPopulation === coverage.totalPopulation)).toBe(true);
    }
  });

  it("represents no-Human founding Culture explicitly without null governing context", () => {
    const noHuman = report.settlementWorldResults.filter((row: any) => row.cultureState === "NO_HUMAN_FOUNDING_CULTURE");
    expect(noHuman).toHaveLength(12);
    expect(new Set(noHuman.map((row: any) => row.regionId))).toEqual(new Set(["R05", "R12", "R20", "R25"]));
    expect(noHuman.every((row: any) => row.cultureId === null && row.humanPopulation === "0" && row.dominantBreed && row.dominantSpeciesKind !== "HUMAN")).toBe(true);
  });

  it("records a build-ready bundle instead of an operator validation state", () => {
    const manifest = JSON.parse(readFileSync(resolve("resources/canonical/canonical_bundle_manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ breedSemanticVersion: "V4", breedSemanticVerdict: "ACCEPT_SIMULATION_READY", year0ReadinessStatus: "PASS", buildReady: true });
  });
});
