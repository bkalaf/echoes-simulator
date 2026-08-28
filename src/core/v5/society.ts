import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { blend, clamp, divideRoundedAway, factionCompatibility, normalizeFactionVector, normalizedVectorWeightedMean, ratioScore, thresholdChance, weightedMean } from "./fixed-point.js";
import { classDistribution, deriveMetrics, industryMean, localFamilyWealth, settlementHighProsperity, settlementOwnershipConcentration, settlementPopulation } from "./derivations.js";
import { keyedDrawBps, type KeyedRandomIdentity } from "./random.js";
import type { CausalEventV5, ControllerType, FamilyRelationType, FamilyRelationV5, FamilyV5, NamingRequestV5, OrganizationType, OrganizationV5, OwnershipStakeV5, Score1000, SectorId, TimedConditionV5, WorldStateV5 } from "./types.js";
import { boundedHistogram, type BoundedDiagnosticObservationV5 } from "./diagnostics.js";
import { officeTermActiveAt } from "./office-term.js";

function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 20); }
function identity(normalizedSeed: string, randomNamespace: KeyedRandomIdentity["randomNamespace"], comparisonEntityId: string, year: number, candidateOrDecisionKey: string): KeyedRandomIdentity { return { normalizedSeed, randomNamespace, comparisonEntityId, year, candidateOrDecisionKey }; }

function activeStakes(state: WorldStateV5, organizationId?: string): OwnershipStakeV5[] { return state.ownershipStakes.filter((stake) => stake.endYear === null && (!organizationId || stake.organizationId === organizationId)); }

export function organizationControlConcentration(state: WorldStateV5, organizationId: string): Score1000 {
  const shares = activeStakes(state, organizationId).filter((stake) => stake.controllerType !== "DIFFUSE").map((stake) => stake.controlShareBps);
  return shares.length === 0 ? 0 : Number(divideRoundedAway(BigInt(Math.max(...shares)), 10n));
}

export function ownershipConcentration(state: WorldStateV5, settlementId: string): Score1000 {
  return settlementOwnershipConcentration(state, settlementId);
}

export function familyOwnershipValue(state: WorldStateV5, familyId: string): Score1000 {
  const values = activeStakes(state).filter((stake) => stake.controllerType === "FAMILY" && stake.controllerId === familyId).map((stake) => {
    const organization = state.organizations.find((row) => row.organizationId === stake.organizationId);
    return organization && organization.status !== "DISSOLVED" ? BigInt(organization.wealth) * BigInt(stake.ownershipShareBps) : 0n;
  });
  return clamp(Number(divideRoundedAway(values.reduce((sum, value) => sum + value, 0n), 10_000n)), 0, 1000);
}

export function familyOwnershipControl(state: WorldStateV5, familyId: string): Score1000 {
  return clamp(Number(divideRoundedAway(activeStakes(state).filter((stake) => stake.controllerType === "FAMILY" && stake.controllerId === familyId).reduce((sum, stake) => sum + BigInt(stake.controlShareBps), 0n), 10n)), 0, 1000);
}

export function familyOfficePowerShare(state: WorldStateV5, familyId: string): Score1000 {
  const family = state.families.find((row) => row.familyId === familyId)!;
  const homeStateId = state.settlements.find((row) => row.settlementId === family.homeSettlementId)?.stateId;
  const institutionIds = new Set(state.institutions.filter((institution) => institution.stateId === homeStateId && institution.dissolvedYear === null).map((institution) => institution.institutionId));
  const offices = state.offices.filter((office) => institutionIds.has(office.institutionId));
  const totalPower = offices.reduce((sum, office) => sum + BigInt(office.power), 0n);
  const familyPersonIds = new Set(state.politicalPeople.filter((person) => person.familyId === familyId).map((person) => person.personId));
  const held = offices.filter((office) => state.officeTerms.some((term) => term.officeId === office.officeId && officeTermActiveAt(term, state.year) && familyPersonIds.has(term.personId))).reduce((sum, office) => sum + BigInt(office.power), 0n);
  return ratioScore(held, totalPower, 0);
}

export function familyNetworkStrength(state: WorldStateV5, familyId: string): Score1000 {
  const alliance = state.familyRelations.filter((relation) => relation.endYear === null && relation.relationType === "ALLIANCE" && (relation.familyAId === familyId || relation.familyBId === familyId)).reduce((maximum, relation) => Math.max(maximum, relation.strength), 0);
  const familyPeople = new Set(state.politicalPeople.filter((person) => person.familyId === familyId).map((person) => person.personId));
  const relatedPeople = new Set(state.personRelations.filter((relation) => relation.endYear === null && (familyPeople.has(relation.personAId) || familyPeople.has(relation.personBId))).flatMap((relation) => [relation.personAId, relation.personBId]));
  const kinOffice = state.officeTerms.some((term) => officeTermActiveAt(term, state.year) && relatedPeople.has(term.personId)) ? 1000 : 0;
  const coControl = state.organizations.some((organization) => {
    const controllers = activeStakes(state, organization.organizationId).filter((stake) => stake.controlShareBps > 0 && stake.controllerType === "FAMILY").map((stake) => stake.controllerId);
    return controllers.includes(familyId) && controllers.some((controller) => controller !== familyId);
  }) ? 1000 : 0;
  return weightedMean([alliance, 4000], [kinOffice, 3500], [coControl, 2500]);
}

