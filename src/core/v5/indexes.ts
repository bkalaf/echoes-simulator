import type { CanonicalDataV5 } from "./config.js";
import { officeTermActiveAt } from "./office-term.js";
import type { CohortCell, InstitutionV5, OrganizationV5, OwnershipStakeV5, ResourceNodeV5, SecurityForceV5, SettlementV5, TargetedPopulationSliceV5, WorldResourceStateV5, WorldRouteV5, WorldStateV5 } from "./types.js";
import { V5_TIERS } from "./types.js";

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void { const values = map.get(key) ?? []; values.push(value); map.set(key, values); }
function sortValues<K, V>(map: Map<K, V[]>, identity: (value: V) => string): void { for (const values of map.values()) values.sort((left, right) => identity(left).localeCompare(identity(right))); }
export const v5ControllerIndexKey = (controllerType: string, controllerId: string): string => `${controllerType}\0${controllerId}`;
export const v5JurisdictionIndexKey = (jurisdictionType: string, jurisdictionId: string): string => `${jurisdictionType}\0${jurisdictionId}`;
export const v5PopulationSliceLocationIndexKey = (locationType: string, locationId: string): string => `${locationType}\0${locationId}`;
export const v5PopulationSliceBreedTierIndexKey = (breedId: string, tier: string): string => `${breedId}\0${tier}`;

export interface EphemeralWorldIndexesV5 {
  settlementById: Map<string, SettlementV5>;
  settlementsByState: Map<string, SettlementV5[]>;
  settlementBySite: Map<string, SettlementV5>;
  cohortsBySettlement: Map<string, CohortCell[]>;
  populationBySettlement: Map<string, bigint>;
  populationByState: Map<string, bigint>;
  populationSlicesByLocation: Map<string, TargetedPopulationSliceV5[]>;
  populationSlicesByBreedTier: Map<string, TargetedPopulationSliceV5[]>;
  resourceNodesBySite: Map<string, ResourceNodeV5[]>;
  resourceStateByNodeId: Map<string, WorldResourceStateV5>;
  availableResourcesBySite: Map<string, ResourceNodeV5[]>;
  institutionsBySettlement: Map<string, InstitutionV5[]>;
  institutionsByState: Map<string, InstitutionV5[]>;
  institutionById: Map<string, InstitutionV5>;
  organizationById: Map<string, OrganizationV5>;
  organizationsBySettlement: Map<string, OrganizationV5[]>;
  organizationsByController: Map<string, OrganizationV5[]>;
  activeOwnershipStakesByOrganization: Map<string, OwnershipStakeV5[]>;
  officeById: Map<string, WorldStateV5["offices"][number]>;
  activeTermsByOffice: Map<string, WorldStateV5["officeTerms"]>;
  securityForcesByJurisdiction: Map<string, SecurityForceV5[]>;
  securityForceByOrganization: Map<string, SecurityForceV5>;
  routesByRegion: Map<string, WorldRouteV5[]>;
}

