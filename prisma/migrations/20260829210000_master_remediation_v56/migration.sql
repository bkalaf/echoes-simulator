-- CreateEnum
CREATE TYPE "AuthorityRevisionStatus" AS ENUM ('UNREVIEWED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProjectionFreshnessStatus" AS ENUM ('CURRENT', 'STALE', 'CATCHING_UP', 'FAILED');

-- CreateEnum
CREATE TYPE "ResourceAuthorityStatus" AS ENUM ('RESOURCE_AUTHORITY_REQUIRED', 'READY');

-- CreateEnum
CREATE TYPE "PolicyValueType" AS ENUM ('TEXT', 'INTEGER', 'BIGINT', 'DECIMAL', 'BOOLEAN', 'NULL', 'OBJECT', 'ARRAY');

-- CreateTable
CREATE TABLE "Deity" (
    "deityId" TEXT NOT NULL,
    "acceptedName" TEXT NOT NULL,
    "pantheonId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Deity_pkey" PRIMARY KEY ("deityId")
);

-- Extend the existing shared Echoes Breed authority. The column remains
-- nullable until the audited 2,062/2,062 stable-ID reconstruction is complete;
-- a later validation migration must enforce NOT NULL after that terminal gate.
ALTER TABLE "Breed" ADD COLUMN "primaryDeityId" TEXT;

-- CreateTable
CREATE TABLE "BreedDeityDecisionAudit" (
    "decisionId" TEXT NOT NULL,
    "breedId" TEXT NOT NULL,
    "deityId" TEXT NOT NULL,
    "authorityRevisionId" TEXT NOT NULL,
    "externalProvider" TEXT NOT NULL,
    "externalModel" TEXT NOT NULL,
    "requestSha256" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "sourceEvidenceSha256" TEXT NOT NULL,
    "acceptedBy" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreedDeityDecisionAudit_pkey" PRIMARY KEY ("decisionId")
);

CREATE TABLE "BreedFoodSpecific" (
    "breedId" TEXT NOT NULL,
    "foodSpecificId" TEXT NOT NULL,
    "sourceRevisionId" TEXT NOT NULL,
    CONSTRAINT "BreedFoodSpecific_pkey" PRIMARY KEY ("breedId", "foodSpecificId")
);
CREATE INDEX "BreedFoodSpecific_foodSpecificId_idx" ON "BreedFoodSpecific"("foodSpecificId");
ALTER TABLE "BreedFoodSpecific" ADD CONSTRAINT "BreedFoodSpecific_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "Breed"("breedId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CanonicalAuthorityRevision" (
    "revisionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "status" "AuthorityRevisionStatus" NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFromYear" INTEGER,
    "effectiveToYear" INTEGER,
    "provenanceRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalAuthorityRevision_pkey" PRIMARY KEY ("revisionId")
);

-- Typed canonical content; no JSON/JSONB authority bag or filesystem fallback.
CREATE TABLE "CanonicalAuthorityValue" (
    "revisionId" TEXT NOT NULL,
    "valuePath" TEXT NOT NULL,
    "valueType" "PolicyValueType" NOT NULL,
    "textValue" TEXT,
    "integerValue" BIGINT,
    "decimalValue" DECIMAL(30,12),
    "booleanValue" BOOLEAN,
    CONSTRAINT "CanonicalAuthorityValue_pkey" PRIMARY KEY ("revisionId", "valuePath")
);
ALTER TABLE "CanonicalAuthorityValue" ADD CONSTRAINT "CanonicalAuthorityValue_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CanonicalAuthorityRevision"("revisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "RunAuthoritySnapshot" (
    "snapshotId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "snapshotSha256" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunAuthoritySnapshot_pkey" PRIMARY KEY ("snapshotId")
);

-- CreateTable
CREATE TABLE "RunAuthorityEpoch" (
    "epochId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "barrierEventId" TEXT,
    "priorEpochId" TEXT,
    "epochSha256" TEXT NOT NULL,

    CONSTRAINT "RunAuthorityEpoch_pkey" PRIMARY KEY ("epochId")
);

