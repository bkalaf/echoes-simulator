import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { buildPersistedNamingBatchesV5 } from "../core/v5/naming.js";
import { normalizeSeed } from "../core/v5/random.js";
import { runPersistedV5Diagnostic } from "../core/v5/service.js";
import { buildHistoricalDiagnosticsV5 } from "../core/v5/historical-diagnostics.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";
import { validateScopedV5DivergenceRegression, V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE } from "../core/v5/divergence-regression.js";

const benchmark = process.argv.includes("--unattended-causal-benchmark");
const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const targetYear = targetArgument ? Number.parseInt(targetArgument.slice("--target=".length), 10) : 2000;
if (!Number.isSafeInteger(targetYear) || targetYear < 0) throw new Error("--target must be a nonnegative safe integer");

const outputDirectory = resolve("artifacts/simulator/v5/acceptance");
mkdirSync(outputDirectory, { recursive: true });
const executionId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const databasePath = resolve(outputDirectory, `${benchmark ? "benchmark" : "interactive"}-${targetYear}-${executionId}.sqlite`);
const store = new SimulatorStore(databasePath);
const started = performance.now();
try {
  const result = runPersistedV5Diagnostic({
    store,
    resourceDirectory: resolve("resources"),
    normalizedSeed: normalizeSeed("EIDOLON_V5_REMEDIATION_ACCEPTANCE_V1"),
    throughYear: targetYear,
    namingMode: benchmark ? "UNATTENDED_CAUSAL_BENCHMARK" : "INTERACTIVE_LLM_NAMING",
  });
  const manifest = store.loadV5RunManifest(result.runId);
  if (!manifest) throw new Error("V5 remediation run lacks a manifest");
  const pending = store.listV5NamingRequests(result.runId);
  const batches = buildPersistedNamingBatchesV5(result.runId, pending, manifest.operationalConfig.namingBatchMaximum);
  for (const batch of batches) store.saveV5NamingBatchAudit(batch);
  const worlds: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
  const finalStates = Object.fromEntries(worlds.map((world) => [world, store.loadLatestV5Checkpoint(result.runId, world, result.currentYear)?.state]).filter((row): row is [WorldKey, WorldStateV5] => Boolean(row[1]))) as Record<WorldKey, WorldStateV5>;
  const diagnosticEventTypes = ["FamilyPromoted","FamilyAllianceCreated","FamilyRivalryCreated","OrganizationFormed","OrganizationDissolved","SettlementFounded","FoundingTransfer"];
  const diagnosticEvents = Object.fromEntries(worlds.map((world) => [world, store.listV5CausalEventsByTypes(result.runId, world, diagnosticEventTypes, result.currentYear)])) as Record<WorldKey, CausalEventV5[]>;
  const historicalDiagnostics = worlds.every((world) => finalStates[world]) ? buildHistoricalDiagnosticsV5({ canonical: loadBundledCanonicalV5(resolve("resources/canonical")), states: finalStates, events: diagnosticEvents, summaries: store.listV5DiagnosticSummaries(result.runId), divergence: result.divergence, divergenceTraces: store.listV5DivergenceTraces(result.runId) }) : null;
  const storagePayloads = store.v5StoragePayloadAccounting(result.runId);
  const databaseMainBytes = statSync(databasePath).size;
  const databaseWalBytes = statSync(`${databasePath}-wal`, { throwIfNoEntry: false })?.size ?? 0;
  const databaseShmBytes = statSync(`${databasePath}-shm`, { throwIfNoEntry: false })?.size ?? 0;
  const databaseBytes = databaseMainBytes + databaseWalBytes + databaseShmBytes;
  const storagePages = store.v5StoragePageAccounting();
  const priorBaselineBytes = 2_579_591_168;
  const accountedStabilizationPageBytes = storagePages.diagnosticTableBytes + storagePages.diagnosticIndexBytes + storagePages.namingTableBytes + storagePages.namingIndexBytes;
  // WAL/SHM are transient while this report is assembled. Compare the durable
  // main database and reconcile the complete allocated pages, not compressed
  // JSON payload sizes, so SQLite page overhead is not misreported as growth.
  const unexplainedGrowthBytes = Math.max(0, databaseMainBytes - priorBaselineBytes - accountedStabilizationPageBytes);
  const scopedDivergenceRegression = validateScopedV5DivergenceRegression({ normalizedSeed: manifest.normalizedSeed, canonicalBundleHash: manifest.canonicalBundleHash, mechanicsVersion: manifest.mechanicsVersion, causalDerivationVersion: manifest.causalDerivationVersion, comparisonSetVersion: V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.comparisonSetVersion, report: result.divergence });

  const report = {
    schemaVersion: "echoes-v5-naming-integrity-acceptance-v1",
    executionMode: benchmark ? "UNATTENDED_CAUSAL_BENCHMARK" : "INTERACTIVE_LLM_NAMING",
    markers: benchmark ? ["UNATTENDED_CAUSAL_BENCHMARK", "NO_NAMING_ACCEPTANCE_PERFORMED"] : result.status === "WAITING_FOR_NAMING" ? ["WAITING_FOR_NAMING"] : [],
    runId: result.runId,
    status: result.status,
    currentYear: result.currentYear,
    targetYear,
    acceptedLabelCount: store.loadV5TrustedLabelLedger(result.runId).filter((entry) => entry.source === "LLM_NAMING_RESPONSE" || entry.source === "OWNER_INPUT" || entry.source === "AUTOMATIC_REUSE").length,
    pendingBlocking: pending.filter((request) => request.behavior === "BLOCKING" && !request.acceptedLabel).length,
    pendingBatched: pending.filter((request) => request.behavior === "BATCHED" && !request.acceptedLabel).length,
    presentedBatchId: batches[0]?.batchId ?? null,
    promptArtifact: batches[0] ? resolve(outputDirectory, `naming-prompt-${executionId}.txt`) : null,
    databasePath,
    databaseBytes,
    databaseMainBytes,
    databaseWalBytes,
    databaseShmBytes,
    causalEventCount: store.v5EventCount(result.runId),
    checkpointCount: store.v5CheckpointCount(result.runId),
    bytesPerCausalEvent: store.v5EventCount(result.runId) ? databaseBytes / store.v5EventCount(result.runId) : 0,
    storagePayloads,
    storagePages,
    diagnosticStorage: store.v5DiagnosticStorageStats(result.runId),
    storageRegressionBaselineBytes: priorBaselineBytes,
    accountedStabilizationPageBytes,
    unexplainedGrowthBytes,
    storageRegressionStatus: targetYear === 2000 && unexplainedGrowthBytes > 0 ? "FAILED_UNEXPLAINED_DATABASE_SIZE_REGRESSION" : "PASS_OR_NOT_COMPARABLE",
    historicalDiagnostics,
    scopedDivergenceRegression,
    elapsedMilliseconds: Math.round(performance.now() - started),
    divergence: result.divergence,
  };
  if (batches[0]) writeFileSync(report.promptArtifact!, batches[0].promptText, "utf8");
  const reportPath = resolve(outputDirectory, `naming-integrity-${executionId}.json`);
  writeFileSync(reportPath, `${canonicalJson(report)}\n`, "utf8");
  if (report.storageRegressionStatus === "FAILED_UNEXPLAINED_DATABASE_SIZE_REGRESSION") throw new Error("Unexplained database-size regression exceeds the stabilization allowance");
  if (targetYear === 2000 && scopedDivergenceRegression.applies && !scopedDivergenceRegression.pass) throw new Error("Scoped 203-item divergence stabilization fixture regressed");
  process.stdout.write(`${canonicalJson({ reportPath, databasePath, executionMode: report.executionMode, markers: report.markers, runId: report.runId, status: report.status, currentYear: report.currentYear, targetYear: report.targetYear, acceptedLabelCount: report.acceptedLabelCount, pendingBlocking: report.pendingBlocking, pendingBatched: report.pendingBatched, databaseBytes: report.databaseBytes, causalEventCount: report.causalEventCount, checkpointCount: report.checkpointCount, bytesPerCausalEvent: report.bytesPerCausalEvent, diagnosticStorage: report.diagnosticStorage, storageRegressionStatus: report.storageRegressionStatus, scopedDivergenceRegression: report.scopedDivergenceRegression, elapsedMilliseconds: report.elapsedMilliseconds })}\n`);
} finally { store.close(); }
