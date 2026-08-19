import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accrueGrowth,
  allocateEqualPopulation,
  deriveEconomicForm,
  derivePoliticalForm,
  deriveSocialProjection,
  projectRawProperties,
  projectResearchProperties,
  updateEpochLatch,
} from "../../src/core/engine/local-mechanics.js";
import { applySimultaneousTransfers, terrainSuitability } from "../../src/core/engine/flow-mechanics.js";
import { resolveSharedCalendar } from "../../src/core/events/calendar.js";
import { buildConclaveSeats, senateElectionSuffix } from "../../src/core/institutions/ledgers.js";

const propertyMapping = JSON.parse(readFileSync("resources/reference/property_faction_mapping.json", "utf8"));
const politicalRows = JSON.parse(readFileSync("resources/reference/political_form_mapping.json", "utf8")).rows;
const economicRows = JSON.parse(readFileSync("resources/reference/economic_form_mapping.json", "utf8")).rows;

describe("local historical mechanics", () => {
  it("allocates exactly and applies BigInt growth", () => {
    const allocation = allocateEqualPopulation(["B", "A", "C"], 10n);
    expect(allocation).toEqual(new Map([["A", 4n], ["B", 3n], ["C", 3n]]));
    expect(accrueGrowth(101n, "LOW")).toBe(1n);
    expect(accrueGrowth(101n, "MEDIUM")).toBe(2n);
    expect(accrueGrowth(101n, "HIGH")).toBe(2n);
    let population = 9_007_199_254_740_993n;
    for (let year = 1; year <= 2000; year += 1) population += accrueGrowth(population, "HIGH");
    expect(population > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("projects exact thresholds and complete forms", () => {
    const breeds = new Map([
      ["A", { AdministrationMode: "CENTRALIZED" }],
      ["B", { AdministrationMode: "DISTRIBUTED" }],
      ["C", { AdministrationMode: null }],
    ]);
    const projected = projectRawProperties([{ breedId: "A", population: 30n }, { breedId: "B", population: 70n }, { breedId: "C", population: 25n }], breeds, "CONCORD", propertyMapping);
    expect(projected.properties.AdministrationMode.values.CENTRALIZED.band).toBe("MID");
    expect(projected.properties.AdministrationMode.values.DISTRIBUTED.band).toBe("HIGH");
    expect(projected.properties.AdministrationMode.unresolvedPopulation).toBe(25n);
    expect(new Set(politicalRows.map((row: Record<string, string>) => derivePoliticalForm(row, politicalRows))).size).toBe(27);
    expect(new Set(economicRows.map((row: Record<string, string>) => deriveEconomicForm(row, economicRows))).size).toBe(9);
  });

  it("separates terminal null population from invalid research and blocks a zero resolved denominator", () => {
    const researched = new Map([
      ["A", { AdministrationMode: { value: "CENTRALIZED", disposition: "VERIFIED_VALUE" as const } }],
      ["B", { AdministrationMode: { value: null, disposition: "RESOLVED_NULL" as const } }],
      ["C", { AdministrationMode: { value: null, disposition: "UNRESOLVED" as const } }],
    ]);
    const projected = projectResearchProperties([{ breedId: "A", population: 5n }, { breedId: "B", population: 3n }, { breedId: "C", population: 2n }], researched, "CONCORD", propertyMapping, { worldKey: "CONCORD", year: 10, entityType: "SETTLEMENT", entityId: "S1" });
    expect(projected.properties.AdministrationMode).toMatchObject({ resolvedPopulation: 5n, terminalNullPopulation: 3n, invalidUnresearchedPopulation: 2n, winner: "CENTRALIZED" });
    expect(projected.blockers.filter((blocker) => blocker.property === "AdministrationMode").map((blocker) => blocker.issueCode)).toEqual(["INVALID_OR_UNRESEARCHED_PROPERTY_POPULATION"]);

    const zero = projectResearchProperties([{ breedId: "B", population: 3n }], researched, "CONCORD", propertyMapping, { worldKey: "CONCORD", year: 10, entityType: "STATE", entityId: "STATE_1" });
    expect(zero.blockers).toContainEqual(expect.objectContaining({ issueCode: "NO_RESOLVED_POPULATION_FOR_PROPERTY", property: "AdministrationMode", affectedPopulation: 3n }));
  });

  it("keeps latch consumption and social totals exact", () => {
    const first = updateEpochLatch(["administrationMode", "legitimacyBasis"], { administrationMode: "A", legitimacyBasis: "L" }, { administrationMode: "B", legitimacyBasis: "L" });
    const returned = updateEpochLatch(first.remaining, { administrationMode: "B", legitimacyBasis: "L" }, { administrationMode: "A", legitimacyBasis: "M" });
    expect(returned.triggered).toBe(true);
    const social = deriveSocialProjection([{ cohortId: "A", breedId: "A", wealth: 9, population: 7n }, { cohortId: "B", breedId: "B", wealth: 1, population: 4n }]);
    expect(social.tiers.HIGH + social.tiers.MID + social.tiers.LOW).toBe(11n);
    expect(Object.values(social.classes).reduce((sum, value) => sum + value, 0n)).toBe(11n);
  });
});

describe("flow, shared history, and institutions", () => {
  it("classifies terrain without guessing", () => {
    expect(terrainSuitability(["FOREST"], ["WOODLAND"], ["FOREST"], ["WOODLAND"])).toBe("NONE");
    expect(terrainSuitability(["DESERT"], ["DUNES"], ["FOREST"], ["WOODLAND"])).toBe("BROAD");
    expect(terrainSuitability(["FOREST"], ["CANOPY"], ["FOREST"], ["WOODLAND"])).toBe("SPECIFIC");
    expect(terrainSuitability([], [], ["FOREST"], ["WOODLAND"])).toBe("UNKNOWN");
  });

  it("caps simultaneous transfers and conserves population", () => {
    const result = applySimultaneousTransfers(new Map([["C1", 10n], ["C2", 4n]]), [
      { transferId: "T1", originCohortId: "C1", destinationId: "S2", proposed: 8n },
      { transferId: "T2", originCohortId: "C1", destinationId: "S3", proposed: 8n },
    ]);
    expect(result.retained.get("C1")).toBe(0n);
    expect(result.transfers.reduce((sum, transfer) => sum + transfer.amount, 0n)).toBe(10n);
    expect(result.retained.get("C2")).toBe(4n);
  });

  it("resolves one shared calendar and institution schedules", () => {
    const skeleton = JSON.parse(readFileSync("resources/reference/shared_event_skeleton.json", "utf8"));
    const calendar = resolveSharedCalendar("published-diagnostic-seed", skeleton.events);
    expect(calendar.find((event) => event.eventKey === "FOUNDING")?.resolvedYear).toBe(0);
    expect(calendar.find((event) => event.eventKey === "FOUNDING_WAVE_2")?.resolvedYear).toBe(1);
    expect(calendar.find((event) => event.eventKey === "CONJUNCTION_ERA_BOUNDARY")?.resolvedYear).toBe(2000);
    expect(calendar.some((event) => event.eventKey === "ATROCITY_08")).toBe(false);
    const seats = buildConclaveSeats("CONCORD", 100, [{ stateId: "STATE_1", settlements: [{ settlementId: "S1", siteId: "SITE-002", population: 5n }, { settlementId: "S2", siteId: "SITE-001", population: 5n }] }], false);
    expect(seats.filter((seat) => seat.type === "CITY").map((seat) => seat.siteId)).toEqual(["SITE-001", "SITE-002"]);
    expect(senateElectionSuffix("A")).toBe(5);
    expect(senateElectionSuffix("B")).toBe(0);
  });
});
