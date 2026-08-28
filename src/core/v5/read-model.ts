import type { CanonicalDataV5, DiagnosticConfigV1, MechanicsVariablesV1 } from "./config.js";
import { deriveMetrics, settlementPopulation, statePopulation, worldPopulation } from "./derivations.js";
import { supportedGovernment } from "./politics.js";
import { officeTermActiveAt } from "./office-term.js";
import type { CausalEventV5, ReadModelV1, WorldKey, WorldStateV5 } from "./types.js";

export function buildReadModelV1(state: WorldStateV5, canonical: CanonicalDataV5, mechanics: MechanicsVariablesV1, labels: Readonly<Record<string, string>> = {}): ReadModelV1 {
  const metrics = deriveMetrics(state, canonical, mechanics);
  return {
    schemaVersion: "echoes-read-model-v1", worldKey: state.worldKey, year: state.year, totalPopulation: worldPopulation(state).toString(),
    settlements: state.settlements.map((settlement) => {
      const population = settlementPopulation(state, settlement.settlementId);
      const economic = metrics.supportedEconomicForms[settlement.settlementId];
      if (population > 0n && !economic) throw new Error(`Occupied Settlement ${state.worldKey}/${state.year}/${settlement.settlementId} has no SupportedEconomicForm`);
      return { settlementId: settlement.settlementId, label: labels[settlement.settlementId] ?? canonical.canonicalLabels[settlement.siteId] ?? settlement.settlementId, stateId: settlement.stateId, population: population.toString(), dominantFaction: metrics.settlementDominantFactions[settlement.settlementId]!, prosperity: metrics.settlementProsperity[settlement.settlementId]!, unrest: settlement.unrest, supportedEconomicForm: economic!.economicForm };
    }).sort((a, b) => a.settlementId.localeCompare(b.settlementId)),
    states: state.states.map((politicalState) => ({ stateId: politicalState.stateId, label: labels[politicalState.stateId] ?? canonical.canonicalLabels[politicalState.stateId] ?? politicalState.stateId, population: statePopulation(state, politicalState.stateId).toString(), actualGovernment: politicalState.actualGovernment, supportedGovernment: statePopulation(state, politicalState.stateId) === 0n ? null : supportedGovernment(metrics.statePopulationFactionVectors[politicalState.stateId]!, canonical.governments).governmentFormId, dominantFaction: politicalState.dominantFaction, legitimacy: politicalState.legitimacy })).sort((a, b) => a.stateId.localeCompare(b.stateId)),
  };
}

export interface V4CompatibleWorldExport {
  world: WorldKey;
  year: number;
  cohorts: { cohortId: string; worldKey: WorldKey; settlementId: string; breedId: string; population: string; wealthScore: number; tiers: Record<string, { population: string; prosperity: number }> }[];
  settlements: { settlementId: string; siteId: string; regionId: string; stateId: string; foundedYear: number; population: string; dominantFaction: WorldKey }[];
}

export function adaptV5ToV4ReadExport(state: WorldStateV5, canonical: CanonicalDataV5, mechanics: MechanicsVariablesV1): V4CompatibleWorldExport {
  const metrics = deriveMetrics(state, canonical, mechanics);
  return { world: state.worldKey, year: state.year, cohorts: state.cohorts.map((cell) => ({ cohortId: `V5CELL_${state.worldKey}_${cell.settlementId}_${cell.breedId}`, worldKey: state.worldKey, settlementId: cell.settlementId, breedId: cell.breedId, population: (cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population).toString(), wealthScore: metrics.settlementProsperity[cell.settlementId]!, tiers: Object.fromEntries(Object.entries(cell.tiers).map(([tier, value]) => [tier, { population: value.population.toString(), prosperity: value.prosperity }])) })), settlements: state.settlements.map((settlement) => ({ settlementId: settlement.settlementId, siteId: settlement.siteId, regionId: settlement.regionId, stateId: settlement.stateId, foundedYear: settlement.foundedYear, population: settlementPopulation(state, settlement.settlementId).toString(), dominantFaction: metrics.settlementDominantFactions[settlement.settlementId]! })) };
}

