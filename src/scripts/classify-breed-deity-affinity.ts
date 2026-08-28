import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { strFromU8 } from "fflate";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import {
  AXIS_WEIGHTS,
  BREED_DEITY_AFFINITY_SCHEMA_VERSION,
  BREED_DEITY_CLASSIFICATION_RULES_VERSION,
  DEITIES,
  SCORE_AXES,
  assessAllDeities,
  deityReference,
  judgeConfidence,
  type BreedEvidenceProfile,
  type CandidateAssessment,
  type ClassificationStatus,
  type Confidence,
  type DeityAuthorityRecord,
  type EvidenceFragment,
  type Pantheon,
  type PopulationKind,
  type ScoreAxis,
} from "../core/research/breed-deity-affinity.js";

const ROOT = resolve(".");
const CANONICAL = resolve(ROOT, "resources/canonical");
const OUTPUT = resolve(ROOT, "artifacts/simulator/v5/breed-deity-affinity");
const CHECKPOINTS = resolve(OUTPUT, "checkpoints");
const AUTHORITY_PATH = resolve(ROOT, "resources/noncausal/breed-deity-affinity/breed-primary-deity-authority-v1.json");
const BASELINE_PATH = resolve(OUTPUT, "preexisting-worktree-baseline.json");
const BATCH_SIZE = 10;
const EXPECTED_BREEDS = 2062;
const EXPECTED_BATCHES = 207;
const ORDERING_RULE = "Breed ID ascending (Unicode code-point order)";
const CLASSIFIER_IMPLEMENTATION_PATHS = [
  resolve(ROOT, "src/core/research/breed-deity-affinity.ts"),
  resolve(ROOT, "src/scripts/classify-breed-deity-affinity.ts"),
] as const;

const DEITY_SOURCE = {
  sourceType: "NOTION_PAGE_READ_ONLY",
  pageId: "3b62380d-0cae-81b6-a408-fb2b08712efc",
  title: "Deities",
  url: "https://app.notion.com/p/3b62380d0cae81b6a408fb2b08712efc",
  lastEditedAt: "2026-08-09T06:22:00.000Z",
  fetchedAsOf: "2026-08-09T06:29:03.985Z",
  fetchedForRunOn: "2026-08-28",
  rules: {
    totalDeities: 27,
    deitiesPerPantheon: 9,
    worshipIsCrossPantheon: true,
    populationKindConstrainsSelection: false,
  },
} as const;

interface LedgerPayload {
  recordType: string;
  recordId: string;
  breedId?: string;
  name?: string;
  populationKind?: PopulationKind;
  speciesId?: string | null;
  groupId?: string | null;
  cultureId?: string | null;
  personalityId?: string | null;
  text?: string | null;
  traits?: { text?: string | null; historicalFact?: string | null }[];
  terrainBroad?: string[];
  terrainSpecific?: string[];
  foodBroad?: string[];
  foodSpecific?: string[];
  primitiveBehavior?: Record<string, { score?: number; rationale?: string | null; evidenceRefs?: string[] }>;
}

interface V4Identity {
  breedId: string;
  name: string;
  populationKind: PopulationKind;
  speciesId: string;
  groupId: string;
  cultureId: string | null;
}

interface V4Effective {
  breedId: string;
  personalityId: string | null;
  dimensions: Record<string, { value: string | null }>;
  terrainBroad: string[];
  terrainSpecific: string[];
}

interface PersonalityProfile { personalityId: string; family: string; dimensions: Record<string, string>; }

interface SourceRef { path: string; version: string; sha256: string; role: string; }

interface AnalyticalRecord {
  breedId: string;
  breedName: string;
  speciesId: string;
  speciesName: string | null;
  populationKind: PopulationKind;
  cultureId: string | null;
  cultureName: string | null;
  breedGroupId: string;
  breedGroupName: string | null;
  personalityId: string | null;
  classificationStatus: ClassificationStatus;
  primaryDeity: DeityAuthorityRecord | null;
  provisionalPrimaryDeity: DeityAuthorityRecord | null;
  confidence: Confidence;
  suggestedConfidence: Confidence;
  confidenceRationale: string;
  confidenceOverrideReason: string | null;
  evidenceQuality: string;
  evidenceDirectness: string;
  evidenceBreadth: number;
  evidenceConsistency: string;
  evidence: string[];
  sourceFieldReferences: { sourceRecordId: string; sourceScope: string; fieldPath: string; basis: string }[];
  topCandidates: CandidateAssessment[];
  allCandidatesDigest: string;
  runnerUp: string;
  winnerReason: string;
  classificationBasis: string[];
  missingEvidence: string[];
  topTwoMargin: number;
}

interface CheckpointRecord extends AnalyticalRecord { candidateAssessments: CandidateAssessment[]; }

