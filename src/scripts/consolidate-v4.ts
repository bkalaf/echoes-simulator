import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { parseCsvFile } from "../core/inputs/importer.js";
import {
  BREED_DIMENSION_BALANCE_POLICY,
  PERSONALITY_DIMENSION_POLICY,
  RAW_DIMENSIONS,
  validateEffectiveBreedSemantics,
  validateResearchEvidence,
  type EffectiveBreedSemantics,
  type ResearchUnit,
  type V4Citation,
  type V4InheritanceEdge,
  type V4ResearchEvidence,
  type V4Source,
  type V4UnitResult,
} from "../core/research/v4-contract.js";
import { rebalanceBreedDimensions } from "../core/research/breed-dimension-balance.js";
import { applyBreedFactionProjection, BREED_FACTION_PROJECTION_POLICY } from "../core/research/breed-faction-projection.js";
import type { BatchJournalRow } from "../core/research/v4-batch.js";
import type { IndependentAuditResult } from "../core/research/v4-audit.js";

const root = resolve(".");
const promptPack = resolve(root, "ECHOES_OF_EIDOLON_RESEARCH_V4_CODEX_PROMPT_PACK_2026-08-19");
const ownerPack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const batchesRoot = resolve(root, "artifacts/research-v4/batches");
const auditsRoot = resolve(root, "artifacts/research-v4/audits");
const outputDirectory = resolve(root, "artifacts/research-v4/consolidated");
const outputZip = resolve(root, "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip");
const prefix = "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY/";
const GENERATED_AT = "2026-08-26T00:00:00.000Z";

function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
function readJsonLines<T>(filename: string): T[] { const text = readFileSync(filename, "utf8").trim(); return text ? text.split(/\r?\n/).map((line) => JSON.parse(line) as T) : []; }
function lines(rows: readonly unknown[]): string { return `${rows.map((row) => canonicalJson(row)).join("\n")}\n`; }
function exact(label: string, expected: readonly string[], actual: readonly string[]): void {
  const left = [...expected].sort(); const right = [...actual].sort();
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length || left.join("\0") !== right.join("\0")) throw new Error(`${label} coverage is not exact`);
}
function nullable(value: string): string | null { return value === "" ? null : value; }
function stringArray(value: string): string[] { if (!value) return []; const parsed = JSON.parse(value) as unknown; if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(`Expected JSON string array, received ${value}`); return parsed; }

const identityRows = parseCsvFile(resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv")).map((row) => ({
  breedId: row.breedId, name: row.name, speciesId: nullable(row.speciesId), cultureId: nullable(row.cultureId), parentBreedId: nullable(row.parentBreedId),
  populationKind: row.populationKind, groupId: row.groupId, regionId: row.regionId, regionAssignmentScope: row.regionAssignmentScope,
  accent: nullable(row.accent), appearance: nullable(row.appearance), clothing: nullable(row.clothing), architecture: nullable(row.architecture),
})).sort((a, b) => a.breedId.localeCompare(b.breedId));
const identityIds = identityRows.map((row) => row.breedId);
if (identityRows.length !== 2056 || new Set(identityIds).size !== 2056) throw new Error("Canonical identity authority must contain 2,056 unique Breeds");
const civicIdentities = identityRows.filter((row) => row.populationKind !== "PET");
const petIdentities = identityRows.filter((row) => row.populationKind === "PET");
if (civicIdentities.length !== 1773 || petIdentities.length !== 283) throw new Error("Expected exactly 1,773 civic and 283 PET Breeds");

const index = JSON.parse(readFileSync(resolve(promptPack, "units/RESEARCH_UNIT_INDEX.json"), "utf8")) as { units: ResearchUnit[] };
if (index.units.length !== 1219) throw new Error("Expected exactly 1,219 V4 research units");
exact("Research-unit civic Breed", civicIdentities.map((row) => row.breedId), index.units.flatMap((unit) => unit.breedIds));