export function familyEconomicBase(state: WorldStateV5, familyId: string, metrics: ReturnType<typeof deriveMetrics>): Score1000 {
  const family = state.families.find((row) => row.familyId === familyId)!;
  return weightedMean([familyOwnershipValue(state, familyId), 5500], [metrics.settlementHighProsperity[family.homeSettlementId] ?? 0, 3000], [metrics.localOpportunity[family.homeSettlementId] ?? 0, 1500]);
}

export function familyPoliticalBase(state: WorldStateV5, familyId: string): Score1000 {
  const family = state.families.find((row) => row.familyId === familyId)!;
  return weightedMean([familyOfficePowerShare(state, familyId), 4500], [familyOwnershipControl(state, familyId), 2500], [familyNetworkStrength(state, familyId), 1500], [family.prestige, 1500]);
}

export function familyFormationPressure(state: WorldStateV5, settlementId: string, owner: CausalOwnerInputsV1, metrics: ReturnType<typeof deriveMetrics>, institutionalAccess: Score1000): Score1000 {
  const population = settlementPopulation(state, settlementId);
  const high = state.cohorts.filter((cell) => cell.settlementId === settlementId).reduce((sum, cell) => sum + cell.tiers.HIGH.population, 0n);
  const highShare = ratioScore(high, population, 0);
  let nobility = 0n;
  for (const cell of state.cohorts.filter((row) => row.settlementId === settlementId)) nobility += classDistribution(cell, owner).HIGH.NOBILITY + classDistribution(cell, owner).MID.NOBILITY + classDistribution(cell, owner).LOW.NOBILITY;
  return weightedMean([metrics.settlementHighProsperity[settlementId] ?? 0, 2500], [highShare, 2000], [ratioScore(nobility, population, 0), 2500], [metrics.localOpportunity[settlementId] ?? 0, 1500], [institutionalAccess, 1500]);
}

function historicallyRelevantUntrackedPeople(state: WorldStateV5): string[] {
  const officeholders = new Set(state.officeTerms.filter((term) => officeTermActiveAt(term, state.year)).map((term) => term.personId));
  const organizationFounders = new Set(state.organizations.filter((organization) => organization.status !== "DISSOLVED" && organization.founderControllerType === "PERSON").map((organization) => organization.founderControllerId));
  const owners = new Set(state.ownershipStakes.filter((stake) => stake.endYear === null && stake.controllerType === "PERSON" && (stake.ownershipShareBps > 0 || stake.controlShareBps > 0)).map((stake) => stake.controllerId));
  return state.politicalPeople
    .filter((person) => person.familyId === null && (person.actualDeathYear ?? person.naturalDeathYear) > state.year && (officeholders.has(person.personId) || organizationFounders.has(person.personId) || owners.has(person.personId)))
    .map((person) => person.personId)
    .sort();
}