-- CreateTable
CREATE TABLE "RunAuthoritySnapshotEntry" (
    "entryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "authorityRevisionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,

    CONSTRAINT "RunAuthoritySnapshotEntry_pkey" PRIMARY KEY ("entryId")
);

-- CreateTable
CREATE TABLE "RunAuthorityValue" (
    "entryId" TEXT NOT NULL,
    "valuePath" TEXT NOT NULL,
    "valueType" "PolicyValueType" NOT NULL,
    "ordinal" INTEGER,
    "textValue" TEXT,
    "integerValue" BIGINT,
    "decimalValue" DECIMAL(30,12),
    "booleanValue" BOOLEAN,

    CONSTRAINT "RunAuthorityValue_pkey" PRIMARY KEY ("entryId","valuePath")
);

-- CreateTable
CREATE TABLE "OwnerPolicyDefinition" (
    "policyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "reviewAuthority" TEXT NOT NULL,
    "lifecycleKind" TEXT NOT NULL,
    "defaultEffectiveYear" INTEGER,
    "minimumValue" DECIMAL(30,12),
    "maximumValue" DECIMAL(30,12),

    CONSTRAINT "OwnerPolicyDefinition_pkey" PRIMARY KEY ("policyId")
);

CREATE TABLE "LockedOwnerAuthority" (
    "authorityId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    CONSTRAINT "LockedOwnerAuthority_pkey" PRIMARY KEY ("authorityId")
);

CREATE TABLE "OwnerPolicyLockedAuthorityLink" (
    "policyId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    CONSTRAINT "OwnerPolicyLockedAuthorityLink_pkey" PRIMARY KEY ("policyId", "authorityId")
);

-- CreateTable
CREATE TABLE "OwnerPolicyConsumer" (
    "policyId" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "causal" BOOLEAN NOT NULL,

    CONSTRAINT "OwnerPolicyConsumer_pkey" PRIMARY KEY ("policyId","consumerId")
);

