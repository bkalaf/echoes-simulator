const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api = Object.freeze({
  getRuntimeInfo: (): Promise<{ version: string; userDataPath: string }> => ipcRenderer.invoke("simulator:get-runtime-info"),
  getOperatorSnapshot: (): Promise<unknown> => ipcRenderer.invoke("simulator:get-operator-snapshot"),
  selectInputDirectory: (): Promise<string | null> => ipcRenderer.invoke("simulator:select-input-directory"),
  validateInputs: (packDirectory: string): Promise<unknown> => ipcRenderer.invoke("simulator:validate-inputs", packDirectory),
  runCanonical: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-canonical", seed),
  submitNamingResponse: (responseText: string): Promise<unknown> => ipcRenderer.invoke("simulator:submit-naming-response", responseText),
  runDiagnostic: (seed: string): Promise<unknown> => ipcRenderer.invoke("simulator:run-diagnostic", seed),
  selectRun: (runId: string): Promise<unknown> => ipcRenderer.invoke("simulator:select-run", runId),
  revalidateInputs: (): Promise<unknown> => ipcRenderer.invoke("simulator:revalidate-inputs"),
  exportDiagnostic: (): Promise<string | null> => ipcRenderer.invoke("simulator:export-diagnostic"),
});

contextBridge.exposeInMainWorld("eidolonSimulator", api);
