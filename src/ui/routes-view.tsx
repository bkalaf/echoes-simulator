import React, { useMemo, useState } from "react";
import type { AtlasData, AtlasRoute } from "./atlas-view.js";

const WORLDS = ["CONCORD", "SCHISM", "RUIN"] as const;

export function RoutesView({ data }: { data: AtlasData | null }): React.JSX.Element {
  const [filter, setFilter] = useState("ALL"); const [selectedId, setSelectedId] = useState<string | null>(null);
  const routes = useMemo(() => (data?.routes ?? []).filter((route) => {
    if (filter === "ALL") return true;
    if (filter === "PORTAL") return route.portalCapability;
    if (filter === "TRADE") return route.tradeDesignation;
    if (filter === "UNNAMED") return WORLDS.some((world) => route.worlds[world]?.active && route.worlds[world]?.nameStatus === "PENDING");
    if (filter === "CROSS-WORLD NAME DIFFERENCE") return new Set(WORLDS.map((world) => route.worlds[world]?.name ?? null)).size > 1;
    if (filter === "ROUTE_MODE_UNRESOLVED") return route.primaryMode === "UNRESOLVED";
    return route.primaryMode === filter;
  }), [data, filter]);
  const selected = routes.find((route) => route.corridorId === selectedId) ?? routes[0];
  return <><div className="toolbar"><strong>{data?.routeSummary?.corridorCount ?? 0} physical Region corridors</strong><label>FILTER <select aria-label="Route filter" value={filter} onChange={(event) => setFilter(event.target.value)}>{["ALL","LAND","SEA","AIR","PORTAL","TRADE","UNNAMED","CROSS-WORLD NAME DIFFERENCE","ROUTE_MODE_UNRESOLVED"].map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="route-layout"><section className="route-list" aria-label="Named Routes">{routes.map((route) => <button key={route.corridorId} className={selected?.corridorId === route.corridorId ? "active" : ""} onClick={() => setSelectedId(route.corridorId)}><strong>{route.regionA.regionName} ↔ {route.regionB.regionName}</strong><span>{route.corridorId} · {route.canonicalDirectionality}</span><small>{route.primaryMode} · {route.infrastructureClass}{route.tradeDesignation ? " · TRADE" : ""}{route.portalCapability ? " · PORTAL CAPABLE" : ""}</small></button>)}</section><RouteDetail route={selected} all={data?.routes ?? []}/></div></>;
}

function RouteDetail({ route, all }: { route?: AtlasRoute; all: AtlasRoute[] }): React.JSX.Element {
  if (!route) return <section className="detail"><h3>Route Detail</h3><p>No RouteCorridor matches this filter.</p></section>;
  const names = Object.fromEntries(WORLDS.map((world) => [world, route.worlds[world]?.name ?? null])); const differences = new Set(Object.values(names)).size;
  return <section className="detail route-detail"><p className="eyebrow">ROUTE DETAIL</p><h2>{route.regionA.regionName} ↔ {route.regionB.regionName}</h2><dl><div><dt>Corridor</dt><dd>{route.corridorId}</dd></div><div><dt>Directionality</dt><dd>{route.canonicalDirectionality}</dd></div><div><dt>Portal capability</dt><dd>{route.portalCapability ? "Yes; portal connection remains unnamed" : "No authority"}</dd></div><div><dt>Authority</dt><dd>{route.resolutionAuthority}</dd></div></dl>{WORLDS.map((world) => { const realization = route.worlds[world]; return <article className="route-world" key={world}><h3>{world}</h3><dl><div><dt>Name</dt><dd>{realization?.name ?? "Unresolved"}</dd></div><div><dt>Route ID</dt><dd>{realization?.routeId ?? "Inactive"}</dd></div><div><dt>Mode / class</dt><dd>{realization?.primaryMode ?? route.primaryMode} · {realization?.infrastructureClass ?? route.infrastructureClass}</dd></div><div><dt>Trade</dt><dd>{realization?.tradeDesignation ? "Trade designated" : "Not trade designated"}</dd></div><div><dt>Status</dt><dd>{realization?.nameStatus ?? "INACTIVE"}</dd></div><div><dt>Established</dt><dd>{realization?.establishedYear ?? "—"}</dd></div><div><dt>Endpoint context</dt><dd>{realization?.endpointSettlements ? JSON.stringify(realization.endpointSettlements) : "Unavailable until activation"}</dd></div><div><dt>Sovereign context</dt><dd>{realization?.worldSovereignFaction ?? "—"} · formal crown allegiance {realization?.formalCrownAllegianceAuthority ? "present" : "not asserted"}</dd></div><div><dt>Naming anchor</dt><dd>{realization?.preferredNamingAnchor ?? "None"}</dd></div><div><dt>Name provenance</dt><dd>{realization?.nameProvenance ?? "Pending owner naming"}</dd></div></dl></article>; })}<p>{differences > 1 ? "Cross-world route-name difference is present." : "Cross-world labels are identical or uniformly unresolved."} Inventory: {all.length} corridors.</p></section>;
}