export function reviewFamilyFormation(
  state: WorldStateV5,
  canonical: CanonicalDataV5,
  owner: CausalOwnerInputsV1,
  variables: MechanicsVariablesV1,
  accessBySettlement: Readonly<Record<string, Score1000>>,
  suppliedMetrics?: ReturnType<typeof deriveMetrics>,
): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; diagnostics: BoundedDiagnosticObservationV5 } {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const prior = new Map(state.timedConditions.filter((condition) => condition.type === "FAMILY_PROMOTION_CANDIDATE").map((condition) => [condition.key, condition]));
  const conditions = state.timedConditions.filter((condition) => condition.type !== "FAMILY_PROMOTION_CANDIDATE");
  let families = [...state.families];
  let politicalPeople = [...state.politicalPeople];
  const events: CausalEventV5[] = [];
  const namingRequests: NamingRequestV5[] = [];
  const counters: Record<string, number> = { pressureEvaluations: 0, aboveThreshold: 0, candidatesCreated: 0, candidatesSecondReview: 0, candidatesResetOrExpired: 0, familiesPromoted: 0, eventRequiredFamiliesCreated: 0, failedInsufficientPopulation: 0, failedNoNobilityPopulation: 0, failedMatchingFamilyAlreadyActive: 0, failedPressureBelowThreshold: 0, failedPersistence: 0 };
  const pressures: number[] = [];
  for (const personId of historicallyRelevantUntrackedPeople(state)) {
    const person = politicalPeople.find((row) => row.personId === personId)!;
    const pressure = familyFormationPressure(state, person.originSettlementId, owner, metrics, accessBySettlement[person.originSettlementId] ?? 500);
    counters.pressureEvaluations! += 1; pressures.push(pressure);
    const population = settlementPopulation(state, person.originSettlementId);
    if (population === 0n) counters.failedInsufficientPopulation! += 1;
    let nobility = 0n; for (const cell of state.cohorts.filter((row) => row.settlementId === person.originSettlementId)) { const classes = classDistribution(cell, owner); nobility += classes.HIGH.NOBILITY + classes.MID.NOBILITY + classes.LOW.NOBILITY; }
    if (nobility === 0n) counters.failedNoNobilityPopulation! += 1;
    if (pressure < variables.familyFormationThreshold) { counters.failedPressureBelowThreshold! += 1; continue; }
    counters.aboveThreshold! += 1;
    const key = `${person.personId}/${person.originSettlementId}`;
    const count = (prior.get(key)?.qualifyingReviewCount ?? 0) + 1;
    if (count < variables.familyFormationRequiredReviews) {
      conditions.push({ conditionId: `COND_${digest(["FAMILY_PROMOTION", key])}`, type: "FAMILY_PROMOTION_CANDIDATE", targetType: "SETTLEMENT", targetId: person.originSettlementId, magnitude: pressure, startYear: prior.get(key)?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${state.worldKey}_${state.year}_FAMILY_PROMOTION_CANDIDATE_${person.personId}`, key, qualifyingReviewCount: count });
      counters.candidatesCreated! += 1; continue;
    }
    counters.candidatesSecondReview! += 1;
    const familyId = `FAMILY_${digest([state.worldKey, "EMERGENT", person.personId])}`;
    const breed = canonical.breeds.find((row) => row.breedId === person.breedId);
    if (!breed) throw new Error(`Family promotion person ${person.personId} has unknown Breed ${person.breedId}`);
    const activeOfficePower = state.offices.filter((office) => state.officeTerms.some((term) => officeTermActiveAt(term, state.year) && term.personId === person.personId && term.officeId === office.officeId)).reduce((sum, office) => sum + office.power, 0);
    const family: FamilyV5 = {
      familyId,
      homeSettlementId: person.originSettlementId,
      founderBreedId: person.breedId,
      factionAffinity: normalizeFactionVector(breed.factionObject),
      wealth: metrics.settlementHighProsperity[person.originSettlementId] ?? 0,
      influence: clamp(activeOfficePower, 0, 1000),
      prestige: 500,
      status: "ACTIVE",
      foundingYear: state.year,
      extinctionYear: null,
    };
    families.push(family);
    politicalPeople = politicalPeople.map((row) => row.personId === person.personId ? { ...row, familyId } : row);
    const eventId = `EVT_${state.worldKey}_${state.year}_FAMILY_PROMOTED_${familyId}`;
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId, worldKey: state.worldKey, year: state.year, phase: "FAMILY", sequence: events.length, eventType: "FamilyPromoted", entityType: "FAMILY", entityId: familyId, causeEventIds: [prior.get(key)?.sourceEventId ?? `EVT_${state.worldKey}_${state.year}_FAMILY_PROMOTION_CANDIDATE_${person.personId}`], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { founderPersonId: person.personId, founderBreedId: person.breedId, homeSettlementId: person.originSettlementId, pressure, qualifyingReviews: count } });
    counters.familiesPromoted! += 1;
    namingRequests.push({ requestId: `NAME_${familyId}`, entityType: "FAMILY", entityId: familyId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "EMERGENT_PROMOTION", familyId, founderPersonId: person.personId, founderBreedId: person.breedId, homeSettlementId: person.originSettlementId, pressure } });
  }
  counters.candidatesResetOrExpired = [...prior.keys()].filter((key) => !conditions.some((condition) => condition.key === key) && !events.some((event) => event.causeEventIds.includes(prior.get(key)!.sourceEventId))).length;
  counters.failedPersistence = counters.candidatesResetOrExpired;
  return { state: { ...state, families: families.sort((a, b) => a.familyId.localeCompare(b.familyId)), politicalPeople, timedConditions: conditions }, events, namingRequests, diagnostics: { domain: "FAMILY_FORMATION", worldKey: state.worldKey, year: state.year, counters, histograms: { pressure: boundedHistogram(pressures) } } };
}

export interface FamilyInteractionSignal { signalId: string; familyAId: string; familyBId: string; relation: FamilyRelationType; magnitude: Score1000; sourceEventId: string; kind: "SHARED_CONTROL" | "TRANSITION_COALITION" | "MARRIAGE" | "SUCCESSION_SUPPORT" | "WAR_ALIGNMENT" | "OFFICE_DEFEAT" | "OWNERSHIP_DISPLACEMENT" | "BETRAYAL"; }

export function deriveFamilyInteractionSignals(state: WorldStateV5): FamilyInteractionSignal[] {
  const signals: FamilyInteractionSignal[] = [];
  for (const organization of state.organizations.filter((row) => row.status !== "DISSOLVED")) {
    const controllers = activeStakes(state, organization.organizationId).filter((stake) => stake.controllerType === "FAMILY" && stake.controlShareBps > 0).sort((a, b) => a.controllerId.localeCompare(b.controllerId));
    for (let left = 0; left < controllers.length; left += 1) for (let right = left + 1; right < controllers.length; right += 1) {
      const a = controllers[left]!; const b = controllers[right]!;
      signals.push({ signalId: `SIGNAL_SHARED_CONTROL_${organization.organizationId}_${a.controllerId}_${b.controllerId}`, familyAId: a.controllerId, familyBId: b.controllerId, relation: "ALLIANCE", magnitude: Number(divideRoundedAway(BigInt(Math.min(a.controlShareBps, b.controlShareBps)), 10n)), sourceEventId: organization.formationYear === state.year ? `EVT_${organization.organizationId}_FORMED` : `EVT_${state.worldKey}_${state.year}_SHARED_CONTROL`, kind: "SHARED_CONTROL" });
    }
  }
  const people = new Map(state.politicalPeople.map((person) => [person.personId, person]));
  for (const relation of state.personRelations.filter((row) => row.relationType === "SPOUSE" && row.endYear === null)) {
    const familyAId = people.get(relation.personAId)?.familyId; const familyBId = people.get(relation.personBId)?.familyId;
    if (familyAId && familyBId && familyAId !== familyBId) signals.push({ signalId: `SIGNAL_MARRIAGE_${relation.relationId}`, familyAId, familyBId, relation: "ALLIANCE", magnitude: 1000, sourceEventId: relation.sourceEventId, kind: "MARRIAGE" });
  }
  for (const conflict of state.activeConflicts.filter((row) => row.endedYear === null)) {
    const sides = [conflict.attackerStateId, conflict.defenderStateId] as const;
    const familiesBySide = sides.map((stateId) => state.families.filter((family) => family.status === "ACTIVE" && state.settlements.find((settlement) => settlement.settlementId === family.homeSettlementId)?.stateId === stateId).sort((a, b) => a.familyId.localeCompare(b.familyId)));
    for (const familyA of familiesBySide[0]) for (const familyB of familiesBySide[1]) signals.push({ signalId: `SIGNAL_WAR_OPPOSITION_${conflict.conflictId}_${familyA.familyId}_${familyB.familyId}`, familyAId: familyA.familyId, familyBId: familyB.familyId, relation: "RIVALRY", magnitude: 600, sourceEventId: `EVT_${state.worldKey}_${conflict.declaredYear}_WAR_DECLARED_${conflict.borderRelationId}`, kind: "WAR_ALIGNMENT" });
  }
  return signals.sort((a, b) => a.signalId.localeCompare(b.signalId));
}
export function familyRelationPressure(signals: readonly FamilyInteractionSignal[], familyAId: string, familyBId: string, relation: FamilyRelationType): Score1000 {
  return clamp(signals.filter((signal) => signal.relation === relation && new Set([signal.familyAId, signal.familyBId]).has(familyAId) && new Set([signal.familyAId, signal.familyBId]).has(familyBId)).reduce((sum, signal) => sum + signal.magnitude, 0), 0, 1000);
}

export function reviewFamilyRelations(state: WorldStateV5, signals: readonly FamilyInteractionSignal[], variables: MechanicsVariablesV1, normalizedSeed: string): { state: WorldStateV5; events: CausalEventV5[] } {
  const families = state.families.filter((family) => family.status === "ACTIVE").sort((a, b) => a.familyId.localeCompare(b.familyId));
  let relations = [...state.familyRelations]; const conditions = state.timedConditions.filter((condition) => condition.type !== "FAMILY_RELATION_CANDIDATE"); const prior = new Map(state.timedConditions.filter((condition) => condition.type === "FAMILY_RELATION_CANDIDATE").map((condition) => [condition.key, condition])); const events: CausalEventV5[] = [];
  for (let left = 0; left < families.length; left += 1) for (let right = left + 1; right < families.length; right += 1) {
    const a = families[left]!.familyId; const b = families[right]!.familyId;
    const active = relations.find((relation) => relation.endYear === null && relation.familyAId === a && relation.familyBId === b);
    if (active) {
      const reinforcing = signals.filter((signal) => signal.relation === active.relationType && new Set([signal.familyAId, signal.familyBId]).has(a) && new Set([signal.familyAId, signal.familyBId]).has(b)).reduce((sum, signal) => sum + signal.magnitude, 0);
      const opposing = signals.filter((signal) => signal.relation !== active.relationType && new Set([signal.familyAId, signal.familyBId]).has(a) && new Set([signal.familyAId, signal.familyBId]).has(b)).reduce((sum, signal) => sum + signal.magnitude, 0);
      const strength = clamp(active.strength + reinforcing - opposing, 0, 1000); relations = relations.map((row) => row.familyRelationId === active.familyRelationId ? { ...row, strength, endYear: strength === 0 ? state.year : null } : row);
      continue;
    }
    for (const relationType of ["ALLIANCE", "RIVALRY"] as const) {
      const pairId = `${a}/${b}/${relationType}`;
      const pressure = familyRelationPressure(signals, a, b, relationType);
      if (pressure < variables.familyRelationThreshold) continue;
      const count = (prior.get(pairId)?.qualifyingReviewCount ?? 0) + 1;
      if (count < variables.familyRelationRequiredReviews) { conditions.push({ conditionId: `COND_${digest(pairId)}`, type: "FAMILY_RELATION_CANDIDATE", targetType: "FAMILY", targetId: a, magnitude: pressure, startYear: prior.get(pairId)?.startYear ?? state.year, endYear: null, sourceEventId: signals.find((signal) => signal.relation === relationType)?.sourceEventId ?? `EVT_${state.year}_FAMILY_RELATION`, key: pairId, qualifyingReviewCount: count }); continue; }
      const chance = thresholdChance(pressure, variables.familyRelationThreshold, variables.familyRelationMaximumChanceBps); const randomNamespace = relationType === "ALLIANCE" ? "FAMILY_RELATION_ALLIANCE" : "FAMILY_RELATION_RIVALRY"; const random = identity(normalizedSeed, randomNamespace, `${a}/${b}`, state.year, relationType); const draw = keyedDrawBps(random);
      if (draw >= chance) continue;
      const relation: FamilyRelationV5 = { familyRelationId: `FAMILY_RELATION_${digest(pairId)}`, familyAId: a, familyBId: b, relationType, strength: variables.familyRelationInitialStrength, qualifyingReviewCount: 0, startYear: state.year, endYear: null, sourceEventId: signals.find((signal) => signal.relation === relationType)?.sourceEventId ?? `EVT_${state.year}_FAMILY_RELATION` }; relations.push(relation);
      events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${relation.familyRelationId}`, worldKey: state.worldKey, year: state.year, phase: "FAMILY", sequence: events.length, eventType: `Family${relationType === "ALLIANCE" ? "Alliance" : "Rivalry"}Created`, entityType: "FAMILY_RELATION", entityId: relation.familyRelationId, causeEventIds: [relation.sourceEventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson(random), mutations: [], payload: { pressure, chanceBps: chance, drawBps: draw, familyAId: a, familyBId: b, strength: relation.strength } });
      break;
    }
  }
  return { state: { ...state, familyRelations: relations, timedConditions: conditions }, events };
}

export function reviewFamilies(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): WorldStateV5 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  return {
    ...state,
    families: state.families.map((family) => {
      if (family.status === "EXTINCT") return family;
      const home = state.settlements.find((settlement) => settlement.settlementId === family.homeSettlementId);
      if (!home) throw new Error(`Family ${family.familyId} has unknown home Settlement ${family.homeSettlementId}`);
      const politicalState = state.states.find((candidate) => candidate.stateId === home.stateId);
      if (!politicalState) throw new Error(`Family ${family.familyId} has unknown home State ${home.stateId}`);
      const allies = state.familyRelations
        .filter((relation) => relation.relationType === "ALLIANCE" && relation.endYear === null && (relation.familyAId === family.familyId || relation.familyBId === family.familyId))
        .map((relation) => state.families.find((candidate) => candidate.familyId === (relation.familyAId === family.familyId ? relation.familyBId : relation.familyAId)))
        .filter((candidate): candidate is FamilyV5 => Boolean(candidate && candidate.status === "ACTIVE"));
      const allyVector = allies.length === 0
        ? family.factionAffinity
        : normalizeFactionVector(allies.reduce((sum, ally) => ({ CONCORD: sum.CONCORD + ally.factionAffinity.CONCORD, SCHISM: sum.SCHISM + ally.factionAffinity.SCHISM, RUIN: sum.RUIN + ally.factionAffinity.RUIN }), { CONCORD: 0, SCHISM: 0, RUIN: 0 }));
      const targetFaction = normalizedVectorWeightedMean(
        [metrics.settlementPopulationFactionVectors[home.settlementId]!, 5000],
        [politicalState.factionAffinity, 3000],
        [allyVector, 2000],
      );
      return {
        ...family,
        factionAffinity: normalizedVectorWeightedMean(
          [family.factionAffinity, variables.familyScoreInertiaBps],
          [targetFaction, 10_000 - variables.familyScoreInertiaBps],
        ),
        wealth: blend(family.wealth, familyEconomicBase(state, family.familyId, metrics), variables.familyScoreInertiaBps),
        influence: blend(family.influence, familyPoliticalBase(state, family.familyId), variables.familyScoreInertiaBps),
        prestige: blend(family.prestige, weightedMean([familyOfficePowerShare(state, family.familyId), 6000], [familyNetworkStrength(state, family.familyId), 4000]), variables.familyScoreInertiaBps),
      };
    }),
  };
}

