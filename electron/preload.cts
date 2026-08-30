const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = Object.freeze({
  getRuntimeInfo: (): Promise<{ version: string; userDataPath: string }> => ipcRenderer.invoke("simulator:get-runtime-info"),
  getDomainDatabasePreflight: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-domain-database-preflight"),
  getOperatorSnapshot: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-operator-snapshot"),
  runDomainDatabaseAction: (action: "DOCTOR" | "MIGRATE" | "SEED" | "RETRY"): Promise<unknown> => ipcRenderer.invoke("simulator:domain-database-action", action),
  getOwnerPolicyCenter: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-owner-policy-center"),
  decideOwnerPolicy: (input: unknown): Promise<unknown> => ipcRenderer.invoke("simulator:decide-owner-policy", input),
  createOwnerPolicyRevision: (input: unknown): Promise<unknown> => ipcRenderer.invoke("simulator:create-owner-policy-revision", input),
  saveV5Configuration: (input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }): Promise<unknown> => ipcRenderer.invoke("simulator:save-v5-configuration", input),
  runCanonical: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-canonical", seed),
  resumeCanonical: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:resume-canonical", runId),
  resumeV5: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:resume-v5", runId),
  submitNamingResponse: (responseText: string): Promise<unknown> => ipcRenderer.invoke("simulator:submit-naming-response", responseText),
  submitDerogatoryDecisionResponse: (responseText: string): Promise<unknown> => ipcRenderer.invoke("simulator:submit-derogatory-decision-response", responseText),
  exportNamingPrompt: (promptText: string, batchId: string): Promise<unknown> => ipcRenderer.invoke("simulator:export-naming-prompt", promptText, batchId),
  exportAllNamingPrompts: (): Promise<unknown> => ipcRenderer.invoke("simulator:export-all-naming-prompts"),
  uploadAllNamingResponses: (): Promise<unknown> => ipcRenderer.invoke("simulator:upload-all-naming-responses"),
  runDiagnostic: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-diagnostic", seed),
  runV5Diagnostic: (seed: string, throughYear = 25, interactiveNaming = true): Promise<unknown> => ipcRenderer.invoke("simulator:run-v5-diagnostic", seed, throughYear, interactiveNaming),
  getNamingGeography: (year?: number): Promise<unknown> => ipcRenderer.invoke("simulator:get-naming-geography", year),
  selectRun: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:select-run", runId),
  getRunView: (runId: string, world: string, year: number, detail?: string): Promise<unknown> => ipcRenderer.invoke("simulator:get-run-view", runId, world, year, detail),
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