-- CreateTable
CREATE TABLE "OwnerPolicyRevision" (
    "revisionId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "AuthorityRevisionStatus" NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "provenanceRef" TEXT NOT NULL,
    "effectiveFromYear" INTEGER,
    "effectiveToYear" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priorRevisionId" TEXT,

    CONSTRAINT "OwnerPolicyRevision_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable
CREATE TABLE "OwnerPolicyRevisionValue" (
    "revisionId" TEXT NOT NULL,
    "valuePath" TEXT NOT NULL,
    "valueType" "PolicyValueType" NOT NULL,
    "textValue" TEXT,
    "integerValue" BIGINT,
    "decimalValue" DECIMAL(30,12),
    "booleanValue" BOOLEAN,

    CONSTRAINT "OwnerPolicyRevisionValue_pkey" PRIMARY KEY ("revisionId","valuePath")
);

-- CreateTable
CREATE TABLE "OwnerPolicyApproval" (
    "approvalId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "exactHash" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPolicyApproval_pkey" PRIMARY KEY ("approvalId")
);

-- CreateTable
CREATE TABLE "ProjectionWatermark" (
    "runId" TEXT NOT NULL,
    "causalCommittedYear" INTEGER NOT NULL,
    "projectedThroughYear" INTEGER NOT NULL,
    "status" "ProjectionFreshnessStatus" NOT NULL,
    "lastErrorCode" TEXT,
    "lastFailureYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionWatermark_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "StateMembershipTerm" (
    "termId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "settlementId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "cause" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "provenanceRef" TEXT NOT NULL,

    CONSTRAINT "StateMembershipTerm_pkey" PRIMARY KEY ("termId")
);

-- CreateTable
CREATE TABLE "SettlementInfluenceTerm" (
    "termId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "settlementId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "influenceValue" DECIMAL(30,12) NOT NULL,
    "policyRevisionId" TEXT NOT NULL,

    CONSTRAINT "SettlementInfluenceTerm_pkey" PRIMARY KEY ("termId")
);

-- CreateTable
CREATE TABLE "StateTerritoryCell" (
    "cellId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "year" INTEGER NOT NULL,
    "stateId" TEXT NOT NULL,
    "geometrySha256" TEXT NOT NULL,
    "controllerEvidenceSha256" TEXT NOT NULL,

    CONSTRAINT "StateTerritoryCell_pkey" PRIMARY KEY ("cellId")
);

-- CreateTable
CREATE TABLE "StateTerritoryVertex" (
    "cellId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "latitude" DECIMAL(12,8) NOT NULL,
    "longitude" DECIMAL(12,8) NOT NULL,

    CONSTRAINT "StateTerritoryVertex_pkey" PRIMARY KEY ("cellId","ordinal")
);

-- CreateTable
CREATE TABLE "SustenanceClassification" (
    "foodSpecificId" TEXT NOT NULL,
    "refugeEligible" BOOLEAN NOT NULL,
    "selectorOnly" BOOLEAN NOT NULL,
    "ownerAuthorityRef" TEXT NOT NULL,

    CONSTRAINT "SustenanceClassification_pkey" PRIMARY KEY ("foodSpecificId")
);

-- CreateTable
CREATE TABLE "SustenanceSemanticRevision" (
    "revisionId" TEXT NOT NULL,
    "foodSpecificId" TEXT NOT NULL,
    "status" "AuthorityRevisionStatus" NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "sourceMetric" TEXT NOT NULL,
    "provenanceRef" TEXT NOT NULL,

    CONSTRAINT "SustenanceSemanticRevision_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable
CREATE TABLE "SustenanceNumericRevision" (
    "revisionId" TEXT NOT NULL,
    "foodSpecificId" TEXT NOT NULL,
    "status" "AuthorityRevisionStatus" NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "provenanceRef" TEXT NOT NULL,

    CONSTRAINT "SustenanceNumericRevision_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable
CREATE TABLE "SustenanceNumericValue" (
    "revisionId" TEXT NOT NULL,
    "valueKey" TEXT NOT NULL,
    "value" DECIMAL(30,12) NOT NULL,

    CONSTRAINT "SustenanceNumericValue_pkey" PRIMARY KEY ("revisionId","valueKey")
);

-- CreateTable
CREATE TABLE "RefugeNode" (
    "refugeId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "foodSpecificId" TEXT NOT NULL,
    "latitude" DECIMAL(12,8) NOT NULL,
    "longitude" DECIMAL(12,8) NOT NULL,
    "genesisOrdinal" INTEGER NOT NULL,
    "outputPolicyRevisionId" TEXT NOT NULL,
    "replenishmentPolicyRevisionId" TEXT NOT NULL,

    CONSTRAINT "RefugeNode_pkey" PRIMARY KEY ("refugeId")
);

-- CreateTable
CREATE TABLE "ResourceAuthority" (
    "resourceAuthorityId" TEXT NOT NULL,
    "revisionId" TEXT,
    "status" "ResourceAuthorityStatus" NOT NULL,
    "contentSha256" TEXT,
    "provenanceRef" TEXT,

    CONSTRAINT "ResourceAuthority_pkey" PRIMARY KEY ("resourceAuthorityId")
);

-- CreateTable
CREATE TABLE "ResourceNode" (
    "resourceNodeId" TEXT NOT NULL,
    "resourceAuthorityId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "latitude" DECIMAL(12,8) NOT NULL,
    "longitude" DECIMAL(12,8) NOT NULL,
    "quality" DECIMAL(30,12) NOT NULL,
    "capacity" DECIMAL(30,12) NOT NULL,
    "renewable" BOOLEAN NOT NULL,
    "accessClass" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "discoveryYear" INTEGER NOT NULL,
    "yieldPolicyRevisionId" TEXT NOT NULL,
    "depletionPolicyRevisionId" TEXT NOT NULL,

    CONSTRAINT "ResourceNode_pkey" PRIMARY KEY ("resourceNodeId")
);

-- CreateTable
CREATE TABLE "Quartermaster" (
    "quartermasterId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "settlementId" TEXT NOT NULL,
    "capacityPolicyRevisionId" TEXT NOT NULL,
    "lossPolicyRevisionId" TEXT NOT NULL,
    "activeFromYear" INTEGER NOT NULL,
    "activeToYear" INTEGER,

    CONSTRAINT "Quartermaster_pkey" PRIMARY KEY ("quartermasterId")
);

-- CreateTable
CREATE TABLE "ResourceQuartermasterAssignmentTerm" (
    "assignmentTermId" TEXT NOT NULL,
    "resourceNodeId" TEXT NOT NULL,
    "quartermasterId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "policyRevisionId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,

    CONSTRAINT "ResourceQuartermasterAssignmentTerm_pkey" PRIMARY KEY ("assignmentTermId")
);

-- CreateTable
CREATE TABLE "LogisticsFlowTerm" (
    "flowTermId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "year" INTEGER NOT NULL,
    "quartermasterId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "intake" DECIMAL(30,12) NOT NULL,
    "storageDelta" DECIMAL(30,12) NOT NULL,
    "allocation" DECIMAL(30,12) NOT NULL,
    "loss" DECIMAL(30,12) NOT NULL,
    "delivered" DECIMAL(30,12) NOT NULL,
    "disrupted" DECIMAL(30,12) NOT NULL,
    "policyRevisionId" TEXT NOT NULL,

    CONSTRAINT "LogisticsFlowTerm_pkey" PRIMARY KEY ("flowTermId")
);

-- CreateTable
CREATE TABLE "LegendaryRewardItem" (
    "legendaryRewardItemId" TEXT NOT NULL,
    "acceptedName" TEXT NOT NULL,
    "acceptedDescription" TEXT NOT NULL,
    "canonicalSource" TEXT NOT NULL,
    "provenanceRef" TEXT NOT NULL,
    "authorityRevisionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LegendaryRewardItem_pkey" PRIMARY KEY ("legendaryRewardItemId")
);

-- CreateTable
CREATE TABLE "KeeperOffice" (
    "keeperOfficeId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "legendaryRewardItemId" TEXT NOT NULL,
    "foundedYear" INTEGER NOT NULL,
    "dissolvedYear" INTEGER,

    CONSTRAINT "KeeperOffice_pkey" PRIMARY KEY ("keeperOfficeId")
);

-- CreateTable
CREATE TABLE "KeeperHolderTerm" (
    "keeperHolderTermId" TEXT NOT NULL,
    "keeperOfficeId" TEXT NOT NULL,
    "holderEntityId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "selectionEventId" TEXT NOT NULL,
    "successionEventId" TEXT,
    "provenanceRef" TEXT NOT NULL,

    CONSTRAINT "KeeperHolderTerm_pkey" PRIMARY KEY ("keeperHolderTermId")
);

-- CreateTable
CREATE TABLE "RouteStatusTerm" (
    "routeStatusTermId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "corridorId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "status" TEXT NOT NULL,
    "capacity" DECIMAL(30,12) NOT NULL,
    "controllerId" TEXT,
    "degradation" DECIMAL(30,12) NOT NULL,
    "embargoed" BOOLEAN NOT NULL,
    "blockaded" BOOLEAN NOT NULL,
    "traffic" DECIMAL(30,12) NOT NULL,
    "causalAuthorityRevisionId" TEXT,

    CONSTRAINT "RouteStatusTerm_pkey" PRIMARY KEY ("routeStatusTermId")
);

-- CreateTable
CREATE TABLE "PoiControlTerm" (
    "poiControlTermId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "poiId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "sourceEventId" TEXT NOT NULL,

    CONSTRAINT "PoiControlTerm_pkey" PRIMARY KEY ("poiControlTermId")
);

-- CreateTable
CREATE TABLE "PoiRenameDecision" (
    "decisionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "poiId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decidedYear" INTEGER NOT NULL,
    "externalRequestId" TEXT,
    "acceptedName" TEXT,
    "consequencePolicyRevisionId" TEXT,
    "provenanceRef" TEXT NOT NULL,

    CONSTRAINT "PoiRenameDecision_pkey" PRIMARY KEY ("decisionId")
);

-- CreateTable
CREATE TABLE "DerogatoryGroupingStructure" (
    "structureId" TEXT NOT NULL,
    "acceptedName" TEXT NOT NULL,
    "authorityRevisionId" TEXT NOT NULL,
    "status" "AuthorityRevisionStatus" NOT NULL,

    CONSTRAINT "DerogatoryGroupingStructure_pkey" PRIMARY KEY ("structureId")
);

-- CreateTable
CREATE TABLE "DerogatoryGroupingMembership" (
    "structureId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "memberType" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "DerogatoryGroupingMembership_pkey" PRIMARY KEY ("structureId","groupId","memberId")
);

-- CreateTable
CREATE TABLE "DerogatoryDecisionBatch" (
    "batchId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reviewYear" INTEGER NOT NULL,
    "contextSha256" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "priorStreamSha256" TEXT NOT NULL,
    "streamSha256" TEXT,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "DerogatoryDecisionBatch_pkey" PRIMARY KEY ("batchId")
);

-- CreateTable
CREATE TABLE "DerogatoryDecisionResponse" (
    "responseId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "selectedGroupId" TEXT NOT NULL,
    "priorGroupId" TEXT,

    CONSTRAINT "DerogatoryDecisionResponse_pkey" PRIMARY KEY ("responseId")
);

-- CreateTable
CREATE TABLE "AtrocityDefinition" (
    "atrocityDefinitionId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "narrativeAuthorityRevisionId" TEXT NOT NULL,
    "harmSharePolicyRevisionId" TEXT NOT NULL,
    "harmProfilePolicyRevisionId" TEXT NOT NULL,
    "narrativeCompleteSha256" TEXT NOT NULL,
    "numericFormSha256" TEXT NOT NULL,

    CONSTRAINT "AtrocityDefinition_pkey" PRIMARY KEY ("atrocityDefinitionId")
);

-- CreateTable
CREATE TABLE "PantheonCenterDesignation" (
    "designationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "pantheonId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "effectiveFromYear" INTEGER NOT NULL,
    "effectiveToYear" INTEGER,
    "selectionEvidenceSha256" TEXT NOT NULL,
    "presentationLabel" TEXT NOT NULL DEFAULT 'Pantheon Center',

    CONSTRAINT "PantheonCenterDesignation_pkey" PRIMARY KEY ("designationId")
);

-- CreateTable
CREATE TABLE "MigrationTransfer" (
    "migrationTransferId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "worldKey" "WorldKey" NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceSettlementId" TEXT NOT NULL,
    "destinationSettlementId" TEXT NOT NULL,
    "breedId" TEXT NOT NULL,
    "socialTier" TEXT NOT NULL,
    "populationCount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL,
    "groupSafetyCohortId" TEXT,
    "triggeringAuthorityId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,

    CONSTRAINT "MigrationTransfer_pkey" PRIMARY KEY ("migrationTransferId")
);

-- CreateIndex
CREATE INDEX "Breed_primaryDeityId_idx" ON "Breed"("primaryDeityId");

-- CreateIndex
CREATE INDEX "BreedDeityDecisionAudit_deityId_idx" ON "BreedDeityDecisionAudit"("deityId");

-- CreateIndex
CREATE UNIQUE INDEX "BreedDeityDecisionAudit_breedId_authorityRevisionId_key" ON "BreedDeityDecisionAudit"("breedId", "authorityRevisionId");

-- CreateIndex
CREATE INDEX "CanonicalAuthorityRevision_authorityId_status_idx" ON "CanonicalAuthorityRevision"("authorityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalAuthorityRevision_authorityId_revisionId_key" ON "CanonicalAuthorityRevision"("authorityId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "RunAuthoritySnapshot_runId_snapshotSha256_key" ON "RunAuthoritySnapshot"("runId", "snapshotSha256");

-- CreateIndex
CREATE UNIQUE INDEX "RunAuthorityEpoch_snapshotId_effectiveFromYear_key" ON "RunAuthorityEpoch"("snapshotId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "RunAuthoritySnapshotEntry_snapshotId_authorityId_authorityR_key" ON "RunAuthoritySnapshotEntry"("snapshotId", "authorityId", "authorityRevisionId");

-- CreateIndex
CREATE INDEX "OwnerPolicyRevision_policyId_status_idx" ON "OwnerPolicyRevision"("policyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPolicyRevision_policyId_revisionNumber_key" ON "OwnerPolicyRevision"("policyId", "revisionNumber");

-- CreateIndex
CREATE INDEX "OwnerPolicyApproval_revisionId_createdAt_idx" ON "OwnerPolicyApproval"("revisionId", "createdAt");
CREATE INDEX "OwnerPolicyLockedAuthorityLink_authorityId_idx" ON "OwnerPolicyLockedAuthorityLink"("authorityId");

-- CreateIndex
CREATE INDEX "ProjectionWatermark_status_idx" ON "ProjectionWatermark"("status");

-- CreateIndex
CREATE INDEX "StateMembershipTerm_runId_worldKey_stateId_effectiveFromYea_idx" ON "StateMembershipTerm"("runId", "worldKey", "stateId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "StateMembershipTerm_runId_worldKey_settlementId_effectiveFr_key" ON "StateMembershipTerm"("runId", "worldKey", "settlementId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementInfluenceTerm_runId_worldKey_settlementId_effecti_key" ON "SettlementInfluenceTerm"("runId", "worldKey", "settlementId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "StateTerritoryCell_runId_worldKey_year_cellId_key" ON "StateTerritoryCell"("runId", "worldKey", "year", "cellId");

-- CreateIndex
CREATE INDEX "SustenanceSemanticRevision_foodSpecificId_status_idx" ON "SustenanceSemanticRevision"("foodSpecificId", "status");

-- CreateIndex
CREATE INDEX "SustenanceNumericRevision_foodSpecificId_status_idx" ON "SustenanceNumericRevision"("foodSpecificId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RefugeNode_runId_worldKey_foodSpecificId_genesisOrdinal_key" ON "RefugeNode"("runId", "worldKey", "foodSpecificId", "genesisOrdinal");

-- CreateIndex
CREATE INDEX "ResourceNode_resourceAuthorityId_worldKey_idx" ON "ResourceNode"("resourceAuthorityId", "worldKey");

-- CreateIndex
CREATE UNIQUE INDEX "Quartermaster_runId_worldKey_quartermasterId_key" ON "Quartermaster"("runId", "worldKey", "quartermasterId");

-- CreateIndex
CREATE INDEX "ResourceQuartermasterAssignmentTerm_quartermasterId_effecti_idx" ON "ResourceQuartermasterAssignmentTerm"("quartermasterId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceQuartermasterAssignmentTerm_resourceNodeId_effectiv_key" ON "ResourceQuartermasterAssignmentTerm"("resourceNodeId", "effectiveFromYear");

-- CreateIndex
CREATE INDEX "LogisticsFlowTerm_runId_worldKey_year_quartermasterId_idx" ON "LogisticsFlowTerm"("runId", "worldKey", "year", "quartermasterId");

-- CreateIndex
CREATE UNIQUE INDEX "KeeperOffice_worldKey_legendaryRewardItemId_key" ON "KeeperOffice"("worldKey", "legendaryRewardItemId");

-- CreateIndex
CREATE INDEX "KeeperHolderTerm_keeperOfficeId_effectiveToYear_idx" ON "KeeperHolderTerm"("keeperOfficeId", "effectiveToYear");

-- CreateIndex
CREATE UNIQUE INDEX "KeeperHolderTerm_keeperOfficeId_effectiveFromYear_key" ON "KeeperHolderTerm"("keeperOfficeId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStatusTerm_runId_worldKey_corridorId_effectiveFromYear_key" ON "RouteStatusTerm"("runId", "worldKey", "corridorId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "PoiControlTerm_runId_worldKey_poiId_effectiveFromYear_key" ON "PoiControlTerm"("runId", "worldKey", "poiId", "effectiveFromYear");

-- CreateIndex
CREATE UNIQUE INDEX "PoiRenameDecision_runId_worldKey_poiId_decidedYear_key" ON "PoiRenameDecision"("runId", "worldKey", "poiId", "decidedYear");

-- CreateIndex
CREATE UNIQUE INDEX "DerogatoryDecisionBatch_runId_reviewYear_key" ON "DerogatoryDecisionBatch"("runId", "reviewYear");

-- CreateIndex
CREATE UNIQUE INDEX "DerogatoryDecisionResponse_batchId_ordinal_key" ON "DerogatoryDecisionResponse"("batchId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "DerogatoryDecisionResponse_batchId_worldKey_scopeId_key" ON "DerogatoryDecisionResponse"("batchId", "worldKey", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "AtrocityDefinition_worldKey_occurrenceId_key" ON "AtrocityDefinition"("worldKey", "occurrenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PantheonCenterDesignation_runId_worldKey_pantheonId_effecti_key" ON "PantheonCenterDesignation"("runId", "worldKey", "pantheonId", "effectiveFromYear");

-- CreateIndex
CREATE INDEX "MigrationTransfer_runId_worldKey_year_idx" ON "MigrationTransfer"("runId", "worldKey", "year");

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_primaryDeityId_fkey" FOREIGN KEY ("primaryDeityId") REFERENCES "Deity"("deityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAuthorityEpoch" ADD CONSTRAINT "RunAuthorityEpoch_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RunAuthoritySnapshot"("snapshotId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAuthoritySnapshotEntry" ADD CONSTRAINT "RunAuthoritySnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RunAuthoritySnapshot"("snapshotId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAuthoritySnapshotEntry" ADD CONSTRAINT "RunAuthoritySnapshotEntry_authorityRevisionId_fkey" FOREIGN KEY ("authorityRevisionId") REFERENCES "CanonicalAuthorityRevision"("revisionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunAuthorityValue" ADD CONSTRAINT "RunAuthorityValue_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RunAuthoritySnapshotEntry"("entryId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPolicyConsumer" ADD CONSTRAINT "OwnerPolicyConsumer_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "OwnerPolicyDefinition"("policyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPolicyRevision" ADD CONSTRAINT "OwnerPolicyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "OwnerPolicyDefinition"("policyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerPolicyLockedAuthorityLink" ADD CONSTRAINT "OwnerPolicyLockedAuthorityLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "OwnerPolicyDefinition"("policyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerPolicyLockedAuthorityLink" ADD CONSTRAINT "OwnerPolicyLockedAuthorityLink_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "LockedOwnerAuthority"("authorityId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPolicyRevisionValue" ADD CONSTRAINT "OwnerPolicyRevisionValue_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OwnerPolicyRevision"("revisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPolicyApproval" ADD CONSTRAINT "OwnerPolicyApproval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OwnerPolicyRevision"("revisionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateTerritoryVertex" ADD CONSTRAINT "StateTerritoryVertex_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "StateTerritoryCell"("cellId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustenanceSemanticRevision" ADD CONSTRAINT "SustenanceSemanticRevision_foodSpecificId_fkey" FOREIGN KEY ("foodSpecificId") REFERENCES "SustenanceClassification"("foodSpecificId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustenanceNumericRevision" ADD CONSTRAINT "SustenanceNumericRevision_foodSpecificId_fkey" FOREIGN KEY ("foodSpecificId") REFERENCES "SustenanceClassification"("foodSpecificId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustenanceNumericValue" ADD CONSTRAINT "SustenanceNumericValue_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SustenanceNumericRevision"("revisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceQuartermasterAssignmentTerm" ADD CONSTRAINT "ResourceQuartermasterAssignmentTerm_resourceNodeId_fkey" FOREIGN KEY ("resourceNodeId") REFERENCES "ResourceNode"("resourceNodeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceQuartermasterAssignmentTerm" ADD CONSTRAINT "ResourceQuartermasterAssignmentTerm_quartermasterId_fkey" FOREIGN KEY ("quartermasterId") REFERENCES "Quartermaster"("quartermasterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeeperOffice" ADD CONSTRAINT "KeeperOffice_legendaryRewardItemId_fkey" FOREIGN KEY ("legendaryRewardItemId") REFERENCES "LegendaryRewardItem"("legendaryRewardItemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeeperHolderTerm" ADD CONSTRAINT "KeeperHolderTerm_keeperOfficeId_fkey" FOREIGN KEY ("keeperOfficeId") REFERENCES "KeeperOffice"("keeperOfficeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerogatoryGroupingMembership" ADD CONSTRAINT "DerogatoryGroupingMembership_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "DerogatoryGroupingStructure"("structureId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerogatoryDecisionResponse" ADD CONSTRAINT "DerogatoryDecisionResponse_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DerogatoryDecisionBatch"("batchId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "KeeperHolderTerm_one_active_holder_per_office" ON "KeeperHolderTerm"("keeperOfficeId") WHERE "effectiveToYear" IS NULL;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "KeeperHolderTerm" ADD CONSTRAINT "KeeperHolderTerm_non_overlapping_terms" EXCLUDE USING gist (
  "keeperOfficeId" WITH =,
  int4range("effectiveFromYear", COALESCE("effectiveToYear", 2147483647), '[)') WITH &&
);
ALTER TABLE "KeeperHolderTerm" ADD CONSTRAINT "KeeperHolderTerm_valid_interval" CHECK ("effectiveToYear" IS NULL OR "effectiveToYear" > "effectiveFromYear");
ALTER TABLE "StateMembershipTerm" ADD CONSTRAINT "StateMembershipTerm_valid_interval" CHECK ("effectiveToYear" IS NULL OR "effectiveToYear" > "effectiveFromYear");
ALTER TABLE "SettlementInfluenceTerm" ADD CONSTRAINT "SettlementInfluenceTerm_valid_interval" CHECK ("effectiveToYear" IS NULL OR "effectiveToYear" > "effectiveFromYear");
ALTER TABLE "ResourceQuartermasterAssignmentTerm" ADD CONSTRAINT "ResourceQuartermasterAssignmentTerm_valid_interval" CHECK ("effectiveToYear" IS NULL OR "effectiveToYear" > "effectiveFromYear");
CREATE UNIQUE INDEX "ResourceQuartermasterAssignmentTerm_one_active_assignment" ON "ResourceQuartermasterAssignmentTerm"("resourceNodeId") WHERE "effectiveToYear" IS NULL;
ALTER TABLE "RunAuthorityValue" ADD CONSTRAINT "RunAuthorityValue_exactly_one_typed_value" CHECK (
  ("valueType" = 'TEXT' AND "textValue" IS NOT NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'INTEGER' AND "textValue" IS NULL AND "integerValue" IS NOT NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'DECIMAL' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NOT NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'BOOLEAN' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NOT NULL)
  OR ("valueType" = 'NULL' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
);
ALTER TABLE "OwnerPolicyRevisionValue" ADD CONSTRAINT "OwnerPolicyRevisionValue_exactly_one_typed_value" CHECK (
  ("valueType" = 'TEXT' AND "textValue" IS NOT NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'INTEGER' AND "textValue" IS NULL AND "integerValue" IS NOT NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'DECIMAL' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NOT NULL AND "booleanValue" IS NULL)
  OR ("valueType" = 'BOOLEAN' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NOT NULL)
  OR ("valueType" = 'NULL' AND "textValue" IS NULL AND "integerValue" IS NULL AND "decimalValue" IS NULL AND "booleanValue" IS NULL)
);
ALTER TABLE "LogisticsFlowTerm" ADD CONSTRAINT "LogisticsFlowTerm_conservation" CHECK (
  "intake" >= 0 AND "allocation" >= 0 AND "loss" >= 0 AND "delivered" >= 0 AND "disrupted" >= 0
  AND "intake" = "storageDelta" + "allocation" + "loss"
  AND "allocation" = "delivered" + "disrupted"
);
ALTER TABLE "DerogatoryDecisionResponse" ADD CONSTRAINT "DerogatoryDecisionResponse_valid_action" CHECK ("action" IN ('SELECT','KEEP','REPLACE'));
