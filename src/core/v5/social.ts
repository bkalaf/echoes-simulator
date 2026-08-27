import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, type MechanicsVariablesV1 } from "./config.js";
import { blend, clamp, divideRoundedAway, largestRemainder, scaled, weightedMean } from "./fixed-point.js";
import { cellPopulation, industryBreadth, settlementPopulation, settlementProsperity } from "./derivations.js";
import type { CausalEventV5, CohortCell, Score1000, SettlementV5, SocialTier, WorldStateV5 } from "./types.js";

const TIERS: readonly SocialTier[] = ["HIGH", "MID", "LOW"];
type MobilityDirection = "LOW_TO_MID" | "HIGH_TO_MID" | "MID_TO_LOW" | "MID_TO_HIGH";
const DIRECTION_ORDER: readonly MobilityDirection[] = ["LOW_TO_MID", "HIGH_TO_MID", "MID_TO_LOW", "MID_TO_HIGH"];
const DIRECTION_TIERS: Record<MobilityDirection, readonly [SocialTier, SocialTier]> = {
  LOW_TO_MID: ["LOW", "MID"], HIGH_TO_MID: ["HIGH", "MID"], MID_TO_LOW: ["MID", "LOW"], MID_TO_HIGH: ["MID", "HIGH"],
};

export interface SocialInputs {
  settlementProsperity: Score1000;
  industryBreadth: Score1000;
  institutionalAccess: Score1000;
  inequality: Score1000;
  economicStrain: Score1000;
}

export function socialEquilibriumTarget(population: bigint, inputs: SocialInputs, variables: MechanicsVariablesV1): Record<SocialTier, bigint> {
  const coefficients = variables.socialCapacityCoefficients;
  const high = clamp(coefficients.highBase + scaled(coefficients.prosperityToHigh, inputs.settlementProsperity - 500), 1, 998);
  const mid = clamp(coefficients.midBase + scaled(coefficients.industryBreadthToMid, inputs.industryBreadth - 500) + scaled(coefficients.institutionalAccessToMid, inputs.institutionalAccess - 500), 1, 998);
  const low = clamp(334 + scaled(coefficients.inequalityToLow, inputs.inequality - 500) + scaled(coefficients.economicStrainToLow, inputs.economicStrain - 500), 1, 998);
  const capacity = largestRemainder(population, [BigInt(high), BigInt(mid), BigInt(low)], [...TIERS]);
  return { HIGH: capacity[0]!, MID: capacity[1]!, LOW: capacity[2]! };
}

export function mobilityCandidateScore(direction: "UP" | "DOWN", tierProsperity: Score1000, localOpportunity: Score1000, institutionalAccess: Score1000, unrest: Score1000, variables: MechanicsVariablesV1): Score1000 {
  const weights = variables.mobilityScoreWeights;
  const upward = weightedMean([tierProsperity, weights.prosperity], [localOpportunity, weights.opportunity], [institutionalAccess, weights.access], [1000 - unrest, weights.inverseUnrest]);
  return direction === "UP" ? upward : 1000 - upward;
}

interface CappedCandidate { index: number; key: string; capacity: bigint; weight: bigint; }
function cappedLargestRemainder(total: bigint, candidates: readonly CappedCandidate[]): bigint[] {
  const result = candidates.map(() => 0n);
  let remaining = total;
  let active = candidates.map((candidate, index) => ({ ...candidate, resultIndex: index }));
  while (remaining > 0n && active.length > 0) {
    const allocation = largestRemainder(remaining, active.map((row) => row.weight), active.map((row) => row.key));
    let applied = 0n;
    const next: typeof active = [];
    active.forEach((candidate, index) => {
      const available = candidate.capacity - result[candidate.resultIndex]!;
      const amount = allocation[index]! < available ? allocation[index]! : available;
      result[candidate.resultIndex] += amount; applied += amount;
      if (result[candidate.resultIndex]! < candidate.capacity) next.push(candidate);
    });
    if (applied === 0n) break;
    remaining -= applied;
    active = next;
  }
  return result;
}

