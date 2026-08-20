import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { deriveOperatorViewModel, type CanonicalDataStatus, type OperatorSnapshot } from "./core/operator/operator-state.js";
import "./ui/styles.css";

const navigation = ["Runs", "Live Dashboard", "World Browser", "Settlement Detail", "State Detail", "Institutions", "Timeline", "Naming Queue", "Export", "Diagnostics"] as const;
type Section = typeof navigation[number];
type World = "CONCORD" | "SCHISM" | "RUIN";
interface Site { siteId: string; currentSiteName: string; classification: string; attractivenessTier: string; latitude: string; longitude: string; regionId: string; regionName: string; continent: string; broadTerrain: string; poiCount: string; }
interface Issue { issueCode: string; severity: string; blocksCanonical: boolean; message: string; }
interface Manifest { runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; status: string; seed: string; createdAt?: string; currentYear: number; finalYear: number; djtYear?: number; checkpointCount: number; eventCount: number; cohortCount: number; namingJobCount: number; exportFilename?: string; exportSha256?: string; contentDigest?: string; canonicalReady: boolean; activeIssues: Issue[]; worldSummary: Record<World, { finalPopulation: string; settlements: number; states: number; events: number; federalCapitalSiteId: string | null }>; audit?: Record<string, number>; }
interface SettlementProjection { settlementId: string; siteId: string; regionId: string; stateId: string; name: string; population: string; cultureId: string | null; cultureState: string; dominantBreed: string; dominantFaction: World | null; politicalForm: string | null; economicForm: string | null; runtimeIssues: unknown[]; }
interface NamingJob { namingJobId: string; promptText: string; items: { requestId: string; entityType: string; entityId: string }[]; context: { year: number; world: World; reason: string }; }
interface RunView { runId: string; world: World; requestedYear: number; effectiveYear: number; settlements: SettlementProjection[]; events: { eventId: string; year: number; eventType: string; entityId: string; payload: unknown }[]; history: { year: number; historyType: string; entryId: string; data: unknown }[]; checkpoints: { year: number; stateHash: string }[]; }
interface Snapshot extends OperatorSnapshot { canonicalData: CanonicalDataStatus; manifest: Manifest | null; runs: Manifest[]; selectedRunId: string | null; exportValidation: { valid: boolean; checkedFiles: number } | null; sites: Site[]; pendingNamingJob?: NamingJob | null; settlementProjections?: Record<World, SettlementProjection[]> | null; databasePath?: string; }

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
  const [runView, setRunView] = useState<RunView | null>(null);
  const manifest = snapshot.manifest;
  const selectedSite = snapshot.sites.find((site) => site.siteId === siteId) ?? snapshot.sites[0];
  const visibleSites = useMemo(() => snapshot.sites.slice(0, 175), [snapshot.sites]);
  const selectedSettlement = runView?.settlements.find((settlement) => settlement.siteId === siteId);

  async function refresh(): Promise<void> {
    if (!window.eidolonSimulator) { setMessage("Browser preview — desktop IPC is unavailable"); return; }
    const next = await window.eidolonSimulator.getOperatorSnapshot() as Snapshot;
    setSnapshot(next); if (next.manifest) setYear(next.manifest.currentYear); setMessage("Verified local evidence loaded");
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!window.eidolonSimulator || !snapshot.selectedRunId) { setRunView(null); return; }
    void window.eidolonSimulator.getRunView(snapshot.selectedRunId, world, year).then((view) => setRunView(view as RunView));
  }, [snapshot.selectedRunId, snapshot.manifest?.currentYear, world, year]);

  async function runDiagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Running diagnostic");
    try { const result = await window.eidolonSimulator.runDiagnostic(`EIDOLON_DIAGNOSTIC_${Date.now()}`) as Manifest; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Diagnostic run failed"); }
    finally { setBusy(null); }
  }
  async function selectRun(runId: string): Promise<void> {
    if (!window.eidolonSimulator) return;
    const next = await window.eidolonSimulator.selectRun(runId) as Snapshot;
    setSnapshot(next); if (next.manifest) setYear(next.manifest.currentYear);
  }
  async function runCanonical(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Starting canonical run");
    try { const result = await window.eidolonSimulator.runCanonical("EIDOLON_CANONICAL_OWNER_RUN_V4") as { runId: string; status: string }; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Canonical run failed"); }
    finally { setBusy(null); }
  }
  async function submitNaming(): Promise<void> {
    if (!window.eidolonSimulator || !namingResponse.trim()) return;
    setBusy("Validating naming response");
    try { const result = await window.eidolonSimulator.submitNamingResponse(namingResponse) as { accepted: boolean; errors: string[] }; setMessage(result.accepted ? "Naming response accepted and persisted" : result.errors.join(" · ")); if (result.accepted) { setNamingResponse(""); await refresh(); } }
    catch (error) { setMessage(error instanceof Error ? error.message : "Naming response failed"); }
    finally { setBusy(null); }
  }
  async function exportRun(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Exporting");
    try { const target = await window.eidolonSimulator.exportRun() as { filename: string; sha256: string } | null; setMessage(target ? `Exported ${target.filename} · ${target.sha256.slice(0, 12)}` : "Export canceled"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
    finally { setBusy(null); }
  }

  const worldSummary = manifest?.worldSummary?.[world];
  const viewPopulation = runView?.settlements.reduce((sum, settlement) => sum + BigInt(settlement.population), 0n) ?? null;
  const viewStateCount = new Set(runView?.settlements.map((settlement) => settlement.stateId) ?? []).size;
  const operator = deriveOperatorViewModel(snapshot);
  const content = (() => {
    if (selected === "Runs") return <>
      <section className="cards"><Stat label="RUN STATUS" value={operator.runState} note={manifest?.runId ?? "No persisted run"}/><Stat label="HISTORY" value={manifest ? `${manifest.currentYear} / 2000` : "—"} note={manifest ? `${manifest.mode} · seed ${manifest.seed}` : "No selected run"}/><Stat label="NAMING JOBS" value={manifest?.namingJobCount ?? "—"} note={snapshot.pendingNamingJob ? "Required owner input pending" : "No pending barrier"}/></section>
      {snapshot.runs.length > 0 && <section className="panel vertical"><p className="eyebrow">PERSISTED RUNS</p><div className="tabs">{snapshot.runs.map((run) => <button key={run.runId} className={snapshot.selectedRunId === run.runId ? "active" : ""} onClick={() => void selectRun(run.runId)}>{run.mode} · {run.status} · {run.currentYear}</button>)}</div></section>}
      <section className="cards"><Stat label="CANONICAL DATA" value={operator.semanticAuthorityLabel} note={snapshot.canonicalData.semanticAuthoritySha256?.slice(0, 16) ?? "Internal bundle error"}/><Stat label="YEAR-0 READINESS" value={snapshot.canonicalData.year0Readiness ?? "INVALID"} note={snapshot.canonicalData.bundleVersion ?? "Bundle unavailable"}/><Stat label="OWNER POLICY" value={snapshot.canonicalData.ownerPolicyVersion?.split("@")[1] ?? "—"} note={snapshot.canonicalData.personalityPolicyVersion ?? "Policy unavailable"}/></section>
      <section className="panel"><div><p className="eyebrow">CANONICAL RUN</p><h2>Run the bundled V4 Breed/cohort history</h2><p>Canonical V4 data is loaded automatically. The first owner intervention is a genuine naming barrier with calculated governing context.</p>{operator.canonicalDisabledReasons.map((reason) => <small key={reason}>{reason}</small>)}</div><button className="primary" onClick={() => void runCanonical()} disabled={busy !== null || !operator.canRunCanonical}>{busy ?? "RUN CANONICAL"}</button></section>
      <section className="panel"><div><p className="eyebrow">DIAGNOSTIC RUN</p><h2>Run the bundled deterministic diagnostic</h2><p>Diagnostic mode uses its own fixture and seed, persists independently, and never changes canonical readiness.</p>{operator.diagnosticDisabledReasons.map((reason) => <small key={reason}>{reason}</small>)}</div><button className="primary" onClick={() => void runDiagnostic()} disabled={busy !== null || !operator.canRunDiagnostic}>{busy ?? "RUN DIAGNOSTIC"}</button></section>
    </>;
    if (selected === "Live Dashboard") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <section className="cards four"><Stat label="POPULATION" value={viewPopulation !== null ? compact.format(viewPopulation) : "—"} note={viewPopulation?.toString() ?? "No persisted run"}/><Stat label="SETTLEMENTS" value={runView?.settlements.length ?? "—"} note={`Persisted through year ${runView?.effectiveYear ?? "—"}`}/><Stat label="STATES" value={runView ? viewStateCount : "—"} note="Derived from persisted membership"/><Stat label="VIEW YEAR" value={runView?.effectiveYear ?? "—"} note={`${world} persisted state`}/></section>
      <section className="panel"><div><p className="eyebrow">PERSISTED HISTORY</p><h2>{manifest?.status ?? "No active run"}</h2><p>Growth is the only population creation mechanism. Migration, founding, and DJT transfers are conservation-gated; naming pauses preserve an exact checkpoint.</p></div><div className="meter"><span style={{ width: `${(manifest?.currentYear ?? 0) / 20}%` }}/><small>Persisted year {manifest?.currentYear ?? 0} of 2000</small></div></section>
    </>;
    if (selected === "World Browser") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <div className="browser-grid"><section className="map" aria-label="Equirectangular Site plot">{visibleSites.map((site) => <button key={site.siteId} aria-label={`${site.siteId} ${site.currentSiteName || "unnamed"}`} className={site.siteId === siteId ? "site selected" : "site"} style={{ left: `${((Number(site.longitude) + 180) / 360) * 100}%`, top: `${((90 - Number(site.latitude)) / 180) * 100}%` }} onClick={() => setSiteId(site.siteId)} />)}<span className="map-label">Neutral coordinate plot · physical Site positions</span></section><SiteCard site={selectedSite} world={world} year={year}/></div>
      <SiteTable sites={visibleSites} selected={siteId} select={setSiteId}/>
    </>;
    if (selected === "Settlement Detail") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><SiteCard site={selectedSite} world={world} year={runView?.effectiveYear ?? year}/><section className="detail-grid"><Detail title="Identity" rows={[["Site", selectedSite?.siteId], ["Region", `${selectedSite?.regionId} · ${selectedSite?.regionName}`], ["Political State", selectedSettlement?.stateId], ["Persisted year", runView?.effectiveYear]]}/><Detail title="Historical projections" rows={[["Population", selectedSettlement?.population], ["Dominant faction", selectedSettlement?.dominantFaction ?? "No resolved denominator"], ["Political form", selectedSettlement?.politicalForm ?? "No resolved denominator"], ["Economic form", selectedSettlement?.economicForm ?? "No resolved denominator"]]}/><Detail title="Naming & evidence" rows={[["Current name", selectedSettlement?.name ?? "No Settlement at this Site"], ["Provenance", selectedSettlement ? "PERSISTED" : "UNINHABITED"], ["POIs", selectedSite?.poiCount], ["Runtime denominator issues", selectedSettlement?.runtimeIssues.length ?? 0]]}/></section></>;
    if (selected === "State Detail") { const stateId = selectedSettlement?.stateId; const members = (runView?.settlements ?? []).filter((settlement) => settlement.stateId === stateId); const conclave = runView?.history.filter((row) => row.historyType === "INSTITUTION_CONCLAVE").length ?? 0; const senate = runView?.history.filter((row) => row.historyType === "INSTITUTION_SENATE").length ?? 0; return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="panel vertical"><p className="eyebrow">PERSISTED POLITICAL STATE</p><h2>{stateId ?? "No State for selected Site"}</h2><div className="detail-grid"><Detail title="Membership" rows={[["Member Settlements", members.length], ["Physical Region", selectedSite?.regionId], ["Persisted year", runView?.effectiveYear], ["Population", members.reduce((sum, member) => sum + BigInt(member.population), 0n).toString()]]}/><Detail title="Representation" rows={[["Conclave ledger rows", conclave], ["Senate ledger rows", senate], ["Pending naming", snapshot.pendingNamingJob?.context.world === world ? snapshot.pendingNamingJob.namingJobId : "None"], ["Current status", manifest?.status]]}/></div></section></>; }
    if (selected === "Institutions") { const conclave = runView?.history.filter((row) => row.historyType === "INSTITUTION_CONCLAVE") ?? []; const senate = runView?.history.filter((row) => row.historyType === "INSTITUTION_SENATE") ?? []; return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="cards"><Stat label="CONCLAVE LEDGERS" value={conclave.length} note={`Persisted through ${runView?.effectiveYear ?? "—"}`}/><Stat label="SENATE LEDGERS" value={senate.length} note={`Persisted through ${runView?.effectiveYear ?? "—"}`}/><Stat label="CHECKPOINTS" value={runView?.checkpoints.length ?? 0} note={`${world} replay indexes`}/></section><section className="panel vertical"><p className="eyebrow">INSTITUTION LEDGERS</p><h2>{conclave.length + senate.length ? "Persisted seat calculations" : "No institution ledger at this year"}</h2><p>{conclave.length} Conclave snapshot(s) and {senate.length} Senate election ledger(s) are present in SQLite for this view.</p></section></>; }
    if (selected === "Timeline") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="timeline">{(runView?.events.slice(-40) ?? []).map((event) => <button key={event.eventId} onClick={() => setYear(event.year)} className={year === event.year ? "active" : ""}><strong>{event.year}</strong><span>{event.eventType} · {event.entityId}</span></button>)}{runView?.events.length === 0 && <p>No persisted events through this year.</p>}</section></>;
    if (selected === "Naming Queue") return <section className="panel vertical"><p className="eyebrow">DETERMINISTIC BARRIER</p><h2>{snapshot.pendingNamingJob?.namingJobId ?? "No pending required naming job"}</h2><p>{snapshot.pendingNamingJob ? `${snapshot.pendingNamingJob.context.world} · year ${snapshot.pendingNamingJob.context.year} · ${snapshot.pendingNamingJob.items.length} exact request(s)` : "The persisted run is not waiting for naming input."}</p>{snapshot.pendingNamingJob && <><textarea className="dropzone" readOnly value={snapshot.pendingNamingJob.promptText}/><textarea className="dropzone" aria-label="Naming response JSON" placeholder="Paste strict eidolon-simulator-naming-response-v1 JSON" value={namingResponse} onChange={(event) => setNamingResponse(event.target.value)}/><button className="primary" onClick={() => void submitNaming()} disabled={busy !== null || !namingResponse.trim()}>{busy ?? "VALIDATE & ACCEPT"}</button></>}</section>;
    if (selected === "Export") return <><section className="cards"><Stat label="EXPORT STATUS" value={snapshot.exportValidation?.valid ? "VERIFIED" : "NOT CREATED"} note={`${snapshot.exportValidation?.checkedFiles ?? 0} checksummed payload files`}/><Stat label="MODE" value={manifest?.mode ?? "—"} note={operator.canExport ? "Persisted run eligible" : "Run must complete first"}/><Stat label="SHA-256" value={manifest?.exportSha256?.slice(0, 12) ?? "—"} note={manifest?.exportFilename ?? "No export"}/></section><section className="panel"><div><p className="eyebrow">PERSISTED DATA PRODUCT</p><h2>Selected persisted run export</h2><p>Export remains disabled while the selected run is incomplete or waiting at a mandatory naming barrier.</p></div><button className="primary" onClick={() => void exportRun()} disabled={!operator.canExport || busy !== null}>{busy ?? "SAVE VERIFIED ZIP"}</button></section></>;
    return <><section className="cards"><Stat label="CANONICAL DATA" value={snapshot.canonicalData.status} note={snapshot.canonicalData.bundleVersion ?? "Internal bundle defect"}/><Stat label="RUN STATE" value={operator.runState} note={manifest ? `${manifest.mode} · ${manifest.runId}` : "No selected run"}/><Stat label="AUTHORITY" value={operator.semanticAuthorityLabel} note={snapshot.canonicalData.semanticAuthoritySha256?.slice(0, 16) ?? "not loaded"}/></section><section className="detail-grid"><Detail title="Bundled authority" rows={[["Semantic authority", snapshot.canonicalData.semanticAuthorityVersion], ["Verdict", snapshot.canonicalData.semanticAuthorityVerdict], ["Year-0 readiness", snapshot.canonicalData.year0Readiness], ["Owner policy", snapshot.canonicalData.ownerPolicyVersion], ["Personality policy", snapshot.canonicalData.personalityPolicyVersion]]}/><Detail title="Persisted diagnostics" rows={[["Run mode/status", manifest ? `${manifest.mode} / ${manifest.status}` : "NO RUN"], ["Run ID", manifest?.runId], ["Current year", manifest?.currentYear ?? "—"], ["Checkpoint count", manifest?.checkpointCount ?? 0], ["Event count", manifest?.eventCount ?? 0], ["Cohort count", manifest?.cohortCount ?? 0], ["Pending naming job", snapshot.pendingNamingJob?.namingJobId ?? "None"], ["Database path", snapshot.databasePath ?? "Browser preview"]]}/></section>{snapshot.canonicalData.status === "INVALID" && <section className="panel vertical"><p className="eyebrow">INTERNAL BUILD DEFECT</p><h2>BUNDLED_CANONICAL_DATA_INVALID</h2><p>{snapshot.canonicalData.errorDetail}</p></section>}</>;
  })();

  return <main className="app-shell"><aside><div className="brand"><span className="sigil">EOE</span><div><strong>Historical Simulator</strong><small>Standalone operator console</small></div></div><nav aria-label="Simulator sections">{navigation.map((item) => <button key={item} className={selected === item ? "active" : ""} onClick={() => setSelected(item)}>{item}</button>)}</nav><div className="runtime"><span className="status-dot"/>Local-only runtime<br/><small>{message}</small></div></aside><section className="workspace"><header><div><p className="eyebrow">ECHOES OF EIDOLON</p><h1>{selected}</h1></div><span className="badge diagnostic">{manifest?.mode ?? "NO RUN"}</span></header><div className={`notice ${operator.primaryNotice.severity.toLowerCase()}`}><strong>{operator.primaryNotice.title}</strong><span>{operator.primaryNotice.detail}</span></div>{content}</section></main>;
}

function WorldTabs({ world, setWorld }: { world: World; setWorld: (world: World) => void }): React.JSX.Element { return <div className="tabs">{(["CONCORD","SCHISM","RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div>; }
function Year({ year, setYear }: { year: number; setYear: (year: number) => void }): React.JSX.Element { return <label className="year">YEAR <input type="range" min="0" max="2000" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))}/><output>{year}</output></label>; }
function SiteCard({ site, world, year }: { site?: Site; world: World; year: number }): React.JSX.Element { return <section className="site-card"><p className="eyebrow">SELECTED PHYSICAL SITE</p><h2>{site?.currentSiteName || "Unnamed candidate"}</h2><strong>{site?.siteId ?? "—"} · {site?.regionId} {site?.regionName}</strong><dl><div><dt>World/year</dt><dd>{world} · {year}</dd></div><div><dt>Class</dt><dd>{site?.classification ?? "—"}</dd></div><div><dt>Terrain</dt><dd>{site?.broadTerrain ?? "—"}</dd></div><div><dt>Political State</dt><dd>STATE_{world}_{site?.regionId}</dd></div></dl></section>; }
function SiteTable({ sites, selected, select }: { sites: Site[]; selected: string; select: (id: string) => void }): React.JSX.Element { return <div className="table-wrap"><table><thead><tr><th>Site</th><th>Name</th><th>Region</th><th>Class</th><th>Coordinates</th><th>POIs</th></tr></thead><tbody>{sites.map((site) => <tr key={site.siteId} className={selected === site.siteId ? "selected" : ""} onClick={() => select(site.siteId)}><td>{site.siteId}</td><td>{site.currentSiteName || <em>Pending</em>}</td><td>{site.regionId} · {site.regionName}</td><td>{site.classification}</td><td>{Number(site.latitude).toFixed(2)}, {Number(site.longitude).toFixed(2)}</td><td>{site.poiCount}</td></tr>)}</tbody></table></div>; }
function Detail({ title, rows }: { title: string; rows: [string, React.ReactNode][] }): React.JSX.Element { return <section className="detail"><h3>{title}</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl></section>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
