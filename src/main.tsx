import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { deriveOperatorViewModel, type CanonicalDataStatus, type OperatorSnapshot } from "./core/operator/operator-state.js";
import { AtlasView, type AtlasData } from "./ui/atlas-view.js";
import { BreedDetail, type BreedCatalogEntry, type BreedPopulationView } from "./ui/breed-detail.js";
import { ChamberView, CitiesView, FamiliesView, PeopleView, type V5OperatorRunView } from "./ui/v5-operator-views.js";
import { RoutesView } from "./ui/routes-view.js";
import { NamingGeographyView } from "./ui/naming-geography-view.js";
import { OwnerPolicyCenter, type OwnerPolicyDefinitionView } from "./ui/owner-policy-center.js";
import type { NamingGeographyReadModelV1, NamingGeographyRow } from "./core/v5/naming-geography.js";
import "./ui/styles.css";

const navigation = ["Runs", "Live Dashboard", "Cities", "World Browser", "Settlement Detail", "Breed Detail", "Atlas", "Routes", "Naming Geography", "State Detail", "People", "Families", "Conclave", "Senate", "Institutions", "Resources / Industry", "Conflict", "Derogatory Groups", "Atrocities", "Enclaves", "Owner Policy Center", "Parameters / Event Triggers", "Timeline", "Naming Queue", "Simulation Variables", "Export", "Diagnostics"] as const;
type Section = typeof navigation[number];
type World = "CONCORD" | "SCHISM" | "RUIN";
interface Site { siteId: string; currentSiteName: string; classification: string; attractivenessTier: string; latitude: string; longitude: string; regionId: string; regionName: string; continent: string; broadTerrain: string; poiCount: string; }
interface Issue { issueCode: string; severity: string; blocksCanonical: boolean; message: string; }
interface Manifest { runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; status: string; seed: string; createdAt?: string; currentYear: number; finalYear: number; isV5?: boolean; djtYear?: number; checkpointCount: number; eventCount: number; cohortCount: number; namingJobCount: number; exportFilename?: string; exportSha256?: string; contentDigest?: string; canonicalReady: boolean; activeIssues: Issue[]; worldSummary: Record<World, { finalPopulation: string; settlements: number; states: number; events: number; federalCapitalSiteId: string | null }>; audit?: Record<string, number>; }
interface SettlementProjection { settlementId: string; siteId: string; regionId: string; stateId: string; name: string | null; population: string; cultureId: string | null; cultureState: string; dominantBreed: string; dominantFaction: World | null; politicalForm: string | null; economicForm: string | null; runtimeIssues: unknown[]; }
interface NamingJob { namingJobId: string; promptText: string; items: { requestId: string; entityType: string; entityId: string }[]; context: { year: number; world: World; reason: string }; }
interface NamingBatch { namingBatchId: string; runId: string; world: World; year: number; jobs: NamingJob[]; promptText: string; promptSha256: string; }
interface V5NamingBatch { schemaVersion: "echoes-v5-naming-batch-v2"; batchId: string; runId: string; year: number; behavior: "BLOCKING" | "BATCHED"; items: { requestId: string; entityType: string; entityId: string }[]; promptText: string; }
interface V5DerogatoryDecisionBatch { batchId: string; reviewYear: number; barrierYear: number; requests: unknown[]; promptText: string; externalPromptText?: string; promptSha256: string; }
interface RunView extends Omit<V5OperatorRunView, "settlements"> { runId: string; requestedYear: number; settlements: SettlementProjection[]; history: { year: number; historyType: string; entryId: string; data: unknown }[]; checkpoints: { year: number; stateHash: string }[]; }
interface V5ConfigurationJson { mechanicsJson: string; operationalJson: string; diagnosticJson: string; }
interface DomainDatabasePreflight { state: "READY" | "NOT_CONFIGURED" | "UNREACHABLE" | "MIGRATION_REQUIRED" | "SEED_REQUIRED" | "SCHEMA_MISMATCH"; diagnosticCode: string; redactedTarget: string | null; actions: ("DOCTOR" | "MIGRATE" | "SEED" | "RETRY")[]; missingStructures: string[]; connectionLabel: string | null; sharedCanonicalDatabase: boolean; manualDatabaseUrlRequired: boolean; secondCanonicalDatabaseCreated: false; }
interface Snapshot extends OperatorSnapshot { canonicalData: CanonicalDataStatus; domainDatabasePreflight?: DomainDatabasePreflight; manifest: Manifest | null; runs: Manifest[]; selectedRunId: string | null; v5Run?: boolean; v5CanonicalReadiness?: { ready: boolean; missing: string[] }; namingReadiness?: { routeCorridorsNotReady: number; ownerPolicyBlockers: number; canonicalNamingGaps: number; unresolvedDjtYearAuthority: number }; namingQueueSummary?: Record<string, Record<string, number>> | null; progress?: { targetYear: number; currentYear: number; elapsedMilliseconds: number; currentPhase: string; lastCompletedCheckpoint: number; nextCheckpoint: number } | null; projectionFreshness?: { runYear: number; commonProjectedThroughYear: number; selectedDataYear: number; freshness: "CURRENT" | "STALE"; lastErrorCode: string | null; mixedYearReadsAllowed: false } | null; exportValidation: { valid: boolean; checkedFiles: number } | null; sites: Site[]; pendingNamingJob?: NamingJob | null; pendingNamingBatches?: NamingBatch[]; pendingV5NamingBatch?: V5NamingBatch | null; pendingV5NamingBatches?: V5NamingBatch[]; pendingV5DerogatoryDecisionBatch?: V5DerogatoryDecisionBatch | null; v5PolicyBlockers?: Record<string, unknown>[]; atrocityOccurrenceSlots?: Record<string, unknown>[]; settlementProjections?: Record<World, SettlementProjection[]> | null; databasePath?: string; canonicalResumeInProgress?: boolean; v5ResumeInProgress?: boolean; v5Configuration?: V5ConfigurationJson; v5ConfigurationEditable?: boolean; }
interface NamingFeedback { outcome: "accepted" | "rejected"; message: string; }

const emptySnapshot: Snapshot = { canonicalData: { status: "INVALID", semanticAuthorityVersion: null, semanticAuthorityFilename: null, semanticAuthoritySha256: null, semanticAuthorityVerdict: null, year0Readiness: null, ownerPolicyVersion: null, personalityPolicyVersion: null, bundleVersion: null, bundleContentSha256: null, errorCode: "BUNDLED_CANONICAL_DATA_INVALID", errorDetail: "Runtime is booting" }, manifest: null, runs: [], selectedRunId: null, exportValidation: null, sites: [] };
const SNAPSHOT_LOAD_TIMEOUT_MILLISECONDS = 10_000;
const PREFLIGHT_LOAD_TIMEOUT_MILLISECONDS = 6_000;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat("en-US");
const runViewSections = new Set<Section>(["Live Dashboard", "World Browser", "Settlement Detail", "State Detail", "People", "Families", "Conclave", "Senate", "Institutions", "Resources / Industry", "Conflict", "Derogatory Groups", "Atrocities", "Enclaves", "Parameters / Event Triggers", "Timeline"]);

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }): React.JSX.Element {
  return <article><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

function withTimeout<T>(operation: Promise<T>, milliseconds: number, diagnosticCode: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(diagnosticCode)), milliseconds);
    operation.then((value) => { window.clearTimeout(timeout); resolvePromise(value); }, (error) => { window.clearTimeout(timeout); reject(error); });
  });
}

function failedPreflight(diagnosticCode: string): DomainDatabasePreflight {
  return { state: "UNREACHABLE", diagnosticCode, redactedTarget: null, actions: ["RETRY"], missingStructures: [], connectionLabel: null, sharedCanonicalDatabase: false, manualDatabaseUrlRequired: false, secondCanonicalDatabaseCreated: false };
}

