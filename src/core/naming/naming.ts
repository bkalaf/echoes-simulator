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
    "Cross-world reuse is allowed only when an eligible reuse source is supplied. Return only strict JSON matching eidolon-simulator-naming-response-v1.",
    canonicalJson(canonicalContext),
  ].join("\n\n");
  return { schemaVersion: "eidolon-simulator-naming-job-v1", namingJobId, context, items, promptText, promptSha256: digest(promptText) };
}

const decisionSchema = z.object({
  requestId: z.string().min(1), entityType: z.enum(["SETTLEMENT", "POI", "GOVERNMENT", "FAMILY"]), decision: z.enum(["NEW", "REUSE"]), name: z.string().trim().min(1).max(200),
  reuseSourceAcceptedNameId: z.string().min(1).nullable().optional(), pronunciation: z.string().max(300).nullable().optional(), rationale: z.string().max(1000).nullable().optional(),
  scopeDescription: z.string().max(2000).nullable().optional(), sizeDescription: z.string().max(1000).nullable().optional(), structureDescription: z.string().max(4000).nullable().optional(),
  roleLabel: z.string().max(300).nullable().optional(), dynastyName: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional(),
}).strict();
const responseSchema = z.object({ schemaVersion: z.literal("eidolon-simulator-naming-response-v1"), namingJobId: z.string(), decisions: z.array(decisionSchema) }).strict();

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
