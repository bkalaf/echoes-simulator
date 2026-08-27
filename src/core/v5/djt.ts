import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, type CanonicalDataV5, type MechanicsVariablesV1 } from "./config.js";
import { executeCanonicalFounding, applyMigrationTransfers, type MigrationTransferV5 } from "./migration.js";
import { reconcileBorderRelations } from "./conflict.js";
import { deriveMetrics } from "./derivations.js";
import { dominantFaction } from "./faction.js";
import { instantiateGovernmentInstitutions } from "./politics.js";
import type { CausalEventV5, NamingRequestV5, StateV5, WorldStateV5 } from "./types.js";

export const CORRECT_R10_CONTEXT = {
  CONCORD: ["H12", "M01", "M05"],
  RUIN: ["H03", "B10", "B13"],
  SCHISM: ["H01", "H17", "B07"],
} as const;

export interface DjtPolicyV5 {
  eventId: string;
  r10SiteId: string;
  innerwoodStateId: string;
  innerwoodGovernmentFormId: string;
  nonSovereignSourceSettlementId: string;
  sovereignSeizureSettlementId: string;
  quarantineYears: number;
}

export function executeDjtV5(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, policy: DjtPolicyV5): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  let working = state; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  if (!working.states.some((politicalState) => politicalState.stateId === policy.innerwoodStateId)) {
    const government = canonical.governments.find((candidate) => candidate.governmentFormId === policy.innerwoodGovernmentFormId);
    if (!government) throw new Error(`DJT Innerwood government ${policy.innerwoodGovernmentFormId} does not exist`);
    const sourceState = working.states.find((politicalState) => politicalState.stateId === working.settlements.find((settlement) => settlement.settlementId === policy.nonSovereignSourceSettlementId)?.stateId);
    const innerwoodState: StateV5 = { stateId: policy.innerwoodStateId, actualGovernment: government.governmentFormId, factionAffinity: sourceState?.factionAffinity ?? { CONCORD: 334, SCHISM: 333, RUIN: 333 }, dominantFaction: sourceState?.dominantFaction ?? "CONCORD", legitimacy: sourceState?.legitimacy ?? 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: state.year, routineTransitionCooldownUntilYear: state.year + variables.governmentTransitionCooldownYears };
    working = instantiateGovernmentInstitutions({ ...working, states: [...working.states, innerwoodState] }, innerwoodState.stateId, government, state.year);
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `${policy.eventId}_INNERWOOD_STATE_CREATED`, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "StateCreated", entityType: "STATE", entityId: innerwoodState.stateId, causeEventIds: [policy.eventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { governmentFormId: government.governmentFormId, cause: "DJT_INNERWOOD" } });
    namingRequests.push({ requestId: `NAME_${innerwoodState.stateId}`, entityType: "STATE", entityId: innerwoodState.stateId, behavior: "BLOCKING", createdYear: state.year, acceptedLabel: null });
  }
  let r10 = working.settlements.find((settlement) => settlement.siteId === policy.r10SiteId);
  if (!r10) {
    const placeholderTransfers: MigrationTransferV5[] = [];
    const founded = executeCanonicalFounding(working, canonical, variables, { eventId: `${policy.eventId}_R10_FOUNDING`, siteId: policy.r10SiteId, stateId: policy.innerwoodStateId, transfers: placeholderTransfers });
    working = founded.state; events.push(...founded.events); namingRequests.push(founded.namingRequest); r10 = working.settlements.find((settlement) => settlement.siteId === policy.r10SiteId)!;
  }
  const sovereignBreedId = canonical.sovereigns[state.worldKey].breedId;
  const transfers: MigrationTransferV5[] = [];
  for (const cell of working.cohorts) for (const tier of ["HIGH", "MID", "LOW"] as const) {
    const population = cell.tiers[tier].population; if (population === 0n) continue;
    if (cell.breedId === sovereignBreedId && cell.settlementId !== policy.sovereignSeizureSettlementId) transfers.push({ transferId: `${policy.eventId}_SOVEREIGN_${cell.settlementId}_${cell.breedId}_${tier}`, breedId: cell.breedId, tier, originSettlementId: cell.settlementId, destinationSettlementId: policy.sovereignSeizureSettlementId, population, prosperity: cell.tiers[tier].prosperity, cause: "DJT" });
    else if (cell.breedId !== sovereignBreedId && cell.settlementId === policy.nonSovereignSourceSettlementId) transfers.push({ transferId: `${policy.eventId}_DISPLACED_${cell.breedId}_${tier}`, breedId: cell.breedId, tier, originSettlementId: cell.settlementId, destinationSettlementId: r10.settlementId, population, prosperity: cell.tiers[tier].prosperity, cause: "DJT" });
  }
  working = applyMigrationTransfers(working, transfers);
  for (const transfer of [...transfers].sort((left, right) => left.transferId.localeCompare(right.transferId))) {
    events.push({
      schemaVersion: "echoes-causal-event-v5",
      eventId: `EVT_${transfer.transferId}`,
      worldKey: state.worldKey,
      year: state.year,
      phase: "SCHEDULED_CANONICAL",
      sequence: events.length,
      eventType: transfer.destinationSettlementId === r10.settlementId ? "FoundingTransfer" : "MigrationTransfer",
      entityType: "COHORT_CELL",
      entityId: `${transfer.originSettlementId}/${transfer.breedId}/${transfer.tier}`,
      causeEventIds: [policy.eventId],
      mechanicsVersion: V5_MECHANICS_VERSION,
      causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION,
      keyedDecisionIdentity: null,
      mutations: [],
      payload: {
        transferId: transfer.transferId,
        originSettlementId: transfer.originSettlementId,
        destinationSettlementId: transfer.destinationSettlementId,
        breedId: transfer.breedId,
        tier: transfer.tier,
        population: transfer.population.toString(),
        prosperity: transfer.prosperity,
        cause: transfer.cause,
      },
    });
  }
  const postDjtMetrics = deriveMetrics(working, canonical, variables);
  const innerwoodPopulationVector = postDjtMetrics.statePopulationFactionVectors[policy.innerwoodStateId];
  if (innerwoodPopulationVector) {
    working = {
      ...working,
      states: working.states.map((politicalState) => politicalState.stateId === policy.innerwoodStateId
        ? { ...politicalState, factionAffinity: innerwoodPopulationVector, dominantFaction: dominantFaction(innerwoodPopulationVector) }
        : politicalState),
    };
  }
  const quarantineUntil = state.year + policy.quarantineYears;
  working = { ...working, timedConditions: [...working.timedConditions, { conditionId: `COND_${policy.eventId}_R10_QUARANTINE`, type: "QUARANTINE", targetType: "SETTLEMENT", targetId: r10.settlementId, magnitude: 1000, startYear: state.year, endYear: quarantineUntil, sourceEventId: policy.eventId, key: `${r10.settlementId}/OUTBOUND`, qualifyingReviewCount: 0 }] };
  const borders = reconcileBorderRelations(working, canonical); working = borders.state; events.push(...borders.events);
  events.push({ schemaVersion: "echoes-causal-event-v5", eventId: policy.eventId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "DJT", entityType: "SETTLEMENT", entityId: r10.settlementId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { r10ContextGroups: CORRECT_R10_CONTEXT[state.worldKey], h04Region: "R15", transfers: transfers.length, population: transfers.reduce((sum, transfer) => sum + transfer.population, 0n).toString(), quarantineUntil } });
  return { state: working, events, namingRequests };
}
