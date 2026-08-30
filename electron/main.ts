import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
import { inspectLegacyV5NamingTrust, type LegacyV5NamingTrustInspection } from "../src/persistence/v5-legacy-trust.js";
import { bootstrapCanonicalRun } from "../src/core/engine/canonical-runner.js";
import type { DiagnosticResult } from "../src/core/engine/diagnostic-runner.js";
import { persistDiagnosticResult } from "../src/core/operator/diagnostic-service.js";
import { deriveOperatorViewModel, type OperatorSnapshot } from "../src/core/operator/operator-state.js";
import { loadBundledCanonical } from "../src/core/canonical/bundled-canonical.js";
import { buildNamingBatches, validateNamingBatchResponse, validateNamingResponse } from "../src/core/naming/naming.js";
import { enrichPendingNamingJobsWithPois, loadUnnamedPoisBySite } from "../src/core/naming/poi-context.js";
import { buildPersistedCanonicalExport, buildPersistedV5Export } from "../src/core/export/persisted-export.js";
import { verifyExportZip } from "../src/core/export/exporter.js";
import { applyAcceptedSettlementNames } from "../src/core/operator/presentation.js";
import { loadBreedCatalog } from "../src/core/breeds/breed-catalog.js";
import { loadCanonicalAtlasPois, runtimeVisibleAtlasPois } from "../src/persistence/postgres-atlas.js";
import { disconnectDomainDatabase, preflightDomainDatabase, type DomainDatabasePreflight } from "../src/persistence/postgres-domain.js";
import { createOwnerPolicyCandidateRevision, decideOwnerPolicyRevisions, listOwnerPolicyCenter } from "../src/persistence/postgres-owner-policy.js";
import { CANONICAL_POLICY_VERSION } from "../src/core/engine/canonical-authority.js";
import { editableV5ConfigurationJson, parseEditableV5Configuration } from "../src/core/v5/configuration.js";
import { canonicalV5FromRunAuthoritySnapshot, loadPostgresCanonicalV5 } from "../src/persistence/postgres-canonical.js";
import { buildReadModelV1 } from "../src/core/v5/read-model.js";
import type { WorldKey as WorldKeyV5, WorldStateV5 } from "../src/core/v5/types.js";
import { acceptPersistedV5DerogatoryDecisionBatch, acceptPersistedV5NamingBatch, acceptPersistedV5NamingBatches } from "../src/core/v5/service.js";
import { buildRouteCoverageReadModel } from "../src/core/v5/routes.js";
import { buildPoiCoverage } from "../src/core/atlas/coverage.js";
import { canonicalPolicyReadiness, diagnosticCandidateOwnerInputsV1 } from "../src/core/v5/config.js";
import { buildNamingGeographyReadModel } from "../src/core/v5/naming-geography.js";
import { effectiveRouteClassification } from "../src/core/v5/route-classification.js";
import { renderExternalDerogatoryDecisionPromptV5 } from "../src/core/v5/derogatory-decisions.js";
import { buildNamingPromptExportV5, parseNamingResponseZipV5 } from "../src/core/v5/naming-bulk.js";
import { buildV5SettlementProjection, type V5OperatorViewDetail } from "./v5-operator-read.js";
import { setPackagedDomainDatabaseConnectionProvider } from "../src/persistence/domain-database-connection.js";

let mainWindow: BrowserWindow | null = null;
const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");
const runtimeResources = !app.isPackaged && process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY
  ? resolve(process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY)
  : app.isPackaged ? join(process.resourcesPath, "simulator-resources") : join(projectRoot, "resources");
let store: SimulatorStore | null = null;
let activeCanonicalResume: { runId: string; promise: Promise<unknown> } | null = null;
let activeV5Resume: { runId: string; promise: Promise<unknown> } | null = null;
let poiContextCache: { canonicalDirectory: string; bySite: ReturnType<typeof loadUnnamedPoisBySite> } | null = null;
let breedCatalogPromise: ReturnType<typeof loadBreedCatalog> | null = null;
let atlasPoiCache: Awaited<ReturnType<typeof loadCanonicalAtlasPois>> | null = null;
let legacyNamingTrust: LegacyV5NamingTrustInspection | null = null;
let canonicalDataCache: ReturnType<typeof loadBundledCanonical> | null = null;
let sitesCache: Record<string, string>[] | null = null;
let operatorSnapshotInFlight: Promise<OperatorSnapshot & Record<string, unknown>> | null = null;

function canonicalData(): ReturnType<typeof loadBundledCanonical> {
  canonicalDataCache ??= loadBundledCanonical(runtimeResources);
  return canonicalDataCache;
}

function yieldToMainLoop(): Promise<void> {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}

function getStore(): SimulatorStore {
  if (!store) {
    const primary = join(app.getPath("userData"), "simulator.sqlite");
    legacyNamingTrust = inspectLegacyV5NamingTrust(primary);
    store = new SimulatorStore(legacyNamingTrust.requiresFreshTrustedDatabase ? join(app.getPath("userData"), "simulator-v5-trusted.sqlite") : primary);
    store.retireCanonicalRunsExcept(CANONICAL_POLICY_VERSION);
  }
  return store;
}

function presentedSettlements(runId: string, projections: ReturnType<SimulatorStore["listProjections"]>): ReturnType<SimulatorStore["listProjections"]> {
  const accepted = new Map(getStore().listAcceptedNamesForRun(runId).filter((row) => row.entityType === "SETTLEMENT").map((row) => [row.entityId, row.name]));
  return applyAcceptedSettlementNames(projections as { settlementId: string; name?: unknown }[], accepted) as ReturnType<SimulatorStore["listProjections"]>;
}

