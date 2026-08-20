export {};

declare global {
  interface Window {
    eidolonSimulator?: {
      getRuntimeInfo(): Promise<{ version: string; userDataPath: string }>;
      getOperatorSnapshot(): Promise<unknown>;
      runCanonical(seed: string): Promise<unknown>;
      submitNamingResponse(responseText: string): Promise<unknown>;
      runDiagnostic(seed: string): Promise<unknown>;
      selectRun(runId: string): Promise<unknown>;
      exportDiagnostic(): Promise<string | null>;
    };
  }
}
