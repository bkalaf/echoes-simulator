import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { openValidatedZip, parseCsvFile, parseJsonLines } from "../core/inputs/importer.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import type { CanonicalDataV5 } from "../core/v5/config.js";
import { getDomainDatabase } from "./postgres-domain.js";
import { V5_CANONICAL_CORE_AUTHORITY_ID } from "./postgres-canonical.js";
import { flattenTypedAuthorityValues, hydrateTypedAuthorityValues, type TypedAuthorityValue } from "./typed-authority-values.js";

export const BREED_CATALOG_AUTHORITY_ID = "BREED_CATALOG_V5";
export const CANONICAL_DOMAIN_AUTHORITY_IDS = [
  BREED_CATALOG_AUTHORITY_ID,
  "CANONICAL_BREED_SIMULATION_PROFILE_V5",
  "CANONICAL_GEOGRAPHY_V5",
  "CANONICAL_GOVERNANCE_V5",
  "CANONICAL_ECONOMY_V5",
  "CANONICAL_ROUTE_CORRIDORS_V5",
  "CANONICAL_GENESIS_V5",
  "CANONICAL_NAMING_V5",
  "CANONICAL_EVENT_SKELETON_V5",
  V5_CANONICAL_CORE_AUTHORITY_ID,
] as const;

type CanonicalDomainAuthorityId = typeof CANONICAL_DOMAIN_AUTHORITY_IDS[number];
type Manifest = {
  schemaVersion: string;
  bundleVersion: string;
  buildReady: boolean;
  breedSemanticFilename: string;
  breedSemanticSha256: string;
  breedSemanticVerdict: string;
  year0ReadinessStatus: string;
  contentSha256: string;
  requiredFiles: Record<string, string>;
};
type BreedIdentity = { breedId: string; name: string; populationKind: string; speciesId: string | null; groupId: string | null; cultureId: string | null };
type BreedEffective = { breedId: string; factionObject: Record<"CONCORD" | "SCHISM" | "RUIN", number>; dominantFaction: ("CONCORD" | "SCHISM" | "RUIN")[] };
type SharedSiteMigrationRow = { siteId: string; regionId: string; candidateType: string; longitude: number; latitude: number };
type SharedPoiMigrationRow = { pointOfInterestId: string; name: string; kind: string; regionId: string; longitude: number; latitude: number };

export interface CanonicalDomainMigrationDefinition {
  authorityId: CanonicalDomainAuthorityId;
  authorityType: "MIGRATED_ACCEPTED_CANONICAL_DOMAIN" | "MIGRATED_ACCEPTED_CANONICAL_AGGREGATE";
  schemaVersion: string;
  content: unknown;
  contentSha256: string;
  sourceAuthorityRef: string;
  sourceManifestSha256: string;
  stableIdentityCount: number;
  typedValues: TypedAuthorityValue[];
}

