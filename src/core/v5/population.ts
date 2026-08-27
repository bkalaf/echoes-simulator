import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, type CanonicalDataV5, type MechanicsVariablesV1 } from "./config.js";
import { divideRoundedAway, largestRemainder } from "./fixed-point.js";
import { resolveBreedFaction } from "./faction.js";
import { cellPopulation } from "./derivations.js";
import type { CausalEventV5, CohortCell, SettlementV5, SocialTier, WorldKey, WorldStateV5 } from "./types.js";

const TIERS: readonly SocialTier[] = ["HIGH", "MID", "LOW"];
export type GrowthBand = "LOW" | "MEDIUM" | "HIGH";
const GROWTH_MATRIX: Record<WorldKey, Record<WorldKey, GrowthBand>> = {
  CONCORD: { CONCORD: "LOW", SCHISM: "MEDIUM", RUIN: "HIGH" },
  SCHISM: { CONCORD: "HIGH", SCHISM: "LOW", RUIN: "MEDIUM" },
  RUIN: { CONCORD: "MEDIUM", SCHISM: "HIGH", RUIN: "LOW" },
};

export interface BootstrapPopulationInput {
  worldKey: WorldKey;
  settlements: readonly SettlementV5[];
  canonical: CanonicalDataV5;
  variables: MechanicsVariablesV1;
}

export function allocateYearZeroCohorts(input: BootstrapPopulationInput): CohortCell[] {
  const civic = input.canonical.breeds.filter((breed) => breed.populationKind !== "PET").sort((a, b) => a.breedId.localeCompare(b.breedId));
  const breedTotals = largestRemainder(input.variables.initialPopulation, civic.map(() => 1n), civic.map((breed) => breed.breedId));
  const settlementByRegion = new Map<string, SettlementV5[]>();
  for (const settlement of input.settlements) settlementByRegion.set(settlement.regionId, [...(settlementByRegion.get(settlement.regionId) ?? []), settlement].sort((a, b) => a.settlementId.localeCompare(b.settlementId)));
  const populations = new Map<string, Map<string, bigint>>();
  civic.forEach((breed, index) => {
    const regionId = input.canonical.groupRegionAssignments[input.worldKey]?.[breed.groupId];
    if (!regionId || regionId === "R10") throw new Error(`No valid year-0 Region assignment for ${input.worldKey}/${breed.breedId}/${breed.groupId}`);
    const candidates = settlementByRegion.get(regionId);
    if (!candidates?.length) throw new Error(`No year-0 Settlement in ${regionId}`);
    const shares = largestRemainder(breedTotals[index]!, candidates.map(() => 1n), candidates.map((row) => row.settlementId));
    candidates.forEach((settlement, settlementIndex) => {
      const byBreed = populations.get(settlement.settlementId) ?? new Map<string, bigint>();
      byBreed.set(breed.breedId, shares[settlementIndex]!); populations.set(settlement.settlementId, byBreed);
    });
  });
  const cells: CohortCell[] = [];
  for (const settlement of [...input.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) {
    const byBreed = populations.get(settlement.settlementId) ?? new Map<string, bigint>();
    const total = [...byBreed.values()].reduce((sum, value) => sum + value, 0n);
    const capacities = largestRemainder(total, [...input.variables.initialTierWeights], [...TIERS]);
    const remaining = [...capacities];
    const breeds = [...byBreed.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [breedId, breedPopulation] of breeds) {
      const allocation = largestRemainder(breedPopulation, remaining, [...TIERS]);
      for (let index = 0; index < remaining.length; index += 1) remaining[index] -= allocation[index]!;
      cells.push({ settlementId: settlement.settlementId, breedId, tiers: {
        HIGH: { population: allocation[0]!, prosperity: input.variables.tierProsperityInitial.HIGH },
        MID: { population: allocation[1]!, prosperity: input.variables.tierProsperityInitial.MID },
        LOW: { population: allocation[2]!, prosperity: input.variables.tierProsperityInitial.LOW },
      } });
    }
    if (remaining.some((value) => value !== 0n)) throw new Error(`Tier capacity allocation did not close for ${settlement.settlementId}`);
  }
  const allocated = cells.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  if (allocated !== input.variables.initialPopulation) throw new Error(`Year-0 population mismatch ${allocated}`);
  return cells;
}

export function effectiveGrowthRatePpm(resolvedBreedFaction: WorldKey, sovereignFaction: WorldKey, settlementDominantFaction: WorldKey, variables: MechanicsVariablesV1): number {
  const band = GROWTH_MATRIX[resolvedBreedFaction][sovereignFaction];
  const deduction = settlementDominantFaction === resolvedBreedFaction ? 0 : variables.growthNonAlignmentDeductionPpm;
  return Math.max(0, variables.growthRatesPpm[band] - deduction);
}

export function applyNaturalDemography(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, settlementDominantFactions: Readonly<Record<string, WorldKey>>): { state: WorldStateV5; events: CausalEventV5[]; growth: bigint } {
  const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const sovereign = canonical.sovereigns[state.worldKey].sovereignFaction;
  let totalGrowth = 0n;
  const growthByRatePpm = new Map<number, bigint>();
  const populationBefore = state.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  const cohorts = [...state.cohorts].sort((a, b) => `${a.settlementId}\0${a.breedId}`.localeCompare(`${b.settlementId}\0${b.breedId}`)).map((cell, sequence) => {
    const breed = breedById.get(cell.breedId);
    if (!breed) throw new Error(`Unknown Breed ${cell.breedId}`);
    const faction = resolveBreedFaction(breed, sovereign, variables.sovereignTieBreak);
    const rate = effectiveGrowthRatePpm(faction, sovereign, settlementDominantFactions[cell.settlementId]!, variables);
    const population = cellPopulation(cell);
    const growth = population === 0n ? 0n : divideRoundedAway(population * BigInt(rate), 1_000_000n);
    const tierGrowth = largestRemainder(growth, TIERS.map((tier) => cell.tiers[tier].population), [...TIERS]);
    const after: CohortCell = { ...cell, tiers: {
      HIGH: { ...cell.tiers.HIGH, population: cell.tiers.HIGH.population + tierGrowth[0]! },
      MID: { ...cell.tiers.MID, population: cell.tiers.MID.population + tierGrowth[1]! },
      LOW: { ...cell.tiers.LOW, population: cell.tiers.LOW.population + tierGrowth[2]! },
    } };
    totalGrowth += growth;
    growthByRatePpm.set(rate, (growthByRatePpm.get(rate) ?? 0n) + growth);
    return after;
  });
  const populationAfter = populationBefore + totalGrowth;
  const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_DEMOGRAPHY`, worldKey: state.worldKey, year: state.year, phase: "DEMOGRAPHY", sequence: 0, eventType: "NaturalDemographyCompleted", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [{ mutationType: "POPULATION_GROWTH", entityType: "WORLD", entityId: state.worldKey, before: populationBefore.toString(), after: populationAfter.toString() }], payload: { totalGrowth: totalGrowth.toString(), growthByRatePpm: Object.fromEntries([...growthByRatePpm].sort(([a], [b]) => a - b).map(([rate, growth]) => [String(rate), growth.toString()])), exactCellGrowthRetainedInState: true } };
  return { state: { ...state, cohorts }, events: [event], growth: totalGrowth };
}
