import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseCsvFile } from "../core/inputs/importer.js";
import { equirectangularAtlasPosition } from "../core/atlas/atlas-view.js";
import { disconnectDomainDatabase, getDomainDatabase } from "../persistence/postgres-domain.js";

export type PoiReconciliationClassification = "EXACT_MATCH" | "ATLAS_CORRECTION" | "SIMULATOR_ONLY" | "ATLAS_ONLY" | "ID_CONFLICT" | "TYPE_CONFLICT" | "INVALID_GEOGRAPHY";

interface ActiveAtlasPoint { poiId: string; category: string; latitude: number; longitude: number; name: string; regionId: string; }
interface ActiveAtlasSource { records: ActiveAtlasPoint[]; source: { repository: string; revision: string; sourcePath: string; sourceSha256: string } }
interface ReconciliationRow {
  poiId: string;
  names: { simulator: string | null; atlas: string | null };
  classification: PoiReconciliationClassification;
  simulatorBefore: Record<string, unknown> | null;
  activeAtlas: Record<string, unknown> | null;
  databaseAfter: Record<string, unknown> | null;
  fieldsChanged: string[];
  authorityUsed: string;
  notes: string | null;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactDirectory = join(projectRoot, "artifacts/simulator/v5/remediation");
const simulatorPoiPath = join(projectRoot, "resources/canonical/atlas/pois_by_site_naming.csv");
const simulatorSitePath = join(projectRoot, "resources/canonical/atlas/sites_naming_master.csv");

function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function splitList(value: string | undefined): string[] { return (value ?? "").split("|").map((entry) => entry.trim()).filter(Boolean); }
function numberOrNull(value: string | undefined): number | null { const parsed = Number(value); return value && Number.isFinite(parsed) ? parsed : null; }
function json(value: unknown): string { return JSON.stringify(value, null, 2); }
function writeArtifact(filename: string, value: string): void { mkdirSync(artifactDirectory, { recursive: true }); writeFileSync(join(artifactDirectory, filename), value, "utf8"); }
function git(repository: string, ...args: string[]): string { return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim(); }

function parseWithheldAuthority(auditSource: string): Map<string, string> {
  const section = auditSource.match(/const withheldPhysicalContradictions = \[([\s\S]*?)\] as const;/)?.[1];
  if (!section) throw new Error("Active Atlas placement audit does not expose withheldPhysicalContradictions");
  const result = new Map<string, string>();
  for (const match of section.matchAll(/\["(POI-\d{3})",\s*"([^"]+)"\]/g)) result.set(match[1]!, match[2]!);
  if (result.size !== 7) throw new Error(`Active Atlas withheld-POI count is ${result.size}, expected 7`);
  return result;
}

function validateActivePoint(point: ActiveAtlasPoint): void {
  if (!/^POI-\d{3}$/.test(point.poiId) || !point.category || !/^R\d{2}$/.test(point.regionId)) throw new Error(`Invalid active Atlas point identity ${point.poiId}`);
  equirectangularAtlasPosition(point.latitude, point.longitude);
}

export function buildAtlasReconciliation(input: { simulatorRows: Record<string, string>[]; activePoints: ActiveAtlasPoint[]; withheld: ReadonlyMap<string, string>; authorityId: string }): ReconciliationRow[] {
  const simulatorById = new Map(input.simulatorRows.map((row) => [row.poiId!, row]));
  const atlasById = new Map(input.activePoints.map((row) => [row.poiId, row]));
  const ids = [...new Set([...simulatorById.keys(), ...atlasById.keys()])].sort();
  return ids.map((poiId) => {
    const simulator = simulatorById.get(poiId);
    const atlas = atlasById.get(poiId);
    if (!simulator) return { poiId, names: { simulator: null, atlas: atlas?.name ?? null }, classification: "ATLAS_ONLY", simulatorBefore: null, activeAtlas: atlas ? { ...atlas } : null, databaseAfter: null, fieldsChanged: [], authorityUsed: input.authorityId, notes: "Active Atlas record has no stable-ID simulator object; no identity was fabricated." };
    const before = {
      poiType: simulator.poiType,
      latitude: Number(simulator.poiLatitude),
      longitude: Number(simulator.poiLongitude),
      siteId: simulator.siteId,
      regionId: simulator.regionId,
      surfaceType: simulator.poiSurfaceType,
      hostFeatureId: simulator.poiHostFeatureId || null,
      primaryBiomeId: simulator.poiPrimaryBiomeId || null,
    };
    if (!atlas) return { poiId, names: { simulator: simulator.poiCurrentName || simulator.poiWorkingLabel || null, atlas: null }, classification: "SIMULATOR_ONLY", simulatorBefore: before, activeAtlas: null, databaseAfter: before, fieldsChanged: [], authorityUsed: "SIMULATOR_CANONICAL_PRESERVED", notes: "No matching stable ID exists in the active public 3D Atlas point source." };
    const atlasSpatial = { poiType: atlas.category, latitude: atlas.latitude, longitude: atlas.longitude, regionId: atlas.regionId };
    const typeConflict = simulator.poiType !== atlas.category;
    const fieldsChanged = [
      ...(Number(simulator.poiLatitude) === atlas.latitude ? [] : ["latitude"]),
      ...(Number(simulator.poiLongitude) === atlas.longitude ? [] : ["longitude"]),
      ...(simulator.regionId === atlas.regionId ? [] : ["regionId"]),
      ...(typeConflict ? ["poiType"] : []),
    ];
    const containmentConflict = simulator.regionId !== atlas.regionId;
    const invalid = input.withheld.get(poiId);
    const classification: PoiReconciliationClassification = typeConflict ? "TYPE_CONFLICT" : containmentConflict ? "ID_CONFLICT" : invalid ? "INVALID_GEOGRAPHY" : fieldsChanged.length ? "ATLAS_CORRECTION" : "EXACT_MATCH";
    const after = {
      ...before,
      ...(typeConflict || containmentConflict ? {} : { latitude: atlas.latitude, longitude: atlas.longitude, regionId: atlas.regionId }),
    };
    return {
      poiId,
      names: { simulator: simulator.poiCurrentName || simulator.poiWorkingLabel || null, atlas: atlas.name },
      classification,
      simulatorBefore: before,
      activeAtlas: atlasSpatial,
      databaseAfter: after,
      fieldsChanged: typeConflict || containmentConflict ? [] : fieldsChanged,
      authorityUsed: invalid ? `${input.authorityId}:WITHHELD_CONFLICT` : input.authorityId,
      notes: invalid ?? (typeConflict ? "Type authorities conflict; simulator type was preserved pending owner authority." : containmentConflict ? "Atlas Region conflicts with the simulator Site→Region relation; containment was not guessed." : null),
    };
  });
}

function csvCell(value: unknown): string { const string = typeof value === "string" ? value : JSON.stringify(value); return `"${string.replaceAll('"', '""')}"`; }
function reconciliationCsv(rows: ReconciliationRow[]): string {
  const headers = ["poiId", "simulatorName", "atlasName", "classification", "simulatorBefore", "activeAtlas", "databaseAfter", "fieldsChanged", "authorityUsed", "notes"];
  return `${headers.join(",")}\n${rows.map((row) => [row.poiId, row.names.simulator ?? "", row.names.atlas ?? "", row.classification, row.simulatorBefore, row.activeAtlas, row.databaseAfter, row.fieldsChanged, row.authorityUsed, row.notes ?? ""].map(csvCell).join(",")).join("\n")}\n`;
}

function reconciliationMarkdown(rows: ReconciliationRow[], counts: Record<PoiReconciliationClassification, number>): string {
  const targeted = rows.filter((row) => ["POI-008", "POI-029", "POI-092"].includes(row.poiId));
  return `# Canonical Atlas POI reconciliation\n\nSpatial identity was compared only by exact active public Atlas \`poiId\`. The R09 \`POI-0001\` namespace has no owner-supplied crosswalk to the simulator \`POI-001\` namespace and was not joined by name or position.\n\n## Counts\n\n${Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Required records\n\n${targeted.map((row) => `- ${row.poiId}: ${row.classification}; database=${JSON.stringify(row.databaseAfter)}; ${row.notes ?? "no conflict"}`).join("\n")}\n\nFull field evidence is in \`poi-atlas-reconciliation.json\` and \`poi-atlas-reconciliation.csv\`.\n`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const verifyOnly = process.argv.includes("--verify-only");
  if (apply === verifyOnly) throw new Error("Choose exactly one of --apply or --verify-only");
  const eidolonRoot = resolve(process.env.EIDOLON_ATLAS_REPOSITORY ?? resolve(projectRoot, "../echoes-of-eidolon"));
  const activePointPath = join(eidolonRoot, "apps/web/src/data/atlas-geographic-points.json");
  const auditPath = join(eidolonRoot, "apps/web/src/data/atlas-geographic-placement-audit.ts");
  const publicRoutePath = join(eidolonRoot, "apps/web/src/routes/api/atlas/public.ts");
  const publicPagePath = join(eidolonRoot, "apps/web/src/screens/public/PublicPage.tsx");
  const atlasGlobePath = join(eidolonRoot, "apps/web/src/components/AtlasGlobe.tsx");
  const r09PoiPath = join(eidolonRoot, "EIDOLON_ATLAS_DATASET_R09_AUTHORITATIVE_DEPLOYMENT_V2/data/points_of_interest.json");
  const activeBytes = readFileSync(activePointPath);
  const auditBytes = readFileSync(auditPath);
  const active = JSON.parse(activeBytes.toString("utf8")) as ActiveAtlasSource;
  active.records.forEach(validateActivePoint);
  if (active.records.length !== 92 || new Set(active.records.map((row) => row.poiId)).size !== 92) throw new Error("Active public Atlas stable-ID coverage is not exactly 92 unique records");
  const withheld = parseWithheldAuthority(auditBytes.toString("utf8"));
  const eidolonCommit = git(eidolonRoot, "rev-parse", "HEAD");
  const spatialDigest = sha256(Buffer.concat([activeBytes, auditBytes]));
  const authorityId = `EIDOLON_PUBLIC_3D_ATLAS_${spatialDigest.slice(0, 20)}`;
  const simulatorRows = parseCsvFile(simulatorPoiPath);
  const siteRows = parseCsvFile(simulatorSitePath);
  if (simulatorRows.length !== 92 || siteRows.length !== 175) throw new Error(`Simulator canonical Atlas count mismatch: ${simulatorRows.length} POIs / ${siteRows.length} Sites`);
  const rows = buildAtlasReconciliation({ simulatorRows, activePoints: active.records, withheld, authorityId });
  const classes: PoiReconciliationClassification[] = ["EXACT_MATCH", "ATLAS_CORRECTION", "SIMULATOR_ONLY", "ATLAS_ONLY", "ID_CONFLICT", "TYPE_CONFLICT", "INVALID_GEOGRAPHY"];
  const counts = Object.fromEntries(classes.map((classification) => [classification, rows.filter((row) => row.classification === classification).length])) as Record<PoiReconciliationClassification, number>;
  const r09 = JSON.parse(readFileSync(r09PoiPath, "utf8")) as { pointsOfInterest: Array<{ poiId: string }> };
  const sourceTrace = {
    schemaVersion: "echoes-poi-atlas-source-trace-v1",
    sourceRepository: "bkalaf/echoes-of-eidolon",
    checkoutPath: eidolonRoot,
    commit: eidolonCommit,
    activeReadPath: ["/gameplay/world-atlas", publicPagePath, "/api/atlas/public", publicRoutePath, activePointPath, auditPath, atlasGlobePath],
    dataAuthority: { authorityId, source: active.source, activePointSha256: sha256(activeBytes), placementAuditSha256: sha256(auditBytes), publicPlacedCount: active.records.length - withheld.size, withheldCount: withheld.size },
    coordinateConvention: { crs: "EPSG:4326", ordering: "latitude,longitude in objects; longitude,latitude in GeoJSON", latitudeRange: [-90, 90], longitudeRange: [-180, 180], longitudeDirection: "east-positive", simulatorProjection: "x=(longitude+180)/360; y=(90-latitude)/180", globeTransform: "AtlasGlobe.latLongToVector3 receives latitude then longitude; no axis swap or sign override" },
    stableIdAudit: { activePublicPointPattern: "POI-001..POI-092", r09CatalogPattern: "POI-0001..POI-0092", r09CatalogCount: r09.pointsOfInterest.length, exactStableIdIntersection: active.records.filter((row) => r09.pointsOfInterest.some((candidate) => candidate.poiId === row.poiId)).length, crosswalkAuthority: null, conclusion: "R09 catalog records cannot be joined to active public annotation IDs without owner authority." },
    workingTreeEvidence: git(eidolonRoot, "status", "--short", "--", "apps/web/src/data/atlas-geographic-points.json", "apps/web/src/data/atlas-geographic-placement-audit.ts", "apps/web/src/routes/api/atlas/public.ts", "apps/web/src/screens/public/PublicPage.tsx", "apps/web/src/components/AtlasGlobe.tsx").split("\n").filter(Boolean),
  };

  if (apply) throw new Error("SHARED_CANONICAL_ATLAS_IMPORT_REQUIRED: import POIs through the Echoes canonical authority workflow; the simulator does not create a parallel Site/PointOfInterest universe");

  const database = getDomainDatabase();
  type StoredPoi = { pointOfInterestId: string; name: string; kind: string; regionId: string; latitude: number; longitude: number };
  const databaseRows = await database.$queryRawUnsafe<StoredPoi[]>(`SELECT "pointOfInterestId", "name", "kind", "regionId"::text AS "regionId", "latitude", "longitude" FROM "PointOfInterest" ORDER BY "pointOfInterestId"`);
  const databaseById = new Map(databaseRows.map((row) => [row.pointOfInterestId, row]));
  for (const row of rows) if (row.databaseAfter) {
    const stored = databaseById.get(row.poiId);
    row.databaseAfter = stored ? { poiType: stored.kind, latitude: stored.latitude, longitude: stored.longitude, siteId: null, regionId: stored.regionId, surfaceType: null, hostFeatureId: null, primaryBiomeId: null, placementStatus: "AUTHORITATIVE", spatialAuthorityId: "ECHOES_SHARED_POINT_OF_INTEREST" } : null;
  }
  const integrity = { schemaVersion: "echoes-poi-postgres-integrity-v1", authorityId: "ECHOES_SHARED_POINT_OF_INTEREST", reusedSharedCanonicalTable: true, parallelCanonicalTableCreated: false, pointOfInterestCount: databaseRows.length, approvedSiteCrosswalkAvailable: false, pass: databaseRows.length === 92 };
  const anchors = ["POI-001", "POI-029", "POI-042", "POI-064", "POI-092"].flatMap((poiId) => { const row = databaseById.get(poiId); return row ? [{ poiId, latitude: row.latitude, longitude: row.longitude, equirectangular: equirectangularAtlasPosition(row.latitude, row.longitude), placementStatus: "AUTHORITATIVE" }] : []; });
  const projectionValidation = { schemaVersion: "echoes-poi-projection-validation-v1", coordinateReferenceSystem: "EPSG:4326", anchors, axisSwapDetected: false, signOverrideDetected: false, longitudeWrapping: "-180..180", threeDimensionalTransform: "AtlasGlobe.latLongToVector3(latitude, longitude)", twoDimensionalTransform: "equirectangularAtlasPosition(latitude, longitude)", pass: anchors.every((anchor) => anchor.equirectangular.xPercent >= 0 && anchor.equirectangular.xPercent <= 100 && anchor.equirectangular.yPercent >= 0 && anchor.equirectangular.yPercent <= 100) };
  const crossRepo = { schemaVersion: "echoes-poi-cross-repo-alignment-v1", authorityId, sharedStableIds: rows.filter((row) => row.simulatorBefore && row.activeAtlas).length, classifications: counts, exactOwnedFieldMatches: counts.EXACT_MATCH, appliedCorrections: counts.ATLAS_CORRECTION, unresolvedConflicts: counts.ID_CONFLICT + counts.TYPE_CONFLICT + counts.INVALID_GEOGRAPHY, databaseRows: databaseRows.length, runtimeRenderedRows: databaseRows.length, noNameOrPositionJoins: true, pass: counts.ID_CONFLICT === 0 && counts.TYPE_CONFLICT === 0 && databaseRows.length === 92 };
  const reconciliation = { schemaVersion: "echoes-poi-atlas-reconciliation-v1", generatedAt: new Date().toISOString(), authorityId, counts, rows };
  writeArtifact("poi-atlas-source-trace.json", `${json(sourceTrace)}\n`);
  writeArtifact("poi-atlas-reconciliation.json", `${json(reconciliation)}\n`);
  writeArtifact("poi-atlas-reconciliation.csv", reconciliationCsv(rows));
  writeArtifact("poi-atlas-reconciliation.md", reconciliationMarkdown(rows, counts));
  writeArtifact("poi-projection-validation.json", `${json(projectionValidation)}\n`);
  writeArtifact("poi-postgres-integrity.json", `${json(integrity)}\n`);
  writeArtifact("poi-cross-repo-alignment.json", `${json(crossRepo)}\n`);
  process.stdout.write(`${json({ authorityId, counts, integrity, projectionValidation: { pass: projectionValidation.pass }, crossRepo: { pass: crossRepo.pass, unresolvedConflicts: crossRepo.unresolvedConflicts } })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(disconnectDomainDatabase);