export interface CanonicalDomainReconciliationResult {
  authorityId: CanonicalDomainAuthorityId;
  migrationId: string;
  revisionId: string;
  status: "RECONCILED" | "UNRESOLVED";
  stableIdentityCount: number;
  sourceValueCount: number;
  importedValueCount: number;
  unexplainedDifferenceCount: number;
  unexplainedDifferencePaths: string[];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertUnique(domain: string, ids: readonly string[], expected?: number): void {
  if (expected !== undefined && ids.length !== expected) throw new Error(`${domain} expected ${expected} stable identities, observed ${ids.length}`);
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error(`${domain} contains missing or duplicate stable identities`);
}

function zipMember(archive: ReturnType<typeof openValidatedZip>, name: string): Uint8Array {
  const value = archive.entries[`${archive.prefix}${name}`];
  if (!value) throw new Error(`Canonical Breed authority lacks ${name}`);
  return value;
}

function sourceRef(manifest: Manifest, files: readonly string[]): string {
  return canonicalJson({ bundleVersion: manifest.bundleVersion, files: [...files].sort().map((file) => ({ file, sha256: manifest.requiredFiles[file] })) });
}

function definition(input: {
  authorityId: CanonicalDomainAuthorityId;
  authorityType?: CanonicalDomainMigrationDefinition["authorityType"];
  schemaVersion: string;
  content: unknown;
  manifest: Manifest;
  manifestSha256: string;
  sourceFiles: readonly string[];
  stableIdentityCount: number;
}): CanonicalDomainMigrationDefinition {
  for (const file of input.sourceFiles) if (!input.manifest.requiredFiles[file]) throw new Error(`${input.authorityId} source ${file} is absent from the canonical manifest`);
  const contentSha256 = sha256(canonicalJson(input.content));
  const typedValues = flattenTypedAuthorityValues(input.content);
  if (sha256(canonicalJson(hydrateTypedAuthorityValues(typedValues))) !== contentSha256) throw new Error(`${input.authorityId} typed-value round trip changed canonical content`);
  return {
    authorityId: input.authorityId,
    authorityType: input.authorityType ?? "MIGRATED_ACCEPTED_CANONICAL_DOMAIN",
    schemaVersion: input.schemaVersion,
    content: input.content,
    contentSha256,
    sourceAuthorityRef: sourceRef(input.manifest, input.sourceFiles),
    sourceManifestSha256: input.manifestSha256,
    stableIdentityCount: input.stableIdentityCount,
    typedValues,
  };
}

export function buildCanonicalDomainMigrationDefinitions(sourceDirectory: string): CanonicalDomainMigrationDefinition[] {
  const directory = resolve(sourceDirectory);
  const manifestBytes = readFileSync(resolve(directory, "canonical_bundle_manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  if (manifest.schemaVersion !== "eidolon-canonical-bundle-manifest-v1" || manifest.buildReady !== true || manifest.breedSemanticVerdict !== "ACCEPT_SIMULATION_READY" || manifest.year0ReadinessStatus !== "PASS") throw new Error("Canonical source manifest is not accepted simulation-ready authority");
  for (const [file, expectedHash] of Object.entries(manifest.requiredFiles)) if (sha256(readFileSync(resolve(directory, file))) !== expectedHash) throw new Error(`Canonical source hash mismatch: ${file}`);
  const requiredContentHash = sha256(Object.entries(manifest.requiredFiles).map(([file, hash]) => `${hash}  ${file}`).join("\n") + "\n");
  if (requiredContentHash !== manifest.contentSha256) throw new Error("Canonical source manifest content hash does not reproduce");
  const canonical = loadBundledCanonicalV5(directory);
  const siteSourceRows = parseCsvFile(resolve(directory, "atlas/sites_naming_master.csv"));
  const archive = openValidatedZip(resolve(directory, "breeds", manifest.breedSemanticFilename));
  const identities = parseJsonLines(zipMember(archive, "canonical_breed_identities.jsonl")) as BreedIdentity[];
  const effective = parseJsonLines(zipMember(archive, "effective_breed_semantics.jsonl")) as BreedEffective[];
  const petPolicy = parseJsonLines(zipMember(archive, "pet_policy_semantics.jsonl")) as BreedEffective[];
  assertUnique("Breed catalog", identities.map((row) => row.breedId), 2_062);
  assertUnique("Civic Breed simulation profiles", canonical.breeds.map((row) => row.breedId), 1_779);
  assertUnique("Pet policy profiles", petPolicy.map((row) => row.breedId), 283);
  const effectiveByBreed = new Map([...effective, ...petPolicy].map((row) => [row.breedId, row]));
  assertUnique("Combined Breed browsing semantics", [...effectiveByBreed.keys()], 2_062);
  const canonicalByBreed = new Map(canonical.breeds.map((row) => [row.breedId, row]));
  const breedCatalog = { schemaVersion: "echoes-breed-catalog-v5", breeds: identities.map((identity) => {
    const simulation = effectiveByBreed.get(identity.breedId) ?? canonicalByBreed.get(identity.breedId);
    if (!simulation) throw new Error(`Breed catalog identity ${identity.breedId} lacks accepted simulation semantics`);
    return { ...identity, factionObject: simulation.factionObject, dominantFaction: simulation.dominantFaction };
  }).sort((left, right) => left.breedId.localeCompare(right.breedId)) };

  assertUnique("Sites", canonical.sites.map((row) => row.siteId), 175);
  assertUnique("Shared Site migration rows", siteSourceRows.map((row) => row.siteId), 175);
  assertUnique("Regions", canonical.regions.map((row) => row.regionId), 25);
  assertUnique("Points of Interest", canonical.physicalPois.map((row) => row.poiId), 92);
  assertUnique("Governments", canonical.governments.map((row) => row.governmentFormId));
  assertUnique("Economic forms", canonical.economicForms.map((row) => row.economicForm));
  assertUnique("Route corridors", canonical.routeCorridors.map((row) => row.corridorId), 38);
  assertUnique("Initial Settlements", canonical.initialSettlements.map((row) => `${row.worldKey}/${row.settlementId}`), 72);
  assertUnique("Canonical events", canonical.canonicalEvents.map((row) => row.eventId));
  const manifestSha256 = sha256(manifestBytes);
  const breedFile = `breeds/${manifest.breedSemanticFilename}`;
  const sharedSiteRows: SharedSiteMigrationRow[] = siteSourceRows.map((row) => ({ siteId: row.siteId!, regionId: row.regionId!, candidateType: row.classification!, longitude: Number(row.longitude), latitude: Number(row.latitude) })).sort((left, right) => left.siteId.localeCompare(right.siteId));
  const sharedPoiRows: SharedPoiMigrationRow[] = canonical.physicalPois.map((row) => ({ pointOfInterestId: row.poiId, name: row.canonicalLabel ?? row.workingLabel, kind: row.poiType, regionId: row.regionId, longitude: row.longitude, latitude: row.latitude })).sort((left, right) => left.pointOfInterestId.localeCompare(right.pointOfInterestId));
  const domains: CanonicalDomainMigrationDefinition[] = [
    definition({ authorityId: BREED_CATALOG_AUTHORITY_ID, schemaVersion: breedCatalog.schemaVersion, content: breedCatalog, manifest, manifestSha256, sourceFiles: [breedFile], stableIdentityCount: breedCatalog.breeds.length }),
    definition({ authorityId: "CANONICAL_BREED_SIMULATION_PROFILE_V5", schemaVersion: canonical.schemaVersion, content: { breeds: canonical.breeds }, manifest, manifestSha256, sourceFiles: [breedFile, "policies/breed_faction_projection_policy.json", "reference/property_faction_mapping.json"], stableIdentityCount: canonical.breeds.length }),
    definition({ authorityId: "CANONICAL_GEOGRAPHY_V5", schemaVersion: canonical.schemaVersion, content: { sites: canonical.sites, regions: canonical.regions, physicalPois: canonical.physicalPois, sharedSiteRows, sharedPoiRows }, manifest, manifestSha256, sourceFiles: ["atlas/sites_naming_master.csv", "atlas/pois_by_site_naming.csv", "reference/region_adjacency.json", "policies/continent_name_authority.json"], stableIdentityCount: canonical.sites.length + canonical.regions.length + canonical.physicalPois.length }),
    definition({ authorityId: "CANONICAL_GOVERNANCE_V5", schemaVersion: canonical.schemaVersion, content: { governments: canonical.governments, sovereigns: canonical.sovereigns }, manifest, manifestSha256, sourceFiles: ["reference/political_form_mapping.json", "reference/property_faction_mapping.json", "reference/sovereign_and_djt.json"], stableIdentityCount: canonical.governments.length + Object.keys(canonical.sovereigns).length }),
    definition({ authorityId: "CANONICAL_ECONOMY_V5", schemaVersion: canonical.schemaVersion, content: { economicForms: canonical.economicForms }, manifest, manifestSha256, sourceFiles: ["reference/economic_form_mapping.json"], stableIdentityCount: canonical.economicForms.length }),
    definition({ authorityId: "CANONICAL_ROUTE_CORRIDORS_V5", schemaVersion: canonical.schemaVersion, content: { routeCorridors: canonical.routeCorridors }, manifest, manifestSha256, sourceFiles: ["reference/region_adjacency.json"], stableIdentityCount: canonical.routeCorridors.length }),
    definition({ authorityId: "CANONICAL_GENESIS_V5", schemaVersion: canonical.schemaVersion, content: { groupRegionAssignments: canonical.groupRegionAssignments, initialSettlements: canonical.initialSettlements }, manifest, manifestSha256, sourceFiles: ["atlas/region_species_group_assignments.csv", "integrity/year0_readiness.json"], stableIdentityCount: canonical.initialSettlements.length }),
    definition({ authorityId: "CANONICAL_NAMING_V5", schemaVersion: canonical.schemaVersion, content: { canonicalLabels: canonical.canonicalLabels, canonicalLabelAuthority: canonical.canonicalLabelAuthority }, manifest, manifestSha256, sourceFiles: ["atlas/sites_naming_master.csv", "atlas/pois_by_site_naming.csv"], stableIdentityCount: Object.keys(canonical.canonicalLabels).length }),
    definition({ authorityId: "CANONICAL_EVENT_SKELETON_V5", schemaVersion: canonical.schemaVersion, content: { canonicalEvents: canonical.canonicalEvents }, manifest, manifestSha256, sourceFiles: ["reference/shared_event_skeleton.json"], stableIdentityCount: canonical.canonicalEvents.length }),
    definition({ authorityId: V5_CANONICAL_CORE_AUTHORITY_ID, authorityType: "MIGRATED_ACCEPTED_CANONICAL_AGGREGATE", schemaVersion: canonical.schemaVersion, content: canonical, manifest, manifestSha256, sourceFiles: Object.keys(manifest.requiredFiles), stableIdentityCount: canonical.breeds.length + canonical.sites.length + canonical.regions.length + canonical.physicalPois.length + canonical.routeCorridors.length + canonical.initialSettlements.length + canonical.canonicalEvents.length }),
  ];
  return domains;
}

function rowSignature(row: TypedAuthorityValue): string {
  return canonicalJson({ valueType: row.valueType, textValue: row.textValue ?? null, integerValue: row.integerValue?.toString() ?? null, decimalValue: row.decimalValue?.toString() ?? null, booleanValue: row.booleanValue ?? null });
}

function differencePaths(expected: readonly TypedAuthorityValue[], observed: readonly TypedAuthorityValue[]): string[] {
  const expectedByPath = new Map(expected.map((row) => [row.valuePath, rowSignature(row)]));
  const observedByPath = new Map(observed.map((row) => [row.valuePath, rowSignature(row)]));
  return [...new Set([...expectedByPath.keys(), ...observedByPath.keys()])].sort().filter((path) => expectedByPath.get(path) !== observedByPath.get(path));
}

function sharedRowSignature(row: Record<string, unknown>): string {
  return canonicalJson(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? Number(value) : value])));
}

