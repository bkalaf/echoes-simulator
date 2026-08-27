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
  siteId: string;
  isMagical: boolean;
  isRuntimeEffectAnchor: boolean;
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
