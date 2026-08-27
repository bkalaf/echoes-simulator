import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import { WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
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
import { loadAtlasPois } from "../src/core/atlas/atlas-view.js";
import { CANONICAL_POLICY_VERSION } from "../src/core/engine/canonical-authority.js";
import { editableV5ConfigurationJson, parseEditableV5Configuration } from "../src/core/v5/configuration.js";
import { loadBundledCanonicalV5 } from "../src/core/v5/canonical-adapter.js";
import { buildReadModelV1 } from "../src/core/v5/read-model.js";
import type { WorldKey as WorldKeyV5, WorldStateV5 } from "../src/core/v5/types.js";
import { acceptPersistedV5NamingBatch } from "../src/core/v5/service.js";
import { buildPersistedNamingBatchesV5 } from "../src/core/v5/naming.js";
import { buildRouteCoverageReadModel } from "../src/core/v5/routes.js";
import { buildPoiCoverage } from "../src/core/atlas/coverage.js";
import { canonicalPolicyReadiness, diagnosticCandidateOwnerInputsV1 } from "../src/core/v5/config.js";

let mainWindow: BrowserWindow | null = null;
const projectRoot = resolve(import.meta.dirname, "../..");
const runtimeResources = !app.isPackaged && process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY
  ? resolve(process.env.EIDOLON_SIMULATOR_RESOURCE_DIRECTORY)
  : app.isPackaged ? join(process.resourcesPath, "simulator-resources") : join(projectRoot, "resources");
let store: SimulatorStore | null = null;
let activeCanonicalResume: { runId: string; promise: Promise<unknown> } | null = null;
let activeV5Resume: { runId: string; promise: Promise<unknown> } | null = null;
let poiContextCache: { canonicalDirectory: string; bySite: ReturnType<typeof loadUnnamedPoisBySite> } | null = null;
let breedCatalogPromise: ReturnType<typeof loadBreedCatalog> | null = null;
let atlasPoiCache: ReturnType<typeof loadAtlasPois> | null = null;

function getStore(): SimulatorStore {
  if (!store) {
    store = new SimulatorStore(join(app.getPath("userData"), "simulator.sqlite"));
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
  const canonical = loadBundledCanonicalV5(join(runtimeResources, "canonical"));
  const read = buildReadModelV1(state, canonical, manifest.mechanicsVariables, getStore().loadV5Labels(runId));
  return read.settlements.map((settlement) => {
    const durable = state.settlements.find((candidate) => candidate.settlementId === settlement.settlementId)!;
    const politicalState = state.states.find((candidate) => candidate.stateId === settlement.stateId);
    const dominantBreed = state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId).map((cell) => ({ breedId: cell.breedId, population: cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population })).sort((a, b) => a.population === b.population ? a.breedId.localeCompare(b.breedId) : a.population > b.population ? -1 : 1)[0]?.breedId ?? "NONE";
    return { settlementId: settlement.settlementId, siteId: durable.siteId, regionId: durable.regionId, stateId: settlement.stateId, name: settlement.label, population: settlement.population, cultureId: null, cultureState: "V5_DERIVED", dominantBreed, dominantFaction: settlement.dominantFaction, politicalForm: politicalState?.actualGovernment ?? null, economicForm: settlement.supportedEconomicForm, prosperity: settlement.prosperity, unrest: settlement.unrest, runtimeIssues: [] };
  });
}

function snapshotForOperator(): OperatorSnapshot & Record<string, unknown> {
  const canonicalData = loadBundledCanonical(runtimeResources);
  const sitesPath = join(canonicalData.directory, "atlas/sites_naming_master.csv");
  const sites = existsSync(sitesPath) ? parseCsvSync(readFileSync(sitesPath), { bom: true, columns: true, skip_empty_lines: true }) : [];
  const runs = getStore().listRuns();
  if (canonicalData.status === "READY") {
    if (!poiContextCache || poiContextCache.canonicalDirectory !== canonicalData.directory) poiContextCache = { canonicalDirectory: canonicalData.directory, bySite: loadUnnamedPoisBySite(canonicalData.directory) };
    for (const run of runs.filter((candidate) => candidate.mode === "CANONICAL" && candidate.status === "WAITING_FOR_NAMING")) {
      const pending = getStore().listPendingNamingJobs(run.runId);
      getStore().supersedePendingNamingJobs(enrichPendingNamingJobsWithPois(pending, poiContextCache.bySite));
    }
  }
  const selectedRun = getStore().selectedRun();
  const selectedV5Manifest = selectedRun ? getStore().loadV5RunManifest(selectedRun.runId) : null;
  const pendingV5NamingBatches = selectedRun && selectedV5Manifest ? buildPersistedNamingBatchesV5(selectedRun.runId, getStore().listV5NamingRequests(selectedRun.runId), selectedV5Manifest.operationalConfig.namingBatchSize) : [];
  const pendingV5NamingBatch = pendingV5NamingBatches[0] ?? null;
  const persistedYear = selectedRun?.mode === "CANONICAL"
    ? Math.max(selectedRun.currentYear ?? 0, getStore().latestCompleteCheckpointYear(selectedRun.runId, ["CONCORD", "SCHISM", "RUIN"]) ?? 0)
    : selectedRun?.currentYear ?? 0;
  const pendingNamingJob = selectedV5Manifest ? null : ((selectedRun && selectedRun.status !== "RETIRED_DATA_AUTHORITY" ? getStore().getPendingNamingJob(selectedRun.runId) : null) ?? (!selectedRun ? getStore().getAnyPendingNamingJob() : null));
  const pendingNamingJobs = pendingNamingJob ? getStore().listPendingNamingJobs(pendingNamingJob.context.runId) : [];
  const pendingNamingBatches = buildNamingBatches(pendingNamingJobs);
  const hasActiveRun = runs.some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING"].includes(run.status));
  const v5Configuration = editableV5ConfigurationJson(getStore().loadV5Configuration());
  const v5States = selectedV5Manifest ? Object.fromEntries(V5_WORLDS.map((world) => [world, getStore().loadLatestV5Checkpoint(selectedRun!.runId, world, persistedYear)?.state ?? null])) as Record<WorldKeyV5, WorldStateV5 | null> : null;
  const settlementProjections = selectedRun ? selectedV5Manifest
    ? Object.fromEntries(V5_WORLDS.map((world) => [world, v5States![world] ? v5SettlementProjection(selectedRun.runId, v5States![world]!) : []]))
    : Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => [world, presentedSettlements(selectedRun.runId, getStore().listProjections(selectedRun.runId, world, persistedYear, "SETTLEMENT"))])) : null;
  const eventCount = selectedRun ? selectedV5Manifest ? getStore().v5EventCount(selectedRun.runId) : getStore().eventCount(selectedRun.runId) : 0;
  const checkpointCount = selectedRun ? selectedV5Manifest ? getStore().v5CheckpointCount(selectedRun.runId) : getStore().checkpointCount(selectedRun.runId) : 0;
  const cohortCount = selectedRun ? selectedV5Manifest ? V5_WORLDS.reduce((sum, world) => sum + (v5States![world]?.cohorts.length ?? 0), 0) : getStore().countCohorts(selectedRun.runId, undefined, persistedYear) : 0;
  const worldSummary = selectedRun ? Object.fromEntries(["CONCORD", "SCHISM", "RUIN"].map((world) => {
    const settlements = settlementProjections![world] as { population?: string; stateId?: string }[];
    return [world, { finalPopulation: settlements.reduce((sum, settlement) => sum + BigInt(settlement.population ?? "0"), 0n).toString(), settlements: settlements.length, states: new Set(settlements.map((settlement) => String(settlement.stateId))).size, events: selectedV5Manifest ? getStore().listV5CausalEvents(selectedRun!.runId, world).length : eventCount, federalCapitalSiteId: null }];
  })) : null;
  const manifest = selectedRun ? { ...selectedRun, currentYear: persistedYear, finalYear: selectedV5Manifest?.targetYear ?? 2000, checkpointCount, eventCount, cohortCount, namingJobCount: selectedV5Manifest ? pendingV5NamingBatches.reduce((sum, batch) => sum + batch.items.length, 0) : pendingNamingJobs.length, worldSummary, activeIssues: [] } : null;
  const v5CanonicalReadiness = canonicalData.status === "READY" ? (() => {
    const canonicalV5 = loadBundledCanonicalV5(join(runtimeResources, "canonical"));
    const candidateOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonicalV5.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
    return canonicalPolicyReadiness(candidateOwnerInputs, canonicalV5.governments.map((government) => government.governmentFormId));
  })() : { ready: false, missing: ["CANONICAL_BUNDLE"] };
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
  return { canonicalData, manifest, runs: runs.map((run) => ({ ...run, isV5: Boolean(getStore().loadV5RunManifest(run.runId)) })), selectedRunId: selectedRun?.runId ?? null, hasActiveRun, v5Run: Boolean(selectedV5Manifest), v5CanonicalReadiness, progress, exportValidation: null, sites, pendingNamingJob, pendingNamingBatches, pendingV5NamingBatch, pendingV5NamingBatches, settlementProjections, databasePath: getStore().filename, canonicalResumeInProgress: Boolean(activeCanonicalResume && selectedRun && activeCanonicalResume.runId === selectedRun.runId), v5ResumeInProgress: Boolean(activeV5Resume && selectedRun && activeV5Resume.runId === selectedRun.runId), v5Configuration, v5ConfigurationEditable: !hasActiveRun };
}

