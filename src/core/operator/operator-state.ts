export type ProductState = "BOOTING" | "READY" | "DIAGNOSTIC_RUNNING" | "DIAGNOSTIC_COMPLETE" | "CANONICAL_RUNNING" | "WAITING_FOR_NAMING" | "CANONICAL_COMPLETE" | "FAILED";

export interface CanonicalDataStatus {
  status: "READY" | "INVALID";
  semanticAuthorityVersion: string | null;
  semanticAuthorityFilename: string | null;
  semanticAuthoritySha256: string | null;
  semanticAuthorityVerdict: string | null;
  year0Readiness: string | null;
  ownerPolicyVersion: string | null;
  personalityPolicyVersion: string | null;
  bundleVersion: string | null;
  bundleContentSha256: string | null;
  errorCode?: "BUNDLED_CANONICAL_DATA_INVALID";
  errorDetail?: string;
}

export interface OperatorRun {
  runId: string;
  mode: "CANONICAL" | "DIAGNOSTIC" | string;
  status: string;
  currentYear?: number;
}

export interface OperatorSnapshot {
  canonicalData: CanonicalDataStatus;
  manifest: OperatorRun | null;
  runs: OperatorRun[];
  selectedRunId: string | null;
  pendingNamingJob?: unknown | null;
  hasActiveRun?: boolean;
}

export interface OperatorViewModel {
  productState: ProductState;
  runState: ProductState;
  canRunDiagnostic: boolean;
  canRunCanonical: boolean;
  canSubmitNaming: boolean;
  canExport: boolean;
  primaryNotice: { severity: "INFO" | "WARNING" | "ERROR" | "SUCCESS"; title: string; detail: string };
  canonicalDisabledReasons: string[];
  diagnosticDisabledReasons: string[];
  semanticAuthorityLabel: string;
}

function stateForRun(run: OperatorRun | null, pendingNaming: boolean): ProductState {
  if (pendingNaming || (run?.mode === "CANONICAL" && run.status === "WAITING_FOR_NAMING")) return "WAITING_FOR_NAMING";
  if (!run || run.status === "RETIRED_DATA_AUTHORITY") return "READY";
  if (run.status === "FAILED") return "FAILED";
  if (run.mode === "DIAGNOSTIC") return run.status === "COMPLETE" ? "DIAGNOSTIC_COMPLETE" : "DIAGNOSTIC_RUNNING";
  return run.status === "COMPLETE" ? "CANONICAL_COMPLETE" : "CANONICAL_RUNNING";
}

export function deriveOperatorViewModel(snapshot: OperatorSnapshot): OperatorViewModel {
  const runState = stateForRun(snapshot.manifest, Boolean(snapshot.pendingNamingJob));
  const active = Boolean(snapshot.hasActiveRun) || ["DIAGNOSTIC_RUNNING", "CANONICAL_RUNNING", "WAITING_FOR_NAMING"].includes(runState);
  const diagnosticDisabledReasons = active ? ["Another run is active."] : [];
  const canonicalDisabledReasons: string[] = [];
  if (snapshot.canonicalData.status !== "READY") canonicalDisabledReasons.push(`BUNDLED_CANONICAL_DATA_INVALID: ${snapshot.canonicalData.errorDetail ?? "The packaged canonical bundle failed its runtime integrity assertion."}`);
  if (active) canonicalDisabledReasons.push(runState === "WAITING_FOR_NAMING" ? "Complete the pending naming job first." : "Another run is active.");

  let primaryNotice: OperatorViewModel["primaryNotice"];
  if (runState === "WAITING_FOR_NAMING") primaryNotice = { severity: "WARNING", title: "Run paused for required naming.", detail: "Import the exact naming response to resume from the persisted checkpoint." };
  else if (snapshot.canonicalData.status !== "READY") primaryNotice = { severity: "ERROR", title: "Bundled canonical data is invalid.", detail: `BUNDLED_CANONICAL_DATA_INVALID · ${snapshot.canonicalData.errorDetail ?? "This is an internal build/package defect."}` };
  else if (runState === "DIAGNOSTIC_RUNNING") primaryNotice = { severity: "INFO", title: "Diagnostic run is executing.", detail: "Diagnostic state is persisted independently from canonical history." };
  else if (runState === "CANONICAL_RUNNING") primaryNotice = { severity: "INFO", title: "Canonical simulation is executing.", detail: "The V4 canonical engine is persisting history and checkpoints." };
  else if (runState === "FAILED") primaryNotice = { severity: "ERROR", title: "The selected run failed.", detail: "Diagnostics contains the persisted failure context." };
  else primaryNotice = { severity: "SUCCESS", title: "Canonical data is simulation-ready.", detail: "V4 · ACCEPT_SIMULATION_READY · Year-0 Readiness PASS. Press RUN CANONICAL to begin." };

  return {
    productState: runState, runState,
    canRunDiagnostic: diagnosticDisabledReasons.length === 0,
    canRunCanonical: canonicalDisabledReasons.length === 0,
    canSubmitNaming: runState === "WAITING_FOR_NAMING",
    canExport: Boolean(snapshot.manifest?.mode === "CANONICAL" && snapshot.manifest.status === "COMPLETE"),
    primaryNotice, canonicalDisabledReasons, diagnosticDisabledReasons,
    semanticAuthorityLabel: snapshot.canonicalData.status === "READY" ? `${snapshot.canonicalData.semanticAuthorityVersion} · SIMULATION READY` : "invalid bundled authority",
  };
}
