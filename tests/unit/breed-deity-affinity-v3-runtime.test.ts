import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/core/serialization/canonical-json.js";
import { auditLegacyPositionalBreedDeityVectorV3, auditStableBreedDeityAuthorityV1, type StableBreedDeityAuthorityV1 } from "../../src/core/breeds/breed-deity-authority.js";

describe("Breed primary-Deity stable-ID authority", () => {
  it("rejects the complete V3 positional vector as runtime authority instead of binding a prefix", () => {
    expect(auditLegacyPositionalBreedDeityVectorV3({ declaredBreedCount: 2_062, canonicalBreedCount: 2_062, deityCount: 27, assignmentDeityIndex: Array.from({ length: 2_063 }, () => 0) })).toEqual({ status: "UNTRUSTED_POSITIONAL_AUTHORITY", assignmentCount: 2_063, canonicalBreedCount: 2_062, extraAssignments: 1, missingAssignments: 0, terminalStableIdPath: "EXTERNAL_SEMANTIC_RECONSTRUCTION", bindingDetermination: "NO_STABLE_IDS_PRESENT" });
  });

  it("accepts only an exact 2,062-row stable-ID corpus with valid Deities and external provenance", () => {
    const canonicalBreedIds = Array.from({ length: 2_062 }, (_, index) => `BRD_${String(index).padStart(4, "0")}`);
    const canonicalDeityIds = Array.from({ length: 27 }, (_, index) => `DEITY_${String(index).padStart(2, "0")}`);
    const hash = "a".repeat(64);
    const assignments = canonicalBreedIds.map((breedId, index) => ({ breedId, deityId: canonicalDeityIds[index % canonicalDeityIds.length]!, externalProvider: "EXTERNAL_PROVIDER", externalModel: "SEMANTIC_MODEL", requestSha256: hash, responseSha256: hash, sourceEvidenceSha256: hash }));
    const content = { schemaVersion: "echoes-breed-primary-deity-stable-v1" as const, authorityId: "BREED_PRIMARY_DEITY_STABLE", revisionId: "R1", approvedBy: "OWNER", approvedAt: "2026-08-29T00:00:00.000Z", assignments };
    const authority: StableBreedDeityAuthorityV1 = { ...content, contentSha256: createHash("sha256").update(canonicalJson(content)).digest("hex") };
    expect(auditStableBreedDeityAuthorityV1({ authority, canonicalBreedIds, canonicalDeityIds })).toMatchObject({ status: "PASS", canonicalBreedCount: 2_062, assignmentCount: 2_062, uniqueAssignmentCount: 2_062, positionalRuntimeReads: 0 });
  });
});
