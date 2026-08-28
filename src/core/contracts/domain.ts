import { z } from "zod";

export const WORLD_KEYS = ["CONCORD", "SCHISM", "RUIN"] as const;
export type WorldKey = (typeof WORLD_KEYS)[number];
export type Faction = WorldKey;
export const RUN_STATUSES = ["CREATED", "VALIDATING_INPUTS", "READY", "RUNNING", "PAUSED", "WAITING_FOR_NAMING", "WAITING_FOR_POLICY_AUTHORITY", "WAITING_FOR_DEROGATORY_DECISIONS", "FAILED", "COMPLETE"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SimulationMode = "CANONICAL" | "DIAGNOSTIC";
export type ReadinessSeverity = "PASS" | "WARNING" | "BLOCKER";

export interface ReadinessIssue {
  issueCode: string;
  severity: ReadinessSeverity;
  blocksCanonical: boolean;
  message: string;
  details?: unknown;
  status?: "ACTIVE" | "WAIVED_DIAGNOSTIC" | "RESOLVED";
}

export interface InputFileManifest {
  logicalKey: string;
  originalFilename: string;
  sha256: string;
  bytes: number;
  parseStatus: "PENDING" | "PASS" | "WARNING" | "FAIL";
}

export interface SimulationRunManifest {
  schemaVersion: "eidolon-simulator-run-manifest-v1";
  runId: string;
  mode: SimulationMode;
  status: RunStatus;
  seed: string;
  normalizedSeedHash: string;
  policyBundleVersion: string;
  engineVersion: string;
  createdAt: string;
  inputFiles: InputFileManifest[];
  readiness: ReadinessIssue[];
  checkpointInterval: number;
  worlds: readonly WorldKey[];
  yearStart: 0;
  yearEnd: 2000;
}

export interface SimulationEventEnvelope<T = unknown> {
  schemaVersion: "eidolon-simulator-event-v1";
  eventId: string;
  runId: string;
  worldKey: WorldKey | null;
  year: number;
  phase: string;
  phaseOrder: number;
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: T;
  causationEventId?: string | null;
  correlationId?: string | null;
}

export interface CheckpointEnvelope<T = unknown> {
  schemaVersion: "eidolon-simulator-checkpoint-v1";
  checkpointId: string;
  runId: string;
  worldKey: WorldKey;
  year: number;
  stateHash: string;
  state: T;
  engineVersion: string;
  policyVersion: string;
}

export interface NamingJobShell {
  namingJobId: string;
  runId: string;
  year: number;
  status: "PENDING" | "REJECTED" | "ACCEPTED";
  promptSha256: string;
}

export interface SettlementState {
  settlementId: string;
  worldKey: WorldKey;
  siteId: string;
  regionId: string;
  stateId: string;
  foundedYear: number;
  cultureId: string | null;
  totalPopulation: bigint;
}

export interface PoliticalStateState {
  stateId: string;
  worldKey: WorldKey;
  createdYear: number;
  memberSettlementIds: string[];
}

export interface WorldState {
  worldKey: WorldKey;
  year: number;
  settlements: SettlementState[];
  politicalStates: PoliticalStateState[];
  federalCapitalSettlementId: string;
}

export const readinessIssueSchema = z.object({
  issueCode: z.string().min(1),
  severity: z.enum(["PASS", "WARNING", "BLOCKER"]),
  blocksCanonical: z.boolean(),
  message: z.string(),
  details: z.unknown().optional(),
});
