import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { createAtrocityOccurrenceSlotsV5 } from "../core/v5/atrocity-slots.js";
import type { AtrocityShockDefinitionV5 } from "../core/v5/atrocities.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { diagnosticCandidateOwnerInputsV1, type CausalOwnerInputsV1 } from "../core/v5/config.js";
import { buildDerogatoryDecisionBatchV5, type DerogatoryDecisionResponseV5 } from "../core/v5/derogatory-decisions.js";
import { CANDIDATE_HISTORICAL_DYNAMISM_POLICIES_V1 } from "../core/v5/historical-policies.js";
import type { V5PerformanceTimingSample } from "../core/v5/performance.js";
import { normalizeSeed } from "../core/v5/random.js";
import type { V5AtomicYearSnapshot } from "../core/v5/runner.js";
import { acceptPersistedV5DerogatoryDecisionBatch, resumePersistedV5Run, runPersistedV5Diagnostic } from "../core/v5/service.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const BAND_DEFINITIONS = [
  { label: "0-25", fromYear: 0, throughYear: 25 },
  { label: "26-50", fromYear: 26, throughYear: 50 },
  { label: "51-100", fromYear: 51, throughYear: 100 },
  { label: "101-150", fromYear: 101, throughYear: 150 },
  { label: "151-200", fromYear: 151, throughYear: 200 },
  { label: "201-285", fromYear: 201, throughYear: 285 },
] as const;
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });

function integerArgument(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

const targetYear = integerArgument("target", 285);
const runtimeBudgetMilliseconds = integerArgument("runtime-budget-ms", 600_000);
const storageBudgetBytes = integerArgument("storage-budget-bytes", 536_870_912);
const profileKind = process.argv.includes("--profile-kind=after") ? "AFTER" as const : "BASELINE" as const;

function bandForYear(year: number): string {
  return BAND_DEFINITIONS.find((band) => year >= band.fromYear && year <= band.throughYear)?.label ?? "OUT_OF_RANGE";
}

function fileBytes(filename: string): number { return statSync(filename, { throwIfNoEntry: false })?.size ?? 0; }

async function fileFingerprint(filename: string): Promise<{ path: string; exists: boolean; bytes: number; sha256: string | null }> {
  if (!existsSync(filename)) return { path: filename, exists: false, bytes: 0, sha256: null };
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => createReadStream(filename).on("data", (chunk) => hash.update(chunk)).on("end", resolvePromise).on("error", reject));
  return { path: filename, exists: true, bytes: fileBytes(filename), sha256: hash.digest("hex") };
}

async function liveFingerprints(): Promise<Awaited<ReturnType<typeof fileFingerprint>>[]> {
  const base = "/home/bobby/.config/@echoes/simulator";
  return Promise.all(["simulator.sqlite", "simulator.sqlite-wal", "simulator.sqlite-shm", "simulator-v5-trusted.sqlite", "simulator-v5-trusted.sqlite-wal", "simulator-v5-trusted.sqlite-shm"].map((name) => fileFingerprint(join(base, name))));
}

function writeArtifact(name: string, value: unknown): void {
  writeFileSync(resolve(outputDirectory, name), `${canonicalJson(value)}\n`, "utf8");
}

