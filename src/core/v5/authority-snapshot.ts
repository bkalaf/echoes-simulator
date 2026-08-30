import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";

export const RUN_AUTHORITY_SNAPSHOT_SCHEMA_VERSION = "echoes-run-authority-snapshot-v1" as const;

export interface RunAuthorityInputV1 {
  authorityId: string;
  revisionId: string;
  authorityType: string;
  schemaVersion: string;
  approvedBy: string;
  approvedAt: string | null;
  effectiveFromYear: number;
  content: unknown;
}

export interface RunAuthoritySnapshotEntryV1 extends RunAuthorityInputV1 {
  contentSha256: string;
}

export interface RunAuthoritySnapshotEpochV1 {
  epochId: string;
  barrierYear: number;
  effectiveFromYear: number;
  causeEventId: string;
  entries: readonly RunAuthoritySnapshotEntryV1[];
  epochSha256: string;
}

export interface RunAuthoritySnapshotV1 {
  schemaVersion: typeof RUN_AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  initialEntries: readonly RunAuthoritySnapshotEntryV1[];
  epochs: readonly RunAuthoritySnapshotEpochV1[];
  snapshotSha256: string;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Run authority ${field} is required`);
  return normalized;
}

function materializeEntry(input: RunAuthorityInputV1): RunAuthoritySnapshotEntryV1 {
  if (!Number.isInteger(input.effectiveFromYear) || input.effectiveFromYear < 0) throw new Error(`Run authority ${input.authorityId} has invalid effectiveFromYear`);
  const core = {
    authorityId: required(input.authorityId, "authorityId"),
    revisionId: required(input.revisionId, "revisionId"),
    authorityType: required(input.authorityType, "authorityType"),
    schemaVersion: required(input.schemaVersion, "schemaVersion"),
    approvedBy: required(input.approvedBy, "approvedBy"),
    approvedAt: input.approvedAt,
    effectiveFromYear: input.effectiveFromYear,
    content: structuredClone(input.content),
  };
  return { ...core, contentSha256: hash(core.content) };
}

function assertUniqueEntries(entries: readonly RunAuthoritySnapshotEntryV1[], context: string): void {
  const keys = entries.map((entry) => `${entry.authorityId}\0${entry.revisionId}`);
  if (new Set(keys).size !== keys.length) throw new Error(`${context} contains duplicate authority revisions`);
  for (const entry of entries) if (hash(entry.content) !== entry.contentSha256) throw new Error(`${context} authority content hash mismatch for ${entry.authorityId}/${entry.revisionId}`);
}

function snapshotHash(initialEntries: readonly RunAuthoritySnapshotEntryV1[], epochs: readonly RunAuthoritySnapshotEpochV1[]): string {
  return hash({ schemaVersion: RUN_AUTHORITY_SNAPSHOT_SCHEMA_VERSION, initialEntries, epochs });
}

export function buildRunAuthoritySnapshotV1(inputs: readonly RunAuthorityInputV1[]): RunAuthoritySnapshotV1 {
  const initialEntries = inputs.map(materializeEntry).sort((left, right) => left.authorityId.localeCompare(right.authorityId) || left.revisionId.localeCompare(right.revisionId));
  assertUniqueEntries(initialEntries, "Initial run-authority snapshot");
  return { schemaVersion: RUN_AUTHORITY_SNAPSHOT_SCHEMA_VERSION, initialEntries, epochs: [], snapshotSha256: snapshotHash(initialEntries, []) };
}

export function validateRunAuthoritySnapshotV1(snapshot: RunAuthoritySnapshotV1): void {
  if (snapshot.schemaVersion !== RUN_AUTHORITY_SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported run-authority snapshot ${String(snapshot.schemaVersion)}`);
  assertUniqueEntries(snapshot.initialEntries, "Initial run-authority snapshot");
  let priorEffectiveYear = 0;
  for (const epoch of snapshot.epochs) {
    if (epoch.effectiveFromYear !== epoch.barrierYear + 1) throw new Error(`Authority epoch ${epoch.epochId} must become effective immediately after its barrier`);
    if (epoch.effectiveFromYear <= priorEffectiveYear) throw new Error(`Authority epoch ${epoch.epochId} is not append-only in time`);
    assertUniqueEntries(epoch.entries, `Authority epoch ${epoch.epochId}`);
    const core = { epochId: epoch.epochId, barrierYear: epoch.barrierYear, effectiveFromYear: epoch.effectiveFromYear, causeEventId: epoch.causeEventId, entries: epoch.entries };
    if (hash(core) !== epoch.epochSha256) throw new Error(`Authority epoch hash mismatch for ${epoch.epochId}`);
    priorEffectiveYear = epoch.effectiveFromYear;
  }
  if (snapshotHash(snapshot.initialEntries, snapshot.epochs) !== snapshot.snapshotSha256) throw new Error("Run-authority snapshot hash mismatch");
}

