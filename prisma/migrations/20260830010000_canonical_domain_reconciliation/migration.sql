-- Separate database infrastructure readiness from deterministic canonical
-- migration reconciliation. These records prove that already accepted source
-- authority was copied without unexplained changes; they are not owner-policy
-- approvals.

CREATE TABLE "CanonicalMigrationReconciliation" (
  "migrationId" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "sourceAuthorityRef" TEXT NOT NULL,
  "sourceManifestSha256" TEXT NOT NULL,
  "sourceContentSha256" TEXT NOT NULL,
  "importedContentSha256" TEXT NOT NULL,
  "stableIdentityCount" INTEGER NOT NULL,
  "sourceValueCount" INTEGER NOT NULL,
  "importedValueCount" INTEGER NOT NULL,
  "unexplainedDifferenceCount" INTEGER NOT NULL,
  "unexplainedDifferencePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanonicalMigrationReconciliation_pkey" PRIMARY KEY ("migrationId")
);

CREATE UNIQUE INDEX "CanonicalMigrationReconciliation_revisionId_key" ON "CanonicalMigrationReconciliation"("revisionId");
CREATE INDEX "CanonicalMigrationReconciliation_authorityId_status_idx" ON "CanonicalMigrationReconciliation"("authorityId", "status");
ALTER TABLE "CanonicalMigrationReconciliation" ADD CONSTRAINT "CanonicalMigrationReconciliation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CanonicalAuthorityRevision"("revisionId") ON DELETE RESTRICT ON UPDATE CASCADE;
