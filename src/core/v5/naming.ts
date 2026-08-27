import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { AcceptedLabelLedgerEntryV5, AcceptedLabelSourceV5, NamingBehavior, NamingRequestV5, WorldKey } from "./types.js";

export const DEFAULT_NAMING_BEHAVIOR_V5: Readonly<Record<string, NamingBehavior>> = {
  CANONICAL_SETTLEMENT: "NO_NAME_REQUIRED", EMERGENT_SETTLEMENT: "BLOCKING", EMERGENT_STATE: "BLOCKING", FAMILY: "BATCHED", ORGANIZATION: "BATCHED",
  SIGNIFICANT_POLITICAL_PERSON: "BATCHED", ROUTINE_OFFICEHOLDER: "BATCHED", CANONICAL_OFFICE: "NO_NAME_REQUIRED", CANONICAL_INSTITUTION: "NO_NAME_REQUIRED",
  EMERGENT_INSTITUTION: "BATCHED", CONFLICT: "NO_NAME_REQUIRED", PHYSICAL_POI: "BATCHED", WORLD_ROUTE: "BATCHED", PORTAL_LINK: "NO_NAME_REQUIRED",
};

export const NAMING_COMPARISON_GROUPING_VERSION_V5 = "echoes-naming-comparison-groups-v1" as const;
export const COMPARISON_AWARE_NAMING_INSTRUCTION_V5 = `Treat these entities as alternate-world counterparts.

Preserve the same accepted name when the supplied eligible naming context is materially equivalent across worlds.

Introduce a different world-specific name only when differences in the supplied historical, geographic, cultural, political, factional, sovereign, ownership, settlement, or route context plausibly justify naming divergence.

Do not invent divergence merely for variety. Do not force AAA/AAB/ABC proportions. Do not attempt to satisfy the simulator's 65/25/10 diagnostic target. Generate original names with the LLM; the simulator must not construct them.`;

const WORLD_ORDER: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const VALID_SOURCES = new Set<AcceptedLabelSourceV5>(["CANONICAL_EXISTING", "OWNER_INPUT", "LLM_NAMING_RESPONSE", "AUTOMATIC_REUSE", "TEST_FIXTURE"]);

function requestOrder(left: NamingRequestV5, right: NamingRequestV5): number {
  const leftWorld = left.worldKey ? WORLD_ORDER.indexOf(left.worldKey) : WORLD_ORDER.length;
  const rightWorld = right.worldKey ? WORLD_ORDER.indexOf(right.worldKey) : WORLD_ORDER.length;
  return (left.namingComparisonGroupId ?? `~${left.entityType}/${left.entityId}`).localeCompare(right.namingComparisonGroupId ?? `~${right.entityType}/${right.entityId}`)
    || leftWorld - rightWorld || left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId) || left.requestId.localeCompare(right.requestId);
}

export interface NamingBatchV5 { behavior: "BLOCKING" | "BATCHED"; items: NamingRequestV5[]; }

/** Blocking work is one complete batch and suppresses all deferrable batches. */
export function buildNamingBatches(requests: readonly NamingRequestV5[], maximumBatchSize = 50): NamingBatchV5[] {
  if (!Number.isSafeInteger(maximumBatchSize) || maximumBatchSize <= 0) throw new Error("Naming batch size must be positive");
  const pending = requests.filter((request) => !request.acceptedLabel && (request.behavior === "BLOCKING" || request.behavior === "BATCHED"));
  const blocking = pending.filter((request) => request.behavior === "BLOCKING").sort(requestOrder);
  if (blocking.length > 0) return [{ behavior: "BLOCKING", items: blocking }];
  const batched = pending.filter((request) => request.behavior === "BATCHED").sort(requestOrder);
  const grouped = new Map<string, NamingRequestV5[]>();
  for (const request of batched) {
    const key = request.namingComparisonGroupId ? `GROUP:${request.namingComparisonGroupId}` : `REQUEST:${request.requestId}`;
    const unit = grouped.get(key) ?? [];
    unit.push(request);
    grouped.set(key, unit);
  }
  const batches: NamingBatchV5[] = [];
  let current: NamingRequestV5[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const unit = grouped.get(key)!.sort(requestOrder);
    if (current.length > 0 && current.length + unit.length > maximumBatchSize) { batches.push({ behavior: "BATCHED", items: current }); current = []; }
    current.push(...unit);
  }
  if (current.length > 0) batches.push({ behavior: "BATCHED", items: current });
  return batches;
}

