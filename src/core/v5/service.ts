import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { loadBundledCanonicalV5 } from "./canonical-adapter.js";
import { diagnosticCandidateOwnerInputsV1, V5_MECHANICS_VERSION } from "./config.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, buildV5RunManifest, extendV5EventHistoryHash } from "./persistence.js";
import { buildDivergenceReport } from "./read-model.js";
import { continueV5History, runV5History } from "./runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "./schedule.js";
import { buildPersistedNamingBatchesV5, validateNamingBatchResponseV5 } from "./naming.js";
import type { CausalEventV5, WorldKey } from "./types.js";
import { updateDivergenceTracesV5, type DivergenceTraceV5 } from "./divergence-diagnostics.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const DIVERGENCE_EVENT_TYPES = [
  "BorderSkirmish", "CanonicalShock", "FamilyAllianceCreated", "FamilyPromoted", "FamilyRivalryCreated",
  "FoundingTransfer", "GovernmentTransition", "MigrationTransfer", "PeaceDeclared", "SettlementFounded",
  "StateFactionRealigned", "StateMembershipChanged", "StateSeceded", "WarDeclared", "WarEpisode",
] as const;

export interface PersistedV5DiagnosticInput {
  store: SimulatorStore;
  resourceDirectory: string;
  normalizedSeed: string;
  throughYear?: number;
  namingMode?: "INTERACTIVE_LLM_NAMING" | "UNATTENDED_CAUSAL_BENCHMARK";
}

export function runPersistedV5Diagnostic(input: PersistedV5DiagnosticInput): {
  runId: string;
  status: "COMPLETE" | "WAITING_FOR_NAMING";
  currentYear: number;
  causalRunHash: string;
  divergence: ReturnType<typeof buildDivergenceReport>;
} {
  const canonical = loadBundledCanonicalV5(join(input.resourceDirectory, "canonical"));
  const configuration = input.store.loadV5Configuration();
  const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
  const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
  const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
  const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs);
  const targetYear = input.throughYear ?? 25;
  const operational = { ...configuration.operational, interactiveNamingEnabled: input.namingMode === "INTERACTIVE_LLM_NAMING" };
  const provisional = buildV5RunManifest({ runId: "PROVISIONAL", mode: "DIAGNOSTIC", targetYear, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: input.normalizedSeed, mechanics: configuration.mechanics, causalOwnerInputs: ownerInputs, operational, diagnostic: configuration.diagnostic });
  const runId = `V5_DIAGNOSTIC_${provisional.causalRunHash.slice(0, 16)}_${Date.now()}`;
  const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: input.normalizedSeed, mechanics: configuration.mechanics, causalOwnerInputs: ownerInputs, operational, diagnostic: configuration.diagnostic });
  input.store.createRun({ runId, mode: "DIAGNOSTIC", status: "RUNNING", seed: input.normalizedSeed, seedHash: createHash("sha256").update(input.normalizedSeed).digest("hex"), policyVersion: V5_MECHANICS_VERSION, currentYear: 0 });
  input.store.saveV5RunManifest(manifest);
  input.store.selectRun(runId);
  const historyHashes = { CONCORD: V5_EMPTY_EVENT_HISTORY_HASH, SCHISM: V5_EMPTY_EVENT_HISTORY_HASH, RUIN: V5_EMPTY_EVENT_HISTORY_HASH } as Record<WorldKey, string>;
  let divergenceTraces = new Map<string, DivergenceTraceV5>();
  const persistSnapshot = (snapshot: Parameters<NonNullable<Parameters<typeof runV5History>[0]["onAtomicYear"]>>[0]): void => {
    for (const world of WORLDS) {
      const yearEvents = snapshot.yearEvents[world];
      historyHashes[world] = extendV5EventHistoryHash(historyHashes[world], yearEvents);
      input.store.appendV5CausalEvents(runId, yearEvents);
      input.store.saveV5NamingRequests(runId, snapshot.yearNamingRequests[world]);
      input.store.mergeV5DiagnosticObservations(runId, snapshot.yearDiagnosticObservations[world]);
      if (snapshot.checkpointDue) input.store.saveV5Checkpoint(runId, snapshot.states[world], historyHashes[world]);
    }
    const annualDivergence = buildDivergenceReport(snapshot.states, snapshot.yearEvents, configuration.diagnostic, { canonical, mechanics: configuration.mechanics });
    const updatedTraces = updateDivergenceTracesV5(divergenceTraces, annualDivergence, snapshot.yearEvents, snapshot.year);
    divergenceTraces = updatedTraces.current;
    input.store.saveV5DivergenceTraces(runId, updatedTraces.changed);
    input.store.setRunStatus(runId, "RUNNING", snapshot.year);
  };
  try {
    const interactive = input.namingMode === "INTERACTIVE_LLM_NAMING";
    const result = runV5History({ canonical, ownerInputs, mechanics: configuration.mechanics, operational: configuration.operational, diagnostic: configuration.diagnostic, normalizedSeed: input.normalizedSeed, mode: "DIAGNOSTIC", throughYear: targetYear, scheduledTransactions, stopAtBlockingNaming: input.namingMode !== "UNATTENDED_CAUSAL_BENCHMARK", interactiveNamingEnabled: interactive, retainHistory: false, onBootstrap: persistSnapshot, onAtomicYear: persistSnapshot });
    input.store.setRunStatus(runId, result.status, result.completedYear);
    const divergenceEvents = Object.fromEntries(WORLDS.map((world) => [world, input.store.listV5CausalEventsByTypes(runId, world, DIVERGENCE_EVENT_TYPES, result.completedYear)])) as Record<WorldKey, CausalEventV5[]>;
    const divergence = buildDivergenceReport(result.states, divergenceEvents, configuration.diagnostic, { canonical, mechanics: configuration.mechanics });
    return { runId, status: result.status, currentYear: result.completedYear, causalRunHash: manifest.causalRunHash, divergence };
  } catch (error) {
    const latest = Math.min(...WORLDS.map((world) => input.store.listV5CheckpointYears(runId, world).at(-1) ?? 0));
    input.store.setRunStatus(runId, "FAILED", latest);
    throw error;
  }
}