export function enforcementStrength(institutionEffectiveness: Score1000, legitimacy: Score1000, settlementStability: Score1000): Score1000 { return weightedMean([institutionEffectiveness, 4000], [legitimacy, 3500], [settlementStability, 2500]); }
export function sectorRentScore(sectorStrength: Score1000, concentration: Score1000): Score1000 { return weightedMean([sectorStrength, 7000], [concentration, 3000]); }

export interface OrganizationFormationContext { settlementId: string; sectorId: SectorId; sectorStrength: Score1000; capitalAvailability: Score1000; tradeAccess: Score1000; enforcement: Score1000; politicalExclusion: Score1000; unrest: Score1000; familyNetwork: Score1000; concentration: Score1000; }
export function corporateFormationPressure(context: OrganizationFormationContext): Score1000 { return weightedMean([context.sectorStrength, 3000], [context.capitalAvailability, 3000], [context.tradeAccess, 1500], [context.enforcement, 1000], [context.concentration, 1500]); }
export function crimeFormationPressure(context: OrganizationFormationContext): Score1000 { return weightedMean([sectorRentScore(context.sectorStrength, context.concentration), 2500], [context.politicalExclusion, 2500], [1000 - context.enforcement, 2500], [context.unrest, 1500], [context.familyNetwork, 1000]); }

