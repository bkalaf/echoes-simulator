import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";

const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });

const radians = (degrees: number): number => degrees * Math.PI / 180;
const distanceKm = (latA: number, lonA: number, latB: number, lonB: number): number => {
  const latitudeDelta = radians(latB - latA); const longitudeDelta = radians(lonB - lonA);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
};

const region = (regionId: string) => {
  const sites = canonical.sites.filter((site) => site.regionId === regionId);
  const continents = [...new Set(sites.map((site) => site.continent).filter(Boolean))];
  const denominator = sites.length || 1;
  return {
    name: sites[0]?.regionName ?? regionId,
    continent: continents.length === 1 ? continents[0]! : "CONTINENT UNRESOLVED",
    latitude: sites.reduce((sum, site) => sum + site.latitude, 0) / denominator,
    longitude: sites.reduce((sum, site) => sum + site.longitude, 0) / denominator,
    sites,
    terrain: [...new Set(sites.flatMap((site) => [...site.terrainBroad, ...site.terrainSpecific]))].sort(),
    maximumQuality: Math.max(...sites.map((site) => site.quality ?? 0), 0),
  };
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
  const sameContinent = a.continent === b.continent && a.continent !== "CONTINENT UNRESOLVED";
  const distance = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  const waterEvidence = [...a.terrain, ...b.terrain].filter((value) => ["OCEAN", "COASTAL", "ESTUARY", "BEACH"].includes(value));
  const difficultLand = [...a.terrain, ...b.terrain].filter((value) => ["ALPINE", "MOUNTAIN", "GLACIER", "POLAR_ICE", "DESERT", "BADLANDS"].some((marker) => value.includes(marker)));
  const recommendedPrimaryMode = sameContinent ? "LAND" : waterEvidence.length > 0 ? "SEA" : "AIR";
  const recommendedInfrastructureClass = recommendedPrimaryMode === "LAND"
    ? distance <= 1500 && Math.min(a.maximumQuality, b.maximumQuality) >= 500 ? "HIGHWAY" : "ROAD"
    : recommendedPrimaryMode === "SEA" ? "SEA_ROUTE" : "AIRSHIP_ROUTE";
  const recommendedTradeDesignation = corridor.canonicalDirectionality === "BIDIRECTIONAL" && initial.length > 0;
  const confidence = sameContinent && difficultLand.length === 0 ? "HIGH" : waterEvidence.length > 0 ? "MEDIUM" : "LOW";
  const recommendationEvidence = [
    `${sameContinent ? "same-continent" : "intercontinental"} endpoints`, `centroid distance ${distance} km`,
    waterEvidence.length ? `water evidence ${[...new Set(waterEvidence)].join("/")}` : "no explicit coastal/ocean endpoint terrain",
    difficultLand.length ? `difficult-land evidence ${[...new Set(difficultLand)].slice(0, 8).join("/")}` : "no dominant difficult-land marker",
    `${initial.length} occupied year-0 world/Settlement endpoint records`, "recommendation only; owner decision required",
  ].join("; ");
  return {
    corridorId: corridor.corridorId,
    regionAId: corridor.regionAId, regionAName: a.name, regionAContinent: a.continent,
    regionBId: corridor.regionBId, regionBName: b.name, regionBContinent: b.continent,
    directionality: corridor.canonicalDirectionality, canonicalDirectedEdges: directed.join(" | "),
    geographicRelationship: `${sameContinent ? "SAME-CONTINENT" : "INTERCONTINENTAL"}; centroid A ${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}; centroid B ${b.latitude.toFixed(4)}, ${b.longitude.toFixed(4)}; great-circle ${distance} km`,
    nearbySitesSettlements: initial.map((settlement) => `${settlement.worldKey}:${settlement.settlementId}@${settlement.siteId}`).join(" | "),
    nearbySites: [...a.sites, ...b.sites].map((site) => `${site.siteId}${site.currentName ? ` (${site.currentName})` : ""}`).join(" | "),
    nearbyPois: pois.map((poi) => `${poi.poiId} [${poi.poiType}]${poi.workingLabel ? ` working reference: ${poi.workingLabel}` : ""}`).join(" | "),
    terrainEvidence: `${corridor.regionAId}: ${a.terrain.join(" | ")} || ${corridor.regionBId}: ${b.terrain.join(" | ")}`,
    currentAuthority: `${corridor.resolutionAuthority}; persisted classification ${corridor.primaryMode}/${corridor.infrastructureClass}; portal=${corridor.portalCapability}; trade=${corridor.tradeDesignation}`,
    recommendedPrimaryMode, recommendedInfrastructureClass, recommendedPortalCapability: "FALSE", recommendedTradeDesignation: String(recommendedTradeDesignation).toUpperCase(),
    recommendationEvidence, confidence,
    ownerDecisionStatus: "", ownerPrimaryMode: "", ownerInfrastructureClass: "", ownerPortalCapability: "", ownerTradeDesignation: "", ownerEvidenceRef: "",
  };
});

