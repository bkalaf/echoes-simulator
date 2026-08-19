import { readFileSync } from "node:fs";
import { parse as parseCsvSync } from "csv-parse/sync";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  applyCohortGrowth,
  applyCohortTransfers,
  executeDjtTransaction,
  initializeCivicCohorts,
  type Cohort,
} from "../../src/core/engine/cohort-engine.js";
import { deriveSocialProjection } from "../../src/core/engine/local-mechanics.js";

const cohort = (overrides: Partial<Cohort> = {}): Cohort => ({
  cohortId: "COHORT_A",
  worldKey: "CONCORD",
  settlementId: "S1",
  breedId: "BRD_A",
  population: 100n,
  wealthScore: 12,
  createdYear: 0,
  originCohortId: null,
  createdByEventId: "EVENT_INITIAL",
  outboundMigrationNotBeforeYear: null,
  ...overrides,
});

describe("Breed cohort mechanics", () => {
  it("creates exact 2,000,000-person Breed cohorts from all 1,773 civic Breeds with no R10 population", () => {
    const zip = unzipSync(readFileSync("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18/echoes_of_eidolon_breed_research_2026-08-17.zip"));
    const breedEntry = Object.entries(zip).find(([name]) => name.endsWith("/breed_classifications.jsonl"))![1];
    const breeds = strFromU8(breedEntry).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const assignments = parseCsvSync(readFileSync("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18/INPUTS/region_species_group_assignments(1).csv"), { columns: true, skip_empty_lines: true }) as { groupId: string; regionId: string }[];
    const founding = parseCsvSync(readFileSync("resources/reference/founding_sites.csv"), { columns: true, skip_empty_lines: true }) as { siteId: string; regionId: string }[];
    const initialized = initializeCivicCohorts("CONCORD", breeds, assignments, founding, 2_000_000n);
    expect(initialized).toHaveLength(1773);
    expect(new Set(initialized.map((item) => item.breedId)).size).toBe(1773);
    expect(initialized.reduce((sum, item) => sum + item.population, 0n)).toBe(2_000_000n);
    expect(initialized.some((item) => item.settlementId.includes("R10") || founding.find((site) => site.siteId === item.settlementId.replace("SETTLEMENT_CONCORD_", ""))?.regionId === "R10")).toBe(false);
    expect(initialized.every((item) => item.wealthScore === 0 && item.createdYear === 0)).toBe(true);
  });

  it("grows every cohort independently with exact BigInt ceil semantics", () => {
    const result = applyCohortGrowth([
      cohort({ cohortId: "A", population: 101n }),
      cohort({ cohortId: "B", population: 199n }),
    ], () => "LOW");
    expect(result.cohorts.map((item) => item.population)).toEqual([102n, 200n]);
    expect(result.totalGrowth).toBe(2n);
  });

  it("applies simultaneous migration, resets migrant wealth, and preserves retained wealth", () => {
    const result = applyCohortTransfers(
      [cohort()],
      [
        { transferId: "T1", originCohortId: "COHORT_A", destinationId: "S2", proposed: 80n },
        { transferId: "T2", originCohortId: "COHORT_A", destinationId: "S3", proposed: 80n },
      ],
      25,
      "EVENT_MIGRATION",
    );
    expect(result.cohorts.reduce((sum, item) => sum + item.population, 0n)).toBe(100n);
    expect(result.cohorts.find((item) => item.cohortId === "COHORT_A")?.wealthScore).toBe(12);
    const migrants = result.cohorts.filter((item) => item.originCohortId === "COHORT_A");
    expect(migrants).toHaveLength(2);
    expect(migrants.every((item) => item.wealthScore === 0)).toBe(true);
    expect(migrants.map((item) => item.population)).toEqual([50n, 50n]);
  });

  it("moves the complete Sovereign Breed and displaces every other seized-city resident", () => {
    const initial = [
      cohort({ cohortId: "SOV_A", breedId: "BRD_SOV", settlementId: "S1", population: 40n }),
      cohort({ cohortId: "SOV_B", breedId: "BRD_SOV", settlementId: "SEIZED", population: 10n }),
      cohort({ cohortId: "OTHER", breedId: "BRD_OTHER", settlementId: "SEIZED", population: 25n }),
      cohort({ cohortId: "STAY", breedId: "BRD_OTHER", settlementId: "S3", population: 30n }),
    ];
    const result = executeDjtTransaction(initial, {
      sovereignBreedId: "BRD_SOV",
      seizedSettlementId: "SEIZED",
      innerwoodSettlementId: "INNERWOOD",
      year: 500,
      quarantineYears: 5,
      eventId: "EVENT_DJT",
    });
    expect(result.cohorts.reduce((sum, item) => sum + item.population, 0n)).toBe(105n);
    expect(result.cohorts.filter((item) => item.breedId === "BRD_SOV" && item.population > 0n).every((item) => item.settlementId === "SEIZED")).toBe(true);
    expect(result.cohorts.filter((item) => item.settlementId === "SEIZED" && item.population > 0n).every((item) => item.breedId === "BRD_SOV")).toBe(true);
    expect(result.cohorts.find((item) => item.breedId === "BRD_OTHER" && item.settlementId === "INNERWOOD")?.population).toBe(25n);
    expect(result.cohorts.filter((item) => ["SEIZED", "INNERWOOD"].includes(item.settlementId) && item.createdYear === 500).every((item) => item.outboundMigrationNotBeforeYear === 505)).toBe(true);
  });

  it("derives social tiers from wealth-ranked population and splits boundary cohorts", () => {
    const projection = deriveSocialProjection([
      { cohortId: "RICH", breedId: "BRD_RICH", wealth: 10, population: 8n },
      { cohortId: "POOR", breedId: "BRD_POOR", wealth: 0, population: 2n },
    ]);
    expect(projection.tiers).toEqual({ HIGH: 3n, MID: 3n, LOW: 4n });
    expect(projection.segments.filter((item) => item.cohortId === "RICH").map((item) => [item.tier, item.population])).toEqual([
      ["HIGH", 3n],
      ["MID", 3n],
      ["LOW", 2n],
    ]);
    expect(projection.segments.find((item) => item.cohortId === "POOR")?.tier).toBe("LOW");
    expect(Object.values(projection.classes).reduce((sum, value) => sum + value, 0n)).toBe(10n);
  });
});
