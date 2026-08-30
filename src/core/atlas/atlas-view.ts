import { resolve } from "node:path";
import { parseCsvFile } from "../inputs/importer.js";

export interface AtlasPoi {
  poiId: string;
  poiType: string;
  workingLabel: string;
  nameStatus: string;
  latitude: number;
  longitude: number;
  regionId: string;
  regionName: string;
  siteId: string | null;
  isMagical: boolean | null;
  isRuntimeEffectAnchor: boolean | null;
  elevationM?: number | null;
  depthM?: number | null;
  surfaceType?: string;
  hostFeatureId?: string | null;
  primaryBiomeId?: string | null;
  placementStatus?: "AUTHORITATIVE" | "WITHHELD_CONFLICT" | "PRESENTATION_ONLY";
  spatialAuthorityId?: string;
}

export function loadAtlasPois(canonicalDirectory: string): AtlasPoi[] {
  return parseCsvFile(resolve(canonicalDirectory, "atlas/pois_by_site_naming.csv")).map((row) => ({
    poiId: row.poiId!,
    poiType: row.poiType!,
    workingLabel: row.poiCurrentName || row.poiWorkingLabel || "",
    nameStatus: row.poiNameStatus || "WORKING",
    latitude: Number(row.poiLatitude),
    longitude: Number(row.poiLongitude),
    regionId: row.regionId!,
    regionName: row.regionName!,
    siteId: row.siteId!,
    isMagical: row.isMagical === "True",
    isRuntimeEffectAnchor: row.isRuntimeEffectAnchor === "True",
  })).sort((left, right) => left.poiId.localeCompare(right.poiId));
}

export function equirectangularAtlasPosition(latitude: number, longitude: number): { xPercent: number; yPercent: number } {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error(`Invalid EPSG:4326 latitude ${latitude}`);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error(`Invalid EPSG:4326 longitude ${longitude}`);
  return { xPercent: (longitude + 180) / 360 * 100, yPercent: (90 - latitude) / 180 * 100 };
}
