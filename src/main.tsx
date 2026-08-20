import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { deriveOperatorViewModel, type OperatorPreflight, type OperatorSnapshot } from "./core/operator/operator-state.js";
import "./ui/styles.css";

const navigation = ["Runs", "Setup & Preflight", "Live Dashboard", "World Browser", "Settlement Detail", "State Detail", "Institutions", "Timeline", "Naming Queue", "Export", "Diagnostics"] as const;
type Section = typeof navigation[number];
type World = "CONCORD" | "SCHISM" | "RUIN";
interface Site { siteId: string; currentSiteName: string; classification: string; attractivenessTier: string; latitude: string; longitude: string; regionId: string; regionName: string; continent: string; broadTerrain: string; poiCount: string; }
interface Issue { issueCode: string; severity: string; blocksCanonical: boolean; message: string; }
interface Manifest { runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; status: string; seed: string; createdAt?: string; currentYear: number; finalYear: number; djtYear?: number; checkpointCount: number; eventCount: number; cohortCount: number; namingJobCount: number; exportFilename?: string; exportSha256?: string; contentDigest?: string; canonicalReady: boolean; activeIssues: Issue[]; worldSummary: Record<World, { finalPopulation: string; settlements: number; states: number; events: number; federalCapitalSiteId: string | null }>; audit?: Record<string, number>; }
interface Preflight extends OperatorPreflight { structuralStatus: string; counts: Record<string, number>; coverage: Record<string, { resolved: number; terminalNull: number; invalidUnresearched: number; unresolved: number }>; }
interface SettlementProjection { settlementId: string; siteId: string; regionId: string; stateId: string; name: string; population: string; dominantFaction: World | null; politicalForm: string | null; economicForm: string | null; runtimeIssues: unknown[]; }
interface NamingJob { namingJobId: string; promptText: string; items: { requestId: string; entityType: string; entityId: string }[]; context: { year: number; world: World; reason: string }; }
interface Snapshot extends OperatorSnapshot { manifest: Manifest | null; preflight: Preflight | null; runs: Manifest[]; selectedRunId: string | null; exportValidation: { valid: boolean; checkedFiles: number } | null; sites: Site[]; pendingNamingJob?: NamingJob | null; settlementProjections?: Record<World, SettlementProjection[]> | null; databasePath?: string; }

