import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, type CanonicalDataV5, type CausalOwnerInputsV1, type MechanicsVariablesV1 } from "./config.js";
import { classDistribution, deriveMetrics, settlementPopulation } from "./derivations.js";
import { effectiveRouteClassification, type RouteClassificationAuthorityV1 } from "./route-classification.js";
import type { CausalEventV5, NamingRequestV5, SocialClass, WorldRouteV5, WorldStateV5 } from "./types.js";

const CLASSES: readonly SocialClass[] = ["NOBILITY", "INTELLECTUAL", "WORKER", "WANDERER"];

function preferredAnchor(endpoints: readonly Record<string, unknown>[]): string | null {
  return [...endpoints].sort((left, right) => {
    const alignment = Number(Boolean(right.sovereignFactionAligned)) - Number(Boolean(left.sovereignFactionAligned));
    if (alignment !== 0) return alignment;
    const leftPopulation = BigInt(String(left.population ?? "0"));
    const rightPopulation = BigInt(String(right.population ?? "0"));
    if (leftPopulation !== rightPopulation) return leftPopulation > rightPopulation ? -1 : 1;
    return String(left.settlementId).localeCompare(String(right.settlementId));
  })[0]?.settlementId as string | undefined ?? null;
}

export interface RouteReconciliationResult { state: WorldStateV5; events: CausalEventV5[]; namingRequests: NamingRequestV5[]; }

export interface RouteCoverageReadModelV1 {
  directedEdgeCount: number;
  corridorCount: number;
  bidirectionalPairs: number;
  oneDirectionPairs: number;
  rows: {
    corridorId: string;
    regionA: { regionId: string; regionName: string; latitude: number; longitude: number };
    regionB: { regionId: string; regionName: string; latitude: number; longitude: number };
    canonicalDirectionality: string;
    portalCapability: boolean;
    primaryMode: string;
    infrastructureClass: string;
    tradeDesignation: boolean;
    resolutionAuthority: string;
    semanticReadiness: "READY" | "NOT_READY";
    classificationStatus: "OWNER_APPROVED" | "OWNER_APPROVAL_REQUIRED";
    classificationAuthorityVersion: string | null;
    ownerEvidenceRef: string | null;
    worlds: Partial<Record<import("./types.js").WorldKey, {
      routeId: string; active: boolean; name: string | null; nameStatus: "ACCEPTED" | "PENDING" | "NAMEABLE" | "INACTIVE" | "NOT_READY"; establishedYear: number | null;
      primaryMode: string; infrastructureClass: string; tradeDesignation: boolean; preferredNamingAnchor: string | null; endpointSettlements: Record<string, unknown> | null;
      persistedPrimaryMode: string | null; persistedInfrastructureClass: string | null; persistedTradeDesignation: boolean | null;
      worldSovereignFaction: string | null; formalCrownAllegianceAuthority: unknown; nameProvenance: string | null;
    }>>;
  }[];
}

