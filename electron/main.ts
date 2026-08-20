import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
import { bootstrapCanonicalRun } from "../src/core/engine/canonical-runner.js";
import { resumeCanonicalRun } from "../src/core/engine/canonical-resume.js";
import type { DiagnosticResult } from "../src/core/engine/diagnostic-runner.js";
import { persistDiagnosticResult } from "../src/core/operator/diagnostic-service.js";
import { deriveOperatorViewModel, type OperatorSnapshot } from "../src/core/operator/operator-state.js";
import { loadBundledCanonical } from "../src/core/canonical/bundled-canonical.js";
import { validateNamingResponse } from "../src/core/naming/naming.js";
import { buildPersistedCanonicalExport } from "../src/core/export/persisted-export.js";
import { verifyExportZip } from "../src/core/export/exporter.js";

let mainWindow: BrowserWindow | null = null;
const projectRoot = resolve(import.meta.dirname, "../..");
const runtimeResources = !app.isPackaged && process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY
  ? resolve(process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY)
  : app.isPackaged ? join(process.resourcesPath, "simulator-resources") : join(projectRoot, "resources");
const CURRENT_CANONICAL_POLICY = "eidolon-simulator-owner-policy-v1@2026-08-18";
let store: SimulatorStore | null = null;

function getStore(): SimulatorStore {
  if (!store) {
    store = new SimulatorStore(join(app.getPath("userData"), "simulator.sqlite"));
    store.retireCanonicalRunsExcept(CURRENT_CANONICAL_POLICY);
  }
  return store;
}

function snapshotForOperator(): OperatorSnapshot & Record<string, unknown> {
  const canonicalData = loadBundledCanonical(runtimeResources);
  const sitesPath = join(canonicalData.directory, "atlas/sites_naming_master.csv");
  const sites = existsSync(sitesPath) ? parseCsvSync(readFileSync(sitesPath), { bom: true, columns: true, skip_empty_lines: true }) : [];
  const runs = getStore().listRuns();
  const selectedRun = getStore().selectedRun();
  const pendingNamingJob = (selectedRun && selectedRun.status !== "RETIRED_DATA_AUTHORITY" ? getStore().getPendingNamingJob(selectedRun.runId) : null) ?? getStore().getAnyPendingNamingJob();
  const hasActiveRun = runs.some((run) => ["RUNNING", "WAITING_FOR_NAMING"].includes(run.status));
  const settlementProjections = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, getStore().listProjections(selectedRun.runId, world, selectedRun.currentYear ?? 0, "SETTLEMENT")])) : null;
  const eventCount = selectedRun ? getStore().eventCount(selectedRun.runId) : 0;
  const checkpointCount = selectedRun ? getStore().checkpointCount(selectedRun.runId) : 0;
  const cohortCount = selectedRun ? getStore().countCohorts(selectedRun.runId, undefined, selectedRun.currentYear ?? 0) : 0;
  const worldSummary = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => {
    const settlements = settlementProjections![world] as { population?: string; stateId?: string }[];
    return [world, { finalPopulation: settlements.reduce((sum, settlement) => sum + BigInt(settlement.population ?? "0"), 0n).toString(), settlements: settlements.length, states: new Set(settlements.map((settlement) => String(settlement.stateId))).size, events: eventCount, federalCapitalSiteId: null }];
  })) : null;
  const manifest = selectedRun ? { ...selectedRun, finalYear: 2000, checkpointCount, eventCount, cohortCount, namingJobCount: pendingNamingJob ? 1 : 0, worldSummary, activeIssues: [] } : null;
  return { canonicalData, manifest, runs, selectedRunId: selectedRun?.runId ?? null, hasActiveRun, exportValidation: null, sites, pendingNamingJob, settlementProjections, databasePath: getStore().filename };
}

function runWorker(action: "RUN_DIAGNOSTIC", payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(join(import.meta.dirname, "simulation-worker.js"));
    const requestId = `${action}_${Date.now()}`;
    worker.once("error", reject);
    worker.once("message", (message: { requestId: string; ok: boolean; payload?: unknown; error?: string }) => {
      void worker.terminate();
      if (message.requestId !== requestId || !message.ok) reject(new Error(message.error ?? "Worker request failed"));
      else resolvePromise(message.payload);
    });
    worker.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId, action, payload });
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1040, minHeight: 700,
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`Renderer failed to load ${url}: ${code} ${description}`));
  const developmentServer = process.env.VITE_DEV_SERVER_URL;
  if (developmentServer) await mainWindow.loadURL(developmentServer);
  else await mainWindow.loadFile(join(import.meta.dirname, "../../dist/index.html"));
}

