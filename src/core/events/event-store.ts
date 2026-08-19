import { createHash } from "node:crypto";

export interface OrderedEvent {
  year: number;
  phaseOrder: number;
  sequence: number;
}

export const PHASE_ORDER = {
  STRUCTURAL_START: 10,
  GROWTH: 20,
  FOUNDER_TRANSFER: 30,
  DJT_TRANSFER: 35,
  STATE_MEMBERSHIP: 40,
  MIGRATION: 50,
  PROJECTION_CHANGE: 60,
  WEALTH: 70,
  SOCIAL: 80,
  INSTITUTION: 90,
  NAMING: 100,
  CHECKPOINT: 110,
} as const;

export function sortEvents<T extends OrderedEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.year - b.year || a.phaseOrder - b.phaseOrder || a.sequence - b.sequence);
}

export function stableEventId(runId: string, world: string | null, year: number, eventType: string, entityId: string, ordinal: number): string {
  const digest = createHash("sha256").update([runId, world ?? "SHARED", year, eventType, entityId, ordinal].join("\0")).digest("hex").slice(0, 24);
  return `EVT_${digest}`;
}

export function assertUniqueEventOrder<T extends OrderedEvent & { worldKey?: string | null }>(events: readonly T[]): void {
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.worldKey ?? "SHARED"}:${event.year}:${event.phaseOrder}:${event.sequence}`;
    if (seen.has(key)) throw new Error(`Duplicate event order key ${key}`);
    seen.add(key);
  }
}
