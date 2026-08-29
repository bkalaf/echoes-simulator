import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1, SiteAuthorityV5 } from "./config.js";
import { divideRoundedAway, factionCompatibility, largestRemainder, normalizeFactionVector, normalizedVectorWeightedMean, populationWeightedScore, ratioScore, weightedMean } from "./fixed-point.js";
import { breedFactionVector, dominantFaction } from "./faction.js";
import { officeTermActiveAt } from "./office-term.js";
import type { ClassDistribution, CohortCell, DerivedMetricsV1, FactionVector, Score1000, SettlementV5, SocialClass, SocialTier, WorldStateV5 } from "./types.js";

export function cellPopulation(cell: CohortCell): bigint {
  return cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population;
}

export function settlementPopulation(state: WorldStateV5, settlementId: string): bigint {
  return state.cohorts.filter((cell) => cell.settlementId === settlementId).reduce((sum, cell) => sum + cellPopulation(cell), 0n);
}

export function statePopulation(state: WorldStateV5, stateId: string): bigint {
  const memberIds = new Set(state.settlements.filter((settlement) => settlement.stateId === stateId).map((settlement) => settlement.settlementId));
  return state.cohorts.filter((cell) => memberIds.has(cell.settlementId)).reduce((sum, cell) => sum + cellPopulation(cell), 0n);
}

export function worldPopulation(state: WorldStateV5): bigint { return state.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n); }

export function populationFactionVector(cells: readonly CohortCell[], canonical: CanonicalDataV5, existingBreedById?: ReadonlyMap<string, CanonicalDataV5["breeds"][number]>): FactionVector {
  const breedById = existingBreedById ?? new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const totals = { CONCORD: 0n, SCHISM: 0n, RUIN: 0n };
  let population = 0n;
  for (const cell of cells) {
    const breed = breedById.get(cell.breedId);
    if (!breed) throw new Error(`Unknown Breed ${cell.breedId}`);
    const count = cellPopulation(cell);
    const vector = breedFactionVector(breed);
    population += count;
    totals.CONCORD += count * BigInt(vector.CONCORD);
    totals.SCHISM += count * BigInt(vector.SCHISM);
    totals.RUIN += count * BigInt(vector.RUIN);
  }
  if (population === 0n) return { CONCORD: 334, SCHISM: 333, RUIN: 333 };
  return normalizeFactionVector({ CONCORD: Number(divideRoundedAway(totals.CONCORD, population)), SCHISM: Number(divideRoundedAway(totals.SCHISM, population)), RUIN: Number(divideRoundedAway(totals.RUIN, population)) });
}

export function settlementDominantFactionMap(state: WorldStateV5, canonical: CanonicalDataV5): Record<string, import("./types.js").WorldKey> {
  const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const cellsBySettlement = new Map<string, CohortCell[]>();
  for (const cell of state.cohorts) {
    const rows = cellsBySettlement.get(cell.settlementId);
    if (rows) rows.push(cell); else cellsBySettlement.set(cell.settlementId, [cell]);
  }
  return Object.fromEntries(state.settlements.map((settlement) => {
    const vector = populationFactionVector(cellsBySettlement.get(settlement.settlementId) ?? [], canonical, breedById);
    return [settlement.settlementId, dominantFaction(vector)];
  }));
}

export function settlementProsperity(cells: readonly CohortCell[]): Score1000 {
  return populationWeightedScore(cells.flatMap((cell) => (Object.keys(cell.tiers) as SocialTier[]).map((tier) => ({ population: cell.tiers[tier].population, score: cell.tiers[tier].prosperity }))));
}

export function settlementHighProsperity(cells: readonly CohortCell[]): Score1000 {
  return populationWeightedScore(cells.map((cell) => ({ population: cell.tiers.HIGH.population, score: cell.tiers.HIGH.prosperity })));
}

export function industryMean(settlement: SettlementV5): Score1000 {
  const values = Object.values(settlement.sectorStrengths);
  return Number(divideRoundedAway(values.reduce((sum, value) => sum + BigInt(value), 0n), BigInt(values.length)));
}

export function industryBreadth(settlement: SettlementV5): Score1000 {
  const values = Object.values(settlement.sectorStrengths);
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total === 0n) return 0;
  const hhiNumerator = values.reduce((sum, value) => sum + BigInt(value) * BigInt(value), 0n);
  const hhi = ratioScore(hhiNumerator, total * total, 1000);
  return Math.max(0, 1000 - hhi);
}

