export {};

declare global {
  interface Window {
    eidolonSimulator?: {
      getRuntimeInfo(): Promise<{ version: string; userDataPath: string }>;
      getDomainDatabasePreflight(): Promise<unknown>;
      getOperatorSnapshot(): Promise<unknown>;
      runDomainDatabaseAction(action: "DOCTOR" | "MIGRATE" | "SEED" | "RETRY"): Promise<unknown>;
      getOwnerPolicyCenter(): Promise<unknown>;
      decideOwnerPolicy(input: unknown): Promise<unknown>;
      createOwnerPolicyRevision(input: unknown): Promise<unknown>;
      saveV5Configuration(input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }): Promise<unknown>;
      runCanonical(seed: string): Promise<unknown>;
      resumeCanonical(runId: string): Promise<unknown>;
      resumeV5(runId: string): Promise<unknown>;
      submitNamingResponse(responseText: string): Promise<unknown>;
      submitDerogatoryDecisionResponse(responseText: string): Promise<unknown>;
      exportNamingPrompt(promptText: string, batchId: string): Promise<unknown>;
      exportAllNamingPrompts(): Promise<unknown>;
      uploadAllNamingResponses(): Promise<unknown>;
      runDiagnostic(seed: string): Promise<unknown>;
      runV5Diagnostic(seed: string, throughYear?: number, interactiveNaming?: boolean): Promise<unknown>;
      getNamingGeography(year?: number): Promise<unknown>;
      selectRun(runId: string): Promise<unknown>;
      getRunView(runId: string, world: string, year: number, detail?: string): Promise<unknown>;
      getBreedCatalog(): Promise<unknown>;
      getBreedPopulation(runId: string, breedId: string, year: number): Promise<unknown>;
      getAtlasData(year?: number): Promise<unknown>;
      onCanonicalResumeFailed(callback: (message: string) => void): () => void;
      onV5ResumeFailed(callback: (message: string) => void): () => void;
      exportRun(): Promise<unknown>;
    };
  }
}
