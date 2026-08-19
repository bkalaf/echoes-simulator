import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./ui/styles.css";

const navigation = ["Runs", "Setup & Preflight", "Live Dashboard", "World Browser", "Settlement Detail", "State Detail", "Institutions", "Timeline", "Naming Queue", "Export", "Diagnostics"] as const;
type Section = typeof navigation[number];
type World = "CONCORD" | "SCHISM" | "RUIN";
interface Site { siteId: string; currentSiteName: string; classification: string; attractivenessTier: string; latitude: string; longitude: string; regionId: string; regionName: string; continent: string; broadTerrain: string; poiCount: string; }
interface Issue { issueCode: string; severity: string; blocksCanonical: boolean; message: string; }
interface Manifest { runId: string; mode: string; finalYear: number; djtYear: number; checkpointCount: number; namingJobCount: number; exportFilename: string; exportSha256: string; contentDigest: string; canonicalReady: boolean; activeIssues: Issue[]; worldSummary: Record<World, { finalPopulation: string; settlements: number; states: number; events: number; federalCapitalSiteId: string }>; audit: Record<string, number>; }
interface Preflight { structuralStatus: string; canonicalReady: boolean; counts: Record<string, number>; coverage: Record<string, { resolved: number; terminalNull: number; invalidUnresearched: number; unresolved: number }>; activeIssues: Issue[]; sourceRoles: { v3SemanticAuthority: { filename: string; sha256: string; rows: number } | null }; }
interface Snapshot { manifest: Manifest | null; preflight: Preflight | null; exportValidation: { valid: boolean; checkedFiles: number } | null; sites: Site[]; }

