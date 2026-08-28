import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { loadBundledCanonicalV5 } from "./canonical-adapter.js";
import { diagnosticCandidateOwnerInputsV1, V5_MECHANICS_VERSION } from "./config.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, buildNonCausalLabelManifestUpdateV5, buildV5RunManifest, extendV5EventHistoryHash, v5RuntimeCompatibilityErrors } from "./persistence.js";
import { buildDivergenceReport } from "./read-model.js";
import { continueV5History, runV5History } from "./runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "./schedule.js";
import { recoverExportedV2NamingBatchV5, validateNamingBatchResponseV5 } from "./naming.js";
import type { CausalEventV5, WorldKey } from "./types.js";
import { updateDivergenceTracesV5, type DivergenceTraceV5 } from "./divergence-diagnostics.js";
import { acceptDerogatoryDecisionResponseV5, V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH, type DerogatoryDecisionResponseV5 } from "./derogatory-decisions.js";

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
  causalOwnerInputs?: ReturnType<typeof diagnosticCandidateOwnerInputsV1>;
}

export function runPersistedV5Diagnostic(input: PersistedV5DiagnosticInput): {
  runId: string;
  status: "COMPLETE" | "WAITING_FOR_NAMING" | "WAITING_FOR_POLICY_AUTHORITY" | "WAITING_FOR_DEROGATORY_DECISIONS";
  currentYear: number;
  causalRunHash: string;
  divergence: ReturnType<typeof buildDivergenceReport>;
} {
  const canonical = loadBundledCanonicalV5(join(input.resourceDirectory, "canonical"));
  const configuration = input.store.loadV5Configuration();
  const baseOwnerInputs = input.causalOwnerInputs ?? diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
  const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
  const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
  const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs, input.normalizedSeed);
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
    const pauseCheckpoint = (states: Readonly<Record<WorldKey, Parameters<typeof input.store.saveV5Checkpoint>[1]>>): void => { for (const world of WORLDS) input.store.saveV5Checkpoint(runId, states[world], historyHashes[world]); };
    const result = runV5History({ canonical, ownerInputs, mechanics: configuration.mechanics, operational: configuration.operational, diagnostic: configuration.diagnostic, normalizedSeed: input.normalizedSeed, mode: "DIAGNOSTIC", throughYear: targetYear, scheduledTransactions, stopAtBlockingNaming: input.namingMode !== "UNATTENDED_CAUSAL_BENCHMARK", interactiveNamingEnabled: interactive, retainHistory: false, onBootstrap: persistSnapshot, onAtomicYear: persistSnapshot, onPauseCheckpoint: pauseCheckpoint, onPolicyBlocker: (blocker) => input.store.saveV5PolicyBlocker(runId, blocker), onDerogatoryDecisionBarrier: (batch) => input.store.saveV5DerogatoryDecisionBatch(runId, batch) });
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

