import { createHash, randomUUID } from "node:crypto";
import { checkpointDigest } from "../checkpoints/checkpoint.js";
import { runDiagnosticHistory, type DiagnosticResult } from "../engine/diagnostic-runner.js";
import { SimulatorStore, type StoredRun } from "../../persistence/sqlite-store.js";

export function persistDiagnosticResult(store: SimulatorStore, result: DiagnosticResult): StoredRun {
  const runId = `DIAGNOSTIC_${randomUUID()}`;
  store.createRun({
    runId,
    mode: "DIAGNOSTIC",
    status: "RUNNING",
    seed: result.seed,
    seedHash: createHash("sha256").update(result.seed).digest("hex"),
    policyVersion: result.policyVersion,
  });
  try {
    for (const world of Object.values(result.worlds)) {
      const sequences = new Map<number, number>();
      for (const event of world.events) {
        const sequence = sequences.get(event.year) ?? 0;
        sequences.set(event.year, sequence + 1);
        store.appendEvent({
          eventId: `${runId}_${event.worldKey}_${event.year}_${sequence}`,
          runId,
          worldKey: event.worldKey,
          year: event.year,
          phaseOrder: 100,
          sequence,
          eventType: event.eventType,
          entityType: "DIAGNOSTIC_ENTITY",
          entityId: event.entityId,
          payload: event.payload,
        });
      }
      for (const settlement of world.settlements) {
        store.saveProjection(runId, world.worldKey, result.finalYear, "SETTLEMENT", settlement.settlementId, {
          ...settlement,
          population: settlement.population.toString(),
          politicalForm: null,
          economicForm: null,
          runtimeIssues: [],
        });
      }
      const state = {
        mode: "DIAGNOSTIC",
        worldKey: world.worldKey,
        year: result.finalYear,
        finalPopulation: world.finalPopulation.toString(),
        settlements: world.settlements.map((settlement) => ({ ...settlement, population: settlement.population.toString() })),
        states: world.states,
      };
      store.saveCheckpoint({
        schemaVersion: "eidolon-simulator-checkpoint-v1",
        checkpointId: `CHECKPOINT_${runId}_${world.worldKey}_${result.finalYear}`,
        runId,
        worldKey: world.worldKey,
        year: result.finalYear,
        stateHash: checkpointDigest(state),
        state,
        engineVersion: "diagnostic-engine-v1",
        policyVersion: result.policyVersion,
      });
    }
    store.setRunStatus(runId, "COMPLETE", result.finalYear);
    store.selectRun(runId);
    return store.getRun(runId)!;
  } catch (error) {
    store.setRunStatus(runId, "FAILED", 0);
    throw error;
  }
}

export function runAndPersistDiagnostic(store: SimulatorStore, seed: string, resourceDirectory: string): StoredRun {
  return persistDiagnosticResult(store, runDiagnosticHistory(seed, resourceDirectory));
}
