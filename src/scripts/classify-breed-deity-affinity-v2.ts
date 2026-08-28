import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import {
  AXIS_WEIGHTS,
  DEITIES,
  SCORE_AXES,
  type BreedEvidenceProfile,
  type ClassificationStatus,
  type Confidence,
  type DeityAuthorityRecord,
  type EvidenceFragment,
  type Pantheon,
  type PopulationKind,
  type ScoreAxis,
} from "../core/research/breed-deity-affinity.js";
import {
  BREED_DEITY_AFFINITY_V2_SCHEMA_VERSION,
  BREED_DEITY_V2_RULES_VERSION,
  DEITY_EVIDENCE_PROFILES_V2,
  assessAllDeitiesV2,
  buildSignalFrequencyAudit,
  calibratePersonalityFamily,
  calibrationLookup,
  deityReferenceV2,
  frequencyLookup,
  judgeConfidenceV2,
  type CandidateAssessmentV2,
  type PersonalityFamilyAffinity,
  type SignalFrequencyRow,
} from "../core/research/breed-deity-affinity-v2.js";

const ROOT = process.cwd();
const CANONICAL = resolve(ROOT, "resources/canonical");
const V1_OUTPUT = resolve(ROOT, "artifacts/simulator/v5/breed-deity-affinity");
const V1_AUTHORITY = resolve(ROOT, "resources/noncausal/breed-deity-affinity/breed-primary-deity-authority-v1.json");
const V1_CLASSIFICATIONS = resolve(V1_OUTPUT, "breed-primary-deity-classifications.json");
const V1_MANIFEST = resolve(V1_OUTPUT, "breed-primary-deity-run-manifest.json");
const V1_DIRTY_BASELINE = resolve(V1_OUTPUT, "preexisting-worktree-baseline.json");
const OUTPUT = resolve(ROOT, "artifacts/simulator/v5/breed-deity-affinity-v2");
const CHECKPOINTS = resolve(OUTPUT, "checkpoints");
const MANUAL_AUDIT = resolve(OUTPUT, "manual-audit");
const AUTHORITY_PATH = resolve(ROOT, "resources/noncausal/breed-deity-affinity/breed-primary-deity-authority-v2.json");
const V1_PRESERVATION_BASELINE = resolve(OUTPUT, "v1-preservation-baseline-v2.json");
const BATCH_SIZE = 10 as const;
const EXPECTED_BREEDS = 2062;
const EXPECTED_BATCHES = 207;
const ORDERING_RULE = "Breed ID ascending (localeCompare), exactly ten previously unresolved records per full batch";
const V1_EXPECTED_INVENTORY_SHA256 = "2df9394bfc081c38fb41f0cf7642c3c77f4f0de2e10e86cceab80bbd5110a56b";
const DEITY_SOURCE = {
  sourceType: "NOTION_PAGE_SNAPSHOT",
  pageId: "3b62380d-0cae-81b6-a408-fb2b08712efc",
  pageTitle: "Deities",
  sourceUrl: "https://www.notion.so/3b62380d0cae81b6a408fb2b08712efc",
  fetchedAt: "2026-08-28T06:52:52.414Z",
  frozenFromV1: true,
  readOnly: true,
} as const;

const CLASSIFIER_IMPLEMENTATION_PATHS = [
  resolve(ROOT, "src/core/research/breed-deity-affinity-v2.ts"),
  resolve(ROOT, "src/scripts/classify-breed-deity-affinity-v2.ts"),
];

interface LedgerTrait { text?: string; historicalFact?: string; }
interface LedgerPayload {
  id: string;
  name?: string;
  recordType: string;
  text?: string;
  personalityId?: string | null;
  traits?: LedgerTrait[];
  terrainBroad?: unknown[];
  terrainSpecific?: unknown[];
  foodBroad?: unknown[];
  foodSpecific?: unknown[];
  primitiveBehavior?: Record<string, { score?: number; rationale?: string }>;
}
interface LedgerRow { recordId?: string; recordType?: string; canonicalMaterialized?: boolean; canonicalPayload?: LedgerPayload; }
interface V4Identity { breedId: string; name: string; speciesId: string; groupId: string; cultureId: string | null; populationKind: PopulationKind; }
interface V4Effective {
  breedId: string;
  personalityId: string | null;
  dimensions?: Record<string, { value: string | null } | null>;
  terrainBroad?: string[];
  terrainSpecific?: string[];
}
interface PersonalityProfile { personalityId: string; family: string; dimensions: Record<string, string>; }
interface SourceRef { path: string; version: string; sha256: string; role: string; }
interface V1Candidate { deityName: string; weightedScoreExact: number; matchedEvidence?: { signal: string }[]; }
interface V1Record {
  breedId: string;
  populationKind: PopulationKind;
  breedGroupId: string;
  personalityId: string | null;
  classificationStatus: ClassificationStatus;
  primaryDeity: DeityAuthorityRecord | null;
  provisionalPrimaryDeity: DeityAuthorityRecord | null;
  confidence: Confidence;
  runnerUp: string;
  topTwoMargin: number;
  topCandidates: V1Candidate[];
}
interface V1Classifications { assignments: V1Record[]; }

interface SourceFieldReference {
  sourceRecordId: string;
  sourceScope: EvidenceFragment["sourceScope"];
  fieldPath: string;
  sourceFactId: string;
  semanticCluster: string;
  evidenceTier: string;
  axesInformed: ScoreAxis[];
  basis: string[];
}

interface AnalyticalRecordV2 {
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
  personalityFamily: string | null;
  classificationStatus: ClassificationStatus;
  primaryDeity: DeityAuthorityRecord | null;
  provisionalPrimaryDeity: DeityAuthorityRecord | null;
  confidence: Confidence;
  suggestedConfidence: Confidence;
  confidenceRationale: string;
  confidenceOverrideReason: string | null;
  confidenceInputs: ReturnType<typeof judgeConfidenceV2>["confidenceInputs"];
  evidenceQuality: ReturnType<typeof judgeConfidenceV2>["evidenceQuality"];
  evidenceDirectness: ReturnType<typeof judgeConfidenceV2>["evidenceDirectness"];
  evidenceBreadth: number;
  evidenceConsistency: ReturnType<typeof judgeConfidenceV2>["evidenceConsistency"];
  evidence: string[];
  sourceFieldReferences: SourceFieldReference[];
  topCandidates: CandidateAssessmentV2[];
  allCandidatesDigest: string;
  runnerUp: string;
  winnerReason: string;
  classificationBasis: string[];
  missingEvidence: string[];
  topTwoMargin: number;
  affectedCalibrationRules: string[];
}
interface CheckpointRecordV2 extends AnalyticalRecordV2 { candidateAssessments: CandidateAssessmentV2[]; }
interface CheckpointV2 {
  schemaVersion: "echoes-breed-deity-affinity-checkpoint-v2";
  authorityId: "BREED_PRIMARY_DEITY_V2";
  runId: string;
  batchNumber: number;
  requestedBatchSize: 10;
  recordCount: number;
  finalRemainder: boolean;
  orderingRule: string;
  classificationRulesVersion: string;
  inputDigest: string;
  signalFrequencyAuditHash: string;
  personalityCalibrationHash: string;
  previousCheckpointHash: string | null;
  firstBreedId: string;
  lastBreedId: string;
  records: CheckpointRecordV2[];
  checkpointHash: string;
}

function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function fileSha256(path: string): string { return sha256(readFileSync(path)); }
function rounded(value: number, places = 3): number { const scale = 10 ** places; return Math.round(value * scale) / scale; }
function compact(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function excerpt(value: string, limit = 320): string { const text = compact(value); return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`; }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function jsonLines<T>(path: string): T[] { return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T); }
function member(archive: ReturnType<typeof openValidatedZip>, name: string): Uint8Array { const bytes = archive.entries[`${archive.prefix}${name}`]; if (!bytes) throw new Error(`V4 authority is missing ${name}`); return bytes; }

function writeTextAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, path);
}
function writeJsonAtomic(path: string, value: unknown): void { writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`); }

