import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";

let mainWindow: BrowserWindow | null = null;
const projectRoot = resolve(import.meta.dirname, "../..");
const runtimeResources = app.isPackaged ? join(process.resourcesPath, "simulator-resources") : join(projectRoot, "resources");
const finalEvidence = app.isPackaged ? join(process.resourcesPath, "final-verification") : join(projectRoot, "artifacts/implementation/final-verification");

function readJsonIfPresent(filename: string): unknown {
  const file = join(finalEvidence, filename);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
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
  return { manifest: readJsonIfPresent("diagnostic-run-manifest.json"), preflight: readJsonIfPresent("real-input-preflight.json"), exportValidation: readJsonIfPresent("export-validation.json"), sites };
});
ipcMain.handle("simulator:select-input-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle("simulator:run-diagnostic", (_event, seed: string) => runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }));
ipcMain.handle("simulator:validate-inputs", (_event, packDirectory: string) => runWorker("VALIDATE_REAL_INPUTS", { packDirectory, supplementalZip: join(projectRoot, "echoes_of_eidolon_breed_research_2026-08-17.zip") }));
ipcMain.handle("simulator:export-diagnostic", async () => {
  const source = join(finalEvidence, "EIDOLON_SIMULATION_DIAGNOSTIC_2026_08_18.zip");
  if (!existsSync(source)) throw new Error("No verified diagnostic export is available");
  const target = await dialog.showSaveDialog({ defaultPath: "EIDOLON_SIMULATION_DIAGNOSTIC_2026_08_18.zip", filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (target.canceled || !target.filePath) return null;
  copyFileSync(source, target.filePath);
  return target.filePath;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