function fixtureOwnerInputs(): CausalOwnerInputsV1 {
  const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
  const governmentMappings = Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }]));
  const baseOwner = diagnosticCandidateOwnerInputsV1(governmentMappings);
  const targetScope = "SOVEREIGN_SCAPEGOAT" as const;
  const slots = createAtrocityOccurrenceSlotsV5().map((slot) => slot.occurrenceId === "ATROCITY_WITNESS_17" ? { ...slot, status: "CONFIGURED" as const, triggerYear: 20, targetScope, shockDefinitionId: "PROMPT03_TEST_WITNESS_17" } : slot);
  const concordInitial = canonical.initialSettlements.filter((row) => row.worldKey === "CONCORD").sort((a, b) => a.settlementId.localeCompare(b.settlementId));
  const host = concordInitial.find((row) => {
    const site = canonical.sites.find((candidate) => candidate.siteId === row.siteId);
    return site && [...site.terrainBroad, ...site.terrainSpecific].some((tag) => CANDIDATE_HISTORICAL_DYNAMISM_POLICIES_V1.PERSECUTION_DISPLACEMENT_ENCLAVE.underwaterTerrain.includes(tag));
  });
  if (!host) throw new Error("Baseline fixture cannot resolve an underwater-capable Concord host");
  const attacker = concordInitial.find((row) => row.stateId !== host.stateId);
  const destination = concordInitial.find((row) => row.settlementId !== host.settlementId);
  if (!attacker || !destination) throw new Error("Baseline fixture cannot resolve attacker and destination Settlements");
  const atrocity: AtrocityShockDefinitionV5 = {
    schemaVersion: "echoes-atrocity-shock-definition-v1", shockDefinitionId: "PROMPT03_TEST_WITNESS_17", occurrenceId: "ATROCITY_WITNESS_17", triggerYear: 20,
    targetScope, authorityStatus: "TEST_FIXTURE", authorityRef: "ISOLATED_ACCEPTANCE_ONLY_NOT_HISTORICAL_AUTHORITY", worldKeys: ["CONCORD"],
    effects: [{ type: "MORTALITY", mortalityBps: 10 }, { type: "GROWTH_SUPPRESSION", modifierPpm: -50_000, durationYears: 5 }, { type: "SEIZURE", confiscationScore: 100 }, { type: "RESTRICTION", restrictionKey: "FIXTURE_MOVEMENT_RESTRICTION" }, { type: "FACTION_OPINION", faction: "RUIN", delta: -50 }, { type: "SANCTUARY", hostSettlementId: host.settlementId }, { type: "ENCLAVE_AUTHORIZATION", hostSettlementId: host.settlementId, form: "UNDERWATER", secrecyState: "HIDDEN", authorizationRef: "ISOLATED_ACCEPTANCE_AUTHORIZATION" }, { type: "DISPLACEMENT", sourceSettlementId: host.settlementId, shareBps: 100, destination: "AUTHORIZED_ENCLAVE" }],
  };
  return {
    ...baseOwner,
    atrocityOccurrenceSlots: slots,
    atrocityShockDefinitions: [atrocity],
    scheduledHistoricalConflictActions: [
      { worldKey: "CONCORD", action: { actionId: "EVT_CONCORD_30_PROMPT03_EMBARGO", year: 30, type: "EMBARGO", stateAId: attacker.stateId, stateBId: host.stateId, affectedSettlementIds: [host.settlementId] } },
      { worldKey: "CONCORD", action: { actionId: "EVT_CONCORD_31_PROMPT03_SIEGE", year: 31, type: "SIEGE", attackerStateId: attacker.stateId, defenderStateId: host.stateId, settlementId: host.settlementId, displacementDestinationSettlementId: destination.settlementId } },
    ],
  };
}

function fixtureResponse(batch: ReturnType<typeof buildDerogatoryDecisionBatchV5>): DerogatoryDecisionResponseV5 {
  const action = batch.reviewYear === 15 ? "SELECT" as const : batch.reviewYear === 250 ? "REPLACE" as const : "KEEP" as const;
  return {
    schemaVersion: "echoes-derogatory-decision-response-v1", batchId: batch.batchId, contextSha256: batch.contextSha256, promptSha256: batch.promptSha256,
    provider: "V5_BASELINE_FIXTURE", model: "DETERMINISTIC_EXTERNAL_DECISION_FIXTURE", authorityRef: "ISOLATED_ACCEPTANCE_ONLY_NOT_HISTORICAL_AUTHORITY",
    decisions: batch.requests.map((request) => ({ decisionId: request.decisionId, action, selectedGroupId: action === "REPLACE" ? "beasts" : request.priorGroupId ?? "cave dwellers" })),
  };
}

function stateCounts(state: WorldStateV5): Record<string, number> {
  return {
    populationSliceCount: state.populationSlices?.length ?? 0,
    cohortCount: state.cohorts.length,
    industryCount: state.industries?.length ?? 0,
    institutionCount: state.institutions.length,
    organizationCount: state.organizations.length,
    securityForceCount: state.securityForces?.length ?? 0,
    politicalPersonCount: state.politicalPeople.length,
    familyCount: state.families.length,
  };
}

function aggregateTimings(samples: readonly V5PerformanceTimingSample[]): unknown[] {
  const groups = new Map<string, { scope: string; world: string; band: string; phase: string; count: number; totalMilliseconds: number; maximumMilliseconds: number; bytes: number; rows: number }>();
  for (const sample of samples) {
    const band = bandForYear(sample.year); const key = `${sample.scope}\0${sample.worldKey}\0${band}\0${sample.phase}`;
    const group = groups.get(key) ?? { scope: sample.scope, world: sample.worldKey, band, phase: sample.phase, count: 0, totalMilliseconds: 0, maximumMilliseconds: 0, bytes: 0, rows: 0 };
    group.count += 1; group.totalMilliseconds += sample.milliseconds; group.maximumMilliseconds = Math.max(group.maximumMilliseconds, sample.milliseconds); group.bytes += sample.bytes ?? 0; group.rows += sample.rows ?? 0; groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.band.localeCompare(b.band) || a.world.localeCompare(b.world) || a.scope.localeCompare(b.scope) || a.phase.localeCompare(b.phase)).map((group) => ({ ...group, averageMilliseconds: group.totalMilliseconds / group.count }));
}

