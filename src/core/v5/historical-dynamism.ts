import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { blend, clamp, divideRoundedAway } from "./fixed-point.js";
import { requireHistoricalPolicyV5, type HistoricalDynamismPolicySetV1, type HistoricalPolicyKeyV5 } from "./historical-policies.js";
import type { CausalEventV5, CivicInstitutionTypeV5, ControllerType, IndustryStateV5, IndustryTypeV5, NamingRequestV5, OrganizationV5, ResourceNodeV5, SectorId, SecurityForceTypeV5, SecurityOrganizationTypeV5, WorldResourceStateV5, WorldStateV5 } from "./types.js";
import { V5_INDUSTRY_TYPES } from "./types.js";
import { buildEphemeralWorldIndexesV5 } from "./indexes.js";

export interface HistoricalMechanicsContextV5 {
  canonical: CanonicalDataV5;
  ownerInputs: CausalOwnerInputsV1;
  mode: "CANONICAL" | "DIAGNOSTIC";
}

function digest(parts: readonly (string | number)[]): string { return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex"); }
function event(state: WorldStateV5, phase: CausalEventV5["phase"], eventType: string, entityType: string, entityId: string, payload: Record<string, unknown>): CausalEventV5 {
  return { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${eventType}_${digest([entityType, entityId]).slice(0, 16)}`, worldKey: state.worldKey, year: state.year, phase, sequence: 0, eventType, entityType, entityId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload };
}

function needsPolicy<K extends HistoricalPolicyKeyV5>(state: WorldStateV5, context: HistoricalMechanicsContextV5, policyKey: K, operation: string, entityType = "WORLD", entityId = state.worldKey): HistoricalDynamismPolicySetV1[K] {
  return requireHistoricalPolicyV5({ mode: context.mode, policies: context.ownerInputs.historicalDynamismPolicies, approvedHashes: context.ownerInputs.historicalDynamismApprovedPolicyHashes, diagnosticCandidateOptIns: context.ownerInputs.diagnosticHistoricalPolicyOptIns, policyKey, causalOperation: operation, worldKey: state.worldKey, year: state.year, entityType, entityId });
}

export function establishResourceGeographyV5(state: WorldStateV5, context: HistoricalMechanicsContextV5): { state: WorldStateV5; events: CausalEventV5[] } {
  if ((state.resourceNodes?.length ?? 0) > 0) return { state: state.resourceAuthorityStatus ? state : { ...state, resourceAuthorityStatus: { status: "READY", authorityRevisionId: "LEGACY_CHECKPOINT", contentSha256: null } }, events: [] };
  const authority = context.ownerInputs.approvedResourceInventory;
  if (!authority || authority.status !== "APPROVED") return { state: { ...state, resourceAuthorityStatus: { status: "RESOURCE_AUTHORITY_REQUIRED", authorityRevisionId: null, contentSha256: null }, resourceNodes: [], worldResourceStates: [] }, events: [] };
  const calculatedHash = createHash("sha256").update(canonicalJson(authority.nodes), "utf8").digest("hex");
  if (calculatedHash !== authority.contentSha256) throw new Error(`RESOURCE_AUTHORITY_HASH_MISMATCH ${authority.authorityRevisionId}`);
  if (authority.nodes.length === 0) throw new Error(`RESOURCE_AUTHORITY_EMPTY ${authority.authorityRevisionId}: an approved empty inventory cannot stand in for missing Resource authority`);
  if (new Set(authority.nodes.map((node) => node.resourceNodeId)).size !== authority.nodes.length) throw new Error(`RESOURCE_AUTHORITY_DUPLICATE_IDS ${authority.authorityRevisionId}`);
  const siteIds = new Set(context.canonical.sites.map((site) => site.siteId));
  for (const node of authority.nodes) if (!siteIds.has(node.siteId)) throw new Error(`RESOURCE_AUTHORITY_UNKNOWN_SITE ${node.resourceNodeId}/${node.siteId}`);
  const nodes: ResourceNodeV5[] = []; const statuses: WorldResourceStateV5[] = [];
  for (const approvedNode of [...authority.nodes].sort((a, b) => a.resourceNodeId.localeCompare(b.resourceNodeId))) {
    const node = structuredClone(approvedNode); nodes.push(node);
    const settlement = state.settlements.find((row) => row.siteId === node.siteId);
    statuses.push({ worldResourceStateId: `WORLD_RESOURCE_${state.worldKey}_${node.resourceNodeId}`, resourceNodeId: node.resourceNodeId, controllerType: settlement ? "STATE" : "DIFFUSE", controllerId: settlement?.stateId ?? node.regionId, discoveryYear: state.year, availability: "AVAILABLE", seizedByEventId: null });
  }
  const working = { ...state, resourceAuthorityStatus: { status: "READY" as const, authorityRevisionId: authority.authorityRevisionId, contentSha256: authority.contentSha256 }, resourceNodes: nodes, worldResourceStates: statuses.sort((a, b) => a.worldResourceStateId.localeCompare(b.worldResourceStateId)) };
  return { state: working, events: [event(state, "RESOURCE_GEOGRAPHY", "ResourceGeographyEstablished", "WORLD", state.worldKey, { physicalResourceNodes: nodes.length, worldResourceStatuses: statuses.length, authorityRevisionId: authority.authorityRevisionId, authorityContentSha256: authority.contentSha256 })] };
}

const sectorForIndustry = (industry: IndustryTypeV5): SectorId => {
  if (["AGRICULTURE", "ANIMAL_HUSBANDRY", "FISHING", "FORESTRY", "FOOD_PROCESSING", "BREWING"].includes(industry)) return "LAND_AND_FOOD";
  if (["MINING", "QUARRYING"].includes(industry)) return "EXTRACTION";
  if (["METALWORKING", "CONSTRUCTION", "TEXTILES", "GARMENTS", "LEATHERWORK", "PAPERMAKING", "PRINTING", "INKMAKING"].includes(industry)) return "MANUFACTURE";
  if (["TRANSPORT", "SHIPPING", "TOURISM", "TAVERNS_INNS", "PRECIOUS_GOODS", "SMUGGLING"].includes(industry)) return "TRADE_AND_TRANSPORT";
  return "KNOWLEDGE_AND_SERVICES";
};
const COERCIVE = new Set<IndustryTypeV5>(["SEX_TRADE", "SLAVE_LABOR", "INDENTURED_LABOR", "GLADIATORIAL_ENTERTAINMENT", "FIGHTING_PITS", "ORGANIZED_CRIME", "PROTECTION_RACKETS", "SMUGGLING"]);

export function updateIndustriesAndGuildsV5(state: WorldStateV5, context: HistoricalMechanicsContextV5): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  if (state.resourceAuthorityStatus?.status === "RESOURCE_AUTHORITY_REQUIRED") return { state: { ...state, industries: [] }, events: [], namingRequests: [] };
  const policy = needsPolicy(state, context, "RESOURCE_INDUSTRY", "UPDATE_SETTLEMENT_INDUSTRY_AND_GUILDS");
  const indexes = buildEphemeralWorldIndexesV5(state, context.canonical, { includePopulationSlices: false });
  const prior = new Map((state.industries ?? []).map((row) => [row.industryStateId, row])); const industries: IndustryStateV5[] = [];
  for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) for (const industryType of V5_INDUSTRY_TYPES) {
    const industryStateId = `INDUSTRY_${state.worldKey}_${settlement.settlementId}_${industryType}`;
    const dependencies = policy.industryResourceDependencies[industryType] ?? [];
    const dependencyTypes = new Set(dependencies);
    const availableNodes = (indexes.availableResourcesBySite.get(settlement.siteId) ?? []).filter((node) => dependencyTypes.has(node.resourceType));
    const dependency = dependencies.length === 0 ? 0 : clamp(Number(divideRoundedAway(BigInt(availableNodes.length * 1000), BigInt(dependencies.length))), 0, 1000);
    const sectorStrength = settlement.sectorStrengths[sectorForIndustry(industryType)];
    const averageQuality = availableNodes.length === 0 ? 0 : Number(divideRoundedAway(BigInt(availableNodes.reduce((sum, node) => sum + node.quality, 0)), BigInt(availableNodes.length)));
    const target = dependencies.length === 0 ? sectorStrength : availableNodes.length === 0 ? 0 : clamp(Number(divideRoundedAway(BigInt(dependency + averageQuality + sectorStrength), 3n)), 0, 1000);
    const strength = prior.has(industryStateId) ? blend(prior.get(industryStateId)!.strength, target, policy.industryInertiaBps) : target >= policy.industryFormationMinimum ? target : 0;
    const employmentNumerator = COERCIVE.has(industryType) ? 35 : 65;
    industries.push({ industryStateId, settlementId: settlement.settlementId, industryType, strength, employment: clamp(Number(divideRoundedAway(BigInt(strength * employmentNumerator), 100n)), 0, 1000), dependency, coercion: COERCIVE.has(industryType) ? clamp(strength, 0, 1000) : 0, disruptedUntilYear: prior.get(industryStateId)?.disruptedUntilYear ?? null, supportingResourceNodeIds: availableNodes.map((row) => row.resourceNodeId).sort(), supportingInstitutionIds: (indexes.institutionsBySettlement.get(settlement.settlementId) ?? []).filter((row) => row.dissolvedYear === null).map((row) => row.institutionId).sort(), sourcePolicyRef: policy.schemaVersion });
  }
  let organizations = [...state.organizations]; let stakes = [...state.ownershipStakes]; let institutions = [...state.institutions]; let timedConditions = [...state.timedConditions]; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  const organizationById = new Map(indexes.organizationById); const timedConditionByKey = new Map(state.timedConditions.map((condition) => [condition.key, condition]));
  for (const industry of industries.filter((row) => row.strength >= policy.guildFormationThreshold && !COERCIVE.has(row.industryType))) {
    const organizationId = `GUILD_${state.worldKey}_${industry.settlementId}_${industry.industryType}`;
    if (organizationById.has(organizationId)) continue;
    const candidateKey = `${organizationId}/CANDIDATE`; const priorCondition = timedConditionByKey.get(candidateKey);
    if ((priorCondition?.qualifyingReviewCount ?? 0) + 1 < policy.guildRequiredReviews) {
      timedConditions.push({ conditionId: `COND_${digest([candidateKey]).slice(0, 24)}`, type: "GUILD_FORMATION_CANDIDATE", targetType: "SETTLEMENT", targetId: industry.settlementId, magnitude: industry.strength, startYear: priorCondition?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${organizationId}_CANDIDATE`, key: candidateKey, qualifyingReviewCount: (priorCondition?.qualifyingReviewCount ?? 0) + 1 });
      continue;
    }
    const settlement = indexes.settlementById.get(industry.settlementId)!;
    const organization: OrganizationV5 = { organizationId, type: "GUILD", sectorId: sectorForIndustry(industry.industryType), homeSettlementId: industry.settlementId, founderControllerType: "DIFFUSE", founderControllerId: `MEMBERS_${organizationId}`, wealth: clamp(industry.strength, 0, 1000), influence: clamp(Number(divideRoundedAway(BigInt(industry.strength), 2n)), 0, 1000), status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: state.year, dissolutionYear: null };
    organizations.push(organization); organizationById.set(organizationId, organization); stakes.push({ stakeId: `STAKE_${organizationId}_MEMBERS`, organizationId, controllerType: "DIFFUSE", controllerId: `MEMBERS_${organizationId}`, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` });
    institutions.push({ institutionId: `INSTITUTION_${organizationId}`, stateId: settlement.stateId, institutionType: "GUILD", jurisdictionSettlementId: settlement.settlementId, capacity: industry.strength, foundedYear: state.year, dissolvedYear: null });
    events.push(event(state, "ORGANIZATION", "GuildFormed", "ORGANIZATION", organizationId, { settlementId: industry.settlementId, industryType: industry.industryType, strength: industry.strength, createsChamberSeats: false }));
    namingRequests.push({ requestId: `NAME_${organizationId}`, entityType: "ORGANIZATION", entityId: organizationId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, acceptedLabel: null, context: { causalReason: "GUILD_FORMED", settlementId: industry.settlementId, industryType: industry.industryType } });
  }
  const formedIds = new Set(organizations.filter((row) => row.type === "GUILD").map((row) => `${row.organizationId}/CANDIDATE`));
  timedConditions = timedConditions.filter((row) => row.type !== "GUILD_FORMATION_CANDIDATE" || !formedIds.has(row.key));
  return { state: { ...state, industries, organizations: organizations.sort((a, b) => a.organizationId.localeCompare(b.organizationId)), ownershipStakes: stakes, institutions: institutions.sort((a, b) => a.institutionId.localeCompare(b.institutionId)), timedConditions }, events, namingRequests };
}

const SECURITY_ORGANIZATION_TYPE: Readonly<Record<SecurityForceTypeV5, SecurityOrganizationTypeV5>> = {
  CITY_WATCH: "CITY_WATCH",
  STATE_GUARD: "STATE_GUARD",
  FAMILY_GUARD: "FAMILY_GUARD",
  CORPORATE_SECURITY: "CORPORATE_SECURITY",
  RELIGIOUS_GUARD: "RELIGIOUS_GUARD",
  MERCENARIES: "MERCENARY_COMPANY",
  CRIMINAL_ENFORCERS: "CRIMINAL_ENFORCEMENT_ORGANIZATION",
};

function controllerExists(state: WorldStateV5, controllerType: ControllerType, controllerId: string): boolean {
  if (controllerType === "DIFFUSE") return true;
  if (controllerType === "STATE") return state.states.some((row) => row.stateId === controllerId);
  if (controllerType === "SETTLEMENT") return state.settlements.some((row) => row.settlementId === controllerId);
  if (controllerType === "FAMILY") return state.families.some((row) => row.familyId === controllerId);
  if (controllerType === "PERSON") return state.politicalPeople.some((row) => row.personId === controllerId);
  if (controllerType === "INSTITUTION") return state.institutions.some((row) => row.institutionId === controllerId);
  return state.organizations.some((row) => row.organizationId === controllerId);
}

function assertControllerExists(state: WorldStateV5, controllerType: ControllerType, controllerId: string, subject: string): void {
  if (!controllerExists(state, controllerType, controllerId)) throw new Error(`${subject} references unknown ${controllerType} ${controllerId}`);
}

export function validateSecurityForceOrganizationIntegrityV5(state: WorldStateV5): void {
  const organizationById = new Map(state.organizations.map((organization) => [organization.organizationId, organization])); const settlementIds = new Set(state.settlements.map((settlement) => settlement.settlementId)); const institutionIds = new Set(state.institutions.map((institution) => institution.institutionId));
  const activeOwnershipStakesByOrganization = new Map<string, typeof state.ownershipStakes>(); for (const stake of state.ownershipStakes) if (stake.endYear === null) { const rows = activeOwnershipStakesByOrganization.get(stake.organizationId) ?? []; rows.push(stake); activeOwnershipStakesByOrganization.set(stake.organizationId, rows); }
  const stateIds = new Set(state.states.map((row) => row.stateId)); const familyIds = new Set(state.families.map((row) => row.familyId)); const personIds = new Set(state.politicalPeople.map((row) => row.personId));
  const controllerIsValid = (controllerType: ControllerType, controllerId: string): boolean => controllerType === "DIFFUSE" || controllerType === "STATE" && stateIds.has(controllerId) || controllerType === "SETTLEMENT" && settlementIds.has(controllerId) || controllerType === "FAMILY" && familyIds.has(controllerId) || controllerType === "PERSON" && personIds.has(controllerId) || controllerType === "INSTITUTION" && institutionIds.has(controllerId) || controllerType === "ORGANIZATION" && organizationById.has(controllerId);
  const validateController = (controllerType: ControllerType, controllerId: string, subject: string): void => { if (!controllerIsValid(controllerType, controllerId)) throw new Error(`${subject} references unknown ${controllerType} ${controllerId}`); };
  for (const organization of state.organizations) {
    if (!settlementIds.has(organization.homeSettlementId)) throw new Error(`Organization ${organization.organizationId} references unknown home SETTLEMENT ${organization.homeSettlementId}`);
    validateController(organization.founderControllerType, organization.founderControllerId, `Organization ${organization.organizationId} founder`);
  }
  for (const stake of state.ownershipStakes) {
    if (!organizationById.has(stake.organizationId)) throw new Error(`OwnershipStake ${stake.stakeId} references unknown Organization ${stake.organizationId}`);
    validateController(stake.controllerType, stake.controllerId, `OwnershipStake ${stake.stakeId}`);
  }
  for (const force of state.securityForces ?? []) {
    const organization = organizationById.get(force.organizationId);
    if (!organization) throw new Error(`SecurityForce ${force.securityForceId} references unknown Organization ${force.organizationId}`);
    if (organization.type !== SECURITY_ORGANIZATION_TYPE[force.forceType]) throw new Error(`SecurityForce ${force.securityForceId} type ${force.forceType} references incompatible Organization type ${organization.type}`);
    validateController(force.controllerType, force.controllerId, `SecurityForce ${force.securityForceId}`);
    if (force.jurisdictionType === "SETTLEMENT" && !settlementIds.has(force.jurisdictionId)) throw new Error(`SecurityForce ${force.securityForceId} references unknown jurisdiction SETTLEMENT ${force.jurisdictionId}`);
    if (force.jurisdictionType === "STATE" && !stateIds.has(force.jurisdictionId)) throw new Error(`SecurityForce ${force.securityForceId} references unknown jurisdiction STATE ${force.jurisdictionId}`);
    if (force.jurisdictionType === "ORGANIZATION" && !organizationById.has(force.jurisdictionId)) throw new Error(`SecurityForce ${force.securityForceId} references unknown jurisdiction Organization ${force.jurisdictionId}`);
    if (force.jurisdictionType === "ROUTE" && !state.worldRoutes.some((row) => row.routeId === force.jurisdictionId)) throw new Error(`SecurityForce ${force.securityForceId} references unknown jurisdiction ROUTE ${force.jurisdictionId}`);
    if (force.seniorOfficerPersonIds.some((personId) => !personIds.has(personId))) throw new Error(`SecurityForce ${force.securityForceId} references unknown senior officer`);
    const activeStakes = activeOwnershipStakesByOrganization.get(force.organizationId) ?? [];
    if (organization.status !== "DISSOLVED" && (activeStakes.reduce((sum, stake) => sum + stake.ownershipShareBps, 0) !== 10_000 || activeStakes.reduce((sum, stake) => sum + stake.controlShareBps, 0) !== 10_000)) throw new Error(`Security Organization ${organization.organizationId} has invalid active ownership/control shares`);
    if (organization.status === "DISSOLVED" && !["DISSOLVED", "DISBANDED", "INACTIVE"].includes(force.status)) throw new Error(`Dissolved Security Organization ${organization.organizationId} retains active force status ${force.status}`);
  }
}

export function updateCivicInstitutionsAndSecurityV5(state: WorldStateV5, context: HistoricalMechanicsContextV5): { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[] } {
  const policy = needsPolicy(state, context, "CIVIC_INSTITUTION_SECURITY", "UPDATE_CIVIC_INSTITUTION_CAPACITY_AND_SECURITY");
  const annualIndexes = buildEphemeralWorldIndexesV5(state, context.canonical, { includePopulationSlices: false });
  const institutionById = new Map(annualIndexes.institutionById); let institutions = [...state.institutions]; const events: CausalEventV5[] = [];
  const automaticTypes: CivicInstitutionTypeV5[] = ["BUREAUCRACY", "FAITH", "EDUCATION", "HEALTH_CARE", "NEWSPAPER_PRESS", "LAW", "COURTS", "PRISON", "BANKING", "MILITARY_SECURITY"];
  for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) {
    const population = annualIndexes.populationBySettlement.get(settlement.settlementId) ?? 0n;
    if (population < policy.institutionFormationMinimumPopulation) continue;
    for (const institutionType of automaticTypes.filter((type) => policy.supportedInstitutionTypes.includes(type))) {
      const institutionId = `CIVIC_${state.worldKey}_${settlement.settlementId}_${institutionType}`;
      const base = policy.baseCapacityByType[institutionType]; const target = clamp(Number(divideRoundedAway(BigInt(base + settlement.sectorStrengths[sectorForIndustry(institutionType === "BANKING" ? "BANKING" : institutionType === "EDUCATION" ? "EDUCATION" : institutionType === "HEALTH_CARE" ? "HEALTH_CARE" : institutionType === "MILITARY_SECURITY" ? "SECURITY" : "ADMINISTRATION")]), 2n)), 0, 1000);
      const prior = institutionById.get(institutionId);
      if (prior) institutionById.set(institutionId, { ...prior, capacity: blend(prior.capacity ?? base, target, policy.capacityInertiaBps) });
      else if (target >= policy.institutionFormationThreshold) { const founded = { institutionId, stateId: settlement.stateId, institutionType, jurisdictionSettlementId: settlement.settlementId, capacity: target, foundedYear: state.year, dissolvedYear: null }; institutionById.set(institutionId, founded); events.push(event(state, "INSTITUTION_CAPACITY", "CivicInstitutionFounded", "INSTITUTION", institutionId, { institutionType, settlementId: settlement.settlementId, capacity: target, createsChamberSeats: false })); }
    }
  }
  institutions = [...institutionById.values()];
  const civicIndexes = buildEphemeralWorldIndexesV5({ ...state, institutions }, context.canonical, { includePopulationSlices: false });
  let forces = [...(state.securityForces ?? [])]; let organizations = [...state.organizations]; let stakes = [...state.ownershipStakes]; const namingRequests: NamingRequestV5[] = [];
  const forceIds = new Set(forces.map((force) => force.securityForceId)); const organizationById = new Map(civicIndexes.organizationById); const stateById = new Map(state.states.map((row) => [row.stateId, row]));
  const createForce = (input: { forceType: SecurityForceTypeV5; controllerType: ControllerType; controllerId: string; ownershipControllerType?: ControllerType; ownershipControllerId?: string; selfControlled?: boolean; jurisdictionType: "SETTLEMENT" | "STATE" | "ORGANIZATION"; jurisdictionId: string; homeSettlementId: string; sectorId: SectorId; population: bigint }) => {
    const ownershipControllerType = input.ownershipControllerType ?? input.controllerType; const ownershipControllerId = input.ownershipControllerId ?? input.controllerId;
    const organizationId = `SECURITY_ORGANIZATION_${state.worldKey}_${input.forceType}_${digest([ownershipControllerType, ownershipControllerId, input.jurisdictionType, input.jurisdictionId]).slice(0, 20)}`;
    const forceControllerType: ControllerType = input.selfControlled ? "ORGANIZATION" : input.controllerType;
    const forceControllerId = input.selfControlled ? organizationId : input.controllerId;
    const forceId = `SECURITY_FORCE_${state.worldKey}_${input.forceType}_${digest([organizationId, input.jurisdictionId]).slice(0, 20)}`;
    if (forceIds.has(forceId)) return;
    if (organizationById.has(organizationId)) throw new Error(`Security Organization ${organizationId} exists without its force ${forceId}`);
    const quality = policy.securityFormationThreshold;
    const organization: OrganizationV5 = { organizationId, type: SECURITY_ORGANIZATION_TYPE[input.forceType], sectorId: input.sectorId, homeSettlementId: input.homeSettlementId, founderControllerType: ownershipControllerType, founderControllerId: ownershipControllerId, wealth: quality, influence: clamp(Number(divideRoundedAway(BigInt(quality), 2n)), 0, 1000), status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: state.year, dissolutionYear: null };
    organizations.push(organization); organizationById.set(organizationId, organization);
    const organizationFormationEventId = `EVT_${organizationId}_FORMED`;
    stakes.push({ stakeId: `STAKE_${organizationId}_CONTROL`, organizationId, controllerType: ownershipControllerType, controllerId: ownershipControllerId, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: organizationFormationEventId });
    events.push({ ...event(state, "SECURITY", "SecurityOrganizationFormed", "ORGANIZATION", organizationId, { organizationType: organization.type, forceType: input.forceType, controllerType: ownershipControllerType, controllerId: ownershipControllerId, homeSettlementId: input.homeSettlementId }), eventId: organizationFormationEventId });
    namingRequests.push({ requestId: `NAME_${organizationId}`, entityType: "ORGANIZATION", entityId: organizationId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, acceptedLabel: null, context: { world: state.worldKey, creationYear: state.year, causalReason: "SECURITY_ORGANIZATION_FORMED", organizationId, organizationType: organization.type, forceType: input.forceType, homeSettlementId: input.homeSettlementId, founderControllerType: ownershipControllerType, founderControllerId: ownershipControllerId } });
    const personnel = input.population / 500n > 0n ? input.population / 500n : 1n;
    const loyaltyStateId = forceControllerType === "STATE" ? forceControllerId : civicIndexes.settlementById.get(input.homeSettlementId)?.stateId;
    forces.push({ securityForceId: forceId, forceType: input.forceType, controllerType: forceControllerType, controllerId: forceControllerId, jurisdictionType: input.jurisdictionType, jurisdictionId: input.jurisdictionId, organizationId, personnel, seniorOfficerPersonIds: [], loyalty: stateById.get(loyaltyStateId ?? "")?.factionAffinity ?? { CONCORD: 334, SCHISM: 333, RUIN: 333 }, training: quality, equipment: quality, morale: 500, cohesion: 500, commandQuality: 500, suppressionCapacity: clamp(Number(divideRoundedAway(BigInt(quality * 6), 10n)), 0, 1000), combatCapacity: clamp(Number(divideRoundedAway(BigInt(quality * 7), 10n)), 0, 1000), status: "ACTIVE", foundedYear: state.year, recoveryUntilYear: null });
    forceIds.add(forceId);
    events.push({ ...event(state, "SECURITY", "SecurityForceFormed", "SECURITY_FORCE", forceId, { forceType: input.forceType, organizationId, controllerType: forceControllerType, controllerId: forceControllerId, jurisdictionType: input.jurisdictionType, jurisdictionId: input.jurisdictionId, personnel: personnel.toString() }), causeEventIds: [organizationFormationEventId] });
  };
  for (const settlement of state.settlements) if ((civicIndexes.institutionsBySettlement.get(settlement.settlementId) ?? []).some((row) => row.institutionType === "MILITARY_SECURITY" && (row.capacity ?? 0) >= policy.securityFormationThreshold)) createForce({ forceType: "CITY_WATCH", controllerType: "SETTLEMENT", controllerId: settlement.settlementId, jurisdictionType: "SETTLEMENT", jurisdictionId: settlement.settlementId, homeSettlementId: settlement.settlementId, sectorId: "KNOWLEDGE_AND_SERVICES", population: annualIndexes.populationByState.get(settlement.stateId) ?? 0n });
  for (const politicalState of state.states) {
    const homeSettlement = annualIndexes.settlementsByState.get(politicalState.stateId)?.[0];
    if (homeSettlement && (civicIndexes.institutionsByState.get(politicalState.stateId) ?? []).some((row) => row.institutionType === "MILITARY_SECURITY")) createForce({ forceType: "STATE_GUARD", controllerType: "STATE", controllerId: politicalState.stateId, jurisdictionType: "STATE", jurisdictionId: politicalState.stateId, homeSettlementId: homeSettlement.settlementId, sectorId: "KNOWLEDGE_AND_SERVICES", population: annualIndexes.populationByState.get(politicalState.stateId) ?? 0n });
  }
  for (const family of state.families.filter((row) => row.status === "ACTIVE" && row.wealth >= policy.securityFormationThreshold)) createForce({ forceType: "FAMILY_GUARD", controllerType: "FAMILY", controllerId: family.familyId, jurisdictionType: "SETTLEMENT", jurisdictionId: family.homeSettlementId, homeSettlementId: family.homeSettlementId, sectorId: "KNOWLEDGE_AND_SERVICES", population: annualIndexes.populationByState.get(annualIndexes.settlementById.get(family.homeSettlementId)!.stateId) ?? 0n });
  for (const faith of institutions.filter((row) => row.institutionType === "FAITH" && row.dissolvedYear === null && (row.capacity ?? 0) >= policy.securityFormationThreshold && row.jurisdictionSettlementId)) {
    const settlement = annualIndexes.settlementById.get(faith.jurisdictionSettlementId!)!;
    createForce({ forceType: "RELIGIOUS_GUARD", controllerType: "INSTITUTION", controllerId: faith.institutionId, jurisdictionType: "SETTLEMENT", jurisdictionId: settlement.settlementId, homeSettlementId: settlement.settlementId, sectorId: "KNOWLEDGE_AND_SERVICES", population: annualIndexes.populationByState.get(settlement.stateId) ?? 0n });
  }
  for (const organization of state.organizations.filter((row) => row.status === "ACTIVE" && row.wealth >= policy.securityFormationThreshold && ["CORPORATION", "CRIME_ORGANIZATION", "GUILD"].includes(row.type))) {
    const settlement = annualIndexes.settlementById.get(organization.homeSettlementId)!; const population = annualIndexes.populationByState.get(settlement.stateId) ?? 0n;
    if (organization.type === "CORPORATION") createForce({ forceType: "CORPORATE_SECURITY", controllerType: "ORGANIZATION", controllerId: organization.organizationId, jurisdictionType: "ORGANIZATION", jurisdictionId: organization.organizationId, homeSettlementId: settlement.settlementId, sectorId: organization.sectorId, population });
    else if (organization.type === "CRIME_ORGANIZATION") createForce({ forceType: "CRIMINAL_ENFORCERS", controllerType: "ORGANIZATION", controllerId: organization.organizationId, jurisdictionType: "ORGANIZATION", jurisdictionId: organization.organizationId, homeSettlementId: settlement.settlementId, sectorId: organization.sectorId, population });
    else createForce({ forceType: "MERCENARIES", controllerType: "DIFFUSE", controllerId: `MEMBERS_MERCENARY_${organization.organizationId}`, selfControlled: true, jurisdictionType: "ORGANIZATION", jurisdictionId: organization.organizationId, homeSettlementId: settlement.settlementId, sectorId: organization.sectorId, population });
  }
  const working = { ...state, institutions: institutions.sort((a, b) => a.institutionId.localeCompare(b.institutionId)), organizations: organizations.sort((a, b) => a.organizationId.localeCompare(b.organizationId)), ownershipStakes: stakes.sort((a, b) => a.stakeId.localeCompare(b.stakeId)), securityForces: forces.sort((a, b) => a.securityForceId.localeCompare(b.securityForceId)) };
  validateSecurityForceOrganizationIntegrityV5(working);
  return { state: working, events, namingRequests };
}

export function applySecurityCommandDecapitationV5(state: WorldStateV5, securityForceId: string, removedOfficerPersonIds: readonly string[], sourceEventId: string): { state: WorldStateV5; events: CausalEventV5[] } {
  const force = (state.securityForces ?? []).find((row) => row.securityForceId === securityForceId); if (!force) throw new Error(`Unknown SecurityForce ${securityForceId}`);
  if (!state.organizations.some((row) => row.organizationId === force.organizationId)) throw new Error(`SecurityForce ${securityForceId} references unknown Organization ${force.organizationId}`);
  const removed = new Set(removedOfficerPersonIds); const seniorOfficerPersonIds = force.seniorOfficerPersonIds.filter((personId) => !removed.has(personId));
  const updated = { ...force, seniorOfficerPersonIds, commandQuality: clamp(Number(divideRoundedAway(BigInt(force.commandQuality), 2n)), 0, 1000), morale: clamp(force.morale - 100, 0, 1000), cohesion: clamp(force.cohesion - 100, 0, 1000), status: "DEGRADED" as const };
  const working = { ...state, securityForces: state.securityForces!.map((row) => row.securityForceId === securityForceId ? updated : row) };
  return { state: working, events: [{ ...event(state, "SECURITY", "SecurityForceCommandDecapitated", "SECURITY_FORCE", securityForceId, { organizationId: force.organizationId, removedOfficerPersonIds: [...removed].sort(), remainingSeniorOfficerPersonIds: seniorOfficerPersonIds }), causeEventIds: [sourceEventId] }] };
}

export function changeSecurityOrganizationControlV5(state: WorldStateV5, organizationId: string, controller: { controllerType: ControllerType; controllerId: string }, sourceEventId: string): { state: WorldStateV5; events: CausalEventV5[] } {
  const organization = state.organizations.find((row) => row.organizationId === organizationId); if (!organization) throw new Error(`Unknown Security Organization ${organizationId}`);
  if (!Object.values(SECURITY_ORGANIZATION_TYPE).includes(organization.type as SecurityOrganizationTypeV5)) throw new Error(`Organization ${organizationId} is not a Security Organization`);
  assertControllerExists(state, controller.controllerType, controller.controllerId, `Security Organization ${organizationId}`);
  const prior = state.ownershipStakes.filter((stake) => stake.organizationId === organizationId && stake.endYear === null);
  const stakes = [...state.ownershipStakes.map((stake) => stake.organizationId === organizationId && stake.endYear === null ? { ...stake, endYear: state.year } : stake), { stakeId: `STAKE_${organizationId}_CONTROL_${state.year}_${digest([controller.controllerType, controller.controllerId]).slice(0, 12)}`, organizationId, controllerType: controller.controllerType, controllerId: controller.controllerId, ownershipShareBps: 10_000 as const, controlShareBps: 10_000 as const, startYear: state.year, endYear: null, sourceEventId }];
  const forces = (state.securityForces ?? []).map((force) => force.organizationId === organizationId ? { ...force, controllerType: controller.controllerType, controllerId: controller.controllerId, status: "DEFECTED" as const } : force);
  const working = { ...state, ownershipStakes: stakes, securityForces: forces };
  validateSecurityForceOrganizationIntegrityV5(working);
  return { state: working, events: [{ ...event(state, "SECURITY", "SecurityOrganizationControlChanged", "ORGANIZATION", organizationId, { priorControllers: prior.map((stake) => ({ controllerType: stake.controllerType, controllerId: stake.controllerId, controlShareBps: stake.controlShareBps })), nextController: controller }), causeEventIds: [sourceEventId] }] };
}

export function dissolveSecurityOrganizationV5(state: WorldStateV5, organizationId: string, sourceEventId: string): { state: WorldStateV5; events: CausalEventV5[] } {
  const organization = state.organizations.find((row) => row.organizationId === organizationId); if (!organization) throw new Error(`Unknown Security Organization ${organizationId}`);
  const affectedForceIds = (state.securityForces ?? []).filter((force) => force.organizationId === organizationId).map((force) => force.securityForceId).sort();
  if (affectedForceIds.length === 0) throw new Error(`Security Organization ${organizationId} has no SecurityForce`);
  const working = { ...state, organizations: state.organizations.map((row) => row.organizationId === organizationId ? { ...row, status: "DISSOLVED" as const, dissolutionYear: state.year } : row), ownershipStakes: state.ownershipStakes.map((stake) => stake.organizationId === organizationId && stake.endYear === null ? { ...stake, endYear: state.year } : stake), securityForces: state.securityForces!.map((force) => force.organizationId === organizationId ? { ...force, personnel: 0n, status: "DISSOLVED" as const } : force) };
  validateSecurityForceOrganizationIntegrityV5(working);
  return { state: working, events: [{ ...event(state, "SECURITY", "SecurityOrganizationDissolved", "ORGANIZATION", organizationId, { affectedForceIds, organizationRetained: true }), causeEventIds: [sourceEventId] }, { ...event(state, "SECURITY", "SecurityForceDisbanded", "ORGANIZATION", organizationId, { securityForceIds: affectedForceIds, personnel: "0" }), causeEventIds: [sourceEventId] }] };
}

export function reconcileDiplomacyAndConflictV5(state: WorldStateV5, context: HistoricalMechanicsContextV5): { state: WorldStateV5; events: CausalEventV5[] } {
  const policy = needsPolicy(state, context, "DIPLOMACY_CONFLICT", "RECONCILE_JUSTIFIED_DIPLOMATIC_RELATIONS_AND_CONFLICT");
  let relations = [...(state.diplomaticRelations ?? [])]; let episodes = [...(state.conflictEpisodes ?? [])]; const events: CausalEventV5[] = [];
  for (const border of state.borderRelations.filter((row) => row.activeBorder)) {
    const relationId = `DIPLOMACY_${border.borderRelationId}`; const prior = relations.find((row) => row.diplomaticRelationId === relationId);
    const hostility = clamp(Number(divideRoundedAway(BigInt(border.tension + border.grievance + border.territorialClaim), 3n)), 0, 1000);
    const current = { diplomaticRelationId: relationId, stateAId: border.stateAId, stateBId: border.stateBId, trust: clamp(1000 - hostility, 0, 1000), hostility, tradeDependence: prior?.tradeDependence ?? 0, territorialDispute: border.territorialClaim, resourceCompetition: prior?.resourceCompetition ?? 0, ideologicalConflict: prior?.ideologicalConflict ?? 0, recentViolence: border.status === "PEACE" ? 0 : border.status === "WAR" ? 1000 : 500, diplomaticEngagement: border.status === "PEACE" ? 500 : 200, warExhaustion: border.exhaustion, lastReviewedYear: state.year };
    relations = [...relations.filter((row) => row.diplomaticRelationId !== relationId), current];
    const stage = border.status === "WAR" ? "WAR" as const : hostility >= policy.stageThresholds.skirmish ? "SKIRMISH" as const : hostility >= policy.stageThresholds.borderIncident ? "BORDER_INCIDENT" as const : hostility >= policy.stageThresholds.dispute ? "DISPUTE" as const : "TENSION" as const;
    const active = episodes.find((row) => row.relationId === relationId && row.endYear === null);
    if (!active && stage !== "TENSION") { const conflictEpisodeId = `CONFLICT_EPISODE_${state.worldKey}_${digest([relationId, state.year]).slice(0, 20)}`; episodes.push({ conflictEpisodeId, relationId, participantStateIds: [border.stateAId, border.stateBId].sort(), stage, startYear: state.year, endYear: null, causeCodes: ["ACTIVE_BORDER", border.status], causeEventIds: [], affectedSettlementIds: [], affectedResourceNodeIds: [], casualties: 0n, displaced: 0n, outcome: null }); events.push(event(state, "DIPLOMACY", "ConflictEpisodeOpened", "CONFLICT_EPISODE", conflictEpisodeId, { stage, stateAId: border.stateAId, stateBId: border.stateBId })); }
    else if (active && active.stage !== stage) episodes = episodes.map((row) => row.conflictEpisodeId === active.conflictEpisodeId ? { ...row, stage, endYear: stage === "TENSION" ? state.year : null, outcome: stage === "TENSION" ? "DEESCALATED" : row.outcome } : row);
  }
  return { state: { ...state, diplomaticRelations: relations.sort((a, b) => a.diplomaticRelationId.localeCompare(b.diplomaticRelationId)), conflictEpisodes: episodes.sort((a, b) => a.conflictEpisodeId.localeCompare(b.conflictEpisodeId)) }, events };
}
