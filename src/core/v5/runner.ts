import type { CanonicalDataV5, CausalOwnerInputsV1, DiagnosticConfigV1, MechanicsVariablesV1, OperationalConfigV1 } from "./config.js";
import { bootstrapWorldV5 } from "./bootstrap.js";
import { advanceWorldOneYear, type ScheduledTransactionV5, type V5EngineContext } from "./engine.js";
import type { CausalEventV5, NamingRequestV5, WorldKey, WorldStateV5 } from "./types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

export interface V5HistoryRunInput {
  canonical: CanonicalDataV5;
  ownerInputs: CausalOwnerInputsV1;
  mechanics: MechanicsVariablesV1;
  operational: OperationalConfigV1;
  diagnostic: DiagnosticConfigV1;
  normalizedSeed: string;
  mode: "CANONICAL" | "DIAGNOSTIC";
  throughYear: number;
  scheduledTransactions?: Partial<Record<WorldKey, readonly ScheduledTransactionV5[]>>;
  stopAtBlockingNaming?: boolean;
  retainHistory?: boolean;
  onBootstrap?: (snapshot: V5AtomicYearSnapshot) => void;
  onAtomicYear?: (snapshot: V5AtomicYearSnapshot) => void;
}

export interface V5AtomicYearSnapshot {
  year: number;
  states: Readonly<Record<WorldKey, WorldStateV5>>;
  yearEvents: Readonly<Record<WorldKey, readonly CausalEventV5[]>>;
  yearNamingRequests: Readonly<Record<WorldKey, readonly NamingRequestV5[]>>;
  checkpointDue: boolean;
}

export interface V5HistoryRunResult {
  status: "COMPLETE" | "WAITING_FOR_NAMING";
  completedYear: number;
  states: Record<WorldKey, WorldStateV5>;
  events: Record<WorldKey, CausalEventV5[]>;
  namingRequests: Record<WorldKey, NamingRequestV5[]>;
  eventCounts: Record<WorldKey, number>;
}

export interface V5HistoryContinuationInput extends Omit<V5HistoryRunInput, "onBootstrap"> {
  initialStates: Record<WorldKey, WorldStateV5>;
  initialEventCounts?: Partial<Record<WorldKey, number>>;
}

