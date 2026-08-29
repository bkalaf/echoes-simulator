import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";

const authorityPath = resolve("resources/noncausal/breed-deity-affinity/breed-primary-deity-authority-v3.json");
const manifestPath = resolve("resources/canonical/canonical_bundle_manifest.json");
const outputPath = resolve("artifacts/simulator/v5/remediation/v54-breed-deity-authority-diagnostic.json");
const authorityBytes = readFileSync(authorityPath);
const authority = JSON.parse(authorityBytes.toString("utf8")) as { breedCount: number; ordering: string; deities: string[]; assignmentDeityIndex: number[]; reviewRequiredIndices: number[]; breedSemanticSha256: string };
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { breedSemanticFilename: string; breedSemanticSha256: string };
const archive = openValidatedZip(resolve("resources/canonical/breeds", manifest.breedSemanticFilename));
const identityEntry = Object.entries(archive.entries).find(([filename]) => filename.endsWith("canonical_breed_identities.jsonl"));
if (!identityEntry) throw new Error("Canonical Breed identity entry is missing");
const sourceBreedIds = (parseJsonLines(identityEntry[1]) as Array<{ breedId: string }>).map((row) => row.breedId);
const canonicalSortedBreedIds = [...sourceBreedIds].sort((left, right) => left.localeCompare(right));
const duplicateBreedIds = [...new Set(canonicalSortedBreedIds.filter((breedId, index) => index > 0 && canonicalSortedBreedIds[index - 1] === breedId))].sort();
const assignments = authority.assignmentDeityIndex.map((deityIndex, index) => ({
  position: index, breedId: canonicalSortedBreedIds[index] ?? null, deityIndex, deityName: authority.deities[deityIndex] ?? null,
  reviewRequired: authority.reviewRequiredIndices.includes(index), bindingStatus: index < canonicalSortedBreedIds.length ? "BOUND_BY_SORTED_POSITION" : "UNBOUND_EXTRA_ASSIGNMENT",
}));
const extraCount = Math.max(0, assignments.length - canonicalSortedBreedIds.length); const missingCount = Math.max(0, canonicalSortedBreedIds.length - assignments.length);
const firstPositionalDivergence = extraCount > 0 ? { position: canonicalSortedBreedIds.length, type: "EXTRA_ASSIGNMENT", breedId: null, assignment: assignments[canonicalSortedBreedIds.length] } : missingCount > 0 ? { position: assignments.length, type: "MISSING_ASSIGNMENT", breedId: canonicalSortedBreedIds[assignments.length], assignment: null } : null;
const output = {
  schemaVersion: "echoes-v5.4-breed-deity-authority-diagnostic-v1", pass: false, authorityBlockerRetained: true, failClosedLoaderChanged: false,
  sources: { authorityPath, authoritySha256: createHash("sha256").update(authorityBytes).digest("hex"), canonicalBreedArchive: manifest.breedSemanticFilename, manifestBreedSemanticSha256: manifest.breedSemanticSha256, authorityBreedSemanticSha256: authority.breedSemanticSha256 },
  counts: { declaredBreedCount: authority.breedCount, canonicalBreedCount: canonicalSortedBreedIds.length, assignmentCount: assignments.length, extraAssignmentCount: extraCount, missingAssignmentCount: missingCount, duplicateBreedCount: duplicateBreedIds.length },
  ordering: { declaredAuthorityOrdering: authority.ordering, canonicalSourceAlreadyBreedIdAscending: canonicalJson(sourceBreedIds) === canonicalJson(canonicalSortedBreedIds), loaderOrdering: "canonical Breed IDs sorted by breedId ascending", catalogOrderMismatch: false, note: "The loader intentionally sorts canonical IDs; archive row order is not positional authority." },
  determination: { problem: extraCount > 0 && missingCount === 0 && duplicateBreedIds.length === 0 ? "EXTRA_ASSIGNMENT" : "UNRESOLVED_COMPOUND_MISMATCH", firstPositionalDivergence, removalDecision: "NOT_AUTHORIZED", semanticAssignmentIdentityAvailable: false, note: "The compact authority has no per-assignment Breed IDs, so positions 0..2061 can be bound but their semantic pairing cannot be independently reconstructed. The assignment at position 2062 is definitively unbound; no evidence identifies which value, if any, an owner should remove." },
  duplicateBreedIds, canonicalSortedBreedIds, assignments,
};
mkdirSync(resolve(outputPath, ".."), { recursive: true }); writeFileSync(outputPath, `${canonicalJson(output)}\n`, "utf8");
process.stdout.write(`${canonicalJson({ outputPath, counts: output.counts, determination: output.determination })}\n`);
