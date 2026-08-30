import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import {
  initialOwnerPolicyCenterV56,
  lockedOwnerAuthorityByIdV56,
  type OwnerPolicyDefinitionV1,
  type OwnerPolicyLifecycleV1,
  type OwnerPolicyRevisionV1,
} from "../core/v5/owner-policy-center.js";
import { getDomainDatabase } from "./postgres-domain.js";

export type TypedValue = { valuePath: string; valueType: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "NULL"; textValue?: string; integerValue?: bigint | string; decimalValue?: string; booleanValue?: boolean };
export type OwnerPolicyDecisionAction = "APPROVE" | "REJECT" | "RESET" | "SUPERSEDE";
export interface OwnerPolicyDecisionContext { actorId: string; currentRunYear: number | null; actionProvenance: string }
export interface OwnerPolicyBulkDecisionInput { revisionIds: string[]; action: OwnerPolicyDecisionAction; reason?: string; effectiveFromYearOverride?: number }

function flatten(value: unknown, path = "$"): TypedValue[] {
  if (value === null || value === undefined) return [{ valuePath: path, valueType: "NULL" }];
  if (typeof value === "string") return [{ valuePath: path, valueType: "TEXT", textValue: value }];
  if (typeof value === "boolean") return [{ valuePath: path, valueType: "BOOLEAN", booleanValue: value }];
  if (typeof value === "bigint") return [{ valuePath: path, valueType: "INTEGER", integerValue: value }];
  if (typeof value === "number") return Number.isInteger(value) ? [{ valuePath: path, valueType: "INTEGER", integerValue: BigInt(value) }] : [{ valuePath: path, valueType: "DECIMAL", decimalValue: String(value) }];
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => flatten(item, `${path}.${key}`));
}

function definitionById(policyId: string): OwnerPolicyDefinitionV1 {
  const definition = initialOwnerPolicyCenterV56().find((candidate) => candidate.policyId === policyId);
  if (!definition) throw new Error(`Unknown Owner Policy definition ${policyId}`);
  return definition;
}

export function defaultOwnerPolicyEffectiveYear(lifecycle: OwnerPolicyLifecycleV1, currentRunYear: number | null): number {
  if (lifecycle.kind === "GENESIS") return 0;
  if (lifecycle.kind === "SCHEDULED_BARRIER" && (currentRunYear === null || currentRunYear < lifecycle.defaultYear)) return lifecycle.defaultYear;
  return Math.max(0, (currentRunYear ?? -1) + 1);
}

export async function bootstrapOwnerPolicyCenterV56(center: readonly OwnerPolicyRevisionV1[] = initialOwnerPolicyCenterV56()): Promise<{ definitions: number; lockedAuthorities: number; candidateRevisionsCreated: number }> {
  const database = getDomainDatabase();
  const lockedAuthorities = new Map(center.flatMap((definition) => definition.lockedAuthorityIds.map((authorityId) => {
    const authority = lockedOwnerAuthorityByIdV56(authorityId);
    return [authorityId, authority] as const;
  })));
  for (const authority of lockedAuthorities.values()) await database.lockedOwnerAuthority.upsert({ where: { authorityId: authority.authorityId }, create: { authorityId: authority.authorityId, domain: authority.domain, statement: authority.statement }, update: { domain: authority.domain, statement: authority.statement } });

  let candidateRevisionsCreated = 0;
  for (const definition of center) {
    const defaultEffectiveYear = definition.lifecycle.kind === "SCHEDULED_BARRIER" ? definition.lifecycle.defaultYear : definition.lifecycle.kind === "GENESIS" ? 0 : null;
    await database.ownerPolicyDefinition.upsert({
      where: { policyId: definition.policyId },
      create: {
        policyId: definition.policyId,
        title: definition.humanName,
        domain: definition.domain,
        description: definition.purpose,
        unit: definition.units,
        reviewAuthority: definition.reviewAuthority,
        lifecycleKind: definition.lifecycle.kind,
        defaultEffectiveYear,
        consumerLinks: { create: definition.causalConsumers.map((consumerId) => ({ consumerId, causal: true })) },
        lockedAuthorityLinks: { create: definition.lockedAuthorityIds.map((authorityId) => ({ authorityId })) },
      },
      update: { title: definition.humanName, domain: definition.domain, description: definition.purpose, unit: definition.units, reviewAuthority: definition.reviewAuthority, lifecycleKind: definition.lifecycle.kind, defaultEffectiveYear },
    });
    await database.ownerPolicyConsumer.deleteMany({ where: { policyId: definition.policyId, consumerId: { notIn: [...definition.causalConsumers] } } });
    for (const consumerId of definition.causalConsumers) await database.ownerPolicyConsumer.upsert({ where: { policyId_consumerId: { policyId: definition.policyId, consumerId } }, create: { policyId: definition.policyId, consumerId, causal: true }, update: { causal: true } });
    await database.ownerPolicyLockedAuthorityLink.deleteMany({ where: { policyId: definition.policyId, authorityId: { notIn: [...definition.lockedAuthorityIds] } } });
    for (const authorityId of definition.lockedAuthorityIds) await database.ownerPolicyLockedAuthorityLink.upsert({ where: { policyId_authorityId: { policyId: definition.policyId, authorityId } }, create: { policyId: definition.policyId, authorityId }, update: {} });

    const contentSha256 = createHash("sha256").update(canonicalJson(definition.candidateContent)).digest("hex");
    const existing = await database.ownerPolicyRevision.findFirst({ where: { policyId: definition.policyId, contentSha256 } });
    if (existing) continue;
    const latest = await database.ownerPolicyRevision.findFirst({ where: { policyId: definition.policyId }, orderBy: { revisionNumber: "desc" } });
    const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
    const revisionId = `${definition.policyId}_R${revisionNumber}_${contentSha256.slice(0, 12)}`;
    await database.ownerPolicyRevision.create({ data: { revisionId, policyId: definition.policyId, revisionNumber, status: "UNREVIEWED", contentSha256, provenanceRef: `IMPLEMENTATION_CANDIDATE:${definition.candidateRationale}`, createdBy: "SYSTEM_CANDIDATE", priorRevisionId: latest?.revisionId ?? null, values: { create: flatten(definition.candidateContent).map((value) => ({ ...value, integerValue: value.integerValue === undefined ? undefined : BigInt(value.integerValue) })) } } });
    candidateRevisionsCreated += 1;
  }
  return { definitions: center.length, lockedAuthorities: lockedAuthorities.size, candidateRevisionsCreated };
}

