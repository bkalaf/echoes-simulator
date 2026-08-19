import type { RunStatus, SimulationMode } from "../contracts/domain.js";

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  CREATED: ["VALIDATING_INPUTS", "FAILED"],
  VALIDATING_INPUTS: ["READY", "FAILED"],
  READY: ["RUNNING", "FAILED"],
  RUNNING: ["PAUSED", "WAITING_FOR_NAMING", "COMPLETE", "FAILED"],
  PAUSED: ["RUNNING", "FAILED"],
  WAITING_FOR_NAMING: ["READY", "FAILED"],
  FAILED: [],
  COMPLETE: [],
};

export function transitionRun(current: RunStatus, next: RunStatus): RunStatus {
  if (!TRANSITIONS[current].includes(next)) throw new Error(`Illegal run transition ${current} -> ${next}`);
  return next;
}

export interface RunGateInput {
  status: RunStatus;
  mode: SimulationMode;
  blockers: readonly string[];
  pendingNaming: number;
  inputsValidated: boolean;
  diagnosticPoliciesComplete?: boolean;
}

export function canRun(input: RunGateInput): { allowed: boolean; reason: string | null } {
  if (!input.inputsValidated) return { allowed: false, reason: "Input validation is incomplete" };
  if (input.pendingNaming > 0) return { allowed: false, reason: "A blocking naming job is pending" };
  if (!(["READY", "PAUSED"] as RunStatus[]).includes(input.status)) return { allowed: false, reason: `Run status ${input.status} cannot advance` };
  if (input.mode === "CANONICAL" && input.blockers.length > 0) return { allowed: false, reason: `Canonical readiness blockers: ${input.blockers.join(", ")}` };
  if (input.mode === "DIAGNOSTIC" && input.blockers.length > 0 && input.diagnosticPoliciesComplete === false) return { allowed: false, reason: "Diagnostic substitutions do not cover every blocker" };
  return { allowed: true, reason: null };
}