export function resumePersistedV5Run(input: { store: SimulatorStore; resourceDirectory: string; runId: string }): { runId: string; status: "COMPLETE" | "WAITING_FOR_NAMING"; currentYear: number; divergence: ReturnType<typeof buildDivergenceReport> } {
  let manifest = input.store.loadV5RunManifest(input.runId);
  const run = input.store.getRun(input.runId);
  if (!manifest || !run) throw new Error(`Unknown V5 run ${input.runId}`);
  const pendingBlocking = input.store.listV5NamingRequests(input.runId).filter((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null);
  if (pendingBlocking.length > 0) throw new Error(`V5 run ${input.runId} still has ${pendingBlocking.length} unresolved blocking names`);
  const canonical = loadBundledCanonicalV5(join(input.resourceDirectory, "canonical"));
  if (canonical.canonicalBundleHash !== manifest.canonicalBundleHash) throw new Error("V5 canonical bundle changed since the run began");
  const checkpoints = Object.fromEntries(WORLDS.map((world) => [world, input.store.loadLatestV5Checkpoint(input.runId, world)])) as Record<WorldKey, ReturnType<SimulatorStore["loadLatestV5Checkpoint"]>>;
  if (WORLDS.some((world) => !checkpoints[world])) throw new Error("V5 continuation requires complete world checkpoints");
  const states = Object.fromEntries(WORLDS.map((world) => [world, checkpoints[world]!.state])) as Record<WorldKey, Parameters<typeof continueV5History>[0]["initialStates"][WorldKey]>;
  if (!WORLDS.every((world) => states[world].year === states.CONCORD.year)) throw new Error("V5 continuation checkpoints are not atomic across worlds");
  const scheduledTransactions = buildScheduledTransactionsV5(canonical, manifest.causalOwnerInputs);
  const historySummaries = Object.fromEntries(WORLDS.map((world) => [world, input.store.summarizeV5CausalEventHistory(input.runId, world, states[world].year)])) as Record<WorldKey, { eventHistoryHash: string; eventCount: number }>;
  let divergenceTraces = new Map(input.store.listV5DivergenceTraces(input.runId).map((trace) => [trace.comparisonId, trace]));
  for (const world of WORLDS) {
    const actualHistoryHash = historySummaries[world].eventHistoryHash;
    if (actualHistoryHash !== checkpoints[world]!.eventHistoryHash) throw new Error(`V5 checkpoint event-history hash mismatch for ${input.runId}/${world}`);
  }
  const persistedLabels = input.store.loadV5Labels(input.runId, run.currentYear ?? states.CONCORD.year);
  if (JSON.stringify(Object.entries(persistedLabels).sort()) !== JSON.stringify(Object.entries(manifest.labels).sort())) {
    manifest = buildV5RunManifest({ runId: manifest.runId, mode: manifest.mode, targetYear: manifest.targetYear, canonicalBundleHash: manifest.canonicalBundleHash, normalizedSeed: manifest.normalizedSeed, mechanics: manifest.mechanicsVariables, causalOwnerInputs: manifest.causalOwnerInputs, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig, labels: persistedLabels });
    input.store.saveV5RunManifest(manifest);
  }
  const persistSnapshot = (snapshot: Parameters<NonNullable<Parameters<typeof continueV5History>[0]["onAtomicYear"]>>[0]): void => {
    for (const world of WORLDS) {
      historySummaries[world].eventHistoryHash = extendV5EventHistoryHash(historySummaries[world].eventHistoryHash, snapshot.yearEvents[world]);
      historySummaries[world].eventCount += snapshot.yearEvents[world].length;
      input.store.appendV5CausalEvents(input.runId, snapshot.yearEvents[world]);
      input.store.saveV5NamingRequests(input.runId, snapshot.yearNamingRequests[world]);
      input.store.mergeV5DiagnosticObservations(input.runId, snapshot.yearDiagnosticObservations[world]);
      if (snapshot.checkpointDue) input.store.saveV5Checkpoint(input.runId, snapshot.states[world], historySummaries[world].eventHistoryHash);
    }
    const annualDivergence = buildDivergenceReport(snapshot.states, snapshot.yearEvents, manifest!.diagnosticConfig, { canonical, mechanics: manifest!.mechanicsVariables });
    const updatedTraces = updateDivergenceTracesV5(divergenceTraces, annualDivergence, snapshot.yearEvents, snapshot.year);
    divergenceTraces = updatedTraces.current;
    input.store.saveV5DivergenceTraces(input.runId, updatedTraces.changed);
    input.store.setRunStatus(input.runId, "RUNNING", snapshot.year);
  };
  input.store.setRunStatus(input.runId, "RUNNING", states.CONCORD.year);
  const result = continueV5History({ canonical, ownerInputs: manifest.causalOwnerInputs, mechanics: manifest.mechanicsVariables, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig, normalizedSeed: manifest.normalizedSeed, mode: manifest.mode, throughYear: manifest.targetYear, scheduledTransactions, initialStates: states, initialEventCounts: Object.fromEntries(WORLDS.map((world) => [world, historySummaries[world].eventCount])), stopAtBlockingNaming: true, interactiveNamingEnabled: manifest.operationalConfig.interactiveNamingEnabled, pendingBatchedNamingAtStart: input.store.listV5NamingRequests(input.runId).some((request) => request.behavior === "BATCHED" && request.acceptedLabel === null), retainHistory: false, onAtomicYear: persistSnapshot });
  input.store.setRunStatus(input.runId, result.status, result.completedYear);
  const divergenceEvents = Object.fromEntries(WORLDS.map((world) => [world, input.store.listV5CausalEventsByTypes(input.runId, world, DIVERGENCE_EVENT_TYPES, result.completedYear)])) as Record<WorldKey, CausalEventV5[]>;
  const divergence = buildDivergenceReport(result.states, divergenceEvents, manifest.diagnosticConfig, { canonical, mechanics: manifest.mechanicsVariables, labels: Object.fromEntries(WORLDS.map((world) => [world, manifest.labels])) });
  return { runId: input.runId, status: result.status, currentYear: result.completedYear, divergence };
}

export function acceptPersistedV5NamingBatch(input: { store: SimulatorStore; runId: string; response: unknown }): { accepted: boolean; errors: string[]; acceptedDecisions?: number; currentYear?: number; behavior?: "BLOCKING" | "BATCHED"; pendingBlocking?: number; pendingBatched?: number } {
  const run = input.store.getRun(input.runId);
  const manifest = input.store.loadV5RunManifest(input.runId);
  if (!run || !manifest) throw new Error(`Unknown V5 run ${input.runId}`);
  const responseBatchId = input.response && typeof input.response === "object" && "batchId" in input.response && typeof (input.response as { batchId?: unknown }).batchId === "string" ? (input.response as { batchId: string }).batchId : "";
  const batch = buildPersistedNamingBatchesV5(input.runId, input.store.listV5NamingRequests(input.runId), manifest.operationalConfig.namingBatchMaximum).find((candidate) => candidate.batchId === responseBatchId);
  if (!batch) return { accepted: false, errors: ["batchId does not match a pending V5 naming batch"] };
  input.store.saveV5NamingBatchAudit(batch);
  if (batch.behavior === "BLOCKING" && run.status !== "WAITING_FOR_NAMING") throw new Error(`V5 run ${input.runId} is not waiting for blocking naming`);
  const validated = validateNamingBatchResponseV5(batch, input.response);
  const attemptId = `V5_NAMING_ATTEMPT_${createHash("sha256").update(`${input.runId}\0${batch.batchId}\0${Date.now()}\0${JSON.stringify(input.response)}`).digest("hex")}`;
  input.store.saveV5NamingResponseAttempt({ runId: input.runId, batchId: batch.batchId, attemptId, accepted: validated.accepted, response: input.response, errors: validated.errors });
  if (!validated.accepted || !validated.labels || !validated.decisions) return { accepted: false, errors: validated.errors };
  input.store.acceptV5NamingRequests(input.runId, validated.decisions.map((decision) => ({ requestId: decision.requestId, entityId: decision.entityId, label: decision.label, nameEffectiveFromYear: decision.nameEffectiveFromYear })), run.currentYear ?? batch.year, batch.behavior, { batchId: batch.batchId, responseAttemptId: attemptId });
  const remaining = input.store.listV5NamingRequests(input.runId);
  const pendingBlocking = remaining.filter((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null).length;
  const pendingBatched = remaining.filter((request) => request.behavior === "BATCHED" && request.acceptedLabel === null).length;
  if (pendingBlocking > 0 || pendingBatched > 0) input.store.setRunStatus(input.runId, "WAITING_FOR_NAMING", run.currentYear ?? batch.year);
  const labels = { ...manifest.labels, ...validated.labels };
  input.store.saveV5RunManifest(buildV5RunManifest({ runId: manifest.runId, mode: manifest.mode, targetYear: manifest.targetYear, canonicalBundleHash: manifest.canonicalBundleHash, normalizedSeed: manifest.normalizedSeed, mechanics: manifest.mechanicsVariables, causalOwnerInputs: manifest.causalOwnerInputs, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig, labels }));
  return { accepted: true, errors: [], acceptedDecisions: validated.decisions.length, currentYear: run.currentYear, behavior: batch.behavior, pendingBlocking, pendingBatched };
}