export async function listOwnerPolicyCenter(): Promise<unknown[]> {
  const rows = await getDomainDatabase().ownerPolicyDefinition.findMany({ include: { consumerLinks: { orderBy: { consumerId: "asc" } }, lockedAuthorityLinks: { include: { authority: true }, orderBy: { authorityId: "asc" } }, revisions: { include: { values: { orderBy: { valuePath: "asc" } }, approvals: { orderBy: { createdAt: "desc" } } }, orderBy: { revisionNumber: "desc" } } }, orderBy: { policyId: "asc" } });
  return rows.map((definition) => ({
    ...definition,
    reviewSection: definition.revisions[0]?.status === "APPROVED" ? "APPROVED_POLICY_REVISION" : definition.revisions[0]?.status === "REJECTED" || definition.revisions[0]?.status === "SUPERSEDED" ? "REJECTED_OR_SUPERSEDED" : definition.reviewAuthority === "SEMANTIC" ? "PENDING_SEMANTIC_AUTHORITY" : "PENDING_NUMERIC_AUTHORITY",
    lockedOwnerAuthorities: definition.lockedAuthorityLinks.map((link) => link.authority),
    lockedAuthorityLinks: undefined,
    minimumValue: definition.minimumValue?.toString() ?? null,
    maximumValue: definition.maximumValue?.toString() ?? null,
    revisions: definition.revisions.map((revision) => ({ ...revision, createdAt: revision.createdAt.toISOString(), values: revision.values.map((value) => ({ ...value, integerValue: value.integerValue?.toString() ?? null, decimalValue: value.decimalValue?.toString() ?? null })), approvals: revision.approvals.map((approval) => ({ ...approval, createdAt: approval.createdAt.toISOString() })) })),
  }));
}