export function runV5History(input: V5HistoryRunInput): V5HistoryRunResult {
  if (!Number.isSafeInteger(input.throughYear) || input.throughYear < 0) throw new Error("V5 throughYear must be a nonnegative safe integer");
  if (!Number.isSafeInteger(input.operational.checkpointIntervalYears) || input.operational.checkpointIntervalYears <= 0) throw new Error("V5 checkpoint interval must be positive");
  const states = {} as Record<WorldKey, WorldStateV5>;
  const events = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
  const namingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
  const bootstrapYearEvents = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
  const bootstrapNamingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
  const eventCounts = { CONCORD: 0, SCHISM: 0, RUIN: 0 } as Record<WorldKey, number>;
  for (const worldKey of WORLDS) {
    const bootstrap = bootstrapWorldV5({ worldKey, canonical: input.canonical, ownerInputs: input.ownerInputs, variables: input.mechanics, normalizedSeed: input.normalizedSeed, mode: input.mode });
    states[worldKey] = bootstrap.state;
    const operationalNamingRequests = bootstrap.namingRequests.map((request) => request.entityType === "POLITICAL_PERSON" && request.behavior === "AUTOMATIC_REUSE" ? { ...request, behavior: input.operational.routineOfficeholderNaming } : request);
    const bootstrapEvents = [...bootstrap.events].sort((a, b) => a.eventId.localeCompare(b.eventId)).map((event, sequence) => ({ ...event, sequence }));
    bootstrapYearEvents[worldKey].push(...bootstrapEvents);
    bootstrapNamingRequests[worldKey].push(...operationalNamingRequests);
    eventCounts[worldKey] += bootstrapEvents.length;
    if (input.retainHistory !== false) { events[worldKey].push(...bootstrapEvents); namingRequests[worldKey].push(...operationalNamingRequests); }
  }
  input.onBootstrap?.({
    year: 0,
    states: structuredClone(states),
    yearEvents: bootstrapYearEvents,
    yearNamingRequests: bootstrapNamingRequests,
    checkpointDue: true,
  });
  for (let year = 1; year <= input.throughYear; year += 1) {
    const yearEvents = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
    const yearNamingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
    for (const worldKey of WORLDS) {
      const context: V5EngineContext = {
        canonical: input.canonical,
        ownerInputs: input.ownerInputs,
        mechanics: input.mechanics,
        operational: input.operational,
        diagnostic: input.diagnostic,
        normalizedSeed: input.normalizedSeed,
        scheduledTransactions: input.scheduledTransactions?.[worldKey] ?? [],
      };
      const advanced = advanceWorldOneYear(states[worldKey], context);
      states[worldKey] = advanced.state;
      yearEvents[worldKey].push(...advanced.events);
      yearNamingRequests[worldKey].push(...advanced.namingRequests);
      eventCounts[worldKey] += advanced.events.length;
      if (input.retainHistory !== false) { events[worldKey].push(...advanced.events); namingRequests[worldKey].push(...advanced.namingRequests); }
    }
    const blocking = WORLDS.some((worldKey) => yearNamingRequests[worldKey].some((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null));
    const checkpointDue = year % input.operational.checkpointIntervalYears === 0 || year === input.throughYear || blocking;
    input.onAtomicYear?.({ year, states: structuredClone(states), yearEvents, yearNamingRequests, checkpointDue });
    if ((input.stopAtBlockingNaming ?? true) && blocking) return { status: "WAITING_FOR_NAMING", completedYear: year, states, events, namingRequests, eventCounts };
  }
  return { status: "COMPLETE", completedYear: input.throughYear, states, events, namingRequests, eventCounts };
}

export function continueV5History(input: V5HistoryContinuationInput): V5HistoryRunResult {
  const years = WORLDS.map((world) => input.initialStates[world].year);
  if (!years.every((year) => year === years[0])) throw new Error("V5 continuation requires one common atomic checkpoint year");
  const startYear = years[0]!;
  if (input.throughYear < startYear) throw new Error("V5 continuation target precedes its checkpoint");
  const states = structuredClone(input.initialStates);
  const events = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
  const namingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
  const eventCounts = Object.fromEntries(WORLDS.map((world) => [world, input.initialEventCounts?.[world] ?? 0])) as Record<WorldKey, number>;
  for (let year = startYear + 1; year <= input.throughYear; year += 1) {
    const yearEvents = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
    const yearNamingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
    for (const worldKey of WORLDS) {
      const advanced = advanceWorldOneYear(states[worldKey], {
        canonical: input.canonical,
        ownerInputs: input.ownerInputs,
        mechanics: input.mechanics,
        operational: input.operational,
        diagnostic: input.diagnostic,
        normalizedSeed: input.normalizedSeed,
        scheduledTransactions: input.scheduledTransactions?.[worldKey] ?? [],
      });
      states[worldKey] = advanced.state;
      yearEvents[worldKey].push(...advanced.events);
      yearNamingRequests[worldKey].push(...advanced.namingRequests);
      eventCounts[worldKey] += advanced.events.length;
      if (input.retainHistory !== false) { events[worldKey].push(...advanced.events); namingRequests[worldKey].push(...advanced.namingRequests); }
    }
    const blocking = WORLDS.some((world) => yearNamingRequests[world].some((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null));
    const checkpointDue = year % input.operational.checkpointIntervalYears === 0 || year === input.throughYear || blocking;
    input.onAtomicYear?.({ year, states: structuredClone(states), yearEvents, yearNamingRequests, checkpointDue });
    if ((input.stopAtBlockingNaming ?? true) && blocking) return { status: "WAITING_FOR_NAMING", completedYear: year, states, events, namingRequests, eventCounts };
  }
  return { status: "COMPLETE", completedYear: input.throughYear, states, events, namingRequests, eventCounts };
}
