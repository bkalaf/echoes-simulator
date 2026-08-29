import type { CanonicalDataV5, CausalOwnerInputsV1, DiagnosticConfigV1, MechanicsVariablesV1, OperationalConfigV1 } from "./config.js";
import { bootstrapWorldV5 } from "./bootstrap.js";
import { advanceWorldOneYear, type ScheduledTransactionV5, type V5EngineContext } from "./engine.js";
import type { CausalEventV5, NamingRequestV5, WorldKey, WorldStateV5 } from "./types.js";
import type { BoundedDiagnosticObservationV5 } from "./diagnostics.js";
import { PolicyAuthorityRequiredV5, type CausalPolicyBlockerV5 } from "./historical-policies.js";
import { applyAcceptedDerogatoryDecisionBatchV5, buildDerogatoryDecisionBatchV5, isDerogatoryDecisionReviewYearV5, requireDerogatoryMembershipPolicyAtReviewV5, type AcceptedDerogatoryDecisionBatchV5, type DerogatoryDecisionBatchV5 } from "./derogatory-decisions.js";
import type { V5PerformanceTimingObserver } from "./performance.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

export function freezeCommittedCausalStateV5<T>(value: T): T {
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(value); return value;
}

export function createDeepReadonlyViewV5<T>(value: T): T {
  const cache = new WeakMap<object, object>();
  const wrap = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== "object") return candidate;
    if (Object.isFrozen(candidate)) return candidate;
    const existing = cache.get(candidate); if (existing) return existing;
    const proxy = new Proxy(candidate, {
      get: (target, property, receiver) => wrap(Reflect.get(target, property, receiver)),
      set: () => { throw new TypeError("V5 atomic-year callback state is read-only"); },
      deleteProperty: () => { throw new TypeError("V5 atomic-year callback state is read-only"); },
      defineProperty: () => { throw new TypeError("V5 atomic-year callback state is read-only"); },
      setPrototypeOf: () => { throw new TypeError("V5 atomic-year callback state is read-only"); },
    });
    cache.set(candidate, proxy);
    return proxy;
  };
  return wrap(value) as T;
}

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
  interactiveNamingEnabled?: boolean;
  pendingBatchedNamingAtStart?: boolean;
  retainHistory?: boolean;
  onBootstrap?: (snapshot: V5AtomicYearSnapshot) => void;
  onAtomicYear?: (snapshot: V5AtomicYearSnapshot) => void;
  acceptedDerogatoryDecisionBatches?: readonly AcceptedDerogatoryDecisionBatchV5[];
  priorDerogatoryDecisionStreamHash?: string;
  onPolicyBlocker?: (blocker: CausalPolicyBlockerV5) => void;
  onDerogatoryDecisionBarrier?: (batch: DerogatoryDecisionBatchV5) => void;
  onPauseCheckpoint?: (states: Readonly<Record<WorldKey, WorldStateV5>>) => void;
  onPerformanceTiming?: V5PerformanceTimingObserver;
}

export interface V5AtomicYearSnapshot {
  year: number;
  states: Readonly<Record<WorldKey, WorldStateV5>>;
  yearEvents: Readonly<Record<WorldKey, readonly CausalEventV5[]>>;
  yearNamingRequests: Readonly<Record<WorldKey, readonly NamingRequestV5[]>>;
  yearDiagnosticObservations: Readonly<Record<WorldKey, readonly BoundedDiagnosticObservationV5[]>>;
  checkpointDue: boolean;
}