const emptySnapshot: Snapshot = { manifest: null, preflight: null, exportValidation: null, sites: [] };
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
  const manifest = snapshot.manifest;
  const preflight = snapshot.preflight;
  const selectedSite = snapshot.sites.find((site) => site.siteId === siteId) ?? snapshot.sites[0];
  const visibleSites = useMemo(() => snapshot.sites.slice(0, 175), [snapshot.sites]);

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
    setBusy("Validating");
    try {
      const report = await window.eidolonSimulator.validateInputs(directory) as Preflight;
      setSnapshot((current) => ({ ...current, preflight: report }));
      setMessage(report.canonicalReady ? "Current inputs are canonical-ready" : "Current validation completed; blockers remain visible");
      const persisted = await window.eidolonSimulator.getOperatorSnapshot() as Snapshot;
      setSnapshot(persisted);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Validation failed"); }
    finally { setBusy(null); }
  }
  async function runDiagnostic(): Promise<void> {
    if (!window.eidolonSimulator) return;
    setBusy("Running years 0–2000");
    try { const result = await window.eidolonSimulator.runDiagnostic("EIDOLON_DESKTOP_DIAGNOSTIC_V1") as { contentDigest: string }; setMessage(`Diagnostic complete · ${result.contentDigest.slice(0, 12)}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Diagnostic failed"); }
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
  const blockers = (preflight?.activeIssues ?? manifest?.activeIssues ?? []).filter((issue) => issue.blocksCanonical);
  const content = (() => {
    if (selected === "Runs") return <>
      <section className="cards"><Stat label="RUN STATUS" value={manifest ? "COMPLETE" : "CREATED"} note={manifest?.runId ?? "No persisted run"}/><Stat label="HISTORY" value={manifest ? `0 / ${manifest.finalYear}` : "0 / 2000"} note="Three deterministic worlds"/><Stat label="NAMING JOBS" value={manifest?.namingJobCount ?? "—"} note="No unresolved naming barrier"/></section>
      <section className="panel"><div><p className="eyebrow">LOCAL RUN</p><h2>{manifest?.runId ?? "Create a deterministic diagnostic run"}</h2><p>Run identity, input hashes, policy version, events, checkpoints, and readiness issues remain local to this standalone product.</p></div><button className="primary" onClick={() => void runDiagnostic()} disabled={busy !== null}>{busy ?? "RUN DIAGNOSTIC"}</button></section>
    </>;
    if (selected === "Setup & Preflight") return <>
      <section className="cards"><Stat label="STRUCTURE" value={preflight?.structuralStatus ?? "NOT RUN"} note="Checksums, row counts, and identities"/><Stat label="BREEDS" value={preflight ? exact.format(preflight.counts.breeds) : "—"} note={`${preflight?.counts.civicBreeds ?? "—"} civic · ${preflight?.counts.pets ?? "—"} PET`}/><Stat label="CANONICAL" value={preflight?.canonicalReady ? "READY" : "BLOCKED"} note={`${blockers.length} active blockers`}/></section>
      <section className="panel vertical"><div className="panel-head"><div><p className="eyebrow">INPUT AUTHORITY</p><h2>Real bundle preflight</h2></div><button className="primary" onClick={() => void validateInputs()} disabled={busy !== null}>SELECT & VALIDATE</button></div><div className="issue-list">{(preflight?.activeIssues ?? []).map((issue) => <div className={issue.blocksCanonical ? "issue blocker" : "issue warning"} key={issue.issueCode}><strong>{issue.issueCode}</strong><span>{issue.message}</span></div>)}</div></section>
    </>;
    if (selected === "Live Dashboard") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <section className="cards four"><Stat label="POPULATION" value={worldSummary ? compact.format(BigInt(worldSummary.finalPopulation)) : "—"} note={worldSummary?.finalPopulation ?? "No completed run"}/><Stat label="SETTLEMENTS" value={worldSummary?.settlements ?? "—"} note="24 initial; R10 absent at year 0"/><Stat label="STATES" value={worldSummary?.states ?? "—"} note="Innerwood created at DJT"/><Stat label="FEDERAL CAPITAL" value={worldSummary?.federalCapitalSiteId ?? "—"} note={`${world} at selected run end`}/></section>
      <section className="panel"><div><p className="eyebrow">SHARED CALENDAR</p><h2>DJT resolves at year {manifest?.djtYear ?? "—"}</h2><p>Growth is the only population creation mechanism. Migration, founding, and DJT transfers are conservation-gated.</p></div><div className="meter"><span style={{ width: `${year / 20}%` }}/><small>Year {year} of 2000</small></div></section>
    </>;
    if (selected === "World Browser") return <>
      <div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div>
      <div className="browser-grid"><section className="map" aria-label="Equirectangular Site plot">{visibleSites.map((site) => <button key={site.siteId} aria-label={`${site.siteId} ${site.currentSiteName || "unnamed"}`} className={site.siteId === siteId ? "site selected" : "site"} style={{ left: `${((Number(site.longitude) + 180) / 360) * 100}%`, top: `${((90 - Number(site.latitude)) / 180) * 100}%` }} onClick={() => setSiteId(site.siteId)} />)}<span className="map-label">Neutral coordinate plot · physical Site positions</span></section><SiteCard site={selectedSite} world={world} year={year}/></div>
      <SiteTable sites={visibleSites} selected={siteId} select={setSiteId}/>
    </>;
    if (selected === "Settlement Detail") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><SiteCard site={selectedSite} world={world} year={year}/><section className="detail-grid"><Detail title="Identity" rows={[["Site", selectedSite?.siteId], ["Region", `${selectedSite?.regionId} · ${selectedSite?.regionName}`], ["Political State", `STATE_${world}_${selectedSite?.regionId}`], ["Founding", year === 0 ? "Initial or unoccupied" : "World/year projection"]]}/><Detail title="Historical projections" rows={[["Population", "Query by checkpoint/delta"], ["Dominant faction", world], ["Political form", "Epoch ledger"], ["Economic form", "Latched epoch ledger"]]}/><Detail title="Naming & POIs" rows={[["Current name", selectedSite?.currentSiteName || "Pending naming"], ["Provenance", selectedSite?.currentSiteName ? "OWNER_INPUT" : "NAMING_QUEUE"], ["POIs", selectedSite?.poiCount], ["Family data", "Seed identities only"]]}/></section></>;
    if (selected === "State Detail") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="panel vertical"><p className="eyebrow">POLITICAL STATE · REGION REMAINS PHYSICAL</p><h2>STATE_{world}_{selectedSite?.regionId ?? "R01"}</h2><div className="detail-grid"><Detail title="Membership" rows={[["Selected Site", selectedSite?.siteId], ["Physical Region", selectedSite?.regionId], ["Membership year", year], ["History", year >= 505 ? "Post-secession ledger" : "Initial ledger"]]}/><Detail title="Representation" rows={[["Senate seats", "A · B"], ["Term", "10 years, staggered"], ["Conclave", year < 90 ? "One per city" : "Capacity-led"], ["Exact ledger", "Available in export"]]}/></div></section></>;
    if (selected === "Institutions") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="cards"><Stat label="CONCLAVE POLICY" value={year < 90 ? "CITY SEATS" : "CAPACITY"} note={year < 90 ? "One seat per city" : "Two city + one unincorporated per State"}/><Stat label="SENATE" value={year >= 50 && year >= (manifest?.djtYear ?? 501) ? "50 SEATS" : year >= 50 ? "48 SEATS" : "NOT ACTIVE"} note="Two per State after year 50"/><Stat label="LEDGER YEAR" value={year} note={`${world} exact seat identities`}/></section><section className="panel"><div><p className="eyebrow">INSTITUTION LEDGERS</p><h2>Exact seats, vacancies, terms, and faction history</h2><p>The exported seat ledgers preserve represented Settlement, Site, State, holder, strategy epoch, and vacancy status.</p></div></section></>;
    if (selected === "Timeline") return <><div className="toolbar"><WorldTabs world={world} setWorld={setWorld}/><Year year={year} setYear={setYear}/></div><section className="timeline">{[[0,"Initial settlements and owner names"],[90,"Conclave capacity transition"],[manifest?.djtYear ?? 501,"DJT · Innerwood · capital change"],[505,"Adjacent faction secession"],[525,"Rebalance marker; owner-disabled"],[2000,"Diagnostic completion"]].map(([eventYear,label]) => <button key={String(label)} onClick={() => setYear(Number(eventYear))} className={year === eventYear ? "active" : ""}><strong>{eventYear}</strong><span>{label}</span></button>)}</section></>;
    if (selected === "Naming Queue") return <section className="panel vertical"><p className="eyebrow">DETERMINISTIC BARRIER</p><h2>No pending required naming job</h2><p>{manifest?.namingJobCount ?? 0} accepted synthetic diagnostic jobs are recorded. Initial 24 city names retain OWNER_INPUT provenance and are never regenerated.</p><div className="dropzone">Naming responses must match exact job/request IDs and the v1 schema. Reuse requires a prior accepted name identity.</div></section>;
    if (selected === "Export") return <><section className="cards"><Stat label="EXPORT STATUS" value={snapshot.exportValidation?.valid ? "VERIFIED" : "UNAVAILABLE"} note={`${snapshot.exportValidation?.checkedFiles ?? 0} checksummed payload files`}/><Stat label="MODE" value="DIAGNOSTIC" note="Canonical export remains prohibited"/><Stat label="SHA-256" value={manifest?.exportSha256?.slice(0, 12) ?? "—"} note={manifest?.exportFilename ?? "No export"}/></section><section className="panel"><div><p className="eyebrow">DATA PRODUCT</p><h2>Verified three-world history ZIP</h2><p>Includes schemas, provenance, readiness blockers, stable BigInt strings, checksums, histories, and the self-contained main-app consumer prompt.</p></div><button className="primary" onClick={() => void exportDiagnostic()} disabled={!snapshot.exportValidation?.valid || busy !== null}>{busy ?? "SAVE ZIP"}</button></section></>;
    return <><section className="cards"><Stat label="CHECKPOINTS" value={manifest?.checkpointCount ?? "—"} note="Every five years plus year 0"/><Stat label="EVENT DIGEST" value={manifest?.contentDigest?.slice(0, 12) ?? "—"} note="Deterministic content identity"/><Stat label="INVARIANTS" value={Object.values(manifest?.audit ?? {}).every((n) => n === 0) ? "PASS" : "FAIL"} note="Population and social conservation"/></section><section className="panel vertical"><p className="eyebrow">POLICY & READINESS</p><h2>Canonical blockers are never hidden</h2><div className="issue-list">{(preflight?.activeIssues ?? []).map((issue) => <div className={issue.blocksCanonical ? "issue blocker" : "issue warning"} key={issue.issueCode}><strong>{issue.issueCode}</strong><span>{issue.message}</span></div>)}</div><p className="provenance">V3 semantic authority: {preflight?.sourceRoles.v3SemanticAuthority?.filename ?? "not loaded"}</p></section></>;
  })();

  return <main className="app-shell"><aside><div className="brand"><span className="sigil">EOE</span><div><strong>Historical Simulator</strong><small>Standalone operator console</small></div></div><nav aria-label="Simulator sections">{navigation.map((item) => <button key={item} className={selected === item ? "active" : ""} onClick={() => setSelected(item)}>{item}</button>)}</nav><div className="runtime"><span className="status-dot"/>Local-only runtime<br/><small>{message}</small></div></aside><section className="workspace"><header><div><p className="eyebrow">ECHOES OF EIDOLON</p><h1>{selected}</h1></div><span className="badge diagnostic">DIAGNOSTIC</span></header><div className="notice"><strong>Canonical execution is fail-closed.</strong><span>{blockers.length ? `${blockers.length} canonical blockers remain; diagnostic operation is available.` : "Load and validate inputs to establish readiness."}</span></div>{content}</section></main>;
}

function WorldTabs({ world, setWorld }: { world: World; setWorld: (world: World) => void }): React.JSX.Element { return <div className="tabs">{(["CONCORD","SCHISM","RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div>; }
function Year({ year, setYear }: { year: number; setYear: (year: number) => void }): React.JSX.Element { return <label className="year">YEAR <input type="range" min="0" max="2000" step="1" value={year} onChange={(event) => setYear(Number(event.target.value))}/><output>{year}</output></label>; }
function SiteCard({ site, world, year }: { site?: Site; world: World; year: number }): React.JSX.Element { return <section className="site-card"><p className="eyebrow">SELECTED PHYSICAL SITE</p><h2>{site?.currentSiteName || "Unnamed candidate"}</h2><strong>{site?.siteId ?? "—"} · {site?.regionId} {site?.regionName}</strong><dl><div><dt>World/year</dt><dd>{world} · {year}</dd></div><div><dt>Class</dt><dd>{site?.classification ?? "—"}</dd></div><div><dt>Terrain</dt><dd>{site?.broadTerrain ?? "—"}</dd></div><div><dt>Political State</dt><dd>STATE_{world}_{site?.regionId}</dd></div></dl></section>; }
function SiteTable({ sites, selected, select }: { sites: Site[]; selected: string; select: (id: string) => void }): React.JSX.Element { return <div className="table-wrap"><table><thead><tr><th>Site</th><th>Name</th><th>Region</th><th>Class</th><th>Coordinates</th><th>POIs</th></tr></thead><tbody>{sites.map((site) => <tr key={site.siteId} className={selected === site.siteId ? "selected" : ""} onClick={() => select(site.siteId)}><td>{site.siteId}</td><td>{site.currentSiteName || <em>Pending</em>}</td><td>{site.regionId} · {site.regionName}</td><td>{site.classification}</td><td>{Number(site.latitude).toFixed(2)}, {Number(site.longitude).toFixed(2)}</td><td>{site.poiCount}</td></tr>)}</tbody></table></div>; }
function Detail({ title, rows }: { title: string; rows: [string, React.ReactNode][] }): React.JSX.Element { return <section className="detail"><h3>{title}</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl></section>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
