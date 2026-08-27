export {};

declare global {
  interface Window {
    eidolonSimulator?: {
      getRuntimeInfo(): Promise<{ version: string; userDataPath: string }>;
      getOperatorSnapshot(): Promise<unknown>;
      saveV5Configuration(input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }): Promise<unknown>;
      runCanonical(seed: string): Promise<unknown>;
      resumeCanonical(runId: string): Promise<unknown>;
      resumeV5(runId: string): Promise<unknown>;
      submitNamingResponse(responseText: string): Promise<unknown>;
      runDiagnostic(seed: string): Promise<unknown>;
      runV5Diagnostic(seed: string, throughYear?: number): Promise<unknown>;
      selectRun(runId: string): Promise<unknown>;
      getRunView(runId: string, world: string, year: number): Promise<unknown>;
      getBreedCatalog(): Promise<unknown>;
      getBreedPopulation(runId: string, breedId: string, year: number): Promise<unknown>;
      getAtlasData(year?: number): Promise<unknown>;
      onCanonicalResumeFailed(callback: (message: string) => void): () => void;
      onV5ResumeFailed(callback: (message: string) => void): () => void;
      exportRun(): Promise<unknown>;
    };
  }
}
