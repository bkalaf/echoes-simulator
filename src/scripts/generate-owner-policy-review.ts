import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { initialOwnerPolicyCenterV56, LOCKED_OWNER_AUTHORITIES_V56, type OwnerPolicyRevisionV1 } from "../core/v5/owner-policy-center.js";

const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
const policies = initialOwnerPolicyCenterV56();
const semanticPolicies = policies.filter((policy) => policy.reviewAuthority === "SEMANTIC");
const numericPolicies = policies.filter((policy) => policy.reviewAuthority === "NUMERIC");
const pretty = (value: unknown): string => JSON.stringify(value, (_key, child) => typeof child === "bigint" ? child.toString() : child, 2);
const write = (name: string, content: string): void => writeFileSync(resolve(outputDirectory, name), `${content.trim()}\n`, "utf8");

const review = {
  schemaVersion: "echoes-owner-policy-review-v56",
  status: "OWNER_REVIEW_REQUIRED",
  mechanicsVersion: "echoes-mechanics-v5.6.0",
  schedulerVersion: "echoes-scheduler-v5.6.0",
  readModelVersion: "echoes-read-model-v1.4.0",
  causalDerivationVersion: "echoes-derived-metrics-v1.1.0",
  policyCount: policies.length,
  lockedOwnerStructureCount: LOCKED_OWNER_AUTHORITIES_V56.length,
  lockedOwnerStructure: LOCKED_OWNER_AUTHORITIES_V56.map((authority) => ({ ...authority, status: "LOCKED_OWNER_AUTHORITY" })),
  pendingSemanticAuthorityCount: semanticPolicies.length,
  pendingNumericAuthorityCount: numericPolicies.length,
  pendingSemanticAuthority: semanticPolicies,
  pendingNumericAuthority: numericPolicies,
  approvedPolicyRevision: [],
  rejectedOrSuperseded: [],
  approvalMetadata: {
    automatic: ["authenticated/current owner identity", "approval timestamp", "revision ID", "generated canonical content hash", "prior revision", "approval action provenance"],
    effectiveBoundaryDefaults: { GENESIS: "year 0 / next new run", SCHEDULED_BARRIER: "appropriate designed barrier", ATOMIC_YEAR_BARRIER: "next permitted atomic-year barrier" },
    manualEffectiveYearRequiredOnlyForExplicitOverride: true,
  },
  bulkApproval: { supported: true, separateImmutableApprovalPerRevision: true, separateCanonicalHashPerRevision: true },
  noCandidateNumericValueApprovedByThisCorrection: true,
};

function policyMarkdown(policy: OwnerPolicyRevisionV1): string {
  return `### ${policy.policyId}\n\n- Purpose: ${policy.purpose}\n- Units/range: ${policy.units}; ${policy.allowedRange}\n- Consumers: ${policy.causalConsumers.join(", ")}\n- Locked structure shown with this row: ${policy.lockedAuthorityIds.length ? policy.lockedAuthorityIds.join(", ") : "none"}\n- Candidate values:\n\n\`\`\`json\n${pretty(policy.candidateContent)}\n\`\`\`\n\n- Significance: ${policy.candidateRationale}\n- If unapproved: the simulator fails closed only when a causal consumer first requires this revision.\n- Exact UI action: Owner Policy Center → ${policy.policyId} → review → EDIT AS NEW REVISION if needed → APPROVE. Owner/session, timestamp, revision, hash, prior revision, provenance, and lifecycle-default boundary are automatic; enter a year only for an explicit override.\n`;
}

write("owner-policy-review.json", pretty(review));
write("owner-policy-review.md", `# Owner Policy Review\n\nLocked structure is context, not a request for reapproval. The ${policies.length} unresolved revisions below remain candidates; this artifact approves none of them. Independent candidates support multi-select approval while retaining a separate immutable approval and hash for every revision.\n\n## LOCKED OWNER STRUCTURE\n\n${LOCKED_OWNER_AUTHORITIES_V56.map((authority) => `- **${authority.authorityId}** [LOCKED_OWNER_AUTHORITY] — ${authority.statement}`).join("\n")}\n\n## PENDING SEMANTIC AUTHORITY\n\n${semanticPolicies.map(policyMarkdown).join("\n")}\n\n## PENDING NUMERIC AUTHORITY\n\n${numericPolicies.map(policyMarkdown).join("\n")}\n\n## APPROVED POLICY REVISION\n\nNone are asserted by this regenerated candidate artifact. Runtime approvals, when present, are read from immutable PostgreSQL revisions.\n\n## REJECTED / SUPERSEDED\n\nNone are asserted by this regenerated candidate artifact. Runtime rejected and superseded revisions remain visible in history.\n`);

process.stdout.write(`${JSON.stringify({ status: "OWNER_POLICY_REVIEW_REGENERATED", policyCount: policies.length, lockedOwnerStructureCount: LOCKED_OWNER_AUTHORITIES_V56.length, pendingSemanticAuthorityCount: semanticPolicies.length, pendingNumericAuthorityCount: numericPolicies.length, contentSha256: canonicalJson(review).length > 0 ? "GENERATED_IN_ARTIFACT" : "INVALID" }, null, 2)}\n`);