interface Checkpoint {
  schemaVersion: "echoes-breed-deity-affinity-checkpoint-v1";
  authorityId: "BREED_PRIMARY_DEITY_V1";
  runId: string;
  batchNumber: number;
  requestedBatchSize: 10;
  recordCount: number;
  finalRemainder: boolean;
  orderingRule: string;
  classificationRulesVersion: string;
  inputDigest: string;
  previousCheckpointHash: string | null;
  firstBreedId: string;
  lastBreedId: string;
  records: CheckpointRecord[];
  checkpointHash: string;
}

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function fileSha256(path: string): string { return sha256(readFileSync(path)); }
function jsonLines<T>(path: string): T[] { return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }
function member(archive: ReturnType<typeof openValidatedZip>, name: string): Uint8Array { const bytes = archive.entries[`${archive.prefix}${name}`]; if (!bytes) throw new Error(`V4 authority is missing ${name}`); return bytes; }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function compact(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function excerpt(value: string, limit = 320): string { const normalized = compact(value); return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`; }
function rounded(value: number, places = 3): number { const scale = 10 ** places; return Math.round(value * scale) / scale; }

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

async function loadLedger(): Promise<Map<string, LedgerPayload>> {
  const result = new Map<string, LedgerPayload>();
  const path = resolve(CANONICAL, "research-corpus/IMPORT_LEDGER.jsonl");
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const row = JSON.parse(line) as { recordId?: string; recordType?: string; canonicalMaterialized?: boolean; canonicalPayload?: LedgerPayload };
    if (!row.recordId || !row.recordType || !row.canonicalPayload || row.canonicalMaterialized !== true) continue;
    result.set(row.recordId, row.canonicalPayload);
  }
  return result;
}

function loadV4(): { identities: V4Identity[]; effective: Map<string, V4Effective>; archivePath: string } {
  const manifest = JSON.parse(readFileSync(resolve(CANONICAL, "canonical_bundle_manifest.json"), "utf8")) as { breedSemanticFilename: string };
  const archivePath = resolve(CANONICAL, "breeds", manifest.breedSemanticFilename);
  const archive = openValidatedZip(archivePath);
  const identities = parseJsonLines(member(archive, "canonical_breed_identities.jsonl")) as unknown as V4Identity[];
  const civic = parseJsonLines(member(archive, "effective_breed_semantics.jsonl")) as unknown as V4Effective[];
  const pets = parseJsonLines(member(archive, "pet_policy_semantics.jsonl")) as unknown as V4Effective[];
  return { identities: identities.sort((a, b) => a.breedId.localeCompare(b.breedId)), effective: new Map([...civic, ...pets].map((row) => [row.breedId, row])), archivePath };
}

function addFragment(target: EvidenceFragment[], sourceRecordId: string, sourceScope: "BREED" | "SPECIES" | "CULTURE", fieldPath: string, text: string | null | undefined, authorityWeight: number, basis: string): void {
  const value = compact(String(text ?? ""));
  if (!value) return;
  target.push({ sourceRecordId, sourceScope, fieldPath, text: value, authorityWeight, basis });
}

function traits(payload: LedgerPayload): string[] { return (payload.traits ?? []).map((trait) => compact(String(trait.text ?? trait.historicalFact ?? ""))).filter(Boolean); }
function behavior(payload: LedgerPayload): Record<string, number> { return Object.fromEntries(Object.entries(payload.primitiveBehavior ?? {}).map(([field, value]) => [field, Number(value.score ?? 0)])); }
function parentName(payload: LedgerPayload | undefined): string | null { return payload?.name ? String(payload.name) : null; }

function buildProfile(identity: V4Identity, effective: V4Effective, ledger: ReadonlyMap<string, LedgerPayload>, personalities: ReadonlyMap<string, PersonalityProfile>): BreedEvidenceProfile {
  const breed = ledger.get(identity.breedId);
  if (!breed || breed.recordType !== "BREED") throw new Error(`Canonical research ledger lacks Breed ${identity.breedId}`);
  const species = ledger.get(identity.speciesId);
  const culture = identity.cultureId ? ledger.get(identity.cultureId) : undefined;
  const group = ledger.get(identity.groupId);
  const personalityId = effective.personalityId ?? breed.personalityId ?? null;
  const personality = personalityId ? personalities.get(personalityId) : undefined;
  if (identity.populationKind !== "PET" && (!personalityId || !personality)) throw new Error(`${identity.breedId} lacks current canonical personality authority`);
  const dimensions = Object.fromEntries(Object.entries(effective.dimensions ?? {}).map(([field, row]) => [field, row?.value ?? null]));
  const breedTraits = traits(breed);
  const text = compact(String(breed.text ?? ""));
  const terrainBroad = [...new Set([...asStrings(breed.terrainBroad), ...asStrings(effective.terrainBroad)])].sort();
  const terrainSpecific = [...new Set([...asStrings(breed.terrainSpecific), ...asStrings(effective.terrainSpecific)])].sort();
  const foodBroad = asStrings(breed.foodBroad).sort(); const foodSpecific = asStrings(breed.foodSpecific).sort();
  const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as unknown as Record<ScoreAxis, EvidenceFragment[]>;

  if (personalityId) {
    addFragment(fragments.PERSONALITY_ALIGNMENT, identity.breedId, "BREED", "v4Effective.personalityId", personalityId, 1, "PERSONALITY");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", "v4Effective.personalityId", personalityId, 0.9, "PERSONALITY");
  }
  for (const [field, value] of Object.entries(dimensions)) if (value) addFragment(fragments.PERSONALITY_ALIGNMENT, identity.breedId, "BREED", `v4Effective.dimensions.${field}.value`, `${field} ${value}`, 0.7, "PERSONALITY");
  for (const [field, value] of Object.entries(breed.primitiveBehavior ?? {})) {
    addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.primitiveBehavior.${field}.rationale`, value.rationale, 1, "BEHAVIOR");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.primitiveBehavior.${field}.rationale`, value.rationale, 0.55, "BEHAVIOR");
  }
  addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", text, 0.75, "CANONICAL_TEXT");
  addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", text, 0.8, "ECOLOGY");
  addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", text, 0.9, "CANONICAL_TEXT");
  addFragment(fragments.CANONICAL_TEXT_SUPPORT, identity.breedId, "BREED", "canonicalPayload.text", text, 1, "CANONICAL_TEXT");
  breedTraits.forEach((value, index) => {
    addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.traits.${index}.text`, value, 0.9, "BEHAVIOR");
    addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.traits.${index}.text`, value, 0.95, "ECOLOGY");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.traits.${index}.text`, value, 0.8, "CANONICAL_TEXT");
    addFragment(fragments.CANONICAL_TEXT_SUPPORT, identity.breedId, "BREED", `canonicalPayload.traits.${index}.text`, value, 1, "CANONICAL_TEXT");
  });
  addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.terrainBroad", terrainBroad.join(" "), 0.9, "HABITAT");
  addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.terrainSpecific", terrainSpecific.join(" "), 0.9, "HABITAT");
  addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.foodBroad", foodBroad.join(" "), 0.75, "ECOLOGY");
  addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.foodSpecific", foodSpecific.join(" "), 0.75, "ECOLOGY");

  const parentContexts: { payload: LedgerPayload | undefined; id: string | null; scope: "SPECIES" | "CULTURE"; weight: number; basis: string }[] = [
    { payload: species, id: identity.speciesId, scope: "SPECIES", weight: 0.42, basis: "SPECIES_CONTEXT" },
    { payload: culture, id: identity.cultureId, scope: "CULTURE", weight: 0.32, basis: "CULTURE" },
  ];
  for (const context of parentContexts) {
    if (!context.payload || !context.id) continue;
    addFragment(fragments.BEHAVIOR_ALIGNMENT, context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight, context.basis);
    addFragment(fragments.ECOLOGICAL_ALIGNMENT, context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight, context.basis);
    addFragment(fragments.SYMBOLIC_ALIGNMENT, context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight, context.basis);
    addFragment(fragments.CANONICAL_TEXT_SUPPORT, context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight * 0.8, context.basis);
    traits(context.payload).forEach((value, index) => {
      addFragment(fragments.ECOLOGICAL_ALIGNMENT, context.id!, context.scope, `canonicalPayload.traits.${index}.text`, value, context.weight, context.basis);
      addFragment(fragments.SYMBOLIC_ALIGNMENT, context.id!, context.scope, `canonicalPayload.traits.${index}.text`, value, context.weight, context.basis);
    });
  }

  const humanEcologyText = `${text} ${breedTraits.join(" ")}`.toLowerCase();
  const humanFunctionalEcology = /\b(ocean|marine|river|freshwater|rain|forest|wetland|mountain|stone|desert|soil|migration|seasonal|nomad|pastoral|flight|storm|ice|cold|habitat|agriculture|coastal|navigation)\b/.test(humanEcologyText);
  const ecologyAvailable = identity.populationKind !== "HUMAN" ? Boolean(text || terrainBroad.length || terrainSpecific.length || foodBroad.length || foodSpecific.length) : humanFunctionalEcology;
  return {
    breedId: identity.breedId, breedName: identity.name, speciesId: identity.speciesId, speciesName: parentName(species), populationKind: identity.populationKind,
    cultureId: identity.cultureId, cultureName: parentName(culture), groupId: identity.groupId, groupName: parentName(group), personalityId,
    personalityFamily: personality?.family ?? null, dimensions, primitiveBehavior: behavior(breed), terrainBroad, terrainSpecific, foodBroad, foodSpecific,
    text, traits: breedTraits, fragments, ecologyAvailable,
  };
}

