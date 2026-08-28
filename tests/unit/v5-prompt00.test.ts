import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, diagnosticCandidateOwnerInputsV1, type CanonicalDataV5 } from "../../src/core/v5/config.js";
import { worldPopulation } from "../../src/core/v5/derivations.js";
import { destinationAttractiveness, desiredMigrationOutflow, executeCanonicalFoundingWave, migrationPush, reviewVoluntaryMigration } from "../../src/core/v5/migration.js";
import { buildScheduledTransactionsV5 } from "../../src/core/v5/schedule.js";
import type { DerivedMetricsV1, SettlementV5, WorldStateV5 } from "../../src/core/v5/types.js";

const sectors = { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } as const;
const breed = { breedId: "BRD_A", populationKind: "HUMAN" as const, groupId: "H01", factionObject: { CONCORD: 10, SCHISM: 0, RUIN: 0 }, dominantFaction: ["CONCORD" as const], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON_USE", allocationMode: "MARKET" };
const government = { governmentFormId: "GOV", doctrineVector: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, administrationMode: "LOCAL", legitimacyBasis: "LOCAL", authoritySource: "LOCAL", franchiseBreadth: 500, requiredInstitutions: [{ institutionType: "GOVERNMENT", offices: [{ jurisdictionSettlementId: null, titleKey: "RULER", power: 1000, mandatory: true, apex: true, termYears: null, selectionRule: { selectionMethod: "RULER_APPOINTMENT" as const, scope: "STATE" as const, requiresTrackedLineage: false, eligibleTiers: ["HIGH" as const, "MID" as const], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 } } }] }] };

function fixtureCanonical(regionId = "R01", siteCount = 8): CanonicalDataV5 {
  return {
    schemaVersion: "echoes-canonical-data-v5",
    canonicalBundleHash: "prompt00-fixture",
    breeds: [breed],
    sites: Array.from({ length: siteCount }, (_, index) => ({ siteId: `SITE_${index + 1}`, regionId, regionName: regionId, latitude: index, longitude: index, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 1000 - index * 100 })),
    regions: [{ regionId, directedAdjacentRegionIds: [regionId] }],
    governments: [government],
    economicForms: [{ ownershipMode: "COMMON_USE", allocationMode: "MARKET", economicForm: "OPEN" }],
    physicalPois: [], routeCorridors: [],
    sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" }, RUIN: { sovereignFaction: "RUIN", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" } },
    groupRegionAssignments: { CONCORD: { H01: regionId }, SCHISM: { H01: regionId }, RUIN: { H01: regionId } },
    initialSettlements: [], canonicalLabels: {}, canonicalEvents: [],
  };
}

function settlement(index: number, regionId = "R01"): SettlementV5 {
  return { settlementId: `S${index}`, siteId: `SITE_${index}`, regionId, stateId: "STATE_A", foundedYear: index === 1 ? 0 : index, unrest: 1000, sectorStrengths: { ...sectors } };
}

