import { afterAll, describe, expect, it } from "vitest";
import { disconnectDomainDatabase, getDomainDatabase, preflightDomainDatabase } from "../../src/persistence/postgres-domain.js";
import { loadPoliticalPersonAlignmentsAtYear } from "../../src/persistence/postgres-political-person.js";
import { resolveDomainDatabaseConnection } from "../../src/persistence/domain-database-connection.js";
import { loadCausalCapabilityReadiness } from "../../src/persistence/causal-capability-readiness.js";
import { loadBreedCatalog } from "../../src/core/breeds/breed-catalog.js";
import { loadCanonicalAtlasPois } from "../../src/persistence/postgres-atlas.js";

const databaseAvailable = Boolean(resolveDomainDatabaseConnection());

describe.skipIf(!databaseAvailable)("shared Echoes PostgreSQL cutover", () => {
  afterAll(async () => disconnectDomainDatabase());

  it("applies the simulator migrations into the existing shared schema", async () => {
    const database = getDomainDatabase();
    const migrations = await database.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(migrations.map((row) => row.migration_name)).toContain("20260829120000_canonical_geography_and_political_alignment");
    expect(migrations.map((row) => row.migration_name)).toContain("20260829210000_master_remediation_v56");
    expect(migrations.map((row) => row.migration_name)).toContain("20260830010000_canonical_domain_reconciliation");
    const structures = await database.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Breed','Site','PointOfInterest','OwnerPolicyDefinition','RunAuthoritySnapshot','CanonicalMigrationReconciliation') ORDER BY table_name`;
    expect(structures.map((row) => row.table_name)).toEqual(["Breed", "CanonicalMigrationReconciliation", "OwnerPolicyDefinition", "PointOfInterest", "RunAuthoritySnapshot", "Site"]);
    await expect(preflightDomainDatabase()).resolves.toMatchObject({ state: "READY", diagnosticCode: "DOMAIN_DATABASE_READY", sharedCanonicalDatabase: true, manualDatabaseUrlRequired: false, secondCanonicalDatabaseCreated: false });
  });

  it("activates only zero-difference migrated domains and keeps capabilities independent", async () => {
    const readiness = await loadCausalCapabilityReadiness();
    expect(readiness.canonicalDomainMigration).toMatchObject({ status: "READY", unexplainedDifferenceCount: 0 });
    expect(readiness.canonicalDomainMigration.domains).toHaveLength(10);
    const aggregate = await getDomainDatabase().canonicalMigrationReconciliation.findFirst({ where: { authorityId: "SIMULATOR_CANONICAL_V5", status: "RECONCILED" }, orderBy: { updatedAt: "desc" } });
    expect(aggregate).toMatchObject({ stableIdentityCount: 2_211, sourceValueCount: 44_108, importedValueCount: 44_108, unexplainedDifferenceCount: 0 });
    expect(readiness.capabilities.find((row) => row.capabilityId === "BREED_CATALOG")?.status).toBe("READY");
    expect(readiness.capabilities.find((row) => row.capabilityId === "ATLAS")?.status).toBe("READY");
    expect(readiness.capabilities.find((row) => row.capabilityId === "BREED_PRIMARY_DEITY")).toMatchObject({ status: "UNRESOLVED_AUTHORITY", blockingScope: "FIRST_CAUSAL_CONSUMER_ONLY" });
    expect(readiness.capabilities.find((row) => row.capabilityId === "OWNER_POLICY_REVISIONS")?.blockingScope).toBe("FIRST_CAUSAL_CONSUMER_ONLY");

    const catalog = await loadBreedCatalog();
    expect(catalog).toHaveLength(2_062);
    expect(new Set(catalog.map((row) => row.breedId)).size).toBe(2_062);
    expect(catalog.every((row) => row.deityClassificationStatus === "REVIEW_REQUIRED")).toBe(true);
    expect(await loadCanonicalAtlasPois()).toHaveLength(92);
  });

  it("reuses shared canonical Breed, Site, and PointOfInterest rather than creating parallel shapes", async () => {
    const database = getDomainDatabase();
    const columns = await database.$queryRaw<Array<{ table_name: string; column_name: string }>>`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Breed','Site','PointOfInterest') ORDER BY table_name,column_name`;
    const byTable = (table: string): string[] => columns.filter((row) => row.table_name === table).map((row) => row.column_name);
    expect(byTable("Breed")).toContain("name");
    expect(byTable("Breed")).toContain("primaryDeityId");
    expect(byTable("Site")).toContain("candidateType");
    expect(byTable("PointOfInterest")).toContain("pointOfInterestId");
    expect(byTable("PointOfInterest")).not.toContain("poiId");
  });

  it("reads effective PoliticalPerson alignment from normalized history and preserves legacy UNKNOWN", async () => {
    const database = getDomainDatabase();
    const runId = "POSTGRES_ALIGNMENT_INTEGRATION";
    await database.politicalPerson.deleteMany({ where: { runId } });
    try {
      await database.politicalPerson.createMany({ data: [
        { runId, worldKey: "CONCORD", personId: "P_ALIGNED", familyId: "F_CONCORD", breedId: "BRD_A", originSettlementId: "S_LUPIN", currentConcordAffinity: 1000, currentSchismAffinity: 0, currentRuinAffinity: 0, currentAlignmentEffectiveFromYear: 50, mechanicsVersion: "echoes-mechanics-v5.6.0" },
        { runId, worldKey: "CONCORD", personId: "P_LEGACY", familyId: "F_RUIN", breedId: "BRD_R", originSettlementId: "S_LUPIN", currentConcordAffinity: null, currentSchismAffinity: null, currentRuinAffinity: null, currentAlignmentEffectiveFromYear: null, mechanicsVersion: "echoes-mechanics-v5.4.0" },
      ] });
      await database.politicalPersonAlignment.create({ data: { runId, worldKey: "CONCORD", personId: "P_ALIGNED", effectiveFromYear: 50, effectiveToYear: null, concordAffinity: 1000, schismAffinity: 0, ruinAffinity: 0, sourceEventId: "E_SELECTION" } });
      expect(await loadPoliticalPersonAlignmentsAtYear(runId, "CONCORD", 49)).toEqual({});
      expect(await loadPoliticalPersonAlignmentsAtYear(runId, "CONCORD", 50)).toEqual({ P_ALIGNED: { CONCORD: 1000, SCHISM: 0, RUIN: 0 } });
      await expect(database.politicalPersonAlignment.create({ data: { runId, worldKey: "CONCORD", personId: "P_LEGACY", effectiveFromYear: 50, effectiveToYear: null, concordAffinity: 500, schismAffinity: 0, ruinAffinity: 0, sourceEventId: "INVALID" } })).rejects.toThrow();
    } finally {
      await database.politicalPerson.deleteMany({ where: { runId } });
    }
  });
});
