import React, { useMemo } from "react";

type World = "CONCORD" | "SCHISM" | "RUIN";

export type BreedCatalogEntry = {
  breedId: string; name: string; populationKind: string; speciesId: string | null; speciesName: string | null;
  scientificName: string | null; groupId: string | null; cultureId: string | null;
  factionObject: Record<World, number>; dominantFaction: World[];
  primaryDeity: string | null; provisionalDeity: string | null; deityClassificationStatus: "CLASSIFIED" | "REVIEW_REQUIRED";
};
type Point = { year: number; population: string };
type City = { settlementId: string; siteId: string; name: string; population: string };
export type BreedPopulationView = {
  runId: string; breedId: string; requestedYear: number;
  series: Record<World, Point[]>;
  cities: Record<World, { sampledYear: number | null; rows: City[] }>;
};

export function filterBreedCatalog(catalog: readonly BreedCatalogEntry[], query: string): BreedCatalogEntry[] {
  const normalizeSearch = (value: string): string => value.toLocaleLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
  const needle = normalizeSearch(query);
  if (!needle) return [...catalog];
  return catalog.filter((breed) => [breed.name, breed.breedId, breed.speciesName, breed.scientificName, breed.speciesId, breed.groupId, breed.cultureId, breed.populationKind, breed.primaryDeity, breed.provisionalDeity]
    .some((value) => value ? normalizeSearch(value).includes(needle) : false));
}

export function selectableBreedCatalog(catalog: readonly BreedCatalogEntry[], query: string, selectedBreedId: string | null): BreedCatalogEntry[] {
  const matches = filterBreedCatalog(catalog, query);
  if (!selectedBreedId || matches.some((breed) => breed.breedId === selectedBreedId)) return matches;
  const selected = catalog.find((breed) => breed.breedId === selectedBreedId);
  return selected ? [...matches, selected] : matches;
}

const WORLDS: World[] = ["CONCORD", "SCHISM", "RUIN"];
const colors: Record<World, string> = { CONCORD: "#246edb", SCHISM: "#e6bd31", RUIN: "#c9443b" };
const exact = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function ratio(value: bigint, maximum: bigint): number { return maximum === 0n ? 0 : Number(value * 10_000n / maximum) / 10_000; }

function TrendChart({ series }: { series: BreedPopulationView["series"] }): React.JSX.Element {
  const points = WORLDS.flatMap((world) => series[world]);
  const maximum = points.reduce((max, point) => BigInt(point.population) > max ? BigInt(point.population) : max, 0n);
  const maxYear = Math.max(1, ...points.map((point) => point.year));
  return <section className="chart-card breed-trend"><div className="chart-heading"><div><p className="eyebrow">ALL THREE WORLDS</p><h3>Breed population over time</h3></div><div className="chart-legend">{WORLDS.map((world) => <span key={world}><i style={{ background: colors[world] }}/>{world}</span>)}</div></div>
    {points.length === 0 ? <p>No persisted checkpoint summaries are available.</p> : <svg viewBox="0 0 900 320" role="img" aria-label="Breed population over time for all three worlds">
      <line x1="55" y1="15" x2="55" y2="280"/><line x1="55" y1="280" x2="880" y2="280"/>
      <text x="55" y="305">0</text><text x="850" y="305">{maxYear}</text><text x="60" y="28">{compact.format(maximum)}</text>
      {WORLDS.map((world) => <polyline key={world} stroke={colors[world]} points={series[world].map((point) => `${55 + (point.year / maxYear) * 825},${280 - ratio(BigInt(point.population), maximum) * 255}`).join(" ")}/>) }
    </svg>}
  </section>;
}

