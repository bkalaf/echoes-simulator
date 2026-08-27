import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { deriveOperatorViewModel, type CanonicalDataStatus, type OperatorSnapshot } from "./core/operator/operator-state.js";
import { AtlasView, type AtlasData } from "./ui/atlas-view.js";
import { BreedDetail, type BreedCatalogEntry, type BreedPopulationView } from "./ui/breed-detail.js";
import { ChamberView, CitiesView, FamiliesView, PeopleView, type V5OperatorRunView } from "./ui/v5-operator-views.js";
import { RoutesView } from "./ui/routes-view.js";
import "./ui/styles.css";

const navigation = ["Runs", "Live Dashboard", "Cities", "World Browser", "Settlement Detail", "Breed Detail", "Atlas", "Routes", "State Detail", "People", "Families", "Conclave", "Senate", "Institutions", "Timeline", "Naming Queue", "Simulation Variables", "Export", "Diagnostics"] as const;
type Section = typeof navigation[number];
type World = "CONCORD" | "SCHISM" | "RUIN";
interface Site { siteId: string; currentSiteName: string; classification: string; attractivenessTier: string; latitude: string; longitude: string; regionId: string; regionName: string; continent: string; broadTerrain: string; poiCount: string; }
interface Issue { issueCode: string; severity: string; blocksCanonical: boolean; message: string; }
interface Manifest { runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; status: string; seed: string; createdAt?: string; currentYear: number; finalYear: number; isV5?: boolean; djtYear?: number; checkpointCount: number; eventCount: number; cohortCount: number; namingJobCount: number; exportFilename?: string; exportSha256?: string; contentDigest?: string; canonicalReady: boolean; activeIssues: Issue[]; worldSummary: Record<World, { finalPopulation: string; settlements: number; states: number; events: number; federalCapitalSiteId: string | null }>; audit?: Record<string, number>; }
interface SettlementProjection { settlementId: string; siteId: string; regionId: string; stateId: string; name: string | null; population: string; cultureId: string | null; cultureState: string; dominantBreed: string; dominantFaction: World | null; politicalForm: string | null; economicForm: string | null; runtimeIssues: unknown[]; }
interface NamingJob { namingJobId: string; promptText: string; items: { requestId: string; entityType: string; entityId: string }[]; context: { year: number; world: World; reason: string }; }
interface NamingBatch { namingBatchId: string; runId: string; world: World; year: number; jobs: NamingJob[]; promptText: string; promptSha256: string; }
interface V5NamingBatch { schemaVersion: "echoes-v5-naming-batch-v1"; batchId: string; runId: string; year: number; behavior: "BLOCKING" | "BATCHED"; items: { requestId: string; entityType: string; entityId: string }[]; promptText: string; }
interface RunView extends Omit<V5OperatorRunView, "settlements"> { runId: string; requestedYear: number; settlements: SettlementProjection[]; history: { year: number; historyType: string; entryId: string; data: unknown }[]; checkpoints: { year: number; stateHash: string }[]; }
interface V5ConfigurationJson { mechanicsJson: string; operationalJson: string; diagnosticJson: string; }
interface Snapshot extends OperatorSnapshot { canonicalData: CanonicalDataStatus; manifest: Manifest | null; runs: Manifest[]; selectedRunId: string | null; v5Run?: boolean; v5CanonicalReadiness?: { ready: boolean; missing: string[] }; progress?: { targetYear: number; currentYear: number; elapsedMilliseconds: number; currentPhase: string; lastCompletedCheckpoint: number; nextCheckpoint: number } | null; exportValidation: { valid: boolean; checkedFiles: number } | null; sites: Site[]; pendingNamingJob?: NamingJob | null; pendingNamingBatches?: NamingBatch[]; pendingV5NamingBatch?: V5NamingBatch | null; pendingV5NamingBatches?: V5NamingBatch[]; settlementProjections?: Record<World, SettlementProjection[]> | null; databasePath?: string; canonicalResumeInProgress?: boolean; v5ResumeInProgress?: boolean; v5Configuration?: V5ConfigurationJson; v5ConfigurationEditable?: boolean; }
interface NamingFeedback { outcome: "accepted" | "rejected"; message: string; }

