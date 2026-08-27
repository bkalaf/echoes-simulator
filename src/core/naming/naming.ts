import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { WorldKey } from "../contracts/domain.js";

type EntityType = "SETTLEMENT" | "POI" | "GOVERNMENT" | "FAMILY";
export interface NamingContext {
  runId: string;
  world: WorldKey;
  year: number;
  reason: string;
  settlement: { settlementId: string; siteId: string; currentName: string | null; nameSource: "OWNER_INPUT" | "WORKING" | "UNNAMED"; dominantFaction: string | null; cultureId: string | null; cultureState?: "CALCULATED" | "NO_HUMAN_FOUNDING_CULTURE"; politicalForm: string | null; economicForm: string | null; dominantBreed: string | null; population: string };
  unnamedPois: { poiId: string; workingLabel: string; poiType: string }[];
}
export interface NamingItem { requestId: string; entityType: EntityType; entityId: string; required: true; context: unknown; }
export interface NamingJob { schemaVersion: "eidolon-simulator-naming-job-v1"; namingJobId: string; context: NamingContext; items: NamingItem[]; promptText: string; promptSha256: string; }
export interface NamingBatch {
  schemaVersion: "eidolon-simulator-naming-batch-v1";
  namingBatchId: string;
  runId: string;
  world: WorldKey;
  year: number;
  jobs: NamingJob[];
  promptText: string;
  promptSha256: string;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const stableId = (prefix: string, value: unknown) => `${prefix}_${digest(canonicalJson(value)).slice(0, 24)}`;

export function buildNamingJob(context: NamingContext): NamingJob {
  if (!context.settlement.dominantFaction || !context.settlement.politicalForm || !context.settlement.economicForm || !context.settlement.dominantBreed) throw new Error("Naming context requires calculated faction, forms, and dominant Breed");
  if (!context.settlement.cultureId && context.settlement.cultureState !== "NO_HUMAN_FOUNDING_CULTURE") throw new Error("Naming context requires calculated Culture or explicit NO_HUMAN_FOUNDING_CULTURE");
  const base = { runId: context.runId, world: context.world, year: context.year, reason: context.reason, settlementId: context.settlement.settlementId };
  const items: NamingItem[] = [];
  if (context.settlement.nameSource !== "OWNER_INPUT") items.push({ requestId: stableId("REQ", { ...base, type: "SETTLEMENT" }), entityType: "SETTLEMENT", entityId: context.settlement.settlementId, required: true, context: context.settlement });
  for (const poi of [...context.unnamedPois].sort((a, b) => a.poiId.localeCompare(b.poiId))) items.push({ requestId: stableId("REQ", { ...base, type: "POI", id: poi.poiId }), entityType: "POI", entityId: poi.poiId, required: true, context: poi });
  items.push({ requestId: stableId("REQ", { ...base, type: "GOVERNMENT" }), entityType: "GOVERNMENT", entityId: `${context.settlement.settlementId}:GOV:${context.year}`, required: true, context: { dominantFaction: context.settlement.dominantFaction, politicalForm: context.settlement.politicalForm, economicForm: context.settlement.economicForm, dominantBreed: context.settlement.dominantBreed, cultureId: context.settlement.cultureId, cultureState: context.settlement.cultureState } });
  items.push({ requestId: stableId("REQ", { ...base, type: "FAMILY" }), entityType: "FAMILY", entityId: `${context.settlement.settlementId}:FAMILY:${context.year}`, required: true, context: { role: "GOVERNING_FAMILY" } });
  const namingJobId = stableId("NAMING_JOB", { ...base, items: items.map((item) => item.requestId) });
  const canonicalContext = { schemaVersion: "eidolon-simulator-naming-prompt-v1", namingJobId, immutableFacts: context, requests: items };
  const promptText = [
    "You are naming entities for an already-determined Echoes of Eidolon simulation state.",
    "Do not change, infer, or propose alternate history. Use only supplied eligible context.",
    "Use every exact requestId once. Do not invent IDs or omit requests. WORKING labels are replaceable context; OWNER_INPUT names cannot be changed.",
    "Settlement and governing-family names are independent. The family name may differ from the settlement name; do not default to 'House of <settlement>' merely because both are requested together. Shared naming remains allowed when intentionally chosen.",
    "Cross-world reuse is allowed only when an eligible reuse source is supplied. Return only strict JSON matching eidolon-simulator-naming-response-v1.",
    canonicalJson(canonicalContext),
  ].join("\n\n");
  return { schemaVersion: "eidolon-simulator-naming-job-v1", namingJobId, context, items, promptText, promptSha256: digest(promptText) };
}

const worldOrder: Record<WorldKey, number> = { CONCORD: 0, SCHISM: 1, RUIN: 2 };

export function buildNamingBatches(inputJobs: readonly NamingJob[]): NamingBatch[] {
  const groups = new Map<string, NamingJob[]>();
  for (const job of inputJobs) {
    const key = canonicalJson({ runId: job.context.runId, world: job.context.world, year: job.context.year });
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()].map((group): NamingBatch => {
    const jobs = [...group].sort((left, right) => left.namingJobId.localeCompare(right.namingJobId));
    const first = jobs[0]!;
    const batchIdentity = { runId: first.context.runId, world: first.context.world, year: first.context.year, namingJobIds: jobs.map((job) => job.namingJobId) };
    const namingBatchId = stableId("NAMING_BATCH", batchIdentity);
    const responseTemplate = {
      schemaVersion: "eidolon-simulator-naming-batch-response-v1",
      namingBatchId,
      jobs: jobs.map((job) => ({
        namingJobId: job.namingJobId,
        decisions: job.items.map((item) => ({
          requestId: item.requestId,
          entityType: item.entityType,
          decision: "NEW",
          name: "",
          ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "", sizeDescription: "", structureDescription: "" } : {}),
          ...(item.entityType === "FAMILY" ? { roleLabel: "GOVERNING_FAMILY" } : {}),
        })),
      })),
    };
    const batchContext = {
      schemaVersion: "eidolon-simulator-naming-batch-prompt-v1",
      ...batchIdentity,
      namingBatchId,
      jobs: jobs.map((job) => ({ namingJobId: job.namingJobId, immutableFacts: job.context, requests: job.items })),
      responseTemplate,
    };
    const promptText = [
      `You are naming every pending entity for ${first.context.world} in year ${first.context.year} as one deterministic batch.`,
      "Do not change, infer, or propose alternate history. Use only supplied eligible context.",
      "Use every exact namingJobId and requestId once. Do not invent IDs, omit jobs, or omit requests.",
      "Settlement and governing-family names are independent. The family name may differ from the settlement name; do not default to 'House of <settlement>' merely because both are requested together. Shared naming remains allowed when intentionally chosen.",
      "Every decision requires requestId, entityType, decision, and name. GOVERNMENT decisions also require scopeDescription, sizeDescription, and structureDescription. FAMILY decisions require roleLabel.",
      "Fill every empty string in the responseTemplate. Return only strict JSON matching eidolon-simulator-naming-batch-response-v1, with top-level schemaVersion, namingBatchId, and jobs. Do not return a results key.",
      canonicalJson(batchContext),
    ].join("\n\n");
    return { schemaVersion: "eidolon-simulator-naming-batch-v1", namingBatchId, runId: first.context.runId, world: first.context.world, year: first.context.year, jobs, promptText, promptSha256: digest(promptText) };
  }).sort((left, right) => left.year - right.year || worldOrder[left.world] - worldOrder[right.world] || left.namingBatchId.localeCompare(right.namingBatchId));
}