export interface PersistedNamingBatchV5 extends NamingBatchV5 {
  schemaVersion: "echoes-v5-naming-batch-v2";
  batchId: string;
  runId: string;
  year: number;
  promptText: string;
  promptSha256: string;
  comparisonGroupingVersion: typeof NAMING_COMPARISON_GROUPING_VERSION_V5;
  comparisonGroups: readonly {
    namingComparisonGroupId: string;
    comparisonAuthorityRef: string;
    members: readonly { requestId: string; entityId: string; worldKey: WorldKey | null; status: "PENDING" | "ACCEPTED_REFERENCE"; acceptedLabel: string | null; context: Record<string, unknown> | null }[];
  }[];
}

export interface NamingBatchResponseV5 {
  schemaVersion: "echoes-v5-naming-batch-response-v2";
  batchId: string;
  runId: string;
  decisions: readonly { requestId: string; entityType: string; entityId: string; label: string; nameEffectiveFromYear: number }[];
}

function groupAudit(items: readonly NamingRequestV5[], allRequests: readonly NamingRequestV5[]): PersistedNamingBatchV5["comparisonGroups"] {
  const ids = [...new Set(items.map((item) => item.namingComparisonGroupId).filter((id): id is string => Boolean(id)))].sort();
  return ids.map((id) => {
    const pendingIds = new Set(items.filter((item) => item.namingComparisonGroupId === id).map((item) => item.requestId));
    const members = allRequests.filter((item) => item.namingComparisonGroupId === id).sort(requestOrder).map((item) => ({
      requestId: item.requestId, entityId: item.entityId, worldKey: item.worldKey ?? null,
      status: pendingIds.has(item.requestId) ? "PENDING" as const : "ACCEPTED_REFERENCE" as const,
      acceptedLabel: pendingIds.has(item.requestId) ? null : item.acceptedLabel,
      context: item.context ?? null,
    }));
    const authority = allRequests.find((item) => item.namingComparisonGroupId === id)?.comparisonAuthorityRef;
    if (!authority) throw new Error(`Comparison group ${id} lacks authoritative counterpart reference`);
    return { namingComparisonGroupId: id, comparisonAuthorityRef: authority, members };
  });
}

export function buildPersistedNamingBatchesV5(runId: string, requests: readonly NamingRequestV5[], maximumBatchSize = 50): PersistedNamingBatchV5[] {
  return buildNamingBatches(requests, maximumBatchSize).map((batch, index) => {
    const year = Math.max(...batch.items.map((request) => request.createdYear));
    const stableDigest = createHash("sha256").update(canonicalJson(batch.items.map((item) => item.requestId))).digest("hex").slice(0, 16);
    const batchId = `V5_NAMING_${runId}_${batch.behavior}_${year}_${index}_${stableDigest}`;
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v2", batchId, runId, decisions: batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: "REPLACE_WITH_ACCEPTED_LABEL", nameEffectiveFromYear: request.nameEffectiveFromYear ?? request.createdYear })) };
    const groups = groupAudit(batch.items, requests);
    const ungrouped = batch.items.filter((request) => !request.namingComparisonGroupId).map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, worldKey: request.worldKey ?? null, nameEffectiveFromYear: request.nameEffectiveFromYear ?? request.createdYear, context: request.context ?? null }));
    const promptText = `Create one original, historically plausible name for every pending entity ID from its immutable creation-time context. Do not select from word buckets, combine morphemes, use simulator templates, or construct local fallbacks. Labels are non-causal.\n\n${COMPARISON_AWARE_NAMING_INSTRUCTION_V5}\n\nComparison groups (world order CONCORD, SCHISM, RUIN; accepted members are reference-only):\n${JSON.stringify(groups, null, 2)}\n\nUngrouped requests:\n${JSON.stringify(ungrouped, null, 2)}\n\nReturn only this exact JSON shape with an explicit independent decision for every pending entity ID:\n${JSON.stringify(response, null, 2)}`;
    return { schemaVersion: "echoes-v5-naming-batch-v2", batchId, runId, year, behavior: batch.behavior, items: batch.items, promptText, promptSha256: createHash("sha256").update(promptText).digest("hex"), comparisonGroupingVersion: NAMING_COMPARISON_GROUPING_VERSION_V5, comparisonGroups: groups };
  });
}

export function buildBlockingNamingBatchV5(runId: string, requests: readonly NamingRequestV5[]): PersistedNamingBatchV5 | null {
  return buildPersistedNamingBatchesV5(runId, requests).find((batch) => batch.behavior === "BLOCKING") ?? null;
}

