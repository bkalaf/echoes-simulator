import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";

const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });

const region = (regionId: string) => {
  const sites = canonical.sites.filter((site) => site.regionId === regionId);
  const continents = [...new Set(sites.map((site) => site.continent).filter(Boolean))];
  return { name: sites[0]?.regionName ?? regionId, continent: continents.length === 1 ? continents[0]! : "CONTINENT UNRESOLVED", sites };
};
const edge = new Set(canonical.regions.flatMap((row) => row.directedAdjacentRegionIds.map((destination) => `${row.regionId}>${destination}`)));
const rows = canonical.routeCorridors.map((corridor) => {
  const a = region(corridor.regionAId); const b = region(corridor.regionBId);
  const directed = [`${corridor.regionAId}>${corridor.regionBId}`, `${corridor.regionBId}>${corridor.regionAId}`].filter((item) => edge.has(item));
  const initial = canonical.initialSettlements.filter((settlement) => {
    const site = canonical.sites.find((candidate) => candidate.siteId === settlement.siteId);
    return site?.regionId === corridor.regionAId || site?.regionId === corridor.regionBId;
  });
  const pois = canonical.physicalPois.filter((poi) => poi.regionId === corridor.regionAId || poi.regionId === corridor.regionBId);
  return {
    corridorId: corridor.corridorId,
    regionAId: corridor.regionAId, regionAName: a.name, regionAContinent: a.continent,
    regionBId: corridor.regionBId, regionBName: b.name, regionBContinent: b.continent,
    canonicalDirectedEdges: directed.join(" | "), geography: a.continent === b.continent && a.continent !== "CONTINENT UNRESOLVED" ? "SAME-CONTINENT" : a.continent !== "CONTINENT UNRESOLVED" && b.continent !== "CONTINENT UNRESOLVED" ? "INTERCONTINENTAL" : "CONTINENT UNRESOLVED",
    nearbySites: [...a.sites, ...b.sites].map((site) => `${site.siteId}${site.currentName ? ` (${site.currentName})` : ""}`).join(" | "),
    foundedSettlements: initial.map((settlement) => `${settlement.worldKey}:${settlement.settlementId}@${settlement.siteId}`).join(" | "),
    nearbyPhysicalPois: pois.map((poi) => `${poi.poiId} [${poi.poiType}]${poi.workingLabel ? ` working reference: ${poi.workingLabel}` : ""}`).join(" | "),
    currentRouteMode: `${corridor.primaryMode} / ${corridor.infrastructureClass}`, portalCapability: String(corridor.portalCapability), tradeDesignation: String(corridor.tradeDesignation),
    proposedPrimaryMode: "", proposedInfrastructureClass: "", proposedPortalCapability: "", proposedTradeDesignation: "",
    notes: `${corridor.resolutionAuthority}; allowed classifications: LAND / ROAD, LAND / HIGHWAY, SEA / SEA_ROUTE, AIR / AIRSHIP_ROUTE, PORTAL_ONLY. Do not infer unresolved modes.`,
  };
});

if (rows.length !== canonical.routeCorridors.length) throw new Error("Route worksheet row count does not match the runtime graph corridor inventory");
const columns: readonly [keyof typeof rows[number], string][] = [
  ["corridorId","corridorId"],["regionAId","Region A"],["regionAName","Region A name"],["regionAContinent","Region A continent"],["regionBId","Region B"],["regionBName","Region B name"],["regionBContinent","Region B continent"],["canonicalDirectedEdges","canonical directed edges"],["geography","same-continent / intercontinental"],["nearbySites","nearby Sites"],["foundedSettlements","founded Settlements where available"],["nearbyPhysicalPois","nearby physical POIs"],["currentRouteMode","current route mode"],["portalCapability","portal capability"],["tradeDesignation","trade designation"],["proposedPrimaryMode","proposed owner primaryMode"],["proposedInfrastructureClass","proposed owner infrastructureClass"],["proposedPortalCapability","proposed owner portalCapability"],["proposedTradeDesignation","proposed owner tradeDesignation"],["notes","notes"],
];
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [columns.map(([, header]) => csvCell(header)).join(","), ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(","))].join("\n") + "\n";
writeFileSync(resolve(outputDirectory, "route-classification-worksheet.csv"), csv, "utf8");

const markdown = [`# V5 Route Classification Worksheet`, "", `Runtime graph inventory: **${rows.length} RouteCorridors**. No count is hard-coded; this artifact is generated from the canonical graph.`, "", `Allowed owner classifications: \`LAND / ROAD\`, \`LAND / HIGHWAY\`, \`SEA / SEA_ROUTE\`, \`AIR / AIRSHIP_ROUTE\`, \`PORTAL_ONLY\`.`, "", `Unresolved rows are intentionally blank in proposed owner fields.`, "", `| Corridor | Region A | Region B | Geography | Directed edges | Current mode | Portal | Trade | Proposed owner classification | Notes |`, `|---|---|---|---|---|---|---:|---:|---|---|`, ...rows.map((row) => `| ${row.corridorId} | ${row.regionAId} ${row.regionAName} (${row.regionAContinent}) | ${row.regionBId} ${row.regionBName} (${row.regionBContinent}) | ${row.geography} | ${row.canonicalDirectedEdges} | ${row.currentRouteMode} | ${row.portalCapability} | ${row.tradeDesignation} |  | ${row.notes} |`), "", `The CSV companion contains nearby Sites, founded Settlement availability, and nearby physical POI context for owner review.`].join("\n");
writeFileSync(resolve(outputDirectory, "route-classification-worksheet.md"), markdown, "utf8");
process.stdout.write(`${JSON.stringify({ corridorCount: rows.length, csv: resolve(outputDirectory, "route-classification-worksheet.csv"), markdown: resolve(outputDirectory, "route-classification-worksheet.md") })}\n`);