const decisionSchema = z.object({
  requestId: z.string().min(1), entityType: z.enum(["SETTLEMENT", "POI", "GOVERNMENT", "FAMILY"]), decision: z.enum(["NEW", "REUSE"]), name: z.string().trim().min(1).max(200),
  reuseSourceAcceptedNameId: z.string().min(1).nullable().optional(), pronunciation: z.string().max(300).nullable().optional(), rationale: z.string().max(1000).nullable().optional(),
  scopeDescription: z.string().max(2000).nullable().optional(), sizeDescription: z.string().max(1000).nullable().optional(), structureDescription: z.string().max(4000).nullable().optional(),
  roleLabel: z.string().max(300).nullable().optional(), dynastyName: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
}).strict();
const responseSchema = z.object({ schemaVersion: z.literal("eidolon-simulator-naming-response-v1"), namingJobId: z.string(), decisions: z.array(decisionSchema) }).strict();
const batchResponseSchema = z.object({
  schemaVersion: z.literal("eidolon-simulator-naming-batch-response-v1"),
  namingBatchId: z.string().min(1),
  jobs: z.array(z.object({ namingJobId: z.string().min(1), decisions: z.array(decisionSchema) }).strict()).min(1),
}).strict();

export function validateNamingResponse(job: NamingJob, response: unknown, eligibleReuseIds: ReadonlySet<string> = new Set()): { accepted: boolean; errors: string[]; decisions?: z.infer<typeof decisionSchema>[] } {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) return { accepted: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  const errors: string[] = [];
  if (parsed.data.namingJobId !== job.namingJobId) errors.push("namingJobId does not match pending job");
  const requested = new Map(job.items.map((item) => [item.requestId, item]));
  const seen = new Set<string>();
  for (const decision of parsed.data.decisions) {
    if (seen.has(decision.requestId)) errors.push(`Duplicate requestId ${decision.requestId}`);
    seen.add(decision.requestId);
    const item = requested.get(decision.requestId);
    if (!item) errors.push(`Unexpected requestId ${decision.requestId}`);
    else if (item.entityType !== decision.entityType) errors.push(`Entity type mismatch for ${decision.requestId}`);
    if (decision.decision === "REUSE" && (!decision.reuseSourceAcceptedNameId || !eligibleReuseIds.has(decision.reuseSourceAcceptedNameId))) errors.push(`Invalid reuse source for ${decision.requestId}`);
    if (decision.entityType === "GOVERNMENT" && (!decision.scopeDescription || !decision.sizeDescription || !decision.structureDescription)) errors.push(`Government setup fields missing for ${decision.requestId}`);
    if (decision.entityType === "FAMILY" && !decision.roleLabel) errors.push(`Family role missing for ${decision.requestId}`);
  }
  for (const requestId of requested.keys()) if (!seen.has(requestId)) errors.push(`Missing requestId ${requestId}`);
  return errors.length ? { accepted: false, errors } : { accepted: true, errors: [], decisions: parsed.data.decisions };
}