function sourceRefs(v4ArchivePath: string): SourceRef[] {
  const corpusManifestPath = resolve(CANONICAL, "research-corpus/IMPORT_MANIFEST.json");
  const corpusManifest = JSON.parse(readFileSync(corpusManifestPath, "utf8")) as { corpusVersion: string; sourcePackage: string; sourcePackageSha256: string };
  const canonicalManifestPath = resolve(CANONICAL, "canonical_bundle_manifest.json");
  const canonicalManifest = JSON.parse(readFileSync(canonicalManifestPath, "utf8")) as { bundleVersion: string; breedSemanticVersion: string; breedSemanticSha256: string };
  return [
    { path: "resources/canonical/canonical_bundle_manifest.json", version: canonicalManifest.bundleVersion, sha256: fileSha256(canonicalManifestPath), role: "V5 canonical authority locator and version lock" },
    { path: `resources/canonical/breeds/${v4ArchivePath.split("/").at(-1)}`, version: canonicalManifest.breedSemanticVersion, sha256: fileSha256(v4ArchivePath), role: "Canonical Breed identities, effective personalities, dimensions, and terrain" },
    { path: "resources/canonical/research-corpus/IMPORT_MANIFEST.json", version: corpusManifest.corpusVersion, sha256: fileSha256(corpusManifestPath), role: "Research corpus version and reconciliation authority" },
    { path: "resources/canonical/research-corpus/IMPORT_LEDGER.jsonl", version: corpusManifest.corpusVersion, sha256: fileSha256(resolve(CANONICAL, "research-corpus/IMPORT_LEDGER.jsonl")), role: "Rich Breed, Species, Culture, and Breed Group canonical evidence" },
    { path: `resources/canonical/research-corpus/source/${corpusManifest.sourcePackage}`, version: corpusManifest.corpusVersion, sha256: corpusManifest.sourcePackageSha256, role: "Immutable research source package provenance" },
    { path: "resources/canonical/policies/personality_expression_effective_profiles.jsonl", version: "PERSONALITY_PROFILE_DIMENSIONS_V1", sha256: fileSha256(resolve(CANONICAL, "policies/personality_expression_effective_profiles.jsonl")), role: "Personality family and raw-dimension interpretation" },
  ];
}

