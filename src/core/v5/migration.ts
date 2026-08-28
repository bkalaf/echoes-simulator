import { createHash } from "node:crypto";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, type CanonicalDataV5, type CausalOwnerInputsV1, type MechanicsVariablesV1, type SiteAuthorityV5 } from "./config.js";
import { canonicalJson } from "../serialization/canonical-json.js";
import { clamp, divideRoundedAway, largestRemainder, weightedMean } from "./fixed-point.js";
import { breedFactionVector } from "./faction.js";
import { cellPopulation, sectorTerrainFit, settlementPopulation, shortestDirectedRegionHops, terrainCompatibility } from "./derivations.js";
import type { CausalEventV5, CohortCell, DerivedMetricsV1, NamingRequestV5, Score1000, SectorId, SettlementV5, SocialTier, TimedConditionV5, WorldStateV5 } from "./types.js";
import { boundedHistogram, type BoundedDiagnosticObservationV5 } from "./diagnostics.js";

export interface MigrationTransferV5 {
  transferId: string;
  breedId: string;
  tier: SocialTier;
  originSettlementId: string;
  destinationSettlementId: string;
  population: bigint;
  prosperity: Score1000;
  cause: "VOLUNTARY" | "FORCED" | "DJT" | "FOUNDING";
}

export function migrationPush(factionCompatibility: Score1000, economicDisadvantage: Score1000, unrest: Score1000, variables: MechanicsVariablesV1): Score1000 {
  const weights = variables.migrationPushWeights;
  return weightedMean([1000 - factionCompatibility, weights.factionMismatch], [economicDisadvantage, weights.economicDisadvantage], [unrest, weights.unrest]);
}

export function desiredMigrationOutflow(population: bigint, push: Score1000, variables: MechanicsVariablesV1): bigint {
  if (push <= variables.migrationPushThreshold || population === 0n) return 0n;
  const pressureScale = BigInt(push - variables.migrationPushThreshold);
  const maximumScale = BigInt(1000 - variables.migrationPushThreshold);
  return population * BigInt(variables.migrationMaximumOutflowBps) * pressureScale / (10_000n * maximumScale);
}

export function destinationAttractiveness(opportunity: Score1000, compatibility: Score1000, stability: Score1000, terrain: Score1000, variables: MechanicsVariablesV1): Score1000 {
  const weights = variables.migrationAttractivenessWeights;
  return weightedMean([opportunity, weights.opportunity], [compatibility, weights.faction], [stability, weights.stability], [terrain, weights.terrain]);
}

function mergeTransferIntoCell(cell: CohortCell | undefined, transfer: MigrationTransferV5): CohortCell {
  const result = cell ? structuredClone(cell) : { settlementId: transfer.destinationSettlementId, breedId: transfer.breedId, tiers: {
    HIGH: { population: 0n, prosperity: transfer.prosperity }, MID: { population: 0n, prosperity: transfer.prosperity }, LOW: { population: 0n, prosperity: transfer.prosperity },
  } };
  const tier = result.tiers[transfer.tier];
  const population = tier.population + transfer.population;
  tier.prosperity = population === 0n ? tier.prosperity : Number(divideRoundedAway(tier.population * BigInt(tier.prosperity) + transfer.population * BigInt(transfer.prosperity), population));
  tier.population = population;
  return result;
}

export function applyMigrationTransfers(state: WorldStateV5, transfers: readonly MigrationTransferV5[]): WorldStateV5 {
  const before = state.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  const byKey = new Map(state.cohorts.map((cell) => [`${cell.settlementId}\0${cell.breedId}`, structuredClone(cell)]));
  const outgoing = new Map<string, bigint>();
  for (const transfer of transfers) {
    if (transfer.population < 0n) throw new Error("Migration transfer cannot be negative");
    const originKey = `${transfer.originSettlementId}\0${transfer.breedId}`;
    const source = byKey.get(originKey);
    if (!source) throw new Error(`Unknown migration source ${originKey}`);
    const consumed = (outgoing.get(`${originKey}\0${transfer.tier}`) ?? 0n) + transfer.population;
    if (consumed > source.tiers[transfer.tier].population) throw new Error(`Migration exceeds ${originKey}/${transfer.tier}`);
    outgoing.set(`${originKey}\0${transfer.tier}`, consumed);
  }
  for (const [key, amount] of outgoing) {
    const [settlementId, breedId, tier] = key.split("\0") as [string, string, SocialTier];
    byKey.get(`${settlementId}\0${breedId}`)!.tiers[tier].population -= amount;
  }
  for (const transfer of [...transfers].sort((a, b) => a.transferId.localeCompare(b.transferId))) {
    const destinationKey = `${transfer.destinationSettlementId}\0${transfer.breedId}`;
    byKey.set(destinationKey, mergeTransferIntoCell(byKey.get(destinationKey), transfer));
  }
  const cohorts = [...byKey.values()].filter((cell) => cellPopulation(cell) > 0n).sort((a, b) => `${a.settlementId}\0${a.breedId}`.localeCompare(`${b.settlementId}\0${b.breedId}`));
  const after = cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  if (before !== after) throw new Error(`Migration conservation failed: ${before} != ${after}`);
  return { ...state, cohorts };
}