export function resumePersistedV5Run(input: { store: SimulatorStore; resourceDirectory: string; runId: string }): { runId: string; status: "COMPLETE" | "WAITING_FOR_NAMING" | "WAITING_FOR_POLICY_AUTHORITY" | "WAITING_FOR_DEROGATORY_DECISIONS"; currentYear: number; divergence: ReturnType<typeof buildDivergenceReport> } {
  let manifest = input.store.loadV5RunManifest(input.runId);
  const run = input.store.getRun(input.runId);
  if (!manifest || !run) throw new Error(`Unknown V5 run ${input.runId}`);
  const compatibilityErrors = v5RuntimeCompatibilityErrors(manifest);
  if (compatibilityErrors.length > 0) throw new Error(`V5_CAUSAL_RESUME_VERSION_MISMATCH ${compatibilityErrors.join(",")}`);
  const pendingBlocking = input.store.listV5NamingRequests(input.runId).filter((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null);
  if (pendingBlocking.length > 0) throw new Error(`V5 run ${input.runId} still has ${pendingBlocking.length} unresolved blocking names`);
  const canonical = loadBundledCanonicalV5(join(input.resourceDirectory, "canonical"));
  if (canonical.canonicalBundleHash !== manifest.canonicalBundleHash) throw new Error("V5 canonical bundle changed since the run began");
  const checkpoints = Object.fromEntries(WORLDS.map((world) => [world, input.store.loadLatestV5Checkpoint(input.runId, world)])) as Record<WorldKey, ReturnType<SimulatorStore["loadLatestV5Checkpoint"]>>;
  if (WORLDS.some((world) => !checkpoints[world])) throw new Error("V5 continuation requires complete world checkpoints");
  const states = Object.fromEntries(WORLDS.map((world) => [world, checkpoints[world]!.state])) as Record<WorldKey, Parameters<typeof continueV5History>[0]["initialStates"][WorldKey]>;
  if (!WORLDS.every((world) => states[world].year === states.CONCORD.year)) throw new Error("V5 continuation checkpoints are not atomic across worlds");
  if ((run.currentYear ?? states.CONCORD.year) !== states.CONCORD.year) throw new Error(`V5_PAUSE_CHECKPOINT_MISMATCH run=${run.currentYear ?? "null"} checkpoint=${states.CONCORD.year}`);
  const scheduledTransactions = buildScheduledTransactionsV5(canonical, manifest.causalOwnerInputs, manifest.normalizedSeed);
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
  const acceptedDerogatoryDecisionBatches = input.store.listV5AcceptedDerogatoryDecisionBatches(input.runId);
  const pauseCheckpoint = (pauseStates: Readonly<Record<WorldKey, Parameters<typeof input.store.saveV5Checkpoint>[1]>>): void => { for (const world of WORLDS) input.store.saveV5Checkpoint(input.runId, pauseStates[world], historySummaries[world].eventHistoryHash); };
  const result = continueV5History({ canonical, ownerInputs: manifest.causalOwnerInputs, mechanics: manifest.mechanicsVariables, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig, normalizedSeed: manifest.normalizedSeed, mode: manifest.mode, throughYear: manifest.targetYear, scheduledTransactions, initialStates: states, initialEventCounts: Object.fromEntries(WORLDS.map((world) => [world, historySummaries[world].eventCount])), stopAtBlockingNaming: true, interactiveNamingEnabled: manifest.operationalConfig.interactiveNamingEnabled, pendingBatchedNamingAtStart: input.store.listV5NamingRequests(input.runId).some((request) => request.behavior === "BATCHED" && request.acceptedLabel === null), retainHistory: false, onAtomicYear: persistSnapshot, onPauseCheckpoint: pauseCheckpoint, acceptedDerogatoryDecisionBatches, priorDerogatoryDecisionStreamHash: acceptedDerogatoryDecisionBatches.at(-1)?.decisionStreamHash, onPolicyBlocker: (blocker) => input.store.saveV5PolicyBlocker(input.runId, blocker), onDerogatoryDecisionBarrier: (batch) => input.store.saveV5DerogatoryDecisionBatch(input.runId, batch) });
  input.store.setRunStatus(input.runId, result.status, result.completedYear);
  const divergenceEvents = Object.fromEntries(WORLDS.map((world) => [world, input.store.listV5CausalEventsByTypes(input.runId, world, DIVERGENCE_EVENT_TYPES, result.completedYear)])) as Record<WorldKey, CausalEventV5[]>;
  const divergence = buildDivergenceReport(result.states, divergenceEvents, manifest.diagnosticConfig, { canonical, mechanics: manifest.mechanicsVariables, labels: Object.fromEntries(WORLDS.map((world) => [world, manifest.labels])) });
  return { runId: input.runId, status: result.status, currentYear: result.completedYear, divergence };
}

export function acceptPersistedV5DerogatoryDecisionBatch(input: { store: SimulatorStore; runId: string; response: DerogatoryDecisionResponseV5 | unknown }): { accepted: boolean; errors: string[]; acceptedDecisions?: number; decisionStreamHash?: string } {
  const run = input.store.getRun(input.runId); const manifest = input.store.loadV5RunManifest(input.runId);
  if (!run || !manifest) throw new Error(`Unknown V5 run ${input.runId}`);
  if (run.status !== "WAITING_FOR_DEROGATORY_DECISIONS") throw new Error(`V5 run ${input.runId} is not waiting for Derogatory Group decisions`);
  const response = input.response as Partial<DerogatoryDecisionResponseV5>; const batchId = typeof response.batchId === "string" ? response.batchId : "";
  const batch = input.store.loadV5DerogatoryDecisionBatch(input.runId, batchId); if (!batch) return { accepted: false, errors: [`Unknown Derogatory decision batch ${batchId}`] };
  const acceptedPrior = input.store.listV5AcceptedDerogatoryDecisionBatches(input.runId); const priorDecisionStreamHash = acceptedPrior.at(-1)?.decisionStreamHash ?? V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH;
  const attemptId = `V5_DEROGATORY_ATTEMPT_${createHash("sha256").update(`${input.runId}\0${batchId}\0${Date.now()}\0${JSON.stringify(input.response)}`).digest("hex")}`;
  try {
    const accepted = acceptDerogatoryDecisionResponseV5(batch, input.response as DerogatoryDecisionResponseV5, priorDecisionStreamHash);
    input.store.saveV5DerogatoryDecisionAttempt({ runId: input.runId, batchId, attemptId, accepted: true, response: input.response, errors: [] });
    input.store.saveV5AcceptedDerogatoryDecisionBatch(input.runId, accepted);
    input.store.setRunStatus(input.runId, "PAUSED", run.currentYear ?? batch.barrierYear);
    return { accepted: true, errors: [], acceptedDecisions: accepted.acceptedSelections.length, decisionStreamHash: accepted.decisionStreamHash };
  } catch (error) {
    const errors = [error instanceof Error ? error.message : String(error)]; input.store.saveV5DerogatoryDecisionAttempt({ runId: input.runId, batchId, attemptId, accepted: false, response: input.response, errors }); return { accepted: false, errors };
  }
}

export function acceptPersistedV5NamingBatch(input: { store: SimulatorStore; runId: string; response: unknown }): { accepted: boolean; errors: string[]; acceptedDecisions?: number; currentYear?: number; behavior?: "BLOCKING" | "BATCHED"; pendingBlocking?: number; pendingBatched?: number; acceptanceMode?: "CURRENT_NAMING" | "LEGACY_NAMING_ONLY" } {
  const run = input.store.getRun(input.runId);
  const manifest = input.store.loadV5RunManifest(input.runId);
  if (!run || !manifest) throw new Error(`Unknown V5 run ${input.runId}`);
  const responseBatchId = input.response && typeof input.response === "object" && "batchId" in input.response && typeof (input.response as { batchId?: unknown }).batchId === "string" ? (input.response as { batchId: string }).batchId : "";
  const requests = input.store.listV5NamingRequests(input.runId);
  let batch = input.store.loadV5NamingBatchAudit(input.runId, responseBatchId);
  if (!batch) {
    const recovered = recoverExportedV2NamingBatchV5(input.runId, requests, input.response);
    if (!recovered.batch) return { accepted: false, errors: recovered.errors };
    batch = recovered.batch;
  }
  input.store.saveV5NamingBatchAudit(batch);
  if (batch.behavior === "BLOCKING" && run.status !== "WAITING_FOR_NAMING") throw new Error(`V5 run ${input.runId} is not waiting for blocking naming`);
  const currentById = new Map(requests.map((request) => [request.requestId, request]));
  const unresolved = batch.items.filter((item) => currentById.get(item.requestId)?.acceptedLabel === null).length;
  if (unresolved !== batch.items.length) {
    const errors = [unresolved === 0 ? "V5 naming batch has already been accepted; response replay rejected" : "V5 naming batch is partially resolved and cannot be accepted"];
    const attemptId = `V5_NAMING_ATTEMPT_${createHash("sha256").update(`${input.runId}\0${batch.batchId}\0${Date.now()}\0${JSON.stringify(input.response)}`).digest("hex")}`;
    input.store.saveV5NamingResponseAttempt({ runId: input.runId, batchId: batch.batchId, attemptId, accepted: false, response: input.response, errors });
    return { accepted: false, errors };
  }
  const validated = validateNamingBatchResponseV5(batch, input.response);
  const attemptId = `V5_NAMING_ATTEMPT_${createHash("sha256").update(`${input.runId}\0${batch.batchId}\0${Date.now()}\0${JSON.stringify(input.response)}`).digest("hex")}`;
  if (!validated.accepted || !validated.labels || !validated.decisions) {
    input.store.saveV5NamingResponseAttempt({ runId: input.runId, batchId: batch.batchId, attemptId, accepted: false, response: input.response, errors: validated.errors });
    return { accepted: false, errors: validated.errors };
  }
  const labels = { ...manifest.labels, ...validated.labels };
  const acceptanceMode = v5RuntimeCompatibilityErrors(manifest).length > 0 ? "LEGACY_NAMING_ONLY" as const : "CURRENT_NAMING" as const;
  const updatedManifest = buildNonCausalLabelManifestUpdateV5(manifest, labels);
  const { pendingBlocking, pendingBatched } = input.store.acceptV5NamingRequests(
    input.runId,
    validated.decisions.map((decision) => ({ requestId: decision.requestId, entityId: decision.entityId, label: decision.label, nameEffectiveFromYear: decision.nameEffectiveFromYear })),
    run.currentYear ?? batch.year,
    batch.behavior,
    { batchId: batch.batchId, responseAttemptId: attemptId },
    { response: input.response, manifest: updatedManifest },
  );
  return { accepted: true, errors: [], acceptedDecisions: validated.decisions.length, currentYear: run.currentYear, behavior: batch.behavior, pendingBlocking, pendingBatched, acceptanceMode };
}
