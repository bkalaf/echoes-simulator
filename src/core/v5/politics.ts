import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1, GovernmentPrototypeV5, MechanicsVariablesV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { applyCausalEffects } from "./effects.js";
import { blend, clamp, divideRoundedAway, factionCompatibility, normalizedVectorWeightedMean, thresholdChance, weightedMean } from "./fixed-point.js";
import { breedFactionVector, dominantFaction, governmentDoctrineVector, stateFactionTarget, updateDominantFaction } from "./faction.js";
import { classDistribution, deriveMetrics, derivedInstitutionControlVector, populationFactionVector, settlementPopulation, statePopulation } from "./derivations.js";
import { keyedDrawBps, keyedInteger, type KeyedRandomIdentity } from "./random.js";
import { officeTermActiveAt } from "./office-term.js";
import type { CausalEventV5, CohortCell, FactionVector, FamilyV5, InstitutionV5, NamingRequestV5, OfficeTermV5, OfficeV5, PoliticalPersonV5, Score1000, SelectionRuleV5, SocialClass, SocialTier, StateV5, TimedConditionV5, WorldStateV5 } from "./types.js";

function digest(input: unknown): string { return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex").slice(0, 20); }
function randomIdentity(normalizedSeed: string, randomNamespace: KeyedRandomIdentity["randomNamespace"], comparisonEntityId: string, year: number, candidateOrDecisionKey: string): KeyedRandomIdentity { return { normalizedSeed, randomNamespace, comparisonEntityId, year, candidateOrDecisionKey }; }

export function supportedGovernment(populationVector: FactionVector, governments: readonly GovernmentPrototypeV5[]): GovernmentPrototypeV5 {
  if (governments.length === 0) throw new Error("No government prototypes available");
  return [...governments].sort((a, b) => factionCompatibility(populationVector, governmentDoctrineVector(b)) - factionCompatibility(populationVector, governmentDoctrineVector(a)) || a.governmentFormId.localeCompare(b.governmentFormId))[0]!;
}

export function actualGovernmentCompatibility(state: StateV5, populationVector: FactionVector, canonical: CanonicalDataV5): Score1000 {
  const actual = canonical.governments.find((government) => government.governmentFormId === state.actualGovernment);
  if (!actual) throw new Error(`Unknown actual government ${state.actualGovernment}`);
  return factionCompatibility(populationVector, governmentDoctrineVector(actual));
}

export function currentOfficeTerm(state: WorldStateV5, officeId: string): OfficeTermV5 | null {
  const active = state.officeTerms.filter((term) => term.officeId === officeId && officeTermActiveAt(term, state.year));
  if (active.length > 1) throw new Error(`Office ${officeId} has multiple active terms`);
  return active[0] ?? null;
}

export function institutionEffectiveness(state: WorldStateV5, stateId: string, variables: MechanicsVariablesV1): Score1000 {
  const institutionIds = new Set(state.institutions.filter((institution) => institution.stateId === stateId && institution.dissolvedYear === null).map((institution) => institution.institutionId));
  const mandatory = state.offices.filter((office) => office.mandatory && institutionIds.has(office.institutionId));
  const totalPower = mandatory.reduce((sum, office) => sum + BigInt(office.power), 0n);
  const filledPower = mandatory.filter((office) => currentOfficeTerm(state, office.officeId)).reduce((sum, office) => sum + BigInt(office.power), 0n);
  const fillRatio = totalPower === 0n ? 1000 : Number(divideRoundedAway(filledPower * 1000n, totalPower));
  const politicalState = state.states.find((row) => row.stateId === stateId)!;
  const continuity = clamp(Number(divideRoundedAway(BigInt(Math.max(0, state.year - politicalState.lastGovernmentTransitionYear)) * 1000n, BigInt(variables.institutionContinuityMaturityYears))), 0, 1000);
  return weightedMean([fillRatio, 6000], [continuity, 4000]);
}

export function institutionControlVector(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5): FactionVector {
  return derivedInstitutionControlVector(state, stateId, canonical);
}

export function rulingCoalitionVector(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5): FactionVector {
  const institutionIds = new Set(state.institutions.filter((institution) => institution.stateId === stateId && institution.dissolvedYear === null).map((institution) => institution.institutionId));
  const apexOffices = state.offices.filter((office) => office.apex && institutionIds.has(office.institutionId));
  if (apexOffices.length === 0) return institutionControlVector(state, stateId, canonical);
  const shadow: WorldStateV5 = { ...state, offices: state.offices.map((office) => ({ ...office, power: apexOffices.some((apex) => apex.officeId === office.officeId) ? office.power : 0 })) };
  return institutionControlVector(shadow, stateId, canonical);
}

export function rulingCoalitionSupport(state: WorldStateV5, stateId: string, populationVector: FactionVector, canonical: CanonicalDataV5): Score1000 {
  const coalition = rulingCoalitionVector(state, stateId, canonical);
  const institutionIds = new Set(state.institutions.filter((institution) => institution.stateId === stateId).map((institution) => institution.institutionId));
  const apexOfficeIds = new Set(state.offices.filter((office) => office.apex && institutionIds.has(office.institutionId)).map((office) => office.officeId));
  const familyIds = state.officeTerms.filter((term) => officeTermActiveAt(term, state.year) && apexOfficeIds.has(term.officeId)).map((term) => state.politicalPeople.find((person) => person.personId === term.personId)?.familyId).filter((value): value is string => Boolean(value));
  const prestige = familyIds.length === 0 ? 500 : Number(divideRoundedAway(familyIds.reduce((sum, id) => sum + BigInt(state.families.find((family) => family.familyId === id)?.prestige ?? 0), 0n), BigInt(familyIds.length)));
  return weightedMean([factionCompatibility(coalition, populationVector), 7000], [prestige, 3000]);
}

export function targetLegitimacy(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): Score1000 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const politicalState = state.states.find((row) => row.stateId === stateId)!;
  const population = metrics.statePopulationFactionVectors[stateId]!;
  const activeOutcomes = state.timedConditions.filter((condition) => condition.type === "OUTCOME" && condition.targetType === "STATE" && condition.targetId === stateId && condition.startYear <= state.year && (condition.endYear === null || condition.endYear >= state.year)).reduce((sum, condition) => sum + condition.magnitude - 500, 0);
  const recentOutcome = clamp(500 + activeOutcomes, 0, 1000);
  const weights = variables.legitimacyWeights;
  return weightedMean(
    [actualGovernmentCompatibility(politicalState, population, canonical), weights.governmentCompatibility],
    [rulingCoalitionSupport(state, stateId, population, canonical), weights.rulingCoalition],
    [institutionEffectiveness(state, stateId, variables), weights.institutions],
    [1000 - metrics.stateUnrest[stateId]!, weights.inverseUnrest],
    [recentOutcome, weights.recentOutcome],
  );
}

