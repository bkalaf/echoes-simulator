import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1, DiagnosticConfigV1, MechanicsVariablesV1, OperationalConfigV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { reconcileBorderRelations, applyActiveWarEpisodes, applyPeacefulExhaustionRecovery, reviewBordersLate } from "./conflict.js";
import { deriveMetrics, settlementDominantFactionMap, statePopulation } from "./derivations.js";
import type { DjtPolicyV5 } from "./djt.js";
import { executeDjtV5 } from "./djt.js";
import { applyCausalEffects, applyShockDefinition, type CausalEffect, type ShockDefinitionV5 } from "./effects.js";
import { blend, clamp } from "./fixed-point.js";
import { executeCanonicalFoundingWave, reviewVoluntaryMigration, type CanonicalFoundingTransactionInputV5 } from "./migration.js";
import { economicStrain, inequality, institutionalAccessWithMetrics, organizationFormationInputs, updateIndustry, updateProsperity, updateUnrest } from "./mechanics.js";
import { applyNaturalDemography } from "./population.js";
import { reconcileWorldRoutes } from "./routes.js";
import { fillMandatoryOfficeVacancies, institutionControlVector, institutionEffectiveness, reviewRoutineGovernmentTransition, reviewSecession, reviewStateFaction, updateLegitimacy } from "./politics.js";
import { reconcileChamberAuthorityV5, selectAuthorizedSenateVacanciesV5 } from "./chambers.js";
import { officeTermActiveAt } from "./office-term.js";
import { reviewSettlementSocialMobility } from "./social.js";
import { deriveFamilyInteractionSignals, reviewFamilies, reviewFamilyFormation, reviewFamilyRelations, reviewOrganizationFormation, reviewOrganizationLifecycle } from "./society.js";
import type { CausalEventV5, NamingRequestV5, WorldStateV5 } from "./types.js";
import type { BoundedDiagnosticObservationV5 } from "./diagnostics.js";
import { establishResourceGeographyV5, reconcileDiplomacyAndConflictV5, updateCivicInstitutionsAndSecurityV5, updateIndustriesAndGuildsV5 } from "./historical-dynamism.js";
import { applyEnclaveDemographyV5, applyPublicSliceGrowthModifiersV5, causalPopulationTotalsV5, ensurePopulationSlicesV5, reconcilePublicPopulationSlicesV5, validatePopulationPartitionV5 } from "./population-slices.js";
import { executeAtrocityOccurrenceV5, type AtrocityShockDefinitionV5 } from "./atrocities.js";
import { executeHistoricalConflictActionV5, type HistoricalConflictActionV5 } from "./conflict-actions.js";
import { recomputeEnclaveSupportBurdensV5 } from "./enclaves.js";
import { requireHistoricalPolicyV5 } from "./historical-policies.js";

export type ScheduledTransactionV5 =
  | { type: "EFFECTS"; transactionId: string; year: number; effects: readonly CausalEffect[] }
  | { type: "SHOCK"; transactionId: string; year: number; definition: ShockDefinitionV5 }
  | { type: "ATROCITY"; transactionId: string; year: number; definition: AtrocityShockDefinitionV5 }
  | { type: "HISTORICAL_CONFLICT_ACTION"; transactionId: string; year: number; action: HistoricalConflictActionV5 }
  | ({ type: "CANONICAL_FOUNDING" } & CanonicalFoundingTransactionInputV5)
  | { type: "DJT"; transactionId: string; year: number; policy: DjtPolicyV5 };

export interface V5EngineContext {
  canonical: CanonicalDataV5;
  ownerInputs: CausalOwnerInputsV1;
  mechanics: MechanicsVariablesV1;
  operational: OperationalConfigV1;
  diagnostic: DiagnosticConfigV1;
  normalizedSeed: string;
  scheduledTransactions: readonly ScheduledTransactionV5[];
  mode?: "CANONICAL" | "DIAGNOSTIC";
}

const PHASE_ORDER: readonly import("./types.js").V5Phase[] = ["SCHEDULED_CANONICAL", "TEMPORAL", "RESOURCE_GEOGRAPHY", "INSTITUTION_CAPACITY", "SECURITY", "DIPLOMACY", "ACTIVE_WAR", "TARGETING_RESPONSE", "DEMOGRAPHY", "INDUSTRY", "PROSPERITY", "SOCIAL_MOBILITY", "VOLUNTARY_MIGRATION", "ROUTE_INFRASTRUCTURE", "FAMILY", "ORGANIZATION", "STATE_FACTION", "UNREST", "LEGITIMACY", "GOVERNMENT", "TRIGGERED", "OFFICE_SELECTION", "LATE_BORDER", "AUDIT"];

