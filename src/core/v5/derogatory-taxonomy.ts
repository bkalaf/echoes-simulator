import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import { V5_DEROGATORY_GROUP_IDS, type DerogatoryGroupIdV5 } from "./types.js";

export const LEGACY_DEROGATORY_TAXONOMY_STATUS = "LEGACY_UNTRUSTED_TARGET_TAXONOMY" as const;
export const CANONICAL_DEROGATORY_STRUCTURE_SLOTS_V1 = ["CANONICAL_STRUCTURE_1", "CANONICAL_STRUCTURE_2", "CANONICAL_STRUCTURE_3"] as const;

export interface DerogatoryGroupingReviewStructureV1 {
  structureId: typeof CANONICAL_DEROGATORY_STRUCTURE_SLOTS_V1[number];
  acceptedName: string | null;
  /** Explicit tri-state review prevents omission from being treated as non-membership. */
  membershipByGroupId: Partial<Record<DerogatoryGroupIdV5, "MEMBER" | "NOT_MEMBER">>;
}

export type LegacyDerogatoryGroupDispositionV1 = "KEEP" | "REJECT";

export interface DerogatoryTaxonomyReviewV1 {
  schemaVersion: "echoes-derogatory-taxonomy-review-v1";
  status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  legacyStatus: typeof LEGACY_DEROGATORY_TAXONOMY_STATUS;
  authorityRevisionId: string | null;
  dispositionByGroupId: Partial<Record<DerogatoryGroupIdV5, LegacyDerogatoryGroupDispositionV1>>;
  structures: readonly DerogatoryGroupingReviewStructureV1[];
  contentSha256: string | null;
}

export function emptyDerogatoryTaxonomyReviewV1(): DerogatoryTaxonomyReviewV1 {
  return { schemaVersion: "echoes-derogatory-taxonomy-review-v1", status: "UNREVIEWED", legacyStatus: LEGACY_DEROGATORY_TAXONOMY_STATUS, authorityRevisionId: null, dispositionByGroupId: {}, structures: CANONICAL_DEROGATORY_STRUCTURE_SLOTS_V1.map((structureId) => ({ structureId, acceptedName: null, membershipByGroupId: {} })), contentSha256: null };
}

export function validateApprovedDerogatoryTaxonomyV1(review: DerogatoryTaxonomyReviewV1): string {
  if (review.status !== "APPROVED" || !review.authorityRevisionId) throw new Error("Derogatory Group taxonomy needs review [Open Review]");
  if (review.structures.length !== 3 || new Set(review.structures.map((row) => row.structureId)).size !== 3) throw new Error("Derogatory taxonomy requires exactly three canonical grouping structures");
  const names = review.structures.map((row) => row.acceptedName?.trim() ?? "");
  if (names.some((name) => !name) || new Set(names.map((name) => name.toLocaleLowerCase())).size !== 3) throw new Error("Owner must name three distinct canonical grouping structures");
  for (const groupId of V5_DEROGATORY_GROUP_IDS) {
    const disposition = review.dispositionByGroupId[groupId];
    if (!disposition) throw new Error(`Derogatory taxonomy needs KEEP or REJECT for ${groupId}`);
    for (const structure of review.structures) {
      const membership = structure.membershipByGroupId[groupId];
      if (disposition === "KEEP" && !membership) throw new Error(`Derogatory taxonomy ${structure.structureId} needs MEMBER or NOT_MEMBER for kept Group ${groupId}`);
      if (disposition === "REJECT" && membership) throw new Error(`Rejected legacy Group ${groupId} cannot have canonical structure membership`);
    }
  }
  const content = { schemaVersion: review.schemaVersion, authorityRevisionId: review.authorityRevisionId, dispositionByGroupId: review.dispositionByGroupId, structures: review.structures };
  const hash = createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
  if (hash !== review.contentSha256) throw new Error("Derogatory taxonomy changed after exact approval");
  return hash;
}

export function candidateGroupsForDerogatoryReviewV1(): readonly { groupId: DerogatoryGroupIdV5; legacyStatus: typeof LEGACY_DEROGATORY_TAXONOMY_STATUS; requiredDisposition: readonly LegacyDerogatoryGroupDispositionV1[]; membershipRequiredOnlyWhen: "KEEP" }[] {
  return V5_DEROGATORY_GROUP_IDS.map((groupId) => ({ groupId, legacyStatus: LEGACY_DEROGATORY_TAXONOMY_STATUS, requiredDisposition: ["KEEP", "REJECT"], membershipRequiredOnlyWhen: "KEEP" }));
}
