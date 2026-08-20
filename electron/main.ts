import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
import type { RealPreflightReport } from "../src/core/inputs/preflight.js";
import { bootstrapCanonicalRun } from "../src/core/engine/canonical-runner.js";
import type { DiagnosticResult } from "../src/core/engine/diagnostic-runner.js";
import { persistDiagnosticResult } from "../src/core/operator/diagnostic-service.js";
import { deriveOperatorViewModel, type OperatorPreflight, type OperatorSnapshot } from "../src/core/operator/operator-state.js";
import { validateNamingResponse } from "../src/core/naming/naming.js";

let mainWindow: BrowserWindow | null = null;
const projectRoot = resolve(import.meta.dirname, "../..");
const runtimeResources = app.isPackaged ? join(process.resourcesPath, "simulator-resources") : join(projectRoot, "resources");
const STARTING_RESEARCH_FILENAME = "echoes_of_eidolon_breed_research_2026-08-17.zip";
const V3_RESEARCH_FILENAME = "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip";
let store: SimulatorStore | null = null;

function getStore(): SimulatorStore {
  store ??= new SimulatorStore(join(app.getPath("userData"), "simulator.sqlite"));
  return store;
}

function findRequiredFile(packDirectory: string, filename: string): string {
  const candidates = [join(packDirectory, filename), join(packDirectory, "INPUTS", filename), join(packDirectory, "inputs", filename)];
  const match = candidates.find(existsSync);
  if (!match) throw new Error(`${filename} was not found in the selected input directory`);
  return match;
}

function findOptionalFile(packDirectory: string, filename: string): string | undefined {
  const candidates = [join(packDirectory, filename), join(packDirectory, "INPUTS", filename), join(packDirectory, "inputs", filename)];
  return candidates.find(existsSync);
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256File(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function inputFile(packDirectory: string, filename: string): string | undefined {
  return [join(packDirectory, filename), join(packDirectory, "INPUTS", filename), join(packDirectory, "inputs", filename)].find(existsSync);
}

function inputsStillCurrent(preflight: NonNullable<ReturnType<SimulatorStore["getLatestPreflight"]>>): boolean {
  const report = preflight.report as RealPreflightReport & OperatorPreflight;
  const roles = report.sourceRoles as OperatorPreflight["sourceRoles"] & RealPreflightReport["sourceRoles"] | undefined;
  const expected = [
    ...(report.inputFiles ?? []).map((file) => ({ filename: file.filename, sha256: file.sha256 })),
    roles?.august17StartingAuthority,
    roles?.v3SemanticAuthority,
    roles?.v4SemanticAuthority,
    preflight.semanticAuthorityFilename && preflight.semanticAuthoritySha256
      ? { filename: preflight.semanticAuthorityFilename, sha256: preflight.semanticAuthoritySha256 }
      : null,
  ].filter((item): item is { filename: string; sha256: string } => Boolean(item?.filename && item.sha256));
  return expected.every((item) => {
    const filename = inputFile(preflight.inputDirectory, item.filename);
    if (!filename) return false;
    try { return sha256File(filename) === item.sha256; } catch { return false; }
  });
}

function operatorPreflight(preflight: NonNullable<ReturnType<SimulatorStore["getLatestPreflight"]>> | null): OperatorPreflight | null {
  if (!preflight) return null;
  const report = preflight.report as RealPreflightReport & OperatorPreflight;
  const sourceRoles = (report.sourceRoles ?? {}) as RealPreflightReport["sourceRoles"] & { v4SemanticAuthority?: { filename: string; sha256: string; verdict?: string } | null };
  const v4 = sourceRoles.v4SemanticAuthority;
  const v3 = sourceRoles.v3SemanticAuthority;
  return {
    ...report,
    semanticAuthorityVersion: report.semanticAuthorityVersion ?? preflight.semanticAuthorityVersion ?? (v4 ? "V4" : v3 ? "V3" : null),
    semanticAuthorityFilename: report.semanticAuthorityFilename ?? preflight.semanticAuthorityFilename ?? v4?.filename ?? v3?.filename ?? null,
    semanticAuthoritySha256: report.semanticAuthoritySha256 ?? preflight.semanticAuthoritySha256 ?? v4?.sha256 ?? v3?.sha256 ?? null,
    semanticAuthorityVerdict: report.semanticAuthorityVerdict ?? preflight.semanticAuthorityVerdict ?? v4?.verdict ?? (v3 ? "RETIRED_FALSE_COMPLETION" : null),
    inputsCurrent: inputsStillCurrent(preflight),
  };
}

function snapshotForOperator(): OperatorSnapshot & Record<string, unknown> {
  const sitesPath = join(runtimeResources, "inputs/sites_naming_master.csv");
  const sites = existsSync(sitesPath) ? parseCsvSync(readFileSync(sitesPath), { bom: true, columns: true, skip_empty_lines: true }) : [];
  const persistedPreflight = getStore().getLatestPreflight();
  const preflight = operatorPreflight(persistedPreflight);
  const runs = getStore().listRuns();
  const selectedRun = getStore().selectedRun();
  const pendingNamingJob = (selectedRun ? getStore().getPendingNamingJob(selectedRun.runId) : null) ?? getStore().getAnyPendingNamingJob();
  const hasActiveRun = runs.some((run) => ["RUNNING", "WAITING_FOR_NAMING", "PAUSED", "READY"].includes(run.status));
  const settlementProjections = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, getStore().listProjections(selectedRun.runId, world, selectedRun.currentYear ?? 0, "SETTLEMENT")])) : null;
  const eventCount = selectedRun ? getStore().eventCount(selectedRun.runId) : 0;
  const checkpointCount = selectedRun ? getStore().checkpointCount(selectedRun.runId) : 0;
  const cohortCount = selectedRun ? getStore().countCohorts(selectedRun.runId, undefined, selectedRun.currentYear ?? 0) : 0;
  const worldSummary = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => {
    const settlements = settlementProjections![world] as { population?: string; stateId?: string }[];
    return [world, { finalPopulation: settlements.reduce((sum, settlement) => sum + BigInt(settlement.population ?? "0"), 0n).toString(), settlements: settlements.length, states: new Set(settlements.map((settlement) => String(settlement.stateId))).size, events: eventCount, federalCapitalSiteId: null }];
  })) : null;
  const manifest = selectedRun ? { ...selectedRun, finalYear: 2000, checkpointCount, eventCount, cohortCount, namingJobCount: pendingNamingJob ? 1 : 0, worldSummary, activeIssues: [], canonicalReady: preflight?.canonicalReady ?? false } : null;
  return { manifest, runs, selectedRunId: selectedRun?.runId ?? null, preflight, hasActiveRun, exportValidation: null, sites, pendingNamingJob, settlementProjections, databasePath: getStore().filename };
}

