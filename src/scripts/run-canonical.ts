import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapCanonicalRun } from "../core/engine/canonical-runner.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const root = resolve(".");
const output = resolve(root, "artifacts/simulator/canonical-run");
mkdirSync(output, { recursive: true });
const database = resolve(output, "simulator.sqlite");
const store = new SimulatorStore(database);
try {
  const result = bootstrapCanonicalRun({
    store,
    seed: process.argv[2] ?? "EIDOLON_CANONICAL_OWNER_RUN_V1",
    packDirectory: resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18"),
    semanticResearchZip: resolve(root, "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip"),
    resourceDirectory: resolve(root, "resources"),
  });
  writeFileSync(resolve(output, "canonical-run-result.json"), `${canonicalJson(result)}\n`);
  writeFileSync(resolve(output, "pending-naming-job.json"), `${JSON.stringify(result.namingJob, null, 2)}\n`);
  writeFileSync(resolve(output, "pending-naming-prompt.txt"), `${result.namingJob.promptText}\n`);
  process.stdout.write(`${canonicalJson({ database, runId: result.runId, status: result.status, currentYear: result.currentYear, worlds: result.worlds, runtimeIssueCount: result.runtimeIssues.length, namingJobId: result.namingJob.namingJobId, namingRequestCount: result.namingJob.items.length })}\n`);
} finally {
  store.close();
}
