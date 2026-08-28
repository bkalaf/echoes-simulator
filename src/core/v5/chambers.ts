import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { settlementPopulation } from "./derivations.js";
import { chamberSelectionAuthorityForOffice, currentOfficeTerm, selectHolderForAuthorizedOfficeVacancy } from "./politics.js";
import type { CausalEventV5, InstitutionV5, NamingRequestV5, OfficeV5, SelectionRuleV5, WorldStateV5 } from "./types.js";

const PLACEHOLDER_RULE: SelectionRuleV5 = {
  selectionMethod: "RULER_APPOINTMENT",
  scope: "STATE",
  requiresTrackedLineage: false,
  eligibleTiers: ["HIGH", "MID"],
  minimumFactionCompatibility: 0,
  stochasticTies: false,
  scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 },
};

const activeInstitution = (institution: InstitutionV5, year: number): boolean => institution.foundedYear <= year && (institution.dissolvedYear === null || institution.dissolvedYear > year);
const conclavePreInstitutionId = (world: string, stateId: string): string => `INSTITUTION_CONCLAVE_${world}_${stateId}_PRE90`;
const conclavePostInstitutionId = (world: string, stateId: string): string => `INSTITUTION_CONCLAVE_${world}_${stateId}_POST90`;
const senateInstitutionId = (world: string, stateId: string): string => `INSTITUTION_SENATE_${world}_${stateId}`;

function causalEvent(state: WorldStateV5, eventId: string, eventType: string, entityType: string, entityId: string, payload: Record<string, unknown>): CausalEventV5 {
  return { schemaVersion: "echoes-causal-event-v5", eventId, worldKey: state.worldKey, year: state.year, phase: "SCHEDULED_CANONICAL", sequence: 0, eventType, entityType, entityId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload };
}

function createChamberOffice(state: WorldStateV5, canonical: CanonicalDataV5, institutionId: string, officeId: string, titleKey: string, jurisdictionSettlementId: string | null, fixedTermYears?: number): OfficeV5 {
  const draft: OfficeV5 = { officeId, institutionId, jurisdictionSettlementId, titleKey, power: 0, mandatory: true, apex: false, termYears: fixedTermYears ?? null, selectionRule: PLACEHOLDER_RULE };
  const authority = chamberSelectionAuthorityForOffice(state, draft, canonical);
  if (!authority) throw new Error(`Chamber Office ${officeId} lacks selection authority`);
  return { ...draft, termYears: fixedTermYears ?? authority.termYears, selectionRule: authority.appliedSelectionRule };
}

export interface ChamberReconciliationResultV5 { state: WorldStateV5; events: CausalEventV5[]; }