async function reconcileSharedGeography(database: PrismaClient, definition: CanonicalDomainMigrationDefinition): Promise<string[]> {
  const content = definition.content as { sharedSiteRows: SharedSiteMigrationRow[]; sharedPoiRows: SharedPoiMigrationRow[] };
  const existingSites = await database.$queryRawUnsafe<SharedSiteMigrationRow[]>(`SELECT "siteId", "regionId"::text AS "regionId", "candidateType"::text AS "candidateType", "longitude", "latitude" FROM "Site" ORDER BY "siteId"`);
  const existingPois = await database.$queryRawUnsafe<SharedPoiMigrationRow[]>(`SELECT "pointOfInterestId", "name", "kind", "regionId"::text AS "regionId", "longitude", "latitude" FROM "PointOfInterest" ORDER BY "pointOfInterestId"`);
  const existingSiteIds = new Set(existingSites.map((row) => row.siteId));
  const existingPoiIds = new Set(existingPois.map((row) => row.pointOfInterestId));
  await database.$transaction(async (transaction) => {
    for (const row of content.sharedSiteRows) if (!existingSiteIds.has(row.siteId)) await transaction.$executeRawUnsafe(
      `INSERT INTO "Site" ("siteId","regionId","candidateType","longitude","latitude","namingContext") VALUES ($1,$2::"RegionId",$3::"SettlementClassification",$4,$5,NULL)`,
      row.siteId, row.regionId, row.candidateType, row.longitude, row.latitude,
    );
    for (const row of content.sharedPoiRows) if (!existingPoiIds.has(row.pointOfInterestId)) await transaction.$executeRawUnsafe(
      `INSERT INTO "PointOfInterest" ("pointOfInterestId","name","kind","regionId","longitude","latitude") VALUES ($1,$2,$3,$4::"RegionId",$5,$6)`,
      row.pointOfInterestId, row.name, row.kind, row.regionId, row.longitude, row.latitude,
    );
  });
  const [importedSites, importedPois] = await Promise.all([
    database.$queryRawUnsafe<SharedSiteMigrationRow[]>(`SELECT "siteId", "regionId"::text AS "regionId", "candidateType"::text AS "candidateType", "longitude", "latitude" FROM "Site" ORDER BY "siteId"`),
    database.$queryRawUnsafe<SharedPoiMigrationRow[]>(`SELECT "pointOfInterestId", "name", "kind", "regionId"::text AS "regionId", "longitude", "latitude" FROM "PointOfInterest" ORDER BY "pointOfInterestId"`),
  ]);
  const compare = (domain: string, expected: readonly Record<string, unknown>[], observed: readonly Record<string, unknown>[], identity: string): string[] => {
    const expectedById = new Map(expected.map((row) => [String(row[identity]), sharedRowSignature(row)]));
    const observedById = new Map(observed.map((row) => [String(row[identity]), sharedRowSignature(row)]));
    return [...new Set([...expectedById.keys(), ...observedById.keys()])].sort().filter((id) => expectedById.get(id) !== observedById.get(id)).map((id) => `$SHARED_${domain}.${id}`);
  };
  return [
    ...compare("SITE", content.sharedSiteRows as unknown as Record<string, unknown>[], importedSites as unknown as Record<string, unknown>[], "siteId"),
    ...compare("POINT_OF_INTEREST", content.sharedPoiRows as unknown as Record<string, unknown>[], importedPois as unknown as Record<string, unknown>[], "pointOfInterestId"),
  ];
}

