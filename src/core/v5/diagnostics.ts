import type { WorldKey } from "./types.js";

export interface BoundedDiagnosticObservationV5 {
  domain: "FAMILY_FORMATION" | "ORGANIZATION_CORPORATION" | "ORGANIZATION_CRIME" | "MIGRATION" | "FOUNDING";
  worldKey: WorldKey;
  year: number;
  counters: Record<string, number>;
  histograms: Record<string, number[]>;
  absentComponents?: string[];
}

export function boundedHistogram(values: readonly number[]): number[] {
  const bins = Array.from({ length: 1001 }, () => 0);
  for (const value of values) bins[Math.max(0, Math.min(1000, Math.trunc(value)))]! += 1;
  return bins;
}

export function mergeBoundedDiagnosticObservations(prior: BoundedDiagnosticObservationV5 | null, next: BoundedDiagnosticObservationV5): BoundedDiagnosticObservationV5 {
  if (!prior) return structuredClone(next);
  if (prior.domain !== next.domain || prior.worldKey !== next.worldKey) throw new Error("Cannot merge different bounded V5 diagnostic domains");
  const counters = { ...prior.counters };
  for (const [key, value] of Object.entries(next.counters)) counters[key] = (counters[key] ?? 0) + value;
  const histograms = { ...prior.histograms };
  for (const [key, bins] of Object.entries(next.histograms)) {
    if (bins.length !== 1001) throw new Error(`V5 diagnostic histogram ${key} must contain exactly 1001 bins`);
    const merged = [...(histograms[key] ?? Array.from({ length: 1001 }, () => 0))];
    bins.forEach((value, index) => { merged[index] = (merged[index] ?? 0) + value; });
    histograms[key] = merged;
  }
  return { domain: prior.domain, worldKey: prior.worldKey, year: Math.max(prior.year, next.year), counters, histograms, absentComponents: [...new Set([...(prior.absentComponents ?? []), ...(next.absentComponents ?? [])])].sort() };
}