function classifyEvent(eventType: string): "REQUIRED_CAUSAL_TRANSITION" | "DERIVABLE_OBSERVATION" | "REDUNDANT_UNCHANGED_STATE" | "DIAGNOSTIC_ONLY" {
  if (eventType === "CausalInvariantAuditPassed") return "DIAGNOSTIC_ONLY";
  if (eventType.endsWith("Reviewed") || eventType.endsWith("Measured")) return "DERIVABLE_OBSERVATION";
  if (eventType.endsWith("Unchanged") || eventType.endsWith("Restated")) return "REDUNDANT_UNCHANGED_STATE";
  return "REQUIRED_CAUSAL_TRANSITION";
}

function eventAudit(events: readonly CausalEventV5[], completedYear: number): unknown[] {
  const groups = new Map<string, { count: number; eventJsonBytes: number; payloadBytes: number; entityIds: Set<string>; years: Map<number, number> }>();
  for (const event of events) {
    const group = groups.get(event.eventType) ?? { count: 0, eventJsonBytes: 0, payloadBytes: 0, entityIds: new Set<string>(), years: new Map<number, number>() };
    group.count += 1; group.eventJsonBytes += Buffer.byteLength(canonicalJson(event)); group.payloadBytes += Buffer.byteLength(canonicalJson(event.payload)); group.entityIds.add(event.entityId); group.years.set(event.year, (group.years.get(event.year) ?? 0) + 1); groups.set(event.eventType, group);
  }
  return [...groups.entries()].map(([eventType, group]) => ({
    eventType, count: group.count, countPerYear: completedYear === 0 ? group.count : group.count / completedYear, entityCount: group.entityIds.size,
    countPerEntity: group.entityIds.size === 0 ? 0 : group.count / group.entityIds.size, averagePayloadBytes: group.count === 0 ? 0 : group.payloadBytes / group.count,
    totalPayloadBytes: group.payloadBytes, averageEventJsonBytes: group.count === 0 ? 0 : group.eventJsonBytes / group.count, totalEventJsonBytes: group.eventJsonBytes,
    classification: classifyEvent(eventType), yearlyCounts: Object.fromEntries([...group.years.entries()].sort(([left], [right]) => left - right)),
  })).sort((a, b) => b.totalEventJsonBytes - a.totalEventJsonBytes || a.eventType.localeCompare(b.eventType));
}

class BaselineBudgetExceeded extends Error {
  constructor(readonly reason: "RUNTIME" | "STORAGE", readonly year: number, readonly observed: number, readonly limit: number) { super(`V54_BASELINE_${reason}_BUDGET_EXCEEDED year=${year} observed=${observed} limit=${limit}`); }
}

const startedAt = Date.now();
const timingSamples: V5PerformanceTimingSample[] = [];
const bandSnapshots: Record<string, unknown> = {};
const telemetryYears: Array<{ year: number; at: number }> = [];
let lastTelemetryAt = startedAt;
let latestSnapshot: V5AtomicYearSnapshot | null = null;
let store: SimulatorStore | null = null;
let runId: string | null = null;
let failure: { name: string; message: string; stack?: string } | null = null;
let stoppedByBudget: { reason: string; year: number; observed: number; limit: number } | null = null;
const temporaryDirectory = mkdtempSync(join(tmpdir(), "echoes-v54-baseline-"));
const databasePath = join(temporaryDirectory, "baseline.sqlite");
const liveBefore = await liveFingerprints();