ipcMain.handle("simulator:get-runtime-info", () => ({ version: app.getVersion(), userDataPath: app.getPath("userData") }));
ipcMain.handle("simulator:get-operator-snapshot", snapshotForOperator);
ipcMain.handle("simulator:run-diagnostic", async (_event, seed: string) => {
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunDiagnostic) throw new Error(state.diagnosticDisabledReasons.join(" "));
  const result = await runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }) as DiagnosticResult;
  return persistDiagnosticResult(getStore(), result);
});
ipcMain.handle("simulator:select-run", (_event, runId: string) => { getStore().selectRun(runId); return snapshotForOperator(); });
ipcMain.handle("simulator:get-run-view", (_event, runId: string, world: string, year: number) => {
  const run = getStore().getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const effectiveYear = Math.max(0, Math.min(Number.isFinite(year) ? Math.trunc(year) : 0, run.currentYear ?? 0));
  return {
    runId, world, requestedYear: year, effectiveYear,
    settlements: getStore().listProjections(runId, world, effectiveYear, "SETTLEMENT"),
    events: getStore().listEvents(runId, world).filter((event) => event.year <= effectiveYear),
    history: getStore().listHistoryRows(runId).filter((row) => row.worldKey === world && row.year <= effectiveYear),
    checkpoints: getStore().listCheckpoints(runId, world).filter((checkpoint) => checkpoint.year <= effectiveYear).map((checkpoint) => ({ year: checkpoint.year, stateHash: checkpoint.stateHash })),
  };
});
ipcMain.handle("simulator:run-canonical", (_event, seed: string) => {
  const canonicalData = loadBundledCanonical(runtimeResources);
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunCanonical) throw new Error(state.canonicalDisabledReasons.join(" "));
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  return bootstrapCanonicalRun({ store: getStore(), seed, canonicalDirectory: canonicalData.directory });
});
ipcMain.handle("simulator:submit-naming-response", (_event, responseText: string) => {
  const job = getStore().getAnyPendingNamingJob();
  if (!job) throw new Error("No pending naming job exists");
  let parsed: unknown;
  try { parsed = JSON.parse(responseText); } catch { throw new Error("Naming response is not valid JSON"); }
  const result = validateNamingResponse(job, parsed);
  const attemptId = `NAMING_ATTEMPT_${randomUUID()}`;
  if (!result.accepted || !result.decisions) { getStore().recordRejectedNamingAttempt(job.namingJobId, attemptId, responseText, result.errors); return { accepted: false, errors: result.errors }; }
  const items = new Map(job.items.map((item) => [item.requestId, item]));
  getStore().acceptNamingResponse(job.namingJobId, attemptId, responseText, result.decisions.map((decision) => ({ requestId: decision.requestId, entityType: decision.entityType, entityId: items.get(decision.requestId)!.entityId, name: decision.name })));
  if (getStore().getPendingNamingJob(job.context.runId)) return { accepted: true, errors: [], status: "WAITING_FOR_NAMING", currentYear: job.context.year };
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  const resumed = resumeCanonicalRun({ store: getStore(), runId: job.context.runId, canonicalDirectory: canonicalData.directory });
  return { accepted: true, errors: [], status: resumed.status, currentYear: resumed.currentYear, nextNamingJobs: resumed.namingJobs.length };
});
ipcMain.handle("simulator:export-run", async () => {
  const run = getStore().selectedRun();
  if (!run) throw new Error("No persisted run is selected");
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  const generated = buildPersistedCanonicalExport(getStore(), run.runId, canonicalData.directory);
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `EIDOLON_SIMULATION_${run.runId}.zip`, filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, generated.bytes);
  const verified = verifyExportZip(readFileSync(result.filePath));
  getStore().saveExportMetadata({ exportId: `EXPORT_${randomUUID()}`, runId: run.runId, createdAt: new Date().toISOString(), filename: result.filePath, sha256: generated.sha256, manifest: verified.manifest });
  return { filename: result.filePath, sha256: generated.sha256, checkedFiles: verified.files.length };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => { store?.close(); store = null; });
