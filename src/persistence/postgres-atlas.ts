import type { PrismaClient } from "@prisma/client";
import type { AtlasPoi } from "../core/atlas/atlas-view.js";
import { getDomainDatabase } from "./postgres-domain.js";
import { hydrateTypedAuthorityValues, type TypedAuthorityValue } from "./typed-authority-values.js";

type SharedCanonicalPoiRow = { pointOfInterestId: string; name: string; kind: string; regionId: string; longitude: number; latitude: number };

/** Read the existing Echoes PointOfInterest table; never create a parallel POI universe. */
export async function loadCanonicalAtlasPois(database: PrismaClient = getDomainDatabase()): Promise<AtlasPoi[]> {
  const [rows, geographyRevision] = await Promise.all([
    database.$queryRawUnsafe<SharedCanonicalPoiRow[]>(`SELECT "pointOfInterestId", "name", "kind", "regionId"::text AS "regionId", "longitude", "latitude" FROM "PointOfInterest" ORDER BY "pointOfInterestId" ASC`),
    database.canonicalAuthorityRevision.findFirst({ where: { authorityId: "CANONICAL_GEOGRAPHY_V5", status: "APPROVED", migrationReconciliation: { is: { status: "RECONCILED", unexplainedDifferenceCount: 0 } } }, include: { values: { orderBy: { valuePath: "asc" } } }, orderBy: [{ approvedAt: "desc" }, { revisionId: "desc" }] }),
  ]);
  if (rows.length === 0) throw new Error("PostgreSQL shared canonical PointOfInterest authority is empty; import through the Echoes canonical authority workflow before opening the Atlas");
  const geography = geographyRevision ? hydrateTypedAuthorityValues(geographyRevision.values as TypedAuthorityValue[]) as { physicalPois?: Array<{ poiId: string; siteId: string; regionId: string; regionName: string; continent?: string | null; hostFeatureId?: string | null; isMagical?: boolean | null; isRuntimeEffectAnchor?: boolean | null }> } : null;
  const physicalById = new Map((geography?.physicalPois ?? []).map((row) => [row.poiId, row]));
  return rows.map((row) => {
    const physical = physicalById.get(row.pointOfInterestId);
    if (physical && physical.regionId !== row.regionId) throw new Error(`ATLAS_STABLE_ID_RECONCILIATION_MISMATCH ${row.pointOfInterestId}`);
    return {
    poiId: row.pointOfInterestId,
    poiType: row.kind,
    workingLabel: row.name,
    nameStatus: "CANONICAL_SHARED",
    latitude: row.latitude,
    longitude: row.longitude,
    regionId: row.regionId,
    regionName: physical?.regionName ?? row.regionId,
    siteId: physical?.siteId ?? null,
    continent: physical?.continent ?? null,
    hostFeatureId: physical?.hostFeatureId ?? null,
    isMagical: physical?.isMagical ?? null,
    isRuntimeEffectAnchor: physical?.isRuntimeEffectAnchor ?? null,
    placementStatus: "AUTHORITATIVE",
    spatialAuthorityId: "ECHOES_SHARED_POINT_OF_INTEREST",
  };
  });
}

/** Only spatially approved rows may become interactive Atlas markers. */
export function runtimeVisibleAtlasPois(rows: readonly AtlasPoi[]): AtlasPoi[] {
  return rows.filter((row) => row.placementStatus === "AUTHORITATIVE");
}