const emptySnapshot: Snapshot = { manifest: null, preflight: null, runs: [], selectedRunId: null, exportValidation: null, sites: [] };
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
  const manifest = snapshot.manifest;
  const preflight = snapshot.preflight;
  const selectedSite = snapshot.sites.find((site) => site.siteId === siteId) ?? snapshot.sites[0];
  const visibleSites = useMemo(() => snapshot.sites.slice(0, 175), [snapshot.sites]);
  const selectedSettlement = snapshot.settlementProjections?.[world]?.find((settlement) => settlement.siteId === siteId);

  async function refresh(): Promise<void> {
    if (!window.eidolonSimulator) { setMessage("Browser preview — desktop IPC is unavailable"); return; }
    const next = await window.eidolonSimulator.getOperatorSnapshot() as Snapshot;
    setSnapshot(next); setMessage("Verified local evidence loaded");
  }
  useEffect(() => { void refresh(); }, []);

  async function validateInputs(): Promise<void> {
    if (!window.eidolonSimulator) return;
    const directory = await window.eidolonSimulator.selectInputDirectory();
    if (!directory) return;
    setBusy("Validating"); setSnapshot((current) => ({ ...current, validationInProgress: true, validationError: null }));
    try {
      const report = await window.eidolonSimulator.validateInputs(directory) as Preflight;
      setSnapshot((current) => ({ ...current, preflight: report, validationInProgress: false }));
      setMessage(report.canonicalReady ? "Current inputs are canonical-ready" : "Current validation completed; blockers remain visible");
      const persisted = await window.eidolonSimulator.getOperatorSnapshot() as Snapshot;
      setSnapshot(persisted);
    }
    catch (error) { const detail = error instanceof Error ? error.message : "Validation failed"; setMessage(detail); setSnapshot((current) => ({ ...current, validationInProgress: false, validationError: detail })); }
    finally { setBusy(null); }
  }
  async function revalidateInputs(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Revalidating"); setSnapshot((current) => ({ ...current, validationInProgress: true, validationError: null }));
    try { const report = await window.eidolonSimulator.revalidateInputs() as Preflight; setSnapshot((current) => ({ ...current, preflight: report, validationInProgress: false })); await refresh(); }
    catch (error) { const detail = error instanceof Error ? error.message : "Revalidation failed"; setMessage(detail); setSnapshot((current) => ({ ...current, validationInProgress: false, validationError: detail })); }
    finally { setBusy(null); }
  }
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
    setSnapshot(next);
  }
  async function runCanonical(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Starting canonical run");
    try { const result = await window.eidolonSimulator.runCanonical("EIDOLON_CANONICAL_OWNER_RUN_V1") as { runId: string; status: string }; setMessage(`${result.runId} · ${result.status}`); await refresh(); }
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
  async function exportDiagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Exporting");
    try { const target = await window.eidolonSimulator.exportDiagnostic(); setMessage(target ? `Exported to ${target}` : "Export canceled"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
    finally { setBusy(null); }
  }

  const worldSummary = manifest?.worldSummary?.[world];
  const operator = deriveOperatorViewModel(snapshot);
  const blockers = operator.blockingIssues;
  const content = (() => {
    if (selected === "Runs") return <>
      <section className="cards"><Stat label="RUN STATUS" value={operator.runState} note={manifest?.runId ?? "No persisted run"}/><Stat label="HISTORY" value={manifest ? `${manifest.currentYear} / 2000` : "—"} note={manifest ? `${manifest.mode} · seed ${manifest.seed}` : "No selected run"}/><Stat label="NAMING JOBS" value={manifest?.namingJobCount ?? "—"} note={snapshot.pendingNamingJob ? "Required owner input pending" : "No pending barrier"}/></section>
      {snapshot.runs.length > 0 && <section className="panel vertical"><p className="eyebrow">PERSISTED RUNS</p><div className="tabs">{snapshot.runs.map((run) => <button key={run.runId} className={snapshot.selectedRunId === run.runId ? "active" : ""} onClick={() => void selectRun(run.runId)}>{run.mode} · {run.status} · {run.currentYear}</button>)}</div></section>}
      <section className="panel"><div><p className="eyebrow">DIAGNOSTIC RUN</p><h2>Run the bundled deterministic diagnostic</h2><p>Diagnostic mode uses its own fixture and seed, persists as a distinct SQLite run, and does not change canonical preflight readiness.</p>{operator.diagnosticDisabledReasons.map((reason) => <small key={reason}>{reason}</small>)}</div><button className="primary" onClick={() => void runDiagnostic()} disabled={busy !== null || !operator.canRunDiagnostic}>{busy ?? "RUN DIAGNOSTIC"}</button></section>
      <section className="panel"><div><p className="eyebrow">CANONICAL RUN</p><h2>Create the persisted Breed/cohort history</h2><p>The canonical run requires the current simulation-ready semantic authority, exact BigInt cohorts, checkpoints, and mandatory naming barriers.</p>{operator.canonicalDisabledReasons.map((reason) => <small key={reason}>{reason}</small>)}</div><button className="primary" onClick={() => void runCanonical()} disabled={busy !== null || !operator.canRunCanonical}>{busy ?? "RUN CANONICAL"}</button></section>
    </>;
    if (selected === "Setup & Preflight") return <>
      <section className="cards"><Stat label="STRUCTURE" value={operator.preflightState === "NOT_VALIDATED" ? "NOT VALIDATED" : operator.preflightState === "VALIDATING" ? "VALIDATING" : preflight?.structuralStatus ?? "ERROR"} note={operator.preflightState === "NOT_VALIDATED" ? "No preflight has been run" : "Checksums, row counts, and identities"}/><Stat label="BREEDS" value={preflight?.counts ? exact.format(preflight.counts.breeds) : "—"} note={`${preflight?.counts?.civicBreeds ?? "—"} civic · ${preflight?.counts?.pets ?? "—"} PET`}/><Stat label="CANONICAL" value={operator.setupCanonicalStatus} note={operator.setupCanonicalDetail}/></section>
      <section className="panel vertical"><div className="panel-head"><div><p className="eyebrow">INPUT AUTHORITY</p><h2>Real bundle preflight</h2><p>Semantic authority: {operator.semanticAuthorityLabel}</p></div><div className="tabs">{operator.preflightState === "STALE" && <button className="primary" onClick={() => void revalidateInputs()} disabled={busy !== null || !operator.canValidate}>REVALIDATE</button>}<button className="primary" onClick={() => void validateInputs()} disabled={busy !== null || !operator.canValidate}>SELECT & VALIDATE</button></div></div><div className="issue-list">{blockers.map((issue) => <div className={issue.blocksCanonical ? "issue blocker" : "issue warning"} key={issue.issueCode}><strong>{issue.issueCode}</strong><span>{issue.message}</span></div>)}</div></section>
    </>;
    if (selected === "Live Dashboard") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <section className="cards four"><Stat label="POPULATION" value={worldSummary ? compact.format(BigInt(worldSummary.finalPopulation)) : "—"} note={worldSummary?.finalPopulation ?? "No persisted run"}/><Stat label="SETTLEMENTS" value={worldSummary?.settlements ?? "—"} note="Persisted at the current run year"/><Stat label="STATES" value={worldSummary?.states ?? "—"} note="Derived from persisted membership"/><Stat label="RUN YEAR" value={manifest?.currentYear ?? "—"} note={`${world} persisted state`}/></section>
      <section className="panel"><div><p className="eyebrow">PERSISTED HISTORY</p><h2>{manifest?.status ?? "No active run"}</h2><p>Growth is the only population creation mechanism. Migration, founding, and DJT transfers are conservation-gated; naming pauses preserve an exact checkpoint.</p></div><div className="meter"><span style={{ width: `${(manifest?.currentYear ?? 0) / 20}%` }}/><small>Persisted year {manifest?.currentYear ?? 0} of 2000</small></div></section>
    </>;
    if (selected === "World Browser") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <div className="browser-grid"><section className="map" aria-label="Equirectangular Site plot">{visibleSites.map((site) => <button key={site.siteId} aria-label={`${site.siteId} ${site.currentSiteName || "unnamed"}`} className={site.siteId === siteId ? "site selected" : "site"} style={{ left: `${((Number(site.longitude) + 180) / 360) * 100}%`, top: `${((90 - Number(site.latitude)) / 180) * 100}%` }} onClick={() => setSiteId(site.siteId)} />)}<span className="map-label">Neutral coordinate plot · physical Site positions</span></section><SiteCard site={selectedSite} world={world} year={year}/></div>
      <SiteTable sites={visibleSites} selected={siteId} select={setSiteId}/>
    </>;
    if (selected === "Settlement Detail") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><SiteCard site={selectedSite} world={world} year={year}/><section className="detail-grid"><Detail title="Identity" rows={[["Site", selectedSite?.siteId], ["Region", `${selectedSite?.regionId} · ${selectedSite?.regionName}`], ["Political State", selectedSettlement?.stateId], ["Persisted year", manifest?.currentYear]]}/><Detail title="Historical projections" rows={[["Population", selectedSettlement?.population], ["Dominant faction", selectedSettlement?.dominantFaction ?? "No resolved denominator"], ["Political form", selectedSettlement?.politicalForm ?? "No resolved denominator"], ["Economic form", selectedSettlement?.economicForm ?? "No resolved denominator"]]}/><Detail title="Naming & evidence" rows={[["Current name", selectedSettlement?.name ?? "No Settlement at this Site"], ["Provenance", selectedSettlement ? "OWNER_INPUT" : "UNINHABITED"], ["POIs", selectedSite?.poiCount], ["Runtime denominator issues", selectedSettlement?.runtimeIssues.length ?? 0]]}/></section></>;
    if (selected === "State Detail") { const stateId = selectedSettlement?.stateId; const members = (snapshot.settlementProjections?.[world] ?? []).filter((settlement) => settlement.stateId === stateId); return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="panel vertical"><p className="eyebrow">PERSISTED POLITICAL STATE</p><h2>{stateId ?? "No State for selected Site"}</h2><div className="detail-grid"><Detail title="Membership" rows={[["Member Settlements", members.length], ["Physical Region", selectedSite?.regionId], ["Persisted year", manifest?.currentYear], ["Population", members.reduce((sum, member) => sum + BigInt(member.population), 0n).toString()]]}/><Detail title="Representation" rows={[["Conclave ledger", manifest ? "Not established at current year" : "No run"], ["Senate ledger", manifest ? "Not established at current year" : "No run"], ["Pending naming", snapshot.pendingNamingJob?.context.world === world ? snapshot.pendingNamingJob.namingJobId : "None"], ["Current status", manifest?.status]]}/></div></section></>; }
    if (selected === "Institutions") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="cards"><Stat label="CONCLAVE POLICY" value={year < 90 ? "CITY SEATS" : "CAPACITY"} note={year < 90 ? "One seat per city" : "Two city + one unincorporated per State"}/><Stat label="SENATE" value={year >= 50 && year >= (manifest?.djtYear ?? 501) ? "50 SEATS" : year >= 50 ? "48 SEATS" : "NOT ACTIVE"} note="Two per State after year 50"/><Stat label="LEDGER YEAR" value={year} note={`${world} exact seat identities`}/></section><section className="panel"><div><p className="eyebrow">INSTITUTION LEDGERS</p><h2>Exact seats, vacancies, terms, and faction history</h2><p>The exported seat ledgers preserve represented Settlement, Site, State, holder, strategy epoch, and vacancy status.</p></div></section></>;
    if (selected === "Timeline") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="timeline">{[[0,"Initial settlements and owner names"],[90,"Conclave capacity transition"],[manifest?.djtYear ?? 501,"DJT · Innerwood · capital change"],[505,"Adjacent faction secession"],[525,"Rebalance marker; owner-disabled"],[2000,"Diagnostic completion"]].map(([eventYear,label]) => <button key={String(label)} onClick={() => setYear(Number(eventYear))} className={year === eventYear ? "active" : ""}><strong>{eventYear}</strong><span>{label}</span></button>)}</section></>;
    if (selected === "Naming Queue") return <section className="panel vertical"><p className="eyebrow">DETERMINISTIC BARRIER</p><h2>{snapshot.pendingNamingJob?.namingJobId ?? "No pending required naming job"}</h2><p>{snapshot.pendingNamingJob ? `${snapshot.pendingNamingJob.context.world} · year ${snapshot.pendingNamingJob.context.year} · ${snapshot.pendingNamingJob.items.length} exact request(s)` : "The persisted run is not waiting for naming input."}</p>{snapshot.pendingNamingJob && <><textarea className="dropzone" readOnly value={snapshot.pendingNamingJob.promptText}/><textarea className="dropzone" aria-label="Naming response JSON" placeholder="Paste strict eidolon-simulator-naming-response-v1 JSON" value={namingResponse} onChange={(event) => setNamingResponse(event.target.value)}/><button className="primary" onClick={() => void submitNaming()} disabled={busy !== null || !namingResponse.trim()}>{busy ?? "VALIDATE & ACCEPT"}</button></>}</section>;
    if (selected === "Export") return <><section className="cards"><Stat label="EXPORT STATUS" value={snapshot.exportValidation?.valid ? "VERIFIED" : "NOT CREATED"} note={`${snapshot.exportValidation?.checkedFiles ?? 0} checksummed payload files`}/><Stat label="MODE" value={manifest?.mode ?? "—"} note={operator.canExport ? "Persisted run eligible" : "Run must complete first"}/><Stat label="SHA-256" value={manifest?.exportSha256?.slice(0, 12) ?? "—"} note={manifest?.exportFilename ?? "No export"}/></section><section className="panel"><div><p className="eyebrow">PERSISTED DATA PRODUCT</p><h2>Selected persisted run export</h2><p>Export remains disabled while the selected run is incomplete or waiting at a mandatory naming barrier.</p></div><button className="primary" onClick={() => void exportDiagnostic()} disabled={!operator.canExport || busy !== null}>{busy ?? "SAVE VERIFIED ZIP"}</button></section></>;
    return <><section className="cards"><Stat label="PREFLIGHT STATE" value={operator.preflightState === "NOT_VALIDATED" ? "NOT VALIDATED" : operator.preflightState} note={preflight ? "Persisted SQLite preflight" : "No preflight has been run"}/><Stat label="RUN STATE" value={operator.runState} note={manifest ? `${manifest.mode} · ${manifest.runId}` : "No selected run"}/><Stat label="AUTHORITY" value={operator.semanticAuthorityLabel} note={preflight?.semanticAuthoritySha256?.slice(0, 16) ?? "Semantic authority: not loaded"}/></section><section className="detail-grid"><Detail title="Operator state" rows={[["Policy version", preflight?.policyVersion ?? "not loaded"], ["Run mode/status", manifest ? `${manifest.mode} / ${manifest.status}` : "NO RUN"], ["Run ID", manifest?.runId], ["Current year", manifest?.currentYear ?? "—"], ["Pending naming job", snapshot.pendingNamingJob?.namingJobId ?? "None"]]}/><Detail title="Persisted diagnostics" rows={[["Checkpoint count", manifest?.checkpointCount ?? 0], ["Event count", manifest?.eventCount ?? 0], ["Cohort count", manifest?.cohortCount ?? 0], ["Authority hash", preflight?.semanticAuthoritySha256 ?? "not loaded"], ["Database path", snapshot.databasePath ?? "Browser preview"]]}/></section><section className="panel vertical"><p className="eyebrow">READINESS DETAILS</p><h2>{preflight ? operator.primaryNotice.title : "V4 research authority has not yet been validated."}</h2><div className="issue-list">{blockers.map((issue) => <div className="issue blocker" key={issue.issueCode}><strong>{issue.issueCode}</strong><span>{issue.message}</span></div>)}</div></section></>;
  })();

  return <main className="app-shell"><aside><div className="brand"><span className="sigil">EOE</span><div><strong>Historical Simulator</strong><small>Standalone operator console</small></div></div><nav aria-label="Simulator sections">{navigation.map((item) => <button key={item} className={selected === item ? "active" : ""} onClick={() => setSelected(item)}>{item}</button>)}</nav><div className="runtime"><span className="status-dot"/>Local-only runtime<br/><small>{message}</small></div></aside><section className="workspace"><header><div><p className="eyebrow">ECHOES OF EIDOLON</p><h1>{selected}</h1></div><span className="badge diagnostic">{manifest?.mode ?? "NO RUN"}</span></header><div className={`notice ${operator.primaryNotice.severity.toLowerCase()}`}><strong>{operator.primaryNotice.title}</strong><span>{operator.primaryNotice.detail}</span></div>{content}</section></main>;
}

function WorldTabs({ world, setWorld }: { world: World; setWorld: (world: World) => void }): React.JSX.Element { return <div className="tabs">{(["CONCORD","SCHISM","RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div>; }
function Year({ year, setYear }: { year: number; setYear: (year: number) => void }): React.JSX.Element { return <label className="year">YEAR <input type="range" min="0" max="2000" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))}/><output>{year}</output></label>; }
function SiteCard({ site, world, year }: { site?: Site; world: World; year: number }): React.JSX.Element { return <section className="site-card"><p className="eyebrow">SELECTED PHYSICAL SITE</p><h2>{site?.currentSiteName || "Unnamed candidate"}</h2><strong>{site?.siteId ?? "—"} · {site?.regionId} {site?.regionName}</strong><dl><div><dt>World/year</dt><dd>{world} · {year}</dd></div><div><dt>Class</dt><dd>{site?.classification ?? "—"}</dd></div><div><dt>Terrain</dt><dd>{site?.broadTerrain ?? "—"}</dd></div><div><dt>Political State</dt><dd>STATE_{world}_{site?.regionId}</dd></div></dl></section>; }
function SiteTable({ sites, selected, select }: { sites: Site[]; selected: string; select: (id: string) => void }): React.JSX.Element { return <div className="table-wrap"><table><thead><tr><th>Site</th><th>Name</th><th>Region</th><th>Class</th><th>Coordinates</th><th>POIs</th></tr></thead><tbody>{sites.map((site) => <tr key={site.siteId} className={selected === site.siteId ? "selected" : ""} onClick={() => select(site.siteId)}><td>{site.siteId}</td><td>{site.currentSiteName || <em>Pending</em>}</td><td>{site.regionId} · {site.regionName}</td><td>{site.classification}</td><td>{Number(site.latitude).toFixed(2)}, {Number(site.longitude).toFixed(2)}</td><td>{site.poiCount}</td></tr>)}</tbody></table></div>; }
function Detail({ title, rows }: { title: string; rows: [string, React.ReactNode][] }): React.JSX.Element { return <section className="detail"><h3>{title}</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl></section>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
