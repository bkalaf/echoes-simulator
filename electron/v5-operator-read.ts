import { join } from "node:path";
import { loadBundledCanonicalV5 } from "../src/core/v5/canonical-adapter.js";
import type { CanonicalDataV5 } from "../src/core/v5/config.js";
import type { V5RunManifest } from "../src/core/v5/persistence.js";
import { buildReadModelV1 } from "../src/core/v5/read-model.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../src/core/v5/types.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";

export type V5OperatorViewDetail =
  | "Live Dashboard" | "Cities" | "World Browser" | "Settlement Detail" | "State Detail"
  | "People" | "Families" | "Conclave" | "Senate" | "Institutions" | "Resources / Industry"
  | "Conflict" | "Derogatory Groups" | "Atrocities" | "Enclaves" | "Parameters / Event Triggers" | "Timeline";

export function buildV5SettlementProjection(
  store: SimulatorStore,
  canonical: CanonicalDataV5,
  manifest: V5RunManifest,
  state: WorldStateV5,
): Record<string, unknown>[] {
  const read = buildReadModelV1(state, canonical, manifest.mechanicsVariables, store.loadV5Labels(manifest.runId, state.year));
  const settlements = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const politicalStates = new Map(state.states.map((politicalState) => [politicalState.stateId, politicalState]));
  const dominantBreedBySettlement = new Map<string, { breedId: string; population: bigint }>();
  for (const cell of state.cohorts) {
    const population = cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population;
    const prior = dominantBreedBySettlement.get(cell.settlementId);
    if (!prior || population > prior.population || (population === prior.population && cell.breedId.localeCompare(prior.breedId) < 0)) {
      dominantBreedBySettlement.set(cell.settlementId, { breedId: cell.breedId, population });
    }
  }
  return read.settlements.map((settlement) => {
    const durable = settlements.get(settlement.settlementId)!;
    const politicalState = politicalStates.get(settlement.stateId);
    return { settlementId: settlement.settlementId, siteId: durable.siteId, regionId: durable.regionId, stateId: settlement.stateId, name: settlement.label, population: settlement.population, cultureId: null, cultureState: "V5_DERIVED", dominantBreed: dominantBreedBySettlement.get(settlement.settlementId)?.breedId ?? "NONE", dominantFaction: settlement.dominantFaction, politicalForm: politicalState?.actualGovernment ?? null, economicForm: settlement.supportedEconomicForm, prosperity: settlement.prosperity, unrest: settlement.unrest, runtimeIssues: [] };
  });
}

function eventView(event: CausalEventV5): Record<string, unknown> {
  return { eventId: event.eventId, year: event.year, eventType: event.eventType, entityId: event.entityId, payload: event.payload };
}