interface ControllerCandidate { controllerType: ControllerType; controllerId: string; score: Score1000; }
export function organizationControllerCandidateScore(type: OrganizationType, wealth: Score1000, influence: Score1000, network: Score1000, officePower: Score1000, localFit: Score1000): Score1000 {
  return type === "CORPORATION" ? weightedMean([wealth, 3500], [influence, 1500], [network, 1000], [officePower, 1500], [localFit, 2500]) : weightedMean([network, 3000], [wealth, 2000], [influence, 2000], [officePower, 1500], [localFit, 1500]);
}

export function organizationPoliticalCapture(state: WorldStateV5, organizationId: string): Score1000 {
  const stakes = activeStakes(state, organizationId).filter((stake) => stake.controllerType !== "DIFFUSE" && (stake.controllerType === "FAMILY" || stake.controllerType === "PERSON"));
  if (stakes.length === 0) return 0;
  let value = 0n;
  for (const stake of stakes) {
    const power = stake.controllerType === "FAMILY" ? familyOfficePowerShare(state, stake.controllerId) : (() => { const person = state.politicalPeople.find((row) => row.personId === stake.controllerId); if (!person) return 0; const officePower = state.offices.filter((office) => state.officeTerms.some((term) => term.officeId === office.officeId && term.personId === person.personId && officeTermActiveAt(term, state.year))).reduce((sum, office) => sum + office.power, 0); return clamp(officePower, 0, 1000); })();
    value += BigInt(stake.controlShareBps) * BigInt(power);
  }
  return clamp(Number(divideRoundedAway(value, 10_000n)), 0, 1000);
}

