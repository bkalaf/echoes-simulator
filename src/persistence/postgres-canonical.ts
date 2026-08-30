import { createHash } from "node:crypto";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import type { RunAuthorityInputV1, RunAuthoritySnapshotV1 } from "../core/v5/authority-snapshot.js";
import { authorityEntriesAtYearV1, requireRunAuthorityV1 } from "../core/v5/authority-snapshot.js";
import type { CanonicalDataV5 } from "../core/v5/config.js";
import { getDomainDatabase } from "./postgres-domain.js";
import { hydrateTypedAuthorityValues, type TypedAuthorityValue } from "./typed-authority-values.js";

export const V5_CANONICAL_CORE_AUTHORITY_ID = "SIMULATOR_CANONICAL_V5";
export const BREED_PRIMARY_DEITY_AUTHORITY_ID = "BREED_PRIMARY_DEITY";

type BreedDeityAssignment = { breedId: string; primaryDeityId: string };

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function validateCore(value: unknown): asserts value is CanonicalDataV5 {
  const candidate = value as Partial<CanonicalDataV5> | null;
  if (!candidate || candidate.schemaVersion !== "echoes-canonical-data-v5") throw new Error("SCHEMA_MISMATCH: approved simulator canonical authority is not echoes-canonical-data-v5");
  for (const field of ["breeds", "sites", "regions", "governments", "economicForms", "physicalPois", "routeCorridors", "initialSettlements", "canonicalEvents"] as const) if (!Array.isArray(candidate[field])) throw new Error(`SCHEMA_MISMATCH: canonical authority ${field} is not a typed array`);
  if (!candidate.sovereigns || !candidate.groupRegionAssignments || !candidate.canonicalLabels) throw new Error("SCHEMA_MISMATCH: canonical authority is missing required typed maps");
}

function bindPrimaryDeities(core: CanonicalDataV5, assignments: readonly BreedDeityAssignment[], combinedHash: string): CanonicalDataV5 {
  if (assignments.length !== 2_062 || new Set(assignments.map((row) => row.breedId)).size !== 2_062) throw new Error(`BREED_PRIMARY_DEITY_AUTHORITY_REQUIRED expected=2062 observed=${assignments.length}`);
  const byBreed = new Map(assignments.map((row) => [row.breedId, row.primaryDeityId]));
  if (new Set(core.breeds.map((row) => row.breedId)).size !== core.breeds.length) throw new Error("Canonical causal Breed projection contains duplicate stable IDs");
  const breeds = core.breeds.map((breed) => {
    const primaryDeityId = byBreed.get(breed.breedId);
    if (!primaryDeityId) throw new Error(`BREED_PRIMARY_DEITY_UNBOUND ${breed.breedId}`);
    return { ...breed, primaryDeityId };
  });
  return { ...core, canonicalBundleHash: combinedHash, breeds };
}

function coreOnlyHash(revisionId: string, contentSha256: string): string {
  return sha256({ canonicalCoreRevisionId: revisionId, canonicalCoreSha256: contentSha256 });
}

function coreAuthorityInput(coreRevision: {
  authorityId: string;
  revisionId: string;
  authorityType: string;
  schemaVersion: string;
  approvedBy: string | null;
  approvedAt: Date | null;
}, core: CanonicalDataV5): RunAuthorityInputV1 {
  return {
    authorityId: coreRevision.authorityId,
    revisionId: coreRevision.revisionId,
    authorityType: coreRevision.authorityType,
    schemaVersion: coreRevision.schemaVersion,
    approvedBy: coreRevision.approvedBy ?? "DETERMINISTIC_CANONICAL_MIGRATION",
    approvedAt: coreRevision.approvedAt?.toISOString() ?? null,
    effectiveFromYear: 0,
    content: core,
  };
}

export function canonicalV5FromRunAuthoritySnapshot(snapshot: RunAuthoritySnapshotV1, expectedBundleHash: string, year = 0): CanonicalDataV5 {
  const coreEntry = requireRunAuthorityV1(snapshot, V5_CANONICAL_CORE_AUTHORITY_ID, year);
  validateCore(coreEntry.content);
  const deityEntry = authorityEntriesAtYearV1(snapshot, year).find((entry) => entry.authorityId === BREED_PRIMARY_DEITY_AUTHORITY_ID);
  if (!deityEntry) {
    const combinedHash = coreOnlyHash(coreEntry.revisionId, coreEntry.contentSha256);
    if (combinedHash !== expectedBundleHash) throw new Error("Run canonical authority hash no longer matches its immutable snapshot");
    return { ...structuredClone(coreEntry.content), canonicalBundleHash: combinedHash };
  }
  const assignments = (deityEntry.content as { assignments?: BreedDeityAssignment[] }).assignments;
  if (!Array.isArray(assignments)) throw new Error("BREED_PRIMARY_DEITY_AUTHORITY_REQUIRED: snapshot contains no stable-ID assignments");
  const combinedHash = sha256({ canonicalCoreRevisionId: coreEntry.revisionId, canonicalCoreSha256: coreEntry.contentSha256, breedDeityRevisionId: deityEntry.revisionId, breedDeitySha256: deityEntry.contentSha256 });
  if (combinedHash !== expectedBundleHash) throw new Error("Run canonical authority hash no longer matches its immutable snapshot");
  return bindPrimaryDeities(structuredClone(coreEntry.content), assignments, combinedHash);
}

