import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
import type { RealPreflightReport } from "../src/core/inputs/preflight.js";

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
ipcMain.handle("simulator:get-operator-snapshot", () => {
  const sitesPath = join(runtimeResources, "inputs/sites_naming_master.csv");
  const sites = existsSync(sitesPath) ? parseCsvSync(readFileSync(sitesPath), { bom: true, columns: true, skip_empty_lines: true }) : [];
  const latestPreflight = getStore().getLatestPreflight();
  return { manifest: null, preflight: latestPreflight?.report ?? null, exportValidation: null, sites };
});
ipcMain.handle("simulator:select-input-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("simulator:run-diagnostic", (_event, seed: string) => runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }));
ipcMain.handle("simulator:validate-inputs", async (_event, packDirectory: string) => {
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
    report,
  });
  return report;
});
ipcMain.handle("simulator:export-diagnostic", async () => { throw new Error("No persisted run export is available"); });

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => { store?.close(); store = null; });
