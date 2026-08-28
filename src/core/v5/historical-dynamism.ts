import { createHash } from "node:crypto";
import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { blend, clamp, divideRoundedAway } from "./fixed-point.js";
import { requireHistoricalPolicyV5, type HistoricalDynamismPolicySetV1, type HistoricalPolicyKeyV5 } from "./historical-policies.js";
import type { CausalEventV5, CivicInstitutionTypeV5, IndustryStateV5, IndustryTypeV5, NamingRequestV5, OrganizationV5, ResourceNodeV5, SectorId, SecurityForceTypeV5, WorldResourceStateV5, WorldStateV5 } from "./types.js";
import { V5_INDUSTRY_TYPES, V5_TIERS } from "./types.js";

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
  if ((state.resourceNodes?.length ?? 0) > 0) return { state, events: [] };
  const policy = needsPolicy(state, context, "RESOURCE_INDUSTRY", "PLACE_PHYSICAL_RESOURCE_GEOGRAPHY");
  const nodes: ResourceNodeV5[] = []; const statuses: WorldResourceStateV5[] = [];
  for (const site of [...context.canonical.sites].sort((a, b) => a.siteId.localeCompare(b.siteId))) for (const rule of policy.placementRules) {
    // Empty terrain rules need a separately approved production capability; none is present in the V5.4 canonical adapter.
    const terrainMatch = rule.broadTerrain.length + rule.specificTerrain.length > 0 && (rule.broadTerrain.some((value) => site.terrainBroad.includes(value)) || rule.specificTerrain.some((value) => site.terrainSpecific.includes(value)));
    if (!terrainMatch || Number.parseInt(digest([site.siteId, rule.resourceType]).slice(0, 8), 16) % rule.scarcityDivisor !== 0) continue;
    const resourceNodeId = `RESOURCE_NODE_${digest([site.siteId, rule.resourceType]).slice(0, 24)}`;
    const quality = clamp(site.quality ?? 500, 0, 1000); const capacityClass = quality >= 700 ? "MAJOR" as const : quality >= 400 ? "MODERATE" as const : "MINOR" as const;
    nodes.push({ resourceNodeId, resourceType: rule.resourceType, siteId: site.siteId, regionId: site.regionId, quality, capacityClass, renewable: rule.renewable, accessDifficulty: rule.baseAccessDifficulty, placementAuthorityRef: `${policy.schemaVersion}:${rule.resourceType}` });
    const settlement = state.settlements.find((row) => row.siteId === site.siteId);
    statuses.push({ worldResourceStateId: `WORLD_RESOURCE_${state.worldKey}_${resourceNodeId}`, resourceNodeId, controllerType: settlement ? "STATE" : "DIFFUSE", controllerId: settlement?.stateId ?? site.regionId, discoveryYear: state.year, availability: "AVAILABLE", seizedByEventId: null });
  }
  const working = { ...state, resourceNodes: nodes.sort((a, b) => a.resourceNodeId.localeCompare(b.resourceNodeId)), worldResourceStates: statuses.sort((a, b) => a.worldResourceStateId.localeCompare(b.worldResourceStateId)) };
  return { state: working, events: [event(state, "RESOURCE_GEOGRAPHY", "ResourceGeographyEstablished", "WORLD", state.worldKey, { physicalResourceNodes: nodes.length, worldResourceStatuses: statuses.length, policySha256: createHash("sha256").update(JSON.stringify(policy)).digest("hex") })] };
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
  const policy = needsPolicy(state, context, "RESOURCE_INDUSTRY", "UPDATE_SETTLEMENT_INDUSTRY_AND_GUILDS");
  const prior = new Map((state.industries ?? []).map((row) => [row.industryStateId, row])); const industries: IndustryStateV5[] = [];
  for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) for (const industryType of V5_INDUSTRY_TYPES) {
    const industryStateId = `INDUSTRY_${state.worldKey}_${settlement.settlementId}_${industryType}`;
    const dependencies = policy.industryResourceDependencies[industryType] ?? [];
    const availableNodes = (state.resourceNodes ?? []).filter((node) => node.siteId === settlement.siteId && dependencies.includes(node.resourceType) && state.worldResourceStates?.some((status) => status.resourceNodeId === node.resourceNodeId && status.availability === "AVAILABLE"));
    const dependency = dependencies.length === 0 ? 0 : clamp(Number(divideRoundedAway(BigInt(availableNodes.length * 1000), BigInt(dependencies.length))), 0, 1000);
    const sectorStrength = settlement.sectorStrengths[sectorForIndustry(industryType)];
    const averageQuality = availableNodes.length === 0 ? 0 : Number(divideRoundedAway(BigInt(availableNodes.reduce((sum, node) => sum + node.quality, 0)), BigInt(availableNodes.length)));
    const target = dependencies.length === 0 ? sectorStrength : availableNodes.length === 0 ? 0 : clamp(Number(divideRoundedAway(BigInt(dependency + averageQuality + sectorStrength), 3n)), 0, 1000);
    const strength = prior.has(industryStateId) ? blend(prior.get(industryStateId)!.strength, target, policy.industryInertiaBps) : target >= policy.industryFormationMinimum ? target : 0;
    const employmentNumerator = COERCIVE.has(industryType) ? 35 : 65;
    industries.push({ industryStateId, settlementId: settlement.settlementId, industryType, strength, employment: clamp(Number(divideRoundedAway(BigInt(strength * employmentNumerator), 100n)), 0, 1000), dependency, coercion: COERCIVE.has(industryType) ? clamp(strength, 0, 1000) : 0, disruptedUntilYear: prior.get(industryStateId)?.disruptedUntilYear ?? null, supportingResourceNodeIds: availableNodes.map((row) => row.resourceNodeId).sort(), supportingInstitutionIds: (state.institutions ?? []).filter((row) => row.jurisdictionSettlementId === settlement.settlementId && row.dissolvedYear === null).map((row) => row.institutionId).sort(), sourcePolicyRef: policy.schemaVersion });
  }
  let organizations = [...state.organizations]; let stakes = [...state.ownershipStakes]; let institutions = [...state.institutions]; let timedConditions = [...state.timedConditions]; const events: CausalEventV5[] = []; const namingRequests: NamingRequestV5[] = [];
  for (const industry of industries.filter((row) => row.strength >= policy.guildFormationThreshold && !COERCIVE.has(row.industryType))) {
    const organizationId = `GUILD_${state.worldKey}_${industry.settlementId}_${industry.industryType}`;
    if (organizations.some((row) => row.organizationId === organizationId)) continue;
    const candidateKey = `${organizationId}/CANDIDATE`; const priorCondition = state.timedConditions.find((row) => row.key === candidateKey);
    if ((priorCondition?.qualifyingReviewCount ?? 0) + 1 < policy.guildRequiredReviews) {
      timedConditions.push({ conditionId: `COND_${digest([candidateKey]).slice(0, 24)}`, type: "GUILD_FORMATION_CANDIDATE", targetType: "SETTLEMENT", targetId: industry.settlementId, magnitude: industry.strength, startYear: priorCondition?.startYear ?? state.year, endYear: null, sourceEventId: `EVT_${organizationId}_CANDIDATE`, key: candidateKey, qualifyingReviewCount: (priorCondition?.qualifyingReviewCount ?? 0) + 1 });
      continue;
    }
    const settlement = state.settlements.find((row) => row.settlementId === industry.settlementId)!;
    const organization: OrganizationV5 = { organizationId, type: "GUILD", sectorId: sectorForIndustry(industry.industryType), homeSettlementId: industry.settlementId, founderControllerType: "DIFFUSE", founderControllerId: `MEMBERS_${organizationId}`, wealth: clamp(industry.strength, 0, 1000), influence: clamp(Number(divideRoundedAway(BigInt(industry.strength), 2n)), 0, 1000), status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: state.year, dissolutionYear: null };
    organizations.push(organization); stakes.push({ stakeId: `STAKE_${organizationId}_MEMBERS`, organizationId, controllerType: "DIFFUSE", controllerId: `MEMBERS_${organizationId}`, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: state.year, endYear: null, sourceEventId: `EVT_${organizationId}_FORMED` });
    institutions.push({ institutionId: `INSTITUTION_${organizationId}`, stateId: settlement.stateId, institutionType: "GUILD", jurisdictionSettlementId: settlement.settlementId, capacity: industry.strength, foundedYear: state.year, dissolvedYear: null });
    events.push(event(state, "ORGANIZATION", "GuildFormed", "ORGANIZATION", organizationId, { settlementId: industry.settlementId, industryType: industry.industryType, strength: industry.strength, createsChamberSeats: false }));
    namingRequests.push({ requestId: `NAME_${organizationId}`, entityType: "ORGANIZATION", entityId: organizationId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey, acceptedLabel: null, context: { causalReason: "GUILD_FORMED", settlementId: industry.settlementId, industryType: industry.industryType } });
  }
  const formedIds = new Set(organizations.filter((row) => row.type === "GUILD").map((row) => `${row.organizationId}/CANDIDATE`));
  timedConditions = timedConditions.filter((row) => row.type !== "GUILD_FORMATION_CANDIDATE" || !formedIds.has(row.key));
  return { state: { ...state, industries, organizations: organizations.sort((a, b) => a.organizationId.localeCompare(b.organizationId)), ownershipStakes: stakes, institutions: institutions.sort((a, b) => a.institutionId.localeCompare(b.institutionId)), timedConditions }, events, namingRequests };
}

