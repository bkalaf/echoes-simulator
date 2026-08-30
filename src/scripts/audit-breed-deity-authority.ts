import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditLegacyPositionalBreedDeityVectorV3, auditStableBreedDeityAuthorityV1, type StableBreedDeityAuthorityV1 } from "../core/breeds/breed-deity-authority.js";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";

const root = resolve("resources/noncausal/breed-deity-affinity");
const manifest = JSON.parse(readFileSync(resolve("resources/canonical/canonical_bundle_manifest.json"), "utf8")) as { breedSemanticFilename: string };
const archive = openValidatedZip(resolve("resources/canonical/breeds", manifest.breedSemanticFilename));
const identitiesEntry = Object.entries(archive.entries).find(([filename]) => filename.endsWith("canonical_breed_identities.jsonl"));
if (!identitiesEntry) throw new Error("Canonical Breed identity entry is missing");
const canonicalBreedIds = (parseJsonLines(identitiesEntry[1]) as { breedId: string }[]).map((row) => row.breedId);
const legacy = JSON.parse(readFileSync(resolve(root, "breed-primary-deity-authority-v3.json"), "utf8")) as { breedCount: number; deities: string[]; assignmentDeityIndex: number[] };
const v1 = JSON.parse(readFileSync(resolve(root, "breed-primary-deity-authority-v1.json"), "utf8")) as { assignments: { breedId: string }[]; unresolved: { breedId: string }[] };
const v2 = JSON.parse(readFileSync(resolve(root, "breed-primary-deity-authority-v2.json"), "utf8")) as { assignments: { breedId: string }[]; unresolved: { breedId: string }[] };
const stablePath = resolve(root, "breed-primary-deity-authority-stable-v1.json");
let stableAudit: ReturnType<typeof auditStableBreedDeityAuthorityV1> | null = null;
try {
  const stable = JSON.parse(readFileSync(stablePath, "utf8")) as StableBreedDeityAuthorityV1;
  const deityIds = [...new Set(stable.assignments.map((assignment) => assignment.deityId))];
  stableAudit = auditStableBreedDeityAuthorityV1({ authority: stable, canonicalBreedIds, canonicalDeityIds: deityIds });
} catch {
  stableAudit = null;
}

const report = {
  schemaVersion: "echoes-breed-primary-deity-stable-audit-v1",
  status: stableAudit?.status ?? "RECONSTRUCTION_REQUIRED",
  history: {
    v1StableIdRows: v1.assignments.length + v1.unresolved.length,
    v2StableIdRows: v2.assignments.length + v2.unresolved.length,
    v3CommitIntroduction: "16546ce066874062a3e940b9308e9c23523edf28: placeholder only",
    v3PopulationCommit: "9ce551b28dec70283777de3b54118b81ca9eaca4: compact positional vector only",
    stableIdV3SourceFound: false,
  },
  legacyVector: auditLegacyPositionalBreedDeityVectorV3({ declaredBreedCount: legacy.breedCount, assignmentDeityIndex: legacy.assignmentDeityIndex, deityCount: legacy.deities.length, canonicalBreedCount: canonicalBreedIds.length }),
  stableAuthority: stableAudit ?? { status: "RECONSTRUCTION_REQUIRED", path: stablePath, assignmentCount: 0, missingBreedIds: canonicalBreedIds, positionalRuntimeReads: 0 },
  sourceHashes: Object.fromEntries(["v1", "v2", "v3"].map((version) => [version, createHash("sha256").update(readFileSync(resolve(root, `breed-primary-deity-authority-${version}.json`))).digest("hex")])),
  requiredAction: "Complete the externally evidenced stable-ID reconstruction, import exactly 2,062 unique Breed-to-Deity rows, approve the exact content hash, then run this audit and database FK/NOT NULL verification.",
};
const artifactDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(resolve(artifactDirectory, "breed-deity-affinity-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "PASS") process.exitCode = 2;
