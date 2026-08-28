import React from "react";

type World = "CONCORD" | "SCHISM" | "RUIN";
export type AtlasPoi = {
  poiId: string; poiType: string; workingLabel: string; nameStatus: string; latitude: number; longitude: number; regionId: string; regionName: string; siteId: string;
  isMagical: boolean; isRuntimeEffectAnchor: boolean; namesByWorld: Partial<Record<World, string>>; coverageByWorld?: Partial<Record<World, { name: string | null; nameStatus: string; namingBehavior: string }>>;
};
export type AtlasRouteRealization = {
  routeId: string; active: boolean; name: string | null; nameStatus: string; establishedYear: number | null; primaryMode: string; infrastructureClass: string;
  tradeDesignation: boolean; preferredNamingAnchor: string | null; endpointSettlements: Record<string, unknown> | null; worldSovereignFaction: string | null;
  formalCrownAllegianceAuthority: unknown; nameProvenance: string | null;
  persistedPrimaryMode?: string | null; persistedInfrastructureClass?: string | null; persistedTradeDesignation?: boolean | null;
};
export type AtlasRoute = {
  corridorId: string;
  regionA: { regionId: string; regionName: string; latitude: number; longitude: number };
  regionB: { regionId: string; regionName: string; latitude: number; longitude: number };
  canonicalDirectionality: string; portalCapability: boolean; primaryMode: string; infrastructureClass: string; tradeDesignation: boolean; resolutionAuthority: string;
  semanticReadiness: "READY" | "NOT_READY"; classificationStatus: string; classificationAuthorityVersion: string | null; ownerEvidenceRef: string | null;
  worlds: Partial<Record<World, AtlasRouteRealization>>;
};
export type AtlasSettlement = { settlementId: string; siteId: string; name: string | null; dominantFaction: World | null; latitude: number; longitude: number };
export type AtlasData = { imageUrl: string; pois: AtlasPoi[]; settlementsByWorld?: Partial<Record<World, AtlasSettlement[]>>; routes?: AtlasRoute[]; routeSummary?: { corridorCount: number; directedEdgeCount: number } };