export function stateCrisisPressure(state: WorldStateV5, stateId: string, metrics: ReturnType<typeof deriveMetrics>): Score1000 {
  const members = state.settlements.filter((settlement) => settlement.stateId === stateId);
  const population = statePopulation(state, stateId);
  const disruption = population === 0n ? 0 : Number(divideRoundedAway(members.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(metrics.disruptionPressure[settlement.settlementId]!), 0n), population));
  const conditions = state.timedConditions.filter((condition) => condition.type === "GOVERNMENT_CRISIS" && condition.targetType === "STATE" && condition.targetId === stateId && condition.startYear <= state.year && (condition.endYear === null || condition.endYear >= state.year));
  return Math.max(disruption, ...conditions.map((condition) => condition.magnitude), 0);
}

export function governmentTransitionPressure(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): Score1000 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const politicalState = state.states.find((row) => row.stateId === stateId)!;
  const weights = variables.governmentTransitionWeights;
  return weightedMean(
    [1000 - actualGovernmentCompatibility(politicalState, metrics.statePopulationFactionVectors[stateId]!, canonical), weights.mismatch],
    [1000 - politicalState.legitimacy, weights.inverseLegitimacy],
    [metrics.stateUnrest[stateId]!, weights.unrest],
    [stateCrisisPressure(state, stateId, metrics), weights.crisis],
  );
}

export interface GovernmentReviewResult { state: WorldStateV5; event: CausalEventV5 | null; pressure: Score1000; chanceBps: number; drawBps: number | null; }

function transitionGovernmentInstitutions(state: WorldStateV5, stateId: string, government: GovernmentPrototypeV5, year: number): WorldStateV5 {
  const retiringInstitutionIds = new Set(state.institutions.filter((institution) => institution.stateId === stateId && institution.dissolvedYear === null && !["CONCLAVE_PRE90", "CONCLAVE_POST90", "SENATE"].includes(institution.institutionType)).map((institution) => institution.institutionId));
  const retiringOfficeIds = new Set(state.offices.filter((office) => retiringInstitutionIds.has(office.institutionId)).map((office) => office.officeId));
  const retired: WorldStateV5 = {
    ...state,
    institutions: state.institutions.map((institution) => retiringInstitutionIds.has(institution.institutionId) ? { ...institution, dissolvedYear: year } : institution),
    officeTerms: state.officeTerms.map((term) => term.startYear <= year && (term.endYear === null || term.endYear > year) && retiringOfficeIds.has(term.officeId) ? { ...term, endYear: year, terminationReason: "GOVERNMENT_CHANGE" } : term),
  };
  return instantiateGovernmentInstitutions(retired, stateId, government, year);
}