function resequence(events: readonly CausalEventV5[]): CausalEventV5[] {
  return [...events].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.eventId.localeCompare(b.eventId)).map((event, sequence) => ({ ...event, sequence }));
}

function temporalEvents(state: WorldStateV5): { state: WorldStateV5; events: CausalEventV5[] } {
  let working = state; const events: CausalEventV5[] = [];
  const deaths = working.politicalPeople.filter((person) => person.actualDeathYear === null && person.naturalDeathYear === state.year).map((person) => person.personId);
  if (deaths.length) {
    const effect = { type: "POLITICAL_PERSON_DEATH" as const, effectId: `EFFECT_${state.worldKey}_${state.year}_NATURAL_DEATHS`, sourceEventId: `EVT_${state.worldKey}_${state.year}_NATURAL_DEATHS`, personIds: deaths };
    const applied = applyCausalEffects(working, [effect]); working = applied.state;
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: effect.sourceEventId, worldKey: state.worldKey, year: state.year, phase: "TEMPORAL", sequence: 0, eventType: "PoliticalPeopleDied", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { personIds: deaths, successionOfficeIds: applied.successionOfficeIds, aggregatePopulationChanged: false } });
  }
  const retiring = new Set(working.politicalPeople.filter((person) => person.actualRetirementYear === null && person.plannedRetirementYear === state.year && (person.actualDeathYear ?? person.naturalDeathYear) > state.year).map((person) => person.personId));
  if (retiring.size) {
    working.politicalPeople = working.politicalPeople.map((person) => retiring.has(person.personId) ? { ...person, actualRetirementYear: state.year } : person);
    working.officeTerms = working.officeTerms.map((term) => retiring.has(term.personId) && officeTermActiveAt(term, state.year) ? { ...term, endYear: state.year, terminationReason: "RETIREMENT" } : term);
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_RETIREMENTS`, worldKey: state.worldKey, year: state.year, phase: "TEMPORAL", sequence: events.length, eventType: "PoliticalPeopleRetired", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { personIds: [...retiring].sort() } });
  }
  const expiring = working.officeTerms.filter((term) => term.endYear === state.year && term.terminationReason === null).map((term) => term.officeTermId);
  working.officeTerms = working.officeTerms.map((term) => expiring.includes(term.officeTermId) ? { ...term, terminationReason: "TERM_EXPIRED" } : term);
  if (expiring.length) events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_TERMS_EXPIRED`, worldKey: state.worldKey, year: state.year, phase: "TEMPORAL", sequence: events.length, eventType: "OfficeTermsExpired", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { officeTermIds: expiring } });
  return { state: working, events };
}

function applyScheduled(state: WorldStateV5, context: V5EngineContext): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  let working = state; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  const transactions = context.scheduledTransactions.filter((row) => row.year === state.year).sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  for (const transaction of transactions.filter((candidate) => candidate.type !== "CANONICAL_FOUNDING")) {
    if (transaction.type === "EFFECTS") {
      const applied = applyCausalEffects(working, transaction.effects); working = applied.state;
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: transaction.transactionId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "CanonicalShock", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { effectIds: transaction.effects.map((effect) => effect.effectId), accounting: applied.accounting.map((row) => ({ ...row, populationBefore: row.populationBefore.toString(), populationAfter: row.populationAfter.toString(), deaths: row.deaths.toString(), transferred: row.transferred.toString() })) } });
    } else if (transaction.type === "SHOCK") {
      const applied = applyShockDefinition(working, transaction.definition); working = applied.state;
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: transaction.transactionId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "CanonicalShock", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { shockId: transaction.definition.shockId, resolvedTargets: applied.resolvedTargets, effectIds: transaction.definition.effects.map((effect) => effect.effectId), accounting: applied.accounting.map((row) => ({ ...row, populationBefore: row.populationBefore.toString(), populationAfter: row.populationAfter.toString(), deaths: row.deaths.toString(), transferred: row.transferred.toString() })) } });
    } else if (transaction.type === "ATROCITY") { const resolved = executeAtrocityOccurrenceV5({ state: working, canonical: context.canonical, ownerInputs: context.ownerInputs, mode: context.mode ?? "DIAGNOSTIC", definition: transaction.definition }); working = resolved.state; events.push(resolved.event); }
    else if (transaction.type === "HISTORICAL_CONFLICT_ACTION") { const resolved = executeHistoricalConflictActionV5({ state: working, canonical: context.canonical, ownerInputs: context.ownerInputs, mode: context.mode ?? "DIAGNOSTIC", action: transaction.action }); working = resolved.state; events.push(resolved.event); }
    else { const djt = executeDjtV5(working, context.canonical, context.mechanics, transaction.policy); working = djt.state; events.push(...djt.events); namingRequests.push(...djt.namingRequests); }
  }
  const foundingByWave = new Map<string, CanonicalFoundingTransactionInputV5[]>();
  for (const transaction of transactions.filter((candidate): candidate is Extract<ScheduledTransactionV5, { type: "CANONICAL_FOUNDING" }> => candidate.type === "CANONICAL_FOUNDING")) {
    const wave = foundingByWave.get(transaction.foundingWaveId) ?? [];
    wave.push(transaction);
    foundingByWave.set(transaction.foundingWaveId, wave);
  }
  for (const [, wave] of [...foundingByWave].sort(([left], [right]) => left.localeCompare(right))) {
    const founded = executeCanonicalFoundingWave(working, context.canonical, context.mechanics, wave);
    working = founded.state;
    events.push(...founded.events);
    namingRequests.push(...founded.namingRequests);
  }
  if (transactions.length > 0) { const borders = reconcileBorderRelations(working, context.canonical); working = borders.state; events.push(...borders.events); }
  return { state: working, events, namingRequests };
}