export function AtlasView({ data, world, selectedPoiId, selectedRouteId, setWorld, selectPoi, selectRoute }: { data: AtlasData | null; world: World; selectedPoiId: string | null; selectedRouteId: string | null; setWorld: (world: World) => void; selectPoi: (poiId: string) => void; selectRoute: (routeId: string | null) => void }): React.JSX.Element {
  const [layers, setLayers] = React.useState({ settlements: true, pois: true, routes: true, portals: true });
  const selectedPoi = data?.pois.find((poi) => poi.poiId === selectedPoiId) ?? data?.pois[0];
  const selectedRoute = data?.routes?.find((route) => route.corridorId === selectedRouteId);
  return <>
    <div className="toolbar atlas-toolbar"><div className="tabs">{(["CONCORD", "SCHISM", "RUIN"] as World[]).map((item) => <button className={world === item ? "active" : ""} onClick={() => setWorld(item)} key={item}>{item}</button>)}</div><div className="layer-toggles">{([['settlements','Settlements'],['pois','Physical POIs'],['routes','Routes'],['portals','Portal Links']] as const).map(([key, text]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers((prior) => ({ ...prior, [key]: event.target.checked }))}/>{text}</label>)}</div></div>
    {!data ? <section className="panel vertical"><h2>Loading master Atlas…</h2></section> : <div className="atlas-layout">
      <section className="atlas-stage" aria-label={`Master Atlas layers for ${world}`}>
        <img src={data.imageUrl} alt="Master Atlas world map"/>
        <svg className="route-overlay" viewBox="0 0 1000 500" preserveAspectRatio="none">{(data.routes ?? []).filter((route) => route.worlds[world]?.active).flatMap((route) => {
          const realization = route.worlds[world];
          const x1 = ((route.regionA.longitude + 180) / 360) * 1000; const y1 = ((90 - route.regionA.latitude) / 180) * 500;
          const x2 = ((route.regionB.longitude + 180) / 360) * 1000; const y2 = ((90 - route.regionB.latitude) / 180) * 500;
          const elements: React.JSX.Element[] = [];
          if (layers.routes && realization?.primaryMode !== "NONE") elements.push(<line key={`${route.corridorId}-physical`} role="button" tabIndex={0} aria-label={`${route.corridorId} route overlay`} className={`route-line mode-${realization?.primaryMode.toLowerCase()}${selectedRouteId === route.corridorId ? " selected" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} onClick={() => selectRoute(route.corridorId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") selectRoute(route.corridorId); }}/>);
          if (layers.portals && route.portalCapability) elements.push(<line key={`${route.corridorId}-portal`} role="button" tabIndex={0} aria-label={`${route.corridorId} portal link overlay`} className={`route-line mode-portal${selectedRouteId === route.corridorId ? " selected" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} onClick={() => selectRoute(route.corridorId)}/>);
          if (selectedRouteId === route.corridorId) elements.push(<text key={`${route.corridorId}-label`} className="route-map-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2}>{realization?.name ?? route.corridorId}</text>);
          return elements;
        })}</svg>
        {selectedRoute && <><span className="region-endpoint selected" aria-label={`${selectedRoute.regionA.regionId} endpoint Region`} style={{ left: `${((selectedRoute.regionA.longitude + 180) / 360) * 100}%`, top: `${((90 - selectedRoute.regionA.latitude) / 180) * 100}%` }}/><span className="region-endpoint selected" aria-label={`${selectedRoute.regionB.regionId} endpoint Region`} style={{ left: `${((selectedRoute.regionB.longitude + 180) / 360) * 100}%`, top: `${((90 - selectedRoute.regionB.latitude) / 180) * 100}%` }}/></>}
        {layers.settlements && (data.settlementsByWorld?.[world] ?? []).map((settlement) => <span key={settlement.settlementId} aria-label={`${settlement.name ?? settlement.settlementId} Settlement`} className={`atlas-settlement faction-fill-${settlement.dominantFaction?.toLowerCase() ?? "none"}`} style={{ left: `${((settlement.longitude + 180) / 360) * 100}%`, top: `${((90 - settlement.latitude) / 180) * 100}%` }}/>) }
        {layers.pois && data.pois.map((poi) => <button key={poi.poiId} aria-label={`${poi.poiId} ${poi.namesByWorld[world] ?? poi.workingLabel}`} title={poi.namesByWorld[world] ?? poi.workingLabel} className={`poi-marker${!selectedRoute && poi.poiId === selectedPoi?.poiId ? " selected" : ""}${poi.isMagical ? " magical" : ""}`} style={{ left: `${((poi.longitude + 180) / 360) * 100}%`, top: `${((90 - poi.latitude) / 180) * 100}%` }} onClick={() => { selectRoute(null); selectPoi(poi.poiId); }}/>) }
      </section>
      {selectedRoute
        ? <AtlasRouteDetail route={selectedRoute} world={world}/>
        : <PoiDetail poi={selectedPoi} world={world}/>}
    </div>}
  </>;
}

function PoiDetail({ poi, world }: { poi?: AtlasPoi; world: World }): React.JSX.Element {
  return <section className="site-card atlas-poi-detail"><p className="eyebrow">SELECTED POINT OF INTEREST</p><h2>{poi?.namesByWorld[world] ?? poi?.workingLabel ?? "—"}</h2><strong>{poi?.poiId} · {poi?.poiType}</strong><dl><div><dt>World</dt><dd>{world}</dd></div><div><dt>Site</dt><dd>{poi?.siteId}</dd></div><div><dt>Region</dt><dd>{poi?.regionId} · {poi?.regionName}</dd></div><div><dt>Coordinates</dt><dd>{poi ? `${poi.latitude.toFixed(2)}, ${poi.longitude.toFixed(2)}` : "—"}</dd></div><div><dt>Name status</dt><dd>{poi?.coverageByWorld?.[world]?.nameStatus ?? poi?.nameStatus}</dd></div><div><dt>Naming behavior</dt><dd>{poi?.coverageByWorld?.[world]?.namingBehavior ?? "—"}</dd></div><div><dt>Magical</dt><dd>{poi?.isMagical ? "Yes" : "No"}</dd></div><div><dt>Runtime effect</dt><dd>{poi?.isRuntimeEffectAnchor ? "Anchor" : "None"}</dd></div></dl></section>;
}

function AtlasRouteDetail({ route, world }: { route: AtlasRoute; world: World }): React.JSX.Element {
  const realization = route.worlds[world];
  return <section className="site-card atlas-poi-detail"><p className="eyebrow">SELECTED ROUTE</p><h2>{realization?.name ?? route.corridorId}</h2><strong>{world} · {route.corridorId}</strong><dl><div><dt>Regions</dt><dd>{route.regionA.regionId} {route.regionA.regionName} ↔ {route.regionB.regionId} {route.regionB.regionName}</dd></div><div><dt>Effective mode / class</dt><dd>{realization?.primaryMode ?? route.primaryMode} · {realization?.infrastructureClass ?? route.infrastructureClass}</dd></div><div><dt>Classification</dt><dd>{route.semanticReadiness} · {route.classificationAuthorityVersion ?? "owner decision required"}</dd></div><div><dt>Trade / portal</dt><dd>{realization?.tradeDesignation ? "Trade designated" : "Not trade designated"} · {route.portalCapability ? "Portal capable" : "No portal authority"}</dd></div><div><dt>Established</dt><dd>{realization?.establishedYear ?? "Inactive"}</dd></div><div><dt>Name status</dt><dd>{realization?.nameStatus ?? "INACTIVE"}</dd></div><div><dt>Naming anchor</dt><dd>{realization?.preferredNamingAnchor ?? "None"}</dd></div><div><dt>Name provenance</dt><dd>{realization?.nameProvenance ?? "Pending owner naming"}</dd></div></dl></section>;
}
