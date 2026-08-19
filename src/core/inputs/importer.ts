import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseCsvSync } from "csv-parse/sync";
import { strFromU8, unzipSync } from "fflate";

export const SEMANTIC_FIELDS = [
  "traits", "foodBroad", "foodSpecific", "terrainBroad", "terrainSpecific", "personalityId", "motivation", "operatingStyle",
  "structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource", "loquacity",
  "emotionalTemperature", "outlookOrientation", "collaborativePosture",
] as const;
export const RESEARCH_SEMANTIC_FIELDS = SEMANTIC_FIELDS;
const IDENTITY_FIELDS = ["name", "speciesId", "populationKind", "groupId", "cultureId"] as const;
const LEGACY_FIELDS = ["regionId", "regionAssignmentScope", "parentBreedId", "accent", "appearance", "clothing", "architecture"] as const;

export type GenericRow = Record<string, unknown>;
export type FieldProvenance = "V3_RESEARCH" | "LEGACY_METADATA" | "CANONICAL_V3_IDENTITY" | "UNRESOLVED";

function normalizedIdentity(value: unknown): unknown { return value === "" || value === undefined ? null : value; }

export interface MergeOptions { reportConflicts?: { breedId: string; field: string; remediated: unknown; legacy: unknown }[]; }

export function mergeBreedRows(remediated: GenericRow, legacy: GenericRow, options: MergeOptions = {}): GenericRow & { provenance: Record<string, FieldProvenance> } {
  if (remediated.breedId !== legacy.breedId) throw new Error("Breed identity mismatch: breedId");
  const merged: GenericRow = { breedId: remediated.breedId };
  const provenance: Record<string, FieldProvenance> = { breedId: "CANONICAL_V3_IDENTITY" };
  for (const field of IDENTITY_FIELDS) {
    const current = normalizedIdentity(remediated[field]);
    merged[field] = current;
    provenance[field] = "CANONICAL_V3_IDENTITY";
  }
  for (const field of SEMANTIC_FIELDS) {
    merged[field] = remediated[field] ?? null;
    provenance[field] = "V3_RESEARCH";
  }
  for (const field of LEGACY_FIELDS) {
    const value = normalizedIdentity(legacy[field]);
    merged[field] = value;
    provenance[field] = value === null ? "UNRESOLVED" : "LEGACY_METADATA";
  }
  return { ...merged, provenance };
}

export function validateZipEntries(entries: readonly string[]): void {
  for (const name of entries) {
    const normalized = name.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) throw new Error(`Unsafe ZIP entry: ${name}`);
  }
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface OpenedZip { entries: Record<string, Uint8Array>; prefix: string; }

export function openValidatedZip(filename: string): OpenedZip {
  const entries = unzipSync(readFileSync(filename));
  const names = Object.keys(entries);
  validateZipEntries(names);
  const checksumName = names.find((name) => name.endsWith("checksums.sha256"));
  if (!checksumName) throw new Error("ZIP is missing checksums.sha256");
  const prefix = checksumName.slice(0, -"checksums.sha256".length);
  const checksums = strFromU8(entries[checksumName]!).split(/\r?\n/).filter(Boolean);
  for (const line of checksums) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Malformed internal checksum line: ${line}`);
    const target = entries[`${prefix}${match[2]}`];
    if (!target) throw new Error(`ZIP checksum references missing member ${match[2]}`);
    if (sha256(target) !== match[1]) throw new Error(`ZIP checksum mismatch for ${match[2]}`);
  }
  return { entries, prefix };
}

export function parseJsonLines(data: Uint8Array): GenericRow[] {
  return strFromU8(data).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as GenericRow);
}

export function parseCsvFile(filename: string): Record<string, string>[] {
  return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true, relax_quotes: false, trim: false }) as Record<string, string>[];
}
