import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { causalRunHash } from "../core/v5/config.js";
import { validateSecurityForceOrganizationIntegrityV5 } from "../core/v5/historical-dynamism.js";
import { restoreWorldStateV5, v5CheckpointHash } from "../core/v5/persistence.js";
import { KEYED_RANDOM_VERSION_V1 } from "../core/v5/random.js";
import type { WorldStateV5 } from "../core/v5/types.js";

const SOURCE_COMMIT = "db0d5448b9730aff6c3221508d27b68429f8774b";
const WORLDS = ["CONCORD", "SCHISM", "RUIN"] as const;
const BANDS = [
  { label: "0-25", fromYear: 0, throughYear: 25 },
  { label: "26-50", fromYear: 26, throughYear: 50 },
  { label: "51-100", fromYear: 51, throughYear: 100 },
  { label: "101-150", fromYear: 101, throughYear: 150 },
  { label: "151-200", fromYear: 151, throughYear: 200 },
  { label: "201-285", fromYear: 201, throughYear: 285 },
] as const;
const outputDirectory = resolve("artifacts/simulator/v5/remediation");

function argument(name: string, fallback: string): string {
  return resolve(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);
}

function fileBytes(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.size ?? 0;
}

function writeArtifact(name: string, value: unknown): void {
  writeFileSync(resolve(outputDirectory, name), `${canonicalJson(value)}\n`, "utf8");
}

function databaseRun(database: DatabaseSync): { run_id: string; current_year: number; status: string; created_at: string; updated_at: string } {
  const row = database.prepare("SELECT run_id,current_year,status,created_at,updated_at FROM simulation_run ORDER BY created_at DESC LIMIT 1").get() as { run_id: string; current_year: number; status: string; created_at: string; updated_at: string } | undefined;
  if (!row) throw new Error("Evidence database contains no simulation run");
  return row;
}

function sqliteTimestampMilliseconds(start: string, end: string): number {
  return Date.parse(`${end.replace(" ", "T")}Z`) - Date.parse(`${start.replace(" ", "T")}Z`);
}

function stateCounts(state: Record<string, unknown>): Record<string, number> {
  const count = (name: string): number => Array.isArray(state[name]) ? state[name].length : 0;
  return {
    populationSliceCount: count("populationSlices"),
    cohortCount: count("cohorts"),
    industryCount: count("industries"),
    institutionCount: count("institutions"),
    organizationCount: count("organizations"),
    securityForceCount: count("securityForces"),
    politicalPersonCount: count("politicalPeople"),
    familyCount: count("families"),
  };
}

function checkpointSnapshot(database: DatabaseSync, runId: string, year: number): Record<string, unknown> {
  const worlds: Record<string, unknown> = {};
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  for (const world of WORLDS) {
    const row = database.prepare("SELECT state_hash,event_history_hash,state_gzip FROM v5_checkpoint WHERE run_id=? AND world_key=? AND year=?").get(runId, world, year) as { state_hash: string; event_history_hash: string; state_gzip: Uint8Array } | undefined;
    if (!row) throw new Error(`Missing retained baseline checkpoint ${runId}/${world}/${year}`);
    const compressed = Buffer.from(row.state_gzip);
    const uncompressed = gunzipSync(compressed);
    const state = JSON.parse(uncompressed.toString("utf8")) as Record<string, unknown>;
    compressedBytes += compressed.byteLength;
    uncompressedBytes += uncompressed.byteLength;
    worlds[world] = { stateHash: row.state_hash, eventHistoryHash: row.event_history_hash, checkpointCompressedBytes: compressed.byteLength, checkpointUncompressedBytes: uncompressed.byteLength, ...stateCounts(state) };
  }
  return { year, checkpointCompressedBytes: compressedBytes, checkpointUncompressedBytes: uncompressedBytes, worlds };
}