export function validateNamingBatchResponseV5(batch: PersistedNamingBatchV5, candidate: unknown): { accepted: boolean; errors: string[]; labels?: Record<string, string>; decisions?: NamingBatchResponseV5["decisions"] } {
  if (!candidate || typeof candidate !== "object") return { accepted: false, errors: ["V5 naming response must be an object"] };
  const row = candidate as Partial<NamingBatchResponseV5>;
  const errors: string[] = [];
  if (row.schemaVersion !== "echoes-v5-naming-batch-response-v2") errors.push("schemaVersion must be echoes-v5-naming-batch-response-v2");
  if (row.batchId !== batch.batchId) errors.push("batchId does not match the pending V5 batch");
  if (row.runId !== batch.runId) errors.push("runId does not match the pending V5 run");
  if (!Array.isArray(row.decisions)) errors.push("decisions must be an array");
  if (errors.length > 0 || !Array.isArray(row.decisions)) return { accepted: false, errors };
  const expected = new Map(batch.items.map((request) => [request.requestId, request]));
  if (row.decisions.length !== expected.size || new Set(row.decisions.map((decision) => decision?.requestId)).size !== expected.size) errors.push("decisions must exactly cover every pending request once");
  const labels: Record<string, string> = {};
  for (const decision of row.decisions) {
    const request = decision && typeof decision === "object" && typeof decision.requestId === "string" ? expected.get(decision.requestId) : undefined;
    if (!request || decision.entityType !== request.entityType || decision.entityId !== request.entityId) { errors.push(`invalid naming decision ${decision?.requestId ?? "UNKNOWN"}`); continue; }
    if (typeof decision.label !== "string" || !decision.label.trim() || decision.label === "REPLACE_WITH_ACCEPTED_LABEL") { errors.push(`empty or template label for ${decision.requestId}`); continue; }
    const effective = request.nameEffectiveFromYear ?? request.createdYear;
    if (decision.nameEffectiveFromYear !== effective) errors.push(`nameEffectiveFromYear for ${decision.requestId} must remain ${effective}`);
    labels[decision.entityId] = decision.label.trim();
  }
  return errors.length > 0 ? { accepted: false, errors } : { accepted: true, errors: [], labels, decisions: row.decisions };
}

export function validateAcceptedLabelProvenanceV5(entry: AcceptedLabelLedgerEntryV5, runMode: "PRODUCTION" | "REMEDIATION" | "TEST"): void {
  if (!entry.label.trim()) throw new Error("Accepted V5 label must be non-empty");
  if (!VALID_SOURCES.has(entry.source)) throw new Error(`Invalid accepted V5 label source ${entry.source}`);
  if (!Number.isSafeInteger(entry.nameEffectiveFromYear) || !Number.isSafeInteger(entry.acceptanceYear) || entry.nameEffectiveFromYear > entry.acceptanceYear) throw new Error("V5 naming years are invalid");
  if (entry.source === "LLM_NAMING_RESPONSE" && (!entry.sourceRequestId || !entry.sourceBatchId || !entry.sourceResponseAttemptId)) throw new Error("LLM naming provenance requires request, batch, and response attempt references");
  if ((entry.source === "CANONICAL_EXISTING" || entry.source === "OWNER_INPUT") && !entry.sourceAuthorityRef) throw new Error(`${entry.source} requires an authority reference`);
  if (entry.source === "AUTOMATIC_REUSE" && (!entry.sourceAuthorityRef || !entry.reusedFromEntityId || !entry.reusedFromLedgerEntryId)) throw new Error("AUTOMATIC_REUSE requires target authority and exact trusted source references");
  if (entry.source === "TEST_FIXTURE" && (runMode !== "TEST" || !entry.sourceAuthorityRef?.startsWith("TEST_ARTIFACT:"))) throw new Error("TEST_FIXTURE labels are confined to explicit temporary test artifacts");
  if (runMode !== "TEST" && entry.source === "TEST_FIXTURE") throw new Error("Non-test V5 runs reject TEST_FIXTURE labels");
}

export function assertLiteralAutomaticReuseV5(targetLabel: string, source: AcceptedLabelLedgerEntryV5, authorityRef: string | null): void {
  if (!authorityRef || source.source === "TEST_FIXTURE" || !source.label.trim() || targetLabel !== source.label) throw new Error("AUTOMATIC_REUSE must copy one trusted source label literally under explicit target-identity authority");
}
