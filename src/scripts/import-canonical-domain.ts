import { resolve } from "node:path";
import { reconcileCanonicalDomains } from "../persistence/canonical-domain-reconciliation.js";
import { disconnectDomainDatabase } from "../persistence/postgres-domain.js";

const sourceDirectory = resolve(process.argv[2] ?? "resources/canonical");

try {
  const result = await reconcileCanonicalDomains({ sourceDirectory });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    migrationMode: "DETERMINISTIC_ACCEPTED_SOURCE_RECONCILIATION",
    ownerApprovalRequired: false,
    domains: result.domains,
    migratedCanonicalValuesReconciled: result.status === "RECONCILED" ? "PASS" : "FAIL",
    unexplainedMigratedValues: result.unexplainedDifferenceCount,
    nextAction: result.status === "RECONCILED" ? "NONE" : "Review only the reported authority IDs and value paths.",
  }, null, 2)}\n`);
  if (result.status !== "RECONCILED") process.exitCode = 2;
} finally {
  await disconnectDomainDatabase();
}
