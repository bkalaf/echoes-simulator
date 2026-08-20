const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = Object.freeze({
  getRuntimeInfo: (): Promise<{ version: string; userDataPath: string }> => ipcRenderer.invoke("simulator:get-runtime-info"),
  getOperatorSnapshot: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-operator-snapshot"),
  runCanonical: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-canonical", seed),
  submitNamingResponse: (responseText: string): Promise<unknown> => ipcRenderer.invoke("simulator:submit-naming-response", responseText),
  runDiagnostic: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-diagnostic", seed),
  selectRun: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:select-run", runId),
  getRunView: (runId: string, world: string, year: number): Promise<unknown> => ipcRenderer.invoke("simulator:get-run-view", runId, world, year),
  exportRun: (): Promise<unknown> => ipcRenderer.invoke("simulator:export-run"),
});

contextBridge.exposeInMainWorld("eidolonSimulator", api);
