import type { PrismaClient } from "@prisma/client";
import { getDomainDatabase } from "./postgres-domain.js";
import { canonicalDomainReconciliationReadiness } from "./canonical-domain-reconciliation.js";
import { BREED_PRIMARY_DEITY_AUTHORITY_ID } from "./postgres-canonical.js";

export type CapabilityReadinessStatus = "READY" | "UNRESOLVED_AUTHORITY" | "PENDING_POLICY";

export interface CausalCapabilityReadiness {
  capabilityId: string;
  status: CapabilityReadinessStatus;
  detail: string;
  blockingScope: "NONE" | "FIRST_CAUSAL_CONSUMER_ONLY";
}

/**
 * Database health is deliberately absent from this result. These rows describe
 * causal/domain consumers after infrastructure preflight has independently
 * reached READY.
 */
export async function loadCausalCapabilityReadiness(database: PrismaClient = getDomainDatabase()): Promise<{
  canonicalDomainMigration: Awaited<ReturnType<typeof canonicalDomainReconciliationReadiness>>;
  capabilities: CausalCapabilityReadiness[];
}> {
  const canonicalDomainMigration = await canonicalDomainReconciliationReadiness(database);
  const [breedCatalog, atlasPois, breedDeityRevision, breedRows, deityRows, deityAudits, resourceAuthorities, resourceNodes, derogatoryRevision, pendingPolicies] = await Promise.all([
    database.canonicalMigrationReconciliation.findFirst({ where: { authorityId: "BREED_CATALOG_V5", status: "RECONCILED", unexplainedDifferenceCount: 0 } }),
    database.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "PointOfInterest"`),
    database.canonicalAuthorityRevision.findFirst({ where: { authorityId: BREED_PRIMARY_DEITY_AUTHORITY_ID, status: "APPROVED" }, select: { revisionId: true } }),
    database.breed.count({ where: { primaryDeityId: { not: null } } }),
    database.deity.count(),
    database.breedDeityDecisionAudit.count(),
    database.resourceAuthority.count({ where: { status: "READY" } }),
    database.resourceNode.count(),
    database.ownerPolicyRevision.findFirst({ where: { policyId: "DEROGATORY_TAXONOMY", status: "APPROVED" }, select: { revisionId: true } }),
    database.ownerPolicyRevision.count({ where: { status: "UNREVIEWED" } }),
  ]);
  const atlasPoiCount = Number(atlasPois[0]?.count ?? 0n);
  const breedDeityReady = Boolean(breedDeityRevision) && breedRows === 2_062 && deityAudits === 2_062 && deityRows > 0;
  const resourceReady = resourceAuthorities > 0 && resourceNodes > 0;
  return {
    canonicalDomainMigration,
    capabilities: [
      { capabilityId: "BREED_CATALOG", status: breedCatalog ? "READY" : "UNRESOLVED_AUTHORITY", detail: breedCatalog ? "2,062 stable-ID Breed identities are independently available" : "Breed catalog reconciliation is required", blockingScope: breedCatalog ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
      { capabilityId: "ATLAS", status: atlasPoiCount > 0 ? "READY" : "UNRESOLVED_AUTHORITY", detail: atlasPoiCount > 0 ? `${atlasPoiCount} shared canonical POIs are available` : "Shared canonical POI inventory is absent", blockingScope: atlasPoiCount > 0 ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
      { capabilityId: "BREED_PRIMARY_DEITY", status: breedDeityReady ? "READY" : "UNRESOLVED_AUTHORITY", detail: breedDeityReady ? "2,062 assignments and provenance rows are active" : `${breedRows}/2,062 assignments · ${deityAudits}/2,062 provenance · ${deityRows} Deities`, blockingScope: breedDeityReady ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
      { capabilityId: "RESOURCE_INVENTORY", status: resourceReady ? "READY" : "UNRESOLVED_AUTHORITY", detail: resourceReady ? `${resourceNodes} canonical Resource Nodes are active` : "Approved Resource inventory authority is not available", blockingScope: resourceReady ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
      { capabilityId: "DEROGATORY_TAXONOMY", status: derogatoryRevision ? "READY" : "UNRESOLVED_AUTHORITY", detail: derogatoryRevision ? `Approved revision ${derogatoryRevision.revisionId}` : "Canonical grouping structures remain unreconciled", blockingScope: derogatoryRevision ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
      { capabilityId: "OWNER_POLICY_REVISIONS", status: pendingPolicies === 0 ? "READY" : "PENDING_POLICY", detail: pendingPolicies === 0 ? "No pending candidate revisions" : `${pendingPolicies} candidate revisions; each blocks only its first causal consumer`, blockingScope: pendingPolicies === 0 ? "NONE" : "FIRST_CAUSAL_CONSUMER_ONLY" },
    ],
  };
}