async function loadLedger(): Promise<Map<string, LedgerPayload>> {
  const ledger = new Map<string, LedgerPayload>();
  const lines = createInterface({ input: createReadStream(resolve(CANONICAL, "research-corpus/IMPORT_LEDGER.jsonl"), "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line) as LedgerRow;
    if (row.recordId && row.recordType && row.canonicalPayload && row.canonicalMaterialized === true) ledger.set(row.recordId, row.canonicalPayload);
  }
  return ledger;
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

function addFragment(target: EvidenceFragment[], sourceRecordId: string, sourceScope: EvidenceFragment["sourceScope"], fieldPath: string, text: string | null | undefined, authorityWeight: number, basis: string): void {
  const value = compact(String(text ?? ""));
  if (value) target.push({ sourceRecordId, sourceScope, fieldPath, text: value, authorityWeight, basis });
}
function traits(payload: LedgerPayload): string[] { return (payload.traits ?? []).map((trait) => compact(String(trait.text ?? trait.historicalFact ?? ""))).filter(Boolean); }
function behavior(payload: LedgerPayload): Record<string, number> { return Object.fromEntries(Object.entries(payload.primitiveBehavior ?? {}).map(([field, value]) => [field, Number(value.score ?? 0)])); }
function parentName(payload: LedgerPayload | undefined): string | null { return payload?.name ? String(payload.name) : null; }

function buildProfile(identity: V4Identity, effective: V4Effective, ledger: ReadonlyMap<string, LedgerPayload>, personalities: ReadonlyMap<string, PersonalityProfile>): BreedEvidenceProfile {
  const breed = ledger.get(identity.breedId);
  if (!breed || breed.recordType !== "BREED") throw new Error(`Canonical research ledger lacks Breed ${identity.breedId}`);
  const species = ledger.get(identity.speciesId); const culture = identity.cultureId ? ledger.get(identity.cultureId) : undefined; const group = ledger.get(identity.groupId);
  const personalityId = effective.personalityId ?? breed.personalityId ?? null; const personality = personalityId ? personalities.get(personalityId) : undefined;
  if (identity.populationKind !== "PET" && (!personalityId || !personality)) throw new Error(`${identity.breedId} lacks current canonical personality authority`);
  const dimensions = Object.fromEntries(Object.entries(effective.dimensions ?? {}).map(([field, row]) => [field, row?.value ?? null]));
  const breedTraits = traits(breed); const rawText = String(breed.text ?? ""); const text = compact(rawText);
  const textFacts = rawText.split(/\n\s*\n/).map(compact).filter(Boolean);
  const terrainBroad = [...new Set([...asStrings(breed.terrainBroad), ...asStrings(effective.terrainBroad)])].sort();
  const terrainSpecific = [...new Set([...asStrings(breed.terrainSpecific), ...asStrings(effective.terrainSpecific)])].sort();
  const foodBroad = asStrings(breed.foodBroad).sort(); const foodSpecific = asStrings(breed.foodSpecific).sort();
  const fragments = Object.fromEntries(SCORE_AXES.map((axis) => [axis, [] as EvidenceFragment[]])) as Record<ScoreAxis, EvidenceFragment[]>;
  if (personalityId) {
    addFragment(fragments.PERSONALITY_ALIGNMENT, identity.breedId, "BREED", "v4Effective.personalityId", personalityId, 1, "PERSONALITY");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", "v4Effective.personalityId", personalityId, 0.9, "PERSONALITY");
  }
  for (const [field, value] of Object.entries(dimensions)) if (value) addFragment(fragments.PERSONALITY_ALIGNMENT, identity.breedId, "BREED", `v4Effective.dimensions.${field}.value`, `${field} ${value}`, 0.7, "PERSONALITY");
  for (const [field, value] of Object.entries(breed.primitiveBehavior ?? {})) {
    addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.primitiveBehavior.${field}.rationale`, value.rationale, 1, "BEHAVIOR");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.primitiveBehavior.${field}.rationale`, value.rationale, 0.55, "BEHAVIOR");
    if (Number(value.score ?? 0) >= 3) addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", `canonicalPayload.primitiveBehavior.${field}.score`, `${field} high score ${value.score}/4`, 0.45, "BEHAVIOR");
  }
  for (const fact of textFacts.length ? textFacts : [text]) {
    const inheritedContext = /inherits the exact species terrain|owner group .* does not override|remaining primitive scores/.test(fact.toLowerCase());
    const basis = inheritedContext ? "INHERITED_CONTEXT" : "CANONICAL_TEXT"; const factor = inheritedContext ? 0.35 : 1;
    addFragment(fragments.BEHAVIOR_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", fact, 0.75 * factor, basis);
    addFragment(fragments.ECOLOGICAL_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", fact, 0.8 * factor, inheritedContext ? "INHERITED_CONTEXT" : "ECOLOGY");
    addFragment(fragments.SYMBOLIC_ALIGNMENT, identity.breedId, "BREED", "canonicalPayload.text", fact, 0.9 * factor, basis);
    addFragment(fragments.CANONICAL_TEXT_SUPPORT, identity.breedId, "BREED", "canonicalPayload.text", fact, factor, basis);
  }
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
  const contexts: { payload: LedgerPayload | undefined; id: string | null; scope: "SPECIES" | "CULTURE"; weight: number; basis: string }[] = [
    { payload: species, id: identity.speciesId, scope: "SPECIES", weight: 0.42, basis: "SPECIES_CONTEXT" },
    { payload: culture, id: identity.cultureId, scope: "CULTURE", weight: 0.32, basis: "CULTURE" },
  ];
  for (const context of contexts) {
    if (!context.payload || !context.id) continue;
    for (const axis of ["BEHAVIOR_ALIGNMENT", "ECOLOGICAL_ALIGNMENT", "SYMBOLIC_ALIGNMENT"] as const) addFragment(fragments[axis], context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight, context.basis);
    addFragment(fragments.CANONICAL_TEXT_SUPPORT, context.id, context.scope, "canonicalPayload.text", context.payload.text, context.weight * 0.8, context.basis);
    traits(context.payload).forEach((value, index) => {
      addFragment(fragments.ECOLOGICAL_ALIGNMENT, context.id!, context.scope, `canonicalPayload.traits.${index}.text`, value, context.weight, context.basis);
      addFragment(fragments.SYMBOLIC_ALIGNMENT, context.id!, context.scope, `canonicalPayload.traits.${index}.text`, value, context.weight, context.basis);
    });
  }
  const functional = `${text} ${breedTraits.join(" ")}`.toLowerCase();
  const humanFunctionalEcology = /\b(ocean|marine|river|freshwater|rain|forest|wetland|mountain|stone|desert|soil|migration|seasonal|nomad|pastoral|flight|storm|ice|cold|habitat|agriculture|coastal|navigation)\b/.test(functional);
  return {
    breedId: identity.breedId, breedName: identity.name, speciesId: identity.speciesId, speciesName: parentName(species), populationKind: identity.populationKind,
    cultureId: identity.cultureId, cultureName: parentName(culture), groupId: identity.groupId, groupName: parentName(group), personalityId,
    personalityFamily: personality?.family ?? null, dimensions, primitiveBehavior: behavior(breed), terrainBroad, terrainSpecific, foodBroad, foodSpecific,
    text, traits: breedTraits, fragments, ecologyAvailable: identity.populationKind !== "HUMAN" ? Boolean(text || terrainBroad.length || terrainSpecific.length || foodBroad.length || foodSpecific.length) : humanFunctionalEcology,
  };
}

function sourceRefs(v4ArchivePath: string): SourceRef[] {
  const corpusManifestPath = resolve(CANONICAL, "research-corpus/IMPORT_MANIFEST.json");
  const corpusManifest = JSON.parse(readFileSync(corpusManifestPath, "utf8")) as { corpusVersion: string; sourcePackage: string; sourcePackageSha256: string };
  const canonicalManifestPath = resolve(CANONICAL, "canonical_bundle_manifest.json");
  const canonicalManifest = JSON.parse(readFileSync(canonicalManifestPath, "utf8")) as { bundleVersion: string; breedSemanticVersion: string };
  return [
    { path: "resources/canonical/canonical_bundle_manifest.json", version: canonicalManifest.bundleVersion, sha256: fileSha256(canonicalManifestPath), role: "V5 canonical authority locator and version lock" },
    { path: `resources/canonical/breeds/${v4ArchivePath.split("/").at(-1)}`, version: canonicalManifest.breedSemanticVersion, sha256: fileSha256(v4ArchivePath), role: "Canonical Breed identities, effective personalities, dimensions, and terrain" },
    { path: "resources/canonical/research-corpus/IMPORT_MANIFEST.json", version: corpusManifest.corpusVersion, sha256: fileSha256(corpusManifestPath), role: "Research corpus version and reconciliation authority" },
    { path: "resources/canonical/research-corpus/IMPORT_LEDGER.jsonl", version: corpusManifest.corpusVersion, sha256: fileSha256(resolve(CANONICAL, "research-corpus/IMPORT_LEDGER.jsonl")), role: "Rich Breed, Species, Culture, and Breed Group canonical evidence" },
    { path: `resources/canonical/research-corpus/source/${corpusManifest.sourcePackage}`, version: corpusManifest.corpusVersion, sha256: corpusManifest.sourcePackageSha256, role: "Immutable research source package provenance" },
    { path: "resources/canonical/policies/personality_expression_effective_profiles.jsonl", version: "PERSONALITY_PROFILE_DIMENSIONS_V1", sha256: fileSha256(resolve(CANONICAL, "policies/personality_expression_effective_profiles.jsonl")), role: "Personality family and raw-dimension interpretation" },
  ];
}

function recursiveFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? recursiveFiles(child) : [child];
  }).sort();
}
function v1Inventory() {
  const files = [...recursiveFiles(V1_OUTPUT), V1_AUTHORITY];
  const rows = files.map((path) => ({ path: relative(ROOT, path), sha256: fileSha256(path), bytes: statSync(path).size }));
  const sha256Value = sha256(rows.map((row) => `${row.sha256}  ${row.path}`).join("\n") + "\n");
  return { fileCount: rows.length, sha256: sha256Value, files: rows };
}
function validateV1Frozen(writeBaseline: boolean) {
  const inventory = v1Inventory();
  if (inventory.fileCount !== 215 || inventory.sha256 !== V1_EXPECTED_INVENTORY_SHA256) throw new Error(`V1 freeze mismatch before V2 work: ${inventory.fileCount} files, ${inventory.sha256}`);
  if (existsSync(V1_PRESERVATION_BASELINE)) {
    const baseline = JSON.parse(readFileSync(V1_PRESERVATION_BASELINE, "utf8")) as typeof inventory;
    if (canonicalJson(baseline) !== canonicalJson(inventory)) throw new Error("V1 artifacts changed relative to the V2 preservation baseline");
  } else if (writeBaseline) writeJsonAtomic(V1_PRESERVATION_BASELINE, inventory);
  return inventory;
}
interface DirtyBaseline { dirtyPathCount: number; dirtyPaths: { path: string; sha256: string }[]; }
function validateOriginalDirtyBaseline() {
  const baseline = JSON.parse(readFileSync(V1_DIRTY_BASELINE, "utf8")) as DirtyBaseline;
  const mismatches = baseline.dirtyPaths.filter((row) => !existsSync(resolve(ROOT, row.path)) || fileSha256(resolve(ROOT, row.path)) !== row.sha256).map((row) => row.path);
  if (mismatches.length) throw new Error(`Pre-V1 dirty paths changed: ${mismatches.join(", ")}`);
  return { dirtyPathCount: baseline.dirtyPathCount, preserved: true, mismatches };
}

function parseV1FamilyMappings(personalityProfiles: readonly PersonalityProfile[]) {
  const source = readFileSync(resolve(ROOT, "src/core/research/breed-deity-affinity.ts"), "utf8");
  const expressions = new Map<string, PersonalityProfile[]>();
  for (const row of personalityProfiles) { const values = expressions.get(row.family) ?? []; values.push(row); expressions.set(row.family, values); }
  const mappings: { deityName: string; family: string; v1Strength: number; personalityExpressions: string[]; v2Strength: number; v2Tier: string; semanticJustification: string; changed: boolean }[] = [];
  const pattern = /^  ("[^"]+"|[A-Za-z-]+): \{ families: \{([^}]*)\}, personality:/gm;
  for (const match of source.matchAll(pattern)) {
    const deityName = match[1]!.replaceAll('"', "");
    for (const familyMatch of match[2]!.matchAll(/([A-Z_]+):\s*(\d+)/g)) {
      const family = familyMatch[1]!; const v1Strength = Number(familyMatch[2]); const calibration = calibratePersonalityFamily(deityName, family, v1Strength);
      mappings.push({ deityName, family, v1Strength, personalityExpressions: (expressions.get(family) ?? []).map((row) => row.personalityId).sort(), v2Strength: calibration.v2Strength, v2Tier: calibration.tier, semanticJustification: calibration.semanticJustification, changed: calibration.v2Strength !== v1Strength });
    }
  }
  if (new Set(mappings.map((row) => row.deityName)).size !== 27) throw new Error("Could not audit all 27 V1 personality-family mappings");
  const rows: PersonalityFamilyAffinity[] = mappings.map((row) => ({ deityName: row.deityName, family: row.family, v2Strength: row.v2Strength, tier: row.v2Tier as PersonalityFamilyAffinity["tier"], semanticJustification: row.semanticJustification }));
  return { mappings: mappings.sort((a, b) => a.deityName.localeCompare(b.deityName) || a.family.localeCompare(b.family)), rows };
}

function buildRecord(profile: BreedEvidenceProfile, frequencies: ReturnType<typeof frequencyLookup>, calibrations: ReturnType<typeof calibrationLookup>): CheckpointRecordV2 {
  const candidateAssessments = assessAllDeitiesV2(profile, frequencies, calibrations);
  if (candidateAssessments.length !== 27 || new Set(candidateAssessments.map((candidate) => candidate.deityName)).size !== 27) throw new Error(`${profile.breedId} did not compare all 27 deities exactly once`);
  const confidence = judgeConfidenceV2(profile, candidateAssessments); const winner = candidateAssessments[0]!; const runner = candidateAssessments[1]!;
  const status: ClassificationStatus = confidence.confidence === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "CLASSIFIED";
  const primary = deityReferenceV2(winner); const leadingClusters = winner.semanticEvidenceClusters.filter((cluster) => cluster.strongestTier !== "CONTRADICTORY").slice(0, 12);
  const evidence = [...new Map(leadingClusters.map((cluster) => [cluster.sourceFactId, `${cluster.sourceRecordId} ${cluster.fieldPath}: ${excerpt(cluster.excerpt, 240)}`])).values()].slice(0, 8);
  if (!evidence.length) evidence.push(`${profile.breedId} canonicalPayload.text: ${excerpt(profile.text, 240)}`);
  const sourceFieldReferences = leadingClusters.map((cluster): SourceFieldReference => ({ sourceRecordId: cluster.sourceRecordId, sourceScope: cluster.sourceScope, fieldPath: cluster.fieldPath, sourceFactId: cluster.sourceFactId, semanticCluster: cluster.semanticCluster, evidenceTier: cluster.strongestTier, axesInformed: cluster.axesInformed, basis: cluster.basis }));
  const classificationBasis = [...new Set(leadingClusters.flatMap((cluster) => cluster.basis))]; if (!classificationBasis.length) classificationBasis.push("CANONICAL_TEXT");
  const margin = rounded(winner.weightedScoreExact - runner.weightedScoreExact);
  const winnerClusters = [...new Set(leadingClusters.slice(0, 4).map((cluster) => `${cluster.semanticCluster} (${cluster.strongestTier})`))];
  const winnerReason = status === "REVIEW_REQUIRED"
    ? `${winner.deityName} is provisional over ${runner.deityName}; deduplicated support is ${winnerClusters.join(", ") || "insufficiently specific"}, but the ${margin.toFixed(3)}-point result remains unresolved: ${confidence.missingEvidence.join(" ")}`
    : `${winner.deityName} better represents this Breed than ${runner.deityName}: ${winnerClusters.join(", ")} provides deduplicated support across ${winner.independentSemanticClusterCount} semantic clusters and ${winner.independentSourceFactCount} source facts (${winner.weightedScoreExact.toFixed(3)} versus ${runner.weightedScoreExact.toFixed(3)}).`;
  return {
    breedId: profile.breedId, breedName: profile.breedName, speciesId: profile.speciesId, speciesName: profile.speciesName,
    populationKind: profile.populationKind, cultureId: profile.cultureId, cultureName: profile.cultureName, breedGroupId: profile.groupId, breedGroupName: profile.groupName,
    personalityId: profile.personalityId, personalityFamily: profile.personalityFamily, classificationStatus: status, primaryDeity: status === "CLASSIFIED" ? primary : null,
    provisionalPrimaryDeity: status === "REVIEW_REQUIRED" ? primary : null, confidence: confidence.confidence, suggestedConfidence: confidence.suggestedConfidence,
    confidenceRationale: confidence.confidenceRationale, confidenceOverrideReason: confidence.confidenceOverrideReason, confidenceInputs: confidence.confidenceInputs,
    evidenceQuality: confidence.evidenceQuality, evidenceDirectness: confidence.evidenceDirectness, evidenceBreadth: confidence.evidenceBreadth, evidenceConsistency: confidence.evidenceConsistency,
    evidence, sourceFieldReferences, topCandidates: candidateAssessments.slice(0, 5), allCandidatesDigest: sha256(canonicalJson(candidateAssessments)), runnerUp: runner.deityName,
    winnerReason, classificationBasis, missingEvidence: confidence.missingEvidence, topTwoMargin: margin, affectedCalibrationRules: [...new Set(winner.calibrationRules)].sort(), candidateAssessments,
  };
}

function analytical(record: CheckpointRecordV2): AnalyticalRecordV2 { const { candidateAssessments: _all, ...row } = record; return row; }
function checkpointPath(batchNumber: number): string { return resolve(CHECKPOINTS, `batch-${String(batchNumber).padStart(4, "0")}.json`); }
function checkpointPayload(checkpoint: CheckpointV2): Omit<CheckpointV2, "checkpointHash"> { const { checkpointHash: _hash, ...payload } = checkpoint; return payload; }
function validateCheckpoint(checkpoint: CheckpointV2, inputDigest: string, frequencyHash: string, calibrationHash: string, previousHash: string | null, expectedIds: readonly string[]): void {
  if (checkpoint.inputDigest !== inputDigest || checkpoint.classificationRulesVersion !== BREED_DEITY_V2_RULES_VERSION || checkpoint.signalFrequencyAuditHash !== frequencyHash || checkpoint.personalityCalibrationHash !== calibrationHash) throw new Error(`Checkpoint ${checkpoint.batchNumber} V2 authority or calibration digest changed`);
  if (checkpoint.previousCheckpointHash !== previousHash || checkpoint.checkpointHash !== sha256(canonicalJson(checkpointPayload(checkpoint)))) throw new Error(`Checkpoint ${checkpoint.batchNumber} chain hash mismatch`);
  if (canonicalJson(checkpoint.records.map((row) => row.breedId)) !== canonicalJson(expectedIds)) throw new Error(`Checkpoint ${checkpoint.batchNumber} Breed ordering mismatch`);
  if (checkpoint.recordCount !== expectedIds.length || checkpoint.records.length !== expectedIds.length) throw new Error(`Checkpoint ${checkpoint.batchNumber} size mismatch`);
  if (!checkpoint.finalRemainder && checkpoint.recordCount !== 10 || checkpoint.finalRemainder && (checkpoint.batchNumber !== 207 || checkpoint.recordCount !== 2)) throw new Error(`Checkpoint ${checkpoint.batchNumber} violates exact batching`);
  for (const row of checkpoint.records) if (row.candidateAssessments.length !== 27) throw new Error(`${row.breedId} checkpoint lacks 27 candidate assessments`);
}

function validateAnalytical(records: readonly AnalyticalRecordV2[], canonicalIds: readonly string[]): void {
  if (records.length !== EXPECTED_BREEDS || new Set(records.map((row) => row.breedId)).size !== EXPECTED_BREEDS || canonicalJson(records.map((row) => row.breedId)) !== canonicalJson(canonicalIds)) throw new Error("V2 analytical Breed-set equality failed");
  const deityNames = new Set(DEITIES.map((deity) => deity.deityName));
  for (const record of records) {
    if (record.topCandidates.length !== 5 || new Set(record.topCandidates.map((row) => row.deityName)).size !== 5) throw new Error(`${record.breedId} lacks five unique top candidates`);
    for (const candidate of record.topCandidates) {
      if (!deityNames.has(candidate.deityName)) throw new Error(`${record.breedId} uses unknown deity ${candidate.deityName}`);
      const totalWeight = SCORE_AXES.reduce((sum, axis) => sum + candidate.effectiveWeights[axis], 0);
      if (Math.abs(totalWeight - 1) > 0.00001) throw new Error(`${record.breedId}/${candidate.deityName} weights do not sum to one`);
      const reproduced = SCORE_AXES.reduce((sum, axis) => sum + candidate.componentScores[axis] * candidate.effectiveWeights[axis], 0);
      if (Math.abs(reproduced - candidate.weightedScoreExact) > 0.002) throw new Error(`${record.breedId}/${candidate.deityName} score arithmetic failed`);
      const keys = candidate.semanticEvidenceClusters.map((cluster) => `${cluster.sourceFactId}\0${cluster.semanticCluster}`);
      if (new Set(keys).size !== keys.length) throw new Error(`${record.breedId}/${candidate.deityName} has duplicate semantic fact clusters`);
      for (const cluster of candidate.semanticEvidenceClusters) {
        if (cluster.specificityFactor < 0.72 || cluster.specificityFactor > 1.25) throw new Error(`${record.breedId}/${candidate.deityName} specificity factor is out of bounds`);
        if (cluster.axesInformed.length > 1 && !(cluster.crossAxisFactors[cluster.axesInformed[1]!]! < cluster.crossAxisFactors[cluster.axesInformed[0]!]!)) throw new Error(`${record.breedId}/${candidate.deityName} cross-axis reuse is not diminished`);
        if (!cluster.rawLexicalMatches.length || !cluster.sourceFactId || !cluster.fieldPath) throw new Error(`${record.breedId}/${candidate.deityName} semantic audit fields are incomplete`);
      }
    }
    if (record.classificationStatus === "CLASSIFIED" && (!record.primaryDeity || record.provisionalPrimaryDeity || record.confidence === "REVIEW_REQUIRED")) throw new Error(`${record.breedId} accepted state invalid`);
    if (record.classificationStatus === "REVIEW_REQUIRED" && (record.primaryDeity !== null || !record.provisionalPrimaryDeity || record.confidence !== "REVIEW_REQUIRED")) throw new Error(`${record.breedId} unresolved state invalid`);
    if (record.confidence !== record.suggestedConfidence && !record.confidenceOverrideReason || record.confidence === record.suggestedConfidence && record.confidenceOverrideReason) throw new Error(`${record.breedId} confidence override audit invalid`);
    if (!record.evidence.length || record.classificationStatus === "CLASSIFIED" && !record.sourceFieldReferences.length) throw new Error(`${record.breedId} lacks canonical evidence`);
  }
}

function selectedDeity(record: Pick<AnalyticalRecordV2, "primaryDeity" | "provisionalPrimaryDeity"> | Pick<V1Record, "primaryDeity" | "provisionalPrimaryDeity">): string { return (record.primaryDeity ?? record.provisionalPrimaryDeity)!.deityName; }
function confidenceRank(value: Confidence): number { return ["REVIEW_REQUIRED", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"].indexOf(value); }
function increment(target: Record<string, number>, key: string, amount = 1): void { target[key] = (target[key] ?? 0) + amount; }
function denseDeityCounts(): Record<string, number> { return Object.fromEntries(DEITIES.map((deity) => [deity.deityName, 0])); }

function buildChangeAudit(v1Records: readonly V1Record[], v2Records: readonly AnalyticalRecordV2[]) {
  const v1 = new Map(v1Records.map((row) => [row.breedId, row]));
  const rows = v2Records.map((v2) => {
    const before = v1.get(v2.breedId); if (!before) throw new Error(`V1 lacks ${v2.breedId}`);
    const v1Deity = selectedDeity(before); const v2Deity = selectedDeity(v2); const v1Winner = before.topCandidates[0]!; const v2Winner = v2.topCandidates[0]!;
    const v2OldCandidate = v2.topCandidates.find((candidate) => candidate.deityName === v1Deity);
    const deityChanged = v1Deity !== v2Deity; const statusChanged = before.classificationStatus !== v2.classificationStatus; const confidenceChanged = before.confidence !== v2.confidence;
    const affectedRules = [...new Set([...v2.affectedCalibrationRules, ...(v2OldCandidate?.calibrationRules ?? []), "SEMANTIC_FACT_DEDUPLICATION", "CROSS_AXIS_REUSE_CAP", "CORPUS_SIGNAL_SPECIFICITY", "DEITY_EVIDENCE_TIERING", "CONFIDENCE_CLUSTER_RECALIBRATION"])].sort();
    const changes = [
      deityChanged ? `leader changed from ${v1Deity} to ${v2Deity}` : `leader remained ${v2Deity}`,
      statusChanged ? `status changed ${before.classificationStatus} to ${v2.classificationStatus}` : `status remained ${v2.classificationStatus}`,
      confidenceChanged ? `confidence changed ${before.confidence} to ${v2.confidence}` : `confidence remained ${v2.confidence}`,
    ];
    const reason = `${changes.join("; ")}. V2 scores deduplicated semantic facts and bounded reuse; ${v2Deity} is supported by ${v2Winner.semanticEvidenceClusters.slice(0, 4).map((cluster) => `${cluster.semanticCluster}:${cluster.strongestTier}`).join(", ") || "no sufficiently specific cluster"}, yielding ${v2Winner.weightedScoreExact.toFixed(3)} versus ${v2.topCandidates[1]!.weightedScoreExact.toFixed(3)}. Affected rules: ${affectedRules.join(", ")}.`;
    return {
      breedId: v2.breedId, breedName: v2.breedName, populationKind: v2.populationKind, breedGroupId: v2.breedGroupId, personalityFamily: v2.personalityFamily,
      v1: { status: before.classificationStatus, deity: before.primaryDeity?.deityName ?? null, provisionalDeity: before.provisionalPrimaryDeity?.deityName ?? null, confidence: before.confidence, winnerScore: v1Winner.weightedScoreExact, runnerUp: before.runnerUp, margin: before.topTwoMargin },
      v2: { status: v2.classificationStatus, deity: v2.primaryDeity?.deityName ?? null, provisionalDeity: v2.provisionalPrimaryDeity?.deityName ?? null, confidence: v2.confidence, winnerScore: v2Winner.weightedScoreExact, runnerUp: v2.runnerUp, margin: v2.topTwoMargin },
      deityChanged, statusChanged, confidenceChanged, confidenceLevelsChanged: Math.abs(confidenceRank(v2.confidence) - confidenceRank(before.confidence)), exactReason: reason, affectedCalibrationRules: affectedRules,
    };
  });
  const byDeity = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, { v1Selected: 0, v2Selected: 0, retained: 0, won: 0, lost: 0 }])) as Record<string, { v1Selected: number; v2Selected: number; retained: number; won: number; lost: number }>;
  const byPopulationKind: Record<string, { total: number; deityChanged: number; statusChanged: number; confidenceChanged: number }> = {};
  const byBreedGroup: Record<string, { total: number; deityChanged: number; statusChanged: number; confidenceChanged: number }> = {};
  const byPersonalityFamily: Record<string, { total: number; deityChanged: number; statusChanged: number; confidenceChanged: number }> = {};
  const confidenceTransitions: Record<string, number> = {}; const pairMatrix: Record<string, Record<string, number>> = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, denseDeityCounts()]));
  for (const row of rows) {
    const from = row.v1.deity ?? row.v1.provisionalDeity!; const to = row.v2.deity ?? row.v2.provisionalDeity!;
    byDeity[from]!.v1Selected += 1; byDeity[to]!.v2Selected += 1; increment(pairMatrix[from]!, to);
    if (from === to) byDeity[to]!.retained += 1; else { byDeity[from]!.lost += 1; byDeity[to]!.won += 1; }
    for (const [key, target] of [[row.populationKind, byPopulationKind], [row.breedGroupId, byBreedGroup], [row.personalityFamily ?? "POLICY_NULL", byPersonalityFamily]] as const) {
      const value = target[key] ??= { total: 0, deityChanged: 0, statusChanged: 0, confidenceChanged: 0 }; value.total += 1; if (row.deityChanged) value.deityChanged += 1; if (row.statusChanged) value.statusChanged += 1; if (row.confidenceChanged) value.confidenceChanged += 1;
    }
    increment(confidenceTransitions, `${row.v1.confidence} → ${row.v2.confidence}`);
  }
  const overSignals: Record<string, number> = {}; const underSignals: Record<string, number> = {};
  for (const row of rows.filter((item) => item.deityChanged)) {
    const before = v1.get(row.breedId)!;
    for (const match of before.topCandidates[0]?.matchedEvidence ?? []) increment(overSignals, `${selectedDeity(before)}:${match.signal}`);
    const after = v2Records.find((record) => record.breedId === row.breedId)!;
    for (const cluster of after.topCandidates[0]!.semanticEvidenceClusters.slice(0, 6)) increment(underSignals, `${selectedDeity(after)}:${cluster.semanticCluster}`);
  }
  const top = (value: Record<string, number>) => Object.entries(value).map(([signal, count]) => ({ signal, count })).sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal)).slice(0, 100);
  return {
    schemaVersion: "echoes-breed-deity-v1-to-v2-change-audit-v2", counts: { total: rows.length, deityChanged: rows.filter((row) => row.deityChanged).length, statusChanged: rows.filter((row) => row.statusChanged).length, confidenceChanged: rows.filter((row) => row.confidenceChanged).length, confidenceChangedByTwoOrMore: rows.filter((row) => row.confidenceLevelsChanged >= 2).length },
    summaries: { byDeity, byPopulationKind, byBreedGroup, byPersonalityFamily, confidenceTransitions, deityWinLossPairMatrix: pairMatrix, v1OverrepresentedSignalPatterns: top(overSignals), v1UnderrepresentedSignalPatterns: top(underSignals) }, rows,
  };
}