export function buildRouteCoverageReadModel(canonical: CanonicalDataV5, states: Partial<Record<import("./types.js").WorldKey, WorldStateV5>> = {}, labels: Partial<Record<import("./types.js").WorldKey, Readonly<Record<string, string>>>> = {}, requests: Partial<Record<import("./types.js").WorldKey, readonly NamingRequestV5[]>> = {}, classificationAuthority?: RouteClassificationAuthorityV1): RouteCoverageReadModelV1 {
  const worlds = ["CONCORD", "SCHISM", "RUIN"] as const;
  const regionInfo = (regionId: string): RouteCoverageReadModelV1["rows"][number]["regionA"] => {
    const sites = canonical.sites.filter((site) => site.regionId === regionId);
    const denominator = sites.length || 1;
    return { regionId, regionName: sites[0]?.regionName ?? regionId, latitude: sites.reduce((sum, site) => sum + site.latitude, 0) / denominator, longitude: sites.reduce((sum, site) => sum + site.longitude, 0) / denominator };
  };
  const directedEdgeCount = canonical.regions.reduce((sum, region) => sum + region.directedAdjacentRegionIds.length, 0);
  const rows = canonical.routeCorridors.map((corridor) => {
    const effective = effectiveRouteClassification(corridor, classificationAuthority);
    return {
    corridorId: corridor.corridorId, regionA: regionInfo(corridor.regionAId), regionB: regionInfo(corridor.regionBId), canonicalDirectionality: corridor.canonicalDirectionality,
    portalCapability: effective.portalCapability, primaryMode: effective.effectivePrimaryMode, infrastructureClass: effective.effectiveInfrastructureClass, tradeDesignation: effective.tradeDesignation, resolutionAuthority: corridor.resolutionAuthority,
    semanticReadiness: effective.semanticReadiness, classificationStatus: effective.classificationStatus, classificationAuthorityVersion: effective.classificationAuthorityVersion, ownerEvidenceRef: effective.ownerEvidenceRef,
    worlds: Object.fromEntries(worlds.map((world) => {
      const routeId = `WORLD_ROUTE_${world}_${corridor.corridorId}`;
      const route = states[world]?.worldRoutes.find((candidate) => candidate.routeId === routeId);
      const request = (requests[world] ?? []).find((candidate) => candidate.entityId === routeId);
      const name = labels[world]?.[routeId] ?? request?.acceptedLabel ?? null;
      const notReady = effective.semanticReadiness === "NOT_READY";
      return [world, {
        routeId, active: Boolean(route), name: notReady ? null : name, nameStatus: !route ? "INACTIVE" as const : notReady ? "NOT_READY" as const : name ? "ACCEPTED" as const : request ? "PENDING" as const : "NAMEABLE" as const,
        establishedYear: route?.establishedYear ?? null, primaryMode: effective.effectivePrimaryMode, infrastructureClass: effective.effectiveInfrastructureClass,
        tradeDesignation: effective.tradeDesignation, persistedPrimaryMode: route?.primaryMode ?? null, persistedInfrastructureClass: route?.infrastructureClass ?? null, persistedTradeDesignation: route?.tradeDesignation ?? null,
        preferredNamingAnchor: typeof request?.context?.preferredNamingAnchor === "string" ? request.context.preferredNamingAnchor : null,
        endpointSettlements: request?.context?.endpointSettlements && typeof request.context.endpointSettlements === "object" ? request.context.endpointSettlements as Record<string, unknown> : null,
        worldSovereignFaction: typeof request?.context?.worldSovereignFaction === "string" ? request.context.worldSovereignFaction : null,
        formalCrownAllegianceAuthority: request?.context?.formalCrownAllegianceAuthority ?? null, nameProvenance: name ? request?.requestId ?? "PERSISTED_LABEL" : null,
      }];
    })),
  }; });
  return { directedEdgeCount, corridorCount: rows.length, bidirectionalPairs: rows.filter((row) => row.canonicalDirectionality === "BIDIRECTIONAL").length, oneDirectionPairs: rows.filter((row) => row.canonicalDirectionality !== "BIDIRECTIONAL").length, rows };
}

