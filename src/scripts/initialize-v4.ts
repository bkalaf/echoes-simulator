import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvFile } from "../core/inputs/importer.js";
import { AUTHORING_ENRICHMENT_FIELDS, PERSONALITY_DIMENSION_POLICY, SIMULATION_CRITICAL_FIELDS, reconcileResearchUnitIndex, type ResearchUnit } from "../core/research/v4-contract.js";

const root = resolve(".");
const promptPack = resolve(root, "ECHOES_OF_EIDOLON_RESEARCH_V4_CODEX_PROMPT_PACK_2026-08-19");
const ownerPack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const output = resolve(root, "artifacts/simulator/v4");
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const packManifest = JSON.parse(readFileSync(resolve(promptPack, "PACK_MANIFEST.json"), "utf8")) as { files: { path: string; bytes: number; sha256: string }[] };
const badPackFiles = packManifest.files.filter((entry) => {
  const bytes = readFileSync(resolve(promptPack, entry.path));
  return bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256;
});
if (badPackFiles.length) throw new Error(`V4 prompt pack integrity failed: ${badPackFiles.map((entry) => entry.path).join(", ")}`);

const index = JSON.parse(readFileSync(resolve(promptPack, "units/RESEARCH_UNIT_INDEX.json"), "utf8")) as { units: ResearchUnit[] };
const identityFile = resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv");
const assignmentFile = resolve(ownerPack, "INPUTS/region_species_group_assignments(1).csv");
const breeds = parseCsvFile(identityFile);
const assignments = parseCsvFile(assignmentFile).map((row) => ({ groupId: row.groupId!, regionId: row.regionId! }));
const reconciliation = reconcileResearchUnitIndex(index, breeds, assignments);
if (reconciliation.units !== 1219 || reconciliation.civicBreeds !== 1773) throw new Error("V4 research-unit reconciliation did not match owner counts");

const v3 = resolve(root, "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip");
const regression = resolve(root, "artifacts/simulator/remediation/research/fresh_regression_research.json");
mkdirSync(output, { recursive: true });
const retirement = {
  schemaVersion: "eidolon-research-authority-retirement-v1",
  filename: "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip",
  sha256: sha256(readFileSync(v3)),
  status: "RETIRED_FALSE_COMPLETION",
  priorVerdictAuthority: "INVALIDATED",
  reason: "V3 mass-terminal-null semantics did not satisfy simulation-critical personality, terrain, or raw-dimension coverage.",
  preservedFreshRegressionProvenance: { path: "artifacts/simulator/remediation/research/fresh_regression_research.json", sha256: sha256(readFileSync(regression)) },
};
const architecture = {
  schemaVersion: "eidolon-research-v4-architecture-lock-v1",
  status: "ARCHITECTURE_LOCKED_RESEARCH_NOT_STARTED",
  promptPack: { files: packManifest.files.length, integrity: "PASS" },
  identityAuthority: { filename: "full_breed_with_region_ids(1).csv", sha256: sha256(readFileSync(identityFile)), role: "CURRENT_CANONICAL_IDENTITY_FOR_V4_RECONCILIATION" },
  assignments: { filename: "region_species_group_assignments(1).csv", sha256: sha256(readFileSync(assignmentFile)) },
  reconciliation,
  unitTypes: Object.fromEntries(["HUMAN_CULTURE", "BEAST_SPECIES", "MYTHOS_SPECIES"].map((type) => [type, index.units.filter((unit) => unit.unitType === type).length])),
  simulationCritical: SIMULATION_CRITICAL_FIELDS,
  authoringEnrichment: AUTHORING_ENRICHMENT_FIELDS,
  personalityDimensionPolicy: PERSONALITY_DIMENSION_POLICY,
  completedRegionBatches: [],
  completedAuditShards: [],
};
writeFileSync(resolve(output, "V3_RETIREMENT.json"), `${JSON.stringify(retirement, null, 2)}\n`);
writeFileSync(resolve(output, "ARCHITECTURE_LOCK.json"), `${JSON.stringify(architecture, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ retirement, architecture }, null, 2)}\n`);