export interface MobilityTransfer {
  settlementId: string;
  breedId: string;
  sourceTier: SocialTier;
  destinationTier: SocialTier;
  population: bigint;
  sourceProsperityBefore: Score1000;
  destinationProsperityBefore: Score1000;
  destinationProsperityAfter: Score1000;
  targetCapacity: bigint;
}

export function applySocialMobility(
  state: WorldStateV5,
  settlement: SettlementV5,
  target: Record<SocialTier, bigint>,
  localOpportunity: Score1000,
  institutionalAccess: Score1000,
  variables: MechanicsVariablesV1,
): { state: WorldStateV5; transfers: MobilityTransfer[]; events: CausalEventV5[] } {
  const sourceCells = state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId).sort((a, b) => a.breedId.localeCompare(b.breedId));
  const actual = Object.fromEntries(TIERS.map((tier) => [tier, sourceCells.reduce((sum, cell) => sum + cell.tiers[tier].population, 0n)])) as Record<SocialTier, bigint>;
  const surplus = Object.fromEntries(TIERS.map((tier) => [tier, actual[tier] > target[tier] ? actual[tier] - target[tier] : 0n])) as Record<SocialTier, bigint>;
  const deficit = Object.fromEntries(TIERS.map((tier) => [tier, target[tier] > actual[tier] ? target[tier] - actual[tier] : 0n])) as Record<SocialTier, bigint>;
  let budget = settlementPopulation(state, settlement.settlementId) * BigInt(variables.socialMobilityMaximumBps) / 10_000n;
  const deltas = new Map<string, Record<SocialTier, bigint>>(sourceCells.map((cell) => [cell.breedId, { HIGH: 0n, MID: 0n, LOW: 0n }]));
  const transfers: MobilityTransfer[] = [];
  for (const direction of DIRECTION_ORDER) {
    if (budget === 0n) break;
    const [sourceTier, destinationTier] = DIRECTION_TIERS[direction];
    const quota = [surplus[sourceTier], deficit[destinationTier], budget].reduce((minimum, value) => value < minimum ? value : minimum);
    if (quota === 0n) continue;
    const candidates = sourceCells.map((cell, index) => {
      const score = mobilityCandidateScore(direction === "LOW_TO_MID" || direction === "MID_TO_HIGH" ? "UP" : "DOWN", cell.tiers[sourceTier].prosperity, localOpportunity, institutionalAccess, settlement.unrest, variables);
      return { index, key: cell.breedId, capacity: cell.tiers[sourceTier].population, weight: BigInt(score + 1) * cell.tiers[sourceTier].population };
    }).filter((candidate) => candidate.capacity > 0n);
    const allocated = cappedLargestRemainder(quota, candidates);
    candidates.forEach((candidate, index) => {
      const amount = allocated[index]!;
      if (amount === 0n) return;
      const cell = sourceCells[candidate.index]!;
      deltas.get(cell.breedId)![sourceTier] -= amount;
      deltas.get(cell.breedId)![destinationTier] += amount;
      transfers.push({ settlementId: settlement.settlementId, breedId: cell.breedId, sourceTier, destinationTier, population: amount, sourceProsperityBefore: cell.tiers[sourceTier].prosperity, destinationProsperityBefore: cell.tiers[destinationTier].prosperity, destinationProsperityAfter: cell.tiers[destinationTier].prosperity, targetCapacity: target[destinationTier] });
    });
    const moved = allocated.reduce((sum, value) => sum + value, 0n);
    surplus[sourceTier] -= moved; deficit[destinationTier] -= moved; budget -= moved;
  }
  const incomingPopulation = new Map<string, bigint>();
  const outgoingPopulation = new Map<string, bigint>();
  const incomingProsperity = new Map<string, bigint>();
  for (const transfer of transfers) {
    const destinationKey = `${transfer.breedId}\0${transfer.destinationTier}`;
    const sourceKey = `${transfer.breedId}\0${transfer.sourceTier}`;
    incomingPopulation.set(destinationKey, (incomingPopulation.get(destinationKey) ?? 0n) + transfer.population);
    incomingProsperity.set(destinationKey, (incomingProsperity.get(destinationKey) ?? 0n) + transfer.population * BigInt(transfer.sourceProsperityBefore));
    outgoingPopulation.set(sourceKey, (outgoingPopulation.get(sourceKey) ?? 0n) + transfer.population);
  }
  const updated = state.cohorts.map((cell) => {
    if (cell.settlementId !== settlement.settlementId) return cell;
    const delta = deltas.get(cell.breedId)!;
    const tiers = {} as CohortCell["tiers"];
    for (const tier of TIERS) {
      const key = `${cell.breedId}\0${tier}`;
      const retained = cell.tiers[tier].population - (outgoingPopulation.get(key) ?? 0n);
      const incoming = incomingPopulation.get(key) ?? 0n;
      const population = retained + incoming;
      const incomingWeightedProsperity = incomingProsperity.get(key) ?? 0n;
      const prosperity = population === 0n ? cell.tiers[tier].prosperity : Number(divideRoundedAway(retained * BigInt(cell.tiers[tier].prosperity) + incomingWeightedProsperity, population));
      if (population !== cell.tiers[tier].population + delta[tier]) throw new Error("Mobility delta mismatch");
      tiers[tier] = { population, prosperity };
      for (const transfer of transfers.filter((row) => row.breedId === cell.breedId && row.destinationTier === tier)) transfer.destinationProsperityAfter = prosperity;
    }
    return { ...cell, tiers };
  });
  const before = sourceCells.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  const after = updated.filter((cell) => cell.settlementId === settlement.settlementId).reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  if (before !== after) throw new Error("Social mobility violated Settlement population conservation");
  const events = transfers.map((transfer, sequence): CausalEventV5 => ({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_MOBILITY_${settlement.settlementId}_${transfer.breedId}_${transfer.sourceTier}_${transfer.destinationTier}`, worldKey: state.worldKey, year: state.year, phase: "SOCIAL_MOBILITY", sequence, eventType: "TierMobilityTransfer", entityType: "COHORT_CELL", entityId: `${settlement.settlementId}/${transfer.breedId}`, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { ...transfer, population: transfer.population.toString(), targetCapacity: transfer.targetCapacity.toString() } }));
  return { state: { ...state, cohorts: updated }, transfers, events };
}

export function reviewSettlementSocialMobility(state: WorldStateV5, settlement: SettlementV5, localOpportunity: Score1000, institutionalAccess: Score1000, inequality: Score1000, economicStrain: Score1000, variables: MechanicsVariablesV1) {
  const cells = state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId);
  const target = socialEquilibriumTarget(settlementPopulation(state, settlement.settlementId), { settlementProsperity: settlementProsperity(cells), industryBreadth: industryBreadth(settlement), institutionalAccess, inequality, economicStrain }, variables);
  return applySocialMobility(state, settlement, target, localOpportunity, institutionalAccess, variables);
}

export function updateTierProsperity(cell: CohortCell, targets: Record<SocialTier, Score1000>, inertiaBps: number): CohortCell {
  return { ...cell, tiers: {
    HIGH: { ...cell.tiers.HIGH, prosperity: blend(cell.tiers.HIGH.prosperity, targets.HIGH, inertiaBps) },
    MID: { ...cell.tiers.MID, prosperity: blend(cell.tiers.MID.prosperity, targets.MID, inertiaBps) },
    LOW: { ...cell.tiers.LOW, prosperity: blend(cell.tiers.LOW.prosperity, targets.LOW, inertiaBps) },
  } };
}
