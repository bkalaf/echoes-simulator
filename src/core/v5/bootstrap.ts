import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, assertCanonicalV5Ready } from "./config.js";
import { dominantFaction } from "./faction.js";
import { allocateYearZeroCohorts } from "./population.js";
import { deriveMetrics } from "./derivations.js";
import { fillMandatoryOfficeVacancies, instantiateGovernmentInstitutions, targetLegitimacy } from "./politics.js";
import { reconcileBorderRelations } from "./conflict.js";
import { reconcileWorldRoutes } from "./routes.js";
import type { CausalEventV5, NamingRequestV5, SettlementV5, StateV5, WorldKey, WorldStateV5 } from "./types.js";

const EMPTY_SECTORS = { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } as const;

export interface BootstrapWorldInput {
  worldKey: WorldKey;
  canonical: CanonicalDataV5;
  ownerInputs: CausalOwnerInputsV1;
  variables: MechanicsVariablesV1;
  normalizedSeed: string;
  mode: "CANONICAL" | "DIAGNOSTIC";
}

export function bootstrapWorldV5(input: BootstrapWorldInput): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  if (input.mode === "CANONICAL") assertCanonicalV5Ready(input.ownerInputs, input.canonical);
  else if (!input.ownerInputs.diagnosticCandidatePoliciesAccepted && (!input.ownerInputs.classPolicy || !input.ownerInputs.terrainCompatibilityPolicy || !input.ownerInputs.conflictEpisodeProfile)) throw new Error("Diagnostic V5 requires explicit candidate-policy opt-in or approved policies");
  const initial = input.canonical.initialSettlements.filter((row) => row.worldKey === input.worldKey).sort((a, b) => a.settlementId.localeCompare(b.settlementId));
  const siteById = new Map(input.canonical.sites.map((site) => [site.siteId, site]));
  const settlements: SettlementV5[] = initial.map((row) => {
    const site = siteById.get(row.siteId); if (!site) throw new Error(`Unknown initial Site ${row.siteId}`);
    return { settlementId: row.settlementId, siteId: site.siteId, regionId: site.regionId, stateId: row.stateId, foundedYear: 0, unrest: 0, sectorStrengths: { ...EMPTY_SECTORS } };
  });
  const stateGovernments = new Map<string, string>();
  for (const row of initial) { const prior = stateGovernments.get(row.stateId); if (prior && prior !== row.governmentFormId) throw new Error(`Conflicting year-0 government for ${row.stateId}`); stateGovernments.set(row.stateId, row.governmentFormId); }
  const states: StateV5[] = [...stateGovernments].sort(([a], [b]) => a.localeCompare(b)).map(([stateId, actualGovernment]) => ({ stateId, actualGovernment, factionAffinity: { CONCORD: 334, SCHISM: 333, RUIN: 333 }, dominantFaction: "CONCORD", legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }));
  let state: WorldStateV5 = { schemaVersion: "echoes-world-state-v5", worldKey: input.worldKey, year: 0, cohorts: [], settlements, states, families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [] };
  state.cohorts = allocateYearZeroCohorts({ worldKey: input.worldKey, settlements, canonical: input.canonical, variables: input.variables });
  const initialMetrics = deriveMetrics(state, input.canonical, input.variables);
  state.states = state.states.map((row) => ({ ...row, factionAffinity: initialMetrics.statePopulationFactionVectors[row.stateId]!, dominantFaction: dominantFaction(initialMetrics.statePopulationFactionVectors[row.stateId]!) }));
  for (const politicalState of [...state.states]) {
    const government = input.canonical.governments.find((row) => row.governmentFormId === politicalState.actualGovernment);
    if (!government) throw new Error(`No government prototype ${politicalState.actualGovernment}`);
    state = instantiateGovernmentInstitutions(state, politicalState.stateId, government, 0);
  }
  const officeBootstrap = fillMandatoryOfficeVacancies(state, input.canonical, input.ownerInputs, input.variables, input.normalizedSeed, `EVT_${input.worldKey}_0_BOOTSTRAP`);
  state = officeBootstrap.state;
  const politicalMetrics = deriveMetrics(state, input.canonical, input.variables);
  state.states = state.states.map((row) => ({ ...row, legitimacy: targetLegitimacy(state, row.stateId, input.canonical, input.variables, politicalMetrics) }));
  const borders = reconcileBorderRelations(state, input.canonical); state = borders.state;
  const routes = reconcileWorldRoutes(state, input.canonical, input.ownerInputs, input.variables); state = routes.state;
  const population = state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
  if (population !== input.variables.initialPopulation) throw new Error(`Bootstrap population ${population} does not equal ${input.variables.initialPopulation}`);
  const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${input.worldKey}_0_BOOTSTRAP`, worldKey: input.worldKey, year: 0, phase: "SCHEDULED_CANONICAL", sequence: 0, eventType: "WorldBootstrapped", entityType: "WORLD", entityId: input.worldKey, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { population: population.toString(), settlements: state.settlements.length, states: state.states.length, families: state.families.length, politicalPeople: state.politicalPeople.length, organizations: state.organizations.length } };
  const poiNamingRequests: NamingRequestV5[] = input.canonical.physicalPois.map((poi) => ({
    requestId: `NAME_REQUEST_WORLD_POI_${input.worldKey}_${poi.poiId}_0`, entityType: "WORLD_POI", entityId: `WORLD_POI_${input.worldKey}_${poi.poiId}`,
    behavior: poi.nameStatus === "CANONICAL" ? "AUTOMATIC_REUSE" : "BATCHED", createdYear: 0, acceptedLabel: poi.nameStatus === "CANONICAL" ? poi.workingLabel : null,
    context: { physicalPoiId: poi.poiId, world: input.worldKey, poiType: poi.poiType, workingLabel: poi.workingLabel, canonicalNameStatus: poi.nameStatus, siteId: poi.siteId, regionId: poi.regionId, regionName: poi.regionName, coordinates: { latitude: poi.latitude, longitude: poi.longitude }, hostFeatureId: poi.hostFeatureId },
  }));
  return { state, events: [event, ...officeBootstrap.events, ...borders.events, ...routes.events], namingRequests: [...officeBootstrap.namingRequests, ...poiNamingRequests, ...routes.namingRequests] };
}