export function organizationPerformanceTarget(type: OrganizationType, context: OrganizationFormationContext): Score1000 {
  return type === "CORPORATION" ? weightedMean([context.sectorStrength, 3000], [context.capitalAvailability, 2500], [context.tradeAccess, 2000], [context.enforcement, 1500], [1000 - context.unrest, 1000]) : weightedMean([sectorRentScore(context.sectorStrength, context.concentration), 3000], [context.politicalExclusion, 2500], [1000 - context.enforcement, 2500], [context.familyNetwork, 1000], [context.unrest, 1000]);
}
export function organizationInfluenceTarget(state: WorldStateV5, organization: OrganizationV5): Score1000 { return weightedMean([organization.wealth, 4500], [organizationControlConcentration(state, organization.organizationId), 3000], [organizationPoliticalCapture(state, organization.organizationId), 2500]); }
export function organizationSurvivalScore(state: WorldStateV5, organization: OrganizationV5, performance: Score1000): Score1000 { return weightedMean([organization.wealth, 5000], [organization.influence, 2500], [performance, 2500]); }

function controllerCandidates(state: WorldStateV5, settlementId: string, type: OrganizationType): ControllerCandidate[] {
  const candidates: ControllerCandidate[] = [];
  for (const family of state.families.filter((row) => row.status === "ACTIVE" && row.homeSettlementId === settlementId)) candidates.push({ controllerType: "FAMILY", controllerId: family.familyId, score: organizationControllerCandidateScore(type, family.wealth, family.influence, familyNetworkStrength(state, family.familyId), familyOfficePowerShare(state, family.familyId), 1000) });
  for (const person of state.politicalPeople.filter((row) => row.originSettlementId === settlementId && (row.actualDeathYear ?? row.naturalDeathYear) > state.year)) {
    const family = person.familyId ? state.families.find((row) => row.familyId === person.familyId) : undefined; const officePower = state.offices.filter((office) => state.officeTerms.some((term) => term.officeId === office.officeId && term.personId === person.personId && officeTermActiveAt(term, state.year))).reduce((sum, office) => sum + office.power, 0);
    candidates.push({ controllerType: "PERSON", controllerId: person.personId, score: organizationControllerCandidateScore(type, family?.wealth ?? 500, family?.influence ?? 300, family ? familyNetworkStrength(state, family.familyId) : 0, clamp(officePower, 0, 1000), 1000) });
  }
  const settlement = state.settlements.find((row) => row.settlementId === settlementId)!;
  candidates.push({ controllerType: "STATE", controllerId: settlement.stateId, score: organizationControllerCandidateScore(type, 500, state.states.find((row) => row.stateId === settlement.stateId)?.legitimacy ?? 500, 0, 500, 1000) });
  if (type === "CORPORATION") candidates.push({ controllerType: "DIFFUSE", controllerId: `DIFFUSE_${settlementId}`, score: 300 });
  return candidates.sort((a, b) => b.score - a.score || `${a.controllerType}/${a.controllerId}`.localeCompare(`${b.controllerType}/${b.controllerId}`));
}

