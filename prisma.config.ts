import { defineConfig } from "prisma/config";
import { resolveDomainDatabaseConnection } from "./src/persistence/domain-database-connection.js";

const resolved = resolveDomainDatabaseConnection();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // The invalid host permits schema-only tooling on machines without a
    // configured authority. Mutating database scripts perform a fail-closed
    // resolution before Prisma is spawned and never provision this target.
    url: resolved?.connectionString ?? "postgresql://unconfigured.invalid/echoes_canonical_unavailable",
  },
});