export function buildEphemeralWorldIndexesV5(state: WorldStateV5, canonical?: Pick<CanonicalDataV5, "routeCorridors">, options: { includePopulationSlices?: boolean } = {}): EphemeralWorldIndexesV5 {
  const settlementById = new Map(state.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const settlementsByState = new Map<string, SettlementV5[]>(); const settlementBySite = new Map<string, SettlementV5>();
  for (const settlement of state.settlements) { push(settlementsByState, settlement.stateId, settlement); settlementBySite.set(settlement.siteId, settlement); }
  sortValues(settlementsByState, (settlement) => settlement.settlementId);

  const cohortsBySettlement = new Map<string, CohortCell[]>(); const populationBySettlement = new Map<string, bigint>();
  for (const cohort of state.cohorts) { push(cohortsBySettlement, cohort.settlementId, cohort); populationBySettlement.set(cohort.settlementId, (populationBySettlement.get(cohort.settlementId) ?? 0n) + V5_TIERS.reduce((sum, tier) => sum + cohort.tiers[tier].population, 0n)); }
  sortValues(cohortsBySettlement, (cohort) => cohort.breedId);
  const populationByState = new Map<string, bigint>();
  for (const [stateId, settlements] of settlementsByState) populationByState.set(stateId, settlements.reduce((sum, settlement) => sum + (populationBySettlement.get(settlement.settlementId) ?? 0n), 0n));

  const populationSlicesByLocation = new Map<string, TargetedPopulationSliceV5[]>(); const populationSlicesByBreedTier = new Map<string, TargetedPopulationSliceV5[]>();
  for (const slice of options.includePopulationSlices === false ? [] : state.populationSlices ?? []) { push(populationSlicesByLocation, v5PopulationSliceLocationIndexKey(slice.locationType, slice.locationId), slice); push(populationSlicesByBreedTier, v5PopulationSliceBreedTierIndexKey(slice.breedId, slice.tier), slice); }
  sortValues(populationSlicesByLocation, (slice) => slice.populationSliceId); sortValues(populationSlicesByBreedTier, (slice) => slice.populationSliceId);

  const resourceNodesBySite = new Map<string, ResourceNodeV5[]>(); const resourceStateByNodeId = new Map<string, WorldResourceStateV5>();
  for (const node of state.resourceNodes ?? []) push(resourceNodesBySite, node.siteId, node);
  for (const resourceState of state.worldResourceStates ?? []) resourceStateByNodeId.set(resourceState.resourceNodeId, resourceState);
  sortValues(resourceNodesBySite, (node) => node.resourceNodeId);
  const availableResourcesBySite = new Map<string, ResourceNodeV5[]>();
  for (const [siteId, nodes] of resourceNodesBySite) availableResourcesBySite.set(siteId, nodes.filter((node) => resourceStateByNodeId.get(node.resourceNodeId)?.availability === "AVAILABLE"));

  const institutionsBySettlement = new Map<string, InstitutionV5[]>(); const institutionsByState = new Map<string, InstitutionV5[]>(); const institutionById = new Map<string, InstitutionV5>();
  for (const institution of state.institutions) { institutionById.set(institution.institutionId, institution); push(institutionsByState, institution.stateId, institution); if (institution.jurisdictionSettlementId) push(institutionsBySettlement, institution.jurisdictionSettlementId, institution); }
  sortValues(institutionsBySettlement, (institution) => institution.institutionId); sortValues(institutionsByState, (institution) => institution.institutionId);

  const organizationById = new Map(state.organizations.map((organization) => [organization.organizationId, organization])); const organizationsBySettlement = new Map<string, OrganizationV5[]>();
  for (const organization of state.organizations) push(organizationsBySettlement, organization.homeSettlementId, organization);
  sortValues(organizationsBySettlement, (organization) => organization.organizationId);
  const activeOwnershipStakesByOrganization = new Map<string, OwnershipStakeV5[]>(); const organizationsByController = new Map<string, OrganizationV5[]>();
  for (const stake of state.ownershipStakes.filter((row) => row.endYear === null)) { push(activeOwnershipStakesByOrganization, stake.organizationId, stake); const organization = organizationById.get(stake.organizationId); if (organization) push(organizationsByController, v5ControllerIndexKey(stake.controllerType, stake.controllerId), organization); }
  sortValues(activeOwnershipStakesByOrganization, (stake) => stake.stakeId); sortValues(organizationsByController, (organization) => organization.organizationId);

  const officeById = new Map(state.offices.map((office) => [office.officeId, office])); const activeTermsByOffice = new Map<string, WorldStateV5["officeTerms"]>();
  for (const term of state.officeTerms.filter((row) => officeTermActiveAt(row, state.year))) push(activeTermsByOffice, term.officeId, term);
  sortValues(activeTermsByOffice, (term) => term.officeTermId);
  const securityForcesByJurisdiction = new Map<string, SecurityForceV5[]>(); const securityForceByOrganization = new Map<string, SecurityForceV5>();
  for (const force of state.securityForces ?? []) { push(securityForcesByJurisdiction, v5JurisdictionIndexKey(force.jurisdictionType, force.jurisdictionId), force); if (securityForceByOrganization.has(force.organizationId)) throw new Error(`Organization ${force.organizationId} has multiple SecurityForce records`); securityForceByOrganization.set(force.organizationId, force); }
  sortValues(securityForcesByJurisdiction, (force) => force.securityForceId);

  const routesByRegion = new Map<string, WorldRouteV5[]>(); const corridorById = new Map(canonical?.routeCorridors.map((corridor) => [corridor.corridorId, corridor]) ?? []);
  for (const route of state.worldRoutes) { const corridor = corridorById.get(route.corridorId); if (!corridor) continue; push(routesByRegion, corridor.regionAId, route); if (corridor.regionBId !== corridor.regionAId) push(routesByRegion, corridor.regionBId, route); }
  sortValues(routesByRegion, (route) => route.routeId);
  return { settlementById, settlementsByState, settlementBySite, cohortsBySettlement, populationBySettlement, populationByState, populationSlicesByLocation, populationSlicesByBreedTier, resourceNodesBySite, resourceStateByNodeId, availableResourcesBySite, institutionsBySettlement, institutionsByState, institutionById, organizationById, organizationsBySettlement, organizationsByController, activeOwnershipStakesByOrganization, officeById, activeTermsByOffice, securityForcesByJurisdiction, securityForceByOrganization, routesByRegion };
}
