export type PreflightState = "NOT_VALIDATED" | "VALIDATING" | "BLOCKED" | "READY" | "STALE" | "ERROR";
export type RunState = "NO_RUN" | "DIAGNOSTIC_RUNNING" | "DIAGNOSTIC_COMPLETE" | "CANONICAL_RUNNING" | "WAITING_FOR_NAMING" | "CANONICAL_COMPLETE" | "FAILED" | "PAUSED";

export interface OperatorIssue {
  issueCode: string;
  severity: string;
  blocksCanonical: boolean;
  message: string;
  details?: unknown;
}

export interface OperatorPreflight {
  schemaVersion?: string;
  structuralStatus?: string;
  canonicalReady: boolean;
  activeIssues: OperatorIssue[];
  semanticAuthorityVersion?: string | null;
  semanticAuthorityFilename?: string | null;
  semanticAuthoritySha256?: string | null;
  semanticAuthorityVerdict?: string | null;
  year0Readiness?: string | null;
  policyVersion?: string | null;
  engineReadinessVersion?: string | null;
  inputsCurrent?: boolean;
  sourceRoles?: {
    v3SemanticAuthority?: { filename: string; sha256: string } | null;
    v4SemanticAuthority?: { filename: string; sha256: string; verdict?: string } | null;
  };
}

export interface OperatorRun {
  runId: string;
  mode: "CANONICAL" | "DIAGNOSTIC" | string;
  status: string;
  currentYear?: number;
}

export interface OperatorSnapshot {
  preflight: OperatorPreflight | null;
  manifest: OperatorRun | null;
  runs: OperatorRun[];
  selectedRunId: string | null;
  pendingNamingJob?: unknown | null;
  validationInProgress?: boolean;
  validationError?: string | null;
  hasActiveRun?: boolean;
}

export interface OperatorViewModel {
  preflightState: PreflightState;
  runState: RunState;
  canValidate: boolean;
  canRunDiagnostic: boolean;
  canRunCanonical: boolean;
  canSubmitNaming: boolean;
  canExport: boolean;
  primaryNotice: { severity: "INFO" | "WARNING" | "ERROR" | "SUCCESS"; title: string; detail: string };
  canonicalDisabledReasons: string[];
  diagnosticDisabledReasons: string[];
  blockingIssues: OperatorIssue[];
  setupCanonicalStatus: "NOT VALIDATED" | "VALIDATING" | "BLOCKED" | "READY" | "STALE" | "ERROR";
  setupCanonicalDetail: string;
  semanticAuthorityLabel: string;
  diagnostics: { preflightState: PreflightState; runState: RunState };
}

export const CURRENT_OPERATOR_REQUIREMENTS = {
  semanticAuthorityVersion: "V4",
  semanticAuthorityVerdict: "ACCEPT_SIMULATION_READY",
  year0Readiness: "PASS",
  preflightSchemaVersion: "eidolon-simulator-real-preflight-v3",
  policyVersion: "OWNER_POLICY_2026_08_19_V4",
  engineReadinessVersion: "eidolon-simulator-engine-readiness-v1",
} as const;

function authority(preflight: OperatorPreflight | null): { version: string | null; filename: string | null; sha256: string | null; verdict: string | null } {
  if (!preflight) return { version: null, filename: null, sha256: null, verdict: null };
  if (preflight.semanticAuthorityVersion) return {
    version: preflight.semanticAuthorityVersion,
    filename: preflight.semanticAuthorityFilename ?? null,
    sha256: preflight.semanticAuthoritySha256 ?? null,
    verdict: preflight.semanticAuthorityVerdict ?? null,
  };
  const v4 = preflight.sourceRoles?.v4SemanticAuthority;
  if (v4) return { version: "V4", filename: v4.filename, sha256: v4.sha256, verdict: v4.verdict ?? null };
  const v3 = preflight.sourceRoles?.v3SemanticAuthority;
  if (v3) return { version: "V3", filename: v3.filename, sha256: v3.sha256, verdict: "RETIRED_FALSE_COMPLETION" };
  return { version: null, filename: null, sha256: null, verdict: null };
}