const V5_WORLDS: readonly WorldKeyV5[] = ["CONCORD", "SCHISM", "RUIN"];

function v5SettlementProjection(runId: string, state: WorldStateV5): Record<string, unknown>[] {
  const manifest = getStore().loadV5RunManifest(runId);
  if (!manifest) return [];
  return buildV5SettlementProjection(getStore(), canonicalV5FromRunAuthoritySnapshot(manifest.authoritySnapshot, manifest.canonicalBundleHash, state.year), manifest, state);
}

async function buildOperatorSnapshot(): Promise<OperatorSnapshot & Record<string, unknown>> {
  const domainDatabasePreflight = await preflightDomainDatabase();
  const loadedCanonicalData = canonicalData();
  const sitesPath = join(loadedCanonicalData.directory, "atlas/sites_naming_master.csv");
  sitesCache ??= existsSync(sitesPath) ? parseCsvSync(readFileSync(sitesPath), { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[] : [];
  const sites = sitesCache;
  const runs = getStore().listRuns();
  if (loadedCanonicalData.status === "READY") {
    if (!poiContextCache || poiContextCache.canonicalDirectory !== loadedCanonicalData.directory) poiContextCache = { canonicalDirectory: loadedCanonicalData.directory, bySite: loadUnnamedPoisBySite(loadedCanonicalData.directory) };
    for (const run of runs.filter((candidate) => candidate.mode === "CANONICAL" && candidate.status === "WAITING_FOR_NAMING")) {
      const pending = getStore().listPendingNamingJobs(run.runId);
      getStore().supersedePendingNamingJobs(enrichPendingNamingJobsWithPois(pending, poiContextCache.bySite));
    }
  }
  const selectedRun = getStore().selectedRun();
  const selectedV5Manifest = selectedRun ? getStore().loadV5RunManifest(selectedRun.runId) : null;
  const loadedCanonicalV5 = selectedV5Manifest
    ? canonicalV5FromRunAuthoritySnapshot(selectedV5Manifest.authoritySnapshot, selectedV5Manifest.canonicalBundleHash, selectedRun?.currentYear ?? 0)
    : await loadPostgresCanonicalV5().then((result) => result.canonical).catch(() => null);
  const projectionWatermark = selectedRun && selectedV5Manifest ? getStore().loadV5ProjectionWatermark(selectedRun.runId) : null;
  const pendingV5NamingBatches = selectedRun && selectedV5Manifest && selectedRun.status !== "RUNNING"
    ? getStore().materializePendingV5NamingBatches(selectedRun.runId, selectedV5Manifest.operationalConfig.namingBatchMaximum)
    : [];
  const pendingV5NamingBatch = pendingV5NamingBatches[0] ?? null;
  const causalPersistedYear = selectedRun?.mode === "CANONICAL"
    ? Math.max(selectedRun.currentYear ?? 0, getStore().latestCompleteCheckpointYear(selectedRun.runId, ["CONCORD", "SCHISM", "RUIN"]) ?? 0)
    : selectedRun?.currentYear ?? 0;
  const persistedYear = projectionWatermark ? Math.min(causalPersistedYear, projectionWatermark.projectedThroughYear) : causalPersistedYear;
  const pendingNamingJob = selectedV5Manifest ? null : ((selectedRun && selectedRun.status !== "RETIRED_DATA_AUTHORITY" ? getStore().getPendingNamingJob(selectedRun.runId) : null) ?? (!selectedRun ? getStore().getAnyPendingNamingJob() : null));
  const pendingNamingJobs = pendingNamingJob ? getStore().listPendingNamingJobs(pendingNamingJob.context.runId) : [];
  const pendingNamingBatches = buildNamingBatches(pendingNamingJobs);
  const hasActiveRun = runs.some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING", "WAITING_FOR_POLICY_AUTHORITY", "WAITING_FOR_DEROGATORY_DECISIONS"].includes(run.status));
  const v5Configuration = editableV5ConfigurationJson(getStore().loadV5Configuration());
  let v5States: Record<WorldKeyV5, WorldStateV5 | null> | null = null;
  if (selectedRun && selectedV5Manifest) {
    v5States = { CONCORD: null, SCHISM: null, RUIN: null };
    for (const world of V5_WORLDS) {
      await yieldToMainLoop();
      v5States[world] = getStore().loadLatestV5Checkpoint(selectedRun.runId, world, persistedYear)?.state ?? null;
    }
  }
  let settlementProjections: Record<string, unknown[]> | null = null;
  if (selectedRun && selectedV5Manifest) {
    settlementProjections = { CONCORD: [], SCHISM: [], RUIN: [] };
    for (const world of V5_WORLDS) {
      await yieldToMainLoop();
      settlementProjections[world] = v5States![world] ? v5SettlementProjection(selectedRun.runId, v5States![world]!) : [];
    }
  } else if (selectedRun) {
    settlementProjections = Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, presentedSettlements(selectedRun.runId, getStore().listProjections(selectedRun.runId, world, persistedYear, "SETTLEMENT"))]));
  }
  const eventCount = selectedRun ? selectedV5Manifest ? getStore().v5EventCount(selectedRun.runId) : getStore().eventCount(selectedRun.runId) : 0;
  const checkpointCount = selectedRun ? selectedV5Manifest ? getStore().v5CheckpointCount(selectedRun.runId) : getStore().checkpointCount(selectedRun.runId) : 0;
  const cohortCount = selectedRun ? selectedV5Manifest ? V5_WORLDS.reduce((sum, world) => sum + (v5States![world]?.cohorts.length ?? 0), 0) : getStore().countCohorts(selectedRun.runId, undefined, persistedYear) : 0;
  const worldSummary = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => {
    const settlements = settlementProjections![world] as { population?: string; stateId?: string }[];
    return [world, { finalPopulation: settlements.reduce((sum, settlement) => sum + BigInt(settlement.population ?? "0"), 0n).toString(), settlements: settlements.length, states: new Set(settlements.map((settlement) => String(settlement.stateId))).size, events: selectedV5Manifest ? getStore().v5CausalEventCount(selectedRun!.runId, world, persistedYear) : eventCount, federalCapitalSiteId: null }];
  })) : null;
  const manifest = selectedRun ? { ...selectedRun, currentYear: persistedYear, finalYear: selectedV5Manifest?.targetYear ?? 2000, checkpointCount, eventCount, cohortCount, namingJobCount: selectedV5Manifest ? pendingV5NamingBatches.reduce((sum, batch) => sum + batch.items.length, 0) : pendingNamingJobs.length, worldSummary, activeIssues: [] } : null;
  const v5CanonicalReadiness = loadedCanonicalV5 ? (() => {
    const candidateOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(loadedCanonicalV5.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
    return canonicalPolicyReadiness(candidateOwnerInputs, loadedCanonicalV5.governments.map((government) => government.governmentFormId));
  })() : { ready: false, missing: ["POSTGRES_CANONICAL_AUTHORITY"] };
  const namingReadiness = loadedCanonicalV5 ? (() => {
    return { routeCorridorsNotReady: loadedCanonicalV5.routeCorridors.filter((corridor) => effectiveRouteClassification(corridor).semanticReadiness === "NOT_READY").length, ownerPolicyBlockers: v5CanonicalReadiness.missing.length, canonicalNamingGaps: loadedCanonicalV5.sites.filter((site) => site.nameStatus !== "CANONICAL").length + loadedCanonicalV5.physicalPois.filter((poi) => poi.nameStatus !== "CANONICAL").length, unresolvedDjtYearAuthority: 1 };
  })() : { routeCorridorsNotReady: 0, ownerPolicyBlockers: v5CanonicalReadiness.missing.length, canonicalNamingGaps: 0, unresolvedDjtYearAuthority: 1 };
  const namingQueueSummary = selectedRun && selectedV5Manifest ? (() => {
    const requests = getStore().listV5NamingRequests(selectedRun.runId); const ledger = getStore().loadV5TrustedLabelLedger(selectedRun.runId);
    const entityTypes = ["SETTLEMENT","STATE","WORLD_POI","WORLD_ROUTE","FAMILY","ORGANIZATION","POLITICAL_PERSON","INSTITUTION"];
    const countByType = (rows: readonly { entityType: string }[]) => Object.fromEntries(entityTypes.map((entityType) => [entityType, rows.filter((row) => row.entityType === entityType).length]));
    return { pendingBlocking: countByType(requests.filter((request) => request.behavior === "BLOCKING" && !request.acceptedLabel)), pendingBatched: countByType(requests.filter((request) => request.behavior === "BATCHED" && !request.acceptedLabel)), acceptedFromLlm: countByType(ledger.filter((entry) => entry.source === "LLM_NAMING_RESPONSE")), canonicalOrReused: countByType(ledger.filter((entry) => entry.source === "CANONICAL_EXISTING" || entry.source === "AUTOMATIC_REUSE")), notReadyForNaming: { WORLD_ROUTE: namingReadiness.routeCorridorsNotReady * 3 } };
  })() : null;
  const startedAt = selectedRun?.createdAt ? Date.parse(selectedRun.createdAt) : NaN;
  const nextProcessingYear = Math.min(selectedV5Manifest?.targetYear ?? persistedYear, persistedYear + 1);
  const progress = selectedV5Manifest ? {
    targetYear: selectedV5Manifest.targetYear,
    currentYear: persistedYear,
    elapsedMilliseconds: Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0,
    currentPhase: selectedRun?.status === "RUNNING"
      ? nextProcessingYear % selectedV5Manifest.mechanicsVariables.structuralReviewIntervalYears === 0 ? "FIVE_YEAR_STRUCTURAL_REVIEW" : "ANNUAL_TEMPORAL_DEMOGRAPHY"
      : selectedRun?.status ?? "IDLE",
    lastCompletedCheckpoint: Math.max(...V5_WORLDS.map((world) => getStore().listV5CheckpointYears(selectedRun!.runId, world).at(-1) ?? 0)),
    nextCheckpoint: Math.min(selectedV5Manifest.targetYear, persistedYear + selectedV5Manifest.operationalConfig.checkpointIntervalYears),
  } : null;
  const v5DerogatoryDecisionBatches = selectedRun && selectedV5Manifest ? getStore().listV5DerogatoryDecisionBatches(selectedRun.runId) : [];
  const acceptedV5DerogatoryBatchIds = new Set(selectedRun && selectedV5Manifest ? getStore().listV5AcceptedDerogatoryDecisionBatches(selectedRun.runId).map((row) => row.batch.batchId) : []);
  const pendingV5DerogatoryBatch = v5DerogatoryDecisionBatches.find((row) => !acceptedV5DerogatoryBatchIds.has(row.batchId)) ?? null;
  const pendingV5DerogatoryDecisionBatch = pendingV5DerogatoryBatch ? { ...pendingV5DerogatoryBatch, externalPromptText: renderExternalDerogatoryDecisionPromptV5(pendingV5DerogatoryBatch) } : null;
  const v5PolicyBlockers = selectedRun && selectedV5Manifest ? getStore().listV5PolicyBlockers(selectedRun.runId) : [];
  return { canonicalData: loadedCanonicalData, domainDatabasePreflight, manifest, runs: runs.map((run) => ({ ...run, isV5: Boolean(getStore().loadV5RunManifest(run.runId)) })), selectedRunId: selectedRun?.runId ?? null, hasActiveRun, v5Run: Boolean(selectedV5Manifest), v5CanonicalReadiness, namingReadiness, namingQueueSummary, legacyNamingTrust, progress, projectionFreshness: projectionWatermark ? { runYear: causalPersistedYear, commonProjectedThroughYear: projectionWatermark.projectedThroughYear, selectedDataYear: persistedYear, freshness: projectionWatermark.status === "CURRENT" ? "CURRENT" : "STALE", lastErrorCode: projectionWatermark.lastErrorCode, mixedYearReadsAllowed: false } : null, exportValidation: null, sites, pendingNamingJob, pendingNamingBatches, pendingV5NamingBatch, pendingV5NamingBatches, pendingV5DerogatoryDecisionBatch, v5PolicyBlockers, atrocityOccurrenceSlots: selectedV5Manifest?.causalOwnerInputs.atrocityOccurrenceSlots ?? [], settlementProjections, databasePath: getStore().filename, canonicalResumeInProgress: Boolean(activeCanonicalResume && selectedRun && activeCanonicalResume.runId === selectedRun.runId), v5ResumeInProgress: Boolean(activeV5Resume && selectedRun && activeV5Resume.runId === selectedRun.runId), v5Configuration, v5ConfigurationEditable: !hasActiveRun };
}