function runWorker(action: "RUN_DIAGNOSTIC" | "VALIDATE_REAL_INPUTS", payload: Record<string, unknown>): Promise<unknown> {
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
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load ${url}: ${code} ${description}`);
  });
  const developmentServer = process.env.VITE_DEV_SERVER_URL;
  if (developmentServer) await mainWindow.loadURL(developmentServer);
  else await mainWindow.loadFile(join(import.meta.dirname, "../../dist/index.html"));
}

ipcMain.handle("simulator:get-runtime-info", () => ({ version: app.getVersion(), userDataPath: app.getPath("userData") }));
ipcMain.handle("simulator:get-operator-snapshot", snapshotForOperator);
ipcMain.handle("simulator:select-input-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("simulator:run-diagnostic", async (_event, seed: string) => {
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunDiagnostic) throw new Error(state.diagnosticDisabledReasons.join(" "));
  const result = await runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }) as DiagnosticResult;
  return persistDiagnosticResult(getStore(), result);
});

async function validateDirectory(packDirectory: string): Promise<RealPreflightReport> {
  const startingResearchZip = findRequiredFile(packDirectory, STARTING_RESEARCH_FILENAME);
  const v3ResearchZip = findOptionalFile(packDirectory, V3_RESEARCH_FILENAME);
  const report = await runWorker("VALIDATE_REAL_INPUTS", { packDirectory, startingResearchZip, v3ResearchZip }) as RealPreflightReport;
  getStore().savePreflight({
    preflightId: `PREFLIGHT_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    inputDirectory: resolve(packDirectory),
    inputManifestIdentity: digestJson(report.inputFiles),
    startingResearchHash: report.sourceRoles.august17StartingAuthority.sha256,
    v3ResearchHash: report.sourceRoles.v3SemanticAuthority?.sha256 ?? null,
    semanticAuthorityVersion: report.sourceRoles.v3SemanticAuthority ? "V3" : null,
    semanticAuthorityFilename: report.sourceRoles.v3SemanticAuthority?.filename ?? null,
    semanticAuthoritySha256: report.sourceRoles.v3SemanticAuthority?.sha256 ?? null,
    semanticAuthorityVerdict: report.sourceRoles.v3SemanticAuthority ? "RETIRED_FALSE_COMPLETION" : null,
    report,
  });
  return report;
}

ipcMain.handle("simulator:validate-inputs", (_event, packDirectory: string) => validateDirectory(packDirectory));
ipcMain.handle("simulator:revalidate-inputs", () => {
  const current = getStore().getLatestPreflight();
  if (!current) throw new Error("No persisted input selection is available to revalidate");
  return validateDirectory(current.inputDirectory);
});
ipcMain.handle("simulator:select-run", (_event, runId: string) => {
  getStore().selectRun(runId);
  return snapshotForOperator();
});
ipcMain.handle("simulator:run-canonical", (_event, seed: string) => {
  const current = getStore().getLatestPreflight();
  if (!current) throw new Error("Validate canonical inputs before starting a run");
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunCanonical) throw new Error(state.canonicalDisabledReasons.join(" "));
  const authorityFilename = current.semanticAuthorityFilename;
  if (!authorityFilename) throw new Error("The current preflight has no persisted semantic authority filename");
  const semanticResearchZip = findRequiredFile(current.inputDirectory, authorityFilename);
  return bootstrapCanonicalRun({ store: getStore(), seed, packDirectory: current.inputDirectory, semanticResearchZip, resourceDirectory: runtimeResources });
});
ipcMain.handle("simulator:submit-naming-response", (_event, responseText: string) => {
  const job = getStore().getAnyPendingNamingJob();
  if (!job) throw new Error("No pending naming job exists");
  let parsed: unknown;
  try { parsed = JSON.parse(responseText); } catch { throw new Error("Naming response is not valid JSON"); }
  const result = validateNamingResponse(job, parsed);
  const attemptId = `NAMING_ATTEMPT_${randomUUID()}`;
  if (!result.accepted || !result.decisions) {
    getStore().recordRejectedNamingAttempt(job.namingJobId, attemptId, responseText, result.errors);
    return { accepted: false, errors: result.errors };
  }
  const items = new Map(job.items.map((item) => [item.requestId, item]));
  getStore().acceptNamingResponse(job.namingJobId, attemptId, responseText, result.decisions.map((decision) => ({ requestId: decision.requestId, entityType: decision.entityType, entityId: items.get(decision.requestId)!.entityId, name: decision.name })));
  return { accepted: true, errors: [] };
});
ipcMain.handle("simulator:export-diagnostic", async () => { throw new Error("No persisted run export is available"); });

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => { store?.close(); store = null; });
