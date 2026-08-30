import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { ProjectionReadBoundaryV1 } from "../v5/projection-freshness.js";
import type { WorldKey } from "../v5/types.js";

export const ATLAS_OVERLAY_SCHEMA_VERSION = "echoes-dynamic-atlas-overlay-v1" as const;

export type AtlasOverlayLayerId = "STATE_TERRITORY" | "SETTLEMENT_INFLUENCE" | "REFUGE" | "RESOURCE" | "POI_CONTROL" | "ROUTE" | "RELIGIOUS_CENTER" | "INSTITUTION" | "CONFLICT";
export interface AtlasOverlayPointV1 { latitude: number; longitude: number }
export interface AtlasOverlayFeatureV1 {
  featureId: string;
  layer: AtlasOverlayLayerId;
  geometryType: "POINT" | "LINESTRING" | "POLYGON";
  coordinates: readonly AtlasOverlayPointV1[];
  controllerId: string | null;
  status: string;
  acceptedLabel: string | null;
  sourceIdentityId: string;
  evidenceRef: string;
}

export interface DynamicAtlasOverlayV1 {
  schemaVersion: typeof ATLAS_OVERLAY_SCHEMA_VERSION;
  producer: "echoes-simulator";
  geographyAuthorityRole: "EXTERNAL_CANONICAL_PHYSICAL_GEOMETRY";
  runId: string;
  worldKey: WorldKey;
  runYear: number;
  commonProjectedThroughYear: number;
  selectedDataYear: number;
  freshness: "CURRENT" | "STALE";
  mixedYearReadsAllowed: false;
  features: AtlasOverlayFeatureV1[];
  contentSha256: string;
}

function validCoordinates(feature: AtlasOverlayFeatureV1): boolean {
  return feature.coordinates.every(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180);
}

export function buildDynamicAtlasOverlayV1(input: { runId: string; worldKey: WorldKey; boundary: ProjectionReadBoundaryV1; features: readonly AtlasOverlayFeatureV1[] }): DynamicAtlasOverlayV1 {
  if (input.boundary.mixedYearReadsAllowed !== false) throw new Error("Atlas overlay cannot mix simulated years");
  const features = [...input.features].sort((left, right) => left.layer.localeCompare(right.layer) || left.featureId.localeCompare(right.featureId));
  if (new Set(features.map((feature) => feature.featureId)).size !== features.length) throw new Error("Atlas overlay feature IDs must be unique");
  for (const feature of features) {
    if (!validCoordinates(feature)) throw new Error(`Atlas feature ${feature.featureId} contains invalid EPSG:4326 coordinates`);
    if (feature.geometryType === "POINT" && feature.coordinates.length !== 1) throw new Error(`Atlas point ${feature.featureId} needs exactly one coordinate`);
    if (feature.geometryType === "LINESTRING" && feature.coordinates.length < 2) throw new Error(`Atlas line ${feature.featureId} needs at least two coordinates`);
    if (feature.geometryType === "POLYGON" && (feature.coordinates.length < 4 || canonicalJson(feature.coordinates[0]) !== canonicalJson(feature.coordinates.at(-1)))) throw new Error(`Atlas polygon ${feature.featureId} must be a closed ring`);
  }
  const content = { schemaVersion: ATLAS_OVERLAY_SCHEMA_VERSION, producer: "echoes-simulator" as const, geographyAuthorityRole: "EXTERNAL_CANONICAL_PHYSICAL_GEOMETRY" as const, runId: input.runId, worldKey: input.worldKey, runYear: input.boundary.runCurrentYear, commonProjectedThroughYear: input.boundary.commonProjectedThroughYear, selectedDataYear: input.boundary.selectedDataYear, freshness: input.boundary.freshness, mixedYearReadsAllowed: false as const, features };
  return { ...content, contentSha256: createHash("sha256").update(canonicalJson(content)).digest("hex") };
}
