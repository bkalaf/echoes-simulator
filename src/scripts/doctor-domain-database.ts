import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { disconnectDomainDatabase, preflightDomainDatabase } from "../persistence/postgres-domain.js";

const result = await preflightDomainDatabase();
const artifactDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(resolve(artifactDirectory, "startup-domain-database-doctor.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await disconnectDomainDatabase();
if (result.state !== "READY") process.exitCode = 2;