function validateState(state: WorldStateV5): void {
  const settlementIds = new Set(state.settlements.map((settlement) => settlement.settlementId)); const stateIds = new Set(state.states.map((row) => row.stateId));
  if (settlementIds.size !== state.settlements.length || stateIds.size !== state.states.length) throw new Error("Duplicate durable entity ID");
  if (state.settlements.some((settlement) => !stateIds.has(settlement.stateId))) throw new Error("Settlement references unknown State");
  if (state.cohorts.some((cell) => !settlementIds.has(cell.settlementId) || Object.values(cell.tiers).some((tier) => tier.population < 0n || !Number.isSafeInteger(tier.prosperity) || tier.prosperity < 0 || tier.prosperity > 1000))) throw new Error("Invalid CohortCell");
  const activeTermCount = new Map<string, number>(); for (const term of state.officeTerms.filter((row) => row.startYear <= state.year && (row.endYear === null || row.endYear > state.year))) activeTermCount.set(term.officeId, (activeTermCount.get(term.officeId) ?? 0) + 1); if ([...activeTermCount.values()].some((count) => count > 1)) throw new Error("Office has multiple current OfficeTerms");
  for (const organization of state.organizations.filter((row) => row.status !== "DISSOLVED")) { const stakes = state.ownershipStakes.filter((stake) => stake.organizationId === organization.organizationId && stake.endYear === null); if (stakes.reduce((sum, stake) => sum + stake.ownershipShareBps, 0) !== 10_000 || stakes.reduce((sum, stake) => sum + stake.controlShareBps, 0) !== 10_000) throw new Error(`Organization ${organization.organizationId} has invalid active shares`); }
  const relationPairs = state.personRelations.map((relation) => relation.personAId.localeCompare(relation.personBId) <= 0 ? `${relation.personAId}\0${relation.personBId}\0${relation.relationType}` : `${relation.personBId}\0${relation.personAId}\0${relation.relationType}`); if (new Set(relationPairs).size !== relationPairs.length) throw new Error("Duplicate PersonRelation authority");
}

