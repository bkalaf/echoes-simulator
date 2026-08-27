import type { CanonicalDataV5 } from "./config.js";
import type { BoundedDiagnosticObservationV5 } from "./diagnostics.js";
import type { DivergenceReportV1 } from "./read-model.js";
import type { CausalEventV5, FamilyV5, OrganizationType, WorldKey, WorldStateV5 } from "./types.js";
import { aggregateDivergenceTransitionsV5, type DivergenceTraceV5 } from "./divergence-diagnostics.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const metric = (values: readonly number[]) => ({ mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, median: values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]! : 0, max: values.length ? Math.max(...values) : 0 });

function familyReason(family: FamilyV5, state: WorldStateV5, events: readonly CausalEventV5[]): string {
  if (family.foundingYear === 0) return "CANONICAL_YEAR0";
  if (events.some((event) => event.eventType === "FamilyPromoted" && event.entityId === family.familyId)) return "EMERGENT_PROMOTION";
  const people = state.politicalPeople.filter((person) => person.familyId === family.familyId);
  const historicalOffice = state.officeTerms.some((term) => people.some((person) => person.personId === term.personId));
  if (historicalOffice) return state.offices.some((office) => office.selectionRule.requiresTrackedLineage && state.officeTerms.some((term) => term.officeId === office.officeId && people.some((person) => person.personId === term.personId))) ? "RULING_LINEAGE" : "OFFICE_OR_LINEAGE_REQUIRED";
  if (state.organizations.some((organization) => organization.founderControllerType === "FAMILY" && organization.founderControllerId === family.familyId) || state.ownershipStakes.some((stake) => stake.controllerType === "FAMILY" && stake.controllerId === family.familyId)) return "ORGANIZATION_FOUNDER_OR_CONTROLLER";
  return "OTHER_TYPED_CAUSE";
}

function familyDiagnostic(state: WorldStateV5, events: readonly CausalEventV5[], canonical: CanonicalDataV5) {
  const organizationById = new Map(state.organizations.map((organization) => [organization.organizationId, organization]));
  const relations = state.familyRelations.filter((relation) => relation.endYear === null);
  const buckets = (key: (family: FamilyV5) => string) => Object.fromEntries([...new Set(state.families.map(key))].sort().map((value) => [value, state.families.filter((family) => key(family) === value).length]));
  const hasCurrentOffice = (family: FamilyV5) => state.politicalPeople.some((person) => person.familyId === family.familyId && state.officeTerms.some((term) => term.personId === person.personId && term.endYear === null));
  const hasHistoricalOffice = (family: FamilyV5) => state.politicalPeople.some((person) => person.familyId === family.familyId && state.officeTerms.some((term) => term.personId === person.personId));
  const controls = (family: FamilyV5, type: OrganizationType) => state.ownershipStakes.some((stake) => stake.controllerType === "FAMILY" && stake.controllerId === family.familyId && stake.endYear === null && organizationById.get(stake.organizationId)?.type === type);
  const reasonCounts = Object.fromEntries(["CANONICAL_YEAR0","OFFICE_OR_LINEAGE_REQUIRED","RULING_LINEAGE","ORGANIZATION_FOUNDER_OR_CONTROLLER","EMERGENT_PROMOTION","OTHER_TYPED_CAUSE"].map((reason) => [reason, state.families.filter((family) => familyReason(family, state, events) === reason).length]));
  return {
    familiesEverCreated: state.families.length, active: state.families.filter((family) => family.status === "ACTIVE").length, extinct: state.families.filter((family) => family.status === "EXTINCT").length, creationReasons: reasonCounts,
    withCurrentOfficeHolders: state.families.filter(hasCurrentOffice).length, withHistoricalOfficeHolders: state.families.filter(hasHistoricalOffice).length,
    withCorporationControl: state.families.filter((family) => controls(family, "CORPORATION")).length, withCrimeControl: state.families.filter((family) => controls(family, "CRIME_ORGANIZATION")).length,
    withBothCorporationAndCrime: state.families.filter((family) => controls(family, "CORPORATION") && controls(family, "CRIME_ORGANIZATION")).length,
    withNoCurrentOfficeOrOrganizationControl: state.families.filter((family) => !hasCurrentOffice(family) && !controls(family, "CORPORATION") && !controls(family, "CRIME_ORGANIZATION")).length,
    familyRelations: { alliances: relations.filter((relation) => relation.relationType === "ALLIANCE").length, rivalries: relations.filter((relation) => relation.relationType === "RIVALRY").length },
    politicalPeopleLinkedToFamilies: state.politicalPeople.filter((person) => person.familyId !== null).length, politicalPeopleWithoutFamily: state.politicalPeople.filter((person) => person.familyId === null).length,
    byContinent: buckets((family) => { const settlement = state.settlements.find((item) => item.settlementId === family.homeSettlementId); const site = canonical.sites.find((item) => item.siteId === settlement?.siteId); return site?.continent ?? "CONTINENT UNRESOLVED"; }),
    byState: buckets((family) => state.settlements.find((settlement) => settlement.settlementId === family.homeSettlementId)?.stateId ?? "STATE UNRESOLVED"), byFounderBreed: buckets((family) => family.founderBreedId), byFoundingCentury: buckets((family) => `${Math.floor(family.foundingYear / 100) * 100}-${Math.floor(family.foundingYear / 100) * 100 + 99}`),
  };
}