export function reconcileChamberAuthorityV5(state: WorldStateV5, canonical: CanonicalDataV5): ChamberReconciliationResultV5 {
  let working = state;
  const events: CausalEventV5[] = [];
  for (const politicalState of [...working.states].sort((left, right) => left.stateId.localeCompare(right.stateId))) {
    const stateId = politicalState.stateId;
    if (working.year < 90) {
      const institutionId = conclavePreInstitutionId(working.worldKey, stateId);
      if (!working.institutions.some((institution) => institution.institutionId === institutionId)) {
        const institution: InstitutionV5 = { institutionId, stateId, institutionType: "CONCLAVE_PRE90", foundedYear: working.year, dissolvedYear: null };
        working = { ...working, institutions: [...working.institutions, institution] };
        events.push(causalEvent(working, `EVT_${working.worldKey}_${working.year}_CONCLAVE_PRE90_CREATED_${stateId}`, "ConclaveInstitutionCreated", "INSTITUTION", institutionId, { stateId, structure: "ONE_CITY_SEAT_PER_SETTLEMENT" }));
      }
      const settlements = working.settlements.filter((settlement) => settlement.stateId === stateId).sort((left, right) => left.settlementId.localeCompare(right.settlementId));
      const additions: OfficeV5[] = [];
      for (const settlement of settlements) {
        const officeId = `CONCLAVE_${working.worldKey}_${stateId}_${settlement.settlementId}`;
        if (working.offices.some((office) => office.officeId === officeId)) continue;
        additions.push(createChamberOffice(working, canonical, institutionId, officeId, `CONCLAVE_CITY_${settlement.settlementId}`, settlement.settlementId));
      }
      if (additions.length) {
        working = { ...working, offices: [...working.offices, ...additions] };
        events.push(causalEvent(working, `EVT_${working.worldKey}_${working.year}_CONCLAVE_PRE90_SEATS_${stateId}`, "ConclaveSeatsMaterialized", "INSTITUTION", institutionId, { stateId, officeIds: additions.map((office) => office.officeId), settlementIds: additions.map((office) => office.jurisdictionSettlementId) }));
      }
      continue;
    }

    const preInstitutionId = conclavePreInstitutionId(working.worldKey, stateId);
    const preInstitution = working.institutions.find((institution) => institution.institutionId === preInstitutionId);
    if (preInstitution && activeInstitution(preInstitution, working.year)) {
      const retiredOfficeIds = new Set(working.offices.filter((office) => office.institutionId === preInstitutionId).map((office) => office.officeId));
      working = {
        ...working,
        institutions: working.institutions.map((institution) => institution.institutionId === preInstitutionId ? { ...institution, dissolvedYear: working.year } : institution),
        officeTerms: working.officeTerms.map((term) => retiredOfficeIds.has(term.officeId) && term.startYear <= working.year && (term.endYear === null || term.endYear > working.year) ? { ...term, endYear: working.year, terminationReason: "INSTITUTION_REFORM" } : term),
      };
      events.push(causalEvent(working, `EVT_${working.worldKey}_${working.year}_CONCLAVE_REFORM_${stateId}`, "ConclaveReformed", "STATE", stateId, { preReformInstitutionId: preInstitutionId, retiredOfficeIds: [...retiredOfficeIds].sort(), structure: "TWO_CITY_ONE_UNINCORPORATED" }));
    }

    const institutionId = conclavePostInstitutionId(working.worldKey, stateId);
    if (!working.institutions.some((institution) => institution.institutionId === institutionId)) {
      working = { ...working, institutions: [...working.institutions, { institutionId, stateId, institutionType: "CONCLAVE_POST90", foundedYear: working.year, dissolvedYear: null }] };
    }
    const ranked = working.settlements.filter((settlement) => settlement.stateId === stateId).sort((left, right) => {
      const leftPopulation = settlementPopulation(working, left.settlementId); const rightPopulation = settlementPopulation(working, right.settlementId);
      return leftPopulation === rightPopulation ? left.siteId.localeCompare(right.siteId) : leftPopulation > rightPopulation ? -1 : 1;
    });
    const definitions = [
      { officeId: `CONCLAVE_${working.worldKey}_${stateId}_CITY_1`, titleKey: "CONCLAVE_CITY_1", jurisdictionSettlementId: ranked[0]?.settlementId ?? null },
      { officeId: `CONCLAVE_${working.worldKey}_${stateId}_CITY_2`, titleKey: "CONCLAVE_CITY_2", jurisdictionSettlementId: ranked[1]?.settlementId ?? null },
      { officeId: `CONCLAVE_${working.worldKey}_${stateId}_UNINCORPORATED`, titleKey: "CONCLAVE_UNINCORPORATED", jurisdictionSettlementId: null },
    ];
    const additions: OfficeV5[] = [];
    const jurisdictionChanges: { officeId: string; before: string | null; after: string | null }[] = [];
    for (const definition of definitions) {
      const existing = working.offices.find((office) => office.officeId === definition.officeId);
      if (!existing) additions.push(createChamberOffice(working, canonical, institutionId, definition.officeId, definition.titleKey, definition.jurisdictionSettlementId));
      else if (existing.jurisdictionSettlementId !== definition.jurisdictionSettlementId) jurisdictionChanges.push({ officeId: existing.officeId, before: existing.jurisdictionSettlementId, after: definition.jurisdictionSettlementId });
    }
    if (additions.length || jurisdictionChanges.length) {
      const changes = new Map(jurisdictionChanges.map((change) => [change.officeId, change.after]));
      working = { ...working, offices: [...working.offices.map((office) => changes.has(office.officeId) ? { ...office, jurisdictionSettlementId: changes.get(office.officeId)! } : office), ...additions] };
      events.push(causalEvent(working, `EVT_${working.worldKey}_${working.year}_CONCLAVE_POST90_AUTHORITY_${stateId}`, "ConclaveAuthorityReconciled", "INSTITUTION", institutionId, { stateId, addedOfficeIds: additions.map((office) => office.officeId), jurisdictionChanges }));
    }
  }

  if (working.year >= 275 && (working.year % 10 === 5 || working.year % 10 === 0)) {
    const seat = working.year % 10 === 5 ? "A" : "B";
    for (const politicalState of [...working.states].sort((left, right) => left.stateId.localeCompare(right.stateId))) {
      const stateId = politicalState.stateId; const institutionId = senateInstitutionId(working.worldKey, stateId);
      if (!working.institutions.some((institution) => institution.institutionId === institutionId)) working = { ...working, institutions: [...working.institutions, { institutionId, stateId, institutionType: "SENATE", foundedYear: working.year, dissolvedYear: null }] };
      const officeId = `SENATE_${working.worldKey}_${stateId}_${seat}`;
      if (working.offices.some((office) => office.officeId === officeId)) continue;
      const office = createChamberOffice(working, canonical, institutionId, officeId, `SENATE_SEAT_${seat}`, null, 10);
      working = { ...working, offices: [...working.offices, office] };
      events.push(causalEvent(working, `EVT_${working.worldKey}_${working.year}_SENATE_${seat}_AUTHORITY_${stateId}`, "SenateSeatMaterialized", "OFFICE", officeId, { stateId, seat, cycleSuffix: seat === "A" ? 5 : 0, termYears: 10 }));
    }
  }
  return { state: working, events };
}

