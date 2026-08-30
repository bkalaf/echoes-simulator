import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";

export interface StableBreedDeityDecisionV1 {
  breedId: string;
  deityId: string;
  externalProvider: string;
  externalModel: string;
  requestSha256: string;
  responseSha256: string;
  sourceEvidenceSha256: string;
}

export interface StableBreedDeityAuthorityV1 {
  schemaVersion: "echoes-breed-primary-deity-stable-v1";
  authorityId: string;
  revisionId: string;
  approvedBy: string;
  approvedAt: string;
  assignments: StableBreedDeityDecisionV1[];
  contentSha256: string;
}

export interface BreedDeityAuthorityAuditV1 {
  status: "PASS" | "RECONSTRUCTION_REQUIRED";
  canonicalBreedCount: number;
  assignmentCount: number;
  uniqueAssignmentCount: number;
  missingBreedIds: string[];
  extraBreedIds: string[];
  duplicateBreedIds: string[];
  invalidDeityAssignments: { breedId: string; deityId: string }[];
  incompleteProvenanceBreedIds: string[];
  contentHashMatches: boolean;
  positionalRuntimeReads: 0;
}

const hex64 = /^[a-f0-9]{64}$/i;

export function auditStableBreedDeityAuthorityV1(input: { authority: StableBreedDeityAuthorityV1; canonicalBreedIds: readonly string[]; canonicalDeityIds: readonly string[] }): BreedDeityAuthorityAuditV1 {
  const expectedBreeds = new Set(input.canonicalBreedIds);
  const validDeities = new Set(input.canonicalDeityIds);
  const observed = new Map<string, number>();
  for (const assignment of input.authority.assignments) observed.set(assignment.breedId, (observed.get(assignment.breedId) ?? 0) + 1);
  const missingBreedIds = [...expectedBreeds].filter((breedId) => !observed.has(breedId)).sort();
  const extraBreedIds = [...observed.keys()].filter((breedId) => !expectedBreeds.has(breedId)).sort();
  const duplicateBreedIds = [...observed].filter(([, count]) => count > 1).map(([breedId]) => breedId).sort();
  const invalidDeityAssignments = input.authority.assignments.filter((assignment) => !validDeities.has(assignment.deityId)).map(({ breedId, deityId }) => ({ breedId, deityId }));
  const incompleteProvenanceBreedIds = input.authority.assignments.filter((assignment) => !assignment.externalProvider || !assignment.externalModel || !hex64.test(assignment.requestSha256) || !hex64.test(assignment.responseSha256) || !hex64.test(assignment.sourceEvidenceSha256)).map((assignment) => assignment.breedId).sort();
  const contentSha256 = createHash("sha256").update(canonicalJson({ schemaVersion: input.authority.schemaVersion, authorityId: input.authority.authorityId, revisionId: input.authority.revisionId, approvedBy: input.authority.approvedBy, approvedAt: input.authority.approvedAt, assignments: input.authority.assignments })).digest("hex");
  const contentHashMatches = contentSha256 === input.authority.contentSha256;
  const complete = input.canonicalBreedIds.length === 2_062 && input.authority.assignments.length === 2_062 && observed.size === 2_062 && missingBreedIds.length === 0 && extraBreedIds.length === 0 && duplicateBreedIds.length === 0 && invalidDeityAssignments.length === 0 && incompleteProvenanceBreedIds.length === 0 && contentHashMatches;
  return { status: complete ? "PASS" : "RECONSTRUCTION_REQUIRED", canonicalBreedCount: input.canonicalBreedIds.length, assignmentCount: input.authority.assignments.length, uniqueAssignmentCount: observed.size, missingBreedIds, extraBreedIds, duplicateBreedIds, invalidDeityAssignments, incompleteProvenanceBreedIds, contentHashMatches, positionalRuntimeReads: 0 };
}

export function auditLegacyPositionalBreedDeityVectorV3(input: { declaredBreedCount: number; assignmentDeityIndex: readonly number[]; deityCount: number; canonicalBreedCount: number }): { status: "UNTRUSTED_POSITIONAL_AUTHORITY"; assignmentCount: number; canonicalBreedCount: number; extraAssignments: number; missingAssignments: number; terminalStableIdPath: "EXTERNAL_SEMANTIC_RECONSTRUCTION"; bindingDetermination: "NO_STABLE_IDS_PRESENT" } {
  return { status: "UNTRUSTED_POSITIONAL_AUTHORITY", assignmentCount: input.assignmentDeityIndex.length, canonicalBreedCount: input.canonicalBreedCount, extraAssignments: Math.max(0, input.assignmentDeityIndex.length - input.canonicalBreedCount), missingAssignments: Math.max(0, input.canonicalBreedCount - input.assignmentDeityIndex.length), terminalStableIdPath: "EXTERNAL_SEMANTIC_RECONSTRUCTION", bindingDetermination: "NO_STABLE_IDS_PRESENT" };
}