async function runDomainDatabaseAction(action: DomainDatabasePreflight["actions"][number]): Promise<DomainDatabasePreflight> {
  if (action === "DOCTOR" || action === "RETRY") return preflightDomainDatabase();
  const script = action === "MIGRATE" ? "db:migrate" : "db:seed-policy-center";
  await disconnectDomainDatabase();
  try {
    await execFileAsync("pnpm", [script], { cwd: projectRoot, env: process.env, timeout: 120_000, maxBuffer: 1_000_000 });
  } catch {
    throw new Error(`DOMAIN_DATABASE_${action}_FAILED; run pnpm ${script} in the simulator repository for redacted diagnostics`);
  }
  return preflightDomainDatabase();
}

function snapshotForOperator(): Promise<OperatorSnapshot & Record<string, unknown>> {
  operatorSnapshotInFlight ??= buildOperatorSnapshot().finally(() => { operatorSnapshotInFlight = null; });
  return operatorSnapshotInFlight;
}

function runWorker(action: "RUN_DIAGNOSTIC" | "RUN_V5_DIAGNOSTIC" | "RESUME_V5" | "RESUME_CANONICAL" | "GET_BREED_POPULATION" | "GET_V5_RUN_VIEW", payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(join(import.meta.dirname, "simulation-worker.js"));
    const requestId = `${action}_${Date.now()}`;
    let settled = false;
    worker.once("error", (error) => { if (!settled) { settled = true; reject(error); } });
    worker.once("exit", (code) => { if (!settled) { settled = true; reject(new Error(`Worker exited before responding (${code})`)); } });
    worker.once("message", (message: { requestId: string; ok: boolean; payload?: unknown; error?: string }) => {
      settled = true;
      void worker.terminate();
      if (message.requestId !== requestId || !message.ok) reject(new Error(message.error ?? "Worker request failed"));
      else resolvePromise(message.payload);
    });
    worker.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId, action, payload });
  });
}

