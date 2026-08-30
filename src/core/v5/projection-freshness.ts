import type { WorldKey } from "./types.js";

export type ProjectionFreshness = "CURRENT" | "STALE" | "CATCHING_UP" | "FAILED";

export interface ProjectionWatermarkV1 {
  schemaVersion: "echoes-projection-watermark-v1";
  runId: string;
  worldKey: WorldKey;
  runCurrentYear: number;
  projectedThroughYear: number;
  freshness: ProjectionFreshness;
  failureCode: string | null;
  failureMessage: string | null;
  retryCount: number;
}

export interface ProjectionReadBoundaryV1 {
  runCurrentYear: number;
  commonProjectedThroughYear: number;
  selectedDataYear: number;
  freshness: "CURRENT" | "STALE";
  mixedYearReadsAllowed: false;
}

export function initialProjectionWatermarkV1(runId: string, worldKey: WorldKey): ProjectionWatermarkV1 {
  return { schemaVersion: "echoes-projection-watermark-v1", runId, worldKey, runCurrentYear: 0, projectedThroughYear: 0, freshness: "CURRENT", failureCode: null, failureMessage: null, retryCount: 0 };
}

export function markCommittedCausalYearV1(watermark: ProjectionWatermarkV1, committedYear: number): ProjectionWatermarkV1 {
  if (!Number.isInteger(committedYear) || committedYear !== watermark.runCurrentYear + 1) throw new Error("Causal years must commit monotonically before projection");
  return { ...watermark, runCurrentYear: committedYear, freshness: watermark.projectedThroughYear === committedYear ? "CURRENT" : "STALE" };
}

export function markProjectionFailureV1(watermark: ProjectionWatermarkV1, error: unknown): ProjectionWatermarkV1 {
  const message = error instanceof Error ? error.message : String(error);
  return { ...watermark, freshness: "STALE", failureCode: "POSTGRES_PROJECTION_FAILED", failureMessage: message, retryCount: watermark.retryCount + 1 };
}

export function markProjectionCatchupStartedV1(watermark: ProjectionWatermarkV1): ProjectionWatermarkV1 {
  if (watermark.projectedThroughYear >= watermark.runCurrentYear) return { ...watermark, freshness: "CURRENT", failureCode: null, failureMessage: null };
  return { ...watermark, freshness: "CATCHING_UP" };
}

export function advanceProjectionWatermarkV1(watermark: ProjectionWatermarkV1, completelyProjectedYear: number): ProjectionWatermarkV1 {
  if (!Number.isInteger(completelyProjectedYear) || completelyProjectedYear < watermark.projectedThroughYear || completelyProjectedYear > watermark.runCurrentYear) throw new Error("Projection watermark must advance monotonically within committed causal history");
  return { ...watermark, projectedThroughYear: completelyProjectedYear, freshness: completelyProjectedYear === watermark.runCurrentYear ? "CURRENT" : "CATCHING_UP", failureCode: null, failureMessage: null };
}

export function commonProjectionReadBoundaryV1(watermarks: readonly ProjectionWatermarkV1[], requestedYear: number): ProjectionReadBoundaryV1 {
  if (watermarks.length === 0) throw new Error("At least one projection watermark is required");
  const runYears = new Set(watermarks.map((watermark) => watermark.runCurrentYear));
  if (runYears.size !== 1) throw new Error("Projection watermarks from different causal years cannot be mixed");
  const runCurrentYear = watermarks[0]!.runCurrentYear;
  const commonProjectedThroughYear = Math.min(...watermarks.map((watermark) => watermark.projectedThroughYear));
  return { runCurrentYear, commonProjectedThroughYear, selectedDataYear: Math.min(Math.max(0, requestedYear), commonProjectedThroughYear), freshness: commonProjectedThroughYear === runCurrentYear ? "CURRENT" : "STALE", mixedYearReadsAllowed: false };
}