export function localFamilyWealth(state: WorldStateV5, settlementId: string): Score1000 {
  const rows = state.families.filter((family) => family.status === "ACTIVE" && family.homeSettlementId === settlementId);
  const denominator = rows.reduce((sum, family) => sum + BigInt(family.influence), 0n);
  if (denominator === 0n) return 0;
  return Number(divideRoundedAway(rows.reduce((sum, family) => sum + BigInt(family.wealth) * BigInt(family.influence), 0n), denominator));
}

export function localOrganizationWealth(state: WorldStateV5, settlementId: string): Score1000 {
  const rows = state.organizations.filter((organization) => organization.status === "ACTIVE" && organization.homeSettlementId === settlementId);
  if (rows.length === 0) return 0;
  return Number(divideRoundedAway(rows.reduce((sum, organization) => sum + BigInt(organization.wealth), 0n), BigInt(rows.length)));
}

export function capitalAvailability(state: WorldStateV5, settlementId: string): Score1000 {
  const cells = state.cohorts.filter((cell) => cell.settlementId === settlementId);
  return weightedMean([settlementHighProsperity(cells), 5000], [localFamilyWealth(state, settlementId), 3000], [localOrganizationWealth(state, settlementId), 2000]);
}

export interface SupportedEconomicFormResult {
  economicForm: string;
  denominator: string;
  ownershipTotals: Record<string, string>;
  allocationTotals: Record<string, string>;
}

export function supportedEconomicForm(state: WorldStateV5, settlementId: string, canonical: CanonicalDataV5, suppliedCells?: readonly CohortCell[], suppliedBreedById?: ReadonlyMap<string, CanonicalDataV5["breeds"][number]>): SupportedEconomicFormResult {
  const breedById = suppliedBreedById ?? new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const ownership = new Map<string, bigint>();
  const allocation = new Map<string, bigint>();
  let population = 0n;
  for (const cell of suppliedCells ?? state.cohorts.filter((candidate) => candidate.settlementId === settlementId)) {
    const count = cellPopulation(cell);
    if (count === 0n) continue;
    const breed = breedById.get(cell.breedId);
    if (!breed) throw new Error(`SupportedEconomicForm references unknown Breed ${cell.breedId}`);
    if (!breed.ownershipMode || !breed.allocationMode) throw new Error(`SupportedEconomicForm lacks authoritative economic dimensions for ${cell.breedId}`);
    population += count;
    ownership.set(breed.ownershipMode, (ownership.get(breed.ownershipMode) ?? 0n) + count);
    allocation.set(breed.allocationMode, (allocation.get(breed.allocationMode) ?? 0n) + count);
  }
  const ownershipTotals = Object.fromEntries([...ownership].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, value.toString()]));
  const allocationTotals = Object.fromEntries([...allocation].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, value.toString()]));
  const denominator = population * 2n;
  if (population <= 0n || denominator <= 0n) throw new Error(`SUPPORTED_ECONOMIC_FORM_DENOMINATOR_INVALID ${JSON.stringify({ world: state.worldKey, year: state.year, settlementId, population: population.toString(), ownershipTotals, allocationTotals, mappingAuthority: "economic_form_mapping.json" })}`);
  const candidates = canonical.economicForms.map((row) => ({ row, score: (ownership.get(row.ownershipMode) ?? 0n) + (allocation.get(row.allocationMode) ?? 0n) }))
    .sort((left, right) => left.score === right.score ? left.row.economicForm.localeCompare(right.row.economicForm) : left.score > right.score ? -1 : 1);
  const winner = candidates[0];
  if (!winner || winner.score <= 0n) throw new Error(`SUPPORTED_ECONOMIC_FORM_MAPPING_INVALID ${JSON.stringify({ world: state.worldKey, year: state.year, settlementId, population: population.toString(), ownershipTotals, allocationTotals, mappingAuthority: "economic_form_mapping.json", mappingCount: canonical.economicForms.length })}`);
  return { economicForm: winner.row.economicForm, denominator: denominator.toString(), ownershipTotals, allocationTotals };
}

export function settlementOwnershipConcentration(state: WorldStateV5, settlementId: string): Score1000 {
  const organizationIds = new Set(state.organizations.filter((organization) => organization.homeSettlementId === settlementId && organization.status !== "DISSOLVED").map((organization) => organization.organizationId));
  const shares = state.ownershipStakes.filter((stake) => stake.endYear === null && organizationIds.has(stake.organizationId) && stake.controllerType !== "DIFFUSE").map((stake) => stake.ownershipShareBps);
  if (shares.length === 0) return 0;
  const hhi = shares.reduce((sum, share) => sum + BigInt(share) * BigInt(share), 0n);
  return Math.min(1000, Number(divideRoundedAway(hhi, 100_000n)));
}