export type DivergenceClass = "IDENTICAL" | "MINOR_VARIANT" | "MATERIAL_DIVERGENCE";
export interface DivergenceItem { comparisonId: string; category: string; classification: DivergenceClass; worlds: Partial<Record<WorldKey, unknown>>; causeEventIds: string[]; }
export interface DivergenceReportV1 { items: DivergenceItem[]; totalsBps: Record<DivergenceClass, number>; targetBps: DiagnosticConfigV1["divergenceTargetsBps"]; organizationDiagnostics: Record<WorldKey, { corporationsFormed: number; corporationsSurviving: number; corporateWealth: number; crimeFormed: number; crimeSurviving: number; crimeWealth: number; familyControlConcentration: number }>; }

function classify(values: readonly unknown[], similarity?: (left: unknown, right: unknown) => boolean): DivergenceClass {
  const encoded = values.map((value) => JSON.stringify(value)); if (encoded.every((value) => value === encoded[0])) return "IDENTICAL";
  if (similarity && values.slice(1).every((value) => similarity(values[0], value))) return "MINOR_VARIANT";
  return "MATERIAL_DIVERGENCE";
}

function normalizeWorldIdentity(value: string | null): string | null { return value?.replace(/CONCORD|SCHISM|RUIN/g, "WORLD") ?? null; }
function causalEventsFor(events: readonly CausalEventV5[], eventTypes: ReadonlySet<string>, predicate: (event: CausalEventV5) => boolean): string[] { return events.filter((event) => eventTypes.has(event.eventType) && predicate(event)).map((event) => event.eventId); }