if (rows.length !== 38 || rows.length !== canonical.routeCorridors.length) throw new Error(`Route worksheet must cover all 38 corridors; found ${rows.length}`);
const columns: readonly [keyof typeof rows[number], string][] = [
  ["corridorId","corridorId"], ["regionAId","Region A"], ["regionAName","Region A name"], ["regionAContinent","Region A continent"],
  ["regionBId","Region B"], ["regionBName","Region B name"], ["regionBContinent","Region B continent"], ["directionality","directionality"],
  ["canonicalDirectedEdges","canonical directed edges"], ["geographicRelationship","same-continent vs intercontinental and coordinates/geographic relationship"],
  ["nearbyPois","nearby POIs"], ["nearbySitesSettlements","nearby occupied Sites/Settlements"], ["nearbySites","nearby canonical Sites"],
  ["terrainEvidence","terrain evidence"], ["currentAuthority","current authority"], ["recommendedPrimaryMode","recommended primaryMode"],
  ["recommendedInfrastructureClass","recommended infrastructureClass"], ["recommendedPortalCapability","recommended portalCapability"],
  ["recommendedTradeDesignation","recommended tradeDesignation"], ["recommendationEvidence","recommendationEvidence"], ["confidence","confidence"],
  ["ownerDecisionStatus","ownerDecisionStatus"], ["ownerPrimaryMode","ownerPrimaryMode"], ["ownerInfrastructureClass","ownerInfrastructureClass"],
  ["ownerPortalCapability","ownerPortalCapability"], ["ownerTradeDesignation","ownerTradeDesignation"], ["ownerEvidenceRef","ownerEvidenceRef"],
];
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [columns.map(([, header]) => csvCell(header)).join(","), ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(","))].join("\n") + "\n";
writeFileSync(resolve(outputDirectory, "route-classification-worksheet.csv"), csv, "utf8");
writeFileSync(resolve(outputDirectory, "route-classification-worksheet-data.json"), `${JSON.stringify({ schemaVersion: "echoes-route-classification-worksheet-v2", corridorCount: rows.length, allowedClassifications: ["LAND / ROAD", "LAND / HIGHWAY", "SEA / SEA_ROUTE", "AIR / AIRSHIP_ROUTE", "PORTAL_ONLY / PORTAL_ONLY"], rows }, null, 2)}\n`, "utf8");
const markdown = [
  "# V5 Route Classification Worksheet", "", `Runtime graph inventory: **${rows.length} RouteCorridors**. Recommendations are non-authoritative.`, "",
  "Allowed owner classifications: `LAND / ROAD`, `LAND / HIGHWAY`, `SEA / SEA_ROUTE`, `AIR / AIRSHIP_ROUTE`, `PORTAL_ONLY / PORTAL_ONLY`.", "",
  "Set `ownerDecisionStatus` to `OWNER_VALUES` with every owner field explicit, or to `APPROVE_RECOMMENDATION` to intentionally copy the recommendation. Blank rows remain unresolved. Generic `APPROVED` is invalid.", "",
  "Route decisions are a non-causal overlay. They do not overwrite persisted WorldRoutes, RouteEstablished events, checkpoints, connectivity, or causal hashes.", "",
  "| Corridor | Region A | Region B | Relationship | Recommendation | Confidence | Owner decision |", "|---|---|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.corridorId} | ${row.regionAId} ${row.regionAName} (${row.regionAContinent}) | ${row.regionBId} ${row.regionBName} (${row.regionBContinent}) | ${row.geographicRelationship} | ${row.recommendedPrimaryMode} / ${row.recommendedInfrastructureClass}; portal ${row.recommendedPortalCapability}; trade ${row.recommendedTradeDesignation} | ${row.confidence} |  |`),
  "", "The CSV/XLSX companions contain complete Site, Settlement, POI, terrain, recommendation-evidence, and explicit owner-authority columns.",
].join("\n");
writeFileSync(resolve(outputDirectory, "route-classification-worksheet.md"), `${markdown}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ corridorCount: rows.length, csv: resolve(outputDirectory, "route-classification-worksheet.csv"), json: resolve(outputDirectory, "route-classification-worksheet-data.json"), markdown: resolve(outputDirectory, "route-classification-worksheet.md") })}\n`);