export function buildV5RunView(input: {
  store: SimulatorStore;
  runId: string;
  world: WorldKey;
  year: number;
  resourceDirectory: string;
  detail?: V5OperatorViewDetail;
}): Record<string, unknown> {
  const { store, runId, world } = input;
  const run = store.getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const manifest = store.loadV5RunManifest(runId);
  if (!manifest) throw new Error(`Run ${runId} is not a V5 run`);
  const effectiveYear = Math.max(0, Math.min(Number.isFinite(input.year) ? Math.trunc(input.year) : 0, run.currentYear ?? 0));
  const checkpoint = store.loadLatestV5Checkpoint(runId, world, effectiveYear);
  const checkpointYear = checkpoint?.state.year ?? 0;
  const state = checkpoint?.state;
  const detail = input.detail ?? "Live Dashboard";
  const canonical = loadBundledCanonicalV5(join(input.resourceDirectory, "canonical"));
  const labels = store.loadV5Labels(runId, checkpointYear);
  const settlements = state ? buildV5SettlementProjection(store, canonical, manifest, state) : [];
  const result: Record<string, unknown> = {
    runId,
    world,
    requestedYear: input.year,
    effectiveYear: checkpointYear,
    settlements,
    events: [],
    history: [],
    checkpoints: store.listV5CheckpointMetadata(runId, world, effectiveYear),
    labels,
  };
  if (!state) return result;

  if (detail === "State Detail") Object.assign(result, { states: state.states, institutions: state.institutions ?? [], offices: state.offices ?? [] });
  if (detail === "People") {
    const personFactionById = Object.fromEntries((state.politicalPeople ?? []).map((person) => {
      const family = state.families.find((candidate) => candidate.familyId === person.familyId);
      if (family) return [person.personId, family.factionAffinity.CONCORD >= family.factionAffinity.SCHISM && family.factionAffinity.CONCORD >= family.factionAffinity.RUIN ? "CONCORD" : family.factionAffinity.SCHISM >= family.factionAffinity.RUIN ? "SCHISM" : "RUIN"];
      const breed = canonical.breeds.find((candidate) => candidate.breedId === person.breedId);
      const vector = breed?.factionObject ?? { CONCORD: 0, SCHISM: 0, RUIN: 0 };
      return [person.personId, vector.CONCORD >= vector.SCHISM && vector.CONCORD >= vector.RUIN ? "CONCORD" : vector.SCHISM >= vector.RUIN ? "SCHISM" : "RUIN"];
    }));
    Object.assign(result, { states: state.states, people: state.politicalPeople ?? [], institutions: state.institutions ?? [], offices: state.offices ?? [], officeTerms: state.officeTerms ?? [], ownershipStakes: state.ownershipStakes ?? [], personRelations: state.personRelations ?? [], personFactionById });
  }
  if (detail === "Families") {
    const familyHistory = store.listV5CheckpointMetadata(runId, world, effectiveYear).flatMap((metadata) => {
      const historical = store.loadLatestV5Checkpoint(runId, world, metadata.year)?.state;
      return (historical?.families ?? []).map((family) => ({ year: metadata.year, familyId: family.familyId, wealth: family.wealth, influence: family.influence, prestige: family.prestige, status: family.status }));
    });
    Object.assign(result, { people: state.politicalPeople ?? [], families: state.families ?? [], offices: state.offices ?? [], officeTerms: state.officeTerms ?? [], ownershipStakes: state.ownershipStakes ?? [], familyRelations: state.familyRelations ?? [], familyHistory });
  }
  if (detail === "Conclave" || detail === "Senate") {
    const officeEvents = store.listV5CausalEventsByTypes(runId, world, ["OfficeholderSelected"], effectiveYear);
    const officeTermSelectionEvidence = Object.fromEntries(officeEvents.flatMap((event) => {
      if (!event.payload || typeof event.payload !== "object") return [];
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload.officeTermId !== "string" || !payload.appliedSelectionRule || typeof payload.appliedSelectionRule !== "object") return [];
      return [[payload.officeTermId, { selectionEventId: event.eventId, appliedSelectionRule: payload.appliedSelectionRule, sourceGovernmentFormId: typeof payload.sourceGovernmentFormId === "string" ? payload.sourceGovernmentFormId : null, sourceGovernmentOfficeId: typeof payload.sourceGovernmentOfficeId === "string" ? payload.sourceGovernmentOfficeId : null, selectorType: payload.selectorType, selectorId: payload.selectorId, selectedPersonId: payload.selectedPersonId ?? payload.personId }]];
    }));
    const personFactionById = Object.fromEntries((state.politicalPeople ?? []).map((person) => {
      const family = state.families.find((candidate) => candidate.familyId === person.familyId);
      return [person.personId, family ? (family.factionAffinity.CONCORD >= family.factionAffinity.SCHISM && family.factionAffinity.CONCORD >= family.factionAffinity.RUIN ? "CONCORD" : family.factionAffinity.SCHISM >= family.factionAffinity.RUIN ? "SCHISM" : "RUIN") : world];
    }));
    Object.assign(result, { institutions: state.institutions ?? [], offices: state.offices ?? [], officeTerms: state.officeTerms ?? [], people: state.politicalPeople ?? [], families: state.families ?? [], personFactionById, officeTermSelectionEvidence });
  }
  if (detail === "Institutions") Object.assign(result, { institutions: state.institutions ?? [] });
  if (detail === "Resources / Industry") Object.assign(result, { organizations: state.organizations ?? [], resourceNodes: state.resourceNodes ?? [], worldResourceStates: state.worldResourceStates ?? [], industries: state.industries ?? [] });
  if (detail === "Conflict") Object.assign(result, { diplomaticRelations: state.diplomaticRelations ?? [], diplomaticAgreements: state.diplomaticAgreements ?? [], conflictEpisodes: state.conflictEpisodes ?? [], settlementControlTerms: state.settlementControlTerms ?? [], securityForces: state.securityForces ?? [] });
  if (detail === "Derogatory Groups") Object.assign(result, { populationSlices: state.populationSlices ?? [], derogatoryTargetSelections: state.derogatoryTargetSelections ?? [], derogatoryDecisionBatches: store.listV5DerogatoryDecisionBatches(runId) });
  if (detail === "Atrocities") Object.assign(result, { events: store.listV5CausalEventsByTypes(runId, world, ["AtrocityOccurrenceResolved"], effectiveYear).map(eventView), localAtrocityResponses: state.localAtrocityResponses ?? [], forcedDisplacements: state.forcedDisplacements ?? [] });
  if (detail === "Enclaves") Object.assign(result, { enclaves: state.enclaves ?? [] });
  if (detail === "Parameters / Event Triggers") Object.assign(result, { atrocityOccurrenceSlots: manifest.causalOwnerInputs.atrocityOccurrenceSlots ?? [], policyBlockers: store.listV5PolicyBlockers(runId) });
  if (detail === "Timeline") Object.assign(result, { events: store.listRecentV5CausalEvents(runId, world, effectiveYear, 40).map(eventView) });
  return result;
}
