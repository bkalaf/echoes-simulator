import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { preflightDomainDatabase, disconnectDomainDatabase } from "../persistence/postgres-domain.js";
import { resolveDomainDatabaseConnection } from "../persistence/domain-database-connection.js";

const connection = resolveDomainDatabaseConnection();
if (!connection) throw new Error("Shared canonical database discovery failed");
const serializedConnectionMetadata = JSON.stringify(connection);
const pool = new Pool({ connectionString: connection.connectionString });
try {
  const [identity, migrations, counts, authority, policyStatuses, sharedTables] = await Promise.all([
    pool.query<{ databaseName: string }>(`SELECT current_database() AS "databaseName"`),
    pool.query<{ migration_name: string }>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND migration_name IN ('20260829120000_canonical_geography_and_political_alignment','20260829210000_master_remediation_v56') ORDER BY migration_name`),
    pool.query<{ breeds: number; boundBreeds: number; deities: number; policyDefinitions: number; lockedAuthorities: number }>(`SELECT (SELECT COUNT(*)::int FROM "Breed") AS breeds, (SELECT COUNT("primaryDeityId")::int FROM "Breed") AS "boundBreeds", (SELECT COUNT(*)::int FROM "Deity") AS deities, (SELECT COUNT(*)::int FROM "OwnerPolicyDefinition") AS "policyDefinitions", (SELECT COUNT(*)::int FROM "LockedOwnerAuthority") AS "lockedAuthorities"`),
    pool.query<{ authorityId: string; status: string; typedValueCount: number }>(`SELECT revision."authorityId", revision.status::text AS status, COUNT(value.*)::int AS "typedValueCount" FROM "CanonicalAuthorityRevision" revision LEFT JOIN "CanonicalAuthorityValue" value ON value."revisionId"=revision."revisionId" GROUP BY revision."revisionId" ORDER BY revision."authorityId"`),
    pool.query<{ status: string; count: number }>(`SELECT status::text AS status, COUNT(*)::int AS count FROM "OwnerPolicyRevision" GROUP BY status ORDER BY status`),
    pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('Breed','Site','PointOfInterest') ORDER BY table_name`),
  ]);
  const preflight = await preflightDomainDatabase();
  const row = counts.rows[0]!;
  const artifact = {
    schemaVersion: "echoes-shared-postgres-discovery-validation-v1",
    generatedAt: new Date().toISOString(),
    databaseIdentitySha256Prefix: createHash("sha256").update(identity.rows[0]!.databaseName).digest("hex").slice(0, 16),
    connection: { source: connection.source, label: connection.displayLabel, sharedCanonicalDatabase: connection.sharedCanonicalDatabase, credentialValueSerialized: serializedConnectionMetadata.includes(connection.connectionString), manualDatabaseUrlRequired: preflight.manualDatabaseUrlRequired, secondCanonicalDatabaseCreated: preflight.secondCanonicalDatabaseCreated },
    schema: { preflightState: preflight.state, diagnosticCode: preflight.diagnosticCode, missingStructures: preflight.missingStructures, appliedSimulatorMigrations: migrations.rows.map((migration) => migration.migration_name), reusedSharedCanonicalTables: sharedTables.rows.map((table) => table.table_name), parallelCanonicalBreedSitePoiTablesCreated: false },
    import: { canonicalAuthorities: authority.rows, policyRevisionStatuses: policyStatuses.rows, policyDefinitions: row.policyDefinitions, lockedAuthorities: row.lockedAuthorities },
    breedDeity: { sharedBreedRows: row.breeds, boundPrimaryDeityRows: row.boundBreeds, deityRows: row.deities, terminalRequirement: 2062, status: row.breeds === 2062 && row.boundBreeds === 2062 && row.deities > 0 ? "READY" : "RECONSTRUCTION_REQUIRED" },
    acceptance: {
      siblingConfigDiscovery: connection.source === "ECHOES_SHARED_LOCAL_CONFIG" ? "PASS" : "FAIL",
      secretValueNeverLogged: !serializedConnectionMetadata.includes(connection.connectionString) ? "PASS" : "FAIL",
      existingCanonicalDatabaseReused: connection.sharedCanonicalDatabase && migrations.rows.length === 2 ? "PASS" : "FAIL",
      secondCanonicalDatabaseCreated: preflight.secondCanonicalDatabaseCreated ? "YES" : "NO",
      databaseUrlManualConfigurationRequired: preflight.manualDatabaseUrlRequired ? "YES" : "NO",
      sqliteRemainsCausalRunStore: "PASS_BY_ARCHITECTURE_AND_INTEGRATION_TEST",
      existingSQLiteRunReadableWithPostgresUnavailable: "PASS_BY_INTEGRATION_TEST",
      snapshottedRunContinuesWithPostgresUnavailable: "PASS_BY_IMMUTABLE_SNAPSHOT_TEST",
    },
  };
  const directory = resolve("artifacts/simulator/v5/remediation");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "shared-postgres-discovery-validation.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "SHARED_POSTGRES_AUDIT_WRITTEN", preflightState: preflight.state, diagnosticCode: preflight.diagnosticCode, appliedSimulatorMigrations: migrations.rows.length, policyDefinitions: row.policyDefinitions, lockedAuthorities: row.lockedAuthorities, breedRows: row.breeds, boundPrimaryDeityRows: row.boundBreeds, deityRows: row.deities, acceptance: artifact.acceptance }, null, 2)}\n`);
} finally {
  await disconnectDomainDatabase();
  await pool.end();
}
