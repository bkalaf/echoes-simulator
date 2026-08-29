import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import type { V5PerformanceTimingSample } from "../core/v5/performance.js";
import { extendV5EventHistoryHash, V5_EMPTY_EVENT_HISTORY_HASH, v5CheckpointHash } from "../core/v5/persistence.js";
import { continueV5History } from "../core/v5/runner.js";
import { buildScheduledTransactionsV5 } from "../core/v5/schedule.js";
import type { WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const argument = (name: string): string | undefined => process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
const databasePath = argument("database");
const runId = argument("run");
const years = Number.parseInt(argument("years") ?? "5", 10);
if (!databasePath || !runId || !Number.isSafeInteger(years) || years <= 0) throw new Error("Usage: --database=<temporary sqlite> --run=<run id> [--years=5]");

const store = new SimulatorStore(resolve(databasePath));
try {
  const manifest = store.loadV5RunManifest(runId);
  if (!manifest) throw new Error(`Unknown V5 run ${runId}`);
  const checkpoints = Object.fromEntries(WORLDS.map((world) => [world, store.loadLatestV5Checkpoint(runId, world)])) as Record<WorldKey, NonNullable<ReturnType<SimulatorStore["loadLatestV5Checkpoint"]>>>;
  const startYear = checkpoints.CONCORD.state.year;
  if (!WORLDS.every((world) => checkpoints[world].state.year === startYear)) throw new Error("Continuation profile requires an atomic three-world checkpoint");
  const throughYear = startYear + years;
  const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
  const samples: V5PerformanceTimingSample[] = [];
  const yearEventCounts: Record<number, Record<WorldKey, number>> = {};
  const incrementalEventHistoryHashes = { CONCORD: V5_EMPTY_EVENT_HISTORY_HASH, SCHISM: V5_EMPTY_EVENT_HISTORY_HASH, RUIN: V5_EMPTY_EVENT_HISTORY_HASH } as Record<WorldKey, string>;
  const startedAt = performance.now();
  const result = continueV5History({
    canonical,
    ownerInputs: manifest.causalOwnerInputs,
    mechanics: manifest.mechanicsVariables,
    operational: manifest.operationalConfig,
    diagnostic: manifest.diagnosticConfig,
    normalizedSeed: manifest.normalizedSeed,
    mode: manifest.mode,
    throughYear,
    scheduledTransactions: buildScheduledTransactionsV5(canonical, manifest.causalOwnerInputs, manifest.normalizedSeed),
    initialStates: Object.fromEntries(WORLDS.map((world) => [world, checkpoints[world].state])) as Record<WorldKey, WorldStateV5>,
    initialEventCounts: Object.fromEntries(WORLDS.map((world) => [world, store.v5CausalEventCount(runId, world, startYear)])),
    retainHistory: false,
    stopAtBlockingNaming: false,
    interactiveNamingEnabled: false,
    acceptedDerogatoryDecisionBatches: store.listV5AcceptedDerogatoryDecisionBatches(runId),
    priorDerogatoryDecisionStreamHash: store.listV5AcceptedDerogatoryDecisionBatches(runId).at(-1)?.decisionStreamHash,
    onPerformanceTiming: (sample) => samples.push(sample),
    onAtomicYear: (snapshot) => {
      yearEventCounts[snapshot.year] = Object.fromEntries(WORLDS.map((world) => [world, snapshot.yearEvents[world].length])) as Record<WorldKey, number>;
      for (const world of WORLDS) incrementalEventHistoryHashes[world] = extendV5EventHistoryHash(incrementalEventHistoryHashes[world], snapshot.yearEvents[world]);
    },
  });
  const elapsedMilliseconds = performance.now() - startedAt;
  const grouped = new Map<string, { scope: string; world: string; phase: string; count: number; totalMilliseconds: number; maximumMilliseconds: number }>();
  for (const sample of samples) {
    const key = `${sample.scope}\0${sample.worldKey}\0${sample.phase}`;
    const row = grouped.get(key) ?? { scope: sample.scope, world: sample.worldKey, phase: sample.phase, count: 0, totalMilliseconds: 0, maximumMilliseconds: 0 };
    row.count += 1;
    row.totalMilliseconds += sample.milliseconds;
    row.maximumMilliseconds = Math.max(row.maximumMilliseconds, sample.milliseconds);
    grouped.set(key, row);
  }
  const timings = [...grouped.values()]
    .map((row) => ({ ...row, averageMilliseconds: row.totalMilliseconds / row.count }))
    .sort((left, right) => right.totalMilliseconds - left.totalMilliseconds || left.world.localeCompare(right.world) || left.phase.localeCompare(right.phase));
  const stateHashes = Object.fromEntries(WORLDS.map((world) => [world, v5CheckpointHash(result.states[world])]));
  const artifact = { schemaVersion: "echoes-v5.4-phase-profile-v1", profileKind: "IN_MEMORY_CHECKPOINT_CONTINUATION", sourceTemporaryDatabase: resolve(databasePath), runId, startYear, throughYear, completedYear: result.completedYear, status: result.status, elapsedMilliseconds, populationSliceCountAtStart: WORLDS.reduce((sum, world) => sum + (checkpoints[world].state.populationSlices?.length ?? 0), 0), stateHashes, incrementalEventHistoryHashes, yearEventCounts, timings };
  writeFileSync(resolve("artifacts/simulator/v5/remediation/v54-phase-profile.json"), `${canonicalJson(artifact)}\n`, "utf8");
  process.stdout.write(`${canonicalJson({ startYear, throughYear, elapsedMilliseconds, stateHashes, incrementalEventHistoryHashes, slowest: timings.slice(0, 20) })}\n`);
} finally {
  store.close();
}
