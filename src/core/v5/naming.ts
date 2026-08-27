import type { NamingBehavior, NamingRequestV5 } from "./types.js";

export const DEFAULT_NAMING_BEHAVIOR_V5: Readonly<Record<string, NamingBehavior>> = {
  CANONICAL_SETTLEMENT: "AUTOMATIC_REUSE", EMERGENT_SETTLEMENT: "BLOCKING", EMERGENT_STATE: "BLOCKING", FAMILY: "BATCHED", ORGANIZATION: "BATCHED",
  SIGNIFICANT_POLITICAL_PERSON: "BATCHED", ROUTINE_OFFICEHOLDER: "AUTOMATIC_REUSE", CANONICAL_OFFICE: "AUTOMATIC_REUSE", CANONICAL_INSTITUTION: "AUTOMATIC_REUSE",
  EMERGENT_INSTITUTION: "BATCHED", CONFLICT: "NO_NAME_REQUIRED",
  PHYSICAL_POI: "BATCHED", WORLD_ROUTE: "BATCHED", PORTAL_LINK: "NO_NAME_REQUIRED",
};

export interface NamingBatchV5 { behavior: "BLOCKING" | "BATCHED"; items: NamingRequestV5[]; }
export function buildNamingBatches(requests: readonly NamingRequestV5[], maximumBatchSize = 100): NamingBatchV5[] {
  if (!Number.isSafeInteger(maximumBatchSize) || maximumBatchSize <= 0) throw new Error("Naming batch size must be positive");
  const pending = requests.filter((request) => !request.acceptedLabel && (request.behavior === "BLOCKING" || request.behavior === "BATCHED")).sort((a, b) => a.behavior.localeCompare(b.behavior) || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));
  const batches: NamingBatchV5[] = [];
  const blocking = pending.filter((request) => request.behavior === "BLOCKING");
  if (blocking.length > 0) batches.push({ behavior: "BLOCKING", items: blocking });
  const batched = pending.filter((request) => request.behavior === "BATCHED");
  for (let offset = 0; offset < batched.length; offset += maximumBatchSize) batches.push({ behavior: "BATCHED", items: batched.slice(offset, offset + maximumBatchSize) });
  return batches;
}

export function applyAcceptedLabels(requests: readonly NamingRequestV5[], labels: Readonly<Record<string, string>>): NamingRequestV5[] { return requests.map((request) => labels[request.entityId]?.trim() ? { ...request, acceptedLabel: labels[request.entityId]!.trim() } : request); }

export interface PersistedNamingBatchV5 extends NamingBatchV5 {
  schemaVersion: "echoes-v5-naming-batch-v1";
  batchId: string;
  runId: string;
  year: number;
  promptText: string;
}

export interface NamingBatchResponseV5 {
  schemaVersion: "echoes-v5-naming-batch-response-v1";
  batchId: string;
  runId: string;
  decisions: readonly { requestId: string; entityType: string; entityId: string; label: string }[];
}

export function buildPersistedNamingBatchesV5(runId: string, requests: readonly NamingRequestV5[], maximumBatchSize = 100): PersistedNamingBatchV5[] {
  return buildNamingBatches(requests, maximumBatchSize).map((batch, index) => {
    const year = Math.max(...batch.items.map((request) => request.createdYear));
    const batchId = `V5_NAMING_${runId}_${batch.behavior}_${year}_${index}`;
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v1", batchId, runId, decisions: batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: "REPLACE_WITH_ACCEPTED_LABEL" })) };
    const contexts = batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, context: request.context ?? null }));
    return { schemaVersion: "echoes-v5-naming-batch-v1", batchId, runId, year, behavior: batch.behavior, items: batch.items, promptText: `Provide one non-empty label for every stable ID. Labels are non-causal. Naming context:\n${JSON.stringify(contexts, null, 2)}\nSubmit this exact JSON shape:\n${JSON.stringify(response, null, 2)}` };
  });
}

export function buildBlockingNamingBatchV5(runId: string, requests: readonly NamingRequestV5[]): PersistedNamingBatchV5 | null {
  return buildPersistedNamingBatchesV5(runId, requests).find((batch) => batch.behavior === "BLOCKING") ?? null;
}

export function validateNamingBatchResponseV5(batch: PersistedNamingBatchV5, candidate: unknown): { accepted: boolean; errors: string[]; labels?: Record<string, string>; decisions?: NamingBatchResponseV5["decisions"] } {
  if (!candidate || typeof candidate !== "object") return { accepted: false, errors: ["V5 naming response must be an object"] };
  const row = candidate as Partial<NamingBatchResponseV5>;
  const errors: string[] = [];
  if (row.schemaVersion !== "echoes-v5-naming-batch-response-v1") errors.push("schemaVersion must be echoes-v5-naming-batch-response-v1");
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
    if (typeof decision.label !== "string" || !decision.label.trim()) { errors.push(`empty label for ${decision.requestId}`); continue; }
    labels[decision.entityId] = decision.label.trim();
  }
  return errors.length > 0 ? { accepted: false, errors } : { accepted: true, errors: [], labels, decisions: row.decisions };
}