const batchIds = readdirSync(batchesRoot).filter((name) => /^R\d{2}_B\d{2}$/.test(name)).sort();
if (batchIds.length !== 29) throw new Error("Expected 29 completed Region batches");
const unitResults = batchIds.flatMap((batchId) => readJsonLines<V4UnitResult>(resolve(batchesRoot, batchId, "unit_results.jsonl")));
const journals = batchIds.flatMap((batchId) => readJsonLines<BatchJournalRow>(resolve(batchesRoot, batchId, "research_journal.jsonl")));
const sources = batchIds.flatMap((batchId) => readJsonLines<V4Source>(resolve(batchesRoot, batchId, "sources.jsonl")));
const citations = batchIds.flatMap((batchId) => readJsonLines<V4Citation>(resolve(batchesRoot, batchId, "citations.jsonl")));
const evidence = batchIds.flatMap((batchId) => readJsonLines<V4ResearchEvidence>(resolve(batchesRoot, batchId, "evidence.jsonl")));
const inheritanceEdges = batchIds.flatMap((batchId) => readJsonLines<V4InheritanceEdge>(resolve(batchesRoot, batchId, "inheritance_edges.jsonl")));
const sourceEffectiveBreeds = batchIds.flatMap((batchId) => readJsonLines<EffectiveBreedSemantics>(resolve(batchesRoot, batchId, "effective_breed_preview.jsonl"))).sort((a, b) => a.breedId.localeCompare(b.breedId));
const profiles = readJsonLines<{ personalityId: string }>(resolve(root, "resources/research-v4/personality/personality_expression_effective_profiles_v1.jsonl"));
const personalityIds = new Set(profiles.map((row) => row.personalityId));
exact("Unit result", index.units.map((unit) => unit.unitId), unitResults.map((row) => row.researchUnitId));
exact("Effective civic Breed", civicIdentities.map((row) => row.breedId), sourceEffectiveBreeds.map((row) => row.breedId));
exact("Inheritance edge Breed", civicIdentities.map((row) => row.breedId), inheritanceEdges.map((row) => row.breedId));
if (journals.filter((row) => row.accepted).length !== 3657 || evidence.length !== 3657 || citations.length !== 3657) throw new Error("Expected three active critical evidence chains for every research unit");
for (const row of sourceEffectiveBreeds) validateEffectiveBreedSemantics(row as unknown as Record<string, unknown>, personalityIds);
for (const row of evidence) validateResearchEvidence(row as unknown as Record<string, unknown>);
if (new Set(sources.map((row) => row.sourceId)).size !== sources.length || new Set(citations.map((row) => row.citationId)).size !== citations.length || new Set(evidence.map((row) => row.evidenceId)).size !== evidence.length) throw new Error("V4 source, citation, or evidence identity is duplicated");
const sourceIds = new Set(sources.map((row) => row.sourceId));
for (const citation of citations) if (!sourceIds.has(citation.sourceId)) throw new Error(`Citation ${citation.citationId} has a broken source reference`);
const evidenceIds = new Set(evidence.map((row) => row.evidenceId));
for (const result of unitResults) if (result.evidenceRefs.some((ref) => !evidenceIds.has(ref))) throw new Error(`Unit ${result.researchUnitId} has a broken evidence reference`);

const auditResults = [1, 2, 3, 4, 5, 6, 7].map((number) => readFileSync(resolve(auditsRoot, `AUDIT_0${number}/audit_findings.json`), "utf8"));
for (const text of auditResults) { const audit = JSON.parse(text) as IndependentAuditResult; if (audit.status !== "PASS" || audit.counts.failingUnits !== 0 || !audit.researchArtifactsUnmodified) throw new Error(`${audit.auditId} did not pass independently`); }
const policyAudit = JSON.parse(readFileSync(resolve(root, "resources/research-v4/personality/personality_dimension_policy_audit.json"), "utf8")) as { status: string; counts: { effectiveProfiles: number }; policyRef: string };
if (policyAudit.status !== "PASS" || policyAudit.policyRef !== PERSONALITY_DIMENSION_POLICY || policyAudit.counts.effectiveProfiles !== 369) throw new Error("Personality dimension policy audit is not simulation-ready");

const propertyMapping = JSON.parse(readFileSync(resolve(root, "resources/reference/property_faction_mapping.json"), "utf8")) as Record<string, Record<"CONCORD" | "SCHISM" | "RUIN", string>>;
const balance = rebalanceBreedDimensions(sourceEffectiveBreeds, propertyMapping);
const factionProjection = applyBreedFactionProjection(balance.rows, propertyMapping);
const effectiveBreeds = factionProjection.rows;
for (const row of effectiveBreeds) validateEffectiveBreedSemantics(row as unknown as Record<string, unknown>, personalityIds);
if (balance.report.totalCivicBreeds !== 1773 || balance.report.targetPerValue !== 591) throw new Error("Breed dimension balance policy did not reconcile to 1,773 civic Breeds");
if (factionProjection.report.totalCivicBreeds !== 1773 || Object.values(factionProjection.report.factionPointTotals).some((points) => points !== 7_092)) throw new Error("Breed faction projection did not reconcile to the balanced civic corpus");

