import type { WorldKey } from "./types.js";

export const POI_RENAME_CONSEQUENCE_DIMENSIONS_V1 = [
  "LEGITIMACY", "ACCEPTANCE_GRIEVANCE", "PERCEIVED_HISTORICAL_ERASURE", "GROUP_SAFETY_MIGRATION", "PILLAR_REPUTATION", "FAMILY_REPUTATION", "PROPAGANDA", "DIPLOMATIC_CLAIMS", "CONFLICT_RISK", "DURABLE_CULTURAL_MEMORY",
] as const;
export type PoiRenameConsequenceDimensionV1 = typeof POI_RENAME_CONSEQUENCE_DIMENSIONS_V1[number];

export interface PoiRenameConsequencePolicyV1 {
  revisionId: string;
  status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  magnitudeByDimension: Readonly<Record<PoiRenameConsequenceDimensionV1, number>>;
}

export interface PoiRenameDecisionV1 {
  decisionId: string;
  worldKey: WorldKey;
  poiId: string;
  year: number;
  decision: "KEEP_EXISTING_NAME" | "REQUEST_RENAME";
  priorAcceptedName: string;
  externalNamingRequestId: string | null;
  acceptedReplacementName: string | null;
  aliasPreserved: true;
  consequencePolicyRevisionId: string | null;
}

export function validatePoiRenameDecisionV1(decision: PoiRenameDecisionV1, policy: PoiRenameConsequencePolicyV1 | null): readonly { dimension: PoiRenameConsequenceDimensionV1; magnitude: number }[] {
  if (!decision.priorAcceptedName.trim()) throw new Error("POI rename decisions must preserve the prior accepted name as an alias");
  if (decision.decision === "KEEP_EXISTING_NAME" && (decision.externalNamingRequestId || decision.acceptedReplacementName)) throw new Error("KEEP_EXISTING_NAME cannot carry a replacement naming result");
  if (decision.decision === "REQUEST_RENAME" && !decision.externalNamingRequestId) throw new Error("REQUEST_RENAME requires an external naming request");
  if (!policy || policy.status !== "APPROVED" || decision.consequencePolicyRevisionId !== policy.revisionId) throw new Error("POI rename consequence policy needs approval [Open Owner Policy Center > POI_RENAME_CONSEQUENCES]");
  for (const dimension of POI_RENAME_CONSEQUENCE_DIMENSIONS_V1) if (!Number.isFinite(policy.magnitudeByDimension[dimension])) throw new Error(`POI rename consequence policy is missing ${dimension}`);
  return POI_RENAME_CONSEQUENCE_DIMENSIONS_V1.map((dimension) => ({ dimension, magnitude: policy.magnitudeByDimension[dimension] }));
}