function buildDiagnostics(records: readonly AnalyticalRecordV2[], checkpointRecords: readonly CheckpointRecordV2[], changeAudit: ReturnType<typeof buildChangeAudit>) {
  const accepted = records.filter((row) => row.classificationStatus === "CLASSIFIED"); const review = records.filter((row) => row.classificationStatus === "REVIEW_REQUIRED");
  const acceptedByDeity = denseDeityCounts(); const provisionalByDeity = denseDeityCounts(); const runnerUpFrequency = denseDeityCounts();
  const populationKindByDeity: Record<string, Record<string, number>> = {}; const breedGroupByDeity: Record<string, Record<string, number>> = {}; const personalityFamilyByDeity: Record<string, Record<string, number>> = {};
  for (const record of records) {
    const chosen = selectedDeity(record); increment(record.classificationStatus === "CLASSIFIED" ? acceptedByDeity : provisionalByDeity, chosen); increment(runnerUpFrequency, record.runnerUp);
    const target = record.classificationStatus === "CLASSIFIED" ? chosen : `PROVISIONAL:${chosen}`;
    increment(populationKindByDeity[record.populationKind] ??= {}, target); increment(breedGroupByDeity[record.breedGroupId] ??= {}, target); increment(personalityFamilyByDeity[record.personalityFamily ?? "POLICY_NULL"] ??= {}, target);
  }
  const marginBins: Record<string, number> = { "0-1.499": 0, "1.5-2.999": 0, "3-4.999": 0, "5-9.999": 0, "10-19.999": 0, "20+": 0 };
  for (const row of records) increment(marginBins, row.topTwoMargin < 1.5 ? "0-1.499" : row.topTwoMargin < 3 ? "1.5-2.999" : row.topTwoMargin < 5 ? "3-4.999" : row.topTwoMargin < 10 ? "5-9.999" : row.topTwoMargin < 20 ? "10-19.999" : "20+");
  const confidenceDistribution = Object.fromEntries(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"].map((confidence) => [confidence, records.filter((row) => row.confidence === confidence).length]));
  const evidencePrevalence = DEITIES.map((deity) => {
    const containing = checkpointRecords.filter((record) => record.candidateAssessments.find((candidate) => candidate.deityName === deity.deityName)!.semanticEvidenceClusters.some((cluster) => cluster.strongestTier === "DEFINING" || cluster.strongestTier === "STRONG")).length;
    const assignmentCount = acceptedByDeity[deity.deityName] ?? 0; const assignmentShare = assignmentCount / records.length; const strongEvidenceShare = containing / records.length;
    const ratio = strongEvidenceShare ? assignmentShare / strongEvidenceShare : assignmentShare ? Number.POSITIVE_INFINITY : 1; const divergencePoints = (assignmentShare - strongEvidenceShare) * 100;
    return { deityName: deity.deityName, assignmentCount, assignmentShare: rounded(assignmentShare * 100), strongOrDefiningEvidenceBreeds: containing, strongOrDefiningEvidenceShare: rounded(strongEvidenceShare * 100), divergencePercentagePoints: rounded(divergencePoints), ratio: Number.isFinite(ratio) ? rounded(ratio) : "INFINITY", flaggedForSemanticReview: Math.abs(divergencePoints) >= 5 && (ratio >= 2 || ratio <= 0.5) };
  });
  const triggerCounts: Record<string, { deityName: string; semanticCluster: string; wins: number; acceptedDeityTotal: number }> = {};
  for (const record of accepted) for (const semanticCluster of new Set(record.topCandidates[0]!.semanticEvidenceClusters.filter((cluster) => cluster.strongestTier !== "CONTRADICTORY").map((cluster) => cluster.semanticCluster))) {
    const key = `${selectedDeity(record)}\0${semanticCluster}`; const row = triggerCounts[key] ??= { deityName: selectedDeity(record), semanticCluster, wins: 0, acceptedDeityTotal: acceptedByDeity[selectedDeity(record)]! }; row.wins += 1;
  }
  const highConcentrationSemanticTriggers = Object.values(triggerCounts).map((row) => ({ ...row, withinDeityShare: rounded(row.wins / row.acceptedDeityTotal * 100) })).filter((row) => row.wins >= 5 && row.withinDeityShare >= 25).sort((a, b) => b.withinDeityShare - a.withinDeityShare || b.wins - a.wins || a.deityName.localeCompare(b.deityName));
  return { schemaVersion: "echoes-breed-deity-distribution-diagnostics-v2", diagnosticOnly: true, quotasApplied: false, counts: { totalBreeds: records.length, classified: accepted.length, reviewRequired: review.length }, acceptedByDeity, provisionalReviewRequiredByDeity: provisionalByDeity, populationKindByDeity, breedGroupByDeity, personalityFamilyByDeity, deityRunnerUpFrequency: runnerUpFrequency, deityWinLossPairMatrix: changeAudit.summaries.deityWinLossPairMatrix, margins: { bins: marginBins, belowFive: records.filter((row) => row.topTwoMargin < 5).length }, confidenceDistribution, zeroAssignmentDeities: DEITIES.filter((deity) => !acceptedByDeity[deity.deityName]).map((deity) => deity.deityName), rareAssignmentDeities: DEITIES.filter((deity) => acceptedByDeity[deity.deityName]! < 10).map((deity) => ({ deityName: deity.deityName, count: acceptedByDeity[deity.deityName] })), highConcentrationSemanticTriggers, assignmentShareVsStrongEvidenceShare: evidencePrevalence };
}

function deterministicSample<T>(rows: readonly T[], count: number, seed: string, key: (row: T) => string): T[] {
  return [...rows].sort((left, right) => sha256(`${seed}\0${key(left)}`).localeCompare(sha256(`${seed}\0${key(right)}`)) || key(left).localeCompare(key(right))).slice(0, count);
}
function auditView(record: AnalyticalRecordV2) { return { breedId: record.breedId, breedName: record.breedName, status: record.classificationStatus, deity: record.primaryDeity?.deityName ?? null, provisionalDeity: record.provisionalPrimaryDeity?.deityName ?? null, confidence: record.confidence, score: record.topCandidates[0]!.weightedScoreExact, runnerUp: record.runnerUp, margin: record.topTwoMargin, winnerReason: record.winnerReason, evidence: record.evidence, sourceFieldReferences: record.sourceFieldReferences, topCandidates: record.topCandidates }; }

function writeManualAudits(records: readonly AnalyticalRecordV2[], changeAudit: ReturnType<typeof buildChangeAudit>, seed: string): Record<string, string> {
  mkdirSync(MANUAL_AUDIT, { recursive: true });
  const accepted = records.filter((row) => row.classificationStatus === "CLASSIFIED");
  const topByDeity = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, accepted.filter((row) => row.primaryDeity!.deityName === deity.deityName).sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || b.topCandidates[0]!.weightedScoreExact - a.topCandidates[0]!.weightedScoreExact || b.topTwoMargin - a.topTwoMargin || a.breedId.localeCompare(b.breedId)).slice(0, 25).map(auditView)]));
  const randomByDeity = Object.fromEntries(DEITIES.map((deity) => [deity.deityName, deterministicSample(accepted.filter((row) => row.primaryDeity!.deityName === deity.deityName), 25, `${seed}:random:${deity.deityName}`, (row) => row.breedId).map(auditView)]));
  const rareNames = new Set(DEITIES.filter((deity) => accepted.filter((row) => row.primaryDeity!.deityName === deity.deityName).length < 10).map((deity) => deity.deityName));
  const changedIds = new Set(deterministicSample(changeAudit.rows.filter((row) => row.deityChanged), 50, `${seed}:changed`, (row) => row.breedId).map((row) => row.breedId));
  const largeConfidenceIds = new Set(deterministicSample(changeAudit.rows.filter((row) => row.confidenceLevelsChanged >= 2), 50, `${seed}:confidence`, (row) => row.breedId).map((row) => row.breedId));
  const payloads: Record<string, unknown> = {
    "top-25-highest-confidence-per-deity-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "TOP_25_HIGHEST_CONFIDENCE_PER_DEITY", byDeity: topByDeity },
    "random-25-accepted-per-deity-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "DETERMINISTIC_RANDOM_25_ACCEPTED_PER_DEITY", seed, byDeity: randomByDeity },
    "all-rare-deity-assignments-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "ALL_ASSIGNMENTS_FOR_DEITIES_BELOW_10", rareDeities: [...rareNames], records: accepted.filter((row) => rareNames.has(row.primaryDeity!.deityName)).map(auditView) },
    "miren-50-deterministic-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "MIREN_50_DETERMINISTIC", seed, records: deterministicSample(accepted.filter((row) => row.primaryDeity!.deityName === "Miren"), 50, `${seed}:Miren`, (row) => row.breedId).map(auditView) },
    "changed-deity-50-deterministic-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "V1_TO_V2_CHANGED_DEITY_50", seed, available: changeAudit.counts.deityChanged, records: records.filter((row) => changedIds.has(row.breedId)).map(auditView) },
    "confidence-changed-two-levels-50-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "CONFIDENCE_CHANGED_TWO_OR_MORE_LEVELS_50", seed, available: changeAudit.counts.confidenceChangedByTwoOrMore, records: records.filter((row) => largeConfidenceIds.has(row.breedId)).map(auditView) },
    "all-review-required-v2.json": { schemaVersion: "echoes-breed-deity-manual-audit-v2", category: "ALL_REVIEW_REQUIRED", records: records.filter((row) => row.classificationStatus === "REVIEW_REQUIRED").map(auditView) },
  };
  const hashes: Record<string, string> = {};
  for (const [name, payload] of Object.entries(payloads)) { const path = resolve(MANUAL_AUDIT, name); writeJsonAtomic(path, payload); hashes[`manual-audit/${name}`] = fileSha256(path); }
  return hashes;
}