interface InstitutionControlIndexes {
  institutionIdsByState: ReadonlyMap<string, ReadonlySet<string>>;
  officeTerms: ReadonlyMap<string, WorldStateV5["officeTerms"][number]>;
  families: ReadonlyMap<string, WorldStateV5["families"][number]>;
  people: ReadonlyMap<string, WorldStateV5["politicalPeople"][number]>;
  breeds: ReadonlyMap<string, CanonicalDataV5["breeds"][number]>;
}

function buildInstitutionControlIndexes(state: WorldStateV5, canonical: CanonicalDataV5): InstitutionControlIndexes {
  const institutionIdsByState = new Map<string, Set<string>>();
  for (const institution of state.institutions.filter((row) => row.dissolvedYear === null)) {
    const ids = institutionIdsByState.get(institution.stateId) ?? new Set<string>();
    ids.add(institution.institutionId); institutionIdsByState.set(institution.stateId, ids);
  }
  return {
    institutionIdsByState,
    officeTerms: new Map(state.officeTerms.filter((term) => officeTermActiveAt(term, state.year)).map((term) => [term.officeId, term])),
    families: new Map(state.families.map((family) => [family.familyId, family])),
    people: new Map(state.politicalPeople.map((person) => [person.personId, person])),
    breeds: new Map(canonical.breeds.map((breed) => [breed.breedId, breed])),
  };
}

export function derivedInstitutionControlVector(state: WorldStateV5, stateId: string, canonical: CanonicalDataV5, suppliedIndexes?: InstitutionControlIndexes): FactionVector {
  const indexes = suppliedIndexes ?? buildInstitutionControlIndexes(state, canonical);
  const institutionIds = indexes.institutionIdsByState.get(stateId) ?? new Set<string>();
  const officeTerms = indexes.officeTerms;
  const families = indexes.families;
  const people = indexes.people;
  const breeds = indexes.breeds;
  const held = state.offices.filter((office) => institutionIds.has(office.institutionId) && office.power > 0 && officeTerms.has(office.officeId)).sort((a, b) => a.officeId.localeCompare(b.officeId));
  if (held.length === 0) {
    const politicalState = state.states.find((row) => row.stateId === stateId);
    const government = canonical.governments.find((row) => row.governmentFormId === politicalState?.actualGovernment);
    if (!government) throw new Error(`State ${stateId} has no government doctrine fallback`);
    return normalizeFactionVector(government.doctrineVector);
  }
  const weights = largestRemainder(10_000n, held.map((office) => BigInt(office.power)), held.map((office) => office.officeId));
  return normalizedVectorWeightedMean(...held.map((office, index) => {
    const term = officeTerms.get(office.officeId)!;
    const person = people.get(term.personId);
    if (!person) throw new Error(`OfficeTerm ${term.officeTermId} references unknown person`);
    const family = person.familyId ? families.get(person.familyId) : undefined;
    const breed = breeds.get(person.breedId);
    if (!breed) throw new Error(`Political Person ${person.personId} references unknown Breed`);
    return [family?.factionAffinity ?? breedFactionVector(breed), Number(weights[index]!)] as const;
  }));
}

export function institutionalAccessScore(state: WorldStateV5, settlement: SettlementV5, populationVector: FactionVector, canonical: CanonicalDataV5, controlVector = derivedInstitutionControlVector(state, settlement.stateId, canonical), suppliedOwnershipConcentration?: Score1000): Score1000 {
  const politicalState = state.states.find((row) => row.stateId === settlement.stateId);
  const government = canonical.governments.find((row) => row.governmentFormId === politicalState?.actualGovernment);
  if (!government) throw new Error(`Settlement ${settlement.settlementId} has no actual-government prototype`);
  return weightedMean(
    [government.franchiseBreadth, 4000],
    [factionCompatibility(populationVector, controlVector), 4000],
    [1000 - (suppliedOwnershipConcentration ?? settlementOwnershipConcentration(state, settlement.settlementId)), 2000],
  );
}

