import type { WorldKey } from "../contracts/domain.js";
import { accrueGrowth, allocateEqualPopulation, type GrowthBand } from "./local-mechanics.js";
import { applySimultaneousTransfers, type AppliedTransfer, type MigrationIntent } from "./flow-mechanics.js";

export interface Cohort {
  cohortId: string;
  worldKey: WorldKey;
  settlementId: string;
  breedId: string;
  population: bigint;
  wealthScore: number;
  createdYear: number;
  originCohortId: string | null;
  createdByEventId: string;
  outboundMigrationNotBeforeYear: number | null;
}

export interface CohortGrowthResult {
  cohorts: Cohort[];
  deltas: { cohortId: string; priorPopulation: bigint; growth: bigint; population: bigint }[];
  totalGrowth: bigint;
}

export interface CohortTransferResult {
  cohorts: Cohort[];
  transfers: AppliedTransfer[];
}

interface StartingCivicBreed { breedId: string; populationKind: "HUMAN" | "BEAST" | "MYTHOS" | "PET"; groupId: string; }
interface GroupAssignment { groupId: string; regionId: string; }
interface FoundingSite { regionId: string; siteId: string; }

export function initializeCivicCohorts(
  worldKey: WorldKey,
  breeds: readonly StartingCivicBreed[],
  assignments: readonly GroupAssignment[],
  foundingSites: readonly FoundingSite[],
  totalPopulation = 2_000_000n,
): Cohort[] {
  const civic = breeds.filter((breed) => breed.populationKind !== "PET").sort((a, b) => a.breedId.localeCompare(b.breedId));
  if (new Set(civic.map((breed) => breed.breedId)).size !== civic.length) throw new Error("Duplicate civic Breed ID");
  const regionByGroup = new Map(assignments.filter((row) => row.regionId !== "R10").map((row) => [row.groupId, row.regionId]));
  const siteByRegion = new Map(foundingSites.filter((row) => row.regionId !== "R10").map((row) => [row.regionId, row.siteId]));
  const allocation = allocateEqualPopulation(civic.map((breed) => breed.breedId), totalPopulation);
  const cohorts = civic.map((breed): Cohort => {
    const regionId = regionByGroup.get(breed.groupId);
    if (!regionId) throw new Error(`No non-R10 Region assignment for ${breed.breedId} group ${breed.groupId}`);
    const siteId = siteByRegion.get(regionId);
    if (!siteId) throw new Error(`No founding Site for ${breed.breedId} Region ${regionId}`);
    return {
      cohortId: `COHORT_${worldKey}_${breed.breedId}`,
      worldKey,
      settlementId: `SETTLEMENT_${worldKey}_${siteId}`,
      breedId: breed.breedId,
      population: allocation.get(breed.breedId)!,
      wealthScore: 0,
      createdYear: 0,
      originCohortId: null,
      createdByEventId: `EVENT_${worldKey}_INITIAL_POPULATION`,
      outboundMigrationNotBeforeYear: null,
    };
  });
  if (cohorts.reduce((sum, cohort) => sum + cohort.population, 0n) !== totalPopulation) throw new Error("Initial cohort allocation violated conservation");
  return cohorts;
}

export function applyCohortGrowth(cohorts: readonly Cohort[], growthBandFor: (cohort: Cohort) => GrowthBand): CohortGrowthResult {
  let totalGrowth = 0n;
  const deltas: CohortGrowthResult["deltas"] = [];
  const grown = [...cohorts].sort((a, b) => a.cohortId.localeCompare(b.cohortId)).map((cohort) => {
    if (cohort.population < 0n) throw new Error(`Negative cohort population ${cohort.cohortId}`);
    const growth = cohort.population === 0n ? 0n : accrueGrowth(cohort.population, growthBandFor(cohort));
    totalGrowth += growth;
    const population = cohort.population + growth;
    deltas.push({ cohortId: cohort.cohortId, priorPopulation: cohort.population, growth, population });
    return { ...cohort, population };
  });
  return { cohorts: grown, deltas, totalGrowth };
}

function splitCohortId(originCohortId: string, eventId: string, transferId: string, destinationId: string): string {
  return `${originCohortId}__${eventId}__${transferId}__${destinationId}`;
}