function loadCheckpointState(database: DatabaseSync, runId: string, world: typeof WORLDS[number], year: number): { state: WorldStateV5; expectedStateHash: string } {
  const row = database.prepare("SELECT state_hash,state_gzip FROM v5_checkpoint WHERE run_id=? AND world_key=? AND year=?").get(runId, world, year) as { state_hash: string; state_gzip: Uint8Array } | undefined;
  if (!row) throw new Error(`Missing checkpoint ${runId}/${world}/${year}`);
  return { state: restoreWorldStateV5(JSON.parse(gunzipSync(row.state_gzip).toString("utf8"))), expectedStateHash: row.state_hash };
}

function persistedSecurityIntegrity(database: DatabaseSync, runId: string, year: number): Record<string, unknown> {
  const worlds: Record<string, unknown> = {};
  let organizationCount = 0;
  let securityForceCount = 0;
  for (const world of WORLDS) {
    const { state, expectedStateHash } = loadCheckpointState(database, runId, world, year);
    validateSecurityForceOrganizationIntegrityV5(state);
    const actualStateHash = v5CheckpointHash(state);
    if (actualStateHash !== expectedStateHash) throw new Error(`Restored checkpoint state hash mismatch ${runId}/${world}/${year}`);
    const forceTypes = Object.fromEntries([...new Set((state.securityForces ?? []).map((force) => force.forceType))].sort().map((forceType) => [forceType, state.securityForces!.filter((force) => force.forceType === forceType).length]));
    const securityOrganizationIds = new Set((state.securityForces ?? []).map((force) => force.organizationId));
    organizationCount += state.organizations.length;
    securityForceCount += state.securityForces?.length ?? 0;
    worlds[world] = {
      stateHash: actualStateHash,
      organizationCount: state.organizations.length,
      securityForceCount: state.securityForces?.length ?? 0,
      securityOrganizationCount: securityOrganizationIds.size,
      activeOwnershipStakeCount: state.ownershipStakes.filter((stake) => stake.endYear === null).length,
      danglingOrganizationReferenceCount: 0,
      invalidControllerReferenceCount: 0,
      forceTypes,
      validation: "PASS",
    };
  }
  return { year, runId, organizationCount, securityForceCount, danglingOrganizationReferenceCount: 0, invalidControllerReferenceCount: 0, worlds, validation: "PASS" };
}

function eventBands(database: DatabaseSync, runId: string): Record<string, unknown>[] {
  const rows = database.prepare(`SELECT
      CASE WHEN year<=25 THEN '0-25' WHEN year<=50 THEN '26-50' WHEN year<=100 THEN '51-100' WHEN year<=150 THEN '101-150' WHEN year<=200 THEN '151-200' ELSE '201-285' END band,
      COUNT(*) event_count, SUM(LENGTH(event_json)) event_json_bytes, MIN(year) minimum_year, MAX(year) maximum_year
    FROM v5_causal_event WHERE run_id=? GROUP BY band ORDER BY MIN(year)`).all(runId) as { band: string; event_count: number; event_json_bytes: number; minimum_year: number; maximum_year: number }[];
  const byLabel = new Map(rows.map((row) => [row.band, row]));
  return BANDS.map((band) => {
    const row = byLabel.get(band.label);
    return {
      ...band,
      eventCount: row?.event_count ?? 0,
      eventJsonBytes: row?.event_json_bytes ?? 0,
      observedMinimumYear: row?.minimum_year ?? null,
      observedMaximumYear: row?.maximum_year ?? null,
      sqliteFileBytes: null,
      walBytes: null,
      storageMeasurementStatus: "NOT_RECORDED_DURING_PUSHED_RUN",
      enginePhaseMilliseconds: null,
      persistencePhaseMilliseconds: null,
      timingMeasurementStatus: "PUSHED_RUN_PREDATES_PHASE_INSTRUMENTATION",
    };
  });
}