function statePopulation(state: WorldStateV5, stateId: string): bigint { const settlements = new Set(state.settlements.filter((row) => row.stateId === stateId).map((row) => row.settlementId)); return state.cohorts.filter((cell) => settlements.has(cell.settlementId)).reduce((sum, cell) => sum + V5_TIERS.reduce((tierSum, tier) => tierSum + cell.tiers[tier].population, 0n), 0n); }

export function updateCivicInstitutionsAndSecurityV5(state: WorldStateV5, context: HistoricalMechanicsContextV5): { state: WorldStateV5; events: CausalEventV5[] } {
  const policy = needsPolicy(state, context, "CIVIC_INSTITUTION_SECURITY", "UPDATE_CIVIC_INSTITUTION_CAPACITY_AND_SECURITY");
  let institutions = [...state.institutions]; const events: CausalEventV5[] = [];
  const automaticTypes: CivicInstitutionTypeV5[] = ["BUREAUCRACY", "FAITH", "EDUCATION", "HEALTH_CARE", "NEWSPAPER_PRESS", "LAW", "COURTS", "PRISON", "BANKING", "MILITARY_SECURITY"];
  for (const settlement of [...state.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))) {
    const population = state.cohorts.filter((row) => row.settlementId === settlement.settlementId).reduce((sum, cell) => sum + V5_TIERS.reduce((tierSum, tier) => tierSum + cell.tiers[tier].population, 0n), 0n);
    if (population < policy.institutionFormationMinimumPopulation) continue;
    for (const institutionType of automaticTypes.filter((type) => policy.supportedInstitutionTypes.includes(type))) {
      const institutionId = `CIVIC_${state.worldKey}_${settlement.settlementId}_${institutionType}`;
      const base = policy.baseCapacityByType[institutionType]; const target = clamp(Number(divideRoundedAway(BigInt(base + settlement.sectorStrengths[sectorForIndustry(institutionType === "BANKING" ? "BANKING" : institutionType === "EDUCATION" ? "EDUCATION" : institutionType === "HEALTH_CARE" ? "HEALTH_CARE" : institutionType === "MILITARY_SECURITY" ? "SECURITY" : "ADMINISTRATION")]), 2n)), 0, 1000);
      const prior = institutions.find((row) => row.institutionId === institutionId);
      if (prior) institutions = institutions.map((row) => row.institutionId === institutionId ? { ...row, capacity: blend(row.capacity ?? base, target, policy.capacityInertiaBps) } : row);
      else if (target >= policy.institutionFormationThreshold) { institutions.push({ institutionId, stateId: settlement.stateId, institutionType, jurisdictionSettlementId: settlement.settlementId, capacity: target, foundedYear: state.year, dissolvedYear: null }); events.push(event(state, "INSTITUTION_CAPACITY", "CivicInstitutionFounded", "INSTITUTION", institutionId, { institutionType, settlementId: settlement.settlementId, capacity: target, createsChamberSeats: false })); }
    }
  }
  let forces = [...(state.securityForces ?? [])];
  const createForce = (forceType: SecurityForceTypeV5, controllerType: "STATE" | "FAMILY" | "ORGANIZATION" | "INSTITUTION", controllerId: string, jurisdictionType: "SETTLEMENT" | "STATE" | "ORGANIZATION", jurisdictionId: string, population: bigint) => {
    const forceId = `SECURITY_${state.worldKey}_${forceType}_${digest([controllerId, jurisdictionId]).slice(0, 20)}`; if (forces.some((row) => row.securityForceId === forceId)) return;
    const personnel = population / 500n > 0n ? population / 500n : 1n; const quality = policy.securityFormationThreshold;
    forces.push({ securityForceId: forceId, forceType, controllerType, controllerId, jurisdictionType, jurisdictionId, organizationId: forceId, personnel, seniorOfficerPersonIds: [], loyalty: state.states.find((row) => row.stateId === (controllerType === "STATE" ? controllerId : state.settlements.find((row) => row.settlementId === jurisdictionId)?.stateId))?.factionAffinity ?? { CONCORD: 334, SCHISM: 333, RUIN: 333 }, training: quality, equipment: quality, morale: 500, cohesion: 500, commandQuality: 500, suppressionCapacity: clamp(Number(divideRoundedAway(BigInt(quality * 6), 10n)), 0, 1000), combatCapacity: clamp(Number(divideRoundedAway(BigInt(quality * 7), 10n)), 0, 1000), status: "ACTIVE", foundedYear: state.year, recoveryUntilYear: null });
    events.push(event(state, "SECURITY", "SecurityForceFormed", "SECURITY_FORCE", forceId, { forceType, controllerType, controllerId, jurisdictionType, jurisdictionId, personnel: personnel.toString() }));
  };
  for (const settlement of state.settlements) if (institutions.some((row) => row.jurisdictionSettlementId === settlement.settlementId && row.institutionType === "MILITARY_SECURITY" && (row.capacity ?? 0) >= policy.securityFormationThreshold)) createForce("CITY_WATCH", "STATE", settlement.stateId, "SETTLEMENT", settlement.settlementId, statePopulation(state, settlement.stateId));
  for (const politicalState of state.states) if (institutions.some((row) => row.stateId === politicalState.stateId && row.institutionType === "MILITARY_SECURITY")) createForce("STATE_GUARD", "STATE", politicalState.stateId, "STATE", politicalState.stateId, statePopulation(state, politicalState.stateId));
  for (const family of state.families.filter((row) => row.status === "ACTIVE" && row.wealth >= policy.securityFormationThreshold)) createForce("FAMILY_GUARD", "FAMILY", family.familyId, "SETTLEMENT", family.homeSettlementId, statePopulation(state, state.settlements.find((row) => row.settlementId === family.homeSettlementId)!.stateId));
  for (const organization of state.organizations.filter((row) => row.status === "ACTIVE" && row.wealth >= policy.securityFormationThreshold)) createForce(organization.type === "CRIME_ORGANIZATION" ? "CRIMINAL_ENFORCERS" : organization.type === "CORPORATION" ? "CORPORATE_SECURITY" : "MERCENARIES", "ORGANIZATION", organization.organizationId, "ORGANIZATION", organization.organizationId, statePopulation(state, state.settlements.find((row) => row.settlementId === organization.homeSettlementId)!.stateId));
  return { state: { ...state, institutions: institutions.sort((a, b) => a.institutionId.localeCompare(b.institutionId)), securityForces: forces.sort((a, b) => a.securityForceId.localeCompare(b.securityForceId)) }, events };
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