export function applyCohortTransfers(
  cohorts: readonly Cohort[],
  intents: readonly MigrationIntent[],
  year: number,
  eventId: string,
): CohortTransferResult {
  const sourceById = new Map(cohorts.map((cohort) => [cohort.cohortId, cohort]));
  if (sourceById.size !== cohorts.length) throw new Error("Duplicate cohort ID");
  const populations = new Map(cohorts.map((cohort) => [cohort.cohortId, cohort.population]));
  const applied = applySimultaneousTransfers(populations, intents);
  const retained = [...cohorts].map((cohort) => ({ ...cohort, population: applied.retained.get(cohort.cohortId) ?? cohort.population }));
  const migrated = applied.transfers.filter((transfer) => transfer.amount > 0n).map((transfer) => {
    const origin = sourceById.get(transfer.originCohortId);
    if (!origin) throw new Error(`Unknown origin cohort ${transfer.originCohortId}`);
    return {
      ...origin,
      cohortId: splitCohortId(origin.cohortId, eventId, transfer.transferId, transfer.destinationId),
      settlementId: transfer.destinationId,
      population: transfer.amount,
      wealthScore: 0,
      createdYear: year,
      originCohortId: origin.cohortId,
      createdByEventId: eventId,
      outboundMigrationNotBeforeYear: null,
    };
  });
  const result = [...retained, ...migrated].sort((a, b) => a.cohortId.localeCompare(b.cohortId));
  if (result.some((cohort) => cohort.population < 0n)) throw new Error("Cohort transfer produced negative population");
  const before = cohorts.reduce((sum, cohort) => sum + cohort.population, 0n);
  const after = result.reduce((sum, cohort) => sum + cohort.population, 0n);
  if (before !== after) throw new Error(`Cohort transfer violated conservation: ${before} != ${after}`);
  return { cohorts: result, transfers: applied.transfers };
}

export interface DjtTransactionInput {
  sovereignBreedId: string;
  seizedSettlementId: string;
  innerwoodSettlementId: string;
  year: number;
  quarantineYears: number;
  eventId: string;
}

export interface DjtMovement {
  movementId: string;
  cohortId: string;
  breedId: string;
  fromSettlementId: string;
  toSettlementId: string;
  population: bigint;
  reason: "SOVEREIGN_CONSOLIDATION" | "SEIZED_CITY_DISPLACEMENT";
}

export function executeDjtTransaction(cohorts: readonly Cohort[], input: DjtTransactionInput): { cohorts: Cohort[]; movements: DjtMovement[] } {
  if (input.quarantineYears < 0) throw new Error("DJT quarantine cannot be negative");
  const quarantineUntil = input.year + input.quarantineYears;
  const movements: DjtMovement[] = [];
  const result: Cohort[] = [];
  for (const cohort of [...cohorts].sort((a, b) => a.cohortId.localeCompare(b.cohortId))) {
    if (cohort.population < 0n) throw new Error(`Negative cohort population ${cohort.cohortId}`);
    if (cohort.population === 0n) {
      result.push({ ...cohort });
      continue;
    }
    const sovereign = cohort.breedId === input.sovereignBreedId;
    const displaced = !sovereign && cohort.settlementId === input.seizedSettlementId;
    if (!sovereign && !displaced) {
      result.push({ ...cohort });
      continue;
    }
    if (sovereign && cohort.settlementId === input.seizedSettlementId) {
      result.push({ ...cohort, outboundMigrationNotBeforeYear: quarantineUntil });
      continue;
    }
    const destinationId = sovereign ? input.seizedSettlementId : input.innerwoodSettlementId;
    const reason = sovereign ? "SOVEREIGN_CONSOLIDATION" : "SEIZED_CITY_DISPLACEMENT";
    const movementId = `${input.eventId}__${reason}__${cohort.cohortId}`;
    result.push({ ...cohort, population: 0n });
    result.push({
      ...cohort,
      cohortId: splitCohortId(cohort.cohortId, input.eventId, reason, destinationId),
      settlementId: destinationId,
      wealthScore: 0,
      createdYear: input.year,
      originCohortId: cohort.cohortId,
      createdByEventId: input.eventId,
      outboundMigrationNotBeforeYear: quarantineUntil,
    });
    movements.push({ movementId, cohortId: cohort.cohortId, breedId: cohort.breedId, fromSettlementId: cohort.settlementId, toSettlementId: destinationId, population: cohort.population, reason });
  }
  const before = cohorts.reduce((sum, cohort) => sum + cohort.population, 0n);
  const after = result.reduce((sum, cohort) => sum + cohort.population, 0n);
  if (before !== after) throw new Error(`DJT transaction violated conservation: ${before} != ${after}`);
  return { cohorts: result.sort((a, b) => a.cohortId.localeCompare(b.cohortId)), movements };
}
