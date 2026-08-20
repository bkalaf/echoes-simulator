import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RAW_DIMENSIONS, PERSONALITY_DIMENSION_POLICY, type EffectiveBreedSemantics } from "../../src/core/research/v4-contract.js";
import { runCanonicalHistory, type CanonicalHistoryInput, type CanonicalHistoryWorld } from "../../src/core/engine/canonical-history.js";

const root = resolve(import.meta.dirname, "../..");
const reference = <T>(name: string): T => JSON.parse(readFileSync(resolve(root, `resources/canonical/reference/${name}`), "utf8")) as T;
const propertyMapping = reference<CanonicalHistoryInput["propertyMapping"]>("property_faction_mapping.json");
const politicalRows = reference<{ rows: Record<string, string>[] }>("political_form_mapping.json").rows;
const economicRows = reference<{ rows: Record<string, string>[] }>("economic_form_mapping.json").rows;

function semantic(breedId: string, faction: "CONCORD" | "RUIN"): EffectiveBreedSemantics {
  const values = Object.fromEntries(Object.entries(propertyMapping).map(([field, row]) => [`${field[0]!.toLowerCase()}${field.slice(1)}`, row[faction]]));
  return {
    schemaVersion: "eidolon-effective-breed-semantics-v4",
    breedId,
    populationKind: "HUMAN",
    researchUnitId: `CULTURE_${breedId}`,
    personalityId: `PERSONALITY_${breedId}`,
    terrainBroad: ["TEMPERATE"],
    terrainSpecific: ["PLAINS"],
    dimensions: Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, { value: values[field]!, disposition: "OWNER_POLICY_VALUE", policyRef: PERSONALITY_DIMENSION_POLICY }])) as EffectiveBreedSemantics["dimensions"],
  };
}

function world(worldKey: "CONCORD" | "SCHISM" | "RUIN"): CanonicalHistoryWorld {
  const settlement = (regionId: string, siteId: string, breedId: string, faction: "CONCORD" | "RUIN") => ({
    settlementId: `SETTLEMENT_${worldKey}_${siteId}`,
    siteId,
    regionId,
    stateId: `STATE_${worldKey}_${regionId}`,
    name: siteId,
    nameSource: "OWNER_INPUT" as const,
    foundedYear: 0,
    cultureId: `CULTURE_${breedId}`,
    cultureState: "CALCULATED" as const,
    population: 1_000n,
    dominantFaction: faction,
    politicalForm: faction === "CONCORD" ? "APPOINTED_DIRECTORATE" : "MILITANT_ORDER",
    economicForm: faction === "CONCORD" ? "COMMAND_DEMESNE" : "OPEN_BAZAAR",
    dominantBreed: breedId,
    dominantSpeciesKind: "HUMAN" as const,
    propertyWinners: Object.fromEntries(Object.entries(propertyMapping).map(([field, row]) => [`${field[0]!.toLowerCase()}${field.slice(1)}`, row[faction]])),
    politicalLatch: ["administrationMode", "legitimacyBasis", "authoritySource"],
    economicLatch: ["ownershipMode", "allocationMode"],
  });
  const settlements = [settlement("R01", "SITE-001", "BREED_A", "CONCORD"), settlement("R02", "SITE-006", "BREED_B", "RUIN")];
  return {
    world: worldKey,
    year: 0,
    settlements,
    cohorts: settlements.map((row, index) => ({
      cohortId: `COHORT_${worldKey}_${index}`,
      worldKey,
      settlementId: row.settlementId,
      breedId: index === 0 ? "BREED_A" : "BREED_B",
      population: 1_000n,
      wealthScore: 10,
      createdYear: 0,
      originCohortId: null,
      createdByEventId: `EVENT_${worldKey}_INITIAL`,
      outboundMigrationNotBeforeYear: null,
    })),
  };
}