export async function reconcileCanonicalDomains(input: { sourceDirectory: string; database?: PrismaClient }): Promise<{ status: "RECONCILED" | "UNRESOLVED"; domains: CanonicalDomainReconciliationResult[]; unexplainedDifferenceCount: number }> {
  const database = input.database ?? getDomainDatabase();
  const definitions = buildCanonicalDomainMigrationDefinitions(input.sourceDirectory);
  const geographyDefinition = definitions.find((row) => row.authorityId === "CANONICAL_GEOGRAPHY_V5")!;
  const sharedGeographyDifferences = await reconcileSharedGeography(database, geographyDefinition);
  const results: CanonicalDomainReconciliationResult[] = [];
  for (const domain of definitions) {
    const revisionId = `${domain.authorityId}_${domain.contentSha256.slice(0, 20)}`;
    const migrationId = `MIGRATION_${domain.authorityId}_${domain.sourceManifestSha256.slice(0, 12)}_${domain.contentSha256.slice(0, 12)}`;
    const provenanceRef = `MIGRATED_ACCEPTED_CANONICAL:${domain.sourceManifestSha256}:${domain.contentSha256}`;
    const existing = await database.canonicalAuthorityRevision.findUnique({ where: { revisionId }, include: { values: { orderBy: { valuePath: "asc" } } } });
    if (!existing) await database.canonicalAuthorityRevision.create({ data: {
      revisionId,
      authorityId: domain.authorityId,
      authorityType: domain.authorityType,
      schemaVersion: domain.schemaVersion,
      contentSha256: domain.contentSha256,
      status: "UNREVIEWED",
      provenanceRef,
      values: { create: domain.typedValues.map((row) => ({ ...row, decimalValue: row.decimalValue?.toString() })) },
    } });
    const imported = await database.canonicalAuthorityRevision.findUniqueOrThrow({ where: { revisionId }, include: { values: { orderBy: { valuePath: "asc" } } } });
    const metadataMismatch = imported.authorityId !== domain.authorityId || imported.schemaVersion !== domain.schemaVersion || imported.contentSha256 !== domain.contentSha256;
    const differences = differencePaths(domain.typedValues, imported.values as TypedAuthorityValue[]);
    if (domain.authorityId === "CANONICAL_GEOGRAPHY_V5") differences.push(...sharedGeographyDifferences);
    if (metadataMismatch) differences.unshift("$REVISION_METADATA");
    const unexplainedDifferencePaths = [...new Set(differences)].slice(0, 500);
    const reconciled = differences.length === 0;
    const now = new Date();
    if (reconciled) await database.canonicalAuthorityRevision.updateMany({ where: { authorityId: domain.authorityId, revisionId: { not: revisionId }, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
    await database.canonicalAuthorityRevision.update({ where: { revisionId }, data: reconciled ? {
      status: "APPROVED",
      authorityType: domain.authorityType,
      approvedBy: `DETERMINISTIC_MIGRATION:${migrationId}`,
      approvedAt: now,
      effectiveFromYear: 0,
      provenanceRef,
    } : { status: "UNREVIEWED", approvedBy: null, approvedAt: null, effectiveFromYear: null } });
    await database.canonicalMigrationReconciliation.upsert({ where: { revisionId }, create: {
      migrationId,
      authorityId: domain.authorityId,
      revisionId,
      sourceAuthorityRef: domain.sourceAuthorityRef,
      sourceManifestSha256: domain.sourceManifestSha256,
      sourceContentSha256: domain.contentSha256,
      importedContentSha256: imported.contentSha256,
      stableIdentityCount: domain.stableIdentityCount,
      sourceValueCount: domain.typedValues.length,
      importedValueCount: imported.values.length,
      unexplainedDifferenceCount: differences.length,
      unexplainedDifferencePaths,
      status: reconciled ? "RECONCILED" : "UNRESOLVED",
      activatedAt: reconciled ? now : null,
    }, update: {
      sourceAuthorityRef: domain.sourceAuthorityRef,
      sourceManifestSha256: domain.sourceManifestSha256,
      sourceContentSha256: domain.contentSha256,
      importedContentSha256: imported.contentSha256,
      stableIdentityCount: domain.stableIdentityCount,
      sourceValueCount: domain.typedValues.length,
      importedValueCount: imported.values.length,
      unexplainedDifferenceCount: differences.length,
      unexplainedDifferencePaths,
      status: reconciled ? "RECONCILED" : "UNRESOLVED",
      activatedAt: reconciled ? now : null,
    } });
    results.push({ authorityId: domain.authorityId, migrationId, revisionId, status: reconciled ? "RECONCILED" : "UNRESOLVED", stableIdentityCount: domain.stableIdentityCount, sourceValueCount: domain.typedValues.length, importedValueCount: imported.values.length, unexplainedDifferenceCount: differences.length, unexplainedDifferencePaths });
  }
  const unexplainedDifferenceCount = results.reduce((sum, row) => sum + row.unexplainedDifferenceCount, 0);
  return { status: unexplainedDifferenceCount === 0 ? "RECONCILED" : "UNRESOLVED", domains: results, unexplainedDifferenceCount };
}

export async function canonicalDomainReconciliationReadiness(database: PrismaClient = getDomainDatabase()): Promise<{ status: "READY" | "RECONCILIATION_REQUIRED" | "UNRESOLVED"; domains: Array<{ authorityId: string; status: string; unexplainedDifferenceCount: number }>; unexplainedDifferenceCount: number }> {
  const rows = await database.canonicalMigrationReconciliation.findMany({ where: { authorityId: { in: [...CANONICAL_DOMAIN_AUTHORITY_IDS] } }, select: { authorityId: true, status: true, unexplainedDifferenceCount: true }, orderBy: { updatedAt: "asc" } });
  const byAuthority = new Map(rows.map((row) => [row.authorityId, row]));
  const domains = CANONICAL_DOMAIN_AUTHORITY_IDS.map((authorityId) => byAuthority.get(authorityId) ?? { authorityId, status: "MISSING", unexplainedDifferenceCount: 0 });
  const unexplainedDifferenceCount = domains.reduce((sum, row) => sum + row.unexplainedDifferenceCount, 0);
  return { status: unexplainedDifferenceCount > 0 ? "UNRESOLVED" : domains.every((row) => row.status === "RECONCILED") ? "READY" : "RECONCILIATION_REQUIRED", domains, unexplainedDifferenceCount };
}

export function assertCanonicalCore(value: unknown): asserts value is CanonicalDataV5 {
  const candidate = value as Partial<CanonicalDataV5> | null;
  if (!candidate || candidate.schemaVersion !== "echoes-canonical-data-v5" || !Array.isArray(candidate.breeds) || !Array.isArray(candidate.sites) || !Array.isArray(candidate.physicalPois)) throw new Error("Reconciled canonical core has an invalid schema");
}