export interface SenateSelectionResultV5 { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; }

export function selectAuthorizedSenateVacanciesV5(state: WorldStateV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string): SenateSelectionResultV5 {
  if (state.year < 275 || (state.year % 10 !== 5 && state.year % 10 !== 0)) return { state, events: [], namingRequests: [] };
  const seat = state.year % 10 === 5 ? "A" : "B";
  let working = state; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  const activeInstitutionIds = new Set(working.institutions.filter((institution) => institution.institutionType === "SENATE" && activeInstitution(institution, working.year)).map((institution) => institution.institutionId));
  const officeIds = working.offices.filter((office) => activeInstitutionIds.has(office.institutionId) && office.titleKey === `SENATE_SEAT_${seat}` && !currentOfficeTerm(working, office.officeId)).map((office) => office.officeId).sort();
  if (officeIds.length === 0) return { state, events, namingRequests };
  const cycleEventId = `EVT_${working.worldKey}_${working.year}_SENATE_SELECTION_CYCLE_${seat}`;
  events.push({ ...causalEvent(working, cycleEventId, "SenateSelectionCycleOpened", "WORLD", working.worldKey, { seat, cycleSuffix: seat === "A" ? 5 : 0, vacantOfficeIds: officeIds }), phase: "OFFICE_SELECTION" });
  officeIds.forEach((officeId, ordinal) => {
    const selected = selectHolderForAuthorizedOfficeVacancy(working, officeId, canonical, owner, variables, normalizedSeed, cycleEventId, ordinal);
    working = selected.state; events.push(...selected.events); namingRequests.push(...selected.namingRequests);
  });
  return { state: working, events, namingRequests };
}