const finalize = async (): Promise<void> => {
  const completedYear = latestSnapshot?.year ?? (runId && store ? store.getRun(runId)?.currentYear ?? 0 : 0);
  let events: CausalEventV5[] = [];
  let storage: Record<string, unknown> = { databasePath, mainBytes: fileBytes(databasePath), walBytes: fileBytes(`${databasePath}-wal`), shmBytes: fileBytes(`${databasePath}-shm`) };
  if (store && runId) {
    events = WORLDS.flatMap((world) => store!.listV5CausalEvents(runId!, world, completedYear));
    storage = { ...storage, eventCount: store.v5EventCount(runId), checkpointCount: store.v5CheckpointCount(runId), accounting: store.v5StoragePayloadAccounting(runId), pages: store.v5StoragePageAccounting() };
  }
  const phaseProfile = { schemaVersion: "echoes-v5.4-phase-profile-v1", sourceCommit: "db0d5448b9730aff6c3221508d27b68429f8774b", completedYear, bandDefinitions: BAND_DEFINITIONS, timings: aggregateTimings(timingSamples) };
  const volume = eventAudit(events, completedYear);
  const eventTotals = volume.reduce((summary: { count: number; eventJsonBytes: number; payloadBytes: number }, row) => {
    const typed = row as { count: number; totalEventJsonBytes: number; totalPayloadBytes: number }; summary.count += typed.count; summary.eventJsonBytes += typed.totalEventJsonBytes; summary.payloadBytes += typed.totalPayloadBytes; return summary;
  }, { count: 0, eventJsonBytes: 0, payloadBytes: 0 });
  const liveAfter = await liveFingerprints();
  const liveUnchanged = canonicalJson(liveBefore) === canonicalJson(liveAfter);
  const baseline = {
    schemaVersion: "echoes-v5.4-performance-baseline-v1", sourceCommit: "db0d5448b9730aff6c3221508d27b68429f8774b", targetYear,
    status: failure ? "FAILED" : stoppedByBudget ? "STOPPED_BY_SAFETY_BUDGET" : completedYear === targetYear ? "COMPLETE" : "PARTIAL",
    completedYear, elapsedMilliseconds: Date.now() - startedAt, budgets: { runtimeBudgetMilliseconds, storageBudgetBytes }, stoppedByBudget, failure,
    runId, databasePath, temporaryDatabaseOnly: true, bandDefinitions: BAND_DEFINITIONS, bandSnapshots,
    eventTotals: { ...eventTotals, averageEventPayloadBytes: eventTotals.count === 0 ? 0 : eventTotals.payloadBytes / eventTotals.count }, storage,
    checkpointMetrics: timingSamples.filter((sample) => sample.phase.startsWith("CHECKPOINT_")), liveDatabaseUnchanged: liveUnchanged,
  };
  writeArtifact(profileKind === "AFTER" ? "v54-performance-after.json" : "v54-performance-baseline.json", { ...baseline, profileKind, workingTreeRemediationApplied: profileKind === "AFTER" });
  writeArtifact("v54-phase-profile.json", phaseProfile);
  if (profileKind === "BASELINE") writeArtifact("v54-event-volume-audit.json", { schemaVersion: "echoes-v5.4-event-volume-audit-v1", sourceCommit: "db0d5448b9730aff6c3221508d27b68429f8774b", completedYear, eventContractChanged: false, highVolumeThreshold: Math.max(100, Math.floor(eventTotals.count * 0.01)), rows: volume });
  writeArtifact("v54-live-database-nonmutation.json", { schemaVersion: "echoes-v5.4-live-database-nonmutation-v1", pass: liveUnchanged, before: liveBefore, after: liveAfter, scope: "BOUNDED_BASELINE_PROFILE" });
};

const handleSignal = (signal: NodeJS.Signals): void => {
  failure = { name: signal, message: `Baseline profiler received ${signal}` };
  void finalize().finally(() => process.exit(130));
};
process.once("SIGINT", handleSignal);
process.once("SIGTERM", handleSignal);

