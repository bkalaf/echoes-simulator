import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { recoverExportedV2NamingBatchV5, type NamingBatchResponseV5 } from "../core/v5/naming.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const databasePath = resolve(process.argv[2] ?? "");
const exportDirectory = resolve(process.argv[3] ?? "");
const runId = process.argv[4] ?? "";
if (!process.argv[2] || !process.argv[3] || !runId) throw new Error("Usage: recover-v5-exported-naming-batches <database.sqlite> <export-directory> <runId>");

const responseMarker = "Return only this exact JSON shape with an explicit independent decision for every pending entity ID:\n";
const files = readdirSync(exportDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".txt") && entry.name.startsWith(`V5_NAMING_${runId}_`))
  .map((entry) => join(exportDirectory, entry.name))
  .sort();
if (files.length === 0) throw new Error(`No exported V5 naming batches for ${runId} were found in ${exportDirectory}`);

const store = new SimulatorStore(databasePath);
try {
  if (!store.getRun(runId) || !store.loadV5RunManifest(runId)) throw new Error(`Unknown persisted V5 run ${runId}`);
  const causalSignature = (): string => canonicalJson({
    causalRunHash: store.loadV5RunManifest(runId)!.causalRunHash,
    eventCount: store.v5EventCount(runId),
    checkpointCount: store.v5CheckpointCount(runId),
    worlds: Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, store.summarizeV5CausalEventHistory(runId, world)])),
    checkpoints: Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, store.listV5CheckpointYears(runId, world).map((year) => {
      const checkpoint = store.loadLatestV5Checkpoint(runId, world, year)!;
      return { year, stateHash: checkpoint.stateHash, eventHistoryHash: checkpoint.eventHistoryHash };
    })])),
  });
  const causalBefore = causalSignature();
  const requests = store.listV5NamingRequests(runId);
  const recovered: Array<{ filename: string; batchId: string; decisions: number; promptSha256: string; authorityStatus: string }> = [];
  for (const filename of files) {
    const promptText = readFileSync(filename, "utf8");
    const markerIndex = promptText.lastIndexOf(responseMarker);
    if (markerIndex < 0) throw new Error(`${basename(filename)} does not contain an exported V2 response template`);
    const response = JSON.parse(promptText.slice(markerIndex + responseMarker.length)) as NamingBatchResponseV5;
    if (response.runId !== runId || response.batchId !== basename(filename, ".txt")) throw new Error(`${basename(filename)} identity does not match its immutable response template`);
    let batch = store.loadV5NamingBatchAudit(runId, response.batchId);
    if (!batch) {
      const result = recoverExportedV2NamingBatchV5(runId, requests, response);
      if (!result.batch) throw new Error(`${response.batchId}: ${result.errors.join("; ")}`);
      batch = result.batch;
      if (batch.promptText !== promptText) throw new Error(`${response.batchId} does not reproduce the exact exported prompt text`);
      store.saveV5NamingBatchAudit(batch);
    }
    const promptSha256 = createHash("sha256").update(promptText).digest("hex");
    if (batch.promptSha256 !== promptSha256 || batch.promptText !== promptText) throw new Error(`${response.batchId} prompt SHA-256 does not match persisted authority`);
    recovered.push({ filename: basename(filename), batchId: batch.batchId, decisions: batch.items.length, promptSha256, authorityStatus: batch.authorityStatus });
  }
  const causalAfter = causalSignature();
  if (causalAfter !== causalBefore) throw new Error("Exported naming batch recovery changed causal state or event history");
  const pending = store.materializePendingV5NamingBatches(runId, store.loadV5RunManifest(runId)!.operationalConfig.namingBatchMaximum);
  process.stdout.write(`${canonicalJson({ runId, recovered, exportedBatchCount: recovered.length, exportedDecisionCount: recovered.reduce((sum, batch) => sum + batch.decisions, 0), pendingBatchIds: pending.map((batch) => batch.batchId), pendingDecisionCount: pending.reduce((sum, batch) => sum + batch.items.length, 0), causalInvariant: true })}\n`);
} finally {
  store.close();
}
