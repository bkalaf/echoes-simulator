import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { strFromU8 } from "fflate";
import { openValidatedZip, sha256 } from "../inputs/importer.js";
import type { ResearchRecordType, ReviewPayload, SubmittedResearchRecord } from "./corpus-import.js";

export interface CorpusArchiveInventory {
  sourcePackage: string;
  sourcePackageSha256: string;
  semanticFiles: string[];
  reviewFiles: string[];
  evidenceFiles: string[];
  sourceFiles: string[];
  otherFiles: string[];
  artifactCounts: { semantic: number; review: number; evidence: number; source: number; other: number };
  observedRecordCounts: Record<ResearchRecordType, number>;
  ordinals: number[];
  ordinalCoverageStart: number | null;
  ordinalCoverageEnd: number | null;
  missingOrdinals: number[];
  duplicateOrdinals: number[];
  duplicateRecordIds: string[];
  duplicatePayloads: string[][];
  multipleFinalCandidates: string[];
  missingSemanticOutputs: string[];
  missingReviews: string[];
  multipleReviews: string[];
  missingEvidence: string[];
  missingSources: string[];
  orphanReviews: string[];
  orphanEvidence: string[];
  orphanSources: string[];
}

export interface OpenedResearchCorpus {
  records: SubmittedResearchRecord[];
  inventory: CorpusArchiveInventory;
  masterManifest: Record<string, unknown> | null;
}

const SEMANTIC = /^records\/(\d{4})_(.+)\.json$/;
const REVIEW = /^reviews\/(\d{4})_(.+)\.review\.json$/;
const EVIDENCE = /^evidence\/(\d{4})_(.+)\.evidence\.json$/;
const SOURCES = /^sources\/(\d{4})_(.+)\.sources\.json$/;
const RECORD_TYPES: readonly ResearchRecordType[] = ["TAXONOMY", "SPECIES", "CULTURE", "SPECIES_GROUP", "BREED"];

function decode(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function parseJson(bytes: Uint8Array): Record<string, unknown> {
  const text = decode(bytes);
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch (error) { return { _parseError: error instanceof Error ? error.message : String(error), _rawText: text }; }
}
function typeFromOrdinal(ordinal: number): ResearchRecordType { return ordinal <= 2_615 ? "TAXONOMY" : ordinal <= 3_746 ? "SPECIES" : ordinal <= 3_871 ? "CULTURE" : ordinal <= 3_955 ? "SPECIES_GROUP" : "BREED"; }
function key(ordinal: number, id: string): string { return `${String(ordinal).padStart(4, "0")}:${id}`; }
function candidates<T>(names: readonly string[], pattern: RegExp, entries: Record<string, Uint8Array>, mapper: (name: string, payload: Record<string, unknown>) => T): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const name of names) { const match = pattern.exec(name); if (!match) continue; const item = mapper(name, parseJson(entries[name]!)); const composite = key(Number(match[1]), match[2]!); result.set(composite, [...(result.get(composite) ?? []), item]); }
  return result;
}
function duplicateGroups<T>(rows: readonly T[], value: (row: T) => string | number, label: (row: T) => string): string[][] { const groups = new Map<string | number, T[]>(); for (const row of rows) groups.set(value(row), [...(groups.get(value(row)) ?? []), row]); return [...groups.values()].filter((group) => group.length > 1).map((group) => group.map(label).sort()); }