export interface V5HistoryRunResult {
  status: "COMPLETE" | "WAITING_FOR_NAMING" | "WAITING_FOR_POLICY_AUTHORITY" | "WAITING_FOR_DEROGATORY_DECISIONS";
  pauseReason: "BLOCKING_NAMING" | "BATCHED_NAMING_FLUSH" | "POLICY_AUTHORITY" | "DEROGATORY_DECISIONS" | null;
  completedYear: number;
  states: Record<WorldKey, WorldStateV5>;
  events: Record<WorldKey, CausalEventV5[]>;
  namingRequests: Record<WorldKey, NamingRequestV5[]>;
  eventCounts: Record<WorldKey, number>;
  policyBlocker?: CausalPolicyBlockerV5;
  derogatoryDecisionBatch?: DerogatoryDecisionBatchV5;
  derogatoryDecisionStreamHash?: string;
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
  let derogatoryDecisionStreamHash = input.priorDerogatoryDecisionStreamHash;
  for (const worldKey of WORLDS) {
    const bootstrap = bootstrapWorldV5({ worldKey, canonical: input.canonical, ownerInputs: input.ownerInputs, variables: input.mechanics, normalizedSeed: input.normalizedSeed, mode: input.mode });
    states[worldKey] = freezeCommittedCausalStateV5(bootstrap.state);
    const operationalNamingRequests = bootstrap.namingRequests;
    const bootstrapEvents = [...bootstrap.events].sort((a, b) => a.eventId.localeCompare(b.eventId)).map((event, sequence) => ({ ...event, sequence }));
    bootstrapYearEvents[worldKey].push(...bootstrapEvents);
    bootstrapNamingRequests[worldKey].push(...operationalNamingRequests);
    eventCounts[worldKey] += bootstrapEvents.length;
    if (input.retainHistory !== false) { events[worldKey].push(...bootstrapEvents); namingRequests[worldKey].push(...operationalNamingRequests); }
  }
  const bootstrapCallbackViewStartedAt = performance.now();
  const bootstrapCallbackStates = createDeepReadonlyViewV5(states);
  input.onPerformanceTiming?.({ scope: "RUNNER", worldKey: "MULTIWORLD", year: 0, phase: "CALLBACK_READONLY_VIEW", milliseconds: performance.now() - bootstrapCallbackViewStartedAt });
  input.onBootstrap?.({
    year: 0,
    states: bootstrapCallbackStates,
    yearEvents: bootstrapYearEvents,
    yearNamingRequests: bootstrapNamingRequests,
    yearDiagnosticObservations: { CONCORD: [], SCHISM: [], RUIN: [] },
    checkpointDue: true,
  });
  let batchedSinceFlush = bootstrapNamingRequests.CONCORD.concat(bootstrapNamingRequests.SCHISM, bootstrapNamingRequests.RUIN).some((request) => request.behavior === "BATCHED" && request.acceptedLabel === null);
  for (let year = 1; year <= input.throughYear; year += 1) {
    let preparedStates: Record<WorldKey, WorldStateV5> = states;
    if (isDerogatoryDecisionReviewYearV5(year)) {
      let policy;
      try { policy = requireDerogatoryMembershipPolicyAtReviewV5({ mode: input.mode, ownerInputs: input.ownerInputs, states, reviewYear: year }); }
      catch (error) {
        if (!(error instanceof PolicyAuthorityRequiredV5)) throw error;
        input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states));
        input.onPolicyBlocker?.(error.blocker);
        return { status: "WAITING_FOR_POLICY_AUTHORITY", pauseReason: "POLICY_AUTHORITY", completedYear: year - 1, states, events, namingRequests, eventCounts, policyBlocker: error.blocker, derogatoryDecisionStreamHash };
      }
      const batch = buildDerogatoryDecisionBatchV5(states, year, policy);
      const accepted = input.acceptedDerogatoryDecisionBatches?.find((row) => row.batch.batchId === batch.batchId);
      if (!accepted) { input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states)); input.onDerogatoryDecisionBarrier?.(batch); return { status: "WAITING_FOR_DEROGATORY_DECISIONS", pauseReason: "DEROGATORY_DECISIONS", completedYear: year - 1, states, events, namingRequests, eventCounts, derogatoryDecisionBatch: batch, derogatoryDecisionStreamHash }; }
      const streamCompatible = derogatoryDecisionStreamHash === undefined || accepted.priorDecisionStreamHash === derogatoryDecisionStreamHash || accepted.decisionStreamHash === derogatoryDecisionStreamHash;
      if (accepted.batch.contextSha256 !== batch.contextSha256 || accepted.batch.promptSha256 !== batch.promptSha256 || !streamCompatible) throw new Error(`Accepted Derogatory decision batch ${accepted.batch.batchId} does not match the current immutable context or decision stream`);
      preparedStates = applyAcceptedDerogatoryDecisionBatchV5(states, input.canonical, policy, accepted);
      derogatoryDecisionStreamHash = accepted.decisionStreamHash;
    }
    const yearEvents = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
    const yearNamingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
    const yearDiagnosticObservations = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, BoundedDiagnosticObservationV5[]>;
    const candidateStates = { ...preparedStates };
    try { for (const worldKey of WORLDS) {
      const context: V5EngineContext = {
        canonical: input.canonical,
        ownerInputs: input.ownerInputs,
        mechanics: input.mechanics,
        operational: input.operational,
        diagnostic: input.diagnostic,
        normalizedSeed: input.normalizedSeed,
        scheduledTransactions: input.scheduledTransactions?.[worldKey] ?? [],
        mode: input.mode,
        onPerformanceTiming: input.onPerformanceTiming,
      };
      const advanced = advanceWorldOneYear(candidateStates[worldKey], context);
      const freezeStartedAt = performance.now(); candidateStates[worldKey] = freezeCommittedCausalStateV5(advanced.state);
      input.onPerformanceTiming?.({ scope: "RUNNER", worldKey, year, phase: "WORLD_COMMIT_FREEZE", milliseconds: performance.now() - freezeStartedAt });
      yearEvents[worldKey].push(...advanced.events);
      yearNamingRequests[worldKey].push(...advanced.namingRequests);
      yearDiagnosticObservations[worldKey].push(...advanced.diagnosticObservations);
      eventCounts[worldKey] += advanced.events.length;
      if (input.retainHistory !== false) { events[worldKey].push(...advanced.events); namingRequests[worldKey].push(...advanced.namingRequests); }
    } } catch (error) {
      for (const worldKey of WORLDS) { eventCounts[worldKey] -= yearEvents[worldKey].length; if (input.retainHistory !== false) { events[worldKey].splice(events[worldKey].length - yearEvents[worldKey].length, yearEvents[worldKey].length); namingRequests[worldKey].splice(namingRequests[worldKey].length - yearNamingRequests[worldKey].length, yearNamingRequests[worldKey].length); } }
      if (!(error instanceof PolicyAuthorityRequiredV5)) throw error;
      input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states));
      input.onPolicyBlocker?.(error.blocker);
      return { status: "WAITING_FOR_POLICY_AUTHORITY", pauseReason: "POLICY_AUTHORITY", completedYear: year - 1, states, events, namingRequests, eventCounts, policyBlocker: error.blocker, derogatoryDecisionStreamHash };
    }
    Object.assign(states, candidateStates);
    const blocking = WORLDS.some((worldKey) => yearNamingRequests[worldKey].some((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null));
    batchedSinceFlush ||= WORLDS.some((worldKey) => yearNamingRequests[worldKey].some((request) => request.behavior === "BATCHED" && request.acceptedLabel === null));
    const interactiveFlushDue = Boolean(input.interactiveNamingEnabled && batchedSinceFlush && year % input.operational.namingBatchFlushIntervalYears === 0);
    const checkpointDue = year % input.operational.checkpointIntervalYears === 0 || year === input.throughYear || blocking || interactiveFlushDue;
    const callbackViewStartedAt = performance.now();
    const callbackStates = createDeepReadonlyViewV5(states);
    input.onPerformanceTiming?.({ scope: "RUNNER", worldKey: "MULTIWORLD", year, phase: "CALLBACK_READONLY_VIEW", milliseconds: performance.now() - callbackViewStartedAt });
    input.onAtomicYear?.({ year, states: callbackStates, yearEvents, yearNamingRequests, yearDiagnosticObservations, checkpointDue });
    if ((input.stopAtBlockingNaming ?? true) && blocking) return { status: "WAITING_FOR_NAMING", pauseReason: "BLOCKING_NAMING", completedYear: year, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
    if (interactiveFlushDue) return { status: "WAITING_FOR_NAMING", pauseReason: "BATCHED_NAMING_FLUSH", completedYear: year, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
  }
  return { status: "COMPLETE", pauseReason: null, completedYear: input.throughYear, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
}

export function continueV5History(input: V5HistoryContinuationInput): V5HistoryRunResult {
  const years = WORLDS.map((world) => input.initialStates[world].year);
  if (!years.every((year) => year === years[0])) throw new Error("V5 continuation requires one common atomic checkpoint year");
  const startYear = years[0]!;
  if (input.throughYear < startYear) throw new Error("V5 continuation target precedes its checkpoint");
  const states = Object.fromEntries(WORLDS.map((world) => [world, freezeCommittedCausalStateV5(input.initialStates[world])])) as Record<WorldKey, WorldStateV5>;
  const events = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
  const namingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
  const eventCounts = Object.fromEntries(WORLDS.map((world) => [world, input.initialEventCounts?.[world] ?? 0])) as Record<WorldKey, number>;
  let batchedSinceFlush = input.pendingBatchedNamingAtStart ?? false;
  let derogatoryDecisionStreamHash = input.priorDerogatoryDecisionStreamHash;
  for (let year = startYear + 1; year <= input.throughYear; year += 1) {
    let preparedStates: Record<WorldKey, WorldStateV5> = states;
    if (isDerogatoryDecisionReviewYearV5(year)) {
      let policy;
      try { policy = requireDerogatoryMembershipPolicyAtReviewV5({ mode: input.mode, ownerInputs: input.ownerInputs, states, reviewYear: year }); }
      catch (error) { if (!(error instanceof PolicyAuthorityRequiredV5)) throw error; input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states)); input.onPolicyBlocker?.(error.blocker); return { status: "WAITING_FOR_POLICY_AUTHORITY", pauseReason: "POLICY_AUTHORITY", completedYear: year - 1, states, events, namingRequests, eventCounts, policyBlocker: error.blocker, derogatoryDecisionStreamHash }; }
      const batch = buildDerogatoryDecisionBatchV5(states, year, policy); const accepted = input.acceptedDerogatoryDecisionBatches?.find((row) => row.batch.batchId === batch.batchId);
      if (!accepted) { input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states)); input.onDerogatoryDecisionBarrier?.(batch); return { status: "WAITING_FOR_DEROGATORY_DECISIONS", pauseReason: "DEROGATORY_DECISIONS", completedYear: year - 1, states, events, namingRequests, eventCounts, derogatoryDecisionBatch: batch, derogatoryDecisionStreamHash }; }
      const streamCompatible = derogatoryDecisionStreamHash === undefined || accepted.priorDecisionStreamHash === derogatoryDecisionStreamHash || accepted.decisionStreamHash === derogatoryDecisionStreamHash;
      if (accepted.batch.contextSha256 !== batch.contextSha256 || accepted.batch.promptSha256 !== batch.promptSha256 || !streamCompatible) throw new Error(`Accepted Derogatory decision batch ${accepted.batch.batchId} does not match the current immutable context or decision stream`);
      preparedStates = applyAcceptedDerogatoryDecisionBatchV5(states, input.canonical, policy, accepted); derogatoryDecisionStreamHash = accepted.decisionStreamHash;
    }
    const yearEvents = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, CausalEventV5[]>;
    const yearNamingRequests = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, NamingRequestV5[]>;
    const yearDiagnosticObservations = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, BoundedDiagnosticObservationV5[]>;
    const candidateStates = { ...preparedStates };
    try { for (const worldKey of WORLDS) {
      const advanced = advanceWorldOneYear(candidateStates[worldKey], {
        canonical: input.canonical,
        ownerInputs: input.ownerInputs,
        mechanics: input.mechanics,
        operational: input.operational,
        diagnostic: input.diagnostic,
        normalizedSeed: input.normalizedSeed,
        scheduledTransactions: input.scheduledTransactions?.[worldKey] ?? [],
        mode: input.mode,
        onPerformanceTiming: input.onPerformanceTiming,
      });
      const freezeStartedAt = performance.now(); candidateStates[worldKey] = freezeCommittedCausalStateV5(advanced.state);
      input.onPerformanceTiming?.({ scope: "RUNNER", worldKey, year, phase: "WORLD_COMMIT_FREEZE", milliseconds: performance.now() - freezeStartedAt });
      yearEvents[worldKey].push(...advanced.events);
      yearNamingRequests[worldKey].push(...advanced.namingRequests);
      yearDiagnosticObservations[worldKey].push(...advanced.diagnosticObservations);
      eventCounts[worldKey] += advanced.events.length;
      if (input.retainHistory !== false) { events[worldKey].push(...advanced.events); namingRequests[worldKey].push(...advanced.namingRequests); }
    } } catch (error) {
      for (const worldKey of WORLDS) { eventCounts[worldKey] -= yearEvents[worldKey].length; if (input.retainHistory !== false) { events[worldKey].splice(events[worldKey].length - yearEvents[worldKey].length, yearEvents[worldKey].length); namingRequests[worldKey].splice(namingRequests[worldKey].length - yearNamingRequests[worldKey].length, yearNamingRequests[worldKey].length); } }
      if (!(error instanceof PolicyAuthorityRequiredV5)) throw error; input.onPauseCheckpoint?.(createDeepReadonlyViewV5(states)); input.onPolicyBlocker?.(error.blocker); return { status: "WAITING_FOR_POLICY_AUTHORITY", pauseReason: "POLICY_AUTHORITY", completedYear: year - 1, states, events, namingRequests, eventCounts, policyBlocker: error.blocker, derogatoryDecisionStreamHash };
    }
    Object.assign(states, candidateStates);
    const blocking = WORLDS.some((world) => yearNamingRequests[world].some((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null));
    batchedSinceFlush ||= WORLDS.some((worldKey) => yearNamingRequests[worldKey].some((request) => request.behavior === "BATCHED" && request.acceptedLabel === null));
    const interactiveFlushDue = Boolean(input.interactiveNamingEnabled && batchedSinceFlush && year % input.operational.namingBatchFlushIntervalYears === 0);
    const checkpointDue = year % input.operational.checkpointIntervalYears === 0 || year === input.throughYear || blocking || interactiveFlushDue;
    const callbackViewStartedAt = performance.now();
    const callbackStates = createDeepReadonlyViewV5(states);
    input.onPerformanceTiming?.({ scope: "RUNNER", worldKey: "MULTIWORLD", year, phase: "CALLBACK_READONLY_VIEW", milliseconds: performance.now() - callbackViewStartedAt });
    input.onAtomicYear?.({ year, states: callbackStates, yearEvents, yearNamingRequests, yearDiagnosticObservations, checkpointDue });
    if ((input.stopAtBlockingNaming ?? true) && blocking) return { status: "WAITING_FOR_NAMING", pauseReason: "BLOCKING_NAMING", completedYear: year, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
    if (interactiveFlushDue) return { status: "WAITING_FOR_NAMING", pauseReason: "BATCHED_NAMING_FLUSH", completedYear: year, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
  }
  return { status: "COMPLETE", pauseReason: null, completedYear: input.throughYear, states, events, namingRequests, eventCounts, derogatoryDecisionStreamHash };
}