function deriveRunState(run: OperatorRun | null, hasNamingBarrier: boolean): RunState {
  if (hasNamingBarrier || (run?.mode === "CANONICAL" && run.status === "WAITING_FOR_NAMING")) return "WAITING_FOR_NAMING";
  if (!run) return "NO_RUN";
  if (run.status === "FAILED") return "FAILED";
  if (run.status === "PAUSED" || run.status === "READY") return "PAUSED";
  if (run.mode === "DIAGNOSTIC") return run.status === "COMPLETE" ? "DIAGNOSTIC_COMPLETE" : "DIAGNOSTIC_RUNNING";
  return run.status === "COMPLETE" ? "CANONICAL_COMPLETE" : "CANONICAL_RUNNING";
}

export function deriveOperatorViewModel(snapshot: OperatorSnapshot): OperatorViewModel {
  const reportedBlockers = snapshot.preflight?.activeIssues.filter((issue) => issue.blocksCanonical) ?? [];
  const consistencyIssue: OperatorIssue = {
    issueCode: "PREFLIGHT_INCONSISTENT_BLOCKED_WITHOUT_REASON",
    severity: "ERROR",
    blocksCanonical: true,
    message: "The persisted preflight is blocked but contains no blocking reason. Revalidate the inputs.",
  };
  const blockingIssues = snapshot.preflight && !snapshot.preflight.canonicalReady && reportedBlockers.length === 0 ? [consistencyIssue] : reportedBlockers;
  const currentAuthority = authority(snapshot.preflight);
  const staleReasons: string[] = [];
  if (snapshot.preflight?.canonicalReady) {
    if (currentAuthority.version !== CURRENT_OPERATOR_REQUIREMENTS.semanticAuthorityVersion) staleReasons.push("V4 validation required.");
    if (currentAuthority.verdict !== CURRENT_OPERATOR_REQUIREMENTS.semanticAuthorityVerdict) staleReasons.push("A simulation-ready V4 authority verdict is required.");
    if (snapshot.preflight.year0Readiness !== CURRENT_OPERATOR_REQUIREMENTS.year0Readiness) staleReasons.push("Year 0 readiness must pass.");
    if (snapshot.preflight.schemaVersion !== CURRENT_OPERATOR_REQUIREMENTS.preflightSchemaVersion) staleReasons.push("The preflight schema version changed; revalidation is required.");
    if (snapshot.preflight.policyVersion !== CURRENT_OPERATOR_REQUIREMENTS.policyVersion) staleReasons.push("The policy version changed; revalidation is required.");
    if (snapshot.preflight.engineReadinessVersion !== CURRENT_OPERATOR_REQUIREMENTS.engineReadinessVersion) staleReasons.push("The engine readiness version changed; revalidation is required.");
    if (snapshot.preflight.inputsCurrent === false) staleReasons.push("One or more selected input hashes changed.");
  }

  let preflightState: PreflightState;
  if (snapshot.validationInProgress) preflightState = "VALIDATING";
  else if (snapshot.validationError) preflightState = "ERROR";
  else if (!snapshot.preflight) preflightState = "NOT_VALIDATED";
  else if (!snapshot.preflight.canonicalReady && reportedBlockers.length === 0) preflightState = "ERROR";
  else if (!snapshot.preflight.canonicalReady) preflightState = "BLOCKED";
  else if (staleReasons.length) preflightState = "STALE";
  else preflightState = "READY";

  const runState = deriveRunState(snapshot.manifest, Boolean(snapshot.pendingNamingJob));
  const runIsActive = Boolean(snapshot.hasActiveRun) || ["DIAGNOSTIC_RUNNING", "CANONICAL_RUNNING", "WAITING_FOR_NAMING", "PAUSED"].includes(runState);
  const diagnosticDisabledReasons = runIsActive ? ["Another run is active."] : [];
  const canonicalDisabledReasons = preflightState === "READY" ? [] : preflightState === "NOT_VALIDATED"
    ? ["Validate a simulation-ready V4 input bundle first."]
    : preflightState === "STALE" ? staleReasons
    : preflightState === "VALIDATING" ? ["Input validation is in progress."]
    : preflightState === "ERROR" ? [snapshot.validationError ?? blockingIssues[0]?.message ?? "Preflight state is inconsistent; revalidate inputs."]
    : blockingIssues.map((issue) => `${issue.issueCode}: ${issue.message}`);
  if (runIsActive) canonicalDisabledReasons.push(runState === "WAITING_FOR_NAMING" ? "Complete the pending naming job first." : "Another run is active.");

  let primaryNotice: OperatorViewModel["primaryNotice"];
  if (runState === "WAITING_FOR_NAMING") primaryNotice = { severity: "WARNING", title: "Run paused for required naming.", detail: "The pending naming job must be accepted before the canonical run can resume." };
  else if (preflightState === "NOT_VALIDATED") primaryNotice = { severity: "INFO", title: "Inputs have not been validated.", detail: "Select the canonical input bundle in Setup & Preflight before starting a canonical run. Diagnostic mode is still available." };
  else if (preflightState === "VALIDATING") primaryNotice = { severity: "INFO", title: "Inputs are being validated.", detail: "Canonical execution remains disabled until validation finishes." };
  else if (preflightState === "READY") primaryNotice = { severity: "SUCCESS", title: "Canonical inputs are validated and simulation-ready.", detail: "The current V4 semantic authority and Year 0 readiness checks passed." };
  else if (preflightState === "STALE") primaryNotice = { severity: "WARNING", title: "Canonical validation is stale.", detail: staleReasons.join(" ") };
  else if (preflightState === "BLOCKED") primaryNotice = { severity: "ERROR", title: "Canonical execution is blocked.", detail: `${blockingIssues.length} canonical ${blockingIssues.length === 1 ? "blocker remains" : "blockers remain"}: ${blockingIssues.map((issue) => issue.issueCode).join(", ")}.` };
  else primaryNotice = { severity: "ERROR", title: "Preflight state is inconsistent.", detail: snapshot.validationError ?? blockingIssues[0]?.message ?? "Revalidate the selected inputs." };

  const setupCanonicalStatus = preflightState === "NOT_VALIDATED" ? "NOT VALIDATED" : preflightState;
  const setupCanonicalDetail = preflightState === "NOT_VALIDATED" ? "No preflight has been run"
    : preflightState === "READY" ? "0 active blockers"
    : preflightState === "BLOCKED" ? `${blockingIssues.length} active ${blockingIssues.length === 1 ? "blocker" : "blockers"}`
    : preflightState === "STALE" ? "Revalidation required"
    : preflightState === "VALIDATING" ? "Validation in progress"
    : "Preflight error requires revalidation";
  const semanticAuthorityLabel = currentAuthority.version
    ? `${currentAuthority.version} · ${currentAuthority.verdict === "ACCEPT_SIMULATION_READY" ? "SIMULATION_READY" : currentAuthority.verdict ?? "NOT ACCEPTED"}`
    : "not loaded";

  return {
    preflightState,
    runState,
    canValidate: !runIsActive && !snapshot.validationInProgress,
    canRunDiagnostic: diagnosticDisabledReasons.length === 0,
    canRunCanonical: canonicalDisabledReasons.length === 0,
    canSubmitNaming: runState === "WAITING_FOR_NAMING",
    canExport: Boolean(snapshot.manifest && snapshot.manifest.status === "COMPLETE"),
    primaryNotice,
    canonicalDisabledReasons,
    diagnosticDisabledReasons,
    blockingIssues,
    setupCanonicalStatus,
    setupCanonicalDetail,
    semanticAuthorityLabel,
    diagnostics: { preflightState, runState },
  };
}