export function openResearchCorpusArchive(filename: string): OpenedResearchCorpus {
  const packageBytes = readFileSync(filename);
  const archive = openValidatedZip(filename);
  if (archive.prefix !== "") throw new Error("Consolidated research corpus must have a root checksums.sha256");
  const names = Object.keys(archive.entries).sort();
  const semanticFiles = names.filter((name) => SEMANTIC.test(name));
  const reviewFiles = names.filter((name) => REVIEW.test(name));
  const evidenceFiles = names.filter((name) => EVIDENCE.test(name));
  const sourceFiles = names.filter((name) => SOURCES.test(name));
  const categorized = new Set([...semanticFiles, ...reviewFiles, ...evidenceFiles, ...sourceFiles]);
  const otherFiles = names.filter((name) => !categorized.has(name));
  const reviewByKey = candidates(reviewFiles, REVIEW, archive.entries, (name, payload) => ({ filename: name, payload: payload as ReviewPayload }));
  const evidenceByKey = candidates(evidenceFiles, EVIDENCE, archive.entries, (name, payload) => ({ filename: name, payload }));
  const sourcesByKey = candidates(sourceFiles, SOURCES, archive.entries, (name, payload) => ({ filename: name, payload }));
  const manifestBytes = archive.entries["MASTER_MANIFEST.json"];
  const masterManifest = manifestBytes ? parseJson(manifestBytes) : null;
  const batchRows = Array.isArray(masterManifest?.batches) ? masterManifest.batches.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object") : [];
  const batchForOrdinal = (ordinal: number): { batch: number; sourceArchive: string } => {
    const row = batchRows.find((candidate) => Number(candidate.firstGlobalOrdinal) <= ordinal && Number(candidate.lastGlobalOrdinal) >= ordinal);
    return { batch: row ? Number(row.batch) : Math.ceil(ordinal / 1_000), sourceArchive: row && typeof row.sourceArchive === "string" ? row.sourceArchive : `BATCH_${String(Math.ceil(ordinal / 1_000)).padStart(2, "0")}` };
  };
  const records: SubmittedResearchRecord[] = semanticFiles.map((name) => {
    const match = SEMANTIC.exec(name)!; const ordinal = Number(match[1]); const filenameId = match[2]!; const rawPayload = parseJson(archive.entries[name]!);
    const recordType = typeof rawPayload.recordType === "string" && ["TAXONOMY", "SPECIES", "CULTURE", "SPECIES_GROUP", "BREED"].includes(rawPayload.recordType) ? rawPayload.recordType as ResearchRecordType : typeFromOrdinal(ordinal);
    const recordId = typeof rawPayload.recordId === "string" && rawPayload.recordId ? rawPayload.recordId : filenameId;
    const composite = key(ordinal, filenameId); const reviews = reviewByKey.get(composite) ?? []; const evidences = evidenceByKey.get(composite) ?? []; const sources = sourcesByKey.get(composite) ?? []; const batch = batchForOrdinal(ordinal);
    return {
      ordinal, recordType, recordId, sourceBatch: batch.batch, sourceArchive: batch.sourceArchive, sourceFilename: name, sourceSha256: sha256(archive.entries[name]!), rawPayload,
      reviewFilename: reviews.length === 1 ? reviews[0]!.filename : null, rawReviewPayload: reviews.length === 1 ? reviews[0]!.payload : null, reviewCandidates: reviews,
      evidenceFilename: evidences.length === 1 ? evidences[0]!.filename : null, rawEvidencePayload: evidences.length === 1 ? evidences[0]!.payload : null,
      sourcesFilename: sources.length === 1 ? sources[0]!.filename : null, rawSourcesPayload: sources.length === 1 ? sources[0]!.payload : null,
    };
  });
  const actualKeys = new Set(records.map((record) => key(record.ordinal, record.sourceFilename.match(SEMANTIC)![2]!)));
  const artifactKeys = (files: string[], pattern: RegExp): Set<string> => new Set(files.map((name) => { const match = pattern.exec(name)!; return key(Number(match[1]), match[2]!); }));
  const reviewKeys = artifactKeys(reviewFiles, REVIEW); const evidenceKeys = artifactKeys(evidenceFiles, EVIDENCE); const sourceKeys = artifactKeys(sourceFiles, SOURCES);
  const ordinals = records.map((record) => record.ordinal).sort((a, b) => a - b); const uniqueOrdinals = new Set(ordinals);
  const missingOrdinals: number[] = []; for (let ordinal = 1; ordinal <= (ordinals.at(-1) ?? 0); ordinal++) if (!uniqueOrdinals.has(ordinal)) missingOrdinals.push(ordinal);
  const observedRecordCounts = Object.fromEntries(RECORD_TYPES.map((recordType) => [recordType, records.filter((record) => record.recordType === recordType).length])) as Record<ResearchRecordType, number>;
  const duplicateOrdinalGroups = duplicateGroups(records, (record) => record.ordinal, (record) => record.sourceFilename);
  const duplicateIdGroups = duplicateGroups(records, (record) => record.recordId, (record) => record.sourceFilename);
  const duplicatePayloads = duplicateGroups(records, (record) => record.sourceSha256, (record) => record.sourceFilename);
  const inventory: CorpusArchiveInventory = {
    sourcePackage: basename(filename), sourcePackageSha256: sha256(packageBytes), semanticFiles, reviewFiles, evidenceFiles, sourceFiles, otherFiles,
    artifactCounts: { semantic: semanticFiles.length, review: reviewFiles.length, evidence: evidenceFiles.length, source: sourceFiles.length, other: otherFiles.length }, observedRecordCounts,
    ordinals, ordinalCoverageStart: ordinals[0] ?? null, ordinalCoverageEnd: ordinals.at(-1) ?? null, missingOrdinals,
    duplicateOrdinals: duplicateOrdinalGroups.map((group) => Number(group[0]!.match(/\/(\d{4})_/)![1])).sort((a, b) => a - b),
    duplicateRecordIds: duplicateIdGroups.map((group) => records.find((record) => record.sourceFilename === group[0])!.recordId).sort(), duplicatePayloads,
    multipleFinalCandidates: [...new Set([...duplicateOrdinalGroups.flat(), ...duplicateIdGroups.flat()])].sort(),
    missingSemanticOutputs: [...new Set([...reviewKeys, ...evidenceKeys, ...sourceKeys].filter((composite) => !actualKeys.has(composite)))].sort(),
    missingReviews: [...actualKeys].filter((composite) => !reviewKeys.has(composite)).sort(), multipleReviews: [...reviewByKey].filter(([, values]) => values.length > 1).map(([composite]) => composite).sort(),
    missingEvidence: [...actualKeys].filter((composite) => !evidenceKeys.has(composite)).sort(), missingSources: [...actualKeys].filter((composite) => !sourceKeys.has(composite)).sort(),
    orphanReviews: [...reviewKeys].filter((composite) => !actualKeys.has(composite)).sort(), orphanEvidence: [...evidenceKeys].filter((composite) => !actualKeys.has(composite)).sort(), orphanSources: [...sourceKeys].filter((composite) => !actualKeys.has(composite)).sort(),
  };
  return { records, inventory, masterManifest };
}