export function reviewRoutineGovernmentTransition(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, normalizedSeed: string, suppliedMetrics?: ReturnType<typeof deriveMetrics>): GovernmentReviewResult {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const pressure = governmentTransitionPressure(state, stateId, canonical, variables, metrics);
  const current = state.states.find((row) => row.stateId === stateId)!;
  if (state.year < current.routineTransitionCooldownUntilYear) return { state: { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, qualifyingGovernmentReviewCount: 0 } : row) }, event: null, pressure, chanceBps: 0, drawBps: null };
  if (pressure < variables.governmentTransitionThreshold) return { state: { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, qualifyingGovernmentReviewCount: 0 } : row) }, event: null, pressure, chanceBps: 0, drawBps: null };
  const qualifying = current.qualifyingGovernmentReviewCount + 1;
  if (qualifying < variables.governmentTransitionRequiredReviews) return { state: { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, qualifyingGovernmentReviewCount: qualifying } : row) }, event: null, pressure, chanceBps: 0, drawBps: null };
  const chanceBps = thresholdChance(pressure, variables.governmentTransitionThreshold, variables.governmentTransitionMaximumChanceBps);
  const identity = randomIdentity(normalizedSeed, "GOVERNMENT_TRANSITION_ROUTINE", stateId, state.year, current.actualGovernment);
  const drawBps = keyedDrawBps(identity);
  if (drawBps >= chanceBps) return { state: { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, qualifyingGovernmentReviewCount: qualifying } : row) }, event: null, pressure, chanceBps, drawBps };
  const nextGovernment = supportedGovernment(metrics.statePopulationFactionVectors[stateId]!, canonical.governments).governmentFormId;
  let nextState: WorldStateV5 = { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, actualGovernment: nextGovernment, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: state.year, routineTransitionCooldownUntilYear: state.year + variables.governmentTransitionCooldownYears } : row) };
  const government = canonical.governments.find((row) => row.governmentFormId === nextGovernment);
  if (!government) throw new Error(`Unknown transition government ${nextGovernment}`);
  nextState = transitionGovernmentInstitutions(nextState, stateId, government, state.year);
  const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_GOVERNMENT_TRANSITION_${stateId}`, worldKey: state.worldKey, year: state.year, phase: "GOVERNMENT", sequence: 0, eventType: "GovernmentTransition", entityType: "STATE", entityId: stateId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson(identity), mutations: [{ mutationType: "GOVERNMENT_TRANSITION", entityType: "STATE", entityId: stateId, before: current.actualGovernment, after: nextGovernment }], payload: { pressure, chanceBps, drawBps, persistenceReviews: qualifying, bypass: false } };
  return { state: nextState, event, pressure, chanceBps, drawBps };
}

export function reviewStateFaction(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): { state: WorldStateV5; realigned: boolean } {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const current = state.states.find((row) => row.stateId === stateId)!;
  const government = canonical.governments.find((row) => row.governmentFormId === current.actualGovernment)!;
  const target = stateFactionTarget(metrics.statePopulationFactionVectors[stateId]!, governmentDoctrineVector(government), rulingCoalitionVector(state, stateId, canonical), institutionControlVector(state, stateId, canonical), variables);
  const blended = normalizedVectorWeightedMean([current.factionAffinity, variables.stateFactionInertiaBps], [target, 10_000 - variables.stateFactionInertiaBps]);
  const nextDominant = updateDominantFaction(current.dominantFaction, blended, variables.stateFactionSwitchMargin);
  return { state: { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, factionAffinity: blended, dominantFaction: nextDominant } : row) }, realigned: nextDominant !== current.dominantFaction };
}

interface PersonSourceContext { cell: CohortCell; tier: SocialTier; classContext: SocialClass | null; eligiblePopulation: bigint; score: Score1000; }
export function politicalPersonSourceScore(eligiblePopulationScore: Score1000, factionFit: Score1000, classFit: Score1000, localPoliticalSupport: Score1000, ruleSpecificFit: Score1000): Score1000 {
  return weightedMean([eligiblePopulationScore, 4000], [factionFit, 2500], [classFit, 1500], [localPoliticalSupport, 1500], [ruleSpecificFit, 500]);
}

export function isPersonEligible(person: PoliticalPersonV5, year: number, allowReturnFromRetirement = false): boolean {
  const deathYear = person.actualDeathYear ?? person.naturalDeathYear;
  if (year < person.activeFromYear || year >= deathYear) return false;
  if (person.disqualifiedFromYear !== null && person.disqualifiedFromYear <= year && (person.requalifiedYear === null || person.requalifiedYear > year)) return false;
  if (!allowReturnFromRetirement && person.actualRetirementYear !== null && person.actualRetirementYear <= year) return false;
  return true;
}

export function materializePoliticalPerson(state: WorldStateV5, office: OfficeV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string, vacancyEventId: string, vacancyOrdinal: number): { state: WorldStateV5; person: PoliticalPersonV5; family: FamilyV5 | null; source: PersonSourceContext; namingRequest: NamingRequestV5 } {
  const institution = state.institutions.find((row) => row.institutionId === office.institutionId)!;
  if (office.selectionRule.scope === "SETTLEMENT" && !office.jurisdictionSettlementId) throw new Error(`Settlement-scoped Office ${office.officeId} requires a jurisdiction Settlement`);
  const stateSettlementIds = new Set(state.settlements.filter((settlement) => settlement.stateId === institution.stateId && (office.selectionRule.scope === "STATE" || settlement.settlementId === office.jurisdictionSettlementId)).map((settlement) => settlement.settlementId));
  const politicalState = state.states.find((row) => row.stateId === institution.stateId)!;
  const candidates: PersonSourceContext[] = [];
  for (const cell of state.cohorts.filter((row) => stateSettlementIds.has(row.settlementId))) for (const tier of office.selectionRule.eligibleTiers) {
    const classes = office.selectionRule.eligibleClasses;
    if (classes?.length) {
      const distribution = classDistribution(cell, owner)[tier];
      for (const classContext of classes) {
        const eligiblePopulation = distribution[classContext]; if (eligiblePopulation === 0n) continue;
        candidates.push({ cell, tier, classContext, eligiblePopulation, score: 0 });
      }
    } else if (cell.tiers[tier].population > 0n) candidates.push({ cell, tier, classContext: null, eligiblePopulation: cell.tiers[tier].population, score: 0 });
  }
  if (candidates.length === 0) throw new Error(`No aggregate source for mandatory Office ${office.officeId}`);
  const maximumPopulation = candidates.reduce((maximum, row) => row.eligiblePopulation > maximum ? row.eligiblePopulation : maximum, 0n);
  for (const candidate of candidates) {
    const breed = canonical.breeds.find((row) => row.breedId === candidate.cell.breedId)!;
    const vector = breedFactionVector(breed);
    const eligiblePopulationScore = Number(divideRoundedAway(candidate.eligiblePopulation * 1000n, maximumPopulation));
    const factionFit = factionCompatibility(vector, politicalState.factionAffinity);
    const classFit = candidate.classContext ? 1000 : 500;
    const settlement = state.settlements.find((row) => row.settlementId === candidate.cell.settlementId)!;
    const localSupport = weightedMean([candidate.cell.tiers[candidate.tier].prosperity, 5000], [1000 - settlement.unrest, 5000]);
    candidate.score = politicalPersonSourceScore(eligiblePopulationScore, factionFit, classFit, localSupport, 1000);
  }
  candidates.sort((a, b) => b.score - a.score || `${a.cell.settlementId}/${a.cell.breedId}/${a.tier}/${a.classContext ?? "NONE"}`.localeCompare(`${b.cell.settlementId}/${b.cell.breedId}/${b.tier}/${b.classContext ?? "NONE"}`));
  const topScore = candidates[0]!.score;
  const tied = candidates.filter((candidate) => candidate.score === topScore);
  let source = tied[0]!;
  if (tied.length > 1 && office.selectionRule.stochasticTies) source = tied[keyedInteger(randomIdentity(normalizedSeed, "POLITICAL_PERSON_SOURCE", `${institution.stateId}/${office.titleKey}`, state.year, vacancyEventId), 0, tied.length - 1)]!;
  const breed = canonical.breeds.find((row) => row.breedId === source.cell.breedId)!;
  const temporal = breed.temporalAuthority ?? { activationAge: variables.politicalPersonFallbackActivationAge, retirementAge: variables.politicalPersonFallbackRetirementAge, naturalDeathAge: variables.politicalPersonFallbackNaturalDeathAge };
  const comparisonId = `${institution.stateId}/${office.titleKey}/${vacancyEventId}/${vacancyOrdinal}/${source.cell.settlementId}/${source.cell.breedId}/${source.tier}/${source.classContext ?? "NONE"}`;
  const activationAge = keyedInteger(randomIdentity(normalizedSeed, "POLITICAL_PERSON_ACTIVATION_AGE", comparisonId, state.year, "activation"), temporal.activationAge[0], temporal.activationAge[1]);
  const currentAge = keyedInteger(randomIdentity(normalizedSeed, "POLITICAL_PERSON_CURRENT_AGE", comparisonId, state.year, "current"), activationAge, Math.max(activationAge, (temporal.retirementAge ?? temporal.naturalDeathAge)[1] - 1));
  const naturalDeathAge = keyedInteger(randomIdentity(normalizedSeed, "POLITICAL_PERSON_NATURAL_DEATH_AGE", comparisonId, state.year, "death"), Math.max(currentAge + 1, temporal.naturalDeathAge[0]), Math.max(currentAge + 1, temporal.naturalDeathAge[1]));
  const retirementAge = temporal.retirementAge ? keyedInteger(randomIdentity(normalizedSeed, "POLITICAL_PERSON_RETIREMENT_AGE", comparisonId, state.year, "retirement"), Math.max(currentAge + 1, temporal.retirementAge[0]), Math.max(currentAge + 1, temporal.retirementAge[1])) : null;
  const birthYear = state.year - currentAge;
  let family: FamilyV5 | null = null;
  let familyId: string | null = null;
  if (office.selectionRule.requiresTrackedLineage) {
    family = state.families.filter((row) => row.status === "ACTIVE" && row.homeSettlementId === source.cell.settlementId && row.founderBreedId === source.cell.breedId).sort((a, b) => b.influence - a.influence || a.familyId.localeCompare(b.familyId))[0] ?? null;
    if (!family) family = { familyId: `FAMILY_${digest([comparisonId, "LINEAGE"])}`, homeSettlementId: source.cell.settlementId, founderBreedId: source.cell.breedId, factionAffinity: politicalState.factionAffinity, wealth: source.cell.tiers[source.tier].prosperity, influence: office.power, prestige: 500, status: "ACTIVE", foundingYear: state.year, extinctionYear: null };
    familyId = family.familyId;
  }
  const person: PoliticalPersonV5 = { personId: `PERSON_${digest(comparisonId)}`, familyId, breedId: source.cell.breedId, originSettlementId: source.cell.settlementId, sourceTier: source.tier, sourceClass: source.classContext, birthYear, activeFromYear: birthYear + activationAge, plannedRetirementYear: retirementAge === null ? null : birthYear + retirementAge, actualRetirementYear: null, naturalDeathYear: birthYear + naturalDeathAge, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null };
  const next = { ...state, politicalPeople: [...state.politicalPeople, person], families: family && !state.families.some((row) => row.familyId === family!.familyId) ? [...state.families, family] : state.families };
  return { state: next, person, family, source, namingRequest: { requestId: `NAME_${person.personId}`, entityType: "POLITICAL_PERSON", entityId: person.personId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "OFFICEHOLDER_MATERIALIZED", officeId: office.officeId, institutionId: office.institutionId, stateId: institution.stateId, originSettlementId: person.originSettlementId, breedId: person.breedId, familyId: person.familyId, sourceTier: person.sourceTier, sourceClass: person.sourceClass } } };
}

export function officeCandidateScore(state: WorldStateV5, office: OfficeV5, person: PoliticalPersonV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1): Score1000 {
  const institution = state.institutions.find((row) => row.institutionId === office.institutionId);
  if (!institution) throw new Error(`Office ${office.officeId} lacks an Institution`);
  const politicalState = state.states.find((row) => row.stateId === institution.stateId);
  const settlement = state.settlements.find((row) => row.settlementId === person.originSettlementId);
  const breed = canonical.breeds.find((row) => row.breedId === person.breedId);
  if (!politicalState || !settlement || !breed) throw new Error(`Office candidate ${person.personId} lacks causal authority`);
  const factionFit = factionCompatibility(breedFactionVector(breed), politicalState.factionAffinity);
  const cell = state.cohorts.find((row) => row.settlementId === person.originSettlementId && row.breedId === person.breedId);
  const localSupport = weightedMean([cell?.tiers[person.sourceTier].prosperity ?? 500, 5000], [1000 - settlement.unrest, 5000]);
  const family = person.familyId ? state.families.find((row) => row.familyId === person.familyId && row.status === "ACTIVE") : null;
  const lineageFit = family?.prestige ?? (office.selectionRule.requiresTrackedLineage ? 0 : 500);
  const classFit = office.selectionRule.eligibleClasses ? (person.sourceClass && office.selectionRule.eligibleClasses.includes(person.sourceClass) ? 1000 : 0) : 500;
  const ruleSpecificFit = (() => {
    switch (office.selectionRule.selectionMethod) {
      case "HEREDITARY": return lineageFit;
      case "RULER_APPOINTMENT": return factionFit;
      case "COUNCIL_APPOINTMENT": return institutionEffectiveness(state, institution.stateId, variables);
      case "ESTATE_SELECTION": return family?.influence ?? 0;
      case "ELITE_FRANCHISE": return weightedMean([localSupport, 6000], [person.sourceTier === "HIGH" ? 1000 : person.sourceTier === "MID" ? 500 : 0, 4000]);
      case "POPULAR_ELECTION": return localSupport;
      case "MILITARY_SELECTION": return weightedMean([factionFit, 5000], [politicalState.legitimacy, 5000]);
      case "RELIGIOUS_SELECTION": return factionFit;
    }
  })();
  const weights = office.selectionRule.scoreWeights;
  return weightedMean([factionFit, weights.factionFit], [classFit, weights.classFit], [localSupport, weights.localSupport], [lineageFit, weights.lineageFit], [ruleSpecificFit, weights.ruleSpecificFit]);
}

function officeSelectorType(rule: SelectionRuleV5): OfficeTermV5["selectorType"] {
  switch (rule.selectionMethod) {
    case "HEREDITARY": return "SUCCESSION";
    case "RULER_APPOINTMENT": return "PERSON";
    case "COUNCIL_APPOINTMENT": return "INSTITUTION";
    case "ESTATE_SELECTION": return "FAMILY";
    case "ELITE_FRANCHISE": case "POPULAR_ELECTION": return "ELECTORATE";
    case "MILITARY_SELECTION": return "MILITARY";
    case "RELIGIOUS_SELECTION": return "RELIGIOUS_BODY";
  }
}

function officeSelectorId(state: WorldStateV5, office: OfficeV5, selectedPerson: PoliticalPersonV5): string | null {
  const institution = state.institutions.find((row) => row.institutionId === office.institutionId)!;
  switch (office.selectionRule.selectionMethod) {
    case "HEREDITARY": return selectedPerson.familyId;
    case "RULER_APPOINTMENT": {
      const institutionIds = new Set(state.institutions.filter((row) => row.stateId === institution.stateId && row.dissolvedYear === null).map((row) => row.institutionId));
      const apexOfficeIds = new Set(state.offices.filter((row) => row.apex && row.officeId !== office.officeId && institutionIds.has(row.institutionId)).sort((a, b) => b.power - a.power || a.officeId.localeCompare(b.officeId)).map((row) => row.officeId));
      return state.officeTerms.filter((term) => officeTermActiveAt(term, state.year) && apexOfficeIds.has(term.officeId)).sort((a, b) => a.officeId.localeCompare(b.officeId))[0]?.personId ?? null;
    }
    case "COUNCIL_APPOINTMENT": return institution.institutionId;
    case "ESTATE_SELECTION": return selectedPerson.familyId;
    case "ELITE_FRANCHISE": case "POPULAR_ELECTION": return `ELECTORATE_${institution.stateId}`;
    case "MILITARY_SELECTION": return `MILITARY_${institution.stateId}`;
    case "RELIGIOUS_SELECTION": return `RELIGIOUS_BODY_${institution.stateId}`;
  }
}

export interface ChamberSelectionAuthorityV5 {
  appliedSelectionRule: SelectionRuleV5;
  sourceGovernmentFormId: string;
  sourceGovernmentOfficeId: string;
  termYears: number | null;
}

export function chamberSelectionAuthorityForOffice(state: WorldStateV5, office: OfficeV5, canonical: CanonicalDataV5): ChamberSelectionAuthorityV5 | null {
  const institution = state.institutions.find((row) => row.institutionId === office.institutionId);
  if (!institution || !["CONCLAVE_PRE90", "CONCLAVE_POST90", "SENATE"].includes(institution.institutionType)) return null;
  const politicalState = state.states.find((row) => row.stateId === institution.stateId);
  if (!politicalState) throw new Error(`Chamber Office ${office.officeId} lacks State authority`);
  const government = canonical.governments.find((row) => row.governmentFormId === politicalState.actualGovernment);
  if (!government) throw new Error(`Chamber Office ${office.officeId} lacks Government ${politicalState.actualGovernment}`);
  const sources = government.requiredInstitutions.flatMap((definition, institutionIndex) => definition.offices.map((candidate, officeIndex) => ({ definition, candidate, institutionIndex, officeIndex })))
    .sort((left, right) => Number(right.candidate.apex) - Number(left.candidate.apex) || right.candidate.power - left.candidate.power || left.candidate.titleKey.localeCompare(right.candidate.titleKey) || left.institutionIndex - right.institutionIndex || left.officeIndex - right.officeIndex);
  const source = sources[0];
  if (!source) throw new Error(`Government ${government.governmentFormId} has no Office selection authority`);
  const scope: SelectionRuleV5["scope"] = institution.institutionType === "CONCLAVE_PRE90" || (institution.institutionType === "CONCLAVE_POST90" && office.jurisdictionSettlementId !== null) ? "SETTLEMENT" : "STATE";
  return {
    appliedSelectionRule: {
      ...source.candidate.selectionRule,
      scope,
      eligibleTiers: [...source.candidate.selectionRule.eligibleTiers],
      eligibleClasses: source.candidate.selectionRule.eligibleClasses ? [...source.candidate.selectionRule.eligibleClasses] : undefined,
      scoreWeights: { ...source.candidate.selectionRule.scoreWeights },
    },
    sourceGovernmentFormId: government.governmentFormId,
    sourceGovernmentOfficeId: `GOVERNMENT_TEMPLATE_${government.governmentFormId}_${source.definition.institutionType}_${source.candidate.titleKey}_${source.institutionIndex}_${source.officeIndex}`,
    termYears: institution.institutionType === "SENATE" ? 10 : source.candidate.termYears,
  };
}

export interface AuthorizedOfficeSelectionResultV5 {
  state: WorldStateV5;
  events: CausalEventV5[];
  namingRequests: NamingRequestV5[];
  officeTerm: OfficeTermV5 | null;
}

export function selectHolderForAuthorizedOfficeVacancy(state: WorldStateV5, officeId: string, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string, causeEventId: string, ordinal: number): AuthorizedOfficeSelectionResultV5 {
  if (currentOfficeTerm(state, officeId)) return { state, events: [], namingRequests: [], officeTerm: null };
  let working = state;
  let office = working.offices.find((row) => row.officeId === officeId);
  if (!office) throw new Error(`Authorized Office selection references unknown Office ${officeId}`);
  const institution = working.institutions.find((row) => row.institutionId === office!.institutionId);
  if (!institution || institution.foundedYear > working.year || (institution.dissolvedYear !== null && institution.dissolvedYear <= working.year)) throw new Error(`Authorized Office ${officeId} lacks an active Institution`);
  const chamberAuthority = chamberSelectionAuthorityForOffice(working, office, canonical);
  if (chamberAuthority) {
    office = { ...office, selectionRule: chamberAuthority.appliedSelectionRule, termYears: chamberAuthority.termYears };
    working = { ...working, offices: working.offices.map((row) => row.officeId === officeId ? office! : row) };
  }
  const eligible = (): PoliticalPersonV5[] => working.politicalPeople.filter((person) => {
    if (!isPersonEligible(person, working.year) || !office!.selectionRule.eligibleTiers.includes(person.sourceTier)) return false;
    if (office!.selectionRule.eligibleClasses && (!person.sourceClass || !office!.selectionRule.eligibleClasses.includes(person.sourceClass))) return false;
    if (office!.selectionRule.requiresTrackedLineage && !person.familyId) return false;
    const origin = working.settlements.find((settlement) => settlement.settlementId === person.originSettlementId);
    if (!origin || origin.stateId !== institution.stateId) return false;
    if (office!.selectionRule.scope === "SETTLEMENT" && origin.settlementId !== office!.jurisdictionSettlementId) return false;
    const breed = canonical.breeds.find((row) => row.breedId === person.breedId);
    const politicalState = working.states.find((row) => row.stateId === institution.stateId);
    return Boolean(breed && politicalState && factionCompatibility(breedFactionVector(breed), politicalState.factionAffinity) >= office!.selectionRule.minimumFactionCompatibility);
  });
  let candidates = eligible();
  let materialized: ReturnType<typeof materializePoliticalPerson> | null = null;
  let familyWasNew = false;
  const namingRequests: NamingRequestV5[] = [];
  if (candidates.length === 0) {
    materialized = materializePoliticalPerson(working, office, canonical, owner, variables, normalizedSeed, causeEventId, ordinal);
    familyWasNew = Boolean(materialized.family && !working.families.some((row) => row.familyId === materialized!.family!.familyId));
    working = materialized.state;
    namingRequests.push(materialized.namingRequest);
    if (materialized.family && familyWasNew) namingRequests.push({ requestId: `NAME_${materialized.family.familyId}`, entityType: "FAMILY", entityId: materialized.family.familyId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "OFFICE_OR_LINEAGE_REQUIRED", familyId: materialized.family.familyId, homeSettlementId: materialized.family.homeSettlementId, founderBreedId: materialized.family.founderBreedId, officeId: office.officeId } });
    candidates = eligible();
  }
  if (candidates.length === 0) throw new Error(`No eligible Political Person for authorized Office ${office.officeId}`);
  const scored = candidates.map((person) => ({ person, score: officeCandidateScore(working, office!, person, canonical, variables) })).sort((a, b) => b.score - a.score || a.person.personId.localeCompare(b.person.personId));
  const top = scored.filter((candidate) => candidate.score === scored[0]!.score);
  const randomIdentityForSelection = randomIdentity(normalizedSeed, "OFFICE_CANDIDATE_SELECTION", `${institution.stateId}/${office.titleKey}`, state.year, causeEventId);
  const selected = top.length > 1 && office.selectionRule.stochasticTies ? top[keyedInteger(randomIdentityForSelection, 0, top.length - 1)]! : top[0]!;
  const term: OfficeTermV5 = { officeTermId: `TERM_${digest([office.officeId, selected.person.personId, state.year])}`, officeId: office.officeId, personId: selected.person.personId, startYear: state.year, endYear: office.termYears === null ? null : state.year + office.termYears, selectionEventId: `${causeEventId}_OFFICE_${office.officeId}`, selectorType: officeSelectorType(office.selectionRule), selectorId: officeSelectorId(working, office, selected.person), terminationReason: null };
  working = { ...working, officeTerms: [...working.officeTerms, term] };
  const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: term.selectionEventId, worldKey: state.worldKey, year: state.year, phase: "OFFICE_SELECTION", sequence: ordinal, eventType: "OfficeholderSelected", entityType: "OFFICE", entityId: office.officeId, causeEventIds: [causeEventId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: top.length > 1 && office.selectionRule.stochasticTies ? canonicalJson(randomIdentityForSelection) : null, mutations: [], payload: { personId: selected.person.personId, selectedPersonId: selected.person.personId, familyId: selected.person.familyId, officeTermId: term.officeTermId, selectorType: term.selectorType, selectorId: term.selectorId, appliedSelectionRule: { ...office.selectionRule, eligibleTiers: [...office.selectionRule.eligibleTiers], eligibleClasses: office.selectionRule.eligibleClasses ? [...office.selectionRule.eligibleClasses] : undefined, scoreWeights: { ...office.selectionRule.scoreWeights } }, sourceGovernmentFormId: chamberAuthority?.sourceGovernmentFormId ?? null, sourceGovernmentOfficeId: chamberAuthority?.sourceGovernmentOfficeId ?? null, sourceSettlementId: selected.person.originSettlementId, sourceBreedId: selected.person.breedId, sourceTier: selected.person.sourceTier, sourceClass: selected.person.sourceClass, candidateScore: selected.score, candidateCount: scored.length, materialized: materialized?.person.personId === selected.person.personId } };
  return { state: working, events: [event], namingRequests, officeTerm: term };
}

export function fillMandatoryOfficeVacancies(state: WorldStateV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string, causeEventId: string): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  let working = state; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  const activeInstitutions = new Map(working.institutions.filter((institution) => institution.foundedYear <= working.year && (institution.dissolvedYear === null || institution.dissolvedYear > working.year) && institution.institutionType !== "SENATE").map((institution) => [institution.institutionId, institution]));
  const vacancyIds = working.offices.filter((office) => {
    const institution = activeInstitutions.get(office.institutionId);
    if (!office.mandatory || !institution || currentOfficeTerm(working, office.officeId)) return false;
    if ((institution.institutionType === "CONCLAVE_PRE90" || institution.institutionType === "CONCLAVE_POST90") && office.titleKey.startsWith("CONCLAVE_CITY_") && office.jurisdictionSettlementId === null) return false;
    return true;
  }).map((office) => office.officeId).sort();
  vacancyIds.forEach((officeId, ordinal) => {
    const selected = selectHolderForAuthorizedOfficeVacancy(working, officeId, canonical, owner, variables, normalizedSeed, causeEventId, ordinal);
    working = selected.state; events.push(...selected.events); namingRequests.push(...selected.namingRequests);
  });
  return { state: working, events, namingRequests };
}

export function instantiateGovernmentInstitutions(state: WorldStateV5, stateId: string, government: GovernmentPrototypeV5, year: number): WorldStateV5 {
  const institutions: InstitutionV5[] = []; const offices: OfficeV5[] = [];
  government.requiredInstitutions.forEach((definition, institutionIndex) => {
    const institutionId = `INSTITUTION_${stateId}_${digest([government.governmentFormId, definition.institutionType, institutionIndex, year])}`;
    institutions.push({ institutionId, stateId, institutionType: definition.institutionType, foundedYear: year, dissolvedYear: null });
    definition.offices.forEach((office, officeIndex) => offices.push({ ...office, institutionId, officeId: `OFFICE_${stateId}_${digest([institutionId, office.titleKey, officeIndex])}` }));
  });
  return { ...state, institutions: [...state.institutions, ...institutions], offices: [...state.offices, ...offices] };
}

export interface SecessionCandidate { candidateId: string; parentStateId: string; settlementIds: string[]; dominantFaction: import("./types.js").WorldKey; population: bigint; unrest: Score1000; factionVector: FactionVector; mismatch: Score1000; politicalExclusion: Score1000; pressure: Score1000; }
export function deriveSecessionCandidates(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, politicalExclusion: Readonly<Record<string, Score1000>>): SecessionCandidate[] {
  const metrics = deriveMetrics(state, canonical, variables);
  const selected = state.settlements.filter((settlement) => settlement.unrest >= variables.rebellionThreshold && 1000 - factionCompatibility(metrics.settlementPopulationFactionVectors[settlement.settlementId]!, state.states.find((row) => row.stateId === settlement.stateId)!.factionAffinity) >= variables.secessionFactionMismatchThreshold && !Boolean(canonical.canonicalEvents.find((event) => event.eventType === "SECESSION_PROHIBITED" && event.payload.settlementId === settlement.settlementId)));
  const adjacency = new Set<string>();
  const regionEdges = new Set(canonical.regions.flatMap((region) => region.directedAdjacentRegionIds.flatMap((other) => [`${region.regionId}\0${other}`, `${other}\0${region.regionId}`])));
  for (const left of selected) for (const right of selected) if (left.settlementId !== right.settlementId && left.stateId === right.stateId && metrics.settlementDominantFactions[left.settlementId] === metrics.settlementDominantFactions[right.settlementId] && (left.regionId === right.regionId || regionEdges.has(`${left.regionId}\0${right.regionId}`))) adjacency.add(`${left.settlementId}\0${right.settlementId}`);
  const visited = new Set<string>(); const candidates: SecessionCandidate[] = [];
  for (const seed of [...selected].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) {
    if (visited.has(seed.settlementId)) continue;
    const component: typeof selected = []; const queue = [seed]; visited.add(seed.settlementId);
    while (queue.length) { const current = queue.shift()!; component.push(current); for (const other of selected) if (!visited.has(other.settlementId) && adjacency.has(`${current.settlementId}\0${other.settlementId}`)) { visited.add(other.settlementId); queue.push(other); } }
    const ids = component.map((row) => row.settlementId).sort(); const idSet = new Set(ids); const cells = state.cohorts.filter((cell) => idSet.has(cell.settlementId)); const population = cells.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n); const vector = populationFactionVector(cells, canonical); const parent = state.states.find((row) => row.stateId === seed.stateId)!;
    const unrest = population === 0n ? 0 : Number(divideRoundedAway(component.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(settlement.unrest), 0n), population));
    const exclusion = population === 0n ? 0 : Number(divideRoundedAway(component.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(politicalExclusion[settlement.settlementId] ?? 0), 0n), population));
    const mismatch = 1000 - factionCompatibility(vector, parent.factionAffinity);
    const pressure = weightedMean([unrest, 4000], [mismatch, 3500], [exclusion, 1500], [1000 - parent.legitimacy, 1000]);
    candidates.push({ candidateId: `SECESSION_${seed.stateId}_${digest(ids)}`, parentStateId: seed.stateId, settlementIds: ids, dominantFaction: dominantFaction(vector), population, unrest, factionVector: vector, mismatch, politicalExclusion: exclusion, pressure });
  }
  return candidates;
}

export function reviewSecession(state: WorldStateV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string, politicalExclusion: Readonly<Record<string, Score1000>>): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  const candidates = deriveSecessionCandidates(state, canonical, variables, politicalExclusion);
  const prior = new Map(state.timedConditions.filter((condition) => condition.type === "SECESSION_CANDIDATE").map((condition) => [condition.key, condition]));
  let working: WorldStateV5 = { ...state, timedConditions: state.timedConditions.filter((condition) => condition.type !== "SECESSION_CANDIDATE") };
  const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  for (const candidate of candidates) {
    const eligible = candidate.population >= variables.secessionMinimumPopulation && candidate.unrest >= variables.rebellionThreshold && candidate.mismatch >= variables.secessionFactionMismatchThreshold && candidate.pressure >= variables.secessionPressureThreshold;
    if (!eligible) continue;
    const count = (prior.get(candidate.candidateId)?.qualifyingReviewCount ?? 0) + 1;
    if (count < variables.secessionRequiredReviews) { working.timedConditions.push({ conditionId: `COND_${candidate.candidateId}`, type: "SECESSION_CANDIDATE", targetType: "STATE", targetId: candidate.parentStateId, magnitude: candidate.pressure, startYear: prior.get(candidate.candidateId)?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${state.worldKey}_${state.year}_SECESSION_CANDIDATE`, key: candidate.candidateId, qualifyingReviewCount: count }); continue; }
    const chance = thresholdChance(candidate.pressure, variables.secessionPressureThreshold, variables.secessionMaximumChanceBps);
    const identity = randomIdentity(normalizedSeed, "STATE_SECESSION_DECISION", candidate.candidateId, state.year, candidate.settlementIds.join("/"));
    const draw = keyedDrawBps(identity);
    if (draw >= chance) continue;
    const stateId = `STATE_${state.worldKey}_${digest([candidate.candidateId, state.year])}`;
    const government = supportedGovernment(candidate.factionVector, canonical.governments);
    const newState: StateV5 = { stateId, actualGovernment: government.governmentFormId, factionAffinity: candidate.factionVector, dominantFaction: candidate.dominantFaction, legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: state.year, routineTransitionCooldownUntilYear: state.year + variables.governmentTransitionCooldownYears };
    working = { ...working, states: [...working.states, newState] };
    working = applyCausalEffects(working, [{ type: "STATE_MEMBERSHIP", effectId: `EFFECT_${state.worldKey}_${state.year}_STATE_MEMBERSHIP_${stateId}`, sourceEventId: `EVT_${state.worldKey}_${state.year}_STATE_SECEDED_${stateId}`, settlementIds: candidate.settlementIds, stateId }]).state;
    working = instantiateGovernmentInstitutions(working, stateId, government, state.year);
    const filled = fillMandatoryOfficeVacancies(working, canonical, owner, variables, normalizedSeed, `EVT_${state.worldKey}_${state.year}_STATE_SECEDED_${stateId}`); working = filled.state; events.push(...filled.events); namingRequests.push(...filled.namingRequests);
    const legitimacy = targetLegitimacy(working, stateId, canonical, variables); working.states = working.states.map((row) => row.stateId === stateId ? { ...row, legitimacy } : row);
    events.unshift({ schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_STATE_SECEDED_${stateId}`, worldKey: state.worldKey, year: state.year, phase: "TRIGGERED", sequence: 0, eventType: "StateSeceded", entityType: "STATE", entityId: stateId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson(identity), mutations: candidate.settlementIds.map((settlementId) => ({ mutationType: "STATE_MEMBERSHIP", entityType: "SETTLEMENT", entityId: settlementId, before: candidate.parentStateId, after: stateId })), payload: { parentStateId: candidate.parentStateId, settlementIds: candidate.settlementIds, pressure: candidate.pressure, chanceBps: chance, drawBps: draw } });
    namingRequests.push({ requestId: `NAME_${stateId}`, entityType: "STATE", entityId: stateId, behavior: "BLOCKING", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "STATE_SECESSION", stateId, parentStateId: candidate.parentStateId, settlementIds: candidate.settlementIds, dominantFaction: candidate.dominantFaction, governmentFormId: government.governmentFormId } });
  }
  return { state: working, events, namingRequests };
}

export function updateLegitimacy(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): WorldStateV5 {
  const target = targetLegitimacy(state, stateId, canonical, variables, suppliedMetrics);
  return { ...state, states: state.states.map((row) => row.stateId === stateId ? { ...row, legitimacy: clamp(blend(row.legitimacy, target, variables.legitimacyInertiaBps), 0, 1000) } : row) };
}
