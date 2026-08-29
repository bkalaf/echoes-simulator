import type { WorldKey } from "./types.js";

export type V5PerformanceScope = "ENGINE" | "RUNNER" | "PERSISTENCE" | "DIAGNOSTIC";

export interface V5PerformanceTimingSample {
  scope: V5PerformanceScope;
  worldKey: WorldKey | "MULTIWORLD";
  year: number;
  phase: string;
  milliseconds: number;
  bytes?: number;
  rows?: number;
}

export type V5PerformanceTimingObserver = (sample: V5PerformanceTimingSample) => void;