function startV5Resume(runId: string): { started: boolean; runId: string } {
  if (activeV5Resume?.runId === runId) return { started: false, runId };
  if (activeV5Resume) throw new Error(`V5 run ${activeV5Resume.runId} is already resuming`);
  const promise = runWorker("RESUME_V5", { databasePath: getStore().filename, runId, resourceDirectory: runtimeResources })
    .catch((error: unknown) => {
      const run = getStore().getRun(runId);
      if (run?.status === "RUNNING") getStore().setRunStatus(runId, "FAILED", run.currentYear ?? 0);
      console.error(`V5 resume failed for ${runId}:`, error);
      mainWindow?.webContents.send("simulator:v5-resume-failed", error instanceof Error ? error.message : "V5 resume failed");
    })
    .finally(() => { if (activeV5Resume?.runId === runId) activeV5Resume = null; });
  activeV5Resume = { runId, promise };
  return { started: true, runId };
}

function startCanonicalResume(runId: string): { started: boolean; runId: string } {
  if (activeCanonicalResume?.runId === runId) return { started: false, runId };
  if (activeCanonicalResume) throw new Error(`Canonical run ${activeCanonicalResume.runId} is already resuming`);
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  const promise = runWorker("RESUME_CANONICAL", { databasePath: getStore().filename, runId, canonicalDirectory: canonicalData.directory })
    .catch((error: unknown) => {
      const run = getStore().getRun(runId);
      if (run?.status === "RUNNING") getStore().setRunStatus(runId, "FAILED", getStore().latestCompleteCheckpointYear(runId, ["CONCORD", "SCHISM", "RUIN"]) ?? run.currentYear ?? 0);
      console.error(`Canonical resume failed for ${runId}:`, error);
      mainWindow?.webContents.send("simulator:canonical-resume-failed", error instanceof Error ? error.message : "Canonical resume failed");
    })
    .finally(() => { if (activeCanonicalResume?.runId === runId) activeCanonicalResume = null; });
  activeCanonicalResume = { runId, promise };
  return { started: true, runId };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1040, minHeight: 700,
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`Renderer failed to load ${url}: ${code} ${description}`));
  const developmentServer = process.env.VITE_DEV_SERVER_URL;
  if (developmentServer) await mainWindow.loadURL(developmentServer);
  else await mainWindow.loadFile(join(import.meta.dirname, "../../dist/index.html"));
  const resumable = getStore().selectedRun();
  if (resumable?.status === "RUNNING" && getStore().loadV5RunManifest(resumable.runId)) startV5Resume(resumable.runId);
  else if (resumable?.mode === "CANONICAL" && resumable.status === "RUNNING" && !getStore().getPendingNamingJob(resumable.runId)) startCanonicalResume(resumable.runId);
}