export interface OrganizationFormationProposal { key: string; type: OrganizationType; context: OrganizationFormationContext; pressure: Score1000; }
export function reviewOrganizationFormation(state: WorldStateV5, proposals: readonly OrganizationFormationProposal[], variables: MechanicsVariablesV1, normalizedSeed: string): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; diagnostics: BoundedDiagnosticObservationV5[] } {
  let organizations = [...state.organizations]; let stakes = [...state.ownershipStakes]; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  const priorCandidates = new Map(state.timedConditions.filter((condition) => condition.type === "ORGANIZATION_FORMATION_CANDIDATE").map((condition) => [condition.key, condition]));
  const retainedConditions = state.timedConditions.filter((condition) => condition.type !== "ORGANIZATION_FORMATION_CANDIDATE" && !(condition.type === "ORGANIZATION_FORMATION_COOLDOWN" && condition.endYear !== null && condition.endYear < state.year));
  const chosen = new Map<string, OrganizationFormationProposal>();
  const byType = (type: OrganizationType): { counters: Record<string, number>; pressures: number[]; chances: number[]; components: Record<string, number[]> } => ({ counters: { pressureEvaluations: proposals.filter((proposal) => proposal.type === type).length, thresholdCrossings: 0, formationCandidateConditions: 0, candidatesSecondReview: 0, formationDraws: 0, successfulFormationDraws: 0, failedDraws: 0, blockedCooldown: 0, blockedSectorCap: 0, blockedNoEligibleController: 0, blockedOther: 0, organizationsCreated: 0 }, pressures: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.pressure), chances: [], components: { sectorStrength: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.sectorStrength), capitalAvailability: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.capitalAvailability), tradeAccess: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.tradeAccess), sectorRentScore: proposals.filter((proposal) => proposal.type === type).map((proposal) => sectorRentScore(proposal.context.sectorStrength, proposal.context.concentration)), enforcementStrength: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.enforcement), politicalExclusion: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.politicalExclusion), unrest: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.unrest), localFamilyNetworkStrength: proposals.filter((proposal) => proposal.type === type).map((proposal) => proposal.context.familyNetwork) } });
  const diagnostics = { CORPORATION: byType("CORPORATION"), CRIME_ORGANIZATION: byType("CRIME_ORGANIZATION") };
  for (const proposal of proposals) { const group = `${proposal.context.settlementId}/${proposal.type}`; const current = chosen.get(group); if (!current || proposal.pressure > current.pressure || (proposal.pressure === current.pressure && proposal.context.sectorId.localeCompare(current.context.sectorId) < 0)) chosen.set(group, proposal); }
  for (const proposal of chosen.values()) {
    const threshold = proposal.type === "CORPORATION" ? variables.corporationFormationThreshold : variables.crimeFormationThreshold;
    const activeCount = organizations.filter((organization) => organization.status !== "DISSOLVED" && organization.type === proposal.type && organization.sectorId === proposal.context.sectorId && organization.homeSettlementId === proposal.context.settlementId).length;
    const cooldown = retainedConditions.some((condition) => condition.type === "ORGANIZATION_FORMATION_COOLDOWN" && condition.key === `${proposal.context.settlementId}/${proposal.type}` && (condition.endYear === null || condition.endYear >= state.year));
    const diagnostic = diagnostics[proposal.type];
    if (proposal.pressure < threshold) { diagnostic.counters.blockedOther! += 1; continue; }
    diagnostic.counters.thresholdCrossings! += 1;
    if (activeCount >= variables.maxActiveOrganizationsPerTypeSectorSettlement) { diagnostic.counters.blockedSectorCap! += 1; continue; }
    if (cooldown) { diagnostic.counters.blockedCooldown! += 1; continue; }
    const count = (priorCandidates.get(proposal.key)?.qualifyingReviewCount ?? 0) + 1;
    if (count < variables.organizationFormationRequiredReviews) { retainedConditions.push({ conditionId: `COND_${digest(proposal.key)}`, type: "ORGANIZATION_FORMATION_CANDIDATE", targetType: "SETTLEMENT", targetId: proposal.context.settlementId, magnitude: proposal.pressure, startYear: priorCandidates.get(proposal.key)?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${state.worldKey}_${state.year}_ORG_CANDIDATE`, key: proposal.key, qualifyingReviewCount: count }); diagnostic.counters.formationCandidateConditions! += 1; continue; }
    diagnostic.counters.candidatesSecondReview! += 1;
    const chance = thresholdChance(proposal.pressure, threshold, variables.organizationFormationMaximumChanceBps); const namespace = proposal.type === "CORPORATION" ? "ORGANIZATION_FORMATION_CORPORATION" : "ORGANIZATION_FORMATION_CRIME"; const random = identity(normalizedSeed, namespace, `${proposal.context.settlementId}/${proposal.type}`, state.year, proposal.context.sectorId); const draw = keyedDrawBps(random);
    diagnostic.chances.push(chance); diagnostic.counters.formationDraws! += 1;
    retainedConditions.push({ conditionId: `COOLDOWN_${digest([proposal.context.settlementId, proposal.type, state.year])}`, type: "ORGANIZATION_FORMATION_COOLDOWN", targetType: "SETTLEMENT", targetId: proposal.context.settlementId, magnitude: 0, startYear: state.year, endYear: state.year + variables.organizationFormationCooldownYears, sourceEventId: `EVT_${state.worldKey}_${state.year}_ORG_DECISION`, key: `${proposal.context.settlementId}/${proposal.type}`, qualifyingReviewCount: 0 });
    if (draw >= chance) { diagnostic.counters.failedDraws! += 1; continue; }
    diagnostic.counters.successfulFormationDraws! += 1;
    const controller = controllerCandidates({ ...state, organizations, ownershipStakes: stakes }, proposal.context.settlementId, proposal.type)[0]!;
    const organizationId = `ORGANIZATION_${state.worldKey}_${digest([proposal.context.settlementId, proposal.type, proposal.context.sectorId, state.year])}`;
    const organization: OrganizationV5 = { organizationId, type: proposal.type, sectorId: proposal.context.sectorId, homeSettlementId: proposal.context.settlementId, founderControllerType: controller.controllerType, founderControllerId: controller.controllerId, wealth: variables.organizationInitialWealth, influence: variables.organizationInitialInfluence, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: state.year, dissolutionYear: null };
    organizations.push(organization);
    diagnostic.counters.organizationsCreated! += 1;
    if (proposal.type === "CORPORATION") {
      if (controller.controllerType === "DIFFUSE") stakes.push({ stakeId: `STAKE_${organizationId}_DIFFUSE`, organizationId, controllerType: "DIFFUSE", controllerId: `DIFFUSE_${organizationId}`, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` });
      else stakes.push({ stakeId: `STAKE_${organizationId}_FOUNDER`, organizationId, controllerType: controller.controllerType, controllerId: controller.controllerId, ownershipShareBps: 7000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` }, { stakeId: `STAKE_${organizationId}_DIFFUSE`, organizationId, controllerType: "DIFFUSE", controllerId: `DIFFUSE_${organizationId}`, ownershipShareBps: 3000, controlShareBps: 0, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` });
    } else stakes.push({ stakeId: `STAKE_${organizationId}_FOUNDER`, organizationId, controllerType: controller.controllerType, controllerId: controller.controllerId, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` });
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${organizationId}_FORMED`, worldKey: state.worldKey, year: state.year, phase: "ORGANIZATION", sequence: events.length, eventType: "OrganizationFormed", entityType: "ORGANIZATION", entityId: organizationId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson(random), mutations: [], payload: { type: proposal.type, sectorId: proposal.context.sectorId, pressure: proposal.pressure, chanceBps: chance, drawBps: draw, controllerType: controller.controllerType, controllerId: controller.controllerId } });
    namingRequests.push({ requestId: `NAME_${organizationId}`, entityType: "ORGANIZATION", entityId: organizationId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "ORGANIZATION_FORMED", organizationId, organizationType: proposal.type, sectorId: proposal.context.sectorId, homeSettlementId: proposal.context.settlementId, founderControllerType: controller.controllerType, founderControllerId: controller.controllerId, pressure: proposal.pressure } });
  }
  const observations = (["CORPORATION", "CRIME_ORGANIZATION"] as const).map((type) => ({ domain: type === "CORPORATION" ? "ORGANIZATION_CORPORATION" as const : "ORGANIZATION_CRIME" as const, worldKey: state.worldKey, year: state.year, counters: diagnostics[type].counters, histograms: { pressure: boundedHistogram(diagnostics[type].pressures), formationChance: boundedHistogram(diagnostics[type].chances), ...Object.fromEntries(Object.entries(diagnostics[type].components).map(([key, values]) => [key, boundedHistogram(values)])) }, absentComponents: type === "CORPORATION" ? ["CorporateLegalCompatibility", "SettlementPopulationScale"] : [] }));
  return { state: { ...state, organizations: organizations.sort((a, b) => a.organizationId.localeCompare(b.organizationId)), ownershipStakes: stakes, timedConditions: retainedConditions }, events, namingRequests, diagnostics: observations };
}

