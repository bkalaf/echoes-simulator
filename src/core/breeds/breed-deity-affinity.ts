import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type BreedDeityAffinityStatus = "CLASSIFIED" | "REVIEW_REQUIRED";
export type BreedDeityAffinity = { deityName: string; status: BreedDeityAffinityStatus };

type RuntimeAuthorityV3 = {
  schemaVersion: "echoes-breed-deity-affinity-runtime-v3";
  authorityId: string;
  authorityVersion: number;
  breedSemanticSha256: string;
  breedCount: number;
  ordering: "breedId ascending";
  deities: string[];
  assignmentDeityIndex: number[];
  reviewRequiredIndices: number[];
};

const AUTHORITY_RELATIVE_PATH = "../noncausal/breed-deity-affinity/breed-primary-deity-authority-v3.json";

export function loadBreedDeityAffinity(
  canonicalDirectory: string,
  breedIds: readonly string[],
  expectedBreedSemanticSha256?: string | null,
): Map<string, BreedDeityAffinity> {
  const filename = resolve(canonicalDirectory, AUTHORITY_RELATIVE_PATH);
  if (!existsSync(filename)) throw new Error(`Breed deity affinity authority is missing: ${filename}`);
  const authority = JSON.parse(readFileSync(filename, "utf8")) as RuntimeAuthorityV3;
  if (authority.schemaVersion !== "echoes-breed-deity-affinity-runtime-v3") throw new Error(`Unsupported Breed deity affinity schema: ${String(authority.schemaVersion)}`);
  if (authority.authorityVersion !== 3 || authority.ordering !== "breedId ascending") throw new Error("Breed deity affinity V3 authority metadata is invalid");
  if (expectedBreedSemanticSha256 && authority.breedSemanticSha256 !== expectedBreedSemanticSha256) throw new Error("Breed deity affinity authority does not match the active V4 Breed semantic authority");

  const orderedBreedIds = [...breedIds].sort((left, right) => left.localeCompare(right));
  if (authority.breedCount !== orderedBreedIds.length || authority.assignmentDeityIndex.length !== orderedBreedIds.length) throw new Error("Breed deity affinity authority coverage does not match the canonical Breed catalog");
  if (new Set(orderedBreedIds).size !== orderedBreedIds.length) throw new Error("Canonical Breed catalog contains duplicate Breed IDs");
  if (authority.deities.length !== 27 || new Set(authority.deities).size !== 27) throw new Error("Breed deity affinity authority must contain exactly 27 unique deities");

  const reviewRequired = new Set(authority.reviewRequiredIndices);
  for (const index of reviewRequired) if (!Number.isInteger(index) || index < 0 || index >= orderedBreedIds.length) throw new Error(`Breed deity affinity review index is invalid: ${index}`);

  return new Map(orderedBreedIds.map((breedId, index) => {
    const deityIndex = authority.assignmentDeityIndex[index];
    if (!Number.isInteger(deityIndex) || deityIndex < 0 || deityIndex >= authority.deities.length) throw new Error(`Breed deity affinity deity index is invalid for ${breedId}`);
    return [breedId, { deityName: authority.deities[deityIndex]!, status: reviewRequired.has(index) ? "REVIEW_REQUIRED" : "CLASSIFIED" }];
  }));
}