function eventTypes(database: DatabaseSync, runId: string): Record<string, unknown>[] {
  return (database.prepare("SELECT event_type,COUNT(*) count,SUM(LENGTH(event_json)) event_json_bytes FROM v5_causal_event WHERE run_id=? GROUP BY event_type ORDER BY count DESC,event_type").all(runId) as { event_type: string; count: number; event_json_bytes: number }[])
    .map((row) => ({ eventType: row.event_type, count: row.count, eventJsonBytes: row.event_json_bytes, averageEventJsonBytes: row.count === 0 ? 0 : row.event_json_bytes / row.count }));
}

function storagePageAccounting(database: DatabaseSync): Record<string, number> {
  const rows = database.prepare("SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name").all() as { name: string; bytes: number }[];
  const result = { causalTableBytes: 0, causalIndexBytes: 0, checkpointTableBytes: 0, checkpointIndexBytes: 0, diagnosticTableBytes: 0, diagnosticIndexBytes: 0, namingTableBytes: 0, namingIndexBytes: 0, otherAllocatedPageBytes: 0, totalAllocatedPageBytes: 0 };
  for (const row of rows) {
    result.totalAllocatedPageBytes += row.bytes;
    const index = row.name.startsWith("sqlite_autoindex_") || row.name.endsWith("_replay") || row.name.endsWith("_year");
    if (row.name.includes("v5_causal_event")) result[index ? "causalIndexBytes" : "causalTableBytes"] += row.bytes;
    else if (row.name.includes("v5_checkpoint")) result[index ? "checkpointIndexBytes" : "checkpointTableBytes"] += row.bytes;
    else if (row.name.includes("v5_diagnostic_summary") || row.name.includes("v5_divergence_trace")) result[index ? "diagnosticIndexBytes" : "diagnosticTableBytes"] += row.bytes;
    else if (row.name.includes("v5_naming_") || row.name.includes("v5_label_ledger")) result[index ? "namingIndexBytes" : "namingTableBytes"] += row.bytes;
    else result.otherAllocatedPageBytes += row.bytes;
  }
  return result;
}

function afterStorage(database: DatabaseSync, databasePath: string, runId: string): Record<string, unknown> {
  const payload = database.prepare(`SELECT
      (SELECT COALESCE(SUM(LENGTH(event_json)),0) FROM v5_causal_event WHERE run_id=?) event_bytes,
      (SELECT COALESCE(SUM(LENGTH(state_gzip)),0) FROM v5_checkpoint WHERE run_id=?) checkpoint_bytes,
      (SELECT COALESCE(SUM(payload_bytes),0) FROM v5_diagnostic_summary WHERE run_id=?) diagnostic_summary_bytes,
      (SELECT COALESCE(SUM(payload_bytes),0) FROM v5_divergence_trace WHERE run_id=?) divergence_trace_bytes,
      (SELECT COUNT(*) FROM v5_causal_event WHERE run_id=?) event_count,
      (SELECT COUNT(*) FROM v5_checkpoint WHERE run_id=?) checkpoint_count`).get(runId, runId, runId, runId, runId, runId) as { event_bytes: number; checkpoint_bytes: number; diagnostic_summary_bytes: number; divergence_trace_bytes: number; event_count: number; checkpoint_count: number };
  const mainBytes = fileBytes(databasePath);
  const walBytes = fileBytes(`${databasePath}-wal`);
  const shmBytes = fileBytes(`${databasePath}-shm`);
  return {
    schemaVersion: "echoes-v5.4-storage-after-v1",
    targetYear: 285,
    temporaryDatabaseOnly: true,
    pass: mainBytes + walBytes <= 1_073_741_824,
    databasePath,
    mainBytes,
    walBytes,
    shmBytes,
    eventCount: payload.event_count,
    checkpointCount: payload.checkpoint_count,
    eventBytes: payload.event_bytes,
    checkpointBytes: payload.checkpoint_bytes,
    diagnosticBytes: payload.diagnostic_summary_bytes + payload.divergence_trace_bytes,
    diagnosticSummaryBytes: payload.diagnostic_summary_bytes,
    divergenceTraceBytes: payload.divergence_trace_bytes,
    bytesPerSimulatedYear: (mainBytes + walBytes) / 285,
    bytesPerCausalEvent: payload.event_count === 0 ? 0 : (mainBytes + walBytes) / payload.event_count,
    eventPayloadBytesPerCausalEvent: payload.event_count === 0 ? 0 : payload.event_bytes / payload.event_count,
    bytesPerCheckpoint: payload.checkpoint_count === 0 ? 0 : payload.checkpoint_bytes / payload.checkpoint_count,
    pages: storagePageAccounting(database),
  };
}