try {
  store = new SimulatorStore(databasePath);
  const configuration = store.loadV5Configuration();
  store.saveV5Configuration({ ...configuration, operational: { ...configuration.operational, checkpointIntervalYears: 25, interactiveNamingEnabled: false } });
  const onPerformanceTiming = (sample: V5PerformanceTimingSample): void => { timingSamples.push(sample); };
  const onPersistedAtomicYear = (snapshot: V5AtomicYearSnapshot, currentRunId: string): void => {
    latestSnapshot = snapshot; runId = currentRunId;
    const mainBytes = fileBytes(databasePath); const walBytes = fileBytes(`${databasePath}-wal`); const now = Date.now();
    if (BAND_DEFINITIONS.some((band) => band.throughYear === snapshot.year) || snapshot.year === 0) {
      bandSnapshots[bandForYear(snapshot.year)] = { year: snapshot.year, worlds: Object.fromEntries(WORLDS.map((world) => [world, stateCounts(snapshot.states[world])])), eventCount: store!.v5EventCount(currentRunId), sqliteFileBytes: mainBytes, walBytes, checkpointBytes: store!.v5StoragePayloadAccounting(currentRunId).checkpointPayloadBytes };
    }
    if (snapshot.year % 5 === 0 || now - lastTelemetryAt >= 30_000) {
      telemetryYears.push({ year: snapshot.year, at: now }); while (telemetryYears.length > 6) telemetryYears.shift();
      const prior = telemetryYears[0]!; const yearDelta = Math.max(1, snapshot.year - prior.year); const elapsedDelta = Math.max(1, now - prior.at); const yearsPerMinute = yearDelta * 60_000 / elapsedDelta;
      const remaining = Math.max(0, targetYear - snapshot.year); const estimate = yearsPerMinute > 0 ? remaining / yearsPerMinute * 60_000 : null;
      const counts = WORLDS.map((world) => stateCounts(snapshot.states[world])).reduce((sum, row) => ({ populationSliceCount: sum.populationSliceCount + row.populationSliceCount, organizationCount: sum.organizationCount + row.organizationCount, securityForceCount: sum.securityForceCount + row.securityForceCount }), { populationSliceCount: 0, organizationCount: 0, securityForceCount: 0 });
      process.stdout.write(`${canonicalJson({ stage: "BASELINE_PERSISTED_EXECUTION", world: "MULTIWORLD", year: snapshot.year, targetYear, elapsedMilliseconds: now - startedAt, last25YearsPerMinute: yearsPerMinute, estimatedCompletionMilliseconds: estimate, eventCount: store!.v5EventCount(currentRunId), sqliteBytes: mainBytes, walBytes, checkpointBytes: store!.v5StoragePayloadAccounting(currentRunId).checkpointPayloadBytes, ...counts })}\n`);
      lastTelemetryAt = now;
    }
    const elapsed = now - startedAt; const storageBytes = mainBytes + walBytes;
    if (snapshot.checkpointDue && elapsed > runtimeBudgetMilliseconds) throw new BaselineBudgetExceeded("RUNTIME", snapshot.year, elapsed, runtimeBudgetMilliseconds);
    if (snapshot.checkpointDue && storageBytes > storageBudgetBytes) throw new BaselineBudgetExceeded("STORAGE", snapshot.year, storageBytes, storageBudgetBytes);
  };
  let run: ReturnType<typeof resumePersistedV5Run> & { causalRunHash?: string } = runPersistedV5Diagnostic({ store, resourceDirectory: resolve("resources"), normalizedSeed: normalizeSeed("ECHOES_V54_PROMPT03_ACCEPTANCE"), throughYear: targetYear, namingMode: "UNATTENDED_CAUSAL_BENCHMARK", causalOwnerInputs: fixtureOwnerInputs(), onPerformanceTiming, onPersistedAtomicYear });
  runId = run.runId;
  while (run.status === "WAITING_FOR_DEROGATORY_DECISIONS") {
    const batch = store.listV5DerogatoryDecisionBatches(run.runId).find((candidate) => candidate.reviewYear === run.currentYear + 1);
    if (!batch) throw new Error(`Missing persisted Derogatory decision batch after year ${run.currentYear}`);
    const accepted = acceptPersistedV5DerogatoryDecisionBatch({ store, runId: run.runId, response: fixtureResponse(batch) });
    if (!accepted.accepted) throw new Error(`Baseline fixture decision batch rejected: ${accepted.errors.join("; ")}`);
    run = resumePersistedV5Run({ store, resourceDirectory: resolve("resources"), runId: run.runId, onPerformanceTiming, onPersistedAtomicYear });
  }
  if (run.status !== "COMPLETE") throw new Error(`Baseline persisted execution stopped unexpectedly at ${run.status}/${run.currentYear}`);
} catch (error) {
  if (error instanceof BaselineBudgetExceeded) stoppedByBudget = { reason: error.reason, year: error.year, observed: error.observed, limit: error.limit };
  else failure = { name: error instanceof Error ? error.name : "UNKNOWN", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
} finally {
  await finalize();
  store?.close();
}

if (failure) throw new Error(failure.message);
const reportedCompletedYear = latestSnapshot === null ? 0 : (latestSnapshot as V5AtomicYearSnapshot).year;
process.stdout.write(`${canonicalJson({ status: stoppedByBudget ? "STOPPED_BY_SAFETY_BUDGET" : "COMPLETE", runId, targetYear, completedYear: reportedCompletedYear, databasePath, outputDirectory, elapsedMilliseconds: Date.now() - startedAt })}\n`);
