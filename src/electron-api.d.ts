export {};

declare global {
  interface Window {
    eidolonSimulator?: {
      getRuntimeInfo(): Promise<{ version: string; userDataPath: string }>;
      getOperatorSnapshot(): Promise<unknown>;
      selectInputDirectory(): Promise<string | null>;
      validateInputs(packDirectory: string): Promise<unknown>;
      runDiagnostic(seed: string): Promise<unknown>;
      exportDiagnostic(): Promise<string | null>;
    };
  }
}
