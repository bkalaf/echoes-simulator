import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import {
  DomainDatabaseConnectionResolutionError,
  resolveDomainDatabaseConnection,
  type DomainDatabaseConnectionSource,
} from "./domain-database-connection.js";

export type DomainDatabasePreflightState = "READY" | "NOT_CONFIGURED" | "UNREACHABLE" | "MIGRATION_REQUIRED" | "SEED_REQUIRED" | "SCHEMA_MISMATCH";

export interface DomainDatabasePreflight {
  state: DomainDatabasePreflightState;
  diagnosticCode: string;
  redactedTarget: string | null;
  actions: readonly ("DOCTOR" | "MIGRATE" | "SEED" | "RETRY")[];
  missingStructures: readonly string[];
  connectionSource: DomainDatabaseConnectionSource | null;
  connectionLabel: string | null;
  sharedCanonicalDatabase: boolean;
  manualDatabaseUrlRequired: boolean;
  secondCanonicalDatabaseCreated: false;
}

const REQUIRED_DOMAIN_TABLES = ["CanonicalAuthorityRevision", "CanonicalAuthorityValue", "OwnerPolicyDefinition", "LockedOwnerAuthority", "OwnerPolicyRevision", "RunAuthoritySnapshot", "ProjectionWatermark", "Breed", "Deity"] as const;

