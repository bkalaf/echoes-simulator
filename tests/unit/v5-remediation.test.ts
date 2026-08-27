import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPoiCoverage } from "../../src/core/atlas/coverage.js";
import { bootstrapWorldV5 } from "../../src/core/v5/bootstrap.js";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { buildReadModelV1 } from "../../src/core/v5/read-model.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { buildRouteCoverageReadModel } from "../../src/core/v5/routes.js";
import { DEFAULT_NAMING_BEHAVIOR_V5 } from "../../src/core/v5/naming.js";
import type { WorldKey } from "../../src/core/v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, {}])));
const boots = Object.fromEntries(WORLDS.map((world) => [world, bootstrapWorldV5({ worldKey: world, canonical, ownerInputs: owner, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: normalizeSeed("V5_REMEDIATION_TEST"), mode: "DIAGNOSTIC" })])) as Record<WorldKey, ReturnType<typeof bootstrapWorldV5>>;

describe("V5 materialization remediation", () => {
  it("associates POI-080 with Ascendancy at canonical SITE-036/R06 in every derived surface", () => {
    const poi = canonical.physicalPois.find((candidate) => candidate.poiId === "POI-080");
    expect(poi).toMatchObject({ workingLabel: "Highcourt Isle", siteId: "SITE-036", regionId: "R06", regionName: "Highcourt" });
    const coverage = buildPoiCoverage(canonical, Object.fromEntries(WORLDS.map((world) => [world, boots[world].state])), {}, Object.fromEntries(WORLDS.map((world) => [world, boots[world].namingRequests])));
    expect(coverage.summary).toMatchObject({ totalPois: 92, wrongRegionSiteAssociations: [], foundedSettlementPoisMissingNamingRequests: { CONCORD: [], SCHISM: [], RUIN: [] } });
    expect(coverage.rows.find((row) => row.poiId === "POI-080")?.worlds).toEqual(expect.objectContaining({ CONCORD: expect.objectContaining({ nameStatus: "PENDING" }), SCHISM: expect.objectContaining({ nameStatus: "PENDING" }), RUIN: expect.objectContaining({ nameStatus: "PENDING" }) }));
    expect(coverage.hydrology).toMatchObject({
      baseWatercourseCount: 8,
      rapids: {
        withParentEntity: ["POI-070", "POI-071"],
        withNamedParentByWorld: { CONCORD: [], SCHISM: [], RUIN: [] },
        withoutNamedParentByWorld: { CONCORD: ["POI-070", "POI-071"], SCHISM: ["POI-070", "POI-071"], RUIN: ["POI-070", "POI-071"] },
      },
      waterfalls: {
        withoutParentEntity: ["POI-001"],
        withoutNamedParentByWorld: { CONCORD: ["POI-001"], SCHISM: ["POI-001"], RUIN: ["POI-001"] },
        canonicalEntityGaps: [expect.objectContaining({ issueCode: "CANONICAL_HYDROLOGY_ENTITY_GAP", poiId: "POI-001" })],
      },
    });
  });

  it("resolves a supported EconomicForm for every occupied Settlement from Breed ownership/allocation authority", () => {
    for (const world of WORLDS) {
      const read = buildReadModelV1(boots[world].state, canonical, DEFAULT_MECHANICS_VARIABLES_V1);
      const occupied = read.settlements.filter((settlement) => BigInt(settlement.population) > 0n);
      expect(occupied).toHaveLength(24);
      expect(occupied.every((settlement) => settlement.supportedEconomicForm.length > 0)).toBe(true);
    }
  });

  it("materializes one stable noncausal RouteCorridor per unordered Region pair without inventing mode metadata", () => {
    const coverage = buildRouteCoverageReadModel(canonical, Object.fromEntries(WORLDS.map((world) => [world, boots[world].state])), {}, Object.fromEntries(WORLDS.map((world) => [world, boots[world].namingRequests])));
    expect(coverage).toMatchObject({ directedEdgeCount: 76, corridorCount: 38, bidirectionalPairs: 38, oneDirectionPairs: 0 });
    expect(coverage.rows.every((route) => route.primaryMode === "UNRESOLVED" && route.infrastructureClass === "UNRESOLVED" && !route.portalCapability && !route.tradeDesignation)).toBe(true);
    expect(WORLDS.map((world) => coverage.rows.filter((route) => route.worlds[world]?.active).length)).toEqual([35, 35, 35]);
    expect(coverage.rows.filter((route) => route.worlds.CONCORD?.active).every((route) => route.worlds.CONCORD?.endpointSettlements !== null)).toBe(true);
    expect(DEFAULT_NAMING_BEHAVIOR_V5.PORTAL_LINK).toBe("NO_NAME_REQUIRED");

    const corridorId = coverage.rows[0]!.corridorId;
    const named = buildRouteCoverageReadModel(
      canonical,
      Object.fromEntries(WORLDS.map((world) => [world, boots[world].state])),
      {
        CONCORD: { [`WORLD_ROUTE_CONCORD_${corridorId}`]: "Concord Owner Route" },
        SCHISM: { [`WORLD_ROUTE_SCHISM_${corridorId}`]: "Schism Owner Route" },
        RUIN: { [`WORLD_ROUTE_RUIN_${corridorId}`]: "Ruin Owner Route" },
      },
    );
    expect(named.rows[0]!.worlds.CONCORD).toMatchObject({ name: "Concord Owner Route", nameStatus: "ACCEPTED" });
    expect(named.rows.filter((row) => new Set(WORLDS.map((world) => row.worlds[world]?.name ?? null)).size > 1)).toHaveLength(1);
  });

  it("centralizes the required faction colors and removes V4 from the normal Runs body", () => {
    const css = readFileSync(resolve("src/ui/styles.css"), "utf8");
    expect(css).toContain("--faction-concord: #246edb");
    expect(css).toContain("--faction-schism: #e6bd31");
    expect(css).toContain("--faction-ruin: #c9443b");
    const renderer = readFileSync(resolve("src/main.tsx"), "utf8");
    const runsBlock = renderer.slice(renderer.indexOf('if (selected === "Runs")'), renderer.indexOf('if (selected === "Live Dashboard")'));
    expect(runsBlock).not.toContain("RUN CANONICAL");
    expect(runsBlock).not.toContain("RUN DIAGNOSTIC");
    expect(runsBlock).toContain("RUN V5 TO YEAR");
  });

  it("keeps both common organization formation mechanics reachable under diagnostic defaults", () => {
    expect(DEFAULT_MECHANICS_VARIABLES_V1.corporationFormationThreshold).toBe(400);
    expect(DEFAULT_MECHANICS_VARIABLES_V1.crimeFormationThreshold).toBe(250);
  });
});
