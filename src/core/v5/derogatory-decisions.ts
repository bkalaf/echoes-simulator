import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import { historicalPolicyHashV5, requireHistoricalPolicyV5, type DerogatoryMembershipSlicingPolicyV1 } from "./historical-policies.js";
import { causalPopulationTotalsV5, materializeDerogatoryMembershipV5 } from "./population-slices.js";
import type { DerogatoryGroupIdV5, DerogatoryTargetSelectionV5, DerogatoryTargetingScopeV5, WorldKey, WorldStateV5 } from "./types.js";
import { V5_DEROGATORY_TARGETING_SCOPES } from "./types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
export const V5_DEROGATORY_DECISION_PROTOCOL = "echoes-derogatory-decisions-v1";
export const V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH = createHash("sha256").update(`${V5_DEROGATORY_DECISION_PROTOCOL}:EMPTY`, "utf8").digest("hex");

export interface DerogatoryDecisionRequestV5 {
  decisionId: string;
  worldKey: WorldKey;
  scope: DerogatoryTargetingScopeV5;
  reviewYear: number;
  allowedActions: readonly ("SELECT" | "KEEP" | "REPLACE")[];
  priorGroupId: DerogatoryGroupIdV5 | null;
  readyGroupIds: readonly DerogatoryGroupIdV5[];
  publicPopulationBeforeReview: string;
  enclavePopulationBeforeReview: string;
}

export interface DerogatoryDecisionBatchV5 {
  schemaVersion: "echoes-derogatory-decision-batch-v1";
  batchId: string;
  reviewYear: number;
  barrierYear: number;
  policySha256: string;
  orderedDecisionIds: readonly string[];
  requests: readonly DerogatoryDecisionRequestV5[];
  contextSha256: string;
  promptText: string;
  promptSha256: string;
}

export interface DerogatoryDecisionResponseItemV5 {
  decisionId: string;
  action: "SELECT" | "KEEP" | "REPLACE";
  selectedGroupId: DerogatoryGroupIdV5;
}

export interface DerogatoryDecisionResponseV5 {
  schemaVersion: "echoes-derogatory-decision-response-v1";
  batchId: string;
  contextSha256: string;
  promptSha256: string;
  provider: string;
  model: string;
  authorityRef: string;
  decisions: readonly DerogatoryDecisionResponseItemV5[];
}

