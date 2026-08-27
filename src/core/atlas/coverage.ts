import { resolve } from "node:path";
import { parseCsvFile } from "../inputs/importer.js";
import type { CanonicalDataV5 } from "../v5/config.js";
import type { NamingRequestV5, WorldKey, WorldStateV5 } from "../v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const HYDROLOGY_TYPES = new Set(["RIVER", "STREAM", "TRIBUTARY", "RAPIDS", "WATERFALL", "DELTA", "ESTUARY", "LAKE"]);
const BASE_WATERCOURSE_TYPES = new Set(["RIVER", "STREAM", "TRIBUTARY"]);

export interface PoiCoverageRow {
  poiId: string;
  type: string;
  physicalIdentity: string | null;
  workingLabel: string;
  regionId: string;
  regionName: string;
  siteId: string;
  settlementIdByWorld: Partial<Record<WorldKey, string>>;
  worlds: Record<WorldKey, { name: string | null; nameStatus: "CANONICAL" | "ACCEPTED" | "PENDING"; namingBehavior: "AUTOMATIC_REUSE" | "BATCHED"; namingRequestHistory: string[] }>;
}

export function buildPoiCoverage(canonical: CanonicalDataV5, states: Partial<Record<WorldKey, WorldStateV5>> = {}, labels: Partial<Record<WorldKey, Readonly<Record<string, string>>>> = {}, requests: Partial<Record<WorldKey, readonly NamingRequestV5[]>> = {}): { rows: PoiCoverageRow[]; summary: Record<string, unknown>; hydrology: Record<string, unknown> } {
  const rows = canonical.physicalPois.map((poi) => {
    const physicalIdentity = poi.hostFeatureId;
    const worlds = Object.fromEntries(WORLDS.map((world) => {
      const entityId = `WORLD_POI_${world}_${poi.poiId}`;
      const accepted = labels[world]?.[entityId] ?? null;
      const canonicalName = poi.nameStatus === "CANONICAL" ? poi.workingLabel : null;
      const matching = (requests[world] ?? []).filter((request) => request.entityId === entityId);
      return [world, { name: accepted ?? canonicalName, nameStatus: accepted ? "ACCEPTED" as const : canonicalName ? "CANONICAL" as const : "PENDING" as const, namingBehavior: canonicalName ? "AUTOMATIC_REUSE" as const : "BATCHED" as const, namingRequestHistory: matching.map((request) => `${request.createdYear}:${request.requestId}:${request.acceptedLabel ? "ACCEPTED" : "PENDING"}`) }];
    })) as PoiCoverageRow["worlds"];
    return { poiId: poi.poiId, type: poi.poiType, physicalIdentity, workingLabel: poi.workingLabel, regionId: poi.regionId, regionName: poi.regionName, siteId: poi.siteId, settlementIdByWorld: Object.fromEntries(WORLDS.flatMap((world) => { const settlement = states[world]?.settlements.find((candidate) => candidate.siteId === poi.siteId); return settlement ? [[world, settlement.settlementId]] : []; })), worlds };
  });
  const byType = Object.fromEntries([...new Set(rows.map((row) => row.type))].sort().map((type) => [type, rows.filter((row) => row.type === type).length]));
  const perWorld = Object.fromEntries(WORLDS.map((world) => [world, { named: rows.filter((row) => row.worlds[world].nameStatus !== "PENDING").length, unresolved: rows.filter((row) => row.worlds[world].nameStatus === "PENDING").length, working: rows.filter((row) => row.worlds[world].nameStatus === "PENDING" && row.workingLabel).length }])) as Record<WorldKey, unknown>;
  const base = rows.filter((row) => BASE_WATERCOURSE_TYPES.has(row.type));
  const baseHostIds = new Set(base.map((row) => row.physicalIdentity).filter(Boolean));
  const subfeature = (type: "RAPIDS" | "WATERFALL"): Record<string, unknown> => {
    const selected = rows.filter((row) => row.type === type);
    const withParentEntity = selected.filter((row) => row.physicalIdentity && baseHostIds.has(row.physicalIdentity));
    const withoutParentEntity = selected.filter((row) => !row.physicalIdentity || !baseHostIds.has(row.physicalIdentity));
    return {
      withParentEntity: withParentEntity.map((row) => row.poiId),
      withoutParentEntity: withoutParentEntity.map((row) => row.poiId),
      withNamedParentByWorld: Object.fromEntries(WORLDS.map((world) => [world, withParentEntity.filter((row) => {
        const parent = base.find((candidate) => candidate.physicalIdentity === row.physicalIdentity);
        return parent?.worlds[world].nameStatus !== "PENDING";
      }).map((row) => row.poiId)])),
      withoutNamedParentByWorld: Object.fromEntries(WORLDS.map((world) => [world, selected.filter((row) => {
        const parent = base.find((candidate) => candidate.physicalIdentity === row.physicalIdentity);
        return !parent || parent.worlds[world].nameStatus === "PENDING";
      }).map((row) => row.poiId)])),
      canonicalEntityGaps: withoutParentEntity.map((row) => ({ issueCode: "CANONICAL_HYDROLOGY_ENTITY_GAP", poiId: row.poiId, type: row.type, regionId: row.regionId, regionName: row.regionName, siteId: row.siteId, physicalIdentity: row.physicalIdentity, workingLabel: row.workingLabel })),
    };
  };
  const namedBaseByWorld = Object.fromEntries(WORLDS.map((world) => [world, base.filter((row) => row.worlds[world].nameStatus !== "PENDING").length]));
  const unresolvedBaseByWorld = Object.fromEntries(WORLDS.map((world) => [world, base.filter((row) => row.worlds[world].nameStatus === "PENDING").length]));
  const wrongRegionSiteAssociations = rows.flatMap((row) => {
    const site = canonical.sites.find((candidate) => candidate.siteId === row.siteId);
    return !site || site.regionId !== row.regionId ? [{ poiId: row.poiId, siteId: row.siteId, poiRegionId: row.regionId, siteRegionId: site?.regionId ?? null }] : [];
  });
  const foundedSettlementPoisMissingNamingRequests = Object.fromEntries(WORLDS.map((world) => [world, rows.filter((row) => row.settlementIdByWorld[world] && row.worlds[world].nameStatus === "PENDING" && !(requests[world] ?? []).some((request) => request.entityId === `WORLD_POI_${world}_${row.poiId}`)).map((row) => row.poiId)]));
  return { rows, summary: { totalPois: rows.length, byType, perWorld, wrongRegionSiteAssociations, foundedSettlementPoisMissingNamingRequests }, hydrology: { hydrologyEntityCount: rows.filter((row) => HYDROLOGY_TYPES.has(row.type)).length, baseWatercourseCount: base.length, namedBaseByWorld, unresolvedBaseByWorld, rapids: subfeature("RAPIDS"), waterfalls: subfeature("WATERFALL") } };
}

export function auditRawAtlasCsv(canonicalDirectory: string): { total: number; poi080: Record<string, string> | null } {
  const rows = parseCsvFile(resolve(canonicalDirectory, "atlas/pois_by_site_naming.csv"));
  return { total: rows.length, poi080: rows.find((row) => row.poiId === "POI-080") ?? null };
}