function runWorker(action: "RUN_DIAGNOSTIC" | "RUN_V5_DIAGNOSTIC" | "RESUME_V5" | "RESUME_CANONICAL" | "GET_BREED_POPULATION", payload: Record<string, unknown>): Promise<unknown> {
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
ipcMain.handle("simulator:save-v5-configuration", (_event, input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }) => {
  const hasActiveRun = getStore().listRuns().some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING"].includes(run.status));
  if (hasActiveRun) throw new Error("Simulation Variables are read-only while a run is active");
  const configuration = parseEditableV5Configuration(input);
  getStore().saveV5Configuration(configuration);
  return snapshotForOperator();
});
ipcMain.handle("simulator:run-diagnostic", async (_event, seed: string) => {
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunDiagnostic) throw new Error(state.diagnosticDisabledReasons.join(" "));
  const result = await runWorker("RUN_DIAGNOSTIC", { seed, resourceDirectory: runtimeResources }) as DiagnosticResult;
  return persistDiagnosticResult(getStore(), result);
});
ipcMain.handle("simulator:run-v5-diagnostic", async (_event, seed: string, throughYear = 25) => {
  const hasActiveRun = getStore().listRuns().some((run) => Boolean(getStore().loadV5RunManifest(run.runId)) && ["RUNNING", "WAITING_FOR_NAMING"].includes(run.status));
  if (hasActiveRun) throw new Error("Another simulation run is active");
  const targetYear = Math.trunc(throughYear);
  if (!Number.isFinite(targetYear) || targetYear < 1 || targetYear > 2000) throw new Error("V5 target year must be an integer from 1 through 2000");
  return runWorker("RUN_V5_DIAGNOSTIC", { seed, throughYear: targetYear, resourceDirectory: runtimeResources, databasePath: getStore().filename });
});
ipcMain.handle("simulator:select-run", (_event, runId: string) => { getStore().selectRun(runId); return snapshotForOperator(); });
ipcMain.handle("simulator:get-run-view", (_event, runId: string, world: string, year: number) => {
  const run = getStore().getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const effectiveYear = Math.max(0, Math.min(Number.isFinite(year) ? Math.trunc(year) : 0, run.currentYear ?? 0));
  const v5Manifest = getStore().loadV5RunManifest(runId);
  if (v5Manifest) {
    if (!V5_WORLDS.includes(world as WorldKeyV5)) throw new Error(`Unknown V5 world ${world}`);
    const checkpoint = getStore().loadLatestV5Checkpoint(runId, world, effectiveYear);
    const checkpointYear = checkpoint?.state.year ?? 0;
    const labels = getStore().loadV5Labels(runId);
    const canonical = loadBundledCanonicalV5(join(runtimeResources, "canonical"));
    const personFactionById = Object.fromEntries((checkpoint?.state.politicalPeople ?? []).map((person) => {
      const family = checkpoint?.state.families.find((candidate) => candidate.familyId === person.familyId);
      if (family) return [person.personId, family.factionAffinity.CONCORD >= family.factionAffinity.SCHISM && family.factionAffinity.CONCORD >= family.factionAffinity.RUIN ? "CONCORD" : family.factionAffinity.SCHISM >= family.factionAffinity.RUIN ? "SCHISM" : "RUIN"];
      const breed = canonical.breeds.find((candidate) => candidate.breedId === person.breedId);
      const vector = breed?.factionObject ?? { CONCORD: 0, SCHISM: 0, RUIN: 0 };
      return [person.personId, vector.CONCORD >= vector.SCHISM && vector.CONCORD >= vector.RUIN ? "CONCORD" : vector.SCHISM >= vector.RUIN ? "SCHISM" : "RUIN"];
    }));
    const familyHistory = checkpoint ? getStore().listV5CheckpointMetadata(runId, world, effectiveYear).flatMap((metadata) => {
      const historical = getStore().loadLatestV5Checkpoint(runId, world, metadata.year)?.state;
      return (historical?.families ?? []).map((family) => ({ year: metadata.year, familyId: family.familyId, wealth: family.wealth, influence: family.influence, prestige: family.prestige, status: family.status }));
    }) : [];
    return {
      runId, world, requestedYear: year, effectiveYear: checkpointYear,
      settlements: checkpoint ? v5SettlementProjection(runId, checkpoint.state) : [],
      events: getStore().listV5CausalEvents(runId, world, effectiveYear).map((event) => ({ eventId: event.eventId, year: event.year, eventType: event.eventType, entityId: event.entityId, payload: event.payload })),
      history: [],
      checkpoints: getStore().listV5CheckpointMetadata(runId, world, effectiveYear),
      states: checkpoint?.state.states ?? [],
      people: checkpoint?.state.politicalPeople ?? [],
      families: checkpoint?.state.families ?? [],
      organizations: checkpoint?.state.organizations ?? [],
      institutions: checkpoint?.state.institutions ?? [],
      offices: checkpoint?.state.offices ?? [],
      officeTerms: checkpoint?.state.officeTerms ?? [],
      ownershipStakes: checkpoint?.state.ownershipStakes ?? [],
      personRelations: checkpoint?.state.personRelations ?? [],
      familyRelations: checkpoint?.state.familyRelations ?? [],
      worldRoutes: checkpoint?.state.worldRoutes ?? [],
      labels,
      personFactionById,
      familyHistory,
    };
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
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  breedCatalogPromise ??= loadBreedCatalog(canonicalData.directory);
  return breedCatalogPromise;
});
ipcMain.handle("simulator:get-breed-population", async (_event, runId: string, breedId: string, year: number) => {
  const run = getStore().getRun(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  return runWorker("GET_BREED_POPULATION", { databasePath: getStore().filename, runId, breedId, year });
});
ipcMain.handle("simulator:get-atlas-data", (_event, requestedYear?: number) => {
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  atlasPoiCache ??= loadAtlasPois(canonicalData.directory);
  const run = getStore().selectedRun();
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
    const labels = getStore().loadV5Labels(run.runId);
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
  const year = Math.min(requestedYear ?? run?.currentYear ?? 0, run?.currentYear ?? 0);
  const states = (v5Manifest ? Object.fromEntries(V5_WORLDS.flatMap((world) => { const state = getStore().loadLatestV5Checkpoint(run!.runId, world, year)?.state; return state ? [[world, state]] : []; })) : {}) as Partial<Record<WorldKeyV5, WorldStateV5>>;
  const canonicalV5 = loadBundledCanonicalV5(join(runtimeResources, "canonical"));
  const labels = run && v5Manifest ? getStore().loadV5Labels(run.runId) : {};
  const requests = run && v5Manifest ? getStore().listV5NamingRequests(run.runId) : [];
  const routeCoverage = buildRouteCoverageReadModel(canonicalV5, states, Object.fromEntries(V5_WORLDS.map((world) => [world, labels])), Object.fromEntries(V5_WORLDS.map((world) => [world, requests.filter((request) => request.entityId.startsWith(`WORLD_ROUTE_${world}_`))])));
  const poiCoverage = buildPoiCoverage(canonicalV5, states, Object.fromEntries(V5_WORLDS.map((world) => [world, labels])), Object.fromEntries(V5_WORLDS.map((world) => [world, requests.filter((request) => request.entityId.startsWith(`WORLD_POI_${world}_`))])));
  const settlementsByWorld = Object.fromEntries(V5_WORLDS.map((world) => [world, states[world] && run ? v5SettlementProjection(run.runId, states[world]!).map((settlement) => {
    const site = canonicalV5.sites.find((candidate) => candidate.siteId === settlement.siteId);
    return { ...settlement, latitude: site?.latitude ?? 0, longitude: site?.longitude ?? 0 };
  }) : []]));
  return { imageUrl: pathToFileURL(imagePath).href, pois: atlasPoiCache.map((poi) => ({ ...poi, namesByWorld: namesByPoi.get(poi.poiId) ?? {}, coverageByWorld: Object.fromEntries(V5_WORLDS.map((world) => [world, poiCoverage.rows.find((row) => row.poiId === poi.poiId)?.worlds[world] ?? null])) })), settlementsByWorld, routes: routeCoverage.rows, routeSummary: routeCoverage };
});
ipcMain.handle("simulator:run-canonical", (_event, seed: string) => {
  const canonicalData = loadBundledCanonical(runtimeResources);
  const state = deriveOperatorViewModel(snapshotForOperator());
  if (!state.canRunCanonical) throw new Error(state.canonicalDisabledReasons.join(" "));
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  return bootstrapCanonicalRun({ store: getStore(), seed, canonicalDirectory: canonicalData.directory });
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
    if (accepted.behavior === "BLOCKING") {
      startV5Resume(selected.runId);
      return { ...accepted, status: "RUNNING", resumeStarted: true };
    }
    return { ...accepted, status: selected.status, resumeStarted: false };
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
ipcMain.handle("simulator:export-run", async () => {
  const run = getStore().selectedRun();
  if (!run) throw new Error("No persisted run is selected");
  const canonicalData = loadBundledCanonical(runtimeResources);
  if (canonicalData.status !== "READY") throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: ${canonicalData.errorDetail}`);
  const generated = getStore().loadV5RunManifest(run.runId) ? buildPersistedV5Export(getStore(), run.runId, canonicalData.directory) : buildPersistedCanonicalExport(getStore(), run.runId, canonicalData.directory);
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `EIDOLON_SIMULATION_${run.runId}.zip`, filters: [{ name: "ZIP archive", extensions: ["zip"] }] });
  if (result.canceled || !result.filePath) return null;
  writeFileSync(result.filePath, generated.bytes);
  const verified = verifyExportZip(readFileSync(result.filePath));
  getStore().saveExportMetadata({ exportId: `EXPORT_${randomUUID()}`, runId: run.runId, createdAt: new Date().toISOString(), filename: result.filePath, sha256: generated.sha256, manifest: verified.manifest });
  return { filename: result.filePath, sha256: generated.sha256, checkedFiles: verified.files.length };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("before-quit", () => { store?.close(); store = null; });
