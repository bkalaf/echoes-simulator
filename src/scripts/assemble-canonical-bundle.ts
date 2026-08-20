import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(".");
const stage = resolve(root, "resources/.canonical-stage");
const output = resolve(root, "resources/canonical");
const ownerPack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const authority = resolve(root, "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip");
const acceptancePath = resolve(root, "artifacts/research-v4/acceptance/v4_adversarial_acceptance.json");
const readinessPath = resolve(root, "artifacts/simulator/v4-readiness/year0-readiness.json");
const CREATED_AT = "2026-08-19T00:00:00.000Z";

function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
function copy(source: string, target: string): void { mkdirSync(resolve(target, ".."), { recursive: true }); cpSync(source, target); }
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => { const path = resolve(directory, name); return statSync(path).isDirectory() ? files(path) : [relative(stage, path).replaceAll("\\", "/")]; }).sort();
}

const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8")) as { verdict: string; archive: { sha256: string } };
const readiness = JSON.parse(readFileSync(readinessPath, "utf8")) as { status: string; settlementWorlds: number; propertyChecks: number; noResolvedPopulationIssues: number };
if (acceptance.verdict !== "ACCEPT_SIMULATION_READY" || acceptance.archive.sha256 !== sha256(readFileSync(authority))) throw new Error("Only the accepted V4 semantic authority may enter the canonical bundle");
if (readiness.status !== "PASS" || readiness.settlementWorlds !== 72 || readiness.propertyChecks !== 864 || readiness.noResolvedPopulationIssues !== 0) throw new Error("Canonical bundle requires a passing 72-SettlementWorld year-0 gate");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copy(authority, resolve(stage, "breeds/ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip"));
for (const [source, target] of [
  ["region_species_group_assignments(1).csv", "region_species_group_assignments.csv"], ["sites_naming_master(1).csv", "sites_naming_master.csv"],
  ["pois_by_site_naming(1).csv", "pois_by_site_naming.csv"], ["site_poi_naming_rollup(1).csv", "site_poi_naming_rollup.csv"],
] as const) copy(resolve(ownerPack, "INPUTS", source), resolve(stage, "atlas", target));
copy(resolve(root, "resources/reference/founding_sites.csv"), resolve(stage, "atlas/founding_sites.csv"));
copy(resolve(root, "resources/policies/owner-policy-2026-08-18-v1.json"), resolve(stage, "policies/owner_policy.json"));
for (const [source, target] of [
  ["personality_family_dimension_profiles_v1.jsonl", "personality_family_dimension_profiles.jsonl"],
  ["personality_expression_dimension_overrides_v1.jsonl", "personality_expression_dimension_overrides.jsonl"],
  ["personality_expression_effective_profiles_v1.jsonl", "personality_expression_effective_profiles.jsonl"],
] as const) copy(resolve(root, "resources/research-v4/personality", source), resolve(stage, "policies", target));
copy(resolve(root, "resources/research-v4/personality/personality_dimension_policy_audit.json"), resolve(stage, "integrity/personality_dimension_policy_audit.json"));
for (const filename of ["political_form_mapping.json", "economic_form_mapping.json", "property_faction_mapping.json", "region_adjacency.json", "sovereign_and_djt.json", "growth_policy.json", "wealth_policy.json", "world_faction_priority.json", "shared_event_skeleton.json"]) copy(resolve(root, "resources/reference", filename), resolve(stage, "reference", filename));
copy(acceptancePath, resolve(stage, "integrity/v4_acceptance.json"));
copy(readinessPath, resolve(stage, "integrity/year0_readiness.json"));

const requiredFiles = Object.fromEntries(files(stage).map((name) => [name, sha256(readFileSync(resolve(stage, name)))]));
const contentSha256 = sha256(Object.entries(requiredFiles).map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n");
const ownerPolicy = JSON.parse(readFileSync(resolve(stage, "policies/owner_policy.json"), "utf8")) as { schemaVersion: string; effectiveDate: string };
const manifest = {
  schemaVersion: "eidolon-canonical-bundle-manifest-v1", bundleVersion: "V4_SIMULATION_READY_2026-08-19", createdAt: CREATED_AT,
  breedSemanticVersion: "V4", breedSemanticFilename: "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip", breedSemanticSha256: acceptance.archive.sha256,
  breedSemanticVerdict: "ACCEPT_SIMULATION_READY", ownerPolicyVersion: `${ownerPolicy.schemaVersion}@${ownerPolicy.effectiveDate}`,
  personalityPolicyVersion: "PERSONALITY_PROFILE_DIMENSIONS_V1", preflightSchemaVersion: "BUNDLED_CANONICAL_V1", engineReadinessVersion: "YEAR0_READINESS_V1",
  year0ReadinessStatus: "PASS", contentSha256, requiredFiles, buildReady: true,
};
writeFileSync(resolve(stage, "canonical_bundle_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const checksums = files(stage).map((name) => `${sha256(readFileSync(resolve(stage, name)))}  ${name}`).join("\n") + "\n";
writeFileSync(resolve(stage, "integrity/checksums.sha256"), checksums);
rmSync(output, { recursive: true, force: true });
renameSync(stage, output);
process.stdout.write(`${JSON.stringify({ output, manifest, manifestSha256: sha256(readFileSync(resolve(output, "canonical_bundle_manifest.json"))) }, null, 2)}\n`);