export async function decideOwnerPolicyRevisions(input: OwnerPolicyBulkDecisionInput, context: OwnerPolicyDecisionContext): Promise<{ decisions: { revisionId: string; status: string; effectiveFromYear: number | null }[] }> {
  const revisionIds = [...new Set(input.revisionIds.map((value) => value.trim()).filter(Boolean))];
  if (revisionIds.length === 0) throw new Error("Select at least one policy revision");
  if (!context.actorId.trim() || !context.actionProvenance.trim()) throw new Error("Current owner/session approval context is unavailable");
  if (input.effectiveFromYearOverride !== undefined && (!Number.isInteger(input.effectiveFromYearOverride) || input.effectiveFromYearOverride < 0)) throw new Error("Effective-year override must be a non-negative integer");
  const database = getDomainDatabase();
  return database.$transaction(async (transaction) => {
    const revisions = await transaction.ownerPolicyRevision.findMany({ where: { revisionId: { in: revisionIds } }, include: { values: true } });
    if (revisions.length !== revisionIds.length) throw new Error("One or more selected policy revisions no longer exist; reload before deciding");
    const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
    const decisions: { revisionId: string; status: string; effectiveFromYear: number | null }[] = [];
    for (const revisionId of revisionIds) {
      const revision = byId.get(revisionId)!;
      if (input.action !== "RESET" && revision.status !== "UNREVIEWED") throw new Error(`Only UNREVIEWED revisions may be ${input.action.toLowerCase()}d: ${revisionId}`);
      if (input.action === "RESET") {
        const latest = await transaction.ownerPolicyRevision.findFirst({ where: { policyId: revision.policyId }, orderBy: { revisionNumber: "desc" } });
        const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
        const newRevisionId = `${revision.policyId}_R${revisionNumber}_${revision.contentSha256.slice(0, 12)}`;
        await transaction.ownerPolicyRevision.create({ data: { revisionId: newRevisionId, policyId: revision.policyId, revisionNumber, status: "UNREVIEWED", contentSha256: revision.contentSha256, provenanceRef: `${context.actionProvenance}:RESET_FROM:${revision.revisionId}`, createdBy: context.actorId, priorRevisionId: revision.revisionId, values: { create: revision.values.map(({ valuePath, valueType, textValue, integerValue, decimalValue, booleanValue }) => ({ valuePath, valueType, textValue, integerValue, decimalValue, booleanValue })) } } });
        await transaction.ownerPolicyApproval.create({ data: { approvalId: decisionId(revision.revisionId, input.action, context.actorId), revisionId: revision.revisionId, action: input.action, actorId: context.actorId, exactHash: revision.contentSha256, reason: input.reason ?? context.actionProvenance } });
        decisions.push({ revisionId: newRevisionId, status: "UNREVIEWED", effectiveFromYear: null });
        continue;
      }
      const status = input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : "SUPERSEDED";
      const definition = definitionById(revision.policyId);
      const effectiveFromYear = status === "APPROVED" ? input.effectiveFromYearOverride ?? defaultOwnerPolicyEffectiveYear(definition.lifecycle, context.currentRunYear) : revision.effectiveFromYear;
      if (status === "APPROVED") await transaction.ownerPolicyRevision.updateMany({ where: { policyId: revision.policyId, status: "APPROVED", revisionId: { not: revision.revisionId } }, data: { status: "SUPERSEDED", effectiveToYear: effectiveFromYear } });
      await transaction.ownerPolicyRevision.update({ where: { revisionId }, data: { status, effectiveFromYear } });
      await transaction.ownerPolicyApproval.create({ data: { approvalId: decisionId(revision.revisionId, input.action, context.actorId), revisionId: revision.revisionId, action: input.action, actorId: context.actorId, exactHash: revision.contentSha256, reason: input.reason ?? context.actionProvenance } });
      decisions.push({ revisionId, status, effectiveFromYear });
    }
    return { decisions };
  });
}

function decisionId(revisionId: string, action: string, actorId: string): string {
  return `POLICY_DECISION_${createHash("sha256").update(`${revisionId}\0${action}\0${actorId}\0${Date.now()}\0${randomUUID()}`).digest("hex")}`;
}

export async function createOwnerPolicyCandidateRevision(input: { policyId: string; values: TypedValue[] }, context: Pick<OwnerPolicyDecisionContext, "actorId" | "actionProvenance">): Promise<{ revisionId: string; contentSha256: string }> {
  if (!context.actorId.trim() || !context.actionProvenance.trim() || input.values.length === 0) throw new Error("Policy editing requires current owner/session context and at least one typed value");
  definitionById(input.policyId);
  const values = [...input.values].sort((left, right) => left.valuePath.localeCompare(right.valuePath));
  if (new Set(values.map((value) => value.valuePath)).size !== values.length) throw new Error("Policy value paths must be unique");
  const normalized = values.map((value) => ({ valuePath: value.valuePath, valueType: value.valueType, textValue: value.textValue ?? null, integerValue: value.integerValue === undefined ? null : String(value.integerValue), decimalValue: value.decimalValue ?? null, booleanValue: value.booleanValue ?? null }));
  const contentSha256 = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  const database = getDomainDatabase();
  const latest = await database.ownerPolicyRevision.findFirst({ where: { policyId: input.policyId }, orderBy: { revisionNumber: "desc" } });
  const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
  const revisionId = `${input.policyId}_R${revisionNumber}_${contentSha256.slice(0, 12)}`;
  await database.ownerPolicyRevision.create({ data: { revisionId, policyId: input.policyId, revisionNumber, status: "UNREVIEWED", contentSha256, provenanceRef: `${context.actionProvenance}:EDIT`, createdBy: context.actorId, priorRevisionId: latest?.revisionId ?? null, values: { create: normalized.map((value) => ({ ...value, integerValue: value.integerValue === null ? null : BigInt(value.integerValue) })) } } });
  return { revisionId, contentSha256 };
}