export function shortestDirectedRegionHops(canonical: CanonicalDataV5, originRegionId: string, maximumHops: number): Map<string, number> {
  const adjacency = new Map(canonical.regions.map((region) => [region.regionId, [...region.directedAdjacentRegionIds].sort()]));
  const hops = new Map<string, number>([[originRegionId, 0]]);
  let frontier = [originRegionId];
  for (let distance = 1; distance <= maximumHops && frontier.length > 0; distance += 1) {
    const next: string[] = [];
    for (const regionId of [...frontier].sort()) for (const destination of adjacency.get(regionId) ?? []) if (!hops.has(destination)) { hops.set(destination, distance); next.push(destination); }
    frontier = next;
  }
  return hops;
}

export function tradeAccess(state: WorldStateV5, canonical: CanonicalDataV5, settlementId: string, maximumHops: number): Score1000 {
  const origin = state.settlements.find((settlement) => settlement.settlementId === settlementId);
  if (!origin) throw new Error(`Unknown Settlement ${settlementId}`);
  const populations = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlementPopulation(state, settlement.settlementId)]));
  const worldTotal = [...populations.values()].reduce((sum, value) => sum + value, 0n);
  const originPopulation = populations.get(settlementId) ?? 0n;
  const denominator = (worldTotal - originPopulation) * BigInt(maximumHops + 1);
  if (denominator === 0n) return 0;
  const hops = shortestDirectedRegionHops(canonical, origin.regionId, maximumHops);
  let numerator = 0n;
  for (const destination of state.settlements) {
    if (destination.settlementId === settlementId) continue;
    const distance = hops.get(destination.regionId);
    if (distance === undefined || distance > maximumHops) continue;
    numerator += (populations.get(destination.settlementId) ?? 0n) * BigInt(maximumHops + 1 - distance);
  }
  return ratioScore(numerator, denominator, 0);
}

export function stateAdjacency(state: WorldStateV5, canonical: CanonicalDataV5): readonly [string, string][] {
  const regionsByState = new Map<string, Set<string>>();
  for (const settlement of state.settlements) {
    const regions = regionsByState.get(settlement.stateId) ?? new Set<string>();
    regions.add(settlement.regionId); regionsByState.set(settlement.stateId, regions);
  }
  const directed = new Set(canonical.regions.flatMap((region) => region.directedAdjacentRegionIds.map((other) => `${region.regionId}\0${other}`)));
  const states = [...regionsByState.keys()].sort();
  const pairs: [string, string][] = [];
  for (let left = 0; left < states.length; left += 1) for (let right = left + 1; right < states.length; right += 1) {
    const a = states[left]!; const b = states[right]!;
    const adjacent = [...regionsByState.get(a)!].some((ra) => [...regionsByState.get(b)!].some((rb) => ra === rb || directed.has(`${ra}\0${rb}`) || directed.has(`${rb}\0${ra}`)));
    if (adjacent) pairs.push([a, b]);
  }
  return pairs;
}

export function terrainCompatibility(breedBroad: readonly string[], breedSpecific: readonly string[], destinationBroad: readonly string[], destinationSpecific: readonly string[], owner: CausalOwnerInputsV1): Score1000 {
  const policy = owner.terrainCompatibilityPolicy;
  if (!policy) throw new Error("Terrain compatibility policy approval required");
  if (breedBroad.length === 0 || destinationBroad.length === 0) return policy.unknown;
  const broadMatch = breedBroad.some((value) => destinationBroad.includes(value));
  if (!broadMatch) return policy.broadMismatch;
  if (breedSpecific.length === 0 || destinationSpecific.length === 0) return policy.broadMatchNoSpecificConflict;
  return breedSpecific.some((value) => destinationSpecific.includes(value)) ? policy.exactSpecificMatch : policy.broadMatchSpecificMismatch;
}

export function sectorTerrainFit(site: SiteAuthorityV5, sectorId: string): Score1000 { return site.sectorTerrainFit?.[sectorId] ?? 500; }