/**
 * Read-only compatibility for histories created before V5.6 embedded typed
 * canonical content. Missing V5.6 entries never fall through to PostgreSQL or
 * filesystem authority; callers must render only durable checkpoint content.
 */
export function canonicalV5FromRunAuthoritySnapshotForRead(snapshot: RunAuthoritySnapshotV1, expectedBundleHash: string, year = 0): CanonicalDataV5 | null {
  const authorityIds = new Set(authorityEntriesAtYearV1(snapshot, year).map((entry) => entry.authorityId));
  if (!authorityIds.has(V5_CANONICAL_CORE_AUTHORITY_ID)) return null;
  return canonicalV5FromRunAuthoritySnapshot(snapshot, expectedBundleHash, year);
}

export async function loadPostgresCanonicalCoreV5(): Promise<{ canonical: CanonicalDataV5; authorityInput: RunAuthorityInputV1 }> {
  const database = getDomainDatabase();
  const coreRevision = await database.canonicalAuthorityRevision.findFirst({
    where: {
      authorityId: V5_CANONICAL_CORE_AUTHORITY_ID,
      status: "APPROVED",
      migrationReconciliation: { is: { status: "RECONCILED", unexplainedDifferenceCount: 0 } },
    },
    include: { values: { orderBy: { valuePath: "asc" } }, migrationReconciliation: true },
    orderBy: [{ effectiveFromYear: "desc" }, { approvedAt: "desc" }, { revisionId: "desc" }],
  });
  if (!coreRevision) throw new Error("CANONICAL_DOMAIN_RECONCILIATION_REQUIRED: run pnpm db:reconcile-canonical and review only reported unexplained differences");
  const hydrated = hydrateTypedAuthorityValues(coreRevision.values as TypedAuthorityValue[]);
  validateCore(hydrated);
  if (sha256(hydrated) !== coreRevision.contentSha256) throw new Error(`CANONICAL_AUTHORITY_HASH_MISMATCH ${coreRevision.revisionId}`);
  const canonical = { ...hydrated, canonicalBundleHash: coreOnlyHash(coreRevision.revisionId, coreRevision.contentSha256) };
  return { canonical, authorityInput: coreAuthorityInput(coreRevision, hydrated) };
}

export async function loadPostgresCanonicalV5(): Promise<{ canonical: CanonicalDataV5; authorityInputs: RunAuthorityInputV1[] }> {
  const database = getDomainDatabase();
  const { canonical: core, authorityInput: coreInput } = await loadPostgresCanonicalCoreV5();

  const deityRevision = await database.canonicalAuthorityRevision.findFirst({ where: { authorityId: BREED_PRIMARY_DEITY_AUTHORITY_ID, status: "APPROVED" }, orderBy: [{ effectiveFromYear: "desc" }, { approvedAt: "desc" }, { revisionId: "desc" }] });
  if (!deityRevision) return { canonical: core, authorityInputs: [coreInput] };
  const breedRows = await database.breed.findMany({ select: { breedId: true, primaryDeityId: true }, orderBy: { breedId: "asc" } });
  const audits = await database.breedDeityDecisionAudit.findMany({ where: { authorityRevisionId: deityRevision.revisionId }, select: { breedId: true, deityId: true }, orderBy: { breedId: "asc" } });
  if (breedRows.length !== 2_062 || audits.length !== 2_062) throw new Error(`BREED_PRIMARY_DEITY_AUTHORITY_REQUIRED revision=${deityRevision.revisionId} breeds=${breedRows.length} provenance=${audits.length} expected=2062`);
  const audited = new Map(audits.map((row) => [row.breedId, row.deityId]));
  const assignments = breedRows.map((row) => {
    if (audited.get(row.breedId) !== row.primaryDeityId) throw new Error(`BREED_PRIMARY_DEITY_PROVENANCE_MISMATCH ${row.breedId}`);
    return { breedId: row.breedId, primaryDeityId: row.primaryDeityId };
  });
  const deityContent = { assignments };
  if (sha256(deityContent) !== deityRevision.contentSha256) throw new Error(`BREED_PRIMARY_DEITY_HASH_MISMATCH ${deityRevision.revisionId}`);
  const combinedHash = sha256({ canonicalCoreRevisionId: coreInput.revisionId, canonicalCoreSha256: sha256(coreInput.content), breedDeityRevisionId: deityRevision.revisionId, breedDeitySha256: deityRevision.contentSha256 });
  const canonical = bindPrimaryDeities(core, assignments, combinedHash);
  const authorityInputs: RunAuthorityInputV1[] = [
    coreInput,
    { authorityId: BREED_PRIMARY_DEITY_AUTHORITY_ID, revisionId: deityRevision.revisionId, authorityType: deityRevision.authorityType, schemaVersion: deityRevision.schemaVersion, approvedBy: deityRevision.approvedBy ?? "OWNER_APPROVAL_REQUIRED", approvedAt: deityRevision.approvedAt?.toISOString() ?? null, effectiveFromYear: 0, content: deityContent },
  ];
  return { canonical, authorityInputs };
}
