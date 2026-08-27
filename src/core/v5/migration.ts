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
interface FoundingProposal { proposalId: string; sourceSettlementId: string; breedId: string; tier: SocialTier; site: SiteAuthorityV5; population: bigint; prosperity: Score1000; score: Score1000; }

export interface MigrationReviewResult {
  state: WorldStateV5;
  events: CausalEventV5[];
  transfers: MigrationTransferV5[];
  namingRequests: NamingRequestV5[];
  destinationScoringCount: number;
  diagnostics: BoundedDiagnosticObservationV5;
}

export function reviewVoluntaryMigration(state: WorldStateV5, metrics: DerivedMetricsV1, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1): MigrationReviewResult {
  if (state.year % variables.migrationReviewIntervalYears !== 0) return { state, events: [], transfers: [], namingRequests: [], destinationScoringCount: 0, diagnostics: { domain: "FOUNDING", worldKey: state.worldKey, year: state.year, counters: {}, histograms: {} } };
  const settlementById = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const siteById = new Map(canonical.sites.map((site) => [site.siteId, site]));
  const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const occupiedSites = new Set(state.settlements.map((settlement) => settlement.siteId));
  const proposals: MigrationProposal[] = [];
  const foundingProposals: FoundingProposal[] = [];
  const hopsByRegion = new Map<string, Map<string, number>>();
  let destinationScoringCount = 0;
  const diagnosticCounters: Record<string, number> = { positiveMigrationOutflowOpportunities: 0, noQualifyingOccupiedDestination: 0, foundingCandidateEvaluations: 0, eligibleUnoccupiedSites: 0, candidatesCreated: 0, candidatesSecondReview: 0, settlementFounded: 0, rejectedQualifyingDestinationAppeared: 0, rejectedRouteReachability: 0, rejectedTerrainCompatibility: 0, rejectedMinimumPopulation: 0, rejectedPersistenceFailure: 0, rejectedSiteConflict: 0, rejectedNoEligibleSite: 0 };
  const foundingScores: number[] = [];
  for (const cell of [...state.cohorts].sort((a, b) => `${a.settlementId}\0${a.breedId}`.localeCompare(`${b.settlementId}\0${b.breedId}`))) {
    const origin = settlementById.get(cell.settlementId)!;
    const breed = breedById.get(cell.breedId)!;
    const vector = breedFactionVector(breed);
    let hops = hopsByRegion.get(origin.regionId);
    if (!hops) { hops = shortestDirectedRegionHops(canonical, origin.regionId, variables.migrationMaximumHops); hopsByRegion.set(origin.regionId, hops); }
    for (const tier of ["HIGH", "MID", "LOW"] as const) {
      const economicDisadvantage = clamp(Math.max(...Object.values(metrics.localOpportunity)) - cell.tiers[tier].prosperity, 0, 1000);
      const compatibility = metrics.settlementPopulationFactionVectors[origin.settlementId] ? importCompatibility(vector, metrics.settlementPopulationFactionVectors[origin.settlementId]!) : 500;
      const push = migrationPush(compatibility, economicDisadvantage, origin.unrest, variables);
      const desired = desiredMigrationOutflow(cell.tiers[tier].population, push, variables);
      if (desired === 0n) continue;
      diagnosticCounters.positiveMigrationOutflowOpportunities! += 1;
      const destinations = state.settlements.filter((destination) => destination.settlementId !== origin.settlementId && hops.has(destination.regionId) && hops.get(destination.regionId)! <= variables.migrationMaximumHops).sort((a, b) => a.settlementId.localeCompare(b.settlementId));
      const qualified = destinations.map((destination) => {
        destinationScoringCount += 1;
        const destinationSite = siteById.get(destination.siteId)!;
        const terrain = terrainCompatibility(breed.terrainBroad, breed.terrainSpecific, destinationSite.terrainBroad, destinationSite.terrainSpecific, owner);
        const faction = importCompatibility(vector, metrics.settlementPopulationFactionVectors[destination.settlementId]!);
        const score = destinationAttractiveness(metrics.localOpportunity[destination.settlementId]!, faction, 1000 - destination.unrest, terrain, variables);
        return { destination, score };
      }).filter((row) => row.score >= variables.migrationDestinationMinimumAttractiveness);
      if (qualified.length > 0) {
        const amounts = largestRemainder(desired, qualified.map((row) => BigInt(row.score + 1)), qualified.map((row) => row.destination.settlementId));
        qualified.forEach((row, index) => { if (amounts[index]! > 0n) proposals.push({ attractiveness: row.score, transfer: { transferId: `MIG_${state.year}_${origin.settlementId}_${cell.breedId}_${tier}_${row.destination.settlementId}`, breedId: cell.breedId, tier, originSettlementId: origin.settlementId, destinationSettlementId: row.destination.settlementId, population: amounts[index]!, prosperity: cell.tiers[tier].prosperity, cause: "VOLUNTARY" } }); });
        continue;
      }
      diagnosticCounters.noQualifyingOccupiedDestination! += 1; diagnosticCounters.foundingCandidateEvaluations! += 1;
      const reachableSites = canonical.sites.filter((site) => !occupiedSites.has(site.siteId) && !site.prohibitedFounding && hops.has(site.regionId) && hops.get(site.regionId)! <= variables.migrationMaximumHops);
      if (reachableSites.length === 0) diagnosticCounters.rejectedRouteReachability! += 1;
      const sites = reachableSites.map((site) => {
        const terrain = terrainCompatibility(breed.terrainBroad, breed.terrainSpecific, site.terrainBroad, site.terrainSpecific, owner);
        const score = foundingSiteScore(terrain, site.quality ?? variables.foundingSiteQualityFallback, foundingDistanceCloseness(hops.get(site.regionId)!, variables.migrationMaximumHops), variables);
        return { site, terrain, score };
      }).filter((row) => row.terrain >= variables.foundingTerrainCompatibilityMinimum).sort((a, b) => b.score - a.score || a.site.siteId.localeCompare(b.site.siteId));
      diagnosticCounters.eligibleUnoccupiedSites! += sites.length;
      if (reachableSites.length > 0 && sites.length === 0) diagnosticCounters.rejectedTerrainCompatibility! += 1;
      if (desired < variables.foundingMinimumPopulation) diagnosticCounters.rejectedMinimumPopulation! += 1;
      else if (sites[0]) { foundingScores.push(sites[0].score); foundingProposals.push({ proposalId: `FOUNDING_PROPOSAL_${origin.settlementId}_${cell.breedId}_${tier}_${sites[0].site.siteId}`, sourceSettlementId: origin.settlementId, breedId: cell.breedId, tier, site: sites[0].site, population: desired, prosperity: cell.tiers[tier].prosperity, score: sites[0].score }); }
      else diagnosticCounters.rejectedNoEligibleSite! += 1;
    }
  }
  const conditions = state.timedConditions.filter((condition) => condition.type !== "FOUNDING_CANDIDATE");
  const priorCandidates = new Map(state.timedConditions.filter((condition) => condition.type === "FOUNDING_CANDIDATE").map((condition) => [condition.key, condition]));
  const matured: FoundingProposal[] = [];
  for (const proposal of foundingProposals) {
    const prior = priorCandidates.get(proposal.proposalId);
    const count = (prior?.qualifyingReviewCount ?? 0) + 1;
    if (count >= variables.foundingRequiredReviews) { matured.push(proposal); diagnosticCounters.candidatesSecondReview! += 1; }
    else { conditions.push({ conditionId: `COND_${stableDigest(proposal.proposalId)}`, type: "FOUNDING_CANDIDATE", targetType: "COHORT_CELL", targetId: `${proposal.sourceSettlementId}/${proposal.breedId}/${proposal.tier}`, magnitude: proposal.score, startYear: prior?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${state.worldKey}_${state.year}_FOUNDING_CANDIDATE`, key: proposal.proposalId, qualifyingReviewCount: count }); diagnosticCounters.candidatesCreated! += 1; }
  }
  const siteWinners = new Map<string, FoundingProposal>();
  for (const proposal of matured.sort((a, b) => b.score - a.score || (a.population === b.population ? a.proposalId.localeCompare(b.proposalId) : a.population > b.population ? -1 : 1))) if (!siteWinners.has(proposal.site.siteId)) siteWinners.set(proposal.site.siteId, proposal);
  let working: WorldStateV5 = { ...state, timedConditions: conditions };
  const transfers: MigrationTransferV5[] = proposals.map((row) => row.transfer);
  const events: CausalEventV5[] = [];
  const namingRequests: NamingRequestV5[] = [];
  for (const proposal of siteWinners.values()) {
    diagnosticCounters.settlementFounded! += 1;
    const source = settlementById.get(proposal.sourceSettlementId)!;
    const settlementId = `SETTLEMENT_${state.worldKey}_${proposal.site.siteId}_${stableDigest([proposal.proposalId, state.year])}`;
    const initialSectors = Object.fromEntries(["LAND_AND_FOOD", "EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT", "KNOWLEDGE_AND_SERVICES"].map((sector) => [sector, weightedMean([variables.industryInitialFallback, 5000], [sectorTerrainFit(proposal.site, sector), 5000])])) as Record<SectorId, Score1000>;
    const settlement: SettlementV5 = { settlementId, siteId: proposal.site.siteId, regionId: proposal.site.regionId, stateId: source.stateId, foundedYear: state.year, unrest: source.unrest, sectorStrengths: initialSectors };
    working = { ...working, settlements: [...working.settlements, settlement].sort((a, b) => a.settlementId.localeCompare(b.settlementId)) };
    transfers.push({ transferId: `FOUNDING_TRANSFER_${stableDigest(proposal)}`, breedId: proposal.breedId, tier: proposal.tier, originSettlementId: proposal.sourceSettlementId, destinationSettlementId: settlementId, population: proposal.population, prosperity: proposal.prosperity, cause: "FOUNDING" });
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_SETTLEMENT_FOUNDED_${settlementId}`, worldKey: state.worldKey, year: state.year, phase: "VOLUNTARY_MIGRATION", sequence: events.length, eventType: "SettlementFounded", entityType: "SETTLEMENT", entityId: settlementId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { siteId: proposal.site.siteId, stateId: source.stateId, foundingCause: "EMERGENT_MIGRATION", sourceSettlementId: proposal.sourceSettlementId } });
    namingRequests.push({ requestId: `NAME_${settlementId}`, entityType: "SETTLEMENT", entityId: settlementId, behavior: "BLOCKING", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${proposal.site.siteId}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${proposal.site.siteId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "EMERGENT_FOUNDING", settlementId, siteId: proposal.site.siteId, regionId: proposal.site.regionId, regionName: proposal.site.regionName, continent: proposal.site.continent ?? null, stateId: source.stateId } });
  }
  working = applyMigrationTransfers(working, transfers);
  transfers.forEach((transfer, sequence) => events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${transfer.transferId}`, worldKey: state.worldKey, year: state.year, phase: "VOLUNTARY_MIGRATION", sequence: events.length + sequence, eventType: transfer.cause === "FOUNDING" ? "FoundingTransfer" : "MigrationTransfer", entityType: "COHORT_CELL", entityId: `${transfer.destinationSettlementId}/${transfer.breedId}`, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { ...transfer, population: transfer.population.toString() } }));
  diagnosticCounters.rejectedPersistenceFailure = [...priorCandidates.keys()].filter((key) => !foundingProposals.some((proposal) => proposal.proposalId === key)).length;
  diagnosticCounters.rejectedSiteConflict = matured.length - siteWinners.size;
  return { state: working, events, transfers, namingRequests, destinationScoringCount, diagnostics: { domain: "FOUNDING", worldKey: state.worldKey, year: state.year, counters: diagnosticCounters, histograms: { foundingSiteScore: boundedHistogram(foundingScores) } } };
}

function importCompatibility(a: import("./types.js").FactionVector, b: import("./types.js").FactionVector): number {
  const distance = Math.abs(a.CONCORD - b.CONCORD) + Math.abs(a.SCHISM - b.SCHISM) + Math.abs(a.RUIN - b.RUIN);
  return 1000 - Number(divideRoundedAway(BigInt(distance), 2n));
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
  const settlementId = `SETTLEMENT_${state.worldKey}_${site.siteId}_${stableDigest(input.eventId)}`;
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
  return { state: next, events, namingRequest: { requestId: `NAME_${settlementId}`, entityType: "SETTLEMENT", entityId: settlementId, behavior: "BLOCKING", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${site.siteId}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${site.siteId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: canonicalAuthority ? canonicalLabel : null, context: { world: state.worldKey, creationYear: state.year, causalReason: "CANONICAL_FOUNDING_FIXTURE", settlementId, siteId: site.siteId, regionId: site.regionId, regionName: site.regionName, continent: site.continent ?? null, stateId: input.stateId, canonicalNamingAuthorityRef: canonicalAuthority, djtYearAuthorityStatus: "UNRESOLVED_OWNER_AUTHORITY" } } };
}