export interface AdvanceYearResult { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; structuralReviewRan: boolean; migrationReviewRan: boolean; diagnosticObservations: BoundedDiagnosticObservationV5[]; }
export function advanceWorldOneYear(prior: WorldStateV5, context: V5EngineContext): AdvanceYearResult {
  let state: WorldStateV5 = { ...structuredClone(prior), year: prior.year + 1 }; let events: CausalEventV5[] = []; let namingRequests: NamingRequestV5[] = []; const diagnosticObservations: BoundedDiagnosticObservationV5[] = [];
  const historicalContext = { canonical: context.canonical, ownerInputs: context.ownerInputs, mode: context.mode ?? "DIAGNOSTIC" } as const;
  state = ensurePopulationSlicesV5(state, context.canonical);
  const scheduled = applyScheduled(state, context); state = scheduled.state; events.push(...scheduled.events); namingRequests.push(...scheduled.namingRequests);
  state = reconcilePublicPopulationSlicesV5(state, context.canonical);
  if (scheduled.events.some((event) => event.eventType === "SettlementFounded" || event.eventType === "StateMembershipChanged")) { const routeReview = reconcileWorldRoutes(state, context.canonical, context.ownerInputs, context.mechanics); state = routeReview.state; events.push(...routeReview.events); namingRequests.push(...routeReview.namingRequests); }
  const temporal = temporalEvents(state); state = temporal.state; events.push(...temporal.events);
  const resources = establishResourceGeographyV5(state, historicalContext); state = resources.state; events.push(...resources.events);
  const civic = updateCivicInstitutionsAndSecurityV5(state, historicalContext); state = civic.state; events.push(...civic.events);
  const diplomacy = reconcileDiplomacyAndConflictV5(state, historicalContext); state = diplomacy.state; events.push(...diplomacy.events);
  const activeWarAtYearStart = state.activeConflicts.some((conflict) => conflict.endedYear === null && conflict.activeFromYear <= state.year && conflict.declaredYear < state.year);
  let institutionEffectivenessByState = activeWarAtYearStart ? Object.fromEntries(state.states.map((row) => [row.stateId, institutionEffectiveness(state, row.stateId, context.mechanics)])) : {};
  const war = applyActiveWarEpisodes(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed, institutionEffectivenessByState); state = war.state; events.push(...war.events);
  state = reconcilePublicPopulationSlicesV5(state, context.canonical);
  const preDemography = state; const dominantAtDemography = settlementDominantFactionMap(state, context.canonical);
  const demographic = applyNaturalDemography(state, context.canonical, context.mechanics, dominantAtDemography); state = demographic.state; events.push(...demographic.events);
  state = applyPublicSliceGrowthModifiersV5(preDemography, reconcilePublicPopulationSlicesV5(state, context.canonical));
  const enclaveDemography = applyEnclaveDemographyV5(state, context.canonical, context.mechanics, dominantAtDemography); state = enclaveDemography.state;
  if ((state.enclaves ?? []).some((enclave) => enclave.status === "ACTIVE")) {
    const enclavePolicy = requireHistoricalPolicyV5({ mode: context.mode ?? "DIAGNOSTIC", policies: context.ownerInputs.historicalDynamismPolicies, approvedHashes: context.ownerInputs.historicalDynamismApprovedPolicyHashes, diagnosticCandidateOptIns: context.ownerInputs.diagnosticHistoricalPolicyOptIns, policyKey: "PERSECUTION_DISPLACEMENT_ENCLAVE", causalOperation: "UPDATE_ENCLAVE_SUPPORT_BURDEN", worldKey: state.worldKey, year: state.year, entityType: "WORLD", entityId: state.worldKey });
    state = recomputeEnclaveSupportBurdensV5(state, enclavePolicy);
  }
  if (enclaveDemography.growth > 0n) events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_ENCLAVE_DEMOGRAPHY`, worldKey: state.worldKey, year: state.year, phase: "DEMOGRAPHY", sequence: 0, eventType: "EnclaveDemographyCompleted", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { growth: enclaveDemography.growth.toString() } });
  const structuralReviewRan = state.year % context.mechanics.structuralReviewIntervalYears === 0;
  const migrationReviewRan = state.year % context.mechanics.migrationReviewIntervalYears === 0;
  if (migrationReviewRan && !structuralReviewRan) {
    const migration = reviewVoluntaryMigration(state, deriveMetrics(state, context.canonical, context.mechanics), context.canonical, context.ownerInputs, context.mechanics);
    state = migration.state; events.push(...migration.events); namingRequests.push(...migration.namingRequests); diagnosticObservations.push(...migration.diagnostics);
    state = reconcilePublicPopulationSlicesV5(state, context.canonical);
  }
  if (structuralReviewRan) {
    institutionEffectivenessByState = Object.fromEntries(state.states.map((row) => [row.stateId, institutionEffectiveness(state, row.stateId, context.mechanics)]));
    let metrics = deriveMetrics(state, context.canonical, context.mechanics);
    state = updateIndustry(state, context.canonical, context.mechanics, metrics);
    const v54Industry = updateIndustriesAndGuildsV5(state, historicalContext); state = v54Industry.state; events.push(...v54Industry.events); namingRequests.push(...v54Industry.namingRequests);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    const institutionVectors = Object.fromEntries(state.states.map((row) => [row.stateId, institutionControlVector(state, row.stateId, context.canonical)]));
    let accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId]!) ]));
    state = updateProsperity(state, context.canonical, context.mechanics, accessBySettlement, institutionVectors, metrics);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) { const mobility = reviewSettlementSocialMobility(state, settlement, metrics.localOpportunity[settlement.settlementId]!, accessBySettlement[settlement.settlementId]!, inequality(state, settlement.settlementId), economicStrain(state, settlement.settlementId), context.mechanics); state = mobility.state; events.push(...mobility.events); }
    state = reconcilePublicPopulationSlicesV5(state, context.canonical);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    if (migrationReviewRan) { const migration = reviewVoluntaryMigration(state, metrics, context.canonical, context.ownerInputs, context.mechanics); state = migration.state; events.push(...migration.events); namingRequests.push(...migration.namingRequests); diagnosticObservations.push(...migration.diagnostics); }
    state = reconcilePublicPopulationSlicesV5(state, context.canonical);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId] ?? state.states.find((row) => row.stateId === settlement.stateId)!.factionAffinity)]));
    const familyFormation = reviewFamilyFormation(state, context.canonical, context.ownerInputs, context.mechanics, accessBySettlement, metrics); state = familyFormation.state; events.push(...familyFormation.events); namingRequests.push(...familyFormation.namingRequests); diagnosticObservations.push(familyFormation.diagnostics);
    state = reviewFamilies(state, context.canonical, context.mechanics, metrics);
    const familyRelations = reviewFamilyRelations(state, deriveFamilyInteractionSignals(state), context.mechanics, context.normalizedSeed); state = familyRelations.state; events.push(...familyRelations.events);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId] ?? state.states.find((row) => row.stateId === settlement.stateId)!.factionAffinity)]));
    const organizationInputs = organizationFormationInputs(state, context.canonical, context.mechanics, accessBySettlement, institutionEffectivenessByState, metrics); const formation = reviewOrganizationFormation(state, organizationInputs.proposals, context.mechanics, context.normalizedSeed); state = formation.state; events.push(...formation.events); namingRequests.push(...formation.namingRequests); diagnosticObservations.push(...formation.diagnostics);
    const postFormationMetrics = deriveMetrics(state, context.canonical, context.mechanics);
    const refreshedOrgInputs = organizationFormationInputs(state, context.canonical, context.mechanics, accessBySettlement, institutionEffectivenessByState, postFormationMetrics); const lifecycle = reviewOrganizationLifecycle(state, refreshedOrgInputs.contextsByOrganization, context.mechanics); state = lifecycle.state; events.push(...lifecycle.events);
    const borderReconcile = reconcileBorderRelations(state, context.canonical); state = borderReconcile.state; events.push(...borderReconcile.events);
    const routeReconcile = reconcileWorldRoutes(state, context.canonical, context.ownerInputs, context.mechanics); state = routeReconcile.state; events.push(...routeReconcile.events); namingRequests.push(...routeReconcile.namingRequests);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    for (const politicalState of [...state.states].sort((a, b) => a.stateId.localeCompare(b.stateId))) { const reviewed = reviewStateFaction(state, politicalState.stateId, context.canonical, context.mechanics, metrics); state = reviewed.state; if (reviewed.realigned) events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_STATE_FACTION_REALIGNED_${politicalState.stateId}`, worldKey: state.worldKey, year: state.year, phase: "STATE_FACTION", sequence: events.length, eventType: "StateFactionRealigned", entityType: "STATE", entityId: politicalState.stateId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: {} }); }
    metrics = deriveMetrics(state, context.canonical, context.mechanics); accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionControlVector(state, settlement.stateId, context.canonical))]));
    state = updateUnrest(state, context.canonical, context.mechanics, accessBySettlement, metrics);
    const secession = reviewSecession(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed, Object.fromEntries(Object.entries(accessBySettlement).map(([key, value]) => [key, 1000 - value]))); state = secession.state; events.push(...secession.events); namingRequests.push(...secession.namingRequests);
    const afterMembership = reconcileBorderRelations(state, context.canonical); state = afterMembership.state; events.push(...afterMembership.events);
    const afterMembershipRoutes = reconcileWorldRoutes(state, context.canonical, context.ownerInputs, context.mechanics); state = afterMembershipRoutes.state; events.push(...afterMembershipRoutes.events); namingRequests.push(...afterMembershipRoutes.namingRequests);
    for (const event of secession.events.filter((candidate) => candidate.eventType === "StateSeceded")) {
      const parentStateId = typeof event.payload.parentStateId === "string" ? event.payload.parentStateId : null;
      if (!parentStateId) continue;
      const border = state.borderRelations.find((relation) => relation.activeBorder && new Set([relation.stateAId, relation.stateBId]).has(parentStateId) && new Set([relation.stateAId, relation.stateBId]).has(event.entityId));
      if (!border) continue;
      const effect = { type: "GRIEVANCE" as const, effectId: `EFFECT_${event.eventId}_FORMER_STATE_GRIEVANCE`, sourceEventId: event.eventId, borderRelationId: border.borderRelationId, delta: context.mechanics.secessionFormerStateGrievanceDelta };
      state = applyCausalEffects(state, [effect]).state;
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${event.eventId}_FORMER_STATE_GRIEVANCE`, worldKey: state.worldKey, year: state.year, phase: "TRIGGERED", sequence: events.length, eventType: "SecessionGrievanceCreated", entityType: "BORDER_RELATION", entityId: border.borderRelationId, causeEventIds: [event.eventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { delta: context.mechanics.secessionFormerStateGrievanceDelta, formerStateId: parentStateId, secededStateId: event.entityId } });
    }
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    for (const politicalState of [...state.states].sort((a, b) => a.stateId.localeCompare(b.stateId))) state = updateLegitimacy(state, politicalState.stateId, context.canonical, context.mechanics, metrics);
    for (const politicalState of [...state.states].sort((a, b) => a.stateId.localeCompare(b.stateId))) { const reviewed = reviewRoutineGovernmentTransition(state, politicalState.stateId, context.canonical, context.mechanics, context.normalizedSeed, metrics); state = reviewed.state; if (reviewed.event) events.push(reviewed.event); }
    state = applyPeacefulExhaustionRecovery(state, context.ownerInputs);
  }
  const chambers = reconcileChamberAuthorityV5(state, context.canonical); state = chambers.state; events.push(...chambers.events);
  const senate = selectAuthorizedSenateVacanciesV5(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed); state = senate.state; events.push(...senate.events); namingRequests.push(...senate.namingRequests);
  const vacancies = fillMandatoryOfficeVacancies(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed, `EVT_${state.worldKey}_${state.year}_VACANCIES`); state = vacancies.state; events.push(...vacancies.events); namingRequests.push(...vacancies.namingRequests);
  if (structuralReviewRan) { const border = reviewBordersLate(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed); state = border.state; events.push(...border.events); }
  state.timedConditions = state.timedConditions.filter((condition) => condition.endYear === null || condition.endYear >= state.year);
  validatePopulationPartitionV5(state);
  validateState(state);
  const populationTotals = causalPopulationTotalsV5(state);
  events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_CAUSAL_AUDIT`, worldKey: state.worldKey, year: state.year, phase: "AUDIT", sequence: 0, eventType: "CausalInvariantAuditPassed", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { population: populationTotals.publicPopulation.toString(), enclavePopulation: populationTotals.enclavePopulation.toString(), causalTotalPopulation: populationTotals.causalTotalPopulation.toString(), structuralReviewRan, migrationReviewRan } });
  return { state, events: resequence(events), namingRequests: namingRequests.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId)), structuralReviewRan, migrationReviewRan, diagnosticObservations };
}

export interface RunWorldOptions { stopAtBlockingNaming?: boolean; onAtomicYear?: (result: AdvanceYearResult) => void; }
export function runWorldV5(initial: WorldStateV5, throughYear: number, context: V5EngineContext, options: RunWorldOptions = {}): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; status: "COMPLETE" | "WAITING_FOR_NAMING" } {
  let state = initial; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  while (state.year < throughYear) {
    const result = advanceWorldOneYear(state, context); state = result.state; events.push(...result.events); namingRequests.push(...result.namingRequests); options.onAtomicYear?.(result);
    if ((options.stopAtBlockingNaming ?? true) && result.namingRequests.some((request) => request.behavior === "BLOCKING" && !request.acceptedLabel)) return { state, events, namingRequests, status: "WAITING_FOR_NAMING" };
  }
  return { state, events, namingRequests, status: "COMPLETE" };
}

export function causalStateHash(state: WorldStateV5): string { return createHash("sha256").update(canonicalJson(state), "utf8").digest("hex"); }
export function causalEventHash(events: readonly CausalEventV5[]): string { return createHash("sha256").update(canonicalJson(events), "utf8").digest("hex"); }
