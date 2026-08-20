import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { strFromU8 } from "fflate";
import { calculateYear0Readiness, type Year0Assignment, type Year0Identity, type Year0Site } from "../core/engine/year0-readiness.js";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";
import { RAW_DIMENSIONS, validateV4Authority, type EffectiveBreedSemantics } from "../core/research/v4-contract.js";

const root = resolve(".");
const directory = resolve(root, process.argv[2] ?? "resources/canonical");
function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
function files(current: string): string[] { return readdirSync(current).flatMap((name) => { const path = resolve(current, name); return statSync(path).isDirectory() ? files(path) : [relative(directory, path).replaceAll("\\", "/")]; }).sort(); }
function csv<T>(name: string): T[] { return parseCsvSync(readFileSync(resolve(directory, name)), { bom: true, columns: true, skip_empty_lines: true }) as T[]; }

const manifestPath = resolve(directory, "canonical_bundle_manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { requiredFiles: Record<string, string> };
if (manifest.schemaVersion !== "eidolon-canonical-bundle-manifest-v1" || manifest.bundleVersion !== "V4_SIMULATION_READY_2026-08-19" || manifest.buildReady !== true) throw new Error("Canonical bundle manifest is absent, stale, or not build-ready");
if (manifest.breedSemanticVersion !== "V4" || manifest.breedSemanticVerdict !== "ACCEPT_SIMULATION_READY" || manifest.personalityPolicyVersion !== "PERSONALITY_PROFILE_DIMENSIONS_V1" || manifest.year0ReadinessStatus !== "PASS") throw new Error("Canonical authority/policy/readiness version is stale");
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
const effectiveBreeds = parseJsonLines(member("effective_breed_semantics.jsonl")) as unknown as EffectiveBreedSemantics[];
const pets = parseJsonLines(member("pet_policy_semantics.jsonl"));
const coverage = JSON.parse(strFromU8(member("critical_coverage.json"))) as Record<string, { civicResolved: number; invalidUnresolved: number }>;
if (identities.length !== 2056 || effectiveBreeds.length !== 1773 || pets.length !== 283) throw new Error("Canonical Breed counts are invalid");
for (const field of ["personalityId", "terrainBroad", "terrainSpecific", ...RAW_DIMENSIONS]) if (coverage[field]?.civicResolved !== 1773 || coverage[field]?.invalidUnresolved !== 0) throw new Error(`Canonical ${field} coverage is incomplete`);
const acceptance = JSON.parse(readFileSync(resolve(directory, "integrity/v4_acceptance.json"), "utf8")) as { verdict: string; archive: { sha256: string }; counts: { findings: number } };
if (acceptance.verdict !== "ACCEPT_SIMULATION_READY" || acceptance.counts.findings !== 0 || acceptance.archive.sha256 !== manifest.breedSemanticSha256) throw new Error("Bundled V4 adversarial acceptance is invalid");
const policyAudit = JSON.parse(readFileSync(resolve(directory, "integrity/personality_dimension_policy_audit.json"), "utf8")) as { status: string; policyRef: string };
if (policyAudit.status !== "PASS" || policyAudit.policyRef !== "PERSONALITY_PROFILE_DIMENSIONS_V1") throw new Error("Bundled Personality policy audit is invalid");

const propertyMapping = JSON.parse(readFileSync(resolve(directory, "reference/property_faction_mapping.json"), "utf8"));
const politicalRows = JSON.parse(readFileSync(resolve(directory, "reference/political_form_mapping.json"), "utf8")).rows;
const economicRows = JSON.parse(readFileSync(resolve(directory, "reference/economic_form_mapping.json"), "utf8")).rows;
const recalculated = calculateYear0Readiness({ seed: "EIDOLON_CANONICAL_YEAR0_V4", identities, effectiveBreeds, assignments: csv<Year0Assignment>("atlas/region_species_group_assignments.csv"), foundingSites: csv<Year0Site>("atlas/founding_sites.csv"), propertyMapping, politicalRows, economicRows });
const recorded = JSON.parse(readFileSync(resolve(directory, "integrity/year0_readiness.json"), "utf8"));
if (recalculated.status !== "PASS" || JSON.stringify(recalculated) !== JSON.stringify(recorded)) throw new Error("Bundled year-0 readiness does not independently reproduce");
process.stdout.write(`${JSON.stringify({ status: "PASS", buildReady: true, bundleVersion: manifest.bundleVersion, manifestSha256: sha256(readFileSync(manifestPath)), contentSha256, breedSemanticSha256: manifest.breedSemanticSha256, breeds: identities.length, civicBreeds: effectiveBreeds.length, pets: pets.length, settlementWorlds: recalculated.settlementWorlds, propertyChecks: recalculated.propertyChecks, noResolvedPopulationIssues: recalculated.noResolvedPopulationIssues }, null, 2)}\n`);
