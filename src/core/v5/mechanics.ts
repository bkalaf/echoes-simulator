import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1 } from "./config.js";
import { blend, clamp, divideRoundedAway, factionCompatibility, populationWeightedScore, weightedMean } from "./fixed-point.js";
import { breedFactionVector } from "./faction.js";
import { borderExposure, stateExhaustion, stateGrievance } from "./conflict.js";
import { capitalAvailability, deriveMetrics, industryBreadth, industryMean, sectorTerrainFit, settlementOwnershipConcentration, settlementPopulation, settlementProsperity, statePopulation } from "./derivations.js";
import { corporateFormationPressure, crimeFormationPressure, enforcementStrength, familyNetworkStrength, ownershipConcentration, type OrganizationFormationContext, type OrganizationFormationProposal } from "./society.js";
import type { CohortCell, Score1000, SectorId, SocialTier, WorldStateV5 } from "./types.js";

export function prosperityDispersion(cells: readonly CohortCell[]): Score1000 {
  const mean = settlementProsperity(cells); const rows = cells.flatMap((cell) => (["HIGH", "MID", "LOW"] as const).map((tier) => ({ population: cell.tiers[tier].population, score: Math.abs(cell.tiers[tier].prosperity - mean) })));
  return clamp(populationWeightedScore(rows) * 2, 0, 1000);
}
export function inequality(state: WorldStateV5, settlementId: string, suppliedCells?: readonly CohortCell[]): Score1000 { return weightedMean([prosperityDispersion(suppliedCells ?? state.cohorts.filter((cell) => cell.settlementId === settlementId)), 6000], [ownershipConcentration(state, settlementId), 4000]); }
export function economicStrain(state: WorldStateV5, settlementId: string, suppliedCells?: readonly CohortCell[]): Score1000 { const settlement = state.settlements.find((row) => row.settlementId === settlementId)!; return weightedMean([1000 - settlementProsperity(suppliedCells ?? state.cohorts.filter((cell) => cell.settlementId === settlementId)), 6000], [1000 - industryMean(settlement), 4000]); }

export function institutionalAccessWithMetrics(state: WorldStateV5, settlementId: string, canonical: CanonicalDataV5, metrics: ReturnType<typeof deriveMetrics>, institutionControl: import("./types.js").FactionVector): Score1000 {
  void state; void canonical; void institutionControl;
  return metrics.institutionalAccess[settlementId] ?? 500;
}

export function updateIndustry(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): WorldStateV5 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const cohortsBySettlement = new Map<string, CohortCell[]>();
  for (const cell of state.cohorts) { const rows = cohortsBySettlement.get(cell.settlementId) ?? []; rows.push(cell); cohortsBySettlement.set(cell.settlementId, rows); }
  const familyWealthNumerator = new Map<string, bigint>(); const familyInfluence = new Map<string, bigint>();
  for (const family of state.families) if (family.status === "ACTIVE") { familyWealthNumerator.set(family.homeSettlementId, (familyWealthNumerator.get(family.homeSettlementId) ?? 0n) + BigInt(family.wealth) * BigInt(family.influence)); familyInfluence.set(family.homeSettlementId, (familyInfluence.get(family.homeSettlementId) ?? 0n) + BigInt(family.influence)); }
  const organizationWealth = new Map<string, bigint>(); const organizationCount = new Map<string, bigint>();
  for (const organization of state.organizations) if (organization.status === "ACTIVE") { organizationWealth.set(organization.homeSettlementId, (organizationWealth.get(organization.homeSettlementId) ?? 0n) + BigInt(organization.wealth)); organizationCount.set(organization.homeSettlementId, (organizationCount.get(organization.homeSettlementId) ?? 0n) + 1n); }
  return { ...state, settlements: state.settlements.map((settlement) => {
    const site = canonical.sites.find((row) => row.siteId === settlement.siteId)!; const cells = cohortsBySettlement.get(settlement.settlementId) ?? []; const population = cells.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n); const lowMid = cells.reduce((sum, cell) => sum + cell.tiers.LOW.population + cell.tiers.MID.population, 0n); const highMid = cells.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population, 0n); const labor = population === 0n ? 0 : Number(divideRoundedAway(lowMid * 1000n, population)); const knowledge = population === 0n ? 0 : Number(divideRoundedAway(highMid * 1000n, population)); const influence = familyInfluence.get(settlement.settlementId) ?? 0n; const localFamily = influence === 0n ? 0 : Number(divideRoundedAway(familyWealthNumerator.get(settlement.settlementId) ?? 0n, influence)); const count = organizationCount.get(settlement.settlementId) ?? 0n; const localOrganization = count === 0n ? 0 : Number(divideRoundedAway(organizationWealth.get(settlement.settlementId) ?? 0n, count)); const capital = weightedMean([metrics.settlementHighProsperity[settlement.settlementId]!, 5000], [localFamily, 3000], [localOrganization, 2000]); const trade = metrics.tradeAccess[settlement.settlementId]!;
    const sectorStrengths = Object.fromEntries(Object.entries(settlement.sectorStrengths).map(([sectorId, prior]) => { const weights = variables.sectorStrengthWeights[sectorId]!; const target = weightedMean([labor, weights.labor], [knowledge, weights.knowledge], [capital, weights.capital], [trade, weights.trade], [sectorTerrainFit(site, sectorId), weights.terrain]); return [sectorId, blend(prior, target, variables.industryInertiaBps)]; })) as typeof settlement.sectorStrengths;
    return { ...settlement, sectorStrengths };
  }) };
}