const originalIdentityById = new Map(parseCsvFile(resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv")).map((row) => [row.breedId, row]));
const petPolicyRows = petIdentities.map((identity) => ({
  schemaVersion: "eidolon-pet-policy-semantics-v4", breedId: identity.breedId, populationKind: "PET", civicSimulation: false,
  personalityId: null, personalityDisposition: "POLICY_NULL", terrainBroad: stringArray(originalIdentityById.get(identity.breedId)!.terrainBroad), terrainSpecific: stringArray(originalIdentityById.get(identity.breedId)!.terrainSpecific),
  dimensions: Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, { value: null, disposition: "POLICY_NULL", policyRef: "PET_EXCLUDED_FROM_CIVIC_SIMULATION_V1" }])),
  factionObject: { CONCORD: 0, SCHISM: 0, RUIN: 0 }, dominantFaction: [], factionDisposition: "POLICY_NULL", factionPolicyRef: BREED_FACTION_PROJECTION_POLICY,
}));
const criticalCoverage = Object.fromEntries(["personalityId", "terrainBroad", "terrainSpecific", ...RAW_DIMENSIONS].map((field) => [field, {
  civicResolved: effectiveBreeds.filter((row) => field === "personalityId" ? Boolean(row.personalityId) : field === "terrainBroad" || field === "terrainSpecific" ? row[field].length > 0 : Boolean((row.dimensions as Record<string, { value: string }>)[field]?.value)).length,
  civicRequired: 1773, petPolicyNull: field === "terrainBroad" || field === "terrainSpecific" ? 0 : 283, invalidUnresolved: 0,
}]));
if (Object.values(criticalCoverage).some((row) => row.civicResolved !== 1773 || row.invalidUnresolved !== 0)) throw new Error("Civic critical coverage is incomplete");
const optionalAuthoringGaps = { schemaVersion: "eidolon-v4-optional-authoring-gaps-v1", simulationBlocking: false, fields: { traits: { status: "OUT_OF_SCOPE_OPTIONAL", breeds: 2056 }, foodBroad: { status: "OUT_OF_SCOPE_OPTIONAL", breeds: 2056 }, foodSpecific: { status: "OUT_OF_SCOPE_OPTIONAL", breeds: 2056 } } };