export function appendRunAuthorityEpochV1(snapshot: RunAuthoritySnapshotV1, input: { barrierYear: number; causeEventId: string; entries: readonly RunAuthorityInputV1[] }): RunAuthoritySnapshotV1 {
  validateRunAuthoritySnapshotV1(snapshot);
  if (!Number.isInteger(input.barrierYear) || input.barrierYear < 0) throw new Error("Authority barrierYear must be a non-negative integer");
  const prior = snapshot.epochs.at(-1);
  if (prior && input.barrierYear < prior.effectiveFromYear) throw new Error("Authority barrier cannot precede the prior authority epoch");
  const entries = input.entries.map(materializeEntry).sort((left, right) => left.authorityId.localeCompare(right.authorityId) || left.revisionId.localeCompare(right.revisionId));
  if (entries.length === 0) throw new Error("Authority barrier must add at least one revision");
  assertUniqueEntries(entries, "Authority barrier");
  const effectiveFromYear = input.barrierYear + 1;
  if (entries.some((entry) => entry.effectiveFromYear !== effectiveFromYear)) throw new Error("Authority barrier entries must use the barrier effective year");
  const epochId = `AUTHORITY_EPOCH_${effectiveFromYear}_${hash(entries).slice(0, 16)}`;
  const core = { epochId, barrierYear: input.barrierYear, effectiveFromYear, causeEventId: required(input.causeEventId, "causeEventId"), entries };
  const epoch = { ...core, epochSha256: hash(core) };
  const epochs = [...snapshot.epochs, epoch];
  return { ...snapshot, epochs, snapshotSha256: snapshotHash(snapshot.initialEntries, epochs) };
}

export function authorityEntriesAtYearV1(snapshot: RunAuthoritySnapshotV1, year: number): readonly RunAuthoritySnapshotEntryV1[] {
  validateRunAuthoritySnapshotV1(snapshot);
  if (!Number.isInteger(year) || year < 0) throw new Error("Authority lookup year must be a non-negative integer");
  const selected = new Map(snapshot.initialEntries.filter((entry) => entry.effectiveFromYear <= year).map((entry) => [entry.authorityId, entry]));
  for (const epoch of snapshot.epochs) if (epoch.effectiveFromYear <= year) for (const entry of epoch.entries) selected.set(entry.authorityId, entry);
  return [...selected.values()].sort((left, right) => left.authorityId.localeCompare(right.authorityId));
}

export function requireRunAuthorityV1(snapshot: RunAuthoritySnapshotV1, authorityId: string, year: number, expectedRevisionId?: string): RunAuthoritySnapshotEntryV1 {
  const entry = authorityEntriesAtYearV1(snapshot, year).find((candidate) => candidate.authorityId === authorityId);
  if (!entry) throw new Error(`Canonical authority ${authorityId} is not pinned for year ${year}`);
  if (expectedRevisionId && entry.revisionId !== expectedRevisionId) throw new Error(`Canonical authority ${authorityId} is pinned to ${entry.revisionId}, not ${expectedRevisionId}`);
  if (hash(entry.content) !== entry.contentSha256) throw new Error(`Canonical authority ${authorityId} content changed after snapshot`);
  return structuredClone(entry);
}