function CityBars({ world, sampledYear, rows }: { world: World; sampledYear: number | null; rows: City[] }): React.JSX.Element {
  const shown = rows.slice(0, 15);
  const maximum = shown.reduce((max, row) => BigInt(row.population) > max ? BigInt(row.population) : max, 0n);
  return <section className="chart-card city-bars"><div className="chart-heading"><div><p className="eyebrow">{world} · YEAR {sampledYear ?? "—"}</p><h3>Population by City</h3></div><span>{rows.length > shown.length ? `Top ${shown.length} of ${rows.length}` : `${rows.length} populated`}</span></div>
    <div className="bar-list">{shown.map((row) => <div className="bar-row" key={row.settlementId} title={`${row.name}: ${exact.format(BigInt(row.population))}`}><span>{row.name}</span><div><i style={{ width: `${ratio(BigInt(row.population), maximum) * 100}%`, background: colors[world] }}/></div><strong>{compact.format(BigInt(row.population))}</strong></div>)}{shown.length === 0 && <p>No population for this Breed at the selected checkpoint.</p>}</div>
  </section>;
}

export function BreedDetail({ catalog, query, selectedBreedId, population, loading, onQuery, onSelect }: {
  catalog: BreedCatalogEntry[]; query: string; selectedBreedId: string | null; population: BreedPopulationView | null; loading: boolean;
  onQuery: (query: string) => void; onSelect: (breedId: string) => void;
}): React.JSX.Element {
  const selected = catalog.find((breed) => breed.breedId === selectedBreedId) ?? null;
  const matches = useMemo(() => filterBreedCatalog(catalog, query), [catalog, query]);
  const selectable = useMemo(() => selectableBreedCatalog(catalog, query, selectedBreedId), [catalog, query, selectedBreedId]);
  const deity = selected?.primaryDeity ?? selected?.provisionalDeity ?? null;
  return <>
    <section className="breed-finder"><label>SEARCH BREEDS<input aria-label="Search Breeds" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Name, scientific name, deity, common name, ID…"/></label><label>BREED<select aria-label="Select Breed" value={selectedBreedId ?? ""} onChange={(event) => onSelect(event.target.value)}><option value="" disabled>Select a Breed</option>{selectable.map((breed) => <option value={breed.breedId} key={breed.breedId}>{breed.name} · {breed.scientificName ?? breed.speciesName ?? breed.breedId}</option>)}</select></label><small>{matches.length} match(es){selectable.length > matches.length ? " + current selection" : ""} · {catalog.length.toLocaleString()} canonical Breeds</small></section>
    {selected && <section className="breed-identity"><div><p className="eyebrow">CANONICAL BREED</p><h2>{selected.name}</h2><em>{selected.scientificName ?? selected.speciesName ?? "No scientific name recorded"}</em></div><dl><div><dt>Breed ID</dt><dd>{selected.breedId}</dd></div><div><dt>Species</dt><dd>{selected.speciesName ?? selected.speciesId ?? "—"}</dd></div><div><dt>Population kind</dt><dd>{selected.populationKind}</dd></div><div><dt>Culture / Group</dt><dd>{selected.cultureId ?? "—"} · {selected.groupId ?? "—"}</dd></div><div><dt>Primary deity</dt><dd>{deity ?? "—"}{selected.deityClassificationStatus === "REVIEW_REQUIRED" ? " · REVIEW REQUIRED" : ""}</dd></div><div><dt>Faction points</dt><dd>Concord {selected.factionObject.CONCORD} · Schism {selected.factionObject.SCHISM} · Ruin {selected.factionObject.RUIN}</dd></div><div><dt>Dominant faction</dt><dd>{selected.dominantFaction.length ? selected.dominantFaction.join(" / ") : "Not civically classified"}</dd></div></dl></section>}
    {loading && <section className="panel vertical"><h2>Building compact historical Breed index…</h2><p>The simulation remains untouched. Existing compressed checkpoints are being summarized off the UI thread once.</p></section>}
    {!loading && population && <><TrendChart series={population.series}/><div className="breed-city-grid">{WORLDS.map((world) => <CityBars key={world} world={world} {...population.cities[world]}/>)}</div></>}
    {!loading && selected && !population && <section className="panel vertical"><h2>No canonical run population is available</h2><p>Select a persisted canonical run to view historical Breed populations.</p></section>}
  </>;
}
