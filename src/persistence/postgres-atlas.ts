import type { PrismaClient } from "@prisma/client";
import type { AtlasPoi } from "../core/atlas/atlas-view.js";
import { getDomainDatabase } from "./postgres-domain.js";

type SharedCanonicalPoiRow = { pointOfInterestId: string; name: string; kind: string; regionId: string; longitude: number; latitude: number };

/** Read the existing Echoes PointOfInterest table; never create a parallel POI universe. */
export async function loadCanonicalAtlasPois(database: PrismaClient = getDomainDatabase()): Promise<AtlasPoi[]> {
  const rows = await database.$queryRawUnsafe<SharedCanonicalPoiRow[]>(`SELECT "pointOfInterestId", "name", "kind", "regionId"::text AS "regionId", "longitude", "latitude" FROM "PointOfInterest" ORDER BY "pointOfInterestId" ASC`);
  if (rows.length === 0) throw new Error("PostgreSQL shared canonical PointOfInterest authority is empty; import through the Echoes canonical authority workflow before opening the Atlas");
  return rows.map((row) => ({
    poiId: row.pointOfInterestId,
    poiType: row.kind,
    workingLabel: row.name,
    nameStatus: "CANONICAL_SHARED",
    latitude: row.latitude,
    longitude: row.longitude,
    regionId: row.regionId,
    regionName: row.regionId,
    siteId: null,
    isMagical: null,
    isRuntimeEffectAnchor: null,
    placementStatus: "AUTHORITATIVE",
    spatialAuthorityId: "ECHOES_SHARED_POINT_OF_INTEREST",
  }));
}

/** Only spatially approved rows may become interactive Atlas markers. */
export function runtimeVisibleAtlasPois(rows: readonly AtlasPoi[]): AtlasPoi[] {
  return rows.filter((row) => row.placementStatus === "AUTHORITATIVE");
}