function fixture(): CanonicalHistoryInput {
  const sites = ["R01", "R02"].flatMap((regionId, regionIndex) => Array.from({ length: 5 }, (_, index) => ({
    siteId: `SITE-${String(regionIndex * 5 + index + 1).padStart(3, "0")}`,
    regionId,
    currentSiteName: index === 0 ? `Initial ${regionId}` : "",
    nameStatus: index === 0 ? "CANONICAL" : "NAMING_REQUIRED",
    classification: "CITY",
    attractivenessTier: String(5 - index),
  })));
  return {
    runId: "RUN_CANONICAL_HISTORY_TEST",
    seed: "CANONICAL_HISTORY_SEED",
    yearEnd: 2_000,
    worlds: [world("CONCORD"), world("SCHISM"), world("RUIN")],
    identities: [
      { breedId: "BREED_A", populationKind: "HUMAN", cultureId: "CULTURE_A" },
      { breedId: "BREED_B", populationKind: "HUMAN", cultureId: "CULTURE_B" },
    ],
    semantics: [semantic("BREED_A", "CONCORD"), semantic("BREED_B", "RUIN")],
    sites,
    adjacency: { R01: ["R02"], R02: ["R01"], R10: [] },
    propertyMapping,
    politicalRows,
    economicRows,
    growthPolicy: reference<CanonicalHistoryInput["growthPolicy"]>("growth_policy.json"),
    sovereign: {
      CONCORD: { sovereignFaction: "CONCORD", breedId: "BREED_A", djtSeizureTarget: { siteId: "SITE-001" } },
      SCHISM: { sovereignFaction: "SCHISM", breedId: "BREED_A", djtSeizureTarget: { siteId: "SITE-001" } },
      RUIN: { sovereignFaction: "RUIN", breedId: "BREED_A", djtSeizureTarget: { siteId: "SITE-001" } },
      innerwood: { siteId: "SITE-064", regionId: "R10", stateName: "Innerwood" },
    },
    sharedEvents: [
      { eventKey: "FOUNDING_WAVE_2", nominalYear: 1, jitter: false, kind: "FOUNDING_WAVE", label: "Wave 2" },
      { eventKey: "FOUNDING_WAVE_3", nominalYear: 75, jitter: false, kind: "FOUNDING_WAVE", label: "Wave 3" },
      { eventKey: "FOUNDING_WAVE_4", nominalYear: 125, jitter: false, kind: "FOUNDING_WAVE", label: "Wave 4" },
      { eventKey: "FOUNDING_WAVE_5", nominalYear: 175, jitter: false, kind: "FOUNDING_WAVE", label: "Wave 5" },
      { eventKey: "DJT_SEIZURE_INNERWOOD", nominalYear: 500, jitter: false, kind: "STRUCTURAL", label: "DJT" },
      { eventKey: "INNERWOOD_SECESSION_505", nominalYear: 505, jitter: false, kind: "STATE_MEMBERSHIP", label: "Secession" },
      { eventKey: "INNERWOOD_REBALANCE_525", nominalYear: 525, jitter: false, kind: "STATE_MEMBERSHIP", label: "Disabled rebalance" },
    ],
    autoAcceptNaming: true,
    checkpointInterval: 5,
  };
}

describe("canonical Breed/cohort history", () => {
  it("runs deterministically from year 0 through 2000 with actual migration, founding, DJT, institutions, and replay checkpoints", () => {
    const first = runCanonicalHistory(fixture());

    expect(first.status).toBe("COMPLETE");
    expect(first.currentYear).toBe(2_000);
    expect(first.checkpoints.filter((row) => row.year === 5)).toHaveLength(3);
    expect(first.checkpoints.filter((row) => row.year === 1_000)).toHaveLength(3);
    expect(first.checkpoints.filter((row) => row.year === 2_000)).toHaveLength(3);
    expect(first.checkpoints.filter((row) => row.year === 2_000).map((row) => row.stateHash)).toEqual([
      "84fb7e7a342eef5db4d9b05a01b23c1b2cee62a7ce31fe309bd6cc5f42f31e92",
      "ef7dd46ceb40bac28969d9050fbc4ed7fce01e2723eb3d6ad166560021ac8111",
      "f61b38014955431bdd50613cd6db66cd80d5b8c7e7b6d78c3a5c63b895d115f4",
    ]);
    expect(first.founding).toHaveLength(24);
    expect(first.founding.every((row) => BigInt(row.movedPopulation) > 0n)).toBe(true);
    expect(first.migrations.length).toBeGreaterThan(0);
    expect(first.migrations.every((row) => row.migrantWealth === 0)).toBe(true);
    expect(first.djt).toHaveLength(3);
    expect(first.djt.every((row) => row.populationBefore === row.populationAfter && row.quarantineUntil === 505)).toBe(true);
    expect(first.institutions.some((row) => row.type === "CONCLAVE")).toBe(true);
    expect(first.institutions.some((row) => row.type === "SENATE")).toBe(true);
    expect(first.namingJobs).toHaveLength(24);
    expect(first.events.some((row) => row.eventType === "TEST_FIXTURE_NAMING_ACCEPTED")).toBe(true);
    expect(first.events.filter((row) => row.eventType === "STATE_MEMBERSHIP_REBALANCE_DISABLED")).toHaveLength(3);
  }, 30_000);

  it("stops at the first genuine naming barrier when fixture naming is disabled", () => {
    const result = runCanonicalHistory({ ...fixture(), yearEnd: 10, autoAcceptNaming: false });
    expect(result.status).toBe("WAITING_FOR_NAMING");
    expect(result.currentYear).toBe(1);
    expect(result.namingJobs).toHaveLength(6);
    expect(result.namingJobs[0]!.context.settlement.dominantFaction).toBeTruthy();
    expect(result.namingJobs[0]!.context.settlement.politicalForm).toBeTruthy();
    expect(result.namingJobs[0]!.context.settlement.economicForm).toBeTruthy();
    expect(result.namingJobs[0]!.context.settlement.dominantBreed).toBeTruthy();
  });
});
