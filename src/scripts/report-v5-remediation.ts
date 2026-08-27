import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPoiCoverage } from "../core/atlas/coverage.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { bootstrapWorldV5 } from "../core/v5/bootstrap.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, diagnosticCandidateOwnerInputsV1 } from "../core/v5/config.js";
import { buildReadModelV1 } from "../core/v5/read-model.js";
import { normalizeSeed } from "../core/v5/random.js";
import { buildRouteCoverageReadModel } from "../core/v5/routes.js";
import type { NamingRequestV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const ownerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const states = {} as Record<WorldKey, WorldStateV5>;
const requests = {} as Record<WorldKey, NamingRequestV5[]>;
for (const world of WORLDS) {
  const boot = bootstrapWorldV5({ worldKey: world, canonical, ownerInputs, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: normalizeSeed("EIDOLON_V5_REMEDIATION_AUDIT"), mode: "DIAGNOSTIC" });
  states[world] = boot.state;
  requests[world] = boot.namingRequests;
}
const poi = buildPoiCoverage(canonical, states, {}, requests);
const routes = buildRouteCoverageReadModel(canonical, states, {}, requests);
const economic = Object.fromEntries(WORLDS.map((world) => {
  const read = buildReadModelV1(states[world], canonical, DEFAULT_MECHANICS_VARIABLES_V1);
  const occupied = read.settlements.filter((settlement) => BigInt(settlement.population) > 0n);
  return [world, { occupiedSettlementCount: occupied.length, resolvedEconomicFormCount: occupied.filter((settlement) => settlement.supportedEconomicForm.length > 0).length, unresolvedSettlementIds: occupied.filter((settlement) => !settlement.supportedEconomicForm).map((settlement) => settlement.settlementId) }];
}));
const routeModeCounts = Object.fromEntries(["LAND", "SEA", "AIR", "NONE", "UNRESOLVED"].map((mode) => [mode, routes.rows.filter((row) => row.primaryMode === mode).length]));
const routeReport = {
  ...routes,
  modeCounts: routeModeCounts,
  portalOnlyCorridors: routes.rows.filter((row) => row.portalCapability && row.primaryMode === "NONE").length,
  portalAndPhysicalCorridors: routes.rows.filter((row) => row.portalCapability && !["NONE", "UNRESOLVED"].includes(row.primaryMode)).length,
  tradeDesignatedCorridors: routes.rows.filter((row) => row.tradeDesignation).length,
  worldRoutesActive: Object.fromEntries(WORLDS.map((world) => [world, states[world].worldRoutes.length])),
  namedWorldRoutes: Object.fromEntries(WORLDS.map((world) => [world, routes.rows.filter((row) => row.worlds[world]?.nameStatus === "ACCEPTED").length])),
  unresolvedRouteNames: Object.fromEntries(WORLDS.map((world) => [world, routes.rows.filter((row) => row.worlds[world]?.nameStatus === "PENDING").length])),
  crossWorldRouteNameDifferences: routes.rows.filter((row) => new Set(WORLDS.map((world) => row.worlds[world]?.name ?? null)).size > 1).length,
};
const report = { schemaVersion: "echoes-v5-remediation-coverage-v1", generatedFromCanonicalBundleHash: canonical.canonicalBundleHash, poi: { summary: poi.summary, rows: poi.rows }, hydrology: poi.hydrology, routes: routeReport, economicForms: economic, poi080: poi.rows.find((row) => row.poiId === "POI-080") ?? null };
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "coverage-report.json"), `${canonicalJson(report)}\n`);
writeFileSync(resolve(outputDirectory, "poi-coverage.json"), `${canonicalJson({ summary: poi.summary, rows: poi.rows })}\n`);
writeFileSync(resolve(outputDirectory, "hydrology-coverage.json"), `${canonicalJson(poi.hydrology)}\n`);
writeFileSync(resolve(outputDirectory, "route-coverage.json"), `${canonicalJson(routeReport)}\n`);
writeFileSync(resolve(outputDirectory, "economic-form-coverage.json"), `${canonicalJson(economic)}\n`);
process.stdout.write(`${canonicalJson({ outputDirectory, poi: poi.summary, hydrology: poi.hydrology, routes: routeReport, economicForms: economic })}\n`);