export function updateProsperity(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, accessBySettlement: Readonly<Record<string, Score1000>>, institutionVectorByState: Readonly<Record<string, import("./types.js").FactionVector>>, suppliedMetrics?: ReturnType<typeof deriveMetrics>): WorldStateV5 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  const settlementById = new Map(state.settlements.map((row) => [row.settlementId, row]));
  const stateById = new Map(state.states.map((row) => [row.stateId, row]));
  const breedById = new Map(canonical.breeds.map((row) => [row.breedId, row]));
  const cohorts = state.cohorts.map((cell) => {
    const settlement = settlementById.get(cell.settlementId)!; const politicalState = stateById.get(settlement.stateId)!; const breed = breedById.get(cell.breedId)!; const breedVector = breedFactionVector(breed); const compatibility = weightedMean([factionCompatibility(breedVector, politicalState.factionAffinity), 5000], [accessBySettlement[cell.settlementId] ?? 500, 3000], [factionCompatibility(breedVector, institutionVectorByState[settlement.stateId] ?? politicalState.factionAffinity), 2000]);
    const tiers = {} as CohortCell["tiers"];
    for (const tier of ["HIGH", "MID", "LOW"] as SocialTier[]) { const target = weightedMean([metrics.localOpportunity[cell.settlementId]!, 3500], [variables.tierProsperityInitial[tier], 2500], [compatibility, 2500], [1000 - settlement.unrest, 1500]); tiers[tier] = { ...cell.tiers[tier], prosperity: blend(cell.tiers[tier].prosperity, target, variables.tierProsperityInertiaBps) }; }
    return { ...cell, tiers };
  });
  return { ...state, cohorts };
}

export function conflictGrievancePressure(state: WorldStateV5, stateId: string): Score1000 { return weightedMean([borderExposure(state, stateId), 4000], [stateExhaustion(state, stateId), 3000], [stateGrievance(state, stateId), 3000]); }