function confidenceRank(value: Confidence): number { return ["REVIEW_REQUIRED", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"].indexOf(value); }

function buildRecord(profile: BreedEvidenceProfile): CheckpointRecord {
  const candidateAssessments = assessAllDeities(profile);
  if (candidateAssessments.length !== 27 || new Set(candidateAssessments.map((item) => item.deityName)).size !== 27) throw new Error(`${profile.breedId} did not compare all 27 deities exactly once`);
  const confidence = judgeConfidence(profile, candidateAssessments);
  const winner = candidateAssessments[0]!; const runner = candidateAssessments[1]!;
  const classificationStatus: ClassificationStatus = confidence.confidence === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "CLASSIFIED";
  const matched = winner.matchedEvidence;
  const evidence = [...new Map(matched.map((item) => [`${item.sourceRecordId}\0${item.fieldPath}`, `${item.sourceRecordId} ${item.fieldPath}: ${excerpt(item.excerpt, 240)}`])).values()].slice(0, 6);
  if (evidence.length === 0) {
    evidence.push(`${profile.breedId} canonicalPayload.text: ${excerpt(profile.text, 240)}`);
    if (profile.traits[0]) evidence.push(`${profile.breedId} canonicalPayload.traits.0.text: ${excerpt(profile.traits[0], 240)}`);
  }
  const sourceFieldReferences = [...new Map(matched.slice(0, 10).map((item) => [`${item.sourceRecordId}\0${item.fieldPath}`, { sourceRecordId: item.sourceRecordId, sourceScope: item.sourceScope, fieldPath: item.fieldPath, basis: item.basis }])).values()];
  const classificationBasis = [...new Set(matched.slice(0, 10).map((item) => item.basis))];
  if (classificationBasis.length === 0) classificationBasis.push("CANONICAL_TEXT");
  const cues = [...new Set(matched.slice(0, 4).map((item) => item.signal))];
  const margin = rounded(winner.weightedScoreExact - runner.weightedScoreExact);
  const winnerReason = classificationStatus === "REVIEW_REQUIRED"
    ? `${winner.deityName} is the provisional leader over ${runner.deityName} because the canonical evidence contains ${cues.join(", ") || "limited domain-specific support"}; the ${margin.toFixed(3)}-point comparison remains unresolved for the recorded missing-evidence reasons.`
    : `${winner.deityName} better represents this Breed than ${runner.deityName}: canonical ${classificationBasis.join(", ").toLowerCase()} evidence contains ${cues.join(", ") || "the leading domain signals"}, producing broader or more direct support across the weighted axes (${winner.weightedScoreExact.toFixed(3)} versus ${runner.weightedScoreExact.toFixed(3)}).`;
  const primary = deityReference(winner);
  return {
    breedId: profile.breedId, breedName: profile.breedName, speciesId: profile.speciesId, speciesName: profile.speciesName,
    populationKind: profile.populationKind, cultureId: profile.cultureId, cultureName: profile.cultureName, breedGroupId: profile.groupId, breedGroupName: profile.groupName,
    personalityId: profile.personalityId, classificationStatus, primaryDeity: classificationStatus === "CLASSIFIED" ? primary : null,
    provisionalPrimaryDeity: classificationStatus === "REVIEW_REQUIRED" ? primary : null, confidence: confidence.confidence, suggestedConfidence: confidence.suggestedConfidence,
    confidenceRationale: confidence.confidenceRationale, confidenceOverrideReason: confidence.confidenceOverrideReason, evidenceQuality: confidence.evidenceQuality,
    evidenceDirectness: confidence.evidenceDirectness, evidenceBreadth: confidence.evidenceBreadth, evidenceConsistency: confidence.evidenceConsistency,
    evidence, sourceFieldReferences, topCandidates: candidateAssessments.slice(0, 5), allCandidatesDigest: sha256(canonicalJson(candidateAssessments)), runnerUp: runner.deityName,
    winnerReason, classificationBasis, missingEvidence: confidence.missingEvidence, topTwoMargin: margin, candidateAssessments,
  };
}

function checkpointPath(batchNumber: number): string { return resolve(CHECKPOINTS, `batch-${String(batchNumber).padStart(4, "0")}.json`); }
function checkpointPayload(checkpoint: Checkpoint): Omit<Checkpoint, "checkpointHash"> { const { checkpointHash: _checkpointHash, ...payload } = checkpoint; return payload; }
function validateCheckpoint(checkpoint: Checkpoint, expectedInputDigest: string, previousHash: string | null, expectedIds: readonly string[]): void {
  if (checkpoint.inputDigest !== expectedInputDigest || checkpoint.classificationRulesVersion !== BREED_DEITY_CLASSIFICATION_RULES_VERSION) throw new Error(`Checkpoint ${checkpoint.batchNumber} authority digest or rules version changed`);
  if (checkpoint.previousCheckpointHash !== previousHash) throw new Error(`Checkpoint ${checkpoint.batchNumber} chain predecessor mismatch`);
  if (checkpoint.checkpointHash !== sha256(canonicalJson(checkpointPayload(checkpoint)))) throw new Error(`Checkpoint ${checkpoint.batchNumber} content hash mismatch`);
  const ids = checkpoint.records.map((record) => record.breedId);
  if (canonicalJson(ids) !== canonicalJson(expectedIds)) throw new Error(`Checkpoint ${checkpoint.batchNumber} Breed IDs do not match the deterministic batch`);
  if (checkpoint.recordCount !== expectedIds.length || checkpoint.records.length !== expectedIds.length) throw new Error(`Checkpoint ${checkpoint.batchNumber} record count mismatch`);
  if (!checkpoint.finalRemainder && checkpoint.recordCount !== BATCH_SIZE) throw new Error(`Checkpoint ${checkpoint.batchNumber} is not an exact ten-record batch`);
  if (checkpoint.finalRemainder && checkpoint.batchNumber !== EXPECTED_BATCHES) throw new Error(`Only the final checkpoint may be a remainder`);
}

function analytical(record: CheckpointRecord): AnalyticalRecord { const { candidateAssessments: _candidateAssessments, ...value } = record; return value; }

function validateAnalytical(records: readonly AnalyticalRecord[], canonicalIds: readonly string[]): void {
  if (records.length !== EXPECTED_BREEDS || new Set(records.map((record) => record.breedId)).size !== EXPECTED_BREEDS) throw new Error(`Analytical coverage must be exactly ${EXPECTED_BREEDS} unique Breeds`);
  if (canonicalJson(records.map((record) => record.breedId)) !== canonicalJson(canonicalIds)) throw new Error("Analytical Breed set or ordering differs from canonical authority");
  const deityNames = new Set(DEITIES.map((deity) => deity.deityName));
  for (const record of records) {
    if (record.topCandidates.length !== 5 || new Set(record.topCandidates.map((candidate) => candidate.deityName)).size !== 5) throw new Error(`${record.breedId} must retain five unique top candidates`);
    if (record.topCandidates.some((candidate) => !deityNames.has(candidate.deityName))) throw new Error(`${record.breedId} references an unknown deity`);
    for (const candidate of record.topCandidates) {
      const weight = SCORE_AXES.reduce((sum, axis) => sum + candidate.effectiveWeights[axis], 0);
      if (Math.abs(weight - 1) > 0.00001) throw new Error(`${record.breedId}/${candidate.deityName} effective weights do not sum to one`);
      const score = SCORE_AXES.reduce((sum, axis) => sum + candidate.componentScores[axis] * candidate.effectiveWeights[axis], 0);
      if (Math.abs(score - candidate.weightedScoreExact) > 0.002) throw new Error(`${record.breedId}/${candidate.deityName} weighted score does not reproduce`);
    }
    if (record.classificationStatus === "CLASSIFIED" && (!record.primaryDeity || record.provisionalPrimaryDeity || record.confidence === "REVIEW_REQUIRED")) throw new Error(`${record.breedId} classified authority state is invalid`);
    if (record.classificationStatus === "REVIEW_REQUIRED" && (record.primaryDeity !== null || !record.provisionalPrimaryDeity || record.confidence !== "REVIEW_REQUIRED")) throw new Error(`${record.breedId} unresolved authority state is invalid`);
    if (record.confidence !== record.suggestedConfidence && !record.confidenceOverrideReason) throw new Error(`${record.breedId} confidence override lacks a reason`);
    if (record.confidence === record.suggestedConfidence && record.confidenceOverrideReason) throw new Error(`${record.breedId} has a spurious confidence override reason`);
    if (!record.evidence.length || !record.sourceFieldReferences.length && record.classificationStatus === "CLASSIFIED") throw new Error(`${record.breedId} lacks canonical evidence references`);
  }
}

function csvCell(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function buildCsv(records: readonly AnalyticalRecord[]): string {
  const columns = ["breedId", "breedName", "speciesId", "speciesName", "populationKind", "cultureId", "cultureName", "breedGroupId", "breedGroupName", "personalityId", "classificationStatus", "primaryDeityName", "provisionalPrimaryDeityName", "primaryPantheon", "primaryDomain", "confidence", "suggestedConfidence", "confidenceOverrideReason", "runnerUp", "topTwoMargin", "classificationBasis", "evidence", "sourceFieldReferences", "topCandidates", "winnerReason", "missingEvidence"];
  const rows = records.map((record) => [record.breedId, record.breedName, record.speciesId, record.speciesName, record.populationKind, record.cultureId, record.cultureName, record.breedGroupId, record.breedGroupName, record.personalityId, record.classificationStatus, record.primaryDeity?.deityName, record.provisionalPrimaryDeity?.deityName, record.primaryDeity?.pantheon ?? record.provisionalPrimaryDeity?.pantheon, record.primaryDeity?.domain ?? record.provisionalPrimaryDeity?.domain, record.confidence, record.suggestedConfidence, record.confidenceOverrideReason, record.runnerUp, record.topTwoMargin, JSON.stringify(record.classificationBasis), JSON.stringify(record.evidence), JSON.stringify(record.sourceFieldReferences), JSON.stringify(record.topCandidates), record.winnerReason, JSON.stringify(record.missingEvidence)]);
  return `${[columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n")}\n`;
}

function increment(target: Record<string, number>, key: string, amount = 1): void { target[key] = (target[key] ?? 0) + amount; }
function pantheonLabel(pantheon: Pantheon): string { return pantheon === "NINEFOLD_HEART" ? "Human" : pantheon === "NINEFOLD_WILD" ? "Beast" : "Mythos"; }
function kindLabel(kind: PopulationKind): string { return kind[0] + kind.slice(1).toLowerCase(); }

function distribution(records: readonly AnalyticalRecord[]) {
  const classified = records.filter((record) => record.classificationStatus === "CLASSIFIED");
  const review = records.filter((record) => record.classificationStatus === "REVIEW_REQUIRED");
  const byDeity = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, 0])) as Record<string, number>;
  const byPantheon: Record<string, number> = { NINEFOLD_HEART: 0, NINEFOLD_WILD: 0, NINEFOLD_VEIL: 0 };
  const byPopulationKind: Record<string, { total: number; classified: number; reviewRequired: number; byPantheon: Record<string, number> }> = {};
  const byBreedGroup: Record<string, { name: string | null; total: number; classified: number; reviewRequired: number; byDeity: Record<string, number> }> = {};
  const crossPantheon: Record<string, number> = {};
  for (const record of records) {
    const kind = byPopulationKind[record.populationKind] ??= { total: 0, classified: 0, reviewRequired: 0, byPantheon: { NINEFOLD_HEART: 0, NINEFOLD_WILD: 0, NINEFOLD_VEIL: 0 } };
    kind.total += 1;
    const group = byBreedGroup[record.breedGroupId] ??= { name: record.breedGroupName, total: 0, classified: 0, reviewRequired: 0, byDeity: Object.fromEntries(DEITIES.map((deity) => [deity.deityName, 0])) };
    group.total += 1;
    if (record.classificationStatus === "REVIEW_REQUIRED") { kind.reviewRequired += 1; group.reviewRequired += 1; continue; }
    const deity = record.primaryDeity!;
    kind.classified += 1; group.classified += 1; increment(kind.byPantheon, deity.pantheon); increment(group.byDeity, deity.deityName); increment(byDeity, deity.deityName); increment(byPantheon, deity.pantheon);
    increment(crossPantheon, `${kindLabel(record.populationKind)} → ${pantheonLabel(deity.pantheon)}`);
  }
  const globalDenominator = Math.max(1, classified.length);
  const clusters = Object.entries(byBreedGroup).flatMap(([groupId, group]) => DEITIES.map((deity) => {
    const count = group.byDeity[deity.deityName] ?? 0; const groupShare = group.classified ? count / group.classified : 0; const globalShare = (byDeity[deity.deityName] ?? 0) / globalDenominator; const lift = globalShare ? groupShare / globalShare : 0;
    return { groupId, groupName: group.name, deityName: deity.deityName, count, groupShare: rounded(groupShare * 100), globalShare: rounded(globalShare * 100), lift: rounded(lift) };
  }).filter((row) => row.count >= 5 && row.groupShare >= 25 && row.lift >= 2)).sort((a, b) => b.lift - a.lift || b.count - a.count || a.groupId.localeCompare(b.groupId));
  return { total: records.length, classified: classified.length, reviewRequired: review.length, byDeity, byPantheon, byPopulationKind, byBreedGroup, crossPantheon, clusters };
}