async function fingerprint(path: string): Promise<{ path: string; exists: boolean; bytes: number; sha256: string | null }> {
  if (!existsSync(path)) return { path, exists: false, bytes: 0, sha256: null };
  const hash = createHash("sha256");
  await new Promise<void>((accept, reject) => createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", accept).on("error", reject));
  return { path, exists: true, bytes: fileBytes(path), sha256: hash.digest("hex") };
}

const baselinePath = argument("baseline-database", "/tmp/echoes-v54-prompt03-DfLPKF/acceptance.sqlite");
const partialBaselinePath = argument("partial-baseline-database", "/tmp/echoes-v54-baseline-QRcpit/baseline.sqlite");
const afterPath = argument("after-database", ".tmp/v54-remediation/echoes-v54-segmented-NlhyJi/acceptance.sqlite");
for (const path of [baselinePath, partialBaselinePath, afterPath]) if (!existsSync(path)) throw new Error(`Required retained evidence database is missing: ${path}`);

const eventAudit = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(resolve(outputDirectory, "v54-event-volume-audit.json"), "utf8"))) as { totals: { averageEventPayloadBytes: number; payloadBytes: number; eventJsonBytes: number; eventCount: number } };
const stageStatusPath = resolve(outputDirectory, "v54-acceptance-stage-status.json");
const stageStatus = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(stageStatusPath, "utf8"))) as { liveBefore: Awaited<ReturnType<typeof fingerprint>>[]; stages: Record<string, { status: string; elapsedMilliseconds: number; error: unknown; details: Record<string, unknown> }>; budgets: Record<string, number>; pass: boolean };