function csvCell(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function buildCsv(records: readonly AnalyticalRecordV2[]): string {
  const columns = ["breedId", "breedName", "speciesId", "populationKind", "breedGroupId", "personalityId", "personalityFamily", "classificationStatus", "primaryDeityName", "provisionalPrimaryDeityName", "confidence", "suggestedConfidence", "runnerUp", "topTwoMargin", "independentSemanticClusters", "independentSourceFacts", "definingClusters", "strongClusters", "singleFieldDependence", "confidenceOverrideReason", "classificationBasis", "sourceFieldReferences", "topCandidates", "winnerReason", "missingEvidence"];
  const rows = records.map((row) => [row.breedId, row.breedName, row.speciesId, row.populationKind, row.breedGroupId, row.personalityId, row.personalityFamily, row.classificationStatus, row.primaryDeity?.deityName, row.provisionalPrimaryDeity?.deityName, row.confidence, row.suggestedConfidence, row.runnerUp, row.topTwoMargin, row.confidenceInputs.independentSemanticClusters, row.confidenceInputs.independentSourceFacts, row.confidenceInputs.definingClusters, row.confidenceInputs.strongClusters, row.confidenceInputs.singleFieldDependence, row.confidenceOverrideReason, JSON.stringify(row.classificationBasis), JSON.stringify(row.sourceFieldReferences), JSON.stringify(row.topCandidates), row.winnerReason, JSON.stringify(row.missingEvidence)]);
  return `${[columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n")}\n`;
}

function reportMarkdown(diagnostics: ReturnType<typeof buildDiagnostics>, changeAudit: ReturnType<typeof buildChangeAudit>): string {
  const deityRows = DEITIES.map((deity) => {
    const evidence = diagnostics.assignmentShareVsStrongEvidenceShare.find((row) => row.deityName === deity.deityName)!;
    return `| ${deity.deityName} | ${diagnostics.acceptedByDeity[deity.deityName]} | ${diagnostics.provisionalReviewRequiredByDeity[deity.deityName]} | ${evidence.assignmentShare}% | ${evidence.strongOrDefiningEvidenceShare}% | ${evidence.divergencePercentagePoints} pp | ${evidence.flaggedForSemanticReview ? "FLAG" : ""} |`;
  });
  return [
    "# Breed Primary Deity V2 Distribution Diagnostics", "", "Distribution is diagnostic only. No quota, rarity reward, popularity penalty, pantheon preference, or PopulationKind preference is part of scoring.", "",
    "## Totals", "", `- Total Breeds: **${diagnostics.counts.totalBreeds}**`, `- Classified: **${diagnostics.counts.classified}**`, `- Review required: **${diagnostics.counts.reviewRequired}**`, `- V1 → V2 deity changes: **${changeAudit.counts.deityChanged}**`, `- V1 → V2 status changes: **${changeAudit.counts.statusChanged}**`, "",
    "## Deity Assignments and Evidence Prevalence", "", "| Deity | Accepted | Provisional review | Assignment share | Strong/defining evidence share | Divergence | Audit |", "|---|---:|---:|---:|---:|---:|---|", ...deityRows, "",
    "## Confidence", "", ...Object.entries(diagnostics.confidenceDistribution).map(([key, value]) => `- ${key}: ${value}`), "",
    "## Margins", "", ...Object.entries(diagnostics.margins.bins).map(([key, value]) => `- ${key}: ${value}`), `- Below five: ${diagnostics.margins.belowFive}`, "",
    `## Rare and Zero Assignment Deities`, "", `- Zero: ${diagnostics.zeroAssignmentDeities.join(", ") || "none"}`, `- Fewer than 10: ${diagnostics.rareAssignmentDeities.map((row) => `${row.deityName}=${row.count}`).join(", ") || "none"}`, "",
    "## High-Concentration Semantic Triggers", "", ...diagnostics.highConcentrationSemanticTriggers.map((row) => `- ${row.deityName}/${row.semanticCluster}: ${row.wins} wins (${row.withinDeityShare}% of accepted ${row.deityName}).`), "",
    "Full PopulationKind, Breed Group, Personality family, runner-up, win/loss, and divergence matrices are preserved in `breed-primary-deity-distribution-diagnostics-v2.json`.", "",
  ].join("\n");
}

function changeReportMarkdown(audit: ReturnType<typeof buildChangeAudit>): string {
  return ["# Breed Primary Deity V1 → V2 Change Audit", "", `- Total: ${audit.counts.total}`, `- Deity changed: ${audit.counts.deityChanged}`, `- Status changed: ${audit.counts.statusChanged}`, `- Confidence changed: ${audit.counts.confidenceChanged}`, `- Confidence changed by two or more levels: ${audit.counts.confidenceChangedByTwoOrMore}`, "", "## Confidence Transitions", "", ...Object.entries(audit.summaries.confidenceTransitions).sort().map(([key, value]) => `- ${key}: ${value}`), "", "## Deity Wins and Losses", "", "| Deity | V1 selected | V2 selected | Retained | Won | Lost |", "|---|---:|---:|---:|---:|---:|", ...DEITIES.map((deity) => { const row = audit.summaries.byDeity[deity.deityName]!; return `| ${deity.deityName} | ${row.v1Selected} | ${row.v2Selected} | ${row.retained} | ${row.won} | ${row.lost} |`; }), "", "Complete per-Breed changes, PopulationKind, Breed Group, Personality family, pair matrix, and signal-pattern summaries are in the JSON audit.", ""].join("\n");
}

function authority(records: readonly AnalyticalRecordV2[], inputDigest: string, breedAuthorityHash: string, deityAuthorityHash: string, completedAt: string) {
  const assignments = records.filter((row) => row.classificationStatus === "CLASSIFIED").map((row) => ({ breedId: row.breedId, primaryDeity: row.primaryDeity, confidence: row.confidence, classificationBasis: row.classificationBasis, runnerUpDeityName: row.runnerUp, winnerReason: row.winnerReason, evidenceRefs: row.sourceFieldReferences }));
  const unresolved = records.filter((row) => row.classificationStatus === "REVIEW_REQUIRED").map((row) => ({ breedId: row.breedId, status: "REVIEW_REQUIRED", primaryDeity: null, provisionalPrimaryDeity: row.provisionalPrimaryDeity, runnerUpDeityName: row.runnerUp, suggestedConfidence: row.suggestedConfidence, missingEvidence: row.missingEvidence, reviewRationale: row.confidenceRationale }));
  return { schemaVersion: BREED_DEITY_AFFINITY_V2_SCHEMA_VERSION, authorityId: "BREED_PRIMARY_DEITY_V2", authorityVersion: 2, supersedesForReviewOnly: "BREED_PRIMARY_DEITY_V1", v1Mutated: false, authorityStatus: unresolved.length ? "CLASSIFIED_WITH_UNRESOLVED_REVIEW" : "CLASSIFIED_COMPLETE", generatedAt: completedAt, meaning: "The deity whose domain most strongly resonates with canonical Breed characteristics; not exclusive worship.", inputDigest, deityAuthorityRef: { ...DEITY_SOURCE, sha256: deityAuthorityHash }, breedAuthorityHash, counts: { totalBreeds: records.length, classified: assignments.length, reviewRequired: unresolved.length, authorityAssignments: assignments.length }, assignments, unresolved };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run"); const summaryOnly = process.argv.includes("--summary"); const validateOnly = process.argv.includes("--validate-only");
  const limitAt = process.argv.indexOf("--limit"); const limit = limitAt >= 0 ? Number(process.argv[limitAt + 1]) : EXPECTED_BREEDS;
  const startedAt = new Date().toISOString();
  const v1AtStart = validateV1Frozen(!dryRun && !validateOnly); const dirtyAtStart = validateOriginalDirtyBaseline();
  const v1Manifest = JSON.parse(readFileSync(V1_MANIFEST, "utf8")) as { breedAuthorityHash: string; deityAuthorityHash: string; inputDigest: string; classifierImplementationHash: string; integrityHashes: Record<string, string> };
  const v1Classifications = JSON.parse(readFileSync(V1_CLASSIFICATIONS, "utf8")) as V1Classifications;
  const { identities, effective, archivePath } = loadV4(); const ledger = await loadLedger();
  const personalityProfiles = jsonLines<PersonalityProfile>(resolve(CANONICAL, "policies/personality_expression_effective_profiles.jsonl"));
  const personalities = new Map(personalityProfiles.map((row) => [row.personalityId, row]));
  if (identities.length !== EXPECTED_BREEDS || new Set(identities.map((row) => row.breedId)).size !== EXPECTED_BREEDS) throw new Error("Frozen Breed authority is not the exact 2,062 set");
  const sources = sourceRefs(archivePath); const breedAuthorityHash = sha256(canonicalJson(sources));
  if (breedAuthorityHash !== v1Manifest.breedAuthorityHash) throw new Error("V2 Breed source authority differs from V1");
  const v1DeitySnapshot = JSON.parse(readFileSync(resolve(V1_OUTPUT, "deity-authority-snapshot.json"), "utf8")) as { sha256: string; deities: unknown[] };
  if (v1DeitySnapshot.sha256 !== v1Manifest.deityAuthorityHash || canonicalJson(v1DeitySnapshot.deities) !== canonicalJson(DEITIES)) throw new Error("V1 deity snapshot does not match the frozen 27-deity code authority");
  const deityAuthorityHash = v1Manifest.deityAuthorityHash;
  const profiles = identities.map((identity) => { const semantics = effective.get(identity.breedId); if (!semantics) throw new Error(`V4 authority lacks ${identity.breedId}`); return buildProfile(identity, semantics, ledger, personalities); });
  const personalityAudit = parseV1FamilyMappings(personalityProfiles); const calibrations = calibrationLookup(personalityAudit.rows);
  const personalityCalibrationArtifact = { schemaVersion: "echoes-personality-deity-affinity-calibration-v2", calibrationRule: "No mapping is based on deity distribution; family names narrow concepts but never replace defining Breed evidence.", v1SourcePath: "src/core/research/breed-deity-affinity.ts", v1ClassifierImplementationHash: v1Manifest.classifierImplementationHash, mappingCount: personalityAudit.mappings.length, mappings: personalityAudit.mappings };
  const personalityCalibrationHash = sha256(canonicalJson(personalityCalibrationArtifact));
  const signalFrequencyRows = buildSignalFrequencyAudit(profiles, calibrations); const signalFrequencyArtifact = { schemaVersion: "echoes-breed-deity-signal-frequency-audit-v2", corpusSize: profiles.length, specificityFormula: "clamp(0.72 + 0.53 * normalizedInverseFrequency, tierFloor, 1.25); STRONG/DEFINING floor=0.85", distributionIndependent: true, rows: signalFrequencyRows };
  const signalFrequencyAuditHash = sha256(canonicalJson(signalFrequencyArtifact)); const frequencies = frequencyLookup(signalFrequencyRows);
  const classifierImplementationHash = sha256(CLASSIFIER_IMPLEMENTATION_PATHS.map((path) => `${fileSha256(path)}  ${relative(ROOT, path)}`).join("\n") + "\n");
  const inputDigest = sha256(canonicalJson({ breedAuthorityHash, deityAuthorityHash, classifierImplementationHash, personalityCalibrationHash, signalFrequencyAuditHash, rules: BREED_DEITY_V2_RULES_VERSION, batchSize: BATCH_SIZE, orderingRule: ORDERING_RULE, v1InputDigest: v1Manifest.inputDigest }));
  const runId = `BREED_PRIMARY_DEITY_V2_${inputDigest.slice(0, 16).toUpperCase()}`;
  if (dryRun) {
    const checkpointRecords = profiles.slice(0, Math.min(limit, profiles.length)).map((profile) => buildRecord(profile, frequencies, calibrations));
    const records = checkpointRecords.map(analytical);
    const confidence = Object.fromEntries(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "REVIEW_REQUIRED"].map((value) => [value, records.filter((row) => row.confidence === value).length]));
    const byDeity = denseDeityCounts(); const provisional = denseDeityCounts(); for (const row of records) increment(row.classificationStatus === "CLASSIFIED" ? byDeity : provisional, selectedDeity(row));
    const completeCorpus = records.length === EXPECTED_BREEDS;
    const dryChangeAudit = completeCorpus ? buildChangeAudit(v1Classifications.assignments, records) : null;
    const dryDiagnostics = dryChangeAudit ? buildDiagnostics(records, checkpointRecords, dryChangeAudit) : null;
    process.stdout.write(`${JSON.stringify({ mode: summaryOnly ? "DRY_RUN_SUMMARY" : "DRY_RUN", runId, inputDigest, classifierImplementationHash, personalityCalibrationHash, signalFrequencyAuditHash, count: records.length, classified: records.filter((row) => row.classificationStatus === "CLASSIFIED").length, reviewRequired: records.filter((row) => row.classificationStatus === "REVIEW_REQUIRED").length, confidence, acceptedByDeity: byDeity, provisionalByDeity: provisional, marginsBelowFive: records.filter((row) => row.topTwoMargin < 5).length, v1ToV2Changes: dryChangeAudit?.counts, byPopulationKind: dryDiagnostics?.populationKindByDeity, highConcentrationSemanticTriggers: dryDiagnostics?.highConcentrationSemanticTriggers.slice(0, 60), assignmentShareVsStrongEvidenceShare: dryDiagnostics?.assignmentShareVsStrongEvidenceShare, samples: records.slice(0, 20).map((row) => ({ breedId: row.breedId, status: row.classificationStatus, deity: selectedDeity(row), confidence: row.confidence, runnerUp: row.runnerUp, margin: row.topTwoMargin, clusters: row.topCandidates[0]!.semanticEvidenceClusters.slice(0, 4).map((cluster) => ({ cluster: cluster.semanticCluster, tier: cluster.strongestTier, sourceRecordId: cluster.sourceRecordId, fieldPath: cluster.fieldPath, excerpt: cluster.excerpt })) })) }, null, 2)}\n`);
    return;
  }
  mkdirSync(CHECKPOINTS, { recursive: true }); mkdirSync(MANUAL_AUDIT, { recursive: true });
  if (!validateOnly) {
    writeJsonAtomic(resolve(OUTPUT, "deity-authority-snapshot-v2.json"), { schemaVersion: "echoes-deity-authority-snapshot-v2", source: DEITY_SOURCE, v1DeityAuthorityHash: deityAuthorityHash, deities: DEITIES });
    writeJsonAtomic(resolve(OUTPUT, "deity-evidence-profiles-v2.json"), { schemaVersion: "echoes-deity-evidence-profiles-v2", distributionIndependent: true, profiles: DEITIES.map((deity) => DEITY_EVIDENCE_PROFILES_V2[deity.deityName]) });
    writeJsonAtomic(resolve(OUTPUT, "personality-deity-affinity-calibration-v2.json"), { ...personalityCalibrationArtifact, sha256: personalityCalibrationHash });
    writeJsonAtomic(resolve(OUTPUT, "signal-frequency-audit-v2.json"), { ...signalFrequencyArtifact, sha256: signalFrequencyAuditHash });
  }
  const all: CheckpointRecordV2[] = []; const checkpointHashes: { batchNumber: number; checkpointHash: string; firstBreedId: string; lastBreedId: string; recordCount: number }[] = []; let previous: string | null = null;
  for (let offset = 0, batchNumber = 1; offset < profiles.length; offset += BATCH_SIZE, batchNumber += 1) {
    const batch = profiles.slice(offset, offset + BATCH_SIZE); const expectedIds = batch.map((row) => row.breedId); const path = checkpointPath(batchNumber); let checkpoint: CheckpointV2;
    if (existsSync(path)) checkpoint = JSON.parse(readFileSync(path, "utf8")) as CheckpointV2;
    else {
      if (validateOnly) throw new Error(`Missing V2 checkpoint ${batchNumber}`);
      const records = batch.map((profile) => buildRecord(profile, frequencies, calibrations));
      const payload = { schemaVersion: "echoes-breed-deity-affinity-checkpoint-v2" as const, authorityId: "BREED_PRIMARY_DEITY_V2" as const, runId, batchNumber, requestedBatchSize: BATCH_SIZE, recordCount: records.length, finalRemainder: records.length < BATCH_SIZE, orderingRule: ORDERING_RULE, classificationRulesVersion: BREED_DEITY_V2_RULES_VERSION, inputDigest, signalFrequencyAuditHash, personalityCalibrationHash, previousCheckpointHash: previous, firstBreedId: records[0]!.breedId, lastBreedId: records.at(-1)!.breedId, records };
      checkpoint = { ...payload, checkpointHash: sha256(canonicalJson(payload)) }; writeJsonAtomic(path, checkpoint);
    }
    validateCheckpoint(checkpoint, inputDigest, signalFrequencyAuditHash, personalityCalibrationHash, previous, expectedIds); all.push(...checkpoint.records); previous = checkpoint.checkpointHash;
    checkpointHashes.push({ batchNumber, checkpointHash: checkpoint.checkpointHash, firstBreedId: checkpoint.firstBreedId, lastBreedId: checkpoint.lastBreedId, recordCount: checkpoint.recordCount });
    if (!validateOnly && (batchNumber === 1 || batchNumber % 25 === 0 || batchNumber === EXPECTED_BATCHES)) process.stdout.write(`${JSON.stringify({ status: "CHECKPOINTED", batchNumber, completedRecords: all.length, checkpointHash: checkpoint.checkpointHash })}\n`);
  }
  if (checkpointHashes.length !== 207 || checkpointHashes.at(-1)?.recordCount !== 2) throw new Error("V2 checkpoint chain must contain 206 ten-record batches and final two-record batch");
  const records = all.map(analytical); validateAnalytical(records, identities.map((row) => row.breedId));
  const changeAudit = buildChangeAudit(v1Classifications.assignments, records); const diagnostics = buildDiagnostics(records, all, changeAudit);
  if (validateOnly) {
    const v1Preserved = validateV1Frozen(false); const dirtyPreserved = validateOriginalDirtyBaseline();
    process.stdout.write(`${JSON.stringify({ status: "PASS", mode: "VALIDATE_ONLY", runId, inputDigest, totalBreeds: records.length, classified: diagnostics.counts.classified, reviewRequired: diagnostics.counts.reviewRequired, completedBatches: checkpointHashes.length, v1Preserved: { fileCount: v1Preserved.fileCount, sha256: v1Preserved.sha256 }, dirtyPreserved }, null, 2)}\n`); return;
  }
  const completedAt = new Date().toISOString();
  const paths = {
    classifications: resolve(OUTPUT, "breed-primary-deity-classifications-v2.json"), csv: resolve(OUTPUT, "breed-primary-deity-classifications-v2.csv"), review: resolve(OUTPUT, "breed-primary-deity-review-required-v2.json"), diagnostics: resolve(OUTPUT, "breed-primary-deity-distribution-diagnostics-v2.json"), report: resolve(OUTPUT, "breed-primary-deity-distribution-report-v2.md"), changeJson: resolve(OUTPUT, "breed-primary-deity-v1-to-v2-change-audit.json"), changeMd: resolve(OUTPUT, "breed-primary-deity-v1-to-v2-change-audit.md"), manifest: resolve(OUTPUT, "breed-primary-deity-run-manifest-v2.json"), authority: AUTHORITY_PATH,
  };
  writeJsonAtomic(paths.classifications, { schemaVersion: BREED_DEITY_AFFINITY_V2_SCHEMA_VERSION, authorityId: "BREED_PRIMARY_DEITY_V2", classificationRulesVersion: BREED_DEITY_V2_RULES_VERSION, totalBreeds: records.length, classified: diagnostics.counts.classified, reviewRequired: diagnostics.counts.reviewRequired, assignments: records });
  writeTextAtomic(paths.csv, buildCsv(records));
  writeJsonAtomic(paths.review, { schemaVersion: "echoes-breed-deity-review-inventory-v2", counts: { reviewRequired: diagnostics.counts.reviewRequired, low: records.filter((row) => row.confidence === "LOW").length, confidenceOverrides: records.filter((row) => row.confidenceOverrideReason).length, marginsBelowFive: diagnostics.margins.belowFive }, reviewRequired: records.filter((row) => row.classificationStatus === "REVIEW_REQUIRED"), low: records.filter((row) => row.confidence === "LOW"), confidenceOverrides: records.filter((row) => row.confidenceOverrideReason).map((row) => ({ breedId: row.breedId, suggestedConfidence: row.suggestedConfidence, confidence: row.confidence, reason: row.confidenceOverrideReason })), marginsBelowFive: records.filter((row) => row.topTwoMargin < 5).map((row) => ({ breedId: row.breedId, leader: selectedDeity(row), runnerUp: row.runnerUp, margin: row.topTwoMargin, status: row.classificationStatus })) });
  writeJsonAtomic(paths.diagnostics, diagnostics); writeTextAtomic(paths.report, `${reportMarkdown(diagnostics, changeAudit)}\n`); writeJsonAtomic(paths.changeJson, changeAudit); writeTextAtomic(paths.changeMd, `${changeReportMarkdown(changeAudit)}\n`);
  writeJsonAtomic(paths.authority, authority(records, inputDigest, breedAuthorityHash, deityAuthorityHash, completedAt));
  const manualHashes = writeManualAudits(records, changeAudit, inputDigest);
  const v1Preserved = validateV1Frozen(false); const dirtyPreserved = validateOriginalDirtyBaseline();
  const outputPaths = [paths.classifications, paths.csv, paths.review, paths.diagnostics, paths.report, paths.changeJson, paths.changeMd, paths.authority, resolve(OUTPUT, "deity-authority-snapshot-v2.json"), resolve(OUTPUT, "deity-evidence-profiles-v2.json"), resolve(OUTPUT, "personality-deity-affinity-calibration-v2.json"), resolve(OUTPUT, "signal-frequency-audit-v2.json"), V1_PRESERVATION_BASELINE];
  const integrityHashes = Object.fromEntries(outputPaths.map((path) => [relative(OUTPUT, path).startsWith("..") ? relative(ROOT, path) : relative(OUTPUT, path), fileSha256(path)])); Object.assign(integrityHashes, manualHashes);
  const checkpointAggregateSha256 = sha256(checkpointHashes.map((row) => `${row.checkpointHash}  batch-${String(row.batchNumber).padStart(4, "0")}.json`).join("\n") + "\n");
  const confidenceCounts = diagnostics.confidenceDistribution;
  const manifestPayload = {
    schemaVersion: "echoes-breed-deity-affinity-run-manifest-v2", runId, authorityId: "BREED_PRIMARY_DEITY_V2", classificationRulesVersion: BREED_DEITY_V2_RULES_VERSION,
    repository: { root: ROOT, remote: "git@github.com:bkalaf/echoes-simulator.git", branch: "main", prohibitedRepositoryReads: ["bkalaf/echoes-of-eidolon", "all other Echoes repositories"] },
    sources, breedAuthorityHash, deityAuthoritySource: DEITY_SOURCE, deityAuthorityHash, frozenV1Reference: { inputDigest: v1Manifest.inputDigest, inventoryFileCount: v1Preserved.fileCount, inventorySha256: v1Preserved.sha256 }, classifierImplementationHash, personalityCalibrationHash, signalFrequencyAuditHash, inputDigest,
    counts: { totalBreeds: records.length, analyticalRecords: records.length, classified: diagnostics.counts.classified, reviewRequired: diagnostics.counts.reviewRequired, authorityAssignments: diagnostics.counts.classified, completedBatches: checkpointHashes.length, confidence: confidenceCounts, deityChangedFromV1: changeAudit.counts.deityChanged, statusChangedFromV1: changeAudit.counts.statusChanged, confidenceChangedFromV1: changeAudit.counts.confidenceChanged },
    orderingRule: ORDERING_RULE, batchSize: BATCH_SIZE, expectedFullBatches: 206, finalRemainder: 2, startTimestamp: startedAt, endTimestamp: completedAt,
    calibration: { semanticFactDeduplication: true, rawLexicalMatchesRetained: true, crossAxisReuseFactors: [1, 0.55, 0.32, 0.18, 0.1], repeatedClusterFactors: [1, 0.65, 0.4, 0.25, 0.15], specificityFactorBounds: [0.72, 1.25], deityEvidenceTiers: ["DEFINING", "STRONG", "MODERATE", "WEAK", "CONTRADICTORY"], distributionIndependent: true, noQuotas: true, noPantheonPreference: true, noPopulationKindPreference: true },
    checkpointChain: { checkpointCount: checkpointHashes.length, aggregateSha256: checkpointAggregateSha256, finalCheckpointHash: previous, checkpoints: checkpointHashes }, distributionDiagnosticsOnly: true, integrityHashes,
    preservationValidation: { v1: { fileCount: v1Preserved.fileCount, sha256: v1Preserved.sha256, preserved: true }, preexistingDirty: { ...dirtyAtStart, ...dirtyPreserved } },
    nonCausalBoundary: { runtimeConsumersAdded: 0, canonicalBundleChangedByThisRun: false, causalRunHashChanged: false, canonicalBundleHashChanged: false, schedulerVersionChanged: false, mechanicsVersionChanged: false, causalDerivationVersionChanged: false, existingRunsOrDatabasesModified: false },
    externalResearchPerformed: false, notionModified: false, committed: false, pushed: false, pullRequestCreated: false,
  };
  const manifestPayloadSha256 = sha256(canonicalJson(manifestPayload)); writeJsonAtomic(paths.manifest, { ...manifestPayload, manifestPayloadSha256 });
  process.stdout.write(`${JSON.stringify({ status: "PASS", runId, inputDigest, totalBreeds: records.length, classified: diagnostics.counts.classified, reviewRequired: diagnostics.counts.reviewRequired, confidence: confidenceCounts, deityChangedFromV1: changeAudit.counts.deityChanged, completedBatches: checkpointHashes.length, finalCheckpointHash: previous, manifestPayloadSha256, v1Preserved: { fileCount: v1Preserved.fileCount, sha256: v1Preserved.sha256 }, outputHashes: integrityHashes }, null, 2)}\n`);
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