export function reconcileWorldRoutes(state: WorldStateV5, canonical: CanonicalDataV5, ownerInputs: CausalOwnerInputsV1, mechanics: MechanicsVariablesV1): RouteReconciliationResult {
  const occupiedRegions = new Set(state.settlements.filter((settlement) => settlementPopulation(state, settlement.settlementId) > 0n).map((settlement) => settlement.regionId));
  const existing = new Set(state.worldRoutes.map((route) => route.corridorId));
  const additions: WorldRouteV5[] = [];
  const events: CausalEventV5[] = [];
  const namingRequests: NamingRequestV5[] = [];
  const metrics = deriveMetrics(state, canonical, mechanics);
  const collectEndpoint = (regionId: string): Record<string, unknown>[] => state.settlements.filter((settlement) => settlement.regionId === regionId).sort((left, right) => left.settlementId.localeCompare(right.settlementId)).map((settlement) => {
    const population = settlementPopulation(state, settlement.settlementId);
    const classes = Object.fromEntries(CLASSES.map((socialClass) => [socialClass, "0"])) as Record<SocialClass, string>;
    for (const cell of state.cohorts.filter((candidate) => candidate.settlementId === settlement.settlementId)) {
      const distribution = classDistribution(cell, ownerInputs);
      for (const socialClass of CLASSES) classes[socialClass] = (BigInt(classes[socialClass]) + distribution.HIGH[socialClass] + distribution.MID[socialClass] + distribution.LOW[socialClass]).toString();
    }
    const politicalState = state.states.find((candidate) => candidate.stateId === settlement.stateId)!;
    const settlementFaction = metrics.settlementDominantFactions[settlement.settlementId]!;
    const sovereignFaction = canonical.sovereigns[state.worldKey].sovereignFaction;
    return { settlementId: settlement.settlementId, siteId: settlement.siteId, acceptedOrCanonicalName: canonical.canonicalLabels[settlement.siteId] ?? null, population: population.toString(), classes, stateId: settlement.stateId, settlementFaction, stateFaction: politicalState.dominantFaction, sovereignFactionAligned: settlementFaction === sovereignFaction || politicalState.dominantFaction === sovereignFaction };
  });
  for (const corridor of canonical.routeCorridors) {
    if (existing.has(corridor.corridorId) || !occupiedRegions.has(corridor.regionAId) || !occupiedRegions.has(corridor.regionBId)) continue;
    const routeId = `WORLD_ROUTE_${state.worldKey}_${corridor.corridorId}`;
    additions.push({ routeId, corridorId: corridor.corridorId, primaryMode: corridor.primaryMode, infrastructureClass: corridor.infrastructureClass, tradeDesignation: corridor.tradeDesignation, establishedYear: state.year });
    const eventId = `EVT_${state.worldKey}_${state.year}_ROUTE_ESTABLISHED_${corridor.corridorId}`;
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId, worldKey: state.worldKey, year: state.year, phase: "ROUTE_INFRASTRUCTURE", sequence: events.length, eventType: "RouteEstablished", entityType: "WORLD_ROUTE", entityId: routeId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { corridorId: corridor.corridorId, regionAId: corridor.regionAId, regionBId: corridor.regionBId, primaryMode: corridor.primaryMode, infrastructureClass: corridor.infrastructureClass, tradeDesignation: corridor.tradeDesignation, populationCreated: "0" } });
    if (corridor.primaryMode !== "UNRESOLVED" && !(corridor.portalCapability && corridor.primaryMode === "NONE")) {
      const endpointA = collectEndpoint(corridor.regionAId);
      const endpointB = collectEndpoint(corridor.regionBId);
      namingRequests.push({ requestId: `NAME_REQUEST_${routeId}_${state.year}`, entityType: "WORLD_ROUTE", entityId: routeId, behavior: "BATCHED", createdYear: state.year, nameEffectiveFromYear: state.year, worldKey: state.worldKey,
        namingComparisonGroupId: `WORLD_ROUTE:${corridor.corridorId}`, comparisonAuthorityRef: `CANONICAL_ROUTE_CORRIDOR_ID:${corridor.corridorId}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: null, context: {
        routeId, corridorId: corridor.corridorId, world: state.worldKey, regionA: corridor.regionAId, regionB: corridor.regionBId, primaryMode: corridor.primaryMode, infrastructureClass: corridor.infrastructureClass,
        tradeDesignation: corridor.tradeDesignation, establishedYear: state.year, endpointSettlements: { [corridor.regionAId]: endpointA, [corridor.regionBId]: endpointB },
        worldSovereignFaction: canonical.sovereigns[state.worldKey].sovereignFaction, formalCrownAllegianceAuthority: null, preferredNamingAnchor: preferredAnchor([...endpointA, ...endpointB]),
        nearbyGeographicPois: canonical.physicalPois.filter((poi) => poi.regionId === corridor.regionAId || poi.regionId === corridor.regionBId).map((poi) => ({ poiId: poi.poiId, type: poi.poiType, workingLabel: poi.workingLabel })),
      } });
    }
  }
  return { state: additions.length ? { ...state, worldRoutes: [...state.worldRoutes, ...additions].sort((left, right) => left.routeId.localeCompare(right.routeId)) } : state, events, namingRequests };
}

export function buildNonCausalRouteNamingRequests(
  state: WorldStateV5,
  canonical: CanonicalDataV5,
  classificationAuthority: RouteClassificationAuthorityV1,
  ownerInputs: CausalOwnerInputsV1,
  mechanics: MechanicsVariablesV1,
  existingRequests: readonly NamingRequestV5[] = [],
): NamingRequestV5[] {
  const existingEntityIds = new Set(existingRequests.map((request) => request.entityId));
  const metrics = deriveMetrics(state, canonical, mechanics);
  const collectEndpoint = (regionId: string): Record<string, unknown>[] => state.settlements
    .filter((settlement) => settlement.regionId === regionId)
    .sort((left, right) => left.settlementId.localeCompare(right.settlementId))
    .map((settlement) => {
      const population = settlementPopulation(state, settlement.settlementId);
      const classes = Object.fromEntries(CLASSES.map((socialClass) => [socialClass, "0"])) as Record<SocialClass, string>;
      for (const cell of state.cohorts.filter((candidate) => candidate.settlementId === settlement.settlementId)) {
        const distribution = classDistribution(cell, ownerInputs);
        for (const socialClass of CLASSES) classes[socialClass] = (BigInt(classes[socialClass]) + distribution.HIGH[socialClass] + distribution.MID[socialClass] + distribution.LOW[socialClass]).toString();
      }
      const politicalState = state.states.find((candidate) => candidate.stateId === settlement.stateId);
      const settlementFaction = metrics.settlementDominantFactions[settlement.settlementId] ?? null;
      const sovereignFaction = canonical.sovereigns[state.worldKey].sovereignFaction;
      return {
        settlementId: settlement.settlementId,
        siteId: settlement.siteId,
        acceptedOrCanonicalName: canonical.canonicalLabels[settlement.siteId] ?? null,
        population: population.toString(),
        classes,
        stateId: settlement.stateId,
        settlementFaction,
        stateFaction: politicalState?.dominantFaction ?? null,
        sovereignFactionAligned: settlementFaction === sovereignFaction || politicalState?.dominantFaction === sovereignFaction,
      };
    });
  const requests: NamingRequestV5[] = [];
  for (const corridor of canonical.routeCorridors) {
    const effective = effectiveRouteClassification(corridor, classificationAuthority);
    if (effective.semanticReadiness !== "READY") continue;
    const route = state.worldRoutes.find((candidate) => candidate.corridorId === corridor.corridorId);
    if (!route || existingEntityIds.has(route.routeId)) continue;
    const endpointA = collectEndpoint(corridor.regionAId);
    const endpointB = collectEndpoint(corridor.regionBId);
    requests.push({
      requestId: `NAME_REQUEST_ROUTE_CLASSIFICATION_${state.worldKey}_${corridor.corridorId}_${classificationAuthority.authorityVersion}`,
      entityType: "WORLD_ROUTE",
      entityId: route.routeId,
      behavior: "BATCHED",
      createdYear: state.year,
      nameEffectiveFromYear: state.year,
      worldKey: state.worldKey,
      namingComparisonGroupId: `WORLD_ROUTE:${corridor.corridorId}`,
      comparisonAuthorityRef: `ROUTE_CLASSIFICATION_AUTHORITY:${classificationAuthority.authorityVersion}:${corridor.corridorId}`,
      comparisonGroupingVersion: "echoes-naming-comparison-groups-v1",
      acceptedLabel: null,
      context: {
        routeId: route.routeId,
        corridorId: corridor.corridorId,
        world: state.worldKey,
        regionA: corridor.regionAId,
        regionB: corridor.regionBId,
        effectivePrimaryMode: effective.effectivePrimaryMode,
        effectiveInfrastructureClass: effective.effectiveInfrastructureClass,
        portalCapability: effective.portalCapability,
        tradeDesignation: effective.tradeDesignation,
        classificationAuthorityVersion: classificationAuthority.authorityVersion,
        classificationOwnerEvidenceRef: effective.ownerEvidenceRef,
        persistedRouteHistory: {
          primaryMode: route.primaryMode,
          infrastructureClass: route.infrastructureClass,
          tradeDesignation: route.tradeDesignation,
          establishedYear: route.establishedYear,
        },
        endpointSettlements: { [corridor.regionAId]: endpointA, [corridor.regionBId]: endpointB },
        worldSovereignFaction: canonical.sovereigns[state.worldKey].sovereignFaction,
        formalCrownAllegianceAuthority: null,
        preferredNamingAnchor: preferredAnchor([...endpointA, ...endpointB]),
        nearbyGeographicPois: canonical.physicalPois
          .filter((poi) => poi.regionId === corridor.regionAId || poi.regionId === corridor.regionBId)
          .map((poi) => ({ poiId: poi.poiId, type: poi.poiType, workingLabel: poi.workingLabel })),
      },
    });
  }
  return requests.sort((left, right) => left.requestId.localeCompare(right.requestId));
}
