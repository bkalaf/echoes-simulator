const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = Object.freeze({
  getRuntimeInfo: (): Promise<{ version: string; userDataPath: string }> => ipcRenderer.invoke("simulator:get-runtime-info"),
  getOperatorSnapshot: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-operator-snapshot"),
  saveV5Configuration: (input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }): Promise<unknown> => ipcRenderer.invoke("simulator:save-v5-configuration", input),
  runCanonical: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-canonical", seed),
  resumeCanonical: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:resume-canonical", runId),
  resumeV5: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:resume-v5", runId),
  submitNamingResponse: (responseText: string): Promise<unknown> => ipcRenderer.invoke("simulator:submit-naming-response", responseText),
  runDiagnostic: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-diagnostic", seed),
  runV5Diagnostic: (seed: string, throughYear = 25): Promise<unknown> => ipcRenderer.invoke("simulator:run-v5-diagnostic", seed, throughYear),
  selectRun: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:select-run", runId),
  getRunView: (runId: string, world: string, year: number): Promise<unknown> => ipcRenderer.invoke("simulator:get-run-view", runId, world, year),
  getBreedCatalog: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-breed-catalog"),
  getBreedPopulation: (runId: string, breedId: string, year: number): Promise<unknown> => ipcRenderer.invoke("simulator:get-breed-population", runId, breedId, year),
  getAtlasData: (year?: number): Promise<unknown> => ipcRenderer.invoke("simulator:get-atlas-data", year),
  onCanonicalResumeFailed: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message);
    ipcRenderer.on("simulator:canonical-resume-failed", listener);
    return () => ipcRenderer.removeListener("simulator:canonical-resume-failed", listener);
  },
  onV5ResumeFailed: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message);
    ipcRenderer.on("simulator:v5-resume-failed", listener);
    return () => ipcRenderer.removeListener("simulator:v5-resume-failed", listener);
  },
  exportRun: (): Promise<unknown> => ipcRenderer.invoke("simulator:export-run"),
});

contextBridge.exposeInMainWorld("eidolonSimulator", api);