function reportMarkdown(records: readonly AnalyticalRecord[], dist: ReturnType<typeof distribution>): string {
  const deityRows = DEITIES.map((deity) => `| ${deity.deityName}, ${deity.deityTitle} | ${deity.pantheon} | ${deity.domain} | ${dist.byDeity[deity.deityName]} |`);
  const frequencies = DEITIES.map((deity) => ({ deityName: deity.deityName, count: dist.byDeity[deity.deityName] ?? 0 }));
  const maximum = Math.max(...frequencies.map((row) => row.count)); const minimum = Math.min(...frequencies.map((row) => row.count));
  const highest = frequencies.filter((row) => row.count === maximum).map((row) => row.deityName).join(", "); const lowest = frequencies.filter((row) => row.count === minimum).map((row) => row.deityName).join(", ");
  const groupRows = Object.entries(dist.byBreedGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupId, group]) => {
    const values = DEITIES.map((deity) => [deity.deityName, group.byDeity[deity.deityName] ?? 0] as const).filter(([, count]) => count > 0).map(([name, count]) => `${name}=${count}`).join("; ");
    return `| ${groupId} | ${group.name ?? ""} | ${group.total} | ${group.classified} | ${group.reviewRequired} | ${values || "—"} |`;
  });
  const overrides = records.filter((record) => record.confidenceOverrideReason);
  const narrow = records.filter((record) => record.topTwoMargin < 5);
  const low = records.filter((record) => record.confidence === "LOW"); const review = records.filter((record) => record.confidence === "REVIEW_REQUIRED");
  return [
    "# Breed Primary Deity Distribution Report", "",
    "This is a non-causal primary-affinity classification. It does not assert exclusive worship and does not modify simulation mechanics.", "",
    "## Totals", "", `- Total Breeds: **${dist.total}**`, `- Classified: **${dist.classified}**`, `- Review required: **${dist.reviewRequired}**`, `- Completed batches: **${EXPECTED_BATCHES}** (206 × 10, final remainder 2)`, "",
    `Highest-frequency deity: **${highest}** (${maximum}).`, `Lowest-frequency deity: **${lowest}** (${minimum}).`, `Zero-assignment deities: **${frequencies.filter((row) => row.count === 0).map((row) => row.deityName).join(", ") || "none"}**.`, "",
    "## By Primary Deity", "", "| Deity | Pantheon | Domain | Accepted assignments |", "|---|---|---|---:|", ...deityRows, "",
    "## By Pantheon", "", ...Object.entries(dist.byPantheon).map(([key, value]) => `- ${key}: ${value}`), "",
    "## By Population Kind", "", "| PopulationKind | Total | Classified | Review required | Heart | Wild | Veil |", "|---|---:|---:|---:|---:|---:|---:|",
    ...Object.entries(dist.byPopulationKind).sort(([a], [b]) => a.localeCompare(b)).map(([kind, value]) => `| ${kind} | ${value.total} | ${value.classified} | ${value.reviewRequired} | ${value.byPantheon.NINEFOLD_HEART} | ${value.byPantheon.NINEFOLD_WILD} | ${value.byPantheon.NINEFOLD_VEIL} |`), "",
    "## Cross-Pantheon", "", ...["Human", "Beast", "Pet", "Mythos"].flatMap((kind) => ["Human", "Beast", "Mythos"].map((pantheon) => `- ${kind} → ${pantheon}: ${dist.crossPantheon[`${kind} → ${pantheon}`] ?? 0}`)), "",
    "## By Breed Group", "", "| Group | Name | Total | Classified | Review required | Accepted deity counts |", "|---|---|---:|---:|---:|---|", ...groupRows, "",
    "## Unusually Strong Clusters", "", "Audit rule: count ≥ 5, within-group share ≥ 25%, and lift ≥ 2× corpus-wide deity share. Clusters are reported without rebalancing.", "", ...(dist.clusters.length ? dist.clusters.map((row) => `- ${row.groupId}${row.groupName ? ` (${row.groupName})` : ""}: ${row.deityName} ${row.count}, ${row.groupShare}% of classified group, ${row.lift}× lift.`) : ["- None."]), "",
    `## Low Confidence (${low.length})`, "", ...(low.length ? low.map((record) => `- ${record.breedId} ${record.breedName}: ${record.primaryDeity?.deityName}; ${record.confidenceRationale}`) : ["- None."]), "",
    `## Review Required (${review.length})`, "", ...(review.length ? review.map((record) => `- ${record.breedId} ${record.breedName}: provisional ${record.provisionalPrimaryDeity?.deityName}; ${record.missingEvidence.join(" ")}`) : ["- None."]), "",
    `## Confidence Threshold Overrides (${overrides.length})`, "", ...(overrides.length ? overrides.map((record) => `- ${record.breedId}: ${record.suggestedConfidence} → ${record.confidence}. ${record.confidenceOverrideReason}`) : ["- None."]), "",
    `## Top-Two Margins Below 5 (${narrow.length})`, "", ...(narrow.length ? narrow.map((record) => `- ${record.breedId}: ${record.primaryDeity?.deityName ?? record.provisionalPrimaryDeity?.deityName} over ${record.runnerUp}, margin ${record.topTwoMargin.toFixed(3)}, status ${record.classificationStatus}.`) : ["- None."]), "",
  ].join("\n");
}

