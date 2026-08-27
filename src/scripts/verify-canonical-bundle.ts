import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { strFromU8 } from "fflate";
import { calculateYear0Readiness, type Year0Assignment, type Year0Identity, type Year0Site } from "../core/engine/year0-readiness.js";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { applyBreedFactionProjection, BREED_FACTION_PROJECTION_POLICY, projectBreedFaction } from "../core/research/breed-faction-projection.js";
import { BREED_DIMENSION_BALANCE_POLICY, RAW_DIMENSIONS, validateV4Authority, type CanonicalEffectiveBreedSemantics, type EffectiveBreedSemantics } from "../core/research/v4-contract.js";

const root = resolve(".");
const directory = resolve(root, process.argv[2] ?? "resources/canonical");
function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
function files(current: string): string[] { return readdirSync(current).flatMap((name) => { const path = resolve(current, name); return statSync(path).isDirectory() ? files(path) : [relative(directory, path).replaceAll("\\", "/")]; }).sort(); }
function csv<T>(name: string): T[] { return parseCsvSync(readFileSync(resolve(directory, name)), { bom: true, columns: true, skip_empty_lines: true }) as T[]; }

const manifestPath = resolve(directory, "canonical_bundle_manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { requiredFiles: Record<string, string> };
if (manifest.schemaVersion !== "eidolon-canonical-bundle-manifest-v1" || manifest.bundleVersion !== "V4_SIMULATION_READY_BALANCED_FACTIONS_2026-08-26" || manifest.buildReady !== true) throw new Error("Canonical bundle manifest is absent, stale, or not build-ready");
if (manifest.breedSemanticVersion !== "V4" || manifest.breedSemanticVerdict !== "ACCEPT_SIMULATION_READY" || manifest.personalityPolicyVersion !== "PERSONALITY_PROFILE_DIMENSIONS_V1" || manifest.breedDimensionPolicyVersion !== BREED_DIMENSION_BALANCE_POLICY || manifest.breedFactionPolicyVersion !== BREED_FACTION_PROJECTION_POLICY || manifest.year0ReadinessStatus !== "PASS") throw new Error("Canonical authority/policy/readiness version is stale");
if (typeof manifest.researchCorpusImportVersion !== "string" || !["COMPLETED", "COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_BLOCKERS"].includes(String(manifest.researchCorpusImportStatus)) || manifest.researchCorpusManifest !== "research-corpus/IMPORT_MANIFEST.json") throw new Error("Canonical record-by-record research corpus import is absent or invalid");
const checksumLines = readFileSync(resolve(directory, "integrity/checksums.sha256"), "utf8").trim().split("\n");
const checked = new Set<string>();
for (const line of checksumLines) { const match = /^([0-9a-f]{64})  (.+)$/.exec(line); if (!match) throw new Error(`Malformed canonical checksum: ${line}`); const path = resolve(directory, match[2]!); if (sha256(readFileSync(path)) !== match[1]) throw new Error(`Canonical checksum mismatch: ${match[2]}`); checked.add(match[2]!); }
const allFiles = files(directory).filter((name) => name !== "integrity/checksums.sha256");
if (allFiles.some((name) => !checked.has(name)) || checked.size !== allFiles.length) throw new Error("Canonical checksums do not cover the exact bundle file set");
for (const [name, hash] of Object.entries(manifest.requiredFiles)) if (sha256(readFileSync(resolve(directory, name))) !== hash) throw new Error(`Manifest required-file hash mismatch: ${name}`);
const contentSha256 = sha256(Object.entries(manifest.requiredFiles).map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n");
if (contentSha256 !== manifest.contentSha256) throw new Error("Canonical content hash mismatch");

const breedZip = resolve(directory, "breeds", String(manifest.breedSemanticFilename));
if (sha256(readFileSync(breedZip)) !== manifest.breedSemanticSha256) throw new Error("V4 semantic ZIP hash differs from canonical manifest");
const archive = openValidatedZip(breedZip);
const member = (name: string): Uint8Array => { const value = archive.entries[`${archive.prefix}${name}`]; if (!value) throw new Error(`V4 authority lacks ${name}`); return value; };
const v4Manifest = JSON.parse(strFromU8(member("manifest.json"))) as Record<string, unknown>; validateV4Authority(v4Manifest);
const identities = parseJsonLines(member("canonical_breed_identities.jsonl")) as unknown as Year0Identity[];
const effectiveBreeds = parseJsonLines(member("effective_breed_semantics.jsonl")) as unknown as CanonicalEffectiveBreedSemantics[];
const pets = parseJsonLines(member("pet_policy_semantics.jsonl"));
const coverage = JSON.parse(strFromU8(member("critical_coverage.json"))) as Record<string, { civicResolved: number; invalidUnresolved: number }>;
if (identities.length !== 2062 || effectiveBreeds.length !== 1779 || pets.length !== 283) throw new Error("Canonical Breed counts are invalid");
for (const field of ["personalityId", "terrainBroad", "terrainSpecific", ...RAW_DIMENSIONS]) if (coverage[field]?.civicResolved !== 1779 || coverage[field]?.invalidUnresolved !== 0) throw new Error(`Canonical ${field} coverage is incomplete`);
const balancePolicy = JSON.parse(readFileSync(resolve(directory, "policies/breed_dimension_balance_policy.json"), "utf8")) as { policyRef: string; target: { perControlledValue: number } };
const balanceReport = JSON.parse(readFileSync(resolve(directory, "integrity/breed_dimension_balance_report.json"), "utf8")) as { policyRef: string; totalCivicBreeds: number; targetPerValue: number; totalChangedAssignments: number; changedBreeds: number; byField: Record<string, { values: Record<string, string>; after: Record<string, number> }> };
if (balancePolicy.policyRef !== BREED_DIMENSION_BALANCE_POLICY || balancePolicy.target.perControlledValue !== 593 || balanceReport.policyRef !== BREED_DIMENSION_BALANCE_POLICY || balanceReport.totalCivicBreeds !== 1779 || balanceReport.targetPerValue !== 593) throw new Error("Bundled Breed dimension balance policy/report is invalid");
const balanceChanges = readFileSync(resolve(directory, "integrity/breed_dimension_balance_changes.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { breedId: string; field: string; before: string; after: string; disposition: string; policyRef: string });
if (balanceChanges.length !== balanceReport.totalChangedAssignments || new Set(balanceChanges.map((change) => change.breedId)).size !== balanceReport.changedBreeds) throw new Error("Bundled Breed dimension balance change audit does not reconcile");
for (const field of RAW_DIMENSIONS) {
  const fieldReport = balanceReport.byField[field];
  if (!fieldReport || Object.values(fieldReport.after).some((count) => count !== 593)) throw new Error(`Canonical ${field} is not exactly 593/593/593`);
  const observed = Object.fromEntries(Object.values(fieldReport.values).map((value) => [value, 0])) as Record<string, number>;
  for (const row of effectiveBreeds) {
    const value = row.dimensions[field].value;
    if (!(value in observed)) throw new Error(`Canonical ${field} contains uncontrolled value ${value}`);
    observed[value] += 1;
  }
  if (Object.values(observed).some((count) => count !== 593)) throw new Error(`Canonical ${field} materialization is not exactly 593/593/593`);
}
for (const change of balanceChanges) if (change.disposition !== "OWNER_BALANCED_VALUE" || change.policyRef !== BREED_DIMENSION_BALANCE_POLICY || change.before === change.after) throw new Error("Breed dimension balance audit contains invalid provenance");
const propertyMapping = JSON.parse(readFileSync(resolve(directory, "reference/property_faction_mapping.json"), "utf8")) as Record<string, Record<"CONCORD" | "SCHISM" | "RUIN", string>>;
const factionPolicy = JSON.parse(readFileSync(resolve(directory, "policies/breed_faction_projection_policy.json"), "utf8")) as { policyRef: string; pointsPerAttribute: number; dominantFaction: { tolerance: number } };
const factionReport = JSON.parse(readFileSync(resolve(directory, "integrity/breed_faction_projection_report.json"), "utf8"));
if (factionPolicy.policyRef !== BREED_FACTION_PROJECTION_POLICY || factionPolicy.pointsPerAttribute !== 1 || factionPolicy.dominantFaction.tolerance !== 1) throw new Error("Bundled Breed faction projection policy is invalid");
for (const row of effectiveBreeds) {
  const expected = projectBreedFaction(row.dimensions, propertyMapping);
  if (canonicalJson(row.factionObject) !== canonicalJson(expected.factionObject) || canonicalJson(row.dominantFaction) !== canonicalJson(expected.dominantFaction)) throw new Error(`Canonical Breed faction projection mismatch: ${row.breedId}`);
}
const reproducedFactionReport = applyBreedFactionProjection(effectiveBreeds.map(({ factionObject: _factionObject, dominantFaction: _dominantFaction, ...row }) => row as EffectiveBreedSemantics), propertyMapping).report;
if (JSON.stringify(factionReport) !== JSON.stringify(reproducedFactionReport)) throw new Error("Bundled Breed faction projection report does not reproduce");
for (const pet of pets as { breedId: string; factionObject?: unknown; dominantFaction?: unknown; factionDisposition?: unknown; factionPolicyRef?: unknown }[]) if (canonicalJson(pet.factionObject) !== canonicalJson({ CONCORD: 0, SCHISM: 0, RUIN: 0 }) || canonicalJson(pet.dominantFaction) !== "[]" || pet.factionDisposition !== "POLICY_NULL" || pet.factionPolicyRef !== BREED_FACTION_PROJECTION_POLICY) throw new Error(`PET Breed faction policy mismatch: ${pet.breedId}`);
const acceptance = JSON.parse(readFileSync(resolve(directory, "integrity/v4_acceptance.json"), "utf8")) as { verdict: string; archive: { sha256: string }; counts: { findings: number } };
if (acceptance.verdict !== "ACCEPT_SIMULATION_READY" || acceptance.counts.findings !== 0 || acceptance.archive.sha256 !== manifest.breedSemanticSha256) throw new Error("Bundled V4 adversarial acceptance is invalid");
const policyAudit = JSON.parse(readFileSync(resolve(directory, "integrity/personality_dimension_policy_audit.json"), "utf8")) as { status: string; policyRef: string };
if (policyAudit.status !== "PASS" || policyAudit.policyRef !== "PERSONALITY_PROFILE_DIMENSIONS_V1") throw new Error("Bundled Personality policy audit is invalid");

const corpusDirectory = resolve(directory, "research-corpus");
const corpusManifest = JSON.parse(readFileSync(resolve(corpusDirectory, "IMPORT_MANIFEST.json"), "utf8")) as { schemaVersion: string; corpusVersion: string; sourcePackage: string; sourcePackageSha256: string; expectedRecordCount: number; observedRecordCount: number; ledgerRecordCount: number; overallImportStatus: string; artifactHashes: Record<string, string> };
if (corpusManifest.schemaVersion !== "eidolon-research-corpus-import-manifest-v1" || corpusManifest.corpusVersion !== manifest.researchCorpusImportVersion || corpusManifest.sourcePackage !== manifest.researchCorpusSourcePackage || corpusManifest.sourcePackageSha256 !== manifest.researchCorpusSourcePackageSha256 || corpusManifest.expectedRecordCount !== corpusManifest.observedRecordCount || corpusManifest.ledgerRecordCount !== corpusManifest.observedRecordCount || corpusManifest.overallImportStatus !== manifest.researchCorpusImportStatus) throw new Error("Research corpus manifest does not reconcile to the canonical bundle");
for (const [name, hash] of Object.entries(corpusManifest.artifactHashes)) if (sha256(readFileSync(resolve(corpusDirectory, name))) !== hash) throw new Error(`Research corpus artifact hash mismatch: ${name}`);
const corpusChecksums = readFileSync(resolve(corpusDirectory, "checksums.sha256"), "utf8").trim().split("\n");
for (const line of corpusChecksums) { const match = /^([0-9a-f]{64})  (.+)$/.exec(line); if (!match || sha256(readFileSync(resolve(corpusDirectory, match[2]!))) !== match[1]) throw new Error(`Research corpus checksum mismatch: ${line}`); }
if (sha256(readFileSync(resolve(corpusDirectory, "source", corpusManifest.sourcePackage))) !== corpusManifest.sourcePackageSha256) throw new Error("Bundled research source ZIP hash mismatch");

const politicalRows = JSON.parse(readFileSync(resolve(directory, "reference/political_form_mapping.json"), "utf8")).rows;
const economicRows = JSON.parse(readFileSync(resolve(directory, "reference/economic_form_mapping.json"), "utf8")).rows;
const recalculated = calculateYear0Readiness({ seed: "EIDOLON_CANONICAL_YEAR0_V4", identities, effectiveBreeds, assignments: csv<Year0Assignment>("atlas/region_species_group_assignments.csv"), foundingSites: csv<Year0Site>("atlas/founding_sites.csv"), propertyMapping, politicalRows, economicRows });
const recorded = JSON.parse(readFileSync(resolve(directory, "integrity/year0_readiness.json"), "utf8"));
if (recalculated.status !== "PASS" || JSON.stringify(recalculated) !== JSON.stringify(recorded)) throw new Error("Bundled year-0 readiness does not independently reproduce");
process.stdout.write(`${JSON.stringify({ status: "PASS", buildReady: true, bundleVersion: manifest.bundleVersion, manifestSha256: sha256(readFileSync(manifestPath)), contentSha256, breedSemanticSha256: manifest.breedSemanticSha256, researchCorpusVersion: corpusManifest.corpusVersion, researchCorpusStatus: corpusManifest.overallImportStatus, researchCorpusRecords: corpusManifest.ledgerRecordCount, breeds: identities.length, civicBreeds: effectiveBreeds.length, pets: pets.length, settlementWorlds: recalculated.settlementWorlds, propertyChecks: recalculated.propertyChecks, noResolvedPopulationIssues: recalculated.noResolvedPopulationIssues }, null, 2)}\n`);