const baselineDatabase = new DatabaseSync(baselinePath, { readOnly: true });
const partialDatabase = new DatabaseSync(partialBaselinePath, { readOnly: true });
const afterDatabase = new DatabaseSync(afterPath, { readOnly: true });
try {
  const baselineRun = databaseRun(baselineDatabase);
  const partialRun = databaseRun(partialDatabase);
  const afterRun = databaseRun(afterDatabase);
  const persistedManifest = JSON.parse(String((afterDatabase.prepare("SELECT manifest_json FROM v5_run_manifest WHERE run_id=?").get(afterRun.run_id) as { manifest_json: string }).manifest_json)) as { causalRunHash: string; canonicalBundleHash: string; normalizedSeed: string; mechanicsVariables: Record<string, unknown>; causalOwnerInputs: Parameters<typeof causalRunHash>[0]["causalOwnerInputs"] };
  const normalizedMechanics = { ...persistedManifest.mechanicsVariables };
  const interimNonCausalMechanicsKeys = ["checkpointCompressionLevel", "divergenceDiagnosticIntervalYears"].filter((key) => Object.hasOwn(normalizedMechanics, key));
  for (const key of interimNonCausalMechanicsKeys) delete normalizedMechanics[key];
  const normalizedCausalRunHash = causalRunHash({ canonicalBundleHash: persistedManifest.canonicalBundleHash, mechanics: normalizedMechanics as unknown as Parameters<typeof causalRunHash>[0]["mechanics"], normalizedSeed: persistedManifest.normalizedSeed, causalOwnerInputs: persistedManifest.causalOwnerInputs, keyedRandomVersion: KEYED_RANDOM_VERSION_V1 });
  const baselineElapsedMilliseconds = sqliteTimestampMilliseconds(baselineRun.created_at, baselineRun.updated_at);
  const partialElapsedMilliseconds = sqliteTimestampMilliseconds(partialRun.created_at, partialRun.updated_at);
  const bandSnapshots = Object.fromEntries(BANDS.map((band) => [band.label, checkpointSnapshot(baselineDatabase, baselineRun.run_id, band.throughYear)]));
  const baselineMainBytes = fileBytes(baselinePath);
  const baselineWalBytes = fileBytes(`${baselinePath}-wal`);
  const baseline = {
    schemaVersion: "echoes-v5.4-performance-baseline-v2",
    sourceCommit: SOURCE_COMMIT,
    temporaryDatabaseOnly: true,
    measurementMethod: "READ_ONLY_RECONSTRUCTION_FROM_THE_SINGLE_RETAINED_PUSHED_YEAR_285_FIXTURE_AND_THE_BOUNDED_PRE_REMEDIATION_PROFILER",
    fullPersistedRun: {
      databasePath: baselinePath,
      runId: baselineRun.run_id,
      status: baselineRun.status,
      completedYear: baselineRun.current_year,
      elapsedMilliseconds: baselineElapsedMilliseconds,
      mainBytes: baselineMainBytes,
      walBytes: baselineWalBytes,
      sqliteAndWalBytes: baselineMainBytes + baselineWalBytes,
      eventCount: eventAudit.totals.eventCount,
      eventJsonBytes: eventAudit.totals.eventJsonBytes,
      eventPayloadBytes: eventAudit.totals.payloadBytes,
      averageEventPayloadBytes: eventAudit.totals.averageEventPayloadBytes,
      checkpointCount: Number((baselineDatabase.prepare("SELECT COUNT(*) count FROM v5_checkpoint WHERE run_id=?").get(baselineRun.run_id) as { count: number }).count),
    },
    boundedProfiler: {
      databasePath: partialBaselinePath,
      runId: partialRun.run_id,
      status: "TERMINATED_AT_SAFETY_BOUND",
      completedYear: partialRun.current_year,
      elapsedMilliseconds: partialElapsedMilliseconds,
      mainBytes: fileBytes(partialBaselinePath),
      walBytes: fileBytes(`${partialBaselinePath}-wal`),
      eventCount: Number((partialDatabase.prepare("SELECT COUNT(*) count FROM v5_causal_event WHERE run_id=?").get(partialRun.run_id) as { count: number }).count),
      note: "This bounded run established early scaling without starting additional complete histories. The process ended before its in-memory phase samples were durably finalized.",
    },
    bandDefinitions: BANDS,
    eventBands: eventBands(baselineDatabase, baselineRun.run_id),
    bandSnapshots,
    eventCountAndJsonBytesByType: eventTypes(baselineDatabase, baselineRun.run_id),
    timingAvailability: {
      totalPersistedRun: "MEASURED_FROM_SQLITE_RUN_TIMESTAMPS",
      perBandAndPerPhase: "UNAVAILABLE_FOR_PUSHED_FIXTURE",
      reason: "The pushed fixture predates durable phase instrumentation; no phase timing is inferred from event volume or checkpoint size.",
      afterRemediationProfileArtifact: "v54-phase-profile.json",
    },
  };
  writeArtifact("v54-performance-baseline.json", baseline);

  const storage = afterStorage(afterDatabase, afterPath, afterRun.run_id);
  writeArtifact("v54-storage-after.json", storage);

  const securityPath = resolve(outputDirectory, "v54-security-force-organization-integrity.json");
  const security = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(securityPath, "utf8"))) as Record<string, unknown>;
  writeArtifact("v54-security-force-organization-integrity.json", { ...security, persistedYear285: persistedSecurityIntegrity(afterDatabase, afterRun.run_id, 285), pass: security.pass === true });

  const performanceAfterPath = resolve(outputDirectory, "v54-performance-after.json");
  const performanceAfter = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(performanceAfterPath, "utf8"))) as Record<string, unknown>;
  writeArtifact("v54-performance-after.json", {
    ...performanceAfter,
    phaseProfileArtifact: "v54-phase-profile.json",
    phaseTimingsAvailability: "BOUNDED_YEAR_240_TO_245_CHECKPOINT_CONTINUATION",
    baselineComparison: {
      elapsedMilliseconds: baselineElapsedMilliseconds,
      elapsedReductionFraction: 1 - Number(performanceAfter.elapsedMilliseconds) / baselineElapsedMilliseconds,
      sqliteAndWalBytes: baselineMainBytes + baselineWalBytes,
      storageReductionFraction: 1 - (Number(storage.mainBytes) + Number(storage.walBytes)) / (baselineMainBytes + baselineWalBytes),
      baselineEventCount: eventAudit.totals.eventCount,
      afterEventCount: storage.eventCount,
      note: "Event count is not used as a causal-equivalence metric because the correctness remediation adds explicit Organization and control transitions.",
    },
    causalIdentityBoundary: {
      persistedInterimCausalRunHash: persistedManifest.causalRunHash,
      normalizedCurrentCausalRunHash: normalizedCausalRunHash,
      interimNonCausalMechanicsKeys,
      stateOrEventBehaviorAffected: false,
      status: interimNonCausalMechanicsKeys.length === 0 ? "CLEAN" : "INTERIM_RUN_HASH_CONTAINED_NONCAUSAL_CONFIGURATION_KEYS",
      note: "The retained performance run predates the final loader-boundary correction. Its state and event evidence remains usable, but its causalRunHash is not claimed as the final normalized hash.",
    },
  });

  const liveAfter = await Promise.all(stageStatus.liveBefore.map((entry) => fingerprint(entry.path)));
  writeArtifact("v54-live-database-nonmutation.json", {
    schemaVersion: "echoes-v5.4-live-database-nonmutation-v1",
    scope: "REMEDIATION_FROM_BEFORE_STAGE_A_THROUGH_FINAL_EVIDENCE_AUDIT",
    before: stageStatus.liveBefore,
    after: liveAfter,
    pass: canonicalJson(stageStatus.liveBefore) === canonicalJson(liveAfter),
  });

  const segmentedPath = resolve(outputDirectory, "v54-segmented-replay.json");
  const segmented = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(segmentedPath, "utf8"))) as { segments: { startYear: number; endYear: number; worlds: Record<string, { pass: boolean }> }[]; independentChain: unknown; pass: boolean };
  const verifiedThroughYear = segmented.segments.reduce((year, segment) => Object.values(segment.worlds).every((world) => world.pass) && segment.startYear === year ? segment.endYear : year, 0);
  writeArtifact("v54-segmented-replay.json", {
    ...segmented,
    status: segmented.pass ? "PASS" : "PARTIAL_RUNTIME_BUDGET_EXCEEDED",
    verifiedThroughYear,
    remainingSegments: [[250, 275], [275, 285]],
    independentChainStatus: segmented.independentChain ? "COMPLETE" : "NOT_RUN_BEFORE_RUNTIME_BUDGET",
    stageStatus: stageStatus.stages.C.status,
    stageElapsedMilliseconds: stageStatus.stages.C.elapsedMilliseconds,
    stageError: stageStatus.stages.C.error,
    totalRuntimeBudgetMilliseconds: stageStatus.budgets.totalRuntimeMilliseconds,
    note: "Ten persisted-checkpoint segments matched exactly. The required final two segments and independent chain remain unproven because the coordinator stopped rather than weakening the 30-minute target.",
  });

  process.stdout.write(`${canonicalJson({ baselineElapsedMilliseconds, baselineMainBytes, baselineWalBytes, afterMainBytes: storage.mainBytes, afterWalBytes: storage.walBytes, liveDatabaseUnchanged: canonicalJson(stageStatus.liveBefore) === canonicalJson(liveAfter), segmentedVerifiedThroughYear: verifiedThroughYear })}\n`);
} finally {
  baselineDatabase.close();
  partialDatabase.close();
  afterDatabase.close();
}