export interface AcceptedDerogatoryDecisionBatchV5 {
  schemaVersion: "echoes-accepted-derogatory-decision-batch-v1";
  batch: DerogatoryDecisionBatchV5;
  response: DerogatoryDecisionResponseV5;
  rawResponseSha256: string;
  priorDecisionStreamHash: string;
  decisionStreamHash: string;
  acceptedSelections: readonly (DerogatoryDecisionResponseItemV5 & { worldKey: WorldKey; scope: DerogatoryTargetingScopeV5; priorGroupId: DerogatoryGroupIdV5 | null })[];
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
export function isDerogatoryDecisionReviewYearV5(year: number): boolean { return year === 15 || (year >= 150 && year % 100 === 50); }

function activePrior(state: WorldStateV5, scope: DerogatoryTargetingScopeV5): DerogatoryGroupIdV5 | null {
  return [...(state.derogatoryTargetSelections ?? [])].filter((row) => row.scope === scope && row.effectiveFromYear <= state.year && (row.effectiveUntilYear === null || row.effectiveUntilYear > state.year)).sort((a, b) => b.reviewYear - a.reviewYear)[0]?.selectedGroupId ?? null;
}

export function requireDerogatoryMembershipPolicyAtReviewV5(input: { mode: "CANONICAL" | "DIAGNOSTIC"; ownerInputs: CausalOwnerInputsV1; states: Readonly<Record<WorldKey, WorldStateV5>>; reviewYear: number }): DerogatoryMembershipSlicingPolicyV1 {
  return requireHistoricalPolicyV5({ mode: input.mode, policies: input.ownerInputs.historicalDynamismPolicies, approvedHashes: input.ownerInputs.historicalDynamismApprovedPolicyHashes, diagnosticCandidateOptIns: input.ownerInputs.diagnosticHistoricalPolicyOptIns, policyKey: "DEROGATORY_MEMBERSHIP_SLICING", causalOperation: "CREATE_DEROGATORY_GROUP_DECISION_BATCH", worldKey: "CONCORD", year: input.reviewYear, entityType: "DECISION_BATCH", entityId: `DEROGATORY_REVIEW_${input.reviewYear}` });
}

export function buildDerogatoryDecisionBatchV5(states: Readonly<Record<WorldKey, WorldStateV5>>, reviewYear: number, policy: DerogatoryMembershipSlicingPolicyV1): DerogatoryDecisionBatchV5 {
  if (!isDerogatoryDecisionReviewYearV5(reviewYear)) throw new Error(`Year ${reviewYear} is not a Derogatory Group review year`);
  if (!WORLDS.every((world) => states[world].year === reviewYear - 1)) throw new Error("Derogatory decision batch requires the prior atomic checkpoint for all worlds");
  const readyGroupIds = policy.predicates.filter((row) => row.status === "READY").map((row) => row.groupId).sort();
  const requests = WORLDS.flatMap((worldKey) => V5_DEROGATORY_TARGETING_SCOPES.map((scope) => {
    const priorGroupId = activePrior(states[worldKey], scope); const totals = causalPopulationTotalsV5(states[worldKey]);
    if (reviewYear === 15 && priorGroupId !== null) throw new Error(`Initial SELECT for ${worldKey}/${scope} unexpectedly has a prior group`);
    if (reviewYear > 15 && priorGroupId === null) throw new Error(`Later review for ${worldKey}/${scope} has no prior group`);
    return { decisionId: `DEROGATORY_DECISION_${reviewYear}_${worldKey}_${scope}`, worldKey, scope, reviewYear, allowedActions: reviewYear === 15 ? ["SELECT" as const] : ["KEEP" as const, "REPLACE" as const], priorGroupId, readyGroupIds, publicPopulationBeforeReview: totals.publicPopulation.toString(), enclavePopulationBeforeReview: totals.enclavePopulation.toString() };
  }));
  if (requests.length !== 63) throw new Error(`Derogatory decision batch has ${requests.length}, expected 63`);
  const context = { protocol: V5_DEROGATORY_DECISION_PROTOCOL, reviewYear, barrierYear: reviewYear - 1, policySha256: historicalPolicyHashV5(policy), requests };
  const contextSha256 = hash(context);
  const promptText = `Return one externally authored decision for each ordered decisionId in batch ${contextSha256}. Year 15 requires SELECT. Later reviews require KEEP or REPLACE. KEEP must preserve priorGroupId. REPLACE must select a different registered predicate-ready group. Do not omit, add, or reorder decisions.`;
  const promptSha256 = hash(promptText); const batchId = `DEROGATORY_BATCH_${reviewYear}_${hash({ contextSha256, promptSha256 }).slice(0, 24)}`;
  return { schemaVersion: "echoes-derogatory-decision-batch-v1", batchId, reviewYear, barrierYear: reviewYear - 1, policySha256: historicalPolicyHashV5(policy), orderedDecisionIds: requests.map((row) => row.decisionId), requests, contextSha256, promptText, promptSha256 };
}

export function acceptDerogatoryDecisionResponseV5(batch: DerogatoryDecisionBatchV5, response: DerogatoryDecisionResponseV5, priorDecisionStreamHash = V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH): AcceptedDerogatoryDecisionBatchV5 {
  if (response.batchId !== batch.batchId || response.contextSha256 !== batch.contextSha256 || response.promptSha256 !== batch.promptSha256) throw new Error("Derogatory decision response replays or alters immutable batch context");
  if (!response.provider.trim() || !response.model.trim() || !response.authorityRef.trim()) throw new Error("Derogatory decision response lacks provider/model/authority provenance");
  if (response.decisions.length !== 63) throw new Error(`Derogatory decision response has ${response.decisions.length}, expected 63`);
  if (new Set(response.decisions.map((row) => row.decisionId)).size !== response.decisions.length) throw new Error("Derogatory decision response contains duplicate decision IDs");
  const byId = new Map(response.decisions.map((row) => [row.decisionId, row]));
  const acceptedSelections = batch.requests.map((request) => {
    const decision = byId.get(request.decisionId); if (!decision) throw new Error(`Missing decision ${request.decisionId}`);
    if (!request.allowedActions.includes(decision.action)) throw new Error(`Invalid ${decision.action} action for ${request.decisionId}`);
    if (!request.readyGroupIds.includes(decision.selectedGroupId)) throw new Error(`Decision ${request.decisionId} selected a predicate-not-ready group`);
    if (decision.action === "SELECT" && request.priorGroupId !== null) throw new Error(`SELECT ${request.decisionId} requires no prior group`);
    if (decision.action === "KEEP" && decision.selectedGroupId !== request.priorGroupId) throw new Error(`KEEP ${request.decisionId} must preserve ${request.priorGroupId}`);
    if (decision.action === "REPLACE" && (request.priorGroupId === null || decision.selectedGroupId === request.priorGroupId)) throw new Error(`REPLACE ${request.decisionId} requires a different group`);
    return { ...decision, worldKey: request.worldKey, scope: request.scope, priorGroupId: request.priorGroupId };
  });
  const rawResponseSha256 = hash(response); const decisionStreamHash = hash({ priorDecisionStreamHash, batchId: batch.batchId, rawResponseSha256, acceptedSelections });
  return { schemaVersion: "echoes-accepted-derogatory-decision-batch-v1", batch, response, rawResponseSha256, priorDecisionStreamHash, decisionStreamHash, acceptedSelections };
}

export function applyAcceptedDerogatoryDecisionBatchV5(states: Record<WorldKey, WorldStateV5>, canonical: CanonicalDataV5, policy: DerogatoryMembershipSlicingPolicyV1, accepted: AcceptedDerogatoryDecisionBatchV5): Record<WorldKey, WorldStateV5> {
  const result = structuredClone(states);
  for (const worldKey of WORLDS) {
    let world = result[worldKey]; const decisions = accepted.acceptedSelections.filter((row) => row.worldKey === worldKey);
    for (const decision of decisions) {
      world = materializeDerogatoryMembershipV5(world, canonical, policy, decision.selectedGroupId);
      const population = (world.populationSlices ?? []).filter((slice) => slice.membershipSignature.includes(decision.selectedGroupId)).reduce((sum, slice) => sum + slice.population, 0n);
      world.derogatoryTargetSelections = (world.derogatoryTargetSelections ?? []).map((row) => row.scope === decision.scope && row.effectiveUntilYear === null ? { ...row, effectiveUntilYear: accepted.batch.reviewYear } : row);
      const selection: DerogatoryTargetSelectionV5 = { selectionId: `DEROGATORY_SELECTION_${accepted.batch.reviewYear}_${worldKey}_${decision.scope}`, worldKey, scope: decision.scope, reviewYear: accepted.batch.reviewYear, action: decision.action, priorGroupId: decision.priorGroupId, selectedGroupId: decision.selectedGroupId, effectiveFromYear: accepted.batch.reviewYear, effectiveUntilYear: null, decisionBatchId: accepted.batch.batchId, responseSha256: accepted.rawResponseSha256, provenanceRef: `${accepted.response.provider}/${accepted.response.model}/${accepted.response.authorityRef};affectedPopulation=${population}` };
      world.derogatoryTargetSelections.push(selection);
    }
    result[worldKey] = world;
  }
  return result;
}