function App(): React.JSX.Element {
  const [selected, setSelected] = useState<Section>("Runs");
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [world, setWorld] = useState<World>("CONCORD");
  const [year, setYear] = useState(2000);
  const [siteId, setSiteId] = useState("SITE-001");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading local evidence…");
  const [namingResponse, setNamingResponse] = useState("");
  const [namingFeedback, setNamingFeedback] = useState<NamingFeedback | null>(null);
  const [derogatoryResponse, setDerogatoryResponse] = useState("");
  const [selectedNamingBatchId, setSelectedNamingBatchId] = useState<string | null>(null);
  const [runView, setRunView] = useState<RunView | null>(null);
  const [viewRevision, setViewRevision] = useState(0);
  const [breedCatalog, setBreedCatalog] = useState<BreedCatalogEntry[]>([]);
  const [breedQuery, setBreedQuery] = useState("");
  const [breedId, setBreedId] = useState<string | null>(null);
  const [breedPopulation, setBreedPopulation] = useState<BreedPopulationView | null>(null);
  const [breedLoading, setBreedLoading] = useState(false);
  const [atlasData, setAtlasData] = useState<AtlasData | null>(null);
  const [atlasPoiId, setAtlasPoiId] = useState<string | null>(null);
  const [comparisonViews, setComparisonViews] = useState<Partial<Record<World, RunView>>>({});
  const [targetYear, setTargetYear] = useState(25);
  const [interactiveNaming, setInteractiveNaming] = useState(true);
  const [namingGeography, setNamingGeography] = useState<NamingGeographyReadModelV1 | null>(null);
  const [atlasRouteId, setAtlasRouteId] = useState<string | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [ownerPolicies, setOwnerPolicies] = useState<OwnerPolicyDefinitionView[]>([]);
  const [v5Configuration, setV5Configuration] = useState<V5ConfigurationJson>({ mechanicsJson: "", operationalJson: "", diagnosticJson: "" });
  const [runtimeSnapshotSettled, setRuntimeSnapshotSettled] = useState(false);
  const [runtimeSnapshotError, setRuntimeSnapshotError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const manifest = snapshot.manifest;
  const selectedSite = snapshot.sites.find((site) => site.siteId === siteId) ?? snapshot.sites[0];
  const visibleSites = useMemo(() => snapshot.sites.slice(0, 175), [snapshot.sites]);
  const selectedSettlement = runView?.settlements.find((settlement) => settlement.siteId === siteId);
  const settlementsBySite = useMemo(() => new Map((runView?.settlements ?? []).map((settlement) => [settlement.siteId, settlement])), [runView?.settlements]);
  const namingBatches = snapshot.pendingNamingBatches ?? [];
  const selectedNamingBatch = namingBatches.find((batch) => batch.namingBatchId === selectedNamingBatchId) ?? namingBatches[0] ?? null;
  const v5NamingBatches = snapshot.pendingV5NamingBatches ?? (snapshot.pendingV5NamingBatch ? [snapshot.pendingV5NamingBatch] : []);
  const selectedV5NamingBatch = v5NamingBatches.find((batch) => batch.batchId === selectedNamingBatchId) ?? v5NamingBatches[0] ?? null;

  async function refresh(quiet = false): Promise<void> {
    if (!window.eidolonSimulator) { setMessage("Browser preview — desktop IPC is unavailable"); return; }
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      try {
        const next = await withTimeout(window.eidolonSimulator!.getOperatorSnapshot() as Promise<Snapshot>, SNAPSHOT_LOAD_TIMEOUT_MILLISECONDS, "OPERATOR_SNAPSHOT_TIMEOUT");
        setRuntimeSnapshotError(null);
        setSnapshot(next); setViewRevision((revision) => revision + 1); if (next.manifest) setYear(next.manifest.currentYear);
        if (next.v5Configuration) setV5Configuration(Object.fromEntries(Object.entries(next.v5Configuration).map(([key, value]) => [key, JSON.stringify(JSON.parse(value), null, 2)])) as unknown as V5ConfigurationJson);
        if (!quiet) setMessage("Verified local evidence loaded");
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message.split("\n")[0]! : "OPERATOR_SNAPSHOT_FAILED";
        setRuntimeSnapshotError(diagnostic);
        setMessage(diagnostic);
        setSnapshot((current) => current.domainDatabasePreflight ? current : { ...current, domainDatabasePreflight: failedPreflight(diagnostic) });
      } finally {
        setRuntimeSnapshotSettled(true);
      }
    })();
    refreshInFlight.current = request;
    try { await request; } finally { if (refreshInFlight.current === request) refreshInFlight.current = null; }
  }
  useEffect(() => {
    let active = true;
    const initialize = async (): Promise<void> => {
      if (!window.eidolonSimulator) { setRuntimeSnapshotSettled(true); return; }
      try {
        const preflight = await withTimeout(window.eidolonSimulator.getDomainDatabasePreflight() as Promise<DomainDatabasePreflight>, PREFLIGHT_LOAD_TIMEOUT_MILLISECONDS, "DOMAIN_DATABASE_PREFLIGHT_TIMEOUT");
        if (active) setSnapshot((current) => ({ ...current, domainDatabasePreflight: preflight }));
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message.split("\n")[0]! : "DOMAIN_DATABASE_PREFLIGHT_FAILED";
        if (active) setSnapshot((current) => ({ ...current, domainDatabasePreflight: failedPreflight(diagnostic) }));
      }
      if (active) await refresh();
    };
    void initialize();
    return () => { active = false; };
  }, []);
  useEffect(() => window.eidolonSimulator?.onCanonicalResumeFailed((failure) => { setMessage(failure.split("\n")[0] ?? "Canonical resume failed"); void refresh(true); }), []);
  useEffect(() => window.eidolonSimulator?.onV5ResumeFailed((failure) => { setMessage(failure.split("\n")[0] ?? "V5 resume failed"); void refresh(true); }), []);
  useEffect(() => {
    if (selected !== "Owner Policy Center" || !window.eidolonSimulator) return;
    let active = true;
    void window.eidolonSimulator.getOwnerPolicyCenter().then((value) => { if (active) setOwnerPolicies(value as OwnerPolicyDefinitionView[]); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Owner Policy Center failed to load"));
    return () => { active = false; };
  }, [selected, viewRevision]);
  useEffect(() => {
    if (snapshot.manifest?.status !== "RUNNING" && busy !== "Running V5 diagnostic") return;
    let cancelled = false;
    let timeout: number | null = null;
    const poll = async (): Promise<void> => {
      await refresh(true);
      if (!cancelled) timeout = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => { cancelled = true; if (timeout !== null) window.clearTimeout(timeout); };
  }, [snapshot.manifest?.status, busy]);
  useEffect(() => {
    if (!window.eidolonSimulator || !snapshot.selectedRunId || !runViewSections.has(selected)) { setRunView(null); return; }
    let active = true;
    void window.eidolonSimulator.getRunView(snapshot.selectedRunId, world, year, selected).then((view) => { if (active) setRunView(view as RunView); });
    return () => { active = false; };
  }, [selected, snapshot.selectedRunId, snapshot.manifest?.currentYear, world, year, viewRevision]);
  useEffect(() => {
    if (!window.eidolonSimulator || !snapshot.selectedRunId || selected !== "Cities") return;
    let active = true;
    void Promise.all((["CONCORD", "SCHISM", "RUIN"] as World[]).map(async (item) => [item, await window.eidolonSimulator!.getRunView(snapshot.selectedRunId!, item, year, "Cities")] as const)).then((entries) => { if (active) setComparisonViews(Object.fromEntries(entries) as Record<World, RunView>); });
    return () => { active = false; };
  }, [selected, snapshot.selectedRunId, snapshot.manifest?.currentYear, year, viewRevision]);
  useEffect(() => { setSelectedStateId((current) => runView?.states?.some((state) => state.stateId === current) ? current : runView?.states?.[0]?.stateId ?? null); }, [runView?.effectiveYear, world]);
  useEffect(() => {
    if (selected !== "Breed Detail" || !window.eidolonSimulator || breedCatalog.length > 0) return;
    let active = true;
    void window.eidolonSimulator.getBreedCatalog().then((catalog) => {
      if (!active) return;
      const rows = catalog as BreedCatalogEntry[];
      setBreedCatalog(rows);
      setBreedId((current) => current ?? rows[0]?.breedId ?? null);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Breed catalog failed to load"));
    return () => { active = false; };
  }, [selected, breedCatalog.length]);
  useEffect(() => {
    if (selected !== "Breed Detail" || !window.eidolonSimulator || !snapshot.selectedRunId || !breedId) { setBreedPopulation(null); return; }
    let active = true;
    const timeout = window.setTimeout(() => {
      setBreedLoading(true);
      void window.eidolonSimulator!.getBreedPopulation(snapshot.selectedRunId!, breedId, year).then((view) => { if (active) setBreedPopulation(view as BreedPopulationView); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Breed population failed to load"); }).finally(() => { if (active) setBreedLoading(false); });
    }, 120);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [selected, snapshot.selectedRunId, breedId, year, viewRevision]);
  useEffect(() => {
    if (!["Atlas", "Routes", "Naming Geography"].includes(selected) || !window.eidolonSimulator) return;
    let active = true;
    void window.eidolonSimulator.getAtlasData(year).then((value) => { if (active) { const data = value as AtlasData; setAtlasData(data); setAtlasPoiId((current) => current ?? data.pois[0]?.poiId ?? null); } }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Atlas failed to load"));
    return () => { active = false; };
  }, [selected, year, viewRevision]);
  useEffect(() => {
    if (selected !== "Naming Geography" || !window.eidolonSimulator) return;
    let active = true;
    void window.eidolonSimulator.getNamingGeography(year).then((value) => { if (active) setNamingGeography(value as NamingGeographyReadModelV1 | null); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Naming Geography failed to load"));
    return () => { active = false; };
  }, [selected, year, viewRevision, snapshot.selectedRunId]);

  async function runDiagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Running diagnostic");
    try { const result = await window.eidolonSimulator.runDiagnostic(`EIDOLON_DIAGNOSTIC_${Date.now()}`) as Manifest; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Diagnostic run failed"); }
    finally { setBusy(null); }
  }
  async function runV5Diagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    if (snapshot.domainDatabasePreflight?.state !== "READY") { setMessage(snapshot.domainDatabasePreflight?.diagnosticCode ?? "DOMAIN_DATABASE_NOT_READY"); return; }
    setBusy("Running V5 diagnostic");
    try { const resultPromise = window.eidolonSimulator.runV5Diagnostic(`EIDOLON_V5_DIAGNOSTIC_${Date.now()}`, targetYear, interactiveNaming); window.setTimeout(() => void refresh(true), 250); const result = await resultPromise as { runId: string; status: string; currentYear: number }; setMessage(`${result.runId} · ${result.status} · year ${result.currentYear}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message.split("\n")[0]! : "V5 diagnostic run failed"); }
    finally { setBusy(null); }
  }
  async function runDomainDatabaseAction(action: DomainDatabasePreflight["actions"][number]): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy(`${action} domain database`);
    try { const result = await window.eidolonSimulator.runDomainDatabaseAction(action) as DomainDatabasePreflight; setMessage(`${result.state} · ${result.diagnosticCode}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : `Domain database ${action} failed`); }
    finally { setBusy(null); }
  }
  async function selectRun(runId: string): Promise<void> {
    if (!window.eidolonSimulator) return;
    const next = await window.eidolonSimulator.selectRun(runId) as Snapshot;
    setSnapshot(next); setViewRevision((revision) => revision + 1); if (next.manifest) setYear(next.manifest.currentYear);
  }
  async function runCanonical(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Starting canonical run");
    try { const result = await window.eidolonSimulator.runCanonical("EIDOLON_CANONICAL_OWNER_RUN_V4") as { runId: string; status: string }; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Canonical run failed"); }
    finally { setBusy(null); }
  }
  async function retryCanonical(): Promise<void> {
    if (!window.eidolonSimulator || !manifest || manifest.status !== "FAILED") return;
    setBusy("Retrying from checkpoint");
    try { if (snapshot.v5Run) await window.eidolonSimulator.resumeV5(manifest.runId); else await window.eidolonSimulator.resumeCanonical(manifest.runId); setMessage(`Retrying ${manifest.runId} from persisted year ${manifest.currentYear}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message.split("\n")[0]! : "Canonical retry failed"); }
    finally { setBusy(null); }
  }
  async function submitNaming(): Promise<void> {
    if (!window.eidolonSimulator || !namingResponse.trim()) return;
    setBusy("Validating naming response");
    setNamingFeedback(null);
    try {
      const result = await window.eidolonSimulator.submitNamingResponse(namingResponse) as { accepted: boolean; errors: string[]; acceptedJobs?: number; acceptedDecisions?: number; status?: string };
      const continued = result.status === "RUNNING" ? " History continuation is running in the background." : "";
      const resultMessage = result.accepted ? (result.acceptedJobs ? `Naming batch accepted: ${result.acceptedJobs} jobs and ${result.acceptedDecisions ?? 0} decisions persisted.${continued}` : `Naming response accepted and persisted.${continued}`) : result.errors.join(" · ");
      setMessage(resultMessage);
      setNamingFeedback({ outcome: result.accepted ? "accepted" : "rejected", message: resultMessage });
      if (result.accepted) { setNamingResponse(""); await refresh(); }
    }
    catch (error) {
      const resultMessage = error instanceof Error ? error.message : "Naming response failed";
      setMessage(resultMessage);
      setNamingFeedback({ outcome: "rejected", message: resultMessage });
    }
    finally { setBusy(null); }
  }
  async function exportAllNamingPrompts(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Exporting all naming prompts");
    try {
      const result = await window.eidolonSimulator.exportAllNamingPrompts() as { directory: string; batchCount: number; requestCount: number } | null;
      setMessage(result ? `Exported ${result.batchCount} prompts covering ${result.requestCount} requests to ${result.directory}` : "Prompt export canceled");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bulk prompt export failed"); }
    finally { setBusy(null); }
  }
  async function uploadAllNamingResponses(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Uploading all naming responses");
    setNamingFeedback(null);
    try {
      const result = await window.eidolonSimulator.uploadAllNamingResponses() as { accepted: boolean; errors: string[]; acceptedBatches?: number; acceptedDecisions?: number; status?: string } | null;
      if (!result) { setMessage("Response ZIP upload canceled"); return; }
      const continued = result.status === "RUNNING" ? " History continuation is running in the background." : "";
      const omitted = Math.max(0, result.errors.length - 8);
      const resultMessage = result.accepted
        ? `${result.acceptedBatches ?? 0} response files and ${result.acceptedDecisions ?? 0} naming decisions accepted atomically.${continued}`
        : `${result.errors.slice(0, 8).join(" · ")}${omitted > 0 ? ` · ${omitted} more error(s)` : ""}`;
      setMessage(resultMessage);
      setNamingFeedback({ outcome: result.accepted ? "accepted" : "rejected", message: resultMessage });
      if (result.accepted) { setNamingResponse(""); await refresh(); }
    } catch (error) {
      const resultMessage = error instanceof Error ? error.message : "Bulk naming response upload failed";
      setMessage(resultMessage);
      setNamingFeedback({ outcome: "rejected", message: resultMessage });
    } finally { setBusy(null); }
  }
  async function submitDerogatoryDecision(): Promise<void> {
    if (!window.eidolonSimulator || !derogatoryResponse.trim()) return;
    setBusy("Validating Derogatory decisions");
    try { const result = await window.eidolonSimulator.submitDerogatoryDecisionResponse(derogatoryResponse) as { accepted: boolean; errors: string[]; acceptedDecisions?: number }; setMessage(result.accepted ? `${result.acceptedDecisions ?? 0} Derogatory decisions accepted; history is resuming.` : result.errors.join(" · ")); if (result.accepted) setDerogatoryResponse(""); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Derogatory decision response failed"); }
    finally { setBusy(null); }
  }
  async function deferV5Naming(): Promise<void> {
    if (!window.eidolonSimulator || !manifest || !snapshot.v5Run) return;
    setBusy("Deferring naming batch");
    try { await window.eidolonSimulator.resumeV5(manifest.runId); setMessage(`Deferred naming batch; ${manifest.runId} is resuming without accepting labels.`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message.split("\n")[0]! : "V5 naming deferral failed"); }
    finally { setBusy(null); }
  }
  async function exportRun(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Exporting");
    try { const target = await window.eidolonSimulator.exportRun() as { filename: string; sha256: string } | null; setMessage(target ? `Exported ${target.filename} · ${target.sha256.slice(0, 12)}` : "Export canceled"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
    finally { setBusy(null); }
  }

  async function saveV5Configuration(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Saving V5 variables");
    try {
      const next = await window.eidolonSimulator.saveV5Configuration(v5Configuration) as Snapshot;
      setSnapshot(next);
      if (next.v5Configuration) setV5Configuration(Object.fromEntries(Object.entries(next.v5Configuration).map(([key, value]) => [key, JSON.stringify(JSON.parse(value), null, 2)])) as unknown as V5ConfigurationJson);
      setMessage("V5 mechanics, operational, and diagnostic configuration saved");
    } catch (error) { setMessage(error instanceof Error ? error.message : "V5 configuration validation failed"); }
    finally { setBusy(null); }
  }

  const worldSummary = manifest?.worldSummary?.[world];
  const viewPopulation = runView?.settlements.reduce((sum, settlement) => sum + BigInt(settlement.population), 0n) ?? null;
  const viewStateCount = new Set(runView?.settlements.map((settlement) => settlement.stateId) ?? []).size;
  const operator = deriveOperatorViewModel(snapshot);
  const content = (() => {
    if (selected === "Runs") return <>
      <section className="cards"><Stat label="V5 STATUS" value={snapshot.domainDatabasePreflight?.state === "READY" && snapshot.v5CanonicalReadiness?.ready ? "V5 CANONICAL READY" : "V5 AUTHORITY BLOCKED"} note={snapshot.domainDatabasePreflight?.diagnosticCode ?? "Checking PostgreSQL authority"}/><Stat label="RUN STATUS" value={snapshot.v5Run ? operator.runState : "NO V5 RUN"} note={snapshot.v5Run ? manifest?.runId ?? "—" : "Legacy runs hidden here"}/><Stat label="NAMING REQUESTS" value={snapshot.v5Run ? manifest?.namingJobCount ?? 0 : "—"} note="BATCHED requests do not pause history"/></section>
      <section className="panel vertical" aria-label="Domain database preflight"><p className="eyebrow">CANONICAL DATABASE</p><h2>{snapshot.domainDatabasePreflight?.connectionLabel ? `Connected — ${snapshot.domainDatabasePreflight.connectionLabel}` : snapshot.domainDatabasePreflight?.state ?? "CHECKING"}</h2><p>{snapshot.domainDatabasePreflight?.state} · {snapshot.domainDatabasePreflight?.diagnosticCode ?? "Running redacted database preflight"}{snapshot.domainDatabasePreflight?.redactedTarget ? ` · ${snapshot.domainDatabasePreflight.redactedTarget}` : ""}</p>{Boolean(snapshot.domainDatabasePreflight?.missingStructures.length) && <p>Missing structures: {snapshot.domainDatabasePreflight!.missingStructures.join(", ")}</p>}<div className="tabs">{snapshot.domainDatabasePreflight?.actions.map((action) => <button key={action} onClick={() => void runDomainDatabaseAction(action)} disabled={busy !== null}>{action}</button>)}</div></section>
      {snapshot.runs.some((run) => run.isV5) && <section className="panel vertical"><p className="eyebrow">PERSISTED V5 RUNS</p><div className="tabs">{snapshot.runs.filter((run) => run.isV5).map((run) => <button key={run.runId} className={snapshot.selectedRunId === run.runId ? "active" : ""} onClick={() => void selectRun(run.runId)}>V5 · {run.status} · {run.currentYear}/{run.finalYear ?? "?"}</button>)}</div></section>}
      <section className="panel vertical"><div><p className="eyebrow">NEW V5 DIAGNOSTIC</p><h2>Run sparse causal history with candidate policies</h2><p>Choose an explicit target. Interactive LLM Naming pauses at blocking barriers and deterministic 25-year batch checkpoints without changing causal history.</p></div><div className="target-years" aria-label="V5 target year">{[25,100,500,1000,2000].map((target) => <button key={target} className={targetYear === target ? "active" : ""} onClick={() => setTargetYear(target)}>{target}</button>)}<label>CUSTOM <input aria-label="Custom V5 target year" type="number" min="1" max="2000" value={targetYear} onChange={(event) => setTargetYear(Math.max(1, Math.min(2000, Number(event.target.value) || 1)))}/></label><label><input aria-label="Interactive LLM Naming" type="checkbox" checked={interactiveNaming} onChange={(event) => setInteractiveNaming(event.target.checked)}/> INTERACTIVE LLM NAMING</label></div><div className="cards four"><Stat label="ROUTES NOT READY" value={snapshot.namingReadiness?.routeCorridorsNotReady ?? "—"} note="Unresolved route mode"/><Stat label="OWNER POLICY BLOCKERS" value={snapshot.namingReadiness?.ownerPolicyBlockers ?? "—"} note="Causal approvals"/><Stat label="CANONICAL DATA GAPS" value={snapshot.namingReadiness?.canonicalNamingGaps ?? "—"} note="Not accepted naming authority"/><Stat label="DJT-YEAR AUTHORITY" value={snapshot.namingReadiness?.unresolvedDjtYearAuthority ? "UNRESOLVED" : "READY"} note="Fixture result is not canon"/></div><button className="primary" onClick={() => void runV5Diagnostic()} disabled={busy !== null || snapshot.hasActiveRun || snapshot.domainDatabasePreflight?.state !== "READY"}>{busy ?? `RUN V5 TO YEAR ${targetYear}`}</button></section>
      {(snapshot.manifest?.status === "RUNNING" || busy === "Running V5 diagnostic") && <section className="panel progress-panel"><div><p className="eyebrow">V5 RUNNING</p><h2>year {snapshot.progress?.currentYear ?? 0} / {snapshot.progress?.targetYear ?? targetYear}</h2><p>Elapsed {Math.floor((snapshot.progress?.elapsedMilliseconds ?? 0) / 1000)}s · phase {snapshot.progress?.currentPhase ?? "STARTING"} · last checkpoint {snapshot.progress?.lastCompletedCheckpoint ?? 0} · next checkpoint {snapshot.progress?.nextCheckpoint ?? "—"}</p></div><div className="meter"><span style={{ width: `${Math.min(100, ((snapshot.progress?.currentYear ?? 0) / (snapshot.progress?.targetYear ?? targetYear)) * 100)}%` }}/></div></section>}
      {!snapshot.v5CanonicalReadiness?.ready && <section className="panel vertical"><p className="eyebrow">V5 CANONICAL BLOCKED</p><h2>{snapshot.v5CanonicalReadiness?.missing.length ?? 0} owner policy approvals pending</h2><p>{snapshot.v5CanonicalReadiness?.missing.join(" · ")}</p><button onClick={() => setSelected("Diagnostics")}>VIEW BLOCKERS</button></section>}
    </>;
    if (selected === "Live Dashboard") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      {snapshot.projectionFreshness && <section className={`notice freshness-${snapshot.projectionFreshness.freshness.toLowerCase()}`} role="status"><strong>PROJECTION {snapshot.projectionFreshness.freshness}</strong><span>Run year {snapshot.projectionFreshness.runYear} · projected through {snapshot.projectionFreshness.commonProjectedThroughYear} · selected data year {snapshot.projectionFreshness.selectedDataYear}{snapshot.projectionFreshness.lastErrorCode ? ` · ${snapshot.projectionFreshness.lastErrorCode}` : ""}</span></section>}
      <section className="cards four"><Stat label="POPULATION" value={viewPopulation !== null ? compact.format(viewPopulation) : "—"} note={viewPopulation?.toString() ?? "No persisted run"}/><Stat label="SETTLEMENTS" value={runView?.settlements.length ?? "—"} note={`Persisted through year ${runView?.effectiveYear ?? "—"}`}/><Stat label="STATES" value={runView ? viewStateCount : "—"} note="Derived from persisted membership"/><Stat label="VIEW YEAR" value={runView?.effectiveYear ?? "—"} note={`${world} persisted state`}/></section>
      <section className="panel"><div><p className="eyebrow">PERSISTED HISTORY</p><h2>{manifest?.status ?? "No active run"}</h2><p>Growth is the only population creation mechanism. Migration, founding, and DJT transfers are conservation-gated; naming pauses preserve an exact checkpoint.</p></div><div className="meter"><span style={{ width: `${(manifest?.currentYear ?? 0) / 20}%` }}/><small>Persisted year {manifest?.currentYear ?? 0} of 2000</small></div></section>
    </>;
    if (selected === "Cities") return <CitiesView views={comparisonViews} year={year} setYear={setYear} openSettlement={(targetWorld, targetSiteId) => { setWorld(targetWorld); setSiteId(targetSiteId); setSelected("Settlement Detail"); }}/>;
    if (selected === "World Browser") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <div className="browser-grid"><section className="map" aria-label="Equirectangular Site plot">{visibleSites.map((site) => { const settlement = settlementsBySite.get(site.siteId); return <button key={site.siteId} aria-label={`${site.siteId} ${settlement?.name || site.currentSiteName || "unnamed"}`} className={site.siteId === siteId ? "site selected" : "site"} style={{ left: `${((Number(site.longitude) + 180) / 360) * 100}%`, top: `${((90 - Number(site.latitude)) / 180) * 100}%` }} onClick={() => setSiteId(site.siteId)} />; })}<span className="map-label">Neutral coordinate plot · physical Site positions</span></section><SiteCard site={selectedSite} settlement={selectedSettlement} world={world} year={runView?.effectiveYear ?? year}/></div>
      <SiteTable sites={visibleSites} settlements={settlementsBySite} selected={siteId} select={setSiteId}/>
    </>;
    if (selected === "Settlement Detail") return <><div className="toolbar detail-toolbar"><WorldTabs world={world} setWorld={setWorld}/><SettlementSelect settlements={runView?.settlements ?? []} value={selectedSettlement?.settlementId ?? ""} select={(settlement) => setSiteId(settlement.siteId)}/><Year year={year} setYear={setYear}/></div><SiteCard site={selectedSite} settlement={selectedSettlement} world={world} year={runView?.effectiveYear ?? year}/><section className="detail-grid"><Detail title="Identity" rows={[["Site", selectedSite?.siteId], ["Region", `${selectedSite?.regionId} · ${selectedSite?.regionName}`], ["Political State", selectedSettlement?.stateId], ["Persisted year", runView?.effectiveYear]]}/><Detail title="Historical projections" rows={[["Population", selectedSettlement?.population], ["Dominant faction", selectedSettlement?.dominantFaction ?? "No resolved denominator"], ["Political form", selectedSettlement?.politicalForm ?? "No resolved denominator"], ["Economic form", selectedSettlement?.economicForm ?? "No resolved denominator"]]}/><Detail title="Naming & evidence" rows={[["Current name", selectedSettlement?.name ?? "No Settlement at this Site"], ["Provenance", selectedSettlement ? "PERSISTED" : "UNINHABITED"], ["POIs", selectedSite?.poiCount], ["Runtime denominator issues", selectedSettlement?.runtimeIssues.length ?? 0]]}/></section></>;
    if (selected === "Breed Detail") return snapshot.domainDatabasePreflight?.state !== "READY" ? <DomainAuthorityBlocked preflight={snapshot.domainDatabasePreflight!} domain="Breed catalog"/> : <><div className="toolbar"><span>Persisted canonical checkpoint populations</span><Year year={year} setYear={setYear}/></div><BreedDetail catalog={breedCatalog} query={breedQuery} selectedBreedId={breedId} population={breedPopulation} loading={breedLoading} onQuery={setBreedQuery} onSelect={setBreedId}/></>;
    if (selected === "Atlas") return snapshot.domainDatabasePreflight?.state !== "READY" ? <DomainAuthorityBlocked preflight={snapshot.domainDatabasePreflight!} domain="Atlas authority"/> : <AtlasView data={atlasData} world={world} selectedPoiId={atlasPoiId} selectedRouteId={atlasRouteId} setWorld={setWorld} selectPoi={setAtlasPoiId} selectRoute={setAtlasRouteId}/>;
    if (selected === "Routes") return snapshot.domainDatabasePreflight?.state !== "READY" ? <DomainAuthorityBlocked preflight={snapshot.domainDatabasePreflight!} domain="Route and Atlas authority"/> : <RoutesView data={atlasData}/>;
    if (selected === "Naming Geography") return <><div className="toolbar"><span>Trusted accepted labels by physical identity</span><Year year={year} setYear={setYear}/></div><NamingGeographyView data={namingGeography} showOnAtlas={(row: NamingGeographyRow) => { if (row.atlasTarget.kind === "POI") { setAtlasPoiId(row.atlasTarget.ids[0] ?? null); setAtlasRouteId(null); } else if (row.atlasTarget.kind === "ROUTE") setAtlasRouteId(row.physicalIdentity); else { setSiteId(row.atlasTarget.ids[0] ?? siteId); setAtlasRouteId(null); } setSelected("Atlas"); }}/></>;
    if (selected === "State Detail") { const stateId = selectedStateId; const state = runView?.states?.find((row) => row.stateId === stateId); const members = (runView?.settlements ?? []).filter((settlement) => settlement.stateId === stateId); const institutions = (runView?.institutions ?? []).filter((row) => row.stateId === stateId); const offices = (runView?.offices ?? []).filter((office) => institutions.some((institution) => institution.institutionId === office.institutionId)); return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><label className="settlement-select">STATE<select aria-label="Select State" value={stateId ?? ""} onChange={(event) => setSelectedStateId(event.target.value)}><option value="" disabled>Select a State</option>{(runView?.states ?? []).map((item) => <option key={item.stateId} value={item.stateId}>{runView?.labels?.[item.stateId] ?? item.stateId}</option>)}</select></label><Year year={year} setYear={setYear}/></div><section className="panel vertical"><p className="eyebrow">PERSISTED POLITICAL STATE</p><h2>{state ? runView?.labels?.[state.stateId] ?? state.stateId : "No State at this year"}</h2><div className="detail-grid"><Detail title="Membership" rows={[["Member Settlements", members.length], ["Persisted year", runView?.effectiveYear], ["Population", members.reduce((sum, member) => sum + BigInt(member.population), 0n).toString()]]}/><Detail title="Government" rows={[["Actual government", state?.actualGovernment], ["Dominant faction", state?.dominantFaction], ["Legitimacy", state?.legitimacy], ["Institutions", institutions.length], ["Offices", offices.length]]}/></div></section></>; }
    if (selected === "People") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><PeopleView view={runView} world={world} year={year} selectedPersonId={selectedPersonId} onSelectPerson={setSelectedPersonId}/></>;
    if (selected === "Families") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><FamiliesView view={runView} world={world} year={year}/></>;
    if (selected === "Conclave") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><ChamberView kind="CONCLAVE" view={runView} world={world} year={year} openPerson={(personId) => { setSelectedPersonId(personId); setSelected("People"); }}/></>;
    if (selected === "Senate") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><ChamberView kind="SENATE" view={runView} world={world} year={year} openPerson={(personId) => { setSelectedPersonId(personId); setSelected("People"); }}/></>;
    if (selected === "Institutions") { const institutions = runView?.institutions ?? []; return <HistoricalRows title="CIVIC AND GOVERNMENT INSTITUTIONS" world={world} year={runView?.effectiveYear ?? year} rows={institutions} empty="No persisted Institutions at this year."/>; }
    if (selected === "Resources / Industry") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="cards four"><Stat label="RESOURCE NODES" value={runView?.resourceNodes?.length ?? 0} note="Stable physical identities"/><Stat label="WORLD STATUS" value={runView?.worldResourceStates?.length ?? 0} note="Control and availability"/><Stat label="INDUSTRIES" value={runView?.industries?.length ?? 0} note="Bounded aggregate strengths"/><Stat label="GUILDS" value={runView?.organizations?.filter((row) => row.type === "GUILD").length ?? 0} note="No implicit chamber seats"/></section><HistoricalRows title="RESOURCE GEOGRAPHY" world={world} year={runView?.effectiveYear ?? year} rows={runView?.resourceNodes ?? []} empty="No resource geography has executed."/><HistoricalRows title="SETTLEMENT INDUSTRIES" world={world} year={runView?.effectiveYear ?? year} rows={runView?.industries ?? []} empty="No industry review has executed."/></>;
    if (selected === "Conflict") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><HistoricalRows title="DIPLOMATIC RELATIONS" world={world} year={runView?.effectiveYear ?? year} rows={runView?.diplomaticRelations ?? []} empty="No relationship justified by border, trade, agreement, alliance, or active dispute."/><HistoricalRows title="CONFLICT EPISODES AND CONTROL TERMS" world={world} year={runView?.effectiveYear ?? year} rows={[...(runView?.conflictEpisodes ?? []), ...(runView?.settlementControlTerms ?? [])]} empty="No staged conflict or occupation at this year."/><HistoricalRows title="SECURITY FORCES" world={world} year={runView?.effectiveYear ?? year} rows={runView?.securityForces ?? []} empty="No security force has formed."/></>;
    if (selected === "Derogatory Groups") { const batch = snapshot.pendingV5DerogatoryDecisionBatch; const promptText = batch?.externalPromptText ?? batch?.promptText ?? ""; return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><HistoricalRows title="ACTIVE AND HISTORICAL TARGET SELECTIONS" world={world} year={runView?.effectiveYear ?? year} rows={runView?.derogatoryTargetSelections ?? []} empty="No external selection has been accepted."/><section className="cards"><Stat label="EXACT SLICES" value={runView?.populationSlices?.length ?? 0} note="Partition, not added population"/><Stat label="DECISION BATCHES" value={runView?.derogatoryDecisionBatches?.length ?? 0} note="Immutable contexts"/><Stat label="PENDING" value={batch?.requests.length ?? 0} note={batch ? `Review year ${batch.reviewYear}` : "No review barrier"}/></section>{batch && <section className="panel vertical"><p className="eyebrow">EXTERNAL DECISION BARRIER</p><h2>{batch.batchId}</h2><textarea className="dropzone naming-prompt" readOnly aria-label="Derogatory decision prompt" value={promptText}/><div className="tabs naming-prompt-actions"><button onClick={() => void navigator.clipboard.writeText(promptText)}>COPY PROMPT</button><button onClick={() => void window.eidolonSimulator?.exportNamingPrompt(promptText, batch.batchId)}>EXPORT PROMPT</button></div><textarea className="dropzone naming-response" aria-label="Derogatory decision response JSON" placeholder="Paste echoes-derogatory-decision-response-v1 JSON" value={derogatoryResponse} onChange={(event) => setDerogatoryResponse(event.target.value)}/><button className="primary" disabled={busy !== null || !derogatoryResponse.trim()} onClick={() => void submitDerogatoryDecision()}>{busy ?? "VALIDATE 63 DECISIONS"}</button></section>}</>; }
    if (selected === "Atrocities") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><HistoricalRows title="ATROCITY OCCURRENCES" world={world} year={runView?.effectiveYear ?? year} rows={(runView?.events ?? []).filter((row) => row.eventType === "AtrocityOccurrenceResolved") as unknown as Record<string, unknown>[]} empty="No configured atrocity has fired."/><HistoricalRows title="LOCAL RESPONSES" world={world} year={runView?.effectiveYear ?? year} rows={runView?.localAtrocityResponses ?? []} empty="No local response is persisted."/><HistoricalRows title="FORCED DISPLACEMENT" world={world} year={runView?.effectiveYear ?? year} rows={runView?.forcedDisplacements ?? []} empty="No forced displacement is persisted."/></>;
    if (selected === "Enclaves") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><HistoricalRows title="PRIVATE OPERATOR ENCLAVES" world={world} year={runView?.effectiveYear ?? year} rows={runView?.enclaves ?? []} empty="No authorized Enclave has been founded."/></>;
    if (selected === "Owner Policy Center") return !["READY", "SEED_REQUIRED"].includes(snapshot.domainDatabasePreflight?.state ?? "") ? <DomainAuthorityBlocked preflight={snapshot.domainDatabasePreflight!} domain="Owner Policy Center"/> : <OwnerPolicyCenter definitions={ownerPolicies} busy={busy !== null} onDecide={async (input) => { setBusy(`${input.action} ${input.revisionIds.length} policy revision${input.revisionIds.length === 1 ? "" : "s"}`); try { await window.eidolonSimulator?.decideOwnerPolicy(input); setMessage(`${input.action} recorded separately for ${input.revisionIds.length} revision${input.revisionIds.length === 1 ? "" : "s"}`); setViewRevision((value) => value + 1); } catch (error) { setMessage(error instanceof Error ? error.message : "Policy decision failed"); } finally { setBusy(null); } }} onCreateRevision={async (input) => { setBusy("Saving policy revision"); try { await window.eidolonSimulator?.createOwnerPolicyRevision({ ...input, values: input.values.map((value) => ({ ...value, integerValue: value.integerValue === null ? undefined : value.integerValue, decimalValue: value.decimalValue === null ? undefined : value.decimalValue, textValue: value.textValue === null ? undefined : value.textValue, booleanValue: value.booleanValue === null ? undefined : value.booleanValue })) }); setMessage(`Created a new candidate revision for ${input.policyId}`); setViewRevision((value) => value + 1); } catch (error) { setMessage(error instanceof Error ? error.message : "Policy revision failed"); } finally { setBusy(null); } }}/>;
    if (selected === "Parameters / Event Triggers") return <><HistoricalRows title="ATROCITY STRUCTURAL OCCURRENCES" world={world} year={runView?.effectiveYear ?? year} rows={runView?.atrocityOccurrenceSlots?.length ? runView.atrocityOccurrenceSlots : snapshot.atrocityOccurrenceSlots ?? []} empty="The required 18 occurrences are unavailable."/><HistoricalRows title="POINT-OF-USE POLICY BLOCKERS" world={world} year={runView?.effectiveYear ?? year} rows={runView?.policyBlockers?.length ? runView.policyBlockers : snapshot.v5PolicyBlockers ?? []} empty="No policy operation has blocked this run."/></>;
    if (selected === "Timeline") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="timeline">{(runView?.events.slice(-40) ?? []).map((event) => <button key={event.eventId} onClick={() => setYear(event.year)} className={year === event.year ? "active" : ""}><strong>{event.year}</strong><span>{event.eventType} · {event.entityId}</span></button>)}{runView?.events.length === 0 && <p>No persisted events through this year.</p>}</section></>;
    if (selected === "Naming Queue") {
      const fallbackJob = snapshot.pendingNamingJob;
      const v5Batch = selectedV5NamingBatch;
      const promptText = v5Batch?.promptText ?? selectedNamingBatch?.promptText ?? fallbackJob?.promptText;
      const requestCount = v5Batch?.items.length ?? selectedNamingBatch?.jobs.reduce((sum, job) => sum + job.items.length, 0) ?? fallbackJob?.items.length ?? 0;
      const totals = Object.fromEntries(Object.entries(snapshot.namingQueueSummary ?? {}).map(([key, values]) => [key, Object.values(values).reduce((sum, value) => sum + value, 0)]));
      return <>
        <section className="cards four"><Stat label="PENDING BLOCKING" value={totals.pendingBlocking ?? 0} note="Must be resolved first"/><Stat label="PENDING BATCHED" value={totals.pendingBatched ?? 0} note="Deferrable requests"/><Stat label="ACCEPTED FROM LLM" value={totals.acceptedFromLlm ?? 0} note="Provenance ledger"/><Stat label="CANONICAL / REUSED" value={totals.canonicalOrReused ?? 0} note={`Not ready ${totals.notReadyForNaming ?? 0}`}/></section>
        <section className="panel vertical">
          <p className="eyebrow">{v5Batch?.behavior === "BATCHED" ? "NON-BLOCKING NAMING BATCH" : "DETERMINISTIC BARRIER"}</p>
          <h2>{v5Batch?.batchId ?? selectedNamingBatch?.namingBatchId ?? fallbackJob?.namingJobId ?? "No pending required naming batch"}</h2>
          <p>{v5Batch ? `V5 · ${v5Batch.behavior} · year ${v5Batch.year} · ${requestCount} exact requests` : selectedNamingBatch ? `${selectedNamingBatch.world} · year ${selectedNamingBatch.year} · ${selectedNamingBatch.jobs.length} jobs · ${requestCount} exact requests` : fallbackJob ? `${fallbackJob.context.world} · year ${fallbackJob.context.year} · ${requestCount} exact request(s)` : snapshot.canonicalResumeInProgress || snapshot.v5ResumeInProgress ? `History continuation is running in the background through persisted year ${manifest?.currentYear ?? 0}.` : "The persisted run has no pending naming input."}</p>
          {v5Batch && <div className="tabs naming-prompt-actions" aria-label="Bulk V5 naming controls">
            <button onClick={() => void exportAllNamingPrompts()} disabled={busy !== null || v5NamingBatches.length === 0}>EXPORT ALL PROMPTS</button>
            <button onClick={() => void uploadAllNamingResponses()} disabled={busy !== null || v5NamingBatches.length === 0}>UPLOAD ALL RESPONSES (.ZIP)</button>
          </div>}
          {v5Batch && v5NamingBatches.length > 1 && <div className="tabs naming-batch-tabs" aria-label="Pending V5 naming batches">{v5NamingBatches.map((batch) => <button key={batch.batchId} className={v5Batch.batchId === batch.batchId ? "active" : ""} onClick={() => { setSelectedNamingBatchId(batch.batchId); setNamingResponse(""); setNamingFeedback(null); }}>{batch.behavior} · {batch.items.length}</button>)}</div>}
          {!v5Batch && namingBatches.length > 1 && <div className="tabs naming-batch-tabs" aria-label="Pending world naming batches">{namingBatches.map((batch) => <button key={batch.namingBatchId} className={selectedNamingBatch?.namingBatchId === batch.namingBatchId ? "active" : ""} onClick={() => { setSelectedNamingBatchId(batch.namingBatchId); setNamingResponse(""); setNamingFeedback(null); }}>{batch.world} · {batch.jobs.length} jobs</button>)}</div>}
          {promptText && <>
            <textarea className="dropzone naming-prompt" aria-label="Naming batch prompt" readOnly value={promptText}/>
            <div className="tabs naming-prompt-actions"><button onClick={() => void navigator.clipboard.writeText(promptText)}>COPY PROMPT</button><button onClick={() => void window.eidolonSimulator?.exportNamingPrompt(promptText, v5Batch?.batchId ?? selectedNamingBatch?.namingBatchId ?? fallbackJob?.namingJobId ?? "v5-naming-batch")}>EXPORT PROMPT</button>{v5Batch?.behavior === "BATCHED" && manifest?.status === "WAITING_FOR_NAMING" && <button onClick={() => void deferV5Naming()} disabled={busy !== null}>DEFER &amp; RESUME</button>}</div>
            <textarea className="dropzone naming-response" aria-label="Naming response JSON" placeholder={v5Batch ? "Paste echoes-v5-naming-batch-response-v2 JSON" : "Paste strict naming-batch-response-v1 or naming-response-v1 JSON"} value={namingResponse} onChange={(event) => { setNamingResponse(event.target.value); setNamingFeedback(null); }}/>
            <button className="primary" onClick={() => void submitNaming()} disabled={busy !== null || !namingResponse.trim()}>{busy ?? "VALIDATE & ACCEPT"}</button>
          </>}
          {namingFeedback && <div className={`naming-feedback ${namingFeedback.outcome}`} role={namingFeedback.outcome === "accepted" ? "status" : "alert"}><strong>{namingFeedback.outcome === "accepted" ? "ACCEPTED" : "REJECTED"}</strong><span>{namingFeedback.message}</span></div>}
        </section>
      </>;
    }
    if (selected === "Simulation Variables") return <>
      <section className="panel"><div><p className="eyebrow">V5 CONFIGURATION BOUNDARY</p><h2>{snapshot.v5ConfigurationEditable ? "Editable between runs" : "Read-only while a run is active"}</h2><p>Mechanics alter causal history. Operational settings alter execution and storage only. Diagnostic settings alter reports only. Every V5 run snapshots all three documents and hashes them in the proper identity boundary.</p></div><button className="primary" onClick={() => void saveV5Configuration()} disabled={!snapshot.v5ConfigurationEditable || busy !== null || !v5Configuration.mechanicsJson}>{busy ?? "VALIDATE & SAVE"}</button></section>
      <section className="configuration-grid">
        <label className="configuration-document"><strong>MechanicsVariablesV1</strong><small>Causal · included in causalRunHash</small><textarea aria-label="V5 mechanics variables JSON" readOnly={!snapshot.v5ConfigurationEditable} value={v5Configuration.mechanicsJson} onChange={(event) => setV5Configuration((prior) => ({ ...prior, mechanicsJson: event.target.value }))}/></label>
        <label className="configuration-document"><strong>OperationalConfigV1</strong><small>Non-causal · checkpoint/runtime/storage</small><textarea aria-label="V5 operational configuration JSON" readOnly={!snapshot.v5ConfigurationEditable} value={v5Configuration.operationalJson} onChange={(event) => setV5Configuration((prior) => ({ ...prior, operationalJson: event.target.value }))}/></label>
        <label className="configuration-document"><strong>DiagnosticConfigV1</strong><small>Non-causal · targets/report thresholds</small><textarea aria-label="V5 diagnostic configuration JSON" readOnly={!snapshot.v5ConfigurationEditable} value={v5Configuration.diagnosticJson} onChange={(event) => setV5Configuration((prior) => ({ ...prior, diagnosticJson: event.target.value }))}/></label>
      </section>
    </>;
    if (selected === "Export") return <><section className="cards"><Stat label="EXPORT STATUS" value={snapshot.exportValidation?.valid ? "VERIFIED" : "NOT CREATED"} note={`${snapshot.exportValidation?.checkedFiles ?? 0} checksummed payload files`}/><Stat label="MODE" value={manifest?.mode ?? "—"} note={operator.canExport ? "Persisted run eligible" : "Run must complete first"}/><Stat label="SHA-256" value={manifest?.exportSha256?.slice(0, 12) ?? "—"} note={manifest?.exportFilename ?? "No export"}/></section><section className="panel"><div><p className="eyebrow">PERSISTED DATA PRODUCT</p><h2>Selected persisted run export</h2><p>Export remains disabled while the selected run is incomplete or waiting at a mandatory naming barrier.</p></div><button className="primary" onClick={() => void exportRun()} disabled={!operator.canExport || busy !== null}>{busy ?? "SAVE VERIFIED ZIP"}</button></section></>;
    if (selected === "Diagnostics") return <><section className="cards"><Stat label="V5 DIAGNOSTIC" value="READY" note="Candidate owner-policy opt-in"/><Stat label="V5 CANONICAL" value={snapshot.v5CanonicalReadiness?.ready ? "READY" : "BLOCKED"} note={`${snapshot.v5CanonicalReadiness?.missing.length ?? 0} approvals pending`}/><Stat label="LEGACY V4" value={operator.semanticAuthorityLabel} note="Retained for historical access"/></section><section className="panel vertical"><p className="eyebrow">V5 CANONICAL POLICY BLOCKERS</p><h2>{snapshot.v5CanonicalReadiness?.ready ? "No blockers" : snapshot.v5CanonicalReadiness?.missing.join(" · ")}</h2><p>Diagnostic V5 runs explicitly opt into candidate tables. Canonical runs fail closed until the corresponding approved hashes and mappings are supplied.</p></section><section className="panel"><div><p className="eyebrow">LEGACY V4</p><h2>Archived V4 run controls</h2><p>V4 persistence remains accessible here but is excluded from the normal V5 run strip.</p></div><div className="legacy-actions"><button onClick={() => void runDiagnostic()} disabled={busy !== null || !operator.canRunDiagnostic}>{busy ?? "RUN LEGACY V4 DIAGNOSTIC"}</button><button onClick={() => void runCanonical()} disabled={busy !== null || !operator.canRunCanonical}>{busy ?? "RUN LEGACY V4 CANONICAL"}</button></div></section>{snapshot.runs.some((run) => !run.isV5) && <section className="panel vertical"><p className="eyebrow">LEGACY V4 RUNS</p><div className="tabs">{snapshot.runs.filter((run) => !run.isV5).map((run) => <button key={run.runId} onClick={() => void selectRun(run.runId)}>{run.mode} · {run.status} · {run.currentYear}</button>)}</div></section>}</>;
    return <><section className="cards"><Stat label="CANONICAL DATA" value={snapshot.canonicalData.status} note={snapshot.canonicalData.bundleVersion ?? "Internal bundle defect"}/><Stat label="RUN STATE" value={operator.runState} note={manifest ? `${manifest.mode} · ${manifest.runId}` : "No selected run"}/><Stat label="AUTHORITY" value={operator.semanticAuthorityLabel} note={snapshot.canonicalData.semanticAuthoritySha256?.slice(0, 16) ?? "not loaded"}/></section><section className="detail-grid"><Detail title="Bundled authority" rows={[["Semantic authority", snapshot.canonicalData.semanticAuthorityVersion], ["Verdict", snapshot.canonicalData.semanticAuthorityVerdict], ["Year-0 readiness", snapshot.canonicalData.year0Readiness], ["Owner policy", snapshot.canonicalData.ownerPolicyVersion], ["Personality policy", snapshot.canonicalData.personalityPolicyVersion]]}/><Detail title="Persisted diagnostics" rows={[["Run mode/status", manifest ? `${manifest.mode} / ${manifest.status}` : "NO RUN"], ["Run ID", manifest?.runId], ["Current year", manifest?.currentYear ?? "—"], ["Checkpoint count", manifest?.checkpointCount ?? 0], ["Event count", manifest?.eventCount ?? 0], ["Cohort count", manifest?.cohortCount ?? 0], ["Pending naming job", snapshot.pendingNamingJob?.namingJobId ?? "None"], ["Database path", snapshot.databasePath ?? "Browser preview"]]}/></section>{snapshot.canonicalData.status === "INVALID" && <section className="panel vertical"><p className="eyebrow">INTERNAL BUILD DEFECT</p><h2>BUNDLED_CANONICAL_DATA_INVALID</h2><p>{snapshot.canonicalData.errorDetail}</p></section>}</>;
  })();

  return <main className="app-shell"><aside><div className="brand"><span className="sigil">EOE</span><div><strong>Historical Simulator</strong><small>Standalone operator console</small></div></div><nav aria-label="Simulator sections">{navigation.map((item) => <button key={item} className={selected === item ? "active" : ""} onClick={() => setSelected(item)}>{item}</button>)}</nav><div className="runtime"><span className="status-dot"/>Local-only runtime<br/><small>{message}</small></div></aside><section className="workspace"><header><div><p className="eyebrow">ECHOES OF EIDOLON</p><h1>{selected}</h1></div><span className="badge diagnostic">{manifest?.mode ?? "NO RUN"}</span></header>{!runtimeSnapshotSettled ? <div className="notice info"><strong>Loading simulator state.</strong><span>Checking the shared canonical database and existing SQLite history.</span></div> : runtimeSnapshotError ? <div className="notice error" role="alert"><strong>Simulator state failed to load.</strong><span>{runtimeSnapshotError}</span></div> : <div className={`notice ${operator.primaryNotice.severity.toLowerCase()}`}><strong>{operator.primaryNotice.title}</strong><span>{operator.primaryNotice.detail}</span></div>}{content}</section></main>;
}

function WorldTabs({ world, setWorld }: { world: World; setWorld: (world: World) => void }): React.JSX.Element { return <div className="tabs">{(["CONCORD","SCHISM","RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div>; }
function Year({ year, setYear }: { year: number; setYear: (year: number) => void }): React.JSX.Element { return <label className="year">YEAR <input type="range" min="0" max="2000" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))}/><output>{year}</output></label>; }
function SiteCard({ site, settlement, world, year }: { site?: Site; settlement?: SettlementProjection; world: World; year: number }): React.JSX.Element { return <section className="site-card"><p className="eyebrow">SELECTED PHYSICAL SITE</p><h2>{settlement?.name || site?.currentSiteName || "Unnamed candidate"}</h2><strong>{site?.siteId ?? "—"} · {site?.regionId} {site?.regionName}</strong><dl><div><dt>World/year</dt><dd>{world} · {year}</dd></div><div><dt>Class</dt><dd>{site?.classification ?? "—"}</dd></div><div><dt>Terrain</dt><dd>{site?.broadTerrain ?? "—"}</dd></div><div><dt>Political State</dt><dd>{settlement?.stateId ?? `STATE_${world}_${site?.regionId}`}</dd></div></dl></section>; }
function SiteTable({ sites, settlements, selected, select }: { sites: Site[]; settlements: Map<string, SettlementProjection>; selected: string; select: (id: string) => void }): React.JSX.Element { return <div className="table-wrap"><table><thead><tr><th>Site</th><th>Name</th><th>Region</th><th>Class</th><th>Coordinates</th><th>POIs</th></tr></thead><tbody>{sites.map((site) => { const settlement = settlements.get(site.siteId); const faction = settlement?.dominantFaction?.toLocaleLowerCase(); return <tr key={site.siteId} className={selected === site.siteId ? "selected" : ""} onClick={() => select(site.siteId)}><td>{site.siteId}</td><td className={faction ? `faction-name faction-${faction}` : ""}>{settlement?.name || site.currentSiteName || <em>Pending</em>}</td><td>{site.regionId} · {site.regionName}</td><td>{site.classification}</td><td>{Number(site.latitude).toFixed(2)}, {Number(site.longitude).toFixed(2)}</td><td>{site.poiCount}</td></tr>; })}</tbody></table></div>; }
function SettlementSelect({ settlements, value, select }: { settlements: SettlementProjection[]; value: string; select: (settlement: SettlementProjection) => void }): React.JSX.Element { const ordered = [...settlements].sort((left, right) => (left.name ?? left.settlementId).localeCompare(right.name ?? right.settlementId)); return <label className="settlement-select">SETTLEMENT<select aria-label="Select Settlement" value={value} onChange={(event) => { const settlement = settlements.find((row) => row.settlementId === event.target.value); if (settlement) select(settlement); }}><option value="" disabled>Select a Settlement</option>{ordered.map((settlement) => <option value={settlement.settlementId} key={settlement.settlementId}>{settlement.name ?? settlement.settlementId}</option>)}</select></label>; }
function Detail({ title, rows }: { title: string; rows: [string, React.ReactNode][] }): React.JSX.Element { return <section className="detail"><h3>{title}</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl></section>; }
function DomainAuthorityBlocked({ preflight, domain }: { preflight?: DomainDatabasePreflight; domain: string }): React.JSX.Element {
  if (!preflight) return <section className="panel vertical" role="status"><p className="eyebrow">POSTGRESQL AUTHORITY</p><h2>{domain} checking…</h2><p>Running the bounded shared-database preflight.</p></section>;
  return <section className="panel vertical" role="alert"><p className="eyebrow">POSTGRESQL AUTHORITY REQUIRED</p><h2>{domain} unavailable</h2><p>{preflight.connectionLabel ? `Connected — ${preflight.connectionLabel} · ` : ""}{preflight.state} · {preflight.diagnosticCode}</p><p>Open Runs and use the displayed doctor, migrate, seed, or retry control. Existing SQLite history remains readable; no runtime filesystem authority fallback is permitted.</p></section>;
}
function humanFieldName(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function HumanValue({ value, depth = 0 }: { value: unknown; depth?: number }): React.JSX.Element {
  if (value === null || value === undefined || value === "") return <>—</>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (["string", "number", "bigint"].includes(typeof value)) return <>{String(value)}</>;
  if (Array.isArray(value)) return value.length === 0 ? <>None</> : <ul>{value.slice(0, 24).map((item, index) => <li key={index}><HumanValue value={item} depth={depth + 1}/></li>)}</ul>;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= 2) return <>{entries.length} typed field{entries.length === 1 ? "" : "s"}</>;
    return <dl className="historical-fields">{entries.map(([key, item]) => <div key={key}><dt>{humanFieldName(key)}</dt><dd><HumanValue value={item} depth={depth + 1}/></dd></div>)}</dl>;
  }
  return <>{String(value)}</>;
}
function HistoricalRows({ title, world, year, rows, empty }: { title: string; world: World; year: number; rows: readonly object[]; empty: string }): React.JSX.Element {
  return <section className="panel vertical"><p className="eyebrow">{world} · YEAR {year}</p><h2>{title}</h2>{rows.length === 0 ? <p>{empty}</p> : <div className="table-wrap"><table><thead><tr><th>Stable identity</th><th>Typed historical fields</th></tr></thead><tbody>{rows.slice(0, 250).map((value, index) => { const row = value as Record<string, unknown>; const identity = Object.entries(row).find(([key]) => /(?:Id|ID)$/.test(key))?.[1] ?? `${title}-${index}`; return <tr key={String(identity)}><td>{String(identity)}</td><td><HumanValue value={row}/></td></tr>; })}</tbody></table></div>}</section>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
