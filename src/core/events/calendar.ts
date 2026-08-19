import { ScopedRandom } from "../determinism/scoped-random.js";

export interface SkeletonEvent { eventKey: string; nominalYear: number; jitter: boolean; kind: string; label: string; }
export interface ResolvedEvent extends SkeletonEvent { resolvedYear: number; jitterAmount: number; policyVersion: "SHARED_CALENDAR_V1"; }
export function resolveSharedCalendar(seed: string, events: readonly SkeletonEvent[]): ResolvedEvent[] {
  const random = new ScopedRandom(seed);
  return events.map((event) => {
    const jitterAmount = event.jitter ? random.integer({ world: "SHARED", year: event.nominalYear, purpose: "EVENT_JITTER", entityId: event.eventKey }, -2, 2) : 0;
    return { ...event, resolvedYear: event.nominalYear + jitterAmount, jitterAmount, policyVersion: "SHARED_CALENDAR_V1" };
  });
}