export function unrestTarget(state: WorldStateV5, settlementId: string, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, access: Score1000, suppliedMetrics?: ReturnType<typeof deriveMetrics>): Score1000 {
  const settlement = state.settlements.find((row) => row.settlementId === settlementId)!; const politicalState = state.states.find((row) => row.stateId === settlement.stateId)!; const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables); const material = weightedMean([economicStrain(state, settlementId), 6000], [inequality(state, settlementId), 4000]); const factionMismatch = 1000 - factionCompatibility(metrics.settlementPopulationFactionVectors[settlementId]!, politicalState.factionAffinity); const actualGovernment = canonical.governments.find((row) => row.governmentFormId === politicalState.actualGovernment)!; const governmentMismatch = 1000 - factionCompatibility(metrics.settlementPopulationFactionVectors[settlementId]!, { CONCORD: actualGovernment.doctrineVector.CONCORD, SCHISM: actualGovernment.doctrineVector.SCHISM, RUIN: actualGovernment.doctrineVector.RUIN }); const political = weightedMean([1000 - access, 5000], [factionMismatch, 3000], [governmentMismatch, 2000]); return weightedMean([material, 3000], [political, 3000], [metrics.disruptionPressure[settlementId]!, 2000], [conflictGrievancePressure(state, settlement.stateId), 2000]);
}

export function updateUnrest(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, accessBySettlement: Readonly<Record<string, Score1000>>, suppliedMetrics?: ReturnType<typeof deriveMetrics>): WorldStateV5 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables);
  return { ...state, settlements: state.settlements.map((settlement) => ({ ...settlement, unrest: blend(settlement.unrest, unrestTarget(state, settlement.settlementId, canonical, variables, accessBySettlement[settlement.settlementId] ?? 500, metrics), variables.unrestInertiaBps) })) };
}

export function organizationFormationInputs(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, accessBySettlement: Readonly<Record<string, Score1000>>, institutionEffectivenessByState: Readonly<Record<string, Score1000>>, suppliedMetrics?: ReturnType<typeof deriveMetrics>): { proposals: OrganizationFormationProposal[]; contextsByOrganization: Record<string, OrganizationFormationContext> } {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables); const proposals: OrganizationFormationProposal[] = [];
  const settlementById = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const stateById = new Map(state.states.map((politicalState) => [politicalState.stateId, politicalState]));
  const settlementBase = new Map<string, Pick<OrganizationFormationContext, "capitalAvailability" | "tradeAccess" | "enforcement" | "politicalExclusion" | "unrest" | "familyNetwork" | "concentration">>();
  const contexts = new Map<string, OrganizationFormationContext>();
  const contextFor = (settlementId: string, sectorId: SectorId): OrganizationFormationContext => {
    const key = `${settlementId}\0${sectorId}`; const cached = contexts.get(key); if (cached) return cached;
    const settlement = settlementById.get(settlementId)!; const politicalState = stateById.get(settlement.stateId)!;
    let base = settlementBase.get(settlementId);
    if (!base) { const familyNetwork = state.families.filter((family) => family.status === "ACTIVE" && family.homeSettlementId === settlementId).reduce((maximum, family) => Math.max(maximum, familyNetworkStrength(state, family.familyId)), 0); base = { capitalAvailability: capitalAvailability(state, settlementId), tradeAccess: metrics.tradeAccess[settlementId]!, enforcement: enforcementStrength(institutionEffectivenessByState[settlement.stateId] ?? 500, politicalState.legitimacy, 1000 - settlement.unrest), politicalExclusion: 1000 - (accessBySettlement[settlementId] ?? 500), unrest: settlement.unrest, familyNetwork, concentration: ownershipConcentration(state, settlementId) }; settlementBase.set(settlementId, base); }
    const context = { settlementId, sectorId, sectorStrength: settlement.sectorStrengths[sectorId], ...base }; contexts.set(key, context); return context;
  };
  for (const settlement of state.settlements) for (const sectorId of Object.keys(settlement.sectorStrengths) as SectorId[]) { const context = contextFor(settlement.settlementId, sectorId); proposals.push({ key: `${settlement.settlementId}/CORPORATION/${sectorId}`, type: "CORPORATION", context, pressure: corporateFormationPressure(context) }, { key: `${settlement.settlementId}/CRIME_ORGANIZATION/${sectorId}`, type: "CRIME_ORGANIZATION", context, pressure: crimeFormationPressure(context) }); }
  const contextsByOrganization = Object.fromEntries(state.organizations.filter((organization) => organization.status !== "DISSOLVED").map((organization) => [organization.organizationId, contextFor(organization.homeSettlementId, organization.sectorId)]));
  return { proposals, contextsByOrganization };
}