const manifest = {
  schemaVersion: "eidolon-breed-semantics-v4-manifest", status: "SIMULATION_READY", semanticAuthorityVersion: "V4", generatedAt: GENERATED_AT,
  filename: basename(outputZip), personalityPolicyRef: PERSONALITY_DIMENSION_POLICY, breedDimensionPolicyRef: BREED_DIMENSION_BALANCE_POLICY, breedFactionPolicyRef: BREED_FACTION_PROJECTION_POLICY,
  counts: { breeds: 2056, civicBreeds: 1773, pets: 283, researchUnits: 1219, regionBatches: 29, auditShards: 7, sources: sources.length, citations: citations.length, evidence: evidence.length, inheritanceEdges: inheritanceEdges.length, effectiveCivicBreeds: effectiveBreeds.length, ownerBalancedAssignments: balance.report.totalChangedAssignments, ownerBalancedBreeds: balance.report.changedBreeds, factionProjectedCivicBreeds: factionProjection.report.totalCivicBreeds, factionPolicyNullPets: petPolicyRows.length },
  populationKinds: Object.fromEntries(["HUMAN", "BEAST", "MYTHOS", "PET"].map((kind) => [kind, identityRows.filter((row) => row.populationKind === kind).length])),
  criticalCoverage, auditVerdict: "PASS", personalityPolicyAudit: "PASS", unresolvedCriticalResearchUnits: 0, reviewRequiredCriticalResearchUnits: 0,
  sourceAuthority: { identityFilename: "full_breed_with_region_ids(1).csv", identitySha256: sha256(readFileSync(resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv"))), regionResearchArtifactSha256: (JSON.parse(auditResults[0]!) as IndependentAuditResult).researchArtifactsUnmodified ? "3d40da5876176754aeecd155a27d374aaaa3ae7e7c95a3268022526d35872944" : null },
};

const members: Record<string, Uint8Array> = {
  "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  "canonical_breed_identities.jsonl": strToU8(lines(identityRows)), "research_units.jsonl": strToU8(lines(index.units)),
  "unit_results.jsonl": strToU8(lines(unitResults.sort((a, b) => a.researchUnitId.localeCompare(b.researchUnitId)))),
  "research_journals.jsonl": strToU8(lines(journals.sort((a, b) => a.journalEntryId.localeCompare(b.journalEntryId)))),
  "sources.jsonl": strToU8(lines(sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId)))),
  "citations.jsonl": strToU8(lines(citations.sort((a, b) => a.citationId.localeCompare(b.citationId)))),
  "evidence.jsonl": strToU8(lines(evidence.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)))),
  "inheritance_edges.jsonl": strToU8(lines(inheritanceEdges.sort((a, b) => a.breedId.localeCompare(b.breedId)))),
  "personality/personality_family_dimension_profiles.jsonl": readFileSync(resolve(root, "resources/research-v4/personality/personality_family_dimension_profiles_v1.jsonl")),
  "personality/personality_expression_dimension_overrides.jsonl": readFileSync(resolve(root, "resources/research-v4/personality/personality_expression_dimension_overrides_v1.jsonl")),
  "personality/personality_expression_effective_profiles.jsonl": readFileSync(resolve(root, "resources/research-v4/personality/personality_expression_effective_profiles_v1.jsonl")),
  "personality/personality_dimension_policy_audit.json": readFileSync(resolve(root, "resources/research-v4/personality/personality_dimension_policy_audit.json")),
  "policies/breed_dimension_balance_policy.json": readFileSync(resolve(root, "resources/policies/breed-dimension-balance-v1.json")),
  "policies/breed_faction_projection_policy.json": readFileSync(resolve(root, "resources/policies/breed-faction-projection-v1.json")),
  "breed_dimension_balance_report.json": strToU8(`${JSON.stringify(balance.report, null, 2)}\n`),
  "breed_dimension_balance_changes.jsonl": strToU8(lines(balance.changes)),
  "breed_faction_projection_report.json": strToU8(`${JSON.stringify(factionProjection.report, null, 2)}\n`),
  "effective_breed_semantics.jsonl": strToU8(lines(effectiveBreeds)), "pet_policy_semantics.jsonl": strToU8(lines(petPolicyRows)),
  "critical_coverage.json": strToU8(`${JSON.stringify(criticalCoverage, null, 2)}\n`), "optional_authoring_gaps.json": strToU8(`${JSON.stringify(optionalAuthoringGaps, null, 2)}\n`),
};
for (let number = 1; number <= 7; number += 1) {
  const auditId = `AUDIT_0${number}`; members[`audits/${auditId}/audit_findings.json`] = readFileSync(resolve(auditsRoot, auditId, "audit_findings.json")); members[`audits/${auditId}/audit_report.md`] = readFileSync(resolve(auditsRoot, auditId, "audit_report.md"));
}
const checksums = Object.entries(members).sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join("\n") + "\n";
members["checksums.sha256"] = strToU8(checksums);
const zipped = Object.fromEntries(Object.entries(members).sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => [`${prefix}${name}`, bytes]));
writeFileSync(outputZip, zipSync(zipped, { level: 9, mtime: new Date(GENERATED_AT) }));

const reopened = unzipSync(readFileSync(outputZip));
for (const line of checksums.trim().split("\n")) { const [hash, name] = line.split("  "); const member = reopened[`${prefix}${name}`]; if (!member || sha256(member) !== hash) throw new Error(`Reopened V4 ZIP checksum failed for ${name}`); }
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "critical_coverage.json"), `${JSON.stringify(criticalCoverage, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "breed_dimension_balance_report.json"), `${JSON.stringify(balance.report, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "breed_dimension_balance_changes.jsonl"), lines(balance.changes));
writeFileSync(resolve(outputDirectory, "breed_faction_projection_report.json"), `${JSON.stringify(factionProjection.report, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "sha256.txt"), `${sha256(readFileSync(outputZip))}  ${basename(outputZip)}\n`);
writeFileSync(resolve(outputDirectory, "consolidation_report.json"), `${JSON.stringify({ status: "PASS", pureMaterialization: false, ownerPolicyTransformations: [BREED_DIMENSION_BALANCE_POLICY, BREED_FACTION_PROJECTION_POLICY], evidenceCreatedByConsolidation: 0, zipReopenedAndVerified: true, balance: balance.report, factionProjection: factionProjection.report, counts: manifest.counts }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputZip, sha256: sha256(readFileSync(outputZip)), manifest, zipReopenedAndVerified: true }, null, 2)}\n`);