function stableDigest(input: unknown): string { return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex").slice(0, 20); }

export function foundingDistanceCloseness(hops: number, maximumHops: number): Score1000 {
  return Number(divideRoundedAway(BigInt(maximumHops + 1 - hops) * 1000n, BigInt(maximumHops + 1)));
}

export function foundingSiteScore(terrain: Score1000, quality: Score1000, closeness: Score1000, variables: MechanicsVariablesV1): Score1000 {
  const weights = variables.foundingSiteScoreWeights;
  return weightedMean([terrain, weights.terrain], [quality, weights.quality], [closeness, weights.distance]);
}

interface MigrationProposal { transfer: MigrationTransferV5; attractiveness: Score1000; }
interface FoundingContribution {
  sourceSettlementId: string;
  breedId: string;
  tier: SocialTier;
  population: bigint;
  prosperity: Score1000;
  score: Score1000;
}
interface PooledFoundingProposal {
  proposalId: string;
  sourceStateId: string;
  targetRegionId: string;
  site: SiteAuthorityV5;
  population: bigint;
  score: Score1000;
  contributors: FoundingContribution[];
}

export interface MigrationReviewResult {
  state: WorldStateV5;
  events: CausalEventV5[];
  transfers: MigrationTransferV5[];
  namingRequests: NamingRequestV5[];
  destinationScoringCount: number;
  diagnostics: BoundedDiagnosticObservationV5[];
}

export function reviewVoluntaryMigration(state: WorldStateV5, metrics: DerivedMetricsV1, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1): MigrationReviewResult {
  if (state.year % variables.migrationReviewIntervalYears !== 0) return { state, events: [], transfers: [], namingRequests: [], destinationScoringCount: 0, diagnostics: [] };
  const settlementById = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const siteById = new Map(canonical.sites.map((site) => [site.siteId, site]));
  const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const occupiedSites = new Set(state.settlements.map((settlement) => settlement.siteId));
  const proposals: MigrationProposal[] = [];
  const foundingContributions = new Map<string, { sourceStateId: string; targetRegionId: string; site: SiteAuthorityV5; rows: FoundingContribution[] }>();
  const hopsByRegion = new Map<string, Map<string, number>>();
  let destinationScoringCount = 0;
  const migrationCounters: Record<string, number> = { migrationEvaluations: 0, cellsAboveMigrationPushThreshold: 0, desiredOutflowPositive: 0, qualifiedDestinations: 0, migrationTransfers: 0, uniqueOrigins: 0, uniqueDestinations: 0, uniqueBreedTierMovers: 0, totalVoluntaryPopulationMoved: 0, theoreticalMaximumOutflow: 0, actualDesiredOutflow: 0 };
  const foundingCounters: Record<string, number> = { positiveMigrationOutflowOpportunities: 0, noQualifyingOccupiedDestination: 0, foundingCandidateEvaluations: 0, eligibleUnoccupiedSites: 0, candidatesCreated: 0, candidatesMatured: 0, settlementFounded: 0, rejectedRouteReachability: 0, rejectedTerrainCompatibility: 0, rejectedMinimumPopulation: 0, rejectedPersistenceFailure: 0, rejectedSiteConflict: 0, rejectedNoEligibleSite: 0, rejectedRegionalDensity: 0 };
  const pushValues: number[] = [];
  const desiredValues: number[] = [];
  const attractivenessValues: number[] = [];
  const foundingScores: number[] = [];
  const desiredBySourceTier = new Map<string, bigint>();
  const theoreticalBySourceTier = new Map<string, bigint>();
  const maximumOpportunity = Math.max(...Object.values(metrics.localOpportunity));
  const bandStart = Math.floor(state.year / 25) * 25;
  const bandEnd = bandStart + 24;
  const incrementDimension = (stateId: string, regionId: string, metric: string, amount = 1): void => {
    const key = `band_${bandStart}_${bandEnd}/state_${stateId}/region_${regionId}/${metric}`;
    migrationCounters[key] = (migrationCounters[key] ?? 0) + amount;
  };
  const regionSettlementCount = new Map<string, number>();
  for (const settlement of state.settlements) regionSettlementCount.set(settlement.regionId, (regionSettlementCount.get(settlement.regionId) ?? 0) + 1);
  const regionsByState = new Map<string, Set<string>>();
  for (const settlement of state.settlements) {
    const regions = regionsByState.get(settlement.stateId) ?? new Set<string>();
    regions.add(settlement.regionId);
    regionsByState.set(settlement.stateId, regions);
  }
  const regionCanFound = (sourceStateId: string, regionId: string): boolean => {
    if (!regionsByState.get(sourceStateId)?.has(regionId)) return false;
    const count = regionSettlementCount.get(regionId) ?? 0;
    return regionId === "R10" ? count >= 1 && count < 7 : count >= 5 && count < 7;
  };
  for (const cell of [...state.cohorts].sort((a, b) => `${a.settlementId}\0${a.breedId}`.localeCompare(`${b.settlementId}\0${b.breedId}`))) {
    const origin = settlementById.get(cell.settlementId)!;
    const breed = breedById.get(cell.breedId)!;
    const vector = breedFactionVector(breed);
    let hops = hopsByRegion.get(origin.regionId);
    if (!hops) { hops = shortestDirectedRegionHops(canonical, origin.regionId, variables.migrationMaximumHops); hopsByRegion.set(origin.regionId, hops); }
    for (const tier of ["HIGH", "MID", "LOW"] as const) {
      migrationCounters.migrationEvaluations! += 1;
      incrementDimension(origin.stateId, origin.regionId, "migrationEvaluations");
      const economicDisadvantage = clamp(maximumOpportunity - cell.tiers[tier].prosperity, 0, 1000);
      const compatibility = metrics.settlementPopulationFactionVectors[origin.settlementId] ? importCompatibility(vector, metrics.settlementPopulationFactionVectors[origin.settlementId]!) : 500;
      const push = migrationPush(compatibility, economicDisadvantage, origin.unrest, variables);
      pushValues.push(push);
      for (const threshold of [275, 250, 225, 200] as const) {
        const candidateDesired = desiredMigrationOutflow(cell.tiers[tier].population, push, { ...variables, migrationPushThreshold: threshold });
        if (candidateDesired > 0n) migrationCounters[`calibrationDesiredPositiveThreshold${threshold}`] = (migrationCounters[`calibrationDesiredPositiveThreshold${threshold}`] ?? 0) + 1;
      }
      const sourceKey = `${origin.settlementId}\0${cell.breedId}\0${tier}`;
      const theoretical = cell.tiers[tier].population * BigInt(variables.migrationMaximumOutflowBps) / 10_000n;
      theoreticalBySourceTier.set(sourceKey, theoretical);
      migrationCounters.theoreticalMaximumOutflow! += Number(theoretical);
      if (push > variables.migrationPushThreshold) migrationCounters.cellsAboveMigrationPushThreshold! += 1;
      const desired = desiredMigrationOutflow(cell.tiers[tier].population, push, variables);
      desiredBySourceTier.set(sourceKey, desired);
      desiredValues.push(Number(desired > 1000n ? 1000n : desired));
      if (desired === 0n) continue;
      migrationCounters.desiredOutflowPositive! += 1;
      migrationCounters.actualDesiredOutflow! += Number(desired);
      foundingCounters.positiveMigrationOutflowOpportunities! += 1;
      incrementDimension(origin.stateId, origin.regionId, "desiredOutflowPositive");
      const destinations = state.settlements.filter((destination) => destination.settlementId !== origin.settlementId && hops.has(destination.regionId) && hops.get(destination.regionId)! <= variables.migrationMaximumHops).sort((a, b) => a.settlementId.localeCompare(b.settlementId));
      const qualified = destinations.map((destination) => {
        destinationScoringCount += 1;
        const destinationSite = siteById.get(destination.siteId)!;
        const terrain = terrainCompatibility(breed.terrainBroad, breed.terrainSpecific, destinationSite.terrainBroad, destinationSite.terrainSpecific, owner);
        const faction = importCompatibility(vector, metrics.settlementPopulationFactionVectors[destination.settlementId]!);
        const score = destinationAttractiveness(metrics.localOpportunity[destination.settlementId]!, faction, 1000 - destination.unrest, terrain, variables);
        attractivenessValues.push(score);
        return { destination, score };
      }).filter((row) => row.score >= variables.migrationDestinationMinimumAttractiveness);
      if (qualified.length > 0) {
        migrationCounters.qualifiedDestinations! += qualified.length;
        const amounts = largestRemainder(desired, qualified.map((row) => BigInt(row.score + 1)), qualified.map((row) => row.destination.settlementId));
        qualified.forEach((row, index) => { if (amounts[index]! > 0n) proposals.push({ attractiveness: row.score, transfer: { transferId: `MIG_${state.year}_${origin.settlementId}_${cell.breedId}_${tier}_${row.destination.settlementId}`, breedId: cell.breedId, tier, originSettlementId: origin.settlementId, destinationSettlementId: row.destination.settlementId, population: amounts[index]!, prosperity: cell.tiers[tier].prosperity, cause: "VOLUNTARY" } }); });
        continue;
      }
      foundingCounters.noQualifyingOccupiedDestination! += 1;
      foundingCounters.foundingCandidateEvaluations! += 1;
      const stateRegions = regionsByState.get(origin.stateId) ?? new Set<string>();
      const densityEligibleRegions = [...stateRegions].filter((regionId) => regionCanFound(origin.stateId, regionId));
      if (densityEligibleRegions.length === 0) foundingCounters.rejectedRegionalDensity! += 1;
      const reachableSites = canonical.sites.filter((site) => densityEligibleRegions.includes(site.regionId) && !occupiedSites.has(site.siteId) && !site.prohibitedFounding && hops.has(site.regionId) && hops.get(site.regionId)! <= variables.migrationMaximumHops);
      if (densityEligibleRegions.length > 0 && reachableSites.length === 0) foundingCounters.rejectedRouteReachability! += 1;
      const sites = reachableSites.map((site) => {
        const terrain = terrainCompatibility(breed.terrainBroad, breed.terrainSpecific, site.terrainBroad, site.terrainSpecific, owner);
        const score = foundingSiteScore(terrain, site.quality ?? variables.foundingSiteQualityFallback, foundingDistanceCloseness(hops.get(site.regionId)!, variables.migrationMaximumHops), variables);
        return { site, terrain, score };
      }).filter((row) => row.terrain >= variables.foundingTerrainCompatibilityMinimum).sort((a, b) => b.score - a.score || a.site.siteId.localeCompare(b.site.siteId));
      foundingCounters.eligibleUnoccupiedSites! += sites.length;
      if (reachableSites.length > 0 && sites.length === 0) foundingCounters.rejectedTerrainCompatibility! += 1;
      if (sites.length === 0) foundingCounters.rejectedNoEligibleSite! += 1;
      for (const candidate of sites) {
        const proposalId = `FOUNDING_CANDIDATE:${origin.stateId}:${candidate.site.regionId}:${candidate.site.siteId}`;
        const pool = foundingContributions.get(proposalId) ?? { sourceStateId: origin.stateId, targetRegionId: candidate.site.regionId, site: candidate.site, rows: [] };
        pool.rows.push({ sourceSettlementId: origin.settlementId, breedId: cell.breedId, tier, population: desired, prosperity: cell.tiers[tier].prosperity, score: candidate.score });
        foundingContributions.set(proposalId, pool);
      }
    }
  }
  const foundingProposals: PooledFoundingProposal[] = [...foundingContributions].map(([proposalId, pool]) => {
    const population = pool.rows.reduce((sum, row) => sum + row.population, 0n);
    const score = population === 0n ? 0 : Number(divideRoundedAway(pool.rows.reduce((sum, row) => sum + row.population * BigInt(row.score), 0n), population));
    return { proposalId, sourceStateId: pool.sourceStateId, targetRegionId: pool.targetRegionId, site: pool.site, population, score, contributors: pool.rows.sort((left, right) => `${left.sourceSettlementId}\0${left.breedId}\0${left.tier}`.localeCompare(`${right.sourceSettlementId}\0${right.breedId}\0${right.tier}`)) };
  }).filter((proposal) => {
    if (proposal.population < variables.foundingMinimumPopulation) { foundingCounters.rejectedMinimumPopulation! += 1; return false; }
    foundingScores.push(proposal.score);
    return true;
  });
  const conditions = state.timedConditions.filter((condition) => condition.type !== "FOUNDING_CANDIDATE");
  const priorCandidates = new Map(state.timedConditions.filter((condition) => condition.type === "FOUNDING_CANDIDATE").map((condition) => [condition.key, condition]));
  const matured: PooledFoundingProposal[] = [];
  for (const proposal of foundingProposals) {
    const prior = priorCandidates.get(proposal.proposalId);
    const count = (prior?.qualifyingReviewCount ?? 0) + 1;
    if (count >= variables.foundingRequiredReviews) { matured.push(proposal); foundingCounters.candidatesMatured! += 1; }
    else { conditions.push({ conditionId: `COND_${stableDigest(proposal.proposalId)}`, type: "FOUNDING_CANDIDATE", targetType: "STATE", targetId: proposal.sourceStateId, magnitude: 0, startYear: prior?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${state.worldKey}_${state.year}_FOUNDING_CANDIDATE`, key: proposal.proposalId, qualifyingReviewCount: count }); foundingCounters.candidatesCreated! += 1; }
  }
  const siteWinners = new Map<string, PooledFoundingProposal>();
  const winningStates = new Set<string>();
  for (const proposal of matured.sort((a, b) => b.score - a.score || (a.population === b.population ? a.proposalId.localeCompare(b.proposalId) : a.population > b.population ? -1 : 1))) {
    if (!siteWinners.has(proposal.site.siteId) && !winningStates.has(proposal.sourceStateId)) { siteWinners.set(proposal.site.siteId, proposal); winningStates.add(proposal.sourceStateId); }
  }
  let working: WorldStateV5 = { ...state, timedConditions: conditions };
  const transfers: MigrationTransferV5[] = proposals.map((row) => row.transfer);
  const events: CausalEventV5[] = [];
  const namingRequests: NamingRequestV5[] = [];
  for (const proposal of siteWinners.values()) {
    foundingCounters.settlementFounded! += 1;
    const sourceSettlements = state.settlements.filter((settlement) => settlement.stateId === proposal.sourceStateId);
    const sourceUnrestPopulation = proposal.contributors.reduce((sum, row) => sum + row.population * BigInt(settlementById.get(row.sourceSettlementId)?.unrest ?? 0), 0n);
    const settlementId = `SETTLEMENT_${state.worldKey}_${proposal.site.siteId}`;
    const initialSectors = Object.fromEntries(["LAND_AND_FOOD", "EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT", "KNOWLEDGE_AND_SERVICES"].map((sector) => [sector, weightedMean([variables.industryInitialFallback, 5000], [sectorTerrainFit(proposal.site, sector), 5000])])) as Record<SectorId, Score1000>;
    const unrest = proposal.population === 0n ? 0 : Number(divideRoundedAway(sourceUnrestPopulation, proposal.population));
    const settlement: SettlementV5 = { settlementId, siteId: proposal.site.siteId, regionId: proposal.site.regionId, stateId: proposal.sourceStateId, foundedYear: state.year, unrest, sectorStrengths: initialSectors };
    working = { ...working, settlements: [...working.settlements, settlement].sort((a, b) => a.settlementId.localeCompare(b.settlementId)) };
    proposal.contributors.forEach((contributor, index) => transfers.push({ transferId: `FOUNDING_TRANSFER_${stableDigest([proposal.proposalId, state.year, index, contributor.sourceSettlementId, contributor.breedId, contributor.tier])}`, breedId: contributor.breedId, tier: contributor.tier, originSettlementId: contributor.sourceSettlementId, destinationSettlementId: settlementId, population: contributor.population, prosperity: contributor.prosperity, cause: "FOUNDING" }));
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_SETTLEMENT_FOUNDED_${settlementId}`, worldKey: state.worldKey, year: state.year, phase: "VOLUNTARY_MIGRATION", sequence: events.length, eventType: "SettlementFounded", entityType: "SETTLEMENT", entityId: settlementId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { siteId: proposal.site.siteId, stateId: proposal.sourceStateId, targetRegionId: proposal.targetRegionId, foundingCause: "EMERGENT_MIGRATION", sourceSettlementIds: sourceSettlements.map((row) => row.settlementId).sort(), contributorCount: proposal.contributors.length, currentAggregateDemand: proposal.population.toString() } });
    namingRequests.push({ requestId: `NAME_${settlementId}`, entityType: "SETTLEMENT", entityId: settlementId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${proposal.site.siteId}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${proposal.site.siteId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "EMERGENT_FOUNDING", settlementId, siteId: proposal.site.siteId, regionId: proposal.site.regionId, regionName: proposal.site.regionName, continent: proposal.site.continent ?? null, stateId: proposal.sourceStateId } });
  }
  const actualBySourceTier = new Map<string, bigint>();
  for (const transfer of transfers) {
    const key = `${transfer.originSettlementId}\0${transfer.breedId}\0${transfer.tier}`;
    actualBySourceTier.set(key, (actualBySourceTier.get(key) ?? 0n) + transfer.population);
  }
  let maximumActualToDesiredBps = 0;
  let maximumVoluntaryActualToDesiredBps = 0;
  const voluntaryActualBySourceTier = new Map<string, bigint>();
  for (const transfer of transfers.filter((row) => row.cause === "VOLUNTARY")) {
    const key = `${transfer.originSettlementId}\0${transfer.breedId}\0${transfer.tier}`;
    voluntaryActualBySourceTier.set(key, (voluntaryActualBySourceTier.get(key) ?? 0n) + transfer.population);
  }
  for (const [key, amount] of actualBySourceTier) {
    const desired = desiredBySourceTier.get(key) ?? 0n;
    if (amount > desired) throw new Error(`Migration source-cell outflow exceeded desiredMigrationOutflow for ${key}`);
    if (desired > 0n) maximumActualToDesiredBps = Math.max(maximumActualToDesiredBps, Number(amount * 10_000n / desired));
  }
  for (const [key, amount] of voluntaryActualBySourceTier) {
    const desired = desiredBySourceTier.get(key) ?? 0n;
    if (amount > desired) throw new Error(`Voluntary migration source-cell outflow exceeded desiredMigrationOutflow for ${key}`);
    if (desired > 0n) maximumVoluntaryActualToDesiredBps = Math.max(maximumVoluntaryActualToDesiredBps, Number(amount * 10_000n / desired));
  }
  const voluntaryPopulationMoved = transfers.filter((transfer) => transfer.cause === "VOLUNTARY").reduce((sum, transfer) => sum + transfer.population, 0n);
  const theoreticalMaximumOutflow = [...theoreticalBySourceTier.values()].reduce((sum, amount) => sum + amount, 0n);
  if (voluntaryPopulationMoved > theoreticalMaximumOutflow) throw new Error("Migration review aggregate outflow exceeded the sum of per-cell theoretical limits");
  migrationCounters.perCellSafetyChecks = actualBySourceTier.size;
  migrationCounters.perCellSafetyViolations = 0;
  migrationCounters.maximumActualToDesiredBps = maximumActualToDesiredBps;
  migrationCounters.maximumVoluntaryActualToDesiredBps = maximumVoluntaryActualToDesiredBps;
  migrationCounters.aggregateSafetyChecks = 1;
  migrationCounters.aggregateSafetyViolations = 0;
  migrationCounters.aggregateActualToTheoreticalBps = theoreticalMaximumOutflow === 0n ? 0 : Number(voluntaryPopulationMoved * 10_000n / theoreticalMaximumOutflow);
  migrationCounters.populationConservationChecks = 1;
  migrationCounters.populationConservationViolations = 0;
  working = applyMigrationTransfers(working, transfers);
  transfers.forEach((transfer, sequence) => events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${transfer.transferId}`, worldKey: state.worldKey, year: state.year, phase: "VOLUNTARY_MIGRATION", sequence: events.length + sequence, eventType: transfer.cause === "FOUNDING" ? "FoundingTransfer" : "MigrationTransfer", entityType: "COHORT_CELL", entityId: `${transfer.destinationSettlementId}/${transfer.breedId}`, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { ...transfer, population: transfer.population.toString() } }));
  foundingCounters.rejectedPersistenceFailure = [...priorCandidates.keys()].filter((key) => !foundingProposals.some((proposal) => proposal.proposalId === key)).length;
  foundingCounters.rejectedSiteConflict = matured.length - siteWinners.size;
  const voluntaryTransfers = transfers.filter((transfer) => transfer.cause === "VOLUNTARY");
  migrationCounters.migrationTransfers = voluntaryTransfers.length;
  migrationCounters.uniqueOrigins = new Set(voluntaryTransfers.map((transfer) => transfer.originSettlementId)).size;
  migrationCounters.uniqueDestinations = new Set(voluntaryTransfers.map((transfer) => transfer.destinationSettlementId)).size;
  migrationCounters.uniqueBreedTierMovers = new Set(voluntaryTransfers.map((transfer) => `${transfer.breedId}/${transfer.tier}`)).size;
  migrationCounters.totalVoluntaryPopulationMoved = Number(voluntaryPopulationMoved);
  return { state: working, events, transfers, namingRequests, destinationScoringCount, diagnostics: [
    { domain: "MIGRATION", worldKey: state.worldKey, year: state.year, counters: migrationCounters, histograms: { push: boundedHistogram(pushValues), desiredOutflow: boundedHistogram(desiredValues), destinationAttractiveness: boundedHistogram(attractivenessValues) } },
    { domain: "FOUNDING", worldKey: state.worldKey, year: state.year, counters: foundingCounters, histograms: { foundingSiteScore: boundedHistogram(foundingScores), contributorCount: boundedHistogram(foundingProposals.map((proposal) => proposal.contributors.length)) } },
  ] };
}

function importCompatibility(a: import("./types.js").FactionVector, b: import("./types.js").FactionVector): number {
  const distance = Math.abs(a.CONCORD - b.CONCORD) + Math.abs(a.SCHISM - b.SCHISM) + Math.abs(a.RUIN - b.RUIN);
  return 1000 - Number(divideRoundedAway(BigInt(distance), 2n));
}

export interface CanonicalFoundingTransactionInputV5 {
  transactionId: string;
  year: number;
  foundingWaveId: string;
  ordinalWithinRegion: 2 | 3 | 4 | 5;
  sourceStateId: string;
  regionId: string;
  targetSiteId: string;
  settlementId: string;
  transferPolicyVersion: string;
}

export function executeCanonicalFoundingWave(
  state: WorldStateV5,
  canonical: CanonicalDataV5,
  variables: MechanicsVariablesV1,
  transactions: readonly CanonicalFoundingTransactionInputV5[],
): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  if (transactions.length === 0) return { state, events: [], namingRequests: [] };
  const ordered = [...transactions].sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  const waveIds = new Set(ordered.map((transaction) => transaction.foundingWaveId));
  if (waveIds.size !== 1 || ordered.some((transaction) => transaction.year !== state.year)) throw new Error("Canonical founding wave must resolve one complete wave for the current year");
  const transactionStateIds = new Set(ordered.map((transaction) => transaction.sourceStateId));
  if (transactionStateIds.size !== ordered.length) throw new Error("Canonical founding wave contains duplicate source State authority");
  const eligibleStateIds = new Set(state.settlements.filter((settlement) => settlement.regionId !== "R10").map((settlement) => settlement.stateId));
  if (transactionStateIds.size !== eligibleStateIds.size || [...eligibleStateIds].some((stateId) => !transactionStateIds.has(stateId))) throw new Error("Canonical founding wave is incomplete for the original State authority");
  if (new Set(ordered.map((transaction) => transaction.targetSiteId)).size !== ordered.length || new Set(ordered.map((transaction) => transaction.settlementId)).size !== ordered.length) throw new Error("Canonical founding wave contains duplicate physical identities");
  const siteById = new Map(canonical.sites.map((site) => [site.siteId, site]));
  const occupied = new Set(state.settlements.map((settlement) => settlement.siteId));
  const stateIds = new Set(state.states.map((politicalState) => politicalState.stateId));
  const settlements: SettlementV5[] = [];
  const transfers: MigrationTransferV5[] = [];
  for (const transaction of ordered) {
    if (transaction.transferPolicyVersion !== "CANONICAL_FOUNDING_TEN_PERCENT_PER_CELL_V1") throw new Error(`Unsupported canonical founding transfer policy ${transaction.transferPolicyVersion}`);
    if (!stateIds.has(transaction.sourceStateId)) throw new Error(`Canonical founding references unknown State ${transaction.sourceStateId}`);
    const site = siteById.get(transaction.targetSiteId);
    if (!site) throw new Error(`Canonical founding Site ${transaction.targetSiteId} does not exist`);
    if (site.regionId !== transaction.regionId || site.regionId === "R10" || site.prohibitedFounding) throw new Error(`Canonical founding target ${site.siteId} is not eligible for ${transaction.regionId}`);
    if (occupied.has(site.siteId)) throw new Error(`Canonical founding Site ${site.siteId} is already occupied`);
    if (transaction.settlementId !== `SETTLEMENT_${state.worldKey}_${site.siteId}`) throw new Error(`Canonical founding Settlement identity is not stable for ${site.siteId}`);
    const sourceSettlementIds = new Set(state.settlements.filter((settlement) => settlement.stateId === transaction.sourceStateId).map((settlement) => settlement.settlementId));
    if (sourceSettlementIds.size === 0) throw new Error(`Canonical founding State ${transaction.sourceStateId} has no source Settlements`);
    const transactionTransfers: MigrationTransferV5[] = [];
    for (const cell of state.cohorts.filter((candidate) => sourceSettlementIds.has(candidate.settlementId)).sort((left, right) => `${left.settlementId}\0${left.breedId}`.localeCompare(`${right.settlementId}\0${right.breedId}`))) {
      for (const tier of ["HIGH", "MID", "LOW"] as const) {
        const population = cell.tiers[tier].population / 10n;
        if (population === 0n) continue;
        transactionTransfers.push({
          transferId: `FOUNDING_${transaction.foundingWaveId}_${transaction.sourceStateId}_${cell.settlementId}_${cell.breedId}_${tier}`,
          breedId: cell.breedId,
          tier,
          originSettlementId: cell.settlementId,
          destinationSettlementId: transaction.settlementId,
          population,
          prosperity: cell.tiers[tier].prosperity,
          cause: "FOUNDING",
        });
      }
    }
    const moved = transactionTransfers.reduce((sum, transfer) => sum + transfer.population, 0n);
    const unrest = moved === 0n ? 0 : Number(divideRoundedAway(transactionTransfers.reduce((sum, transfer) => sum + transfer.population * BigInt(state.settlements.find((settlement) => settlement.settlementId === transfer.originSettlementId)?.unrest ?? 0), 0n), moved));
    const sectorStrengths = Object.fromEntries(["LAND_AND_FOOD", "EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT", "KNOWLEDGE_AND_SERVICES"].map((sector) => [sector, weightedMean([variables.industryInitialFallback, 5000], [sectorTerrainFit(site, sector), 5000])])) as Record<SectorId, Score1000>;
    settlements.push({ settlementId: transaction.settlementId, siteId: site.siteId, regionId: site.regionId, stateId: transaction.sourceStateId, foundedYear: state.year, unrest, sectorStrengths });
    transfers.push(...transactionTransfers);
    occupied.add(site.siteId);
  }
  const populationBefore = state.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  let next = applyMigrationTransfers({ ...state, settlements: [...state.settlements, ...settlements].sort((left, right) => left.settlementId.localeCompare(right.settlementId)) }, transfers);
  const populationAfter = next.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n);
  if (populationBefore !== populationAfter) throw new Error(`Canonical founding wave population conservation failed: ${populationBefore} != ${populationAfter}`);
  for (const settlement of settlements) {
    const transferred = transfers.filter((transfer) => transfer.destinationSettlementId === settlement.settlementId).reduce((sum, transfer) => sum + transfer.population, 0n);
    if (settlementPopulation(next, settlement.settlementId) !== transferred) throw new Error(`Canonical founding Settlement ${settlement.settlementId} population does not equal its transfers`);
  }
  next = { ...next, timedConditions: next.timedConditions.filter((condition) => condition.type !== "FOUNDING_CANDIDATE") };
  const events: CausalEventV5[] = [];
  const namingRequests: NamingRequestV5[] = [];
  for (const transaction of ordered) {
    const site = siteById.get(transaction.targetSiteId)!;
    const settlementTransfers = transfers.filter((transfer) => transfer.destinationSettlementId === transaction.settlementId);
    const eventId = `EVT_${state.worldKey}_${state.year}_${transaction.foundingWaveId}_${transaction.sourceStateId}`;
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "SettlementFounded", entityType: "SETTLEMENT", entityId: transaction.settlementId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { foundingWaveId: transaction.foundingWaveId, ordinalWithinRegion: transaction.ordinalWithinRegion, sourceStateId: transaction.sourceStateId, regionId: transaction.regionId, siteId: transaction.targetSiteId, settlementId: transaction.settlementId, transferPolicyVersion: transaction.transferPolicyVersion, sourceSettlementIds: [...new Set(settlementTransfers.map((transfer) => transfer.originSettlementId))].sort(), movedPopulation: settlementTransfers.reduce((sum, transfer) => sum + transfer.population, 0n).toString(), populationConserved: true } });
    settlementTransfers.forEach((transfer, index) => events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `${eventId}_TRANSFER_${String(index).padStart(6, "0")}`, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "FoundingTransfer", entityType: "COHORT_CELL", entityId: `${transaction.settlementId}/${transfer.breedId}`, causeEventIds: [eventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { ...transfer, population: transfer.population.toString(), foundingWaveId: transaction.foundingWaveId, transferPolicyVersion: transaction.transferPolicyVersion } }));
    const canonicalLabel = canonical.canonicalLabels[site.siteId] ?? null;
    const canonicalAuthority = canonical.canonicalLabelAuthority?.[site.siteId] ?? null;
    namingRequests.push({ requestId: `NAME_${transaction.settlementId}`, entityType: "SETTLEMENT", entityId: transaction.settlementId, behavior: canonicalAuthority && canonicalLabel ? "NO_NAME_REQUIRED" : "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${site.siteId}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${site.siteId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: canonicalAuthority ? canonicalLabel : null, context: { world: state.worldKey, creationYear: state.year, causalReason: transaction.foundingWaveId, settlementId: transaction.settlementId, siteId: site.siteId, regionId: site.regionId, regionName: site.regionName, continent: site.continent ?? null, stateId: transaction.sourceStateId, ordinalWithinRegion: transaction.ordinalWithinRegion, canonicalNamingAuthorityRef: canonicalAuthority } });
  }
  return { state: next, events, namingRequests };
}

export interface ForcedFoundingInput {
  eventId: string;
  siteId: string;
  stateId: string;
  transfers: Omit<MigrationTransferV5, "destinationSettlementId" | "cause">[];
  initialUnrestOverride?: Score1000;
  sectorOverrides?: Partial<Record<SectorId, Score1000>>;
}

export function executeCanonicalFounding(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, input: ForcedFoundingInput): { state: WorldStateV5; events: CausalEventV5[]; namingRequest: NamingRequestV5 } {
  const site = canonical.sites.find((row) => row.siteId === input.siteId);
  if (!site) throw new Error(`Canonical founding Site ${input.siteId} does not exist`);
  if (state.settlements.some((settlement) => settlement.siteId === site.siteId)) throw new Error(`Site ${site.siteId} is already occupied`);
  const settlementId = `SETTLEMENT_${state.worldKey}_${site.siteId}`;
  const sourcePopulation = input.transfers.reduce((sum, transfer) => sum + transfer.population, 0n);
  const unrest = input.initialUnrestOverride ?? (sourcePopulation === 0n ? 0 : Number(divideRoundedAway(input.transfers.reduce((sum, transfer) => {
    const source = state.settlements.find((row) => row.settlementId === transfer.originSettlementId);
    return sum + transfer.population * BigInt(source?.unrest ?? 0);
  }, 0n), sourcePopulation)));
  const sectorStrengths = Object.fromEntries(["LAND_AND_FOOD", "EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT", "KNOWLEDGE_AND_SERVICES"].map((sector) => [sector, input.sectorOverrides?.[sector as SectorId] ?? weightedMean([variables.industryInitialFallback, 5000], [sectorTerrainFit(site, sector), 5000])])) as Record<SectorId, Score1000>;
  const settlement: SettlementV5 = { settlementId, siteId: site.siteId, regionId: site.regionId, stateId: input.stateId, foundedYear: state.year, unrest, sectorStrengths };
  const transfers = input.transfers.map((transfer) => ({ ...transfer, destinationSettlementId: settlementId, cause: "FOUNDING" as const }));
  const next = applyMigrationTransfers({ ...state, settlements: [...state.settlements, settlement].sort((a, b) => a.settlementId.localeCompare(b.settlementId)) }, transfers);
  const events: CausalEventV5[] = [{ schemaVersion: "echoes-causal-event-v5", eventId: input.eventId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: 0, eventType: "SettlementFounded", entityType: "SETTLEMENT", entityId: settlementId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { siteId: site.siteId, stateId: input.stateId, foundingCause: "CANONICAL" } }, ...transfers.map((transfer, index) => ({ schemaVersion: "echoes-causal-event-v5" as const, eventId: `${input.eventId}_TRANSFER_${index}`, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL" as const, sequence: index + 1, eventType: "FoundingTransfer", entityType: "COHORT_CELL", entityId: `${settlementId}/${transfer.breedId}`, causeEventIds: [input.eventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { ...transfer, population: transfer.population.toString() } }))];
  const canonicalLabel = canonical.canonicalLabels[site.siteId] ?? null;
  const canonicalAuthority = canonical.canonicalLabelAuthority?.[site.siteId] ?? null;
  return { state: next, events, namingRequest: { requestId: `NAME_${settlementId}`, entityType: "SETTLEMENT", entityId: settlementId, behavior: canonicalAuthority && canonicalLabel ? "NO_NAME_REQUIRED" : "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${site.siteId}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${site.siteId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: canonicalAuthority ? canonicalLabel : null, context: { world: state.worldKey, creationYear: state.year, causalReason: "CANONICAL_FOUNDING_FIXTURE", settlementId, siteId: site.siteId, regionId: site.regionId, regionName: site.regionName, continent: site.continent ?? null, stateId: input.stateId, canonicalNamingAuthorityRef: canonicalAuthority, djtYearAuthorityStatus: "UNRESOLVED_OWNER_AUTHORITY" } } };
}