interface Baseline { dirtyPathCount: number; dirtyPaths: { path: string; sha256: string }[]; }
function validatePreexistingBaseline(): { dirtyPathCount: number; preserved: true; mismatches: string[] } {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  const mismatches = baseline.dirtyPaths.filter((row) => !existsSync(resolve(ROOT, row.path)) || fileSha256(resolve(ROOT, row.path)) !== row.sha256).map((row) => row.path);
  if (mismatches.length) throw new Error(`Pre-existing dirty paths changed during classification: ${mismatches.join(", ")}`);
  return { dirtyPathCount: baseline.dirtyPathCount, preserved: true, mismatches };
}

function authority(records: readonly AnalyticalRecord[], inputDigest: string, deityAuthorityHash: string, breedAuthorityHash: string, completedAt: string) {
  const assignments = records.filter((record) => record.classificationStatus === "CLASSIFIED").map((record) => ({
    breedId: record.breedId, primaryDeity: record.primaryDeity, confidence: record.confidence, classificationBasis: record.classificationBasis,
    runnerUpDeityName: record.runnerUp, winnerReason: record.winnerReason, evidenceRefs: record.sourceFieldReferences,
  }));
  const unresolved = records.filter((record) => record.classificationStatus === "REVIEW_REQUIRED").map((record) => ({
    breedId: record.breedId, status: "REVIEW_REQUIRED", primaryDeity: null, provisionalPrimaryDeity: record.provisionalPrimaryDeity,
    runnerUpDeityName: record.runnerUp, suggestedConfidence: record.suggestedConfidence, missingEvidence: record.missingEvidence, reviewRationale: record.confidenceRationale,
  }));
  return {
    schemaVersion: BREED_DEITY_AFFINITY_SCHEMA_VERSION, authorityId: "BREED_PRIMARY_DEITY_V1", authorityVersion: 1,
    authorityStatus: unresolved.length ? "CLASSIFIED_WITH_UNRESOLVED_REVIEW" : "CLASSIFIED_COMPLETE", generatedAt: completedAt,
    meaning: "The deity whose domain most strongly resonates with the canonical characteristics of the Breed; not exclusive worship.",
    inputDigest, deityAuthorityRef: { ...DEITY_SOURCE, sha256: deityAuthorityHash }, breedAuthorityHash,
    counts: { totalBreeds: records.length, classified: assignments.length, reviewRequired: unresolved.length, authorityAssignments: assignments.length },
    assignments, unresolved,
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const summaryOnly = process.argv.includes("--summary");
  const validateOnly = process.argv.includes("--validate-only");
  const limitIndex = process.argv.indexOf("--limit"); const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : BATCH_SIZE;
  const preservationAtStart = validatePreexistingBaseline();
  const startedAt = new Date().toISOString();
  const { identities, effective, archivePath } = loadV4();
  const ledger = await loadLedger();
  const personalities = new Map(jsonLines<PersonalityProfile>(resolve(CANONICAL, "policies/personality_expression_effective_profiles.jsonl")).map((row) => [row.personalityId, row]));
  if (identities.length !== EXPECTED_BREEDS || new Set(identities.map((row) => row.breedId)).size !== EXPECTED_BREEDS) throw new Error(`Canonical authority must contain exactly ${EXPECTED_BREEDS} unique Breeds`);
  const sources = sourceRefs(archivePath);
  const breedAuthorityHash = sha256(canonicalJson(sources));
  const classifierImplementationHash = sha256(CLASSIFIER_IMPLEMENTATION_PATHS.map((path) => `${fileSha256(path)}  ${path.slice(ROOT.length + 1)}`).join("\n") + "\n");
  const deitySnapshot = { schemaVersion: "echoes-deity-authority-snapshot-v1", source: DEITY_SOURCE, deities: DEITIES };
  const deityAuthorityHash = sha256(canonicalJson(deitySnapshot));
  const inputDigest = sha256(canonicalJson({ breedAuthorityHash, deityAuthorityHash, classifierImplementationHash, classificationRulesVersion: BREED_DEITY_CLASSIFICATION_RULES_VERSION, batchSize: BATCH_SIZE, orderingRule: ORDERING_RULE }));
  const runId = `BREED_PRIMARY_DEITY_V1_${inputDigest.slice(0, 16).toUpperCase()}`;
  const profiles = identities.map((identity) => {
    const semantics = effective.get(identity.breedId); if (!semantics) throw new Error(`V4 authority lacks effective semantics for ${identity.breedId}`);
    return buildProfile(identity, semantics, ledger, personalities);
  });
  if (dryRun) {
    if (summaryOnly) {
      const records = profiles.slice(0, Math.min(limit, profiles.length)).map((profile) => analytical(buildRecord(profile)));
      const dist = distribution(records);
      const confidence = Object.fromEntries(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"].map((value) => [value, records.filter((record) => record.confidence === value).length]));
      const provisional = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, records.filter((record) => record.provisionalPrimaryDeity?.deityName === deity.deityName).length]));
      const samples = Object.fromEntries(["HUMAN", "BEAST", "PET", "MYTHOS"].map((kind) => [kind, records.filter((record) => record.populationKind === kind).slice(0, 5).map((record) => ({ breedId: record.breedId, status: record.classificationStatus, deity: record.primaryDeity?.deityName ?? record.provisionalPrimaryDeity?.deityName, confidence: record.confidence, runnerUp: record.runnerUp, margin: record.topTwoMargin }))]));
      process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN_SUMMARY", runId, inputDigest, classifierImplementationHash, count: records.length, classified: dist.classified, reviewRequired: dist.reviewRequired, confidence, acceptedByDeity: dist.byDeity, provisionalByDeity: provisional, byPantheon: dist.byPantheon, byPopulationKind: dist.byPopulationKind, crossPantheon: dist.crossPantheon, clusters: dist.clusters, confidenceOverrides: records.filter((record) => record.confidenceOverrideReason).length, topTwoMarginsBelowFive: records.filter((record) => record.topTwoMargin < 5).length, samples }, null, 2)}\n`);
      return;
    }
    const records = profiles.slice(0, Math.min(limit, profiles.length)).map(buildRecord);
    process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", runId, inputDigest, count: records.length, records: records.map((record) => ({ breedId: record.breedId, status: record.classificationStatus, primary: record.primaryDeity?.deityName ?? null, provisional: record.provisionalPrimaryDeity?.deityName ?? null, confidence: record.confidence, suggestedConfidence: record.suggestedConfidence, runnerUp: record.runnerUp, margin: record.topTwoMargin, topFive: record.topCandidates.map((candidate) => `${candidate.deityName}:${candidate.weightedScoreExact}`), evidence: record.evidence, reason: record.winnerReason })) }, null, 2)}\n`);
    return;
  }

  mkdirSync(CHECKPOINTS, { recursive: true });
  if (!validateOnly) writeJsonAtomic(resolve(OUTPUT, "deity-authority-snapshot.json"), { ...deitySnapshot, sha256: deityAuthorityHash });
  const allCheckpointRecords: CheckpointRecord[] = [];
  const checkpointHashes: { batchNumber: number; checkpointHash: string; firstBreedId: string; lastBreedId: string; recordCount: number }[] = [];
  let previousCheckpointHash: string | null = null;
  for (let offset = 0, batchNumber = 1; offset < profiles.length; offset += BATCH_SIZE, batchNumber += 1) {
    const batchProfiles = profiles.slice(offset, offset + BATCH_SIZE); const expectedIds = batchProfiles.map((profile) => profile.breedId); const path = checkpointPath(batchNumber);
    let checkpoint: Checkpoint;
    if (existsSync(path)) checkpoint = JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
    else {
      if (validateOnly) throw new Error(`Missing checkpoint ${batchNumber}`);
      const records = batchProfiles.map(buildRecord);
      const payload = {
        schemaVersion: "echoes-breed-deity-affinity-checkpoint-v1" as const, authorityId: "BREED_PRIMARY_DEITY_V1" as const, runId, batchNumber,
        requestedBatchSize: BATCH_SIZE as 10, recordCount: records.length, finalRemainder: records.length < BATCH_SIZE, orderingRule: ORDERING_RULE,
        classificationRulesVersion: BREED_DEITY_CLASSIFICATION_RULES_VERSION, inputDigest, previousCheckpointHash,
        firstBreedId: records[0]!.breedId, lastBreedId: records.at(-1)!.breedId, records,
      };
      checkpoint = { ...payload, checkpointHash: sha256(canonicalJson(payload)) };
      writeJsonAtomic(path, checkpoint);
    }
    validateCheckpoint(checkpoint, inputDigest, previousCheckpointHash, expectedIds);
    allCheckpointRecords.push(...checkpoint.records); previousCheckpointHash = checkpoint.checkpointHash;
    checkpointHashes.push({ batchNumber, checkpointHash: checkpoint.checkpointHash, firstBreedId: checkpoint.firstBreedId, lastBreedId: checkpoint.lastBreedId, recordCount: checkpoint.recordCount });
    if (!validateOnly && (batchNumber === 1 || batchNumber % 25 === 0 || batchNumber === EXPECTED_BATCHES)) process.stdout.write(`${JSON.stringify({ status: "CHECKPOINTED", batchNumber, completedRecords: allCheckpointRecords.length, checkpointHash: checkpoint.checkpointHash })}\n`);
  }
  if (checkpointHashes.length !== EXPECTED_BATCHES || checkpointHashes.at(-1)?.recordCount !== 2) throw new Error(`Expected ${EXPECTED_BATCHES} checkpoints with final remainder 2`);
  const records = allCheckpointRecords.map(analytical);
  validateAnalytical(records, identities.map((identity) => identity.breedId));
  const dist = distribution(records);
  if (validateOnly) {
    const preservation = validatePreexistingBaseline();
    process.stdout.write(`${JSON.stringify({ status: "PASS", mode: "VALIDATE_ONLY", runId, inputDigest, totalBreeds: records.length, classified: dist.classified, reviewRequired: dist.reviewRequired, completedBatches: checkpointHashes.length, preservation }, null, 2)}\n`);
    return;
  }
  const completedAt = new Date().toISOString();
  const classifications = { schemaVersion: BREED_DEITY_AFFINITY_SCHEMA_VERSION, authorityId: "BREED_PRIMARY_DEITY_V1", classificationRulesVersion: BREED_DEITY_CLASSIFICATION_RULES_VERSION, meaning: "Primary thematic affinity, not exclusive religion.", totalBreeds: records.length, classified: dist.classified, reviewRequired: dist.reviewRequired, assignments: records };
  const reviewInventory = {
    schemaVersion: "echoes-breed-deity-review-inventory-v1", counts: { low: records.filter((record) => record.confidence === "LOW").length, reviewRequired: dist.reviewRequired, confidenceOverrides: records.filter((record) => record.confidenceOverrideReason).length, marginsBelowFive: records.filter((record) => record.topTwoMargin < 5).length },
    low: records.filter((record) => record.confidence === "LOW"), reviewRequired: records.filter((record) => record.confidence === "REVIEW_REQUIRED"), confidenceOverrides: records.filter((record) => record.confidenceOverrideReason).map((record) => ({ breedId: record.breedId, suggestedConfidence: record.suggestedConfidence, confidence: record.confidence, confidenceOverrideReason: record.confidenceOverrideReason })), marginsBelowFive: records.filter((record) => record.topTwoMargin < 5).map((record) => ({ breedId: record.breedId, leader: record.primaryDeity?.deityName ?? record.provisionalPrimaryDeity?.deityName, runnerUp: record.runnerUp, margin: record.topTwoMargin, status: record.classificationStatus })),
  };
  const paths = {
    classificationsJson: resolve(OUTPUT, "breed-primary-deity-classifications.json"), classificationsCsv: resolve(OUTPUT, "breed-primary-deity-classifications.csv"),
    review: resolve(OUTPUT, "breed-primary-deity-review-required.json"), distribution: resolve(OUTPUT, "breed-primary-deity-distribution-report.md"), manifest: resolve(OUTPUT, "breed-primary-deity-run-manifest.json"), authority: AUTHORITY_PATH,
  };
  writeJsonAtomic(paths.classificationsJson, classifications);
  writeFileSync(paths.classificationsCsv, buildCsv(records), "utf8");
  writeJsonAtomic(paths.review, reviewInventory);
  writeFileSync(paths.distribution, `${reportMarkdown(records, dist)}\n`, "utf8");
  writeJsonAtomic(paths.authority, authority(records, inputDigest, deityAuthorityHash, breedAuthorityHash, completedAt));
  const preservation = validatePreexistingBaseline();
  const outputHashes = {
    "breed-primary-deity-classifications.json": fileSha256(paths.classificationsJson), "breed-primary-deity-classifications.csv": fileSha256(paths.classificationsCsv),
    "breed-primary-deity-review-required.json": fileSha256(paths.review), "breed-primary-deity-distribution-report.md": fileSha256(paths.distribution),
    "deity-authority-snapshot.json": fileSha256(resolve(OUTPUT, "deity-authority-snapshot.json")), "preexisting-worktree-baseline.json": fileSha256(BASELINE_PATH),
    "resources/noncausal/breed-deity-affinity/breed-primary-deity-authority-v1.json": fileSha256(paths.authority),
  };
  const checkpointAggregateSha256 = sha256(checkpointHashes.map((row) => `${row.checkpointHash}  batch-${String(row.batchNumber).padStart(4, "0")}.json`).join("\n") + "\n");
  const confidenceCounts = Object.fromEntries(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"].map((value) => [value, records.filter((record) => record.confidence === value).length]));
  const manifestWithoutHash = {
    schemaVersion: "echoes-breed-deity-affinity-run-manifest-v1", runId, authorityId: "BREED_PRIMARY_DEITY_V1", classificationRulesVersion: BREED_DEITY_CLASSIFICATION_RULES_VERSION,
    repository: { root: ROOT, remote: "git@github.com:bkalaf/echoes-simulator.git", branch: "main", prohibitedRepositoryReads: ["bkalaf/echoes-of-eidolon", "all other Echoes repositories"] },
    sources, breedAuthorityHash, deityAuthoritySource: DEITY_SOURCE, deityAuthorityHash, classifierImplementationHash, inputDigest,
    counts: { totalBreeds: records.length, analyticalRecords: records.length, classified: dist.classified, reviewRequired: dist.reviewRequired, authorityAssignments: dist.classified, completedBatches: checkpointHashes.length, confidence: confidenceCounts },
    orderingRule: ORDERING_RULE, batchSize: BATCH_SIZE, expectedFullBatches: 206, finalRemainder: 2, startTimestamp: startedAt, endTimestamp: completedAt,
    scoring: { axes: AXIS_WEIGHTS, unavailableAxisPolicy: "Omit only genuinely unavailable axes and renormalize remaining weights; weak evidence remains low-scored.", confidencePolicy: "Numeric thresholds are guidance; evidence quality, directness, breadth, consistency, and separation determine final confidence." },
    checkpointChain: { checkpointCount: checkpointHashes.length, aggregateSha256: checkpointAggregateSha256, finalCheckpointHash: previousCheckpointHash, checkpoints: checkpointHashes },
    distributionAudit: { noQuota: true, noPantheonPreference: true, noDistributionBalancing: true, clusterRule: { minimumCount: 5, minimumWithinGroupPercent: 25, minimumLift: 2 }, confidenceOverrides: reviewInventory.counts.confidenceOverrides, topTwoMarginsBelowFive: reviewInventory.counts.marginsBelowFive },
    integrityHashes: outputHashes, preservationValidation: { ...preservationAtStart, ...preservation },
    nonCausalBoundary: { runtimeConsumersAdded: 0, canonicalBundleChangedByThisRun: false, causalRunHashChanged: false, canonicalBundleHashChanged: false, schedulerVersionChanged: false, mechanicsVersionChanged: false, causalDerivationVersionChanged: false, existingRunsOrDatabasesModified: false },
    externalResearchPerformed: false, notionModified: false, committed: false, pushed: false, pullRequestCreated: false,
  };
  const manifestPayloadSha256 = sha256(canonicalJson(manifestWithoutHash));
  writeJsonAtomic(paths.manifest, { ...manifestWithoutHash, manifestPayloadSha256 });
  process.stdout.write(`${JSON.stringify({ status: "PASS", runId, inputDigest, totalBreeds: records.length, classified: dist.classified, reviewRequired: dist.reviewRequired, completedBatches: checkpointHashes.length, finalCheckpointHash: previousCheckpointHash, manifestPayloadSha256, outputHashes, preservation }, null, 2)}\n`);
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