const emptySnapshot: Snapshot = { canonicalData: { status: "INVALID", semanticAuthorityVersion: null, semanticAuthorityFilename: null, semanticAuthoritySha256: null, semanticAuthorityVerdict: null, year0Readiness: null, ownerPolicyVersion: null, personalityPolicyVersion: null, bundleVersion: null, bundleContentSha256: null, errorCode: "BUNDLED_CANONICAL_DATA_INVALID", errorDetail: "Runtime is booting" }, manifest: null, runs: [], selectedRunId: null, exportValidation: null, sites: [] };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat("en-US");

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }): React.JSX.Element {
  return <article><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
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
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [v5Configuration, setV5Configuration] = useState<V5ConfigurationJson>({ mechanicsJson: "", operationalJson: "", diagnosticJson: "" });
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
    const next = await window.eidolonSimulator.getOperatorSnapshot() as Snapshot;
    setSnapshot(next); setViewRevision((revision) => revision + 1); if (next.manifest) setYear(next.manifest.currentYear);
    if (next.v5Configuration) setV5Configuration(Object.fromEntries(Object.entries(next.v5Configuration).map(([key, value]) => [key, JSON.stringify(JSON.parse(value), null, 2)])) as unknown as V5ConfigurationJson);
    if (!quiet) setMessage("Verified local evidence loaded");
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => window.eidolonSimulator?.onCanonicalResumeFailed((failure) => { setMessage(failure.split("\n")[0] ?? "Canonical resume failed"); void refresh(true); }), []);
  useEffect(() => window.eidolonSimulator?.onV5ResumeFailed((failure) => { setMessage(failure.split("\n")[0] ?? "V5 resume failed"); void refresh(true); }), []);
  useEffect(() => {
    if (snapshot.manifest?.status !== "RUNNING" && busy !== "Running V5 diagnostic") return;
    const interval = window.setInterval(() => { void refresh(true); }, 2_000);
    return () => window.clearInterval(interval);
  }, [snapshot.manifest?.status, busy]);
  useEffect(() => {
    if (!window.eidolonSimulator || !snapshot.selectedRunId) { setRunView(null); return; }
    void window.eidolonSimulator.getRunView(snapshot.selectedRunId, world, year).then((view) => setRunView(view as RunView));
  }, [snapshot.selectedRunId, snapshot.manifest?.currentYear, world, year, viewRevision]);
  useEffect(() => {
    if (!window.eidolonSimulator || !snapshot.selectedRunId || selected !== "Cities") return;
    let active = true;
    void Promise.all((["CONCORD", "SCHISM", "RUIN"] as World[]).map(async (item) => [item, await window.eidolonSimulator!.getRunView(snapshot.selectedRunId!, item, year)] as const)).then((entries) => { if (active) setComparisonViews(Object.fromEntries(entries) as Record<World, RunView>); });
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
    if (!["Atlas", "Routes"].includes(selected) || !window.eidolonSimulator) return;
    let active = true;
    void window.eidolonSimulator.getAtlasData(year).then((value) => { if (active) { const data = value as AtlasData; setAtlasData(data); setAtlasPoiId((current) => current ?? data.pois[0]?.poiId ?? null); } }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Atlas failed to load"));
    return () => { active = false; };
  }, [selected, year, viewRevision]);

  async function runDiagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Running diagnostic");
    try { const result = await window.eidolonSimulator.runDiagnostic(`EIDOLON_DIAGNOSTIC_${Date.now()}`) as Manifest; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Diagnostic run failed"); }
    finally { setBusy(null); }
  }
  async function runV5Diagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Running V5 diagnostic");
    try { const resultPromise = window.eidolonSimulator.runV5Diagnostic(`EIDOLON_V5_DIAGNOSTIC_${Date.now()}`, targetYear); window.setTimeout(() => void refresh(true), 250); const result = await resultPromise as { runId: string; status: string; currentYear: number }; setMessage(`${result.runId} · ${result.status} · year ${result.currentYear}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message.split("\n")[0]! : "V5 diagnostic run failed"); }
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
      <section className="cards"><Stat label="V5 STATUS" value={snapshot.v5CanonicalReadiness?.ready ? "V5 CANONICAL READY" : "V5 DIAGNOSTIC READY"} note={snapshot.v5CanonicalReadiness?.ready ? "Approved causal policy bundle loaded" : `${snapshot.v5CanonicalReadiness?.missing.length ?? 0} canonical policy approvals pending`}/><Stat label="RUN STATUS" value={snapshot.v5Run ? operator.runState : "NO V5 RUN"} note={snapshot.v5Run ? manifest?.runId ?? "—" : "Legacy runs hidden here"}/><Stat label="NAMING REQUESTS" value={snapshot.v5Run ? manifest?.namingJobCount ?? 0 : "—"} note="BATCHED requests do not pause history"/></section>
      {snapshot.runs.some((run) => run.isV5) && <section className="panel vertical"><p className="eyebrow">PERSISTED V5 RUNS</p><div className="tabs">{snapshot.runs.filter((run) => run.isV5).map((run) => <button key={run.runId} className={snapshot.selectedRunId === run.runId ? "active" : ""} onClick={() => void selectRun(run.runId)}>V5 · {run.status} · {run.currentYear}/{run.finalYear ?? "?"}</button>)}</div></section>}
      <section className="panel vertical"><div><p className="eyebrow">V5 DIAGNOSTIC LAUNCH</p><h2>Run sparse causal history with candidate policies</h2><p>Choose an explicit target. The worker persists atomic checkpoints while the renderer remains responsive. Canonical V5 remains fail-closed until owner policy hashes are approved.</p></div><div className="target-years" aria-label="V5 target year">{[25,100,500,1000,2000].map((target) => <button key={target} className={targetYear === target ? "active" : ""} onClick={() => setTargetYear(target)}>{target}</button>)}<label>CUSTOM <input aria-label="Custom V5 target year" type="number" min="1" max="2000" value={targetYear} onChange={(event) => setTargetYear(Math.max(1, Math.min(2000, Number(event.target.value) || 1)))}/></label></div><button className="primary" onClick={() => void runV5Diagnostic()} disabled={busy !== null || snapshot.hasActiveRun}>{busy ?? `RUN V5 TO YEAR ${targetYear}`}</button></section>
      {(snapshot.progress || busy === "Running V5 diagnostic") && <section className="panel progress-panel"><div><p className="eyebrow">V5 RUNNING</p><h2>year {snapshot.progress?.currentYear ?? 0} / {snapshot.progress?.targetYear ?? targetYear}</h2><p>Elapsed {Math.floor((snapshot.progress?.elapsedMilliseconds ?? 0) / 1000)}s · phase {snapshot.progress?.currentPhase ?? "STARTING"} · last checkpoint {snapshot.progress?.lastCompletedCheckpoint ?? 0} · next checkpoint {snapshot.progress?.nextCheckpoint ?? "—"}</p></div><div className="meter"><span style={{ width: `${Math.min(100, ((snapshot.progress?.currentYear ?? 0) / (snapshot.progress?.targetYear ?? targetYear)) * 100)}%` }}/></div></section>}
      {!snapshot.v5CanonicalReadiness?.ready && <section className="panel vertical"><p className="eyebrow">V5 CANONICAL BLOCKED</p><h2>{snapshot.v5CanonicalReadiness?.missing.length ?? 0} owner policy approvals pending</h2><p>{snapshot.v5CanonicalReadiness?.missing.join(" · ")}</p><button onClick={() => setSelected("Diagnostics")}>VIEW BLOCKERS</button></section>}
    </>;
    if (selected === "Live Dashboard") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
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
    if (selected === "Breed Detail") return <><div className="toolbar"><span>Persisted canonical checkpoint populations</span><Year year={year} setYear={setYear}/></div><BreedDetail catalog={breedCatalog} query={breedQuery} selectedBreedId={breedId} population={breedPopulation} loading={breedLoading} onQuery={setBreedQuery} onSelect={setBreedId}/></>;
    if (selected === "Atlas") return <AtlasView data={atlasData} world={world} selectedPoiId={atlasPoiId} setWorld={setWorld} selectPoi={setAtlasPoiId}/>;
    if (selected === "Routes") return <RoutesView data={atlasData}/>;
    if (selected === "State Detail") { const stateId = selectedStateId; const state = runView?.states?.find((row) => row.stateId === stateId); const members = (runView?.settlements ?? []).filter((settlement) => settlement.stateId === stateId); const institutions = (runView?.institutions ?? []).filter((row) => row.stateId === stateId); const offices = (runView?.offices ?? []).filter((office) => institutions.some((institution) => institution.institutionId === office.institutionId)); return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><label className="settlement-select">STATE<select aria-label="Select State" value={stateId ?? ""} onChange={(event) => setSelectedStateId(event.target.value)}><option value="" disabled>Select a State</option>{(runView?.states ?? []).map((item) => <option key={item.stateId} value={item.stateId}>{runView?.labels?.[item.stateId] ?? item.stateId}</option>)}</select></label><Year year={year} setYear={setYear}/></div><section className="panel vertical"><p className="eyebrow">PERSISTED POLITICAL STATE</p><h2>{state ? runView?.labels?.[state.stateId] ?? state.stateId : "No State at this year"}</h2><div className="detail-grid"><Detail title="Membership" rows={[["Member Settlements", members.length], ["Persisted year", runView?.effectiveYear], ["Population", members.reduce((sum, member) => sum + BigInt(member.population), 0n).toString()]]}/><Detail title="Government" rows={[["Actual government", state?.actualGovernment], ["Dominant faction", state?.dominantFaction], ["Legitimacy", state?.legitimacy], ["Institutions", institutions.length], ["Offices", offices.length]]}/></div></section></>; }
    if (selected === "People") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><PeopleView view={runView} world={world} year={year}/></>;
    if (selected === "Families") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><FamiliesView view={runView} world={world} year={year}/></>;
    if (selected === "Conclave") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><ChamberView kind="CONCLAVE" view={runView} world={world} year={year}/></>;
    if (selected === "Senate") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><ChamberView kind="SENATE" view={runView} world={world} year={year}/></>;
    if (selected === "Institutions") { const conclave = runView?.history.filter((row) => row.historyType === "INSTITUTION_CONCLAVE") ?? []; const senate = runView?.history.filter((row) => row.historyType === "INSTITUTION_SENATE") ?? []; return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="cards"><Stat label="CONCLAVE LEDGERS" value={conclave.length} note={`Persisted through ${runView?.effectiveYear ?? "—"}`}/><Stat label="SENATE LEDGERS" value={senate.length} note={`Persisted through ${runView?.effectiveYear ?? "—"}`}/><Stat label="CHECKPOINTS" value={runView?.checkpoints.length ?? 0} note={`${world} replay indexes`}/></section><section className="panel vertical"><p className="eyebrow">INSTITUTION LEDGERS</p><h2>{conclave.length + senate.length ? "Persisted seat calculations" : "No institution ledger at this year"}</h2><p>{conclave.length} Conclave snapshot(s) and {senate.length} Senate election ledger(s) are present in SQLite for this view.</p></section></>; }
    if (selected === "Timeline") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="timeline">{(runView?.events.slice(-40) ?? []).map((event) => <button key={event.eventId} onClick={() => setYear(event.year)} className={year === event.year ? "active" : ""}><strong>{event.year}</strong><span>{event.eventType} · {event.entityId}</span></button>)}{runView?.events.length === 0 && <p>No persisted events through this year.</p>}</section></>;
    if (selected === "Naming Queue") {
      const fallbackJob = snapshot.pendingNamingJob;
      const v5Batch = selectedV5NamingBatch;
      const promptText = v5Batch?.promptText ?? selectedNamingBatch?.promptText ?? fallbackJob?.promptText;
      const requestCount = v5Batch?.items.length ?? selectedNamingBatch?.jobs.reduce((sum, job) => sum + job.items.length, 0) ?? fallbackJob?.items.length ?? 0;
      return <section className="panel vertical"><p className="eyebrow">{v5Batch?.behavior === "BATCHED" ? "NON-BLOCKING NAMING BATCH" : "DETERMINISTIC BARRIER"}</p><h2>{v5Batch?.batchId ?? selectedNamingBatch?.namingBatchId ?? fallbackJob?.namingJobId ?? "No pending required naming batch"}</h2><p>{v5Batch ? `V5 · ${v5Batch.behavior} · year ${v5Batch.year} · ${requestCount} exact requests` : selectedNamingBatch ? `${selectedNamingBatch.world} · year ${selectedNamingBatch.year} · ${selectedNamingBatch.jobs.length} jobs · ${requestCount} exact requests` : fallbackJob ? `${fallbackJob.context.world} · year ${fallbackJob.context.year} · ${requestCount} exact request(s)` : snapshot.canonicalResumeInProgress || snapshot.v5ResumeInProgress ? `History continuation is running in the background through persisted year ${manifest?.currentYear ?? 0}.` : "The persisted run has no pending naming input."}</p>{v5Batch && v5NamingBatches.length > 1 && <div className="tabs naming-batch-tabs" aria-label="Pending V5 naming batches">{v5NamingBatches.map((batch) => <button key={batch.batchId} className={v5Batch.batchId === batch.batchId ? "active" : ""} onClick={() => { setSelectedNamingBatchId(batch.batchId); setNamingResponse(""); setNamingFeedback(null); }}>{batch.behavior} · {batch.items.length}</button>)}</div>}{!v5Batch && namingBatches.length > 1 && <div className="tabs naming-batch-tabs" aria-label="Pending world naming batches">{namingBatches.map((batch) => <button key={batch.namingBatchId} className={selectedNamingBatch?.namingBatchId === batch.namingBatchId ? "active" : ""} onClick={() => { setSelectedNamingBatchId(batch.namingBatchId); setNamingResponse(""); setNamingFeedback(null); }}>{batch.world} · {batch.jobs.length} jobs</button>)}</div>}{promptText && <><textarea className="dropzone naming-prompt" aria-label="Naming batch prompt" readOnly value={promptText}/><textarea className="dropzone naming-response" aria-label="Naming response JSON" placeholder={v5Batch ? "Paste echoes-v5-naming-batch-response-v1 JSON" : "Paste strict naming-batch-response-v1 or naming-response-v1 JSON"} value={namingResponse} onChange={(event) => { setNamingResponse(event.target.value); setNamingFeedback(null); }}/><button className="primary" onClick={() => void submitNaming()} disabled={busy !== null || !namingResponse.trim()}>{busy ?? "VALIDATE & ACCEPT"}</button></>}{namingFeedback && <div className={`naming-feedback ${namingFeedback.outcome}`} role={namingFeedback.outcome === "accepted" ? "status" : "alert"}><strong>{namingFeedback.outcome === "accepted" ? "ACCEPTED" : "REJECTED"}</strong><span>{namingFeedback.message}</span></div>}</section>;
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

  return <main className="app-shell"><aside><div className="brand"><span className="sigil">EOE</span><div><strong>Historical Simulator</strong><small>Standalone operator console</small></div></div><nav aria-label="Simulator sections">{navigation.map((item) => <button key={item} className={selected === item ? "active" : ""} onClick={() => setSelected(item)}>{item}</button>)}</nav><div className="runtime"><span className="status-dot"/>Local-only runtime<br/><small>{message}</small></div></aside><section className="workspace"><header><div><p className="eyebrow">ECHOES OF EIDOLON</p><h1>{selected}</h1></div><span className="badge diagnostic">{manifest?.mode ?? "NO RUN"}</span></header><div className={`notice ${operator.primaryNotice.severity.toLowerCase()}`}><strong>{operator.primaryNotice.title}</strong><span>{operator.primaryNotice.detail}</span></div>{content}</section></main>;
}

function WorldTabs({ world, setWorld }: { world: World; setWorld: (world: World) => void }): React.JSX.Element { return <div className="tabs">{(["CONCORD","SCHISM","RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div>; }
function Year({ year, setYear }: { year: number; setYear: (year: number) => void }): React.JSX.Element { return <label className="year">YEAR <input type="range" min="0" max="2000" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))}/><output>{year}</output></label>; }
function SiteCard({ site, settlement, world, year }: { site?: Site; settlement?: SettlementProjection; world: World; year: number }): React.JSX.Element { return <section className="site-card"><p className="eyebrow">SELECTED PHYSICAL SITE</p><h2>{settlement?.name || site?.currentSiteName || "Unnamed candidate"}</h2><strong>{site?.siteId ?? "—"} · {site?.regionId} {site?.regionName}</strong><dl><div><dt>World/year</dt><dd>{world} · {year}</dd></div><div><dt>Class</dt><dd>{site?.classification ?? "—"}</dd></div><div><dt>Terrain</dt><dd>{site?.broadTerrain ?? "—"}</dd></div><div><dt>Political State</dt><dd>{settlement?.stateId ?? `STATE_${world}_${site?.regionId}`}</dd></div></dl></section>; }
function SiteTable({ sites, settlements, selected, select }: { sites: Site[]; settlements: Map<string, SettlementProjection>; selected: string; select: (id: string) => void }): React.JSX.Element { return <div className="table-wrap"><table><thead><tr><th>Site</th><th>Name</th><th>Region</th><th>Class</th><th>Coordinates</th><th>POIs</th></tr></thead><tbody>{sites.map((site) => { const settlement = settlements.get(site.siteId); const faction = settlement?.dominantFaction?.toLocaleLowerCase(); return <tr key={site.siteId} className={selected === site.siteId ? "selected" : ""} onClick={() => select(site.siteId)}><td>{site.siteId}</td><td className={faction ? `faction-name faction-${faction}` : ""}>{settlement?.name || site.currentSiteName || <em>Pending</em>}</td><td>{site.regionId} · {site.regionName}</td><td>{site.classification}</td><td>{Number(site.latitude).toFixed(2)}, {Number(site.longitude).toFixed(2)}</td><td>{site.poiCount}</td></tr>; })}</tbody></table></div>; }
function SettlementSelect({ settlements, value, select }: { settlements: SettlementProjection[]; value: string; select: (settlement: SettlementProjection) => void }): React.JSX.Element { const ordered = [...settlements].sort((left, right) => (left.name ?? left.settlementId).localeCompare(right.name ?? right.settlementId)); return <label className="settlement-select">SETTLEMENT<select aria-label="Select Settlement" value={value} onChange={(event) => { const settlement = settlements.find((row) => row.settlementId === event.target.value); if (settlement) select(settlement); }}><option value="" disabled>Select a Settlement</option>{ordered.map((settlement) => <option value={settlement.settlementId} key={settlement.settlementId}>{settlement.name ?? settlement.settlementId}</option>)}</select></label>; }
function Detail({ title, rows }: { title: string; rows: [string, React.ReactNode][] }): React.JSX.Element { return <section className="detail"><h3>{title}</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl></section>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