function summaryFor(summaries: readonly BoundedDiagnosticObservationV5[], world: WorldKey, domain: BoundedDiagnosticObservationV5["domain"]) { return summaries.find((summary) => summary.worldKey === world && summary.domain === domain) ?? null; }

export function buildHistoricalDiagnosticsV5(input: { canonical: CanonicalDataV5; states: Record<WorldKey, WorldStateV5>; events: Record<WorldKey, CausalEventV5[]>; summaries: readonly BoundedDiagnosticObservationV5[]; divergence: DivergenceReportV1; divergenceTraces?: readonly DivergenceTraceV5[] }) {
  const material = (predicate: (item: DivergenceReportV1["items"][number]) => boolean) => input.divergence.items.filter((item) => item.classification === "MATERIAL_DIVERGENCE" && predicate(item)).length;
  const divergenceDomains = {
    "Settlement / founding": { materialComparisons: material((item) => item.category === "SETTLEMENT_OWNERSHIP"), coverage: "REGISTERED_SETTLEMENT_PHYSICAL_IDENTITIES" },
    "State membership": { materialComparisons: material((item) => item.category === "SETTLEMENT_OWNERSHIP"), coverage: "STATE_MEMBERSHIP_WITHIN_SETTLEMENT_COMPARISONS" },
    government: { materialComparisons: material((item) => item.category === "GOVERNMENT_FACTION_LEGITIMACY"), coverage: "COMBINED_STATE_COMPARISON" },
    "State faction": { materialComparisons: material((item) => item.category === "GOVERNMENT_FACTION_LEGITIMACY"), coverage: "COMBINED_STATE_COMPARISON" },
    Families: { materialComparisons: material((item) => item.category === "FAMILY_POWER"), coverage: "REGISTERED_FAMILY_LINEAGE_COMPARISONS" },
    officeholders: { materialComparisons: 0, coverage: "NOT_PRESENT_IN_CURRENT_REGISTERED_COMPARISON_SET" },
    "wealth / social tiers": { materialComparisons: material((item) => item.category === "WEALTH_INDUSTRY_UNREST"), coverage: "COMBINED_SETTLEMENT_ECONOMY_COMPARISON" },
    industry: { materialComparisons: material((item) => item.category === "WEALTH_INDUSTRY_UNREST"), coverage: "COMBINED_SETTLEMENT_ECONOMY_COMPARISON" },
    Organizations: { materialComparisons: 0, coverage: "NOT_PRESENT_IN_CURRENT_REGISTERED_COMPARISON_SET" },
    migration: { materialComparisons: material((item) => item.category === "MIGRATION"), coverage: "REGISTERED_SETTLEMENT_MIGRATION_COMPARISONS" },
    institutions: { materialComparisons: material((item) => item.category === "INSTITUTIONS"), coverage: "REGISTERED_STATE_INSTITUTION_COMPARISONS" },
    unrest: { materialComparisons: material((item) => item.category === "WEALTH_INDUSTRY_UNREST"), coverage: "COMBINED_SETTLEMENT_ECONOMY_COMPARISON" },
    secession: { materialComparisons: material((item) => item.category === "SETTLEMENT_OWNERSHIP" || item.category === "GOVERNMENT_FACTION_LEGITIMACY"), coverage: "ATTRIBUTED_THROUGH_CAUSE_EVENTS" },
    conflict: { materialComparisons: material((item) => item.category === "CONFLICT"), coverage: "REGISTERED_BORDER_RELATION_COMPARISONS" },
    "other registered domain": { materialComparisons: material((item) => item.category === "NAMING"), coverage: "LEGACY_REGISTERED_NAMING_COMPARISON; NON_CAUSAL" },
  };
  const traces = input.divergenceTraces ?? [];
  return {
    schemaVersion: "echoes-v5-historical-diagnostics-v1",
    boundedPersistence: { maximumHistogramBins: 1001, summaryRowUpperBound: 12, perInnerLoopRowsPersisted: 0 },
    families: Object.fromEntries(WORLDS.map((world) => [world, { ...familyDiagnostic(input.states[world], input.events[world], input.canonical), formationFunnel: summaryFor(input.summaries, world, "FAMILY_FORMATION") ?? "NOT_AVAILABLE_FOR_LEGACY_FIXTURE" }])),
    organizations: Object.fromEntries(WORLDS.map((world) => [world, Object.fromEntries((["CORPORATION","CRIME_ORGANIZATION"] as const).map((type) => { const organizations = input.states[world].organizations.filter((organization) => organization.type === type); const active = organizations.filter((organization) => organization.status !== "DISSOLVED"); const controls = active.map((organization) => input.states[world].ownershipStakes.filter((stake) => stake.organizationId === organization.organizationId && stake.endYear === null).reduce((maximum, stake) => Math.max(maximum, stake.controlShareBps), 0)); return [type, { funnel: summaryFor(input.summaries, world, type === "CORPORATION" ? "ORGANIZATION_CORPORATION" : "ORGANIZATION_CRIME") ?? "NOT_AVAILABLE_FOR_LEGACY_FIXTURE", created: organizations.length, dissolved: organizations.filter((organization) => organization.status === "DISSOLVED").length, surviving: active.length, wealth: metric(active.map((organization) => organization.wealth)), influence: metric(active.map((organization) => organization.influence)), controlConcentration: metric(controls) }]; }))])),
    founding: Object.fromEntries(WORLDS.map((world) => [world, { funnel: summaryFor(input.summaries, world, "FOUNDING") ?? "NOT_AVAILABLE_FOR_LEGACY_FIXTURE", settlementFoundedEvents: input.events[world].filter((event) => event.eventType === "SettlementFounded").length, finalSettlementCount: input.states[world].settlements.length, djtFixtureNotice: "R10/DJT year-500 is a diagnostic fixture observation; DJT-year canonical authority remains unresolved." }])),
    divergence: { totalsBps: input.divergence.totalsBps, totalRegisteredComparisons: input.divergence.items.length, contributions: Object.fromEntries([...new Set(input.divergence.items.map((item) => item.category))].sort().map((category) => [category, input.divergence.items.filter((item) => item.category === category && item.classification === "MATERIAL_DIVERGENCE").length])), domainContributions: divergenceDomains, transitions: traces.length ? aggregateDivergenceTransitionsV5(traces) : "NOT_AVAILABLE_FOR_LEGACY_FIXTURE; prospective runs persist one bounded trace per registered comparison identity", materialDivergenceTraces: traces.filter((trace) => trace.currentClassification === "MATERIAL_DIVERGENCE") },
  };
}