export function reviewOrganizationLifecycle(state: WorldStateV5, contexts: Readonly<Record<string, OrganizationFormationContext>>, variables: MechanicsVariablesV1): { state: WorldStateV5; events: CausalEventV5[] } {
  let stakes = [...state.ownershipStakes]; const events: CausalEventV5[] = [];
  const organizations = state.organizations.map((organization) => {
    if (organization.status === "DISSOLVED") return organization;
    const context = contexts[organization.organizationId]; if (!context) throw new Error(`Missing lifecycle context for ${organization.organizationId}`);
    const performance = organizationPerformanceTarget(organization.type, context);
    const updated = { ...organization, wealth: blend(organization.wealth, performance, variables.organizationScoreInertiaBps), influence: blend(organization.influence, organizationInfluenceTarget(state, organization), variables.organizationScoreInertiaBps) };
    const survival = organizationSurvivalScore(state, updated, performance);
    if (survival >= variables.organizationSurvivalThreshold) return { ...updated, status: "ACTIVE" as const, belowSurvivalReviewCount: 0 };
    const count = updated.belowSurvivalReviewCount + 1;
    if (count < variables.organizationDissolutionRequiredReviews) return { ...updated, status: "DECLINING" as const, belowSurvivalReviewCount: count };
    stakes = stakes.map((stake) => stake.organizationId === organization.organizationId && stake.endYear === null ? { ...stake, endYear: state.year } : stake);
    for (const controlled of stakes.filter((stake) => stake.endYear === null && stake.controllerType === "ORGANIZATION" && stake.controllerId === organization.organizationId)) {
      stakes = stakes.map((stake) => stake.stakeId === controlled.stakeId ? { ...stake, endYear: state.year } : stake);
      stakes.push({ stakeId: `STAKE_DIFFUSE_${digest([controlled.stakeId, state.year])}`, organizationId: controlled.organizationId, controllerType: "DIFFUSE", controllerId: `DIFFUSE_${controlled.organizationId}`, ownershipShareBps: controlled.ownershipShareBps, controlShareBps: controlled.controlShareBps, startYear: state.year, endYear: null, sourceEventId: `EVT_${organization.organizationId}_DISSOLVED` });
    }
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${organization.organizationId}_DISSOLVED`, worldKey: state.worldKey, year: state.year, phase: "ORGANIZATION", sequence: events.length, eventType: "OrganizationDissolved", entityType: "ORGANIZATION", entityId: organization.organizationId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { survivalScore: survival, qualifyingReviews: count } });
    return { ...updated, status: "DISSOLVED" as const, belowSurvivalReviewCount: count, dissolutionYear: state.year };
  });
  return { state: { ...state, organizations, ownershipStakes: stakes }, events };
}
