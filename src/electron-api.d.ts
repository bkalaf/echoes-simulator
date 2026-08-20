export {};

declare global {
  interface Window {
    eidolonSimulator?: {
      getRuntimeInfo(): Promise<{ version: string; userDataPath: string }>;
      getOperatorSnapshot(): Promise<unknown>;
      selectInputDirectory(): Promise<string | null>;
      validateInputs(packDirectory: string): Promise<unknown>;
      runCanonical(seed: string): Promise<unknown>;
      submitNamingResponse(responseText: string): Promise<unknown>;
      runDiagnostic(seed: string): Promise<unknown>;
      selectRun(runId: string): Promise<unknown>;
      revalidateInputs(): Promise<unknown>;
      exportDiagnostic(): Promise<string | null>;
    };
  }
}