export function classDistribution(cell: CohortCell, owner: CausalOwnerInputsV1, contextKeys: readonly string[] = []): Record<SocialTier, ClassDistribution> {
  const policy = owner.classPolicy;
  if (!policy) throw new Error("Class policy approval required");
  const result = {} as Record<SocialTier, ClassDistribution>;
  for (const tier of ["HIGH", "MID", "LOW"] as const) {
    const classKeys: SocialClass[] = ["NOBILITY", "INTELLECTUAL", "WORKER", "WANDERER"];
    const weights = classKeys.map((key) => Math.max(0, policy.tierWeights[tier][key] + contextKeys.reduce((sum, context) => sum + (policy.contextModifiers[context]?.[key] ?? 0), 0)));
    const total = cell.tiers[tier].population;
    const denominator = BigInt(weights.reduce((sum, value) => sum + value, 0));
    const allocation = denominator === 0n ? [0n, 0n, 0n, total] : classKeys.map((_, index) => total * BigInt(weights[index]!) / denominator);
    let remaining = total - allocation.reduce((sum, value) => sum + value, 0n);
    const ranked = classKeys.map((key, index) => ({ index, key, remainder: denominator === 0n ? 0n : total * BigInt(weights[index]!) % denominator })).sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1);
    for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) allocation[ranked[index % ranked.length]!.index] += 1n;
    result[tier] = { NOBILITY: allocation[0]!, INTELLECTUAL: allocation[1]!, WORKER: allocation[2]!, WANDERER: allocation[3]! };
  }
  return result;
}

function activeConditionMagnitude(state: WorldStateV5, targetType: string, targetId: string, year: number, allowed: readonly string[]): Score1000 {
  return state.timedConditions.filter((condition) => condition.targetType === targetType && condition.targetId === targetId && allowed.includes(condition.type) && condition.startYear <= year && (condition.endYear === null || condition.endYear >= year)).reduce((maximum, condition) => Math.max(maximum, condition.magnitude), 0);
}

