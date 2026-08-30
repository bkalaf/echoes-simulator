-- The shared Echoes PostgreSQL database already owns WorldKey, Site, and
-- PointOfInterest. This migration deliberately reuses those canonical objects
-- and adds only simulator-specific normalized political history.

CREATE TABLE "PoliticalPerson" (
  "runId" TEXT NOT NULL,
  "worldKey" "WorldKey" NOT NULL,
  "personId" TEXT NOT NULL,
  "familyId" TEXT,
  "breedId" TEXT NOT NULL,
  "originSettlementId" TEXT NOT NULL,
  "currentConcordAffinity" INTEGER,
  "currentSchismAffinity" INTEGER,
  "currentRuinAffinity" INTEGER,
  "currentAlignmentEffectiveFromYear" INTEGER,
  "mechanicsVersion" TEXT NOT NULL,
  CONSTRAINT "PoliticalPerson_pkey" PRIMARY KEY ("runId", "worldKey", "personId")
);

CREATE TABLE "PoliticalPersonAlignment" (
  "runId" TEXT NOT NULL,
  "worldKey" "WorldKey" NOT NULL,
  "personId" TEXT NOT NULL,
  "effectiveFromYear" INTEGER NOT NULL,
  "effectiveToYear" INTEGER,
  "concordAffinity" INTEGER NOT NULL,
  "schismAffinity" INTEGER NOT NULL,
  "ruinAffinity" INTEGER NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  CONSTRAINT "PoliticalPersonAlignment_pkey" PRIMARY KEY ("runId", "worldKey", "personId", "effectiveFromYear")
);

CREATE INDEX "PoliticalPerson_runId_worldKey_idx" ON "PoliticalPerson"("runId", "worldKey");
CREATE INDEX "PoliticalPersonAlignment_sourceEventId_idx" ON "PoliticalPersonAlignment"("sourceEventId");

ALTER TABLE "PoliticalPersonAlignment" ADD CONSTRAINT "PoliticalPersonAlignment_person_fkey" FOREIGN KEY ("runId", "worldKey", "personId") REFERENCES "PoliticalPerson"("runId", "worldKey", "personId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PoliticalPerson" ADD CONSTRAINT "PoliticalPerson_current_affinity_complete" CHECK (
  ("currentConcordAffinity" IS NULL AND "currentSchismAffinity" IS NULL AND "currentRuinAffinity" IS NULL AND "currentAlignmentEffectiveFromYear" IS NULL)
  OR
  ("currentConcordAffinity" IS NOT NULL AND "currentSchismAffinity" IS NOT NULL AND "currentRuinAffinity" IS NOT NULL AND "currentAlignmentEffectiveFromYear" IS NOT NULL
    AND "currentConcordAffinity" >= 0 AND "currentSchismAffinity" >= 0 AND "currentRuinAffinity" >= 0
    AND "currentConcordAffinity" + "currentSchismAffinity" + "currentRuinAffinity" = 1000)
);
ALTER TABLE "PoliticalPersonAlignment" ADD CONSTRAINT "PoliticalPersonAlignment_affinity_sum" CHECK (
  "concordAffinity" >= 0 AND "schismAffinity" >= 0 AND "ruinAffinity" >= 0
  AND "concordAffinity" + "schismAffinity" + "ruinAffinity" = 1000
  AND ("effectiveToYear" IS NULL OR "effectiveToYear" > "effectiveFromYear")
);