function redactedDatabaseTarget(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || "default"}/${createHash("sha256").update(parsed.pathname).digest("hex").slice(0, 10)}`;
  } catch {
    return "configured-unparseable-target";
  }
}

interface DomainDatabaseSingleton {
  client?: PrismaClient;
  pool?: Pool;
}

const singleton = globalThis as typeof globalThis & { __echoesSimulatorDomainDatabase?: DomainDatabaseSingleton };
const database = (singleton.__echoesSimulatorDomainDatabase ??= {});

export function domainDatabaseUrl(): string {
  const resolved = resolveDomainDatabaseConnection();
  if (!resolved) throw new Error("Canonical Echoes PostgreSQL connection is not discoverable");
  return resolved.connectionString;
}

export function getDomainDatabase(): PrismaClient {
  if (database.client) return database.client;
  const pool = new Pool({ connectionString: domainDatabaseUrl() });
  database.pool = pool;
  database.client = new PrismaClient({ adapter: new PrismaPg(pool) });
  return database.client;
}

export async function disconnectDomainDatabase(): Promise<void> {
  await database.client?.$disconnect();
  await database.pool?.end();
  database.client = undefined;
  database.pool = undefined;
}

export async function preflightDomainDatabase(): Promise<DomainDatabasePreflight> {
  let resolved: ReturnType<typeof resolveDomainDatabaseConnection>;
  try {
    resolved = resolveDomainDatabaseConnection();
  } catch (error) {
    const diagnosticCode = error instanceof DomainDatabaseConnectionResolutionError ? error.diagnosticCode : "CANONICAL_DATABASE_DISCOVERY_FAILED";
    return { state: "UNREACHABLE", diagnosticCode, redactedTarget: null, actions: ["DOCTOR", "RETRY"], missingStructures: [], connectionSource: null, connectionLabel: null, sharedCanonicalDatabase: false, manualDatabaseUrlRequired: false, secondCanonicalDatabaseCreated: false };
  }
  if (!resolved) return { state: "NOT_CONFIGURED", diagnosticCode: "CANONICAL_DATABASE_NOT_DISCOVERABLE", redactedTarget: null, actions: ["DOCTOR", "RETRY"], missingStructures: REQUIRED_DOMAIN_TABLES, connectionSource: null, connectionLabel: null, sharedCanonicalDatabase: false, manualDatabaseUrlRequired: true, secondCanonicalDatabaseCreated: false };
  const redactedTarget = redactedDatabaseTarget(resolved.connectionString);
  const common = { redactedTarget, connectionSource: resolved.source, connectionLabel: resolved.displayLabel, sharedCanonicalDatabase: resolved.sharedCanonicalDatabase, manualDatabaseUrlRequired: false, secondCanonicalDatabaseCreated: false } as const;
  try {
    const client = getDomainDatabase();
    const tables = await client.$queryRawUnsafe<Array<{ table_name: string }>>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const observed = new Set(tables.map((row) => row.table_name));
    const migrationTablePresent = observed.has("_prisma_migrations");
    const missingStructures = REQUIRED_DOMAIN_TABLES.filter((name) => !observed.has(name));
    if (!migrationTablePresent || missingStructures.length === REQUIRED_DOMAIN_TABLES.length) {
      return { state: "MIGRATION_REQUIRED", diagnosticCode: "DOMAIN_MIGRATION_REQUIRED", actions: ["MIGRATE", "RETRY"], missingStructures, ...common };
    }
    if (missingStructures.length > 0) return { state: "SCHEMA_MISMATCH", diagnosticCode: "DOMAIN_SCHEMA_MISMATCH", actions: ["DOCTOR", "MIGRATE", "RETRY"], missingStructures, ...common };
    const failedMigrations = await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
    if (Number(failedMigrations[0]?.count ?? 0n) > 0) return { state: "MIGRATION_REQUIRED", diagnosticCode: "DOMAIN_MIGRATION_INCOMPLETE", actions: ["DOCTOR", "MIGRATE", "RETRY"], missingStructures: [], ...common };
    const requiredAuthority = await client.$queryRawUnsafe<Array<{ authorityId: string }>>(`SELECT DISTINCT "authorityId" FROM "CanonicalAuthorityRevision" WHERE status='APPROVED' AND "authorityId" IN ('SIMULATOR_CANONICAL_V5','BREED_PRIMARY_DEITY')`);
    const observedAuthority = new Set(requiredAuthority.map((row) => row.authorityId));
    if (!observedAuthority.has("SIMULATOR_CANONICAL_V5")) return { state: "SEED_REQUIRED", diagnosticCode: "CANONICAL_DOMAIN_IMPORT_APPROVAL_REQUIRED", actions: ["SEED", "RETRY"], missingStructures: [], ...common };
    if (!observedAuthority.has("BREED_PRIMARY_DEITY")) return { state: "SEED_REQUIRED", diagnosticCode: "BREED_PRIMARY_DEITY_RECONSTRUCTION_REQUIRED", actions: ["SEED", "RETRY"], missingStructures: [], ...common };
    const authorityCounts = await client.$queryRawUnsafe<Array<{ breeds: bigint; deityAudits: bigint }>>(`SELECT (SELECT COUNT(*) FROM "Breed")::bigint AS breeds, (SELECT COUNT(*) FROM "BreedDeityDecisionAudit" audit JOIN "CanonicalAuthorityRevision" revision ON revision."revisionId"=audit."authorityRevisionId" WHERE revision."authorityId"='BREED_PRIMARY_DEITY' AND revision.status='APPROVED')::bigint AS "deityAudits"`);
    if (Number(authorityCounts[0]?.breeds ?? 0n) !== 2062 || Number(authorityCounts[0]?.deityAudits ?? 0n) !== 2062) return { state: "SEED_REQUIRED", diagnosticCode: "BREED_PRIMARY_DEITY_2062_REQUIRED", actions: ["SEED", "RETRY"], missingStructures: [], ...common };
    return { state: "READY", diagnosticCode: "DOMAIN_DATABASE_READY", actions: ["DOCTOR"], missingStructures: [], ...common };
  } catch (error) {
    return { state: "UNREACHABLE", diagnosticCode: error instanceof Error && /password authentication/i.test(error.message) ? "DATABASE_AUTHENTICATION_FAILED" : "DATABASE_UNREACHABLE", actions: ["DOCTOR", "RETRY"], missingStructures: [], ...common };
  }
}
