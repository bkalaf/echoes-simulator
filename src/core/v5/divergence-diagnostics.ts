import type { DivergenceClass, DivergenceReportV1 } from "./read-model.js";
import type { CausalEventV5, WorldKey } from "./types.js";

export interface DivergenceTransitionV5 {
  year: number;
  from: DivergenceClass;
  to: DivergenceClass;
  differingEventId: string | null;
  differingEventType: string | null;
}

export interface DivergenceTraceV5 {
  comparisonId: string;
  category: string;
  currentClassification: DivergenceClass;
  firstDivergenceYear: number | null;
  firstDifferingCausalInput: string | null;
  firstDifferingDecisionOrEvent: { eventId: string; eventType: string } | null;
  previousClassification: DivergenceClass;
  yearMinorBecameMaterial: number | null;
  causalChainResponsible: string[];
  transitions: DivergenceTransitionV5[];
  traceStatus: "CAUSAL_EVENT_TRACE_AVAILABLE" | "NO_REGISTERED_CAUSAL_EVENT_FOR_TRANSITION";
}

/** Updates one bounded trace per registered comparison identity; it never records an inner-loop observation. */
export function updateDivergenceTracesV5(
  prior: ReadonlyMap<string, DivergenceTraceV5>,
  report: DivergenceReportV1,
  events: Readonly<Record<WorldKey, readonly CausalEventV5[]>>,
  year: number,
): { current: Map<string, DivergenceTraceV5>; changed: DivergenceTraceV5[] } {
  const current = new Map(prior);
  const changed: DivergenceTraceV5[] = [];
  const eventIndex = new Map(((["CONCORD", "SCHISM", "RUIN"] as const).flatMap((world) => events[world])).map((event) => [event.eventId, event]));
  for (const item of report.items) {
    const previous = current.get(item.comparisonId);
    const priorClass = previous?.currentClassification ?? "IDENTICAL";
    if (item.classification === priorClass && previous) continue;
    if (item.classification === "IDENTICAL" && !previous) continue;
    const event = item.causeEventIds.map((eventId) => eventIndex.get(eventId)).find((candidate): candidate is CausalEventV5 => Boolean(candidate)) ?? null;
    const transition: DivergenceTransitionV5 = { year, from: priorClass, to: item.classification, differingEventId: event?.eventId ?? null, differingEventType: event?.eventType ?? null };
    const firstDivergence = previous?.firstDivergenceYear ?? (item.classification !== "IDENTICAL" ? year : null);
    const trace: DivergenceTraceV5 = {
      comparisonId: item.comparisonId,
      category: item.category,
      currentClassification: item.classification,
      firstDivergenceYear: firstDivergence,
      firstDifferingCausalInput: previous?.firstDifferingCausalInput ?? event?.keyedDecisionIdentity ?? null,
      firstDifferingDecisionOrEvent: previous?.firstDifferingDecisionOrEvent ?? (event ? { eventId: event.eventId, eventType: event.eventType } : null),
      previousClassification: priorClass,
      yearMinorBecameMaterial: previous?.yearMinorBecameMaterial ?? (priorClass === "MINOR_VARIANT" && item.classification === "MATERIAL_DIVERGENCE" ? year : null),
      causalChainResponsible: previous?.causalChainResponsible.length ? previous.causalChainResponsible : event ? [event.eventId, ...event.causeEventIds].slice(0, 32) : [],
      transitions: [...(previous?.transitions ?? []), transition].slice(0, 16),
      traceStatus: previous?.traceStatus === "CAUSAL_EVENT_TRACE_AVAILABLE" || event ? "CAUSAL_EVENT_TRACE_AVAILABLE" : "NO_REGISTERED_CAUSAL_EVENT_FOR_TRANSITION",
    };
    current.set(item.comparisonId, trace);
    changed.push(trace);
  }
  return { current, changed };
}

export function aggregateDivergenceTransitionsV5(traces: readonly DivergenceTraceV5[]): Record<"IDENTICAL_TO_MINOR" | "IDENTICAL_TO_MATERIAL" | "MINOR_TO_MATERIAL", number> {
  const result = { IDENTICAL_TO_MINOR: 0, IDENTICAL_TO_MATERIAL: 0, MINOR_TO_MATERIAL: 0 };
  for (const transition of traces.flatMap((trace) => trace.transitions)) {
    if (transition.from === "IDENTICAL" && transition.to === "MINOR_VARIANT") result.IDENTICAL_TO_MINOR += 1;
    if (transition.from === "IDENTICAL" && transition.to === "MATERIAL_DIVERGENCE") result.IDENTICAL_TO_MATERIAL += 1;
    if (transition.from === "MINOR_VARIANT" && transition.to === "MATERIAL_DIVERGENCE") result.MINOR_TO_MATERIAL += 1;
  }
  return result;
}
