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
import { reviewVoluntaryMigration, executeCanonicalFounding, type ForcedFoundingInput } from "./migration.js";
import { economicStrain, inequality, institutionalAccessWithMetrics, organizationFormationInputs, updateIndustry, updateProsperity, updateUnrest } from "./mechanics.js";
import { applyNaturalDemography } from "./population.js";
import { reconcileWorldRoutes } from "./routes.js";
import { fillMandatoryOfficeVacancies, institutionControlVector, institutionEffectiveness, reviewRoutineGovernmentTransition, reviewSecession, reviewStateFaction, updateLegitimacy } from "./politics.js";
import { reviewSettlementSocialMobility } from "./social.js";
import { deriveFamilyInteractionSignals, reviewFamilies, reviewFamilyFormation, reviewFamilyRelations, reviewOrganizationFormation, reviewOrganizationLifecycle } from "./society.js";
import type { CausalEventV5, NamingRequestV5, WorldStateV5 } from "./types.js";

export type ScheduledTransactionV5 =
  | { type: "EFFECTS"; transactionId: string; year: number; effects: readonly CausalEffect[] }
  | { type: "SHOCK"; transactionId: string; year: number; definition: ShockDefinitionV5 }
  | { type: "CANONICAL_FOUNDING"; transactionId: string; year: number; founding: ForcedFoundingInput }
  | { type: "DJT"; transactionId: string; year: number; policy: DjtPolicyV5 };

export interface V5EngineContext {
  canonical: CanonicalDataV5;
  ownerInputs: CausalOwnerInputsV1;
  mechanics: MechanicsVariablesV1;
  operational: OperationalConfigV1;
  diagnostic: DiagnosticConfigV1;
  normalizedSeed: string;
  scheduledTransactions: readonly ScheduledTransactionV5[];
}

const PHASE_ORDER = ["SCHEDULED_CANONICAL", "TEMPORAL", "ACTIVE_WAR", "DEMOGRAPHY", "INDUSTRY", "PROSPERITY", "SOCIAL_MOBILITY", "VOLUNTARY_MIGRATION", "ROUTE_INFRASTRUCTURE", "FAMILY", "ORGANIZATION", "STATE_FACTION", "UNREST", "LEGITIMACY", "GOVERNMENT", "TRIGGERED", "OFFICE_SELECTION", "LATE_BORDER", "AUDIT"] as const;

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
    working.officeTerms = working.officeTerms.map((term) => term.endYear === null && retiring.has(term.personId) ? { ...term, endYear: state.year, terminationReason: "RETIREMENT" } : term);
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
  for (const transaction of transactions) {
    if (transaction.type === "EFFECTS") {
      const applied = applyCausalEffects(working, transaction.effects); working = applied.state;
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: transaction.transactionId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "CanonicalShock", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { effectIds: transaction.effects.map((effect) => effect.effectId), accounting: applied.accounting.map((row) => ({ ...row, populationBefore: row.populationBefore.toString(), populationAfter: row.populationAfter.toString(), deaths: row.deaths.toString(), transferred: row.transferred.toString() })) } });
    } else if (transaction.type === "SHOCK") {
      const applied = applyShockDefinition(working, transaction.definition); working = applied.state;
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: transaction.transactionId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: events.length, eventType: "CanonicalShock", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { shockId: transaction.definition.shockId, resolvedTargets: applied.resolvedTargets, effectIds: transaction.definition.effects.map((effect) => effect.effectId), accounting: applied.accounting.map((row) => ({ ...row, populationBefore: row.populationBefore.toString(), populationAfter: row.populationAfter.toString(), deaths: row.deaths.toString(), transferred: row.transferred.toString() })) } });
    } else if (transaction.type === "CANONICAL_FOUNDING") { const founded = executeCanonicalFounding(working, context.canonical, context.mechanics, transaction.founding); working = founded.state; events.push(...founded.events); namingRequests.push(founded.namingRequest); }
    else { const djt = executeDjtV5(working, context.canonical, context.mechanics, transaction.policy); working = djt.state; events.push(...djt.events); namingRequests.push(...djt.namingRequests); }
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