function fixtureState(regionId = "R01", settlementCount = 1): WorldStateV5 {
  const settlements = Array.from({ length: settlementCount }, (_, index) => settlement(index + 1, regionId));
  return {
    schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year: 5, settlements,
    cohorts: [
      { settlementId: "S1", breedId: "BRD_A", tiers: { HIGH: { population: 100n, prosperity: 0 }, MID: { population: 20n, prosperity: 400 }, LOW: { population: 21n, prosperity: 200 } } },
      ...(settlementCount >= 2 ? [{ settlementId: "S2", breedId: "BRD_A", tiers: { HIGH: { population: 100n, prosperity: 0 }, MID: { population: 0n, prosperity: 0 }, LOW: { population: 0n, prosperity: 0 } } }] : []),
    ],
    states: [{ stateId: "STATE_A", actualGovernment: "GOV", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, dominantFaction: "CONCORD", legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
    families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [],
  };
}

function migrationMetrics(state: WorldStateV5): DerivedMetricsV1 {
  const settlementIds = state.settlements.map((row) => row.settlementId);
  return {
    schemaVersion: "echoes-derived-metrics-v1", year: state.year,
    settlementPopulationFactionVectors: Object.fromEntries(settlementIds.map((id) => [id, { CONCORD: 1000, SCHISM: 0, RUIN: 0 }])),
    settlementDominantFactions: Object.fromEntries(settlementIds.map((id) => [id, "CONCORD"])),
    statePopulationFactionVectors: { STATE_A: { CONCORD: 1000, SCHISM: 0, RUIN: 0 } }, stateAdjacency: [], stateUnrest: { STATE_A: 1000 },
    settlementProsperity: Object.fromEntries(settlementIds.map((id) => [id, 0])), settlementHighProsperity: Object.fromEntries(settlementIds.map((id) => [id, 0])), institutionalAccess: Object.fromEntries(settlementIds.map((id) => [id, 0])), localOpportunity: Object.fromEntries(settlementIds.map((id) => [id, 0])), tradeAccess: Object.fromEntries(settlementIds.map((id) => [id, 0])), disruptionPressure: Object.fromEntries(settlementIds.map((id) => [id, 0])), supportedEconomicForms: {},
  } as DerivedMetricsV1;
}

describe("Prompt 00 founding-wave and migration authority", () => {
  it("resolves the owner seed to four complete 24-Settlement waves with stable identities", () => {
    const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
    const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((row) => [row.governmentFormId, {}])));
    const schedule = buildScheduledTransactionsV5(canonical, owner, "EIDOLON_V5_DIAGNOSTIC_1787843667789");
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) {
      const waves = schedule[world].filter((row) => row.type === "CANONICAL_FOUNDING");
      expect(waves).toHaveLength(96);
      expect(Object.fromEntries([1, 77, 125, 176].map((year) => [year, waves.filter((row) => row.year === year).length]))).toEqual({ 1: 24, 77: 24, 125: 24, 176: 24 });
      expect(waves.every((row) => row.settlementId === `SETTLEMENT_${world}_${row.targetSiteId}`)).toBe(true);
      expect(new Set(waves.map((row) => row.targetSiteId))).toHaveLength(96);
    }
  });

  it("resolves the complete canonical wave before applying exact ten-percent transfers", () => {
    const canonical = fixtureCanonical(); const state = fixtureState(); const before = worldPopulation(state);
    const result = executeCanonicalFoundingWave(state, canonical, DEFAULT_MECHANICS_VARIABLES_V1, [{ transactionId: "TX", year: 5, foundingWaveId: "FOUNDING_WAVE_2", ordinalWithinRegion: 2, sourceStateId: "STATE_A", regionId: "R01", targetSiteId: "SITE_2", settlementId: "SETTLEMENT_CONCORD_SITE_2", transferPolicyVersion: "CANONICAL_FOUNDING_TEN_PERCENT_PER_CELL_V1" }]);
    expect(worldPopulation(result.state)).toBe(before);
    expect(result.state.cohorts.find((row) => row.settlementId === "SETTLEMENT_CONCORD_SITE_2")?.tiers).toMatchObject({ HIGH: { population: 10n, prosperity: 0 }, MID: { population: 2n, prosperity: 400 }, LOW: { population: 2n, prosperity: 200 } });
    expect(result.namingRequests[0]).toMatchObject({ behavior: "BATCHED", namingComparisonGroupId: "SETTLEMENT_SITE:SITE_2" });
    const unchanged = structuredClone(state);
    expect(() => executeCanonicalFoundingWave(state, canonical, DEFAULT_MECHANICS_VARIABLES_V1, [{ transactionId: "BAD", year: 5, foundingWaveId: "FOUNDING_WAVE_2", ordinalWithinRegion: 2, sourceStateId: "STATE_A", regionId: "R01", targetSiteId: "SITE_1", settlementId: "SETTLEMENT_CONCORD_SITE_1", transferPolicyVersion: "CANONICAL_FOUNDING_TEN_PERCENT_PER_CELL_V1" }])).toThrow(/already occupied/);
    expect(state).toEqual(unchanged);
  });

  it("persists only pooled candidate continuity and recomputes contributors at maturity", () => {
    const canonical = fixtureCanonical("R01", 8); const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const mechanics = { ...DEFAULT_MECHANICS_VARIABLES_V1, migrationPushThreshold: 0, migrationMaximumOutflowBps: 10_000, migrationDestinationMinimumAttractiveness: 1000, foundingMinimumPopulation: 40n, foundingRequiredReviews: 2 };
    const firstState = fixtureState("R01", 5);
    const populationBefore = worldPopulation(firstState);
    const first = reviewVoluntaryMigration(firstState, migrationMetrics(firstState), canonical, owner, mechanics);
    const condition = first.state.timedConditions.find((row) => row.type === "FOUNDING_CANDIDATE")!;
    expect(condition).toMatchObject({ targetType: "STATE", targetId: "STATE_A", magnitude: 0, qualifyingReviewCount: 1, key: "FOUNDING_CANDIDATE:STATE_A:R01:SITE_6" });
    expect(JSON.stringify(condition)).not.toMatch(/BRD_A|population|contributor|transfer/);
    const changed = { ...first.state, year: 10, cohorts: first.state.cohorts.map((cell) => cell.settlementId === "S1" ? { ...cell, tiers: { ...cell.tiers, HIGH: { ...cell.tiers.HIGH, population: 80n } } } : cell) };
    const second = reviewVoluntaryMigration(changed, migrationMetrics(changed), canonical, owner, mechanics);
    expect(second.state.settlements).toContainEqual(expect.objectContaining({ settlementId: "SETTLEMENT_CONCORD_SITE_6", regionId: "R01", stateId: "STATE_A" }));
    expect(second.transfers.filter((row) => row.cause === "FOUNDING").length).toBeGreaterThan(1);
    expect(second.namingRequests[0]).toMatchObject({ behavior: "BATCHED", comparisonAuthorityRef: "CANONICAL_SITE_ID:SITE_6" });
    expect(worldPopulation(second.state)).toBe(populationBefore - 20n);

    const thirdInput = { ...second.state, year: 15 };
    const third = reviewVoluntaryMigration(thirdInput, migrationMetrics(thirdInput), canonical, owner, mechanics);
    expect(third.state.settlements).toHaveLength(6);
    const fourthInput = { ...third.state, year: 20 };
    const fourth = reviewVoluntaryMigration(fourthInput, migrationMetrics(fourthInput), canonical, owner, mechanics);
    expect(fourth.state.settlements).toHaveLength(7);
    expect(worldPopulation(fourth.state)).toBe(worldPopulation(thirdInput));
    const cappedInput = { ...fourth.state, year: 25 };
    expect(reviewVoluntaryMigration(cappedInput, migrationMetrics(cappedInput), canonical, owner, mechanics).state.settlements).toHaveLength(7);

    const disqualifiedInput = { ...first.state, year: 10, settlements: first.state.settlements.map((row) => ({ ...row, unrest: 0 })) };
    const disqualified = reviewVoluntaryMigration(disqualifiedInput, migrationMetrics(disqualifiedInput), canonical, owner, mechanics);
    expect(disqualified.state.timedConditions.filter((row) => row.type === "FOUNDING_CANDIDATE")).toEqual([]);
  });

  it("allows R10 Settlements two through seven only after its first authority and rejects an eighth ordinary Settlement", () => {
    const canonical = fixtureCanonical("R10", 8); const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const mechanics = { ...DEFAULT_MECHANICS_VARIABLES_V1, migrationPushThreshold: 0, migrationMaximumOutflowBps: 10_000, migrationDestinationMinimumAttractiveness: 1000, foundingMinimumPopulation: 1n, foundingRequiredReviews: 1 };
    const activated = fixtureState("R10", 1);
    const foundedSecond = reviewVoluntaryMigration(activated, migrationMetrics(activated), canonical, owner, mechanics);
    expect(foundedSecond.state.settlements).toHaveLength(2);
    const capped = fixtureState("R10", 7);
    const rejectedEighth = reviewVoluntaryMigration(capped, migrationMetrics(capped), canonical, owner, mechanics);
    expect(rejectedEighth.state.settlements).toHaveLength(7);
    expect(rejectedEighth.state.timedConditions.filter((row) => row.type === "FOUNDING_CANDIDATE")).toEqual([]);
  });

  it("responds monotonically to every approved migration-pressure and destination factor", () => {
    const variables = DEFAULT_MECHANICS_VARIABLES_V1;
    const neutralPush = migrationPush(1000, 0, 0, variables);
    expect(migrationPush(0, 0, 0, variables)).toBeGreaterThan(neutralPush);
    expect(migrationPush(1000, 1000, 0, variables)).toBeGreaterThan(neutralPush);
    expect(migrationPush(1000, 0, 1000, variables)).toBeGreaterThan(neutralPush);
    expect(desiredMigrationOutflow(10_000n, 1000, variables)).toBeLessThanOrEqual(500n);

    const neutralDestination = destinationAttractiveness(0, 0, 0, 0, variables);
    expect(destinationAttractiveness(1000, 0, 0, 0, variables)).toBeGreaterThan(neutralDestination);
    expect(destinationAttractiveness(0, 1000, 0, 0, variables)).toBeGreaterThan(neutralDestination);
    expect(destinationAttractiveness(0, 0, 1000, 0, variables)).toBeGreaterThan(neutralDestination);
    expect(destinationAttractiveness(0, 0, 0, 1000, variables)).toBeGreaterThan(neutralDestination);
  });

  it("runs migration only on its own review cadence", () => {
    const canonical = fixtureCanonical("R01", 2); const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const mechanics = { ...DEFAULT_MECHANICS_VARIABLES_V1, structuralReviewIntervalYears: 7, migrationReviewIntervalYears: 5, migrationPushThreshold: 0, migrationMaximumOutflowBps: 10_000, migrationDestinationMinimumAttractiveness: 0 };
    const offCadence = { ...fixtureState("R01", 2), year: 4 };
    expect(reviewVoluntaryMigration(offCadence, migrationMetrics(offCadence), canonical, owner, mechanics).diagnostics).toEqual([]);
    const onCadence = { ...offCadence, year: 5 };
    const reviewed = reviewVoluntaryMigration(onCadence, migrationMetrics(onCadence), canonical, owner, mechanics);
    expect(reviewed.diagnostics.map((row) => row.domain)).toEqual(["MIGRATION", "FOUNDING"]);
    expect(reviewed.diagnostics[0]?.counters).toMatchObject({
      perCellSafetyViolations: 0,
      aggregateSafetyChecks: 1,
      aggregateSafetyViolations: 0,
      populationConservationChecks: 1,
      populationConservationViolations: 0,
    });
  });
});