export function buildDivergenceReport(
  states: Readonly<Record<WorldKey, WorldStateV5>>,
  events: Readonly<Record<WorldKey, readonly CausalEventV5[]>>,
  diagnostic: DiagnosticConfigV1,
  context?: { canonical: CanonicalDataV5; mechanics: MechanicsVariablesV1; labels?: Partial<Record<WorldKey, Readonly<Record<string, string>>>> },
): DivergenceReportV1 {
  const worlds: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"]; const items: DivergenceItem[] = [];
  const metrics = context ? Object.fromEntries(worlds.map((world) => [world, deriveMetrics(states[world], context.canonical, context.mechanics)])) as Record<WorldKey, ReturnType<typeof deriveMetrics>> : null;
  const settlementSiteIds = [...new Set(worlds.flatMap((world) => states[world].settlements.map((settlement) => settlement.siteId)))].sort();
  for (const siteId of settlementSiteIds) {
    const settlements = worlds.map((world) => states[world].settlements.find((settlement) => settlement.siteId === siteId) ?? null);
    const ownershipValues = settlements.map((settlement) => normalizeWorldIdentity(settlement?.stateId ?? null));
    items.push({ comparisonId: `SETTLEMENT_OWNERSHIP/${siteId}`, category: "SETTLEMENT_OWNERSHIP", classification: classify(ownershipValues), worlds: Object.fromEntries(worlds.map((world, index) => [world, ownershipValues[index]])), causeEventIds: worlds.flatMap((world) => causalEventsFor(events[world], new Set(["SettlementFounded", "StateSeceded", "StateMembershipChanged"]), (event) => event.payload.siteId === siteId || (Array.isArray(event.payload.settlementIds) && event.payload.settlementIds.includes(settlements[worlds.indexOf(world)]?.settlementId)))).sort() });
    const nameValues = worlds.map((world, index) => settlements[index] ? context?.labels?.[world]?.[settlements[index]!.settlementId] ?? context?.canonical.canonicalLabels[siteId] ?? null : null);
    items.push({ comparisonId: `NAME/SETTLEMENT/${siteId}`, category: "NAMING", classification: classify(nameValues), worlds: Object.fromEntries(worlds.map((world, index) => [world, nameValues[index]])), causeEventIds: [] });
    const economicValues = worlds.map((world, index) => {
      const settlement = settlements[index]; if (!settlement) return null;
      return { prosperityBand: metrics ? Math.trunc(metrics[world].settlementProsperity[settlement.settlementId]! / 100) : null, unrestBand: Math.trunc(settlement.unrest / 100), industryBands: Object.fromEntries(Object.entries(settlement.sectorStrengths).map(([sector, strength]) => [sector, Math.trunc(strength / 100)])) };
    });
    items.push({ comparisonId: `SETTLEMENT_ECONOMY/${siteId}`, category: "WEALTH_INDUSTRY_UNREST", classification: classify(economicValues, (left, right) => Boolean(left && right && (left as { prosperityBand: number }).prosperityBand === (right as { prosperityBand: number }).prosperityBand)), worlds: Object.fromEntries(worlds.map((world, index) => [world, economicValues[index]])), causeEventIds: worlds.flatMap((world) => causalEventsFor(events[world], new Set(["WarEpisode", "BorderSkirmish", "CanonicalShock"]), (event) => event.payload.affectedSettlementId === settlements[worlds.indexOf(world)]?.settlementId || (Array.isArray(event.payload.effectIds) && event.payload.effectIds.some((id) => typeof id === "string" && id.includes(settlements[worlds.indexOf(world)]?.settlementId ?? "\0"))))).sort() });
    const migrationValues = worlds.map((world, index) => { const settlementId = settlements[index]?.settlementId; if (!settlementId) return null; let inbound = 0n; let outbound = 0n; for (const event of events[world].filter((event) => event.eventType === "MigrationTransfer" || event.eventType === "FoundingTransfer")) { const population = typeof event.payload.population === "string" ? BigInt(event.payload.population) : 0n; if (event.payload.destinationSettlementId === settlementId) inbound += population; if (event.payload.originSettlementId === settlementId) outbound += population; } return { inbound: inbound.toString(), outbound: outbound.toString(), net: (inbound - outbound).toString() }; });
    items.push({ comparisonId: `MIGRATION/${siteId}`, category: "MIGRATION", classification: classify(migrationValues), worlds: Object.fromEntries(worlds.map((world, index) => [world, migrationValues[index]])), causeEventIds: worlds.flatMap((world, index) => causalEventsFor(events[world], new Set(["MigrationTransfer", "FoundingTransfer"]), (event) => event.payload.destinationSettlementId === settlements[index]?.settlementId || event.payload.originSettlementId === settlements[index]?.settlementId)).sort() });
  }
  const stateKeys = [...new Set(worlds.flatMap((world) => states[world].states.map((politicalState) => states[world].settlements.filter((settlement) => settlement.stateId === politicalState.stateId).map((settlement) => settlement.siteId).sort().join("+"))))].sort();
  for (const stateKey of stateKeys) {
    const rows = worlds.map((world) => states[world].states.find((politicalState) => states[world].settlements.filter((settlement) => settlement.stateId === politicalState.stateId).map((settlement) => settlement.siteId).sort().join("+") === stateKey) ?? null);
    const values = rows.map((row) => row ? { government: row.actualGovernment, faction: row.dominantFaction, legitimacyBand: Math.trunc(row.legitimacy / 100) } : null);
    items.push({ comparisonId: `STATE/${stateKey}`, category: "GOVERNMENT_FACTION_LEGITIMACY", classification: classify(values, (a, b) => Boolean(a && b && (a as { government: string }).government === (b as { government: string }).government)), worlds: Object.fromEntries(worlds.map((world, valueIndex) => [world, values[valueIndex]])), causeEventIds: worlds.flatMap((world, index) => rows[index] ? causalEventsFor(events[world], new Set(["GovernmentTransition", "StateFactionRealigned", "StateSeceded"]), (event) => event.entityId === rows[index]!.stateId) : []).sort() });
    const institutionValues = worlds.map((world, index) => { const row = rows[index]; if (!row) return null; const institutions = states[world].institutions.filter((institution) => institution.stateId === row.stateId && institution.foundedYear <= states[world].year && (institution.dissolvedYear === null || institution.dissolvedYear > states[world].year)); const institutionIds = new Set(institutions.map((institution) => institution.institutionId)); const offices = states[world].offices.filter((office) => institutionIds.has(office.institutionId)); const activeTerms = states[world].officeTerms.filter((term) => officeTermActiveAt(term, states[world].year) && offices.some((office) => office.officeId === term.officeId)); return { types: institutions.map((institution) => institution.institutionType).sort(), officeCount: offices.length, filledCount: activeTerms.length }; });
    items.push({ comparisonId: `INSTITUTIONS/${stateKey}`, category: "INSTITUTIONS", classification: classify(institutionValues), worlds: Object.fromEntries(worlds.map((world, index) => [world, institutionValues[index]])), causeEventIds: [] });
  }
  const familyKeys = [...new Set(worlds.flatMap((world) => states[world].families.map((family) => `${states[world].settlements.find((settlement) => settlement.settlementId === family.homeSettlementId)?.siteId ?? "UNKNOWN"}/${family.founderBreedId}/${family.foundingYear}`)))].sort();
  for (const familyKey of familyKeys) { const rows = worlds.map((world) => states[world].families.filter((family) => `${states[world].settlements.find((settlement) => settlement.settlementId === family.homeSettlementId)?.siteId ?? "UNKNOWN"}/${family.founderBreedId}/${family.foundingYear}` === familyKey).sort((a, b) => a.familyId.localeCompare(b.familyId))[0] ?? null); const values = rows.map((row) => row ? { wealthBand: Math.trunc(row.wealth / 100), influenceBand: Math.trunc(row.influence / 100), prestigeBand: Math.trunc(row.prestige / 100), faction: row.factionAffinity, status: row.status } : null); items.push({ comparisonId: `FAMILY/${familyKey}`, category: "FAMILY_POWER", classification: classify(values), worlds: Object.fromEntries(worlds.map((world, index) => [world, values[index]])), causeEventIds: worlds.flatMap((world, index) => rows[index] ? causalEventsFor(events[world], new Set(["FamilyPromoted", "FamilyAllianceCreated", "FamilyRivalryCreated"]), (event) => event.entityId === rows[index]!.familyId || event.payload.familyAId === rows[index]!.familyId || event.payload.familyBId === rows[index]!.familyId) : []).sort() }); }
  const conflictKeys = [...new Set(worlds.flatMap((world) => states[world].borderRelations.map((border) => [normalizeWorldIdentity(border.stateAId), normalizeWorldIdentity(border.stateBId)].sort().join("/"))))].sort();
  for (const conflictKey of conflictKeys) { const rows = worlds.map((world) => states[world].borderRelations.find((border) => [normalizeWorldIdentity(border.stateAId), normalizeWorldIdentity(border.stateBId)].sort().join("/") === conflictKey) ?? null); const values = rows.map((row) => row ? { status: row.status, tensionBand: Math.trunc(row.tension / 100), grievanceBand: Math.trunc(row.grievance / 100), exhaustionBand: Math.trunc(row.exhaustion / 100), active: row.activeBorder } : null); items.push({ comparisonId: `CONFLICT/${conflictKey}`, category: "CONFLICT", classification: classify(values), worlds: Object.fromEntries(worlds.map((world, index) => [world, values[index]])), causeEventIds: worlds.flatMap((world, index) => rows[index] ? causalEventsFor(events[world], new Set(["WarDeclared", "WarEpisode", "PeaceDeclared", "BorderSkirmish"]), (event) => event.entityId === rows[index]!.borderRelationId || event.payload.conflictId === rows[index]!.borderRelationId) : []).sort() }); }
  const counts: Record<DivergenceClass, number> = { IDENTICAL: 0, MINOR_VARIANT: 0, MATERIAL_DIVERGENCE: 0 }; items.forEach((item) => { counts[item.classification] += 1; }); const denominator = items.length || 1;
  const totalsBps = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, Math.round(count * 10_000 / denominator)])) as Record<DivergenceClass, number>;
  const organizationDiagnostics = Object.fromEntries(worlds.map((world) => { const organizations = states[world].organizations; const control = states[world].ownershipStakes.filter((stake) => stake.endYear === null && stake.controllerType === "FAMILY").reduce((sum, stake) => sum + stake.controlShareBps, 0); return [world, { corporationsFormed: organizations.filter((organization) => organization.type === "CORPORATION").length, corporationsSurviving: organizations.filter((organization) => organization.type === "CORPORATION" && organization.status !== "DISSOLVED").length, corporateWealth: organizations.filter((organization) => organization.type === "CORPORATION" && organization.status !== "DISSOLVED").reduce((sum, organization) => sum + organization.wealth, 0), crimeFormed: organizations.filter((organization) => organization.type === "CRIME_ORGANIZATION").length, crimeSurviving: organizations.filter((organization) => organization.type === "CRIME_ORGANIZATION" && organization.status !== "DISSOLVED").length, crimeWealth: organizations.filter((organization) => organization.type === "CRIME_ORGANIZATION" && organization.status !== "DISSOLVED").reduce((sum, organization) => sum + organization.wealth, 0), familyControlConcentration: control }]; })) as DivergenceReportV1["organizationDiagnostics"];
  return { items, totalsBps, targetBps: diagnostic.divergenceTargetsBps, organizationDiagnostics };
}