export interface AdvanceYearResult { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; structuralReviewRan: boolean; }
export function advanceWorldOneYear(prior: WorldStateV5, context: V5EngineContext): AdvanceYearResult {
  let state: WorldStateV5 = { ...prior, year: prior.year + 1 }; let events: CausalEventV5[] = []; let namingRequests: NamingRequestV5[] = [];
  const scheduled = applyScheduled(state, context); state = scheduled.state; events.push(...scheduled.events); namingRequests.push(...scheduled.namingRequests);
  if (scheduled.events.some((event) => event.eventType === "SettlementFounded" || event.eventType === "StateMembershipChanged")) { const routeReview = reconcileWorldRoutes(state, context.canonical, context.ownerInputs, context.mechanics); state = routeReview.state; events.push(...routeReview.events); namingRequests.push(...routeReview.namingRequests); }
  const temporal = temporalEvents(state); state = temporal.state; events.push(...temporal.events);
  const activeWarAtYearStart = state.activeConflicts.some((conflict) => conflict.endedYear === null && conflict.activeFromYear <= state.year && conflict.declaredYear < state.year);
  let institutionEffectivenessByState = activeWarAtYearStart ? Object.fromEntries(state.states.map((row) => [row.stateId, institutionEffectiveness(state, row.stateId, context.mechanics)])) : {};
  const war = applyActiveWarEpisodes(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed, institutionEffectivenessByState); state = war.state; events.push(...war.events);
  const demographic = applyNaturalDemography(state, context.canonical, context.mechanics, settlementDominantFactionMap(state, context.canonical)); state = demographic.state; events.push(...demographic.events);
  const structuralReviewRan = state.year % context.mechanics.structuralReviewIntervalYears === 0;
  if (structuralReviewRan) {
    institutionEffectivenessByState = Object.fromEntries(state.states.map((row) => [row.stateId, institutionEffectiveness(state, row.stateId, context.mechanics)]));
    let metrics = deriveMetrics(state, context.canonical, context.mechanics);
    state = updateIndustry(state, context.canonical, context.mechanics, metrics);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    const institutionVectors = Object.fromEntries(state.states.map((row) => [row.stateId, institutionControlVector(state, row.stateId, context.canonical)]));
    let accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId]!) ]));
    state = updateProsperity(state, context.canonical, context.mechanics, accessBySettlement, institutionVectors, metrics);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) { const mobility = reviewSettlementSocialMobility(state, settlement, metrics.localOpportunity[settlement.settlementId]!, accessBySettlement[settlement.settlementId]!, inequality(state, settlement.settlementId), economicStrain(state, settlement.settlementId), context.mechanics); state = mobility.state; events.push(...mobility.events); }
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    const migration = reviewVoluntaryMigration(state, metrics, context.canonical, context.ownerInputs, context.mechanics); state = migration.state; events.push(...migration.events); namingRequests.push(...migration.namingRequests);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId] ?? state.states.find((row) => row.stateId === settlement.stateId)!.factionAffinity)]));
    const familyFormation = reviewFamilyFormation(state, context.canonical, context.ownerInputs, context.mechanics, accessBySettlement, metrics); state = familyFormation.state; events.push(...familyFormation.events); namingRequests.push(...familyFormation.namingRequests);
    state = reviewFamilies(state, context.canonical, context.mechanics, metrics);
    const familyRelations = reviewFamilyRelations(state, deriveFamilyInteractionSignals(state), context.mechanics, context.normalizedSeed); state = familyRelations.state; events.push(...familyRelations.events);
    metrics = deriveMetrics(state, context.canonical, context.mechanics);
    accessBySettlement = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, institutionalAccessWithMetrics(state, settlement.settlementId, context.canonical, metrics, institutionVectors[settlement.stateId] ?? state.states.find((row) => row.stateId === settlement.stateId)!.factionAffinity)]));
    const organizationInputs = organizationFormationInputs(state, context.canonical, context.mechanics, accessBySettlement, institutionEffectivenessByState, metrics); const formation = reviewOrganizationFormation(state, organizationInputs.proposals, context.mechanics, context.normalizedSeed); state = formation.state; events.push(...formation.events); namingRequests.push(...formation.namingRequests);
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
  const vacancies = fillMandatoryOfficeVacancies(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed, `EVT_${state.worldKey}_${state.year}_VACANCIES`); state = vacancies.state; events.push(...vacancies.events); namingRequests.push(...vacancies.namingRequests);
  if (structuralReviewRan) { const border = reviewBordersLate(state, context.canonical, context.ownerInputs, context.mechanics, context.normalizedSeed); state = border.state; events.push(...border.events); }
  state.timedConditions = state.timedConditions.filter((condition) => condition.endYear === null || condition.endYear >= state.year);
  validateState(state);
  events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_CAUSAL_AUDIT`, worldKey: state.worldKey, year: state.year, phase: "AUDIT", sequence: 0, eventType: "CausalInvariantAuditPassed", entityType: "WORLD", entityId: state.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { population: state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n).toString(), structuralReviewRan } });
  namingRequests = namingRequests.map((request) => request.entityType === "POLITICAL_PERSON" && request.behavior === "AUTOMATIC_REUSE" ? { ...request, behavior: context.operational.routineOfficeholderNaming } : request);
  return { state, events: resequence(events), namingRequests: namingRequests.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId)), structuralReviewRan };
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