export function deriveMetrics(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1): DerivedMetricsV1 {
  const settlementPopulationFactionVectors: Record<string, FactionVector> = {};
  const settlementDominantFactions: Record<string, import("./types.js").WorldKey> = {};
  const statePopulationFactionVectors: Record<string, FactionVector> = {};
  const stateUnrest: Record<string, Score1000> = {};
  const settlementProsperities: Record<string, Score1000> = {};
  const settlementHighProsperities: Record<string, Score1000> = {};
  const institutionalAccess: Record<string, Score1000> = {};
  const localOpportunity: Record<string, Score1000> = {};
  const trade: Record<string, Score1000> = {};
  const disruptionPressure: Record<string, Score1000> = {};
  const supportedEconomicForms: DerivedMetricsV1["supportedEconomicForms"] = {};
  const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const cohortsBySettlement = new Map<string, CohortCell[]>();
  for (const cell of state.cohorts) {
    const rows = cohortsBySettlement.get(cell.settlementId);
    if (rows) rows.push(cell); else cohortsBySettlement.set(cell.settlementId, [cell]);
  }
  const populationBySettlement = new Map(state.settlements.map((settlement) => [settlement.settlementId, (cohortsBySettlement.get(settlement.settlementId) ?? []).reduce((sum, cell) => sum + cellPopulation(cell), 0n)]));
  const worldTotal = [...populationBySettlement.values()].reduce((sum, population) => sum + population, 0n);
  const hopsByRegion = new Map<string, Map<string, number>>();
  const institutionIndexes = buildInstitutionControlIndexes(state, canonical);
  const controlVectors = new Map(state.states.map((row) => [row.stateId, derivedInstitutionControlVector(state, row.stateId, canonical, institutionIndexes)]));
  const organizationSettlement = new Map(state.organizations.filter((organization) => organization.status !== "DISSOLVED").map((organization) => [organization.organizationId, organization.homeSettlementId]));
  const ownershipHhiBySettlement = new Map<string, bigint>();
  for (const stake of state.ownershipStakes) if (stake.endYear === null && stake.controllerType !== "DIFFUSE") { const settlementId = organizationSettlement.get(stake.organizationId); if (settlementId) ownershipHhiBySettlement.set(settlementId, (ownershipHhiBySettlement.get(settlementId) ?? 0n) + BigInt(stake.ownershipShareBps) * BigInt(stake.ownershipShareBps)); }
  const ownershipConcentrationBySettlement = new Map(state.settlements.map((settlement) => [settlement.settlementId, Math.min(1000, Number(divideRoundedAway(ownershipHhiBySettlement.get(settlement.settlementId) ?? 0n, 100_000n)))]));
  const recentMigrationBySettlement = new Map<string, number>(); const disruptionBySettlement = new Map<string, number>();
  for (const condition of state.timedConditions) {
    if (condition.targetType !== "SETTLEMENT" || condition.startYear > state.year || condition.endYear !== null && condition.endYear < state.year) continue;
    if (condition.type === "RECENT_MIGRATION") recentMigrationBySettlement.set(condition.targetId, Math.max(recentMigrationBySettlement.get(condition.targetId) ?? 0, condition.magnitude));
    if (["REPRESSION", "SCANDAL", "TRAUMA", "RESTRICTION"].includes(condition.type)) disruptionBySettlement.set(condition.targetId, Math.max(disruptionBySettlement.get(condition.targetId) ?? 0, condition.magnitude));
  }
  for (const settlement of state.settlements) {
    const cells = cohortsBySettlement.get(settlement.settlementId) ?? [];
    const vector = populationFactionVector(cells, canonical, breedById);
    settlementPopulationFactionVectors[settlement.settlementId] = vector;
    settlementDominantFactions[settlement.settlementId] = dominantFaction(vector);
    settlementProsperities[settlement.settlementId] = settlementProsperity(cells);
    settlementHighProsperities[settlement.settlementId] = settlementHighProsperity(cells);
    let hops = hopsByRegion.get(settlement.regionId);
    if (!hops) { hops = shortestDirectedRegionHops(canonical, settlement.regionId, variables.migrationMaximumHops); hopsByRegion.set(settlement.regionId, hops); }
    const originPopulation = populationBySettlement.get(settlement.settlementId) ?? 0n;
    const denominator = (worldTotal - originPopulation) * BigInt(variables.migrationMaximumHops + 1);
    let reachableWeightedPopulation = 0n;
    for (const destination of state.settlements) {
      if (destination.settlementId === settlement.settlementId) continue;
      const distance = hops.get(destination.regionId);
      if (distance === undefined || distance > variables.migrationMaximumHops) continue;
      reachableWeightedPopulation += (populationBySettlement.get(destination.settlementId) ?? 0n) * BigInt(variables.migrationMaximumHops + 1 - distance);
    }
    trade[settlement.settlementId] = ratioScore(reachableWeightedPopulation, denominator, 0);
    institutionalAccess[settlement.settlementId] = institutionalAccessScore(state, settlement, vector, canonical, controlVectors.get(settlement.stateId)!, ownershipConcentrationBySettlement.get(settlement.settlementId) ?? 0);
    localOpportunity[settlement.settlementId] = weightedMean([industryMean(settlement), 4000], [settlementProsperities[settlement.settlementId]!, 3500], [institutionalAccess[settlement.settlementId]!, 1500], [1000 - settlement.unrest, 1000]);
    const recent = recentMigrationBySettlement.get(settlement.settlementId) ?? 0;
    const disrupted = disruptionBySettlement.get(settlement.settlementId) ?? 0;
    disruptionPressure[settlement.settlementId] = Math.max(recent, disrupted);
    if (originPopulation > 0n) supportedEconomicForms[settlement.settlementId] = supportedEconomicForm(state, settlement.settlementId, canonical, cells, breedById);
  }
  const settlementsByState = new Map<string, SettlementV5[]>();
  for (const settlement of state.settlements) { const rows = settlementsByState.get(settlement.stateId) ?? []; rows.push(settlement); settlementsByState.set(settlement.stateId, rows); }
  for (const politicalState of state.states) {
    const members = settlementsByState.get(politicalState.stateId) ?? [];
    const stateCells = members.flatMap((settlement) => cohortsBySettlement.get(settlement.settlementId) ?? []);
    statePopulationFactionVectors[politicalState.stateId] = populationFactionVector(stateCells, canonical, breedById);
    const population = members.reduce((sum, settlement) => sum + (populationBySettlement.get(settlement.settlementId) ?? 0n), 0n);
    stateUnrest[politicalState.stateId] = population === 0n ? 0 : Number(divideRoundedAway(members.reduce((sum, settlement) => sum + (populationBySettlement.get(settlement.settlementId) ?? 0n) * BigInt(settlement.unrest), 0n), population));
  }
  return { schemaVersion: "echoes-derived-metrics-v1", year: state.year, settlementPopulationFactionVectors, settlementDominantFactions, statePopulationFactionVectors, stateAdjacency: stateAdjacency(state, canonical), stateUnrest, settlementProsperity: settlementProsperities, settlementHighProsperity: settlementHighProsperities, institutionalAccess, localOpportunity, tradeAccess: trade, disruptionPressure, supportedEconomicForms };
}

export function compatibilityForBreedAndSettlement(cell: CohortCell, settlementVector: FactionVector, canonical: CanonicalDataV5): Score1000 {
  const breed = canonical.breeds.find((row) => row.breedId === cell.breedId);
  if (!breed) throw new Error(`Unknown Breed ${cell.breedId}`);
  return factionCompatibility(breedFactionVector(breed), settlementVector);
}