export function validateNamingBatchResponse(batch: NamingBatch, response: unknown, eligibleReuseIds: ReadonlySet<string> = new Set()): { accepted: boolean; errors: string[]; responses?: { namingJobId: string; decisions: z.infer<typeof decisionSchema>[] }[] } {
  const parsed = batchResponseSchema.safeParse(response);
  if (!parsed.success) return { accepted: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  const errors: string[] = [];
  if (parsed.data.namingBatchId !== batch.namingBatchId) errors.push("namingBatchId does not match the pending world/year batch");
  const requestedJobs = new Map(batch.jobs.map((job) => [job.namingJobId, job]));
  const seen = new Set<string>();
  const responses: { namingJobId: string; decisions: z.infer<typeof decisionSchema>[] }[] = [];
  for (const submittedJob of parsed.data.jobs) {
    if (seen.has(submittedJob.namingJobId)) errors.push(`Duplicate namingJobId ${submittedJob.namingJobId}`);
    seen.add(submittedJob.namingJobId);
    const job = requestedJobs.get(submittedJob.namingJobId);
    if (!job) {
      errors.push(`Unexpected namingJobId ${submittedJob.namingJobId}`);
      continue;
    }
    const validated = validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: submittedJob.namingJobId, decisions: submittedJob.decisions }, eligibleReuseIds);
    if (!validated.accepted || !validated.decisions) errors.push(...validated.errors.map((error) => `${submittedJob.namingJobId}: ${error}`));
    else responses.push({ namingJobId: submittedJob.namingJobId, decisions: validated.decisions });
  }
  for (const namingJobId of requestedJobs.keys()) if (!seen.has(namingJobId)) errors.push(`Missing namingJobId ${namingJobId}`);
  return errors.length ? { accepted: false, errors } : { accepted: true, errors: [], responses };
}