ipcMain.handle("simulator:get-runtime-info", () => ({ version: app.getVersion(), userDataPath: app.getPath("userData") }));
ipcMain.handle("simulator:get-operator-snapshot", snapshotForOperator);
ipcMain.handle("simulator:domain-database-action", async (_event, action: DomainDatabasePreflight["actions"][number]) => {
  if (!["DOCTOR", "MIGRATE", "SEED", "RETRY"].includes(action)) throw new Error("Unknown domain database action");
  return runDomainDatabaseAction(action);
});
ipcMain.handle("simulator:save-v5-configuration", async (_event, input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }) => {
  const hasActiveRun = getStore().listRuns().some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING", "WAITING_FOR_POLICY_AUTHORITY", "WAITING_FOR_DEROGATORY_DECISIONS"].includes(run.status));
  if (hasActiveRun) throw new Error("Simulation Variables are read-only while a run is active");
  const configuration = parseEditableV5Configuration(input);
  getStore().saveV5Configuration(configuration);
  return snapshotForOperator();
});
ipcMain.handle("simulator:run-diagnostic", async (_event, seed: string) => {
  const state = deriveOperatorViewModel(await snapshotForOperator());
  if (!state.canRunDiagnostic) throw new Error(state.diagnosticDisabledReasons.join(" "));
  const result = await runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }) as DiagnosticResult;
  return persistDiagnosticResult(getStore(), result);
});
ipcMain.handle("simulator:run-v5-diagnostic", async (_event, seed: string, throughYear = 25, interactiveNaming = true) => {
  const hasActiveRun = getStore().listRuns().some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING", "WAITING_FOR_POLICY_AUTHORITY", "WAITING_FOR_DEROGATORY_DECISIONS"].includes(run.status));
  if (hasActiveRun) throw new Error("Another simulation run is active");
  const targetYear = Math.trunc(throughYear);
  if (!Number.isFinite(targetYear) || targetYear < 1 || targetYear > 2000) throw new Error("V5 target year must be an integer from 1 through 2000");
  const configuration = getStore().loadV5Configuration();
  getStore().saveV5Configuration({ ...configuration, operational: { ...configuration.operational, interactiveNamingEnabled: Boolean(interactiveNaming) } });
  return runWorker("RUN_V5_DIAGNOSTIC", { seed, throughYear: targetYear, namingMode: interactiveNaming ? "INTERACTIVE_LLM_NAMING" : undefined, resourceDirectory: runtimeResources, databasePath: getStore().filename });
});
ipcMain.handle("simulator:get-naming-geography", (_event, requestedYear?: number) => {
  const isolatedFixturePath = process.env.NODE_ENV === "test" ? process.env.EIDOLON_V5_NAMING_GEOGRAPHY_FIXTURE : undefined;
  if (isolatedFixturePath && existsSync(isolatedFixturePath)) return JSON.parse(readFileSync(isolatedFixturePath, "utf8"));
  const run = getStore().selectedRun();
  const manifest = run ? getStore().loadV5RunManifest(run.runId) : null;
  if (!run || !manifest) return null;
  const year = Math.max(0, Math.min(Number.isFinite(requestedYear) ? Math.trunc(requestedYear!) : run.currentYear ?? 0, run.currentYear ?? 0));
  const canonical = canonicalV5FromRunAuthoritySnapshot(manifest.authoritySnapshot, manifest.canonicalBundleHash, year);
  const states = Object.fromEntries(V5_WORLDS.flatMap((world) => { const state = getStore().loadLatestV5Checkpoint(run.runId, world, year)?.state; return state ? [[world, state]] : []; })) as Partial<Record<WorldKeyV5, WorldStateV5>>;
  return buildNamingGeographyReadModel(canonical, states, getStore().loadV5TrustedLabelLedger(run.runId, year), getStore().listV5NamingRequests(run.runId), year);
});
ipcMain.handle("simulator:select-run", async (_event, runId: string) => { getStore().selectRun(runId); return snapshotForOperator(); });
ipcMain.handle("simulator:get-run-view", async (_event, runId: string, world: string, year: number, detail?: V5OperatorViewDetail) => {
  const run = getStore().getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const v5Manifest = getStore().loadV5RunManifest(runId);
  const projectionWatermark = v5Manifest ? getStore().loadV5ProjectionWatermark(runId) : null;
  const readableThroughYear = projectionWatermark?.projectedThroughYear ?? run.currentYear ?? 0;
  const effectiveYear = Math.max(0, Math.min(Number.isFinite(year) ? Math.trunc(year) : 0, readableThroughYear));
  if (v5Manifest) {
    if (!V5_WORLDS.includes(world as WorldKeyV5)) throw new Error(`Unknown V5 world ${world}`);
    return runWorker("GET_V5_RUN_VIEW", { databasePath: getStore().filename, runId, world, year: effectiveYear, detail });
  }
  return {
    runId, world, requestedYear: year, effectiveYear,
    settlements: presentedSettlements(runId, getStore().listProjections(runId, world, effectiveYear, "SETTLEMENT")),
    events: getStore().listEventsThroughYear(runId, world, effectiveYear),
    history: getStore().listHistoryRowsForView(runId, world, effectiveYear),
    checkpoints: getStore().listCheckpointMetadata(runId, world, effectiveYear),
  };
});
ipcMain.handle("simulator:get-breed-catalog", async () => {
  breedCatalogPromise ??= loadBreedCatalog();
  return breedCatalogPromise;
});
ipcMain.handle("simulator:get-owner-policy-center", async () => listOwnerPolicyCenter());
ipcMain.handle("simulator:decide-owner-policy", async (_event, input: Parameters<typeof decideOwnerPolicyRevisions>[0]) => decideOwnerPolicyRevisions(input, { actorId: `LOCAL_OWNER_SESSION:${userInfo().username}`, currentRunYear: getStore().selectedRun()?.currentYear ?? null, actionProvenance: "OWNER_POLICY_CENTER:LOCAL_AUTHENTICATED_SESSION" }));
ipcMain.handle("simulator:create-owner-policy-revision", async (_event, input: Parameters<typeof createOwnerPolicyCandidateRevision>[0]) => createOwnerPolicyCandidateRevision(input, { actorId: `LOCAL_OWNER_SESSION:${userInfo().username}`, actionProvenance: "OWNER_POLICY_CENTER:LOCAL_AUTHENTICATED_SESSION" }));
ipcMain.handle("simulator:get-breed-population", async (_event, runId: string, breedId: string, year: number) => {
  const run = getStore().getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  return runWorker("GET_BREED_POPULATION", { databasePath: getStore().filename, runId, breedId, year });
});
ipcMain.handle("simulator:get-atlas-data", async (_event, requestedYear?: number) => {
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  atlasPoiCache ??= await loadCanonicalAtlasPois();
  const run = getStore().selectedRun();
  const year = Math.min(requestedYear ?? run?.currentYear ?? 0, run?.currentYear ?? 0);
  const namesByPoi = new Map<string, Partial<Record<"CONCORD" | "SCHISM" | "RUIN", string>>>();
  if (run) for (const { job, status } of getStore().listNamingJobs(run.runId)) {
    if (status !== "ACCEPTED") continue;
    for (const accepted of getStore().getAcceptedNames(job.namingJobId)) {
      if (accepted.entityType !== "POI") continue;
      const names = namesByPoi.get(accepted.entityId) ?? {};
      names[job.context.world] = accepted.name;
      namesByPoi.set(accepted.entityId, names);
    }
  }
  if (run && getStore().loadV5RunManifest(run.runId)) {
    const labels = getStore().loadV5Labels(run.runId, year);
    for (const poi of atlasPoiCache) for (const world of V5_WORLDS) {
      const label = labels[`WORLD_POI_${world}_${poi.poiId}`];
      if (!label) continue;
      const names = namesByPoi.get(poi.poiId) ?? {};
      names[world] = label;
      namesByPoi.set(poi.poiId, names);
    }
  }
  const imagePath = join(runtimeResources, "ui/master-atlas.webp");
  if (!existsSync(imagePath)) throw new Error("Bundled master Atlas image is missing");
  const v5Manifest = run ? getStore().loadV5RunManifest(run.runId) : null;
  const states = (v5Manifest ? Object.fromEntries(V5_WORLDS.flatMap((world) => { const state = getStore().loadLatestV5Checkpoint(run!.runId, world, year)?.state; return state ? [[world, state]] : []; })) : {}) as Partial<Record<WorldKeyV5, WorldStateV5>>;
  const canonicalV5 = v5Manifest
    ? canonicalV5FromRunAuthoritySnapshot(v5Manifest.authoritySnapshot, v5Manifest.canonicalBundleHash, year)
    : (await loadPostgresCanonicalV5()).canonical;
  const labels = run && v5Manifest ? getStore().loadV5Labels(run.runId, year) : {};
  const requests = run && v5Manifest ? getStore().listV5NamingRequests(run.runId) : [];
  const routeCoverage = buildRouteCoverageReadModel(canonicalV5, states, Object.fromEntries(V5_WORLDS.map((world) => [world, labels])), Object.fromEntries(V5_WORLDS.map((world) => [world, requests.filter((request) => request.entityId.startsWith(`WORLD_ROUTE_${world}_`))])));
  const poiCoverage = buildPoiCoverage(canonicalV5, states, Object.fromEntries(V5_WORLDS.map((world) => [world, labels])), Object.fromEntries(V5_WORLDS.map((world) => [world, requests.filter((request) => request.entityId.startsWith(`WORLD_POI_${world}_`))])));
  const settlementsByWorld = Object.fromEntries(V5_WORLDS.map((world) => [world, states[world] && run ? v5SettlementProjection(run.runId, states[world]!).map((settlement) => {
    const site = canonicalV5.sites.find((candidate) => candidate.siteId === settlement.siteId);
    return { ...settlement, latitude: site?.latitude ?? 0, longitude: site?.longitude ?? 0 };
  }) : []]));
  return { imageUrl: pathToFileURL(imagePath).href, pois: runtimeVisibleAtlasPois(atlasPoiCache).map((poi) => ({ ...poi, namesByWorld: namesByPoi.get(poi.poiId) ?? {}, coverageByWorld: Object.fromEntries(V5_WORLDS.map((world) => [world, poiCoverage.rows.find((row) => row.poiId === poi.poiId)?.worlds[world] ?? null])) })), settlementsByWorld, routes: routeCoverage.rows, routeSummary: routeCoverage };
});

app.on("before-quit", () => { void disconnectDomainDatabase(); });
ipcMain.handle("simulator:run-canonical", async (_event, seed: string) => {
  const loadedCanonicalData = canonicalData();
  const state = deriveOperatorViewModel(await snapshotForOperator());
  if (!state.canRunCanonical) throw new Error(state.canonicalDisabledReasons.join(" "));
  if (loadedCanonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${loadedCanonicalData.errorDetail}`);
  return bootstrapCanonicalRun({ store: getStore(), seed, canonicalDirectory: loadedCanonicalData.directory });
});
ipcMain.handle("simulator:resume-canonical", (_event, runId: string) => {
  const run = getStore().getRun(runId);
  if (!run || run.mode !== "CANONICAL") throw new Error(`Unknown canonical run ${runId}`);
  if (run.status === "FAILED") getStore().setRunStatus(runId, "RUNNING", getStore().latestCompleteCheckpointYear(runId, ["CONCORD", "SCHISM", "RUIN"]) ?? run.currentYear ?? 0);
  return startCanonicalResume(runId);
});
ipcMain.handle("simulator:resume-v5", (_event, runId: string) => {
  const run = getStore().getRun(runId);
  if (!run || !getStore().loadV5RunManifest(runId)) throw new Error(`Unknown V5 run ${runId}`);
  if (run.status === "FAILED") getStore().setRunStatus(runId, "RUNNING", run.currentYear ?? 0);
  return startV5Resume(runId);
});
ipcMain.handle("simulator:submit-naming-response", (_event, responseText: string) => {
  const selected = getStore().selectedRun();
  if (selected && getStore().loadV5RunManifest(selected.runId) && getStore().listV5NamingRequests(selected.runId).some((request) => request.acceptedLabel === null && (request.behavior === "BLOCKING" || request.behavior === "BATCHED"))) {
    let parsed: unknown;
    try { parsed = JSON.parse(responseText); } catch { return { accepted: false, errors: ["Naming response is not valid JSON"] }; }
    const accepted = acceptPersistedV5NamingBatch({ store: getStore(), runId: selected.runId, response: parsed });
    if (!accepted.accepted) return accepted;
    if ((accepted.pendingBlocking ?? 0) === 0 && (accepted.pendingBatched ?? 0) === 0 && (accepted.behavior === "BLOCKING" || selected.status === "WAITING_FOR_NAMING")) {
      startV5Resume(selected.runId);
      return { ...accepted, status: "RUNNING", resumeStarted: true };
    }
    return { ...accepted, status: getStore().getRun(selected.runId)?.status ?? selected.status, resumeStarted: false };
  }
  const firstJob = getStore().getAnyPendingNamingJob();
  if (!firstJob) throw new Error("No pending naming job exists");
  let parsed: unknown;
  try { parsed = JSON.parse(responseText); } catch { throw new Error("Naming response is not valid JSON"); }
  const pendingJobs = getStore().listPendingNamingJobs(firstJob.context.runId);
  if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && (parsed as { schemaVersion?: unknown }).schemaVersion === "eidolon-simulator-naming-batch-response-v1") {
    const batches = buildNamingBatches(pendingJobs);
    const submittedBatchId = "namingBatchId" in parsed && typeof (parsed as { namingBatchId?: unknown }).namingBatchId === "string" ? (parsed as { namingBatchId: string }).namingBatchId : "";
    const batch = batches.find((candidate) => candidate.namingBatchId === submittedBatchId);
    if (!batch) return { accepted: false, errors: ["namingBatchId does not match a pending world/year batch"] };
    const result = validateNamingBatchResponse(batch, parsed);
    if (!result.accepted || !result.responses) {
      for (const job of batch.jobs) getStore().recordRejectedNamingAttempt(job.namingJobId, `NAMING_ATTEMPT_${randomUUID()}`, responseText, result.errors);
      return { accepted: false, errors: result.errors };
    }
    const jobs = new Map(batch.jobs.map((job) => [job.namingJobId, job]));
    getStore().acceptNamingResponses(result.responses.map((response) => {
      const job = jobs.get(response.namingJobId)!;
      const items = new Map(job.items.map((item) => [item.requestId, item]));
      return {
        namingJobId: job.namingJobId,
        attemptId: `NAMING_ATTEMPT_${randomUUID()}`,
        responseText,
        decisions: response.decisions.map((decision) => ({ requestId: decision.requestId, entityType: decision.entityType, entityId: items.get(decision.requestId)!.entityId, name: decision.name })),
      };
    }));
    if (getStore().getPendingNamingJob(batch.runId)) return { accepted: true, errors: [], status: "WAITING_FOR_NAMING", currentYear: batch.year, acceptedJobs: result.responses.length, acceptedDecisions: result.responses.reduce((sum, response) => sum + response.decisions.length, 0) };
    startCanonicalResume(batch.runId);
    return { accepted: true, errors: [], status: "RUNNING", currentYear: batch.year, resumeStarted: true, acceptedJobs: result.responses.length, acceptedDecisions: result.responses.reduce((sum, response) => sum + response.decisions.length, 0) };
  }
  const submittedJobId = parsed && typeof parsed === "object" && "namingJobId" in parsed && typeof (parsed as { namingJobId?: unknown }).namingJobId === "string" ? (parsed as { namingJobId: string }).namingJobId : "";
  const job = pendingJobs.find((candidate) => candidate.namingJobId === submittedJobId) ?? firstJob;
  const result = validateNamingResponse(job, parsed);
  const attemptId = `NAMING_ATTEMPT_${randomUUID()}`;
  if (!result.accepted || !result.decisions) { getStore().recordRejectedNamingAttempt(job.namingJobId, attemptId, responseText, result.errors); return { accepted: false, errors: result.errors }; }
  const items = new Map(job.items.map((item) => [item.requestId, item]));
  getStore().acceptNamingResponse(job.namingJobId, attemptId, responseText, result.decisions.map((decision) => ({ requestId: decision.requestId, entityType: decision.entityType, entityId: items.get(decision.requestId)!.entityId, name: decision.name })));
  if (getStore().getPendingNamingJob(job.context.runId)) return { accepted: true, errors: [], status: "WAITING_FOR_NAMING", currentYear: job.context.year };
  startCanonicalResume(job.context.runId);
  return { accepted: true, errors: [], status: "RUNNING", currentYear: job.context.year, resumeStarted: true };
});
ipcMain.handle("simulator:submit-derogatory-decision-response", (_event, responseText: string) => {
  const selected = getStore().selectedRun(); if (!selected || !getStore().loadV5RunManifest(selected.runId)) throw new Error("No V5 run is selected");
  let parsed: unknown; try { parsed = JSON.parse(responseText); } catch { return { accepted: false, errors: ["Derogatory decision response is not valid JSON"] }; }
  const accepted = acceptPersistedV5DerogatoryDecisionBatch({ store: getStore(), runId: selected.runId, response: parsed });
  if (accepted.accepted) { startV5Resume(selected.runId); return { ...accepted, status: "RUNNING", resumeStarted: true }; }
  return accepted;
});
ipcMain.handle("simulator:export-naming-prompt", async (_event, promptText: string, batchId: string) => {
  if (!promptText.trim()) throw new Error("No naming prompt is available to export");
  const safeBatchId = batchId.replace(/[^A-Za-z0-9_.-]/g, "_");
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `${safeBatchId || "v5-naming-batch"}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, promptText, "utf8");
  return { path: result.filePath };
});
ipcMain.handle("simulator:export-all-naming-prompts", async () => {
  const selected = getStore().selectedRun();
  const manifest = selected ? getStore().loadV5RunManifest(selected.runId) : null;
  if (!selected || !manifest) throw new Error("No V5 run is selected");
  const batches = getStore().materializePendingV5NamingBatches(selected.runId, manifest.operationalConfig.namingBatchMaximum);
  const exported = buildNamingPromptExportV5(selected.runId, batches);
  const result = await dialog.showOpenDialog(mainWindow!, { title: "Choose a folder for all naming prompts", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const directory = result.filePaths[0];
  for (const file of exported.promptFiles) writeFileSync(join(directory, file.filename), file.text, "utf8");
  writeFileSync(join(directory, exported.manifestFilename), exported.manifestText, "utf8");
  return { directory, batchCount: exported.batchCount, requestCount: exported.requestCount, manifestPath: join(directory, exported.manifestFilename) };
});
ipcMain.handle("simulator:upload-all-naming-responses", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { title: "Choose the ZIP containing all naming response JSON files", properties: ["openFile"], filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = getStore().selectedRun();
  const manifest = selected ? getStore().loadV5RunManifest(selected.runId) : null;
  if (!selected || !manifest) throw new Error("No V5 run is selected");
  const batches = getStore().materializePendingV5NamingBatches(selected.runId, manifest.operationalConfig.namingBatchMaximum);
  const archive = parseNamingResponseZipV5(readFileSync(result.filePaths[0]), batches);
  if (!archive.accepted || !archive.responses) return { accepted: false, errors: archive.errors, filename: result.filePaths[0] };
  const accepted = acceptPersistedV5NamingBatches({ store: getStore(), runId: selected.runId, batches, responses: archive.responses });
  if (!accepted.accepted) return { ...accepted, filename: result.filePaths[0] };
  const shouldResume = (accepted.pendingBlocking ?? 0) === 0 && (accepted.pendingBatched ?? 0) === 0 && (accepted.behaviors?.includes("BLOCKING") || selected.status === "WAITING_FOR_NAMING");
  if (shouldResume) {
    startV5Resume(selected.runId);
    return { ...accepted, status: "RUNNING", resumeStarted: true, filename: result.filePaths[0] };
  }
  return { ...accepted, status: getStore().getRun(selected.runId)?.status ?? selected.status, resumeStarted: false, filename: result.filePaths[0] };
});
ipcMain.handle("simulator:export-run", async () => {
  const run = getStore().selectedRun();
  if (!run) throw new Error("No persisted run is selected");
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  const generated = getStore().loadV5RunManifest(run.runId) ? buildPersistedV5Export(getStore(), run.runId) : buildPersistedCanonicalExport(getStore(), run.runId, canonicalData.directory);
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `EIDOLON_SIMULATION_${run.runId}.zip`, filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, generated.bytes);
  const verified = verifyExportZip(readFileSync(result.filePath));
  getStore().saveExportMetadata({ exportId: `EXPORT_${randomUUID()}`, runId: run.runId, createdAt: new Date().toISOString(), filename: result.filePath, sha256: generated.sha256, manifest: verified.manifest });
  return { filename: result.filePath, sha256: generated.sha256, checkedFiles: verified.files.length };
});

app.whenReady().then(async () => {
  setPackagedDomainDatabaseConnectionProvider(() => {
    if (!app.isPackaged) return null;
    const encryptedPath = join(app.getPath("userData"), "canonical-database-url.safe-storage");
    if (!existsSync(encryptedPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("ELECTRON_SAFE_STORAGE_UNAVAILABLE");
    return safeStorage.decryptString(readFileSync(encryptedPath));
  });
  await createWindow();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => { store?.close(); store = null; });
