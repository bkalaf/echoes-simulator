import { describe, expect, it } from "vitest";
import { equirectangularAtlasPosition, type AtlasPoi } from "../../src/core/atlas/atlas-view.js";
import { runtimeVisibleAtlasPois } from "../../src/persistence/postgres-atlas.js";
import { buildAtlasReconciliation } from "../../src/scripts/reconcile-atlas-pois.js";

const simulator = (poiId: string, latitude = 10, longitude = 20, regionId = "R01", poiType = "PEAK") => ({ poiId, poiType, poiLatitude: String(latitude), poiLongitude: String(longitude), siteId: "SITE-001", regionId, poiSurfaceType: "LAND", poiWorkingLabel: `Simulator ${poiId}`, poiCurrentName: "", poiHostFeatureId: "", primaryBiomeId: "" });
const atlas = (poiId: string, latitude = 10, longitude = 20, regionId = "R01", category = "PEAK") => ({ poiId, category, latitude, longitude, regionId, name: `Atlas ${poiId}` });

describe("canonical Atlas POI reconciliation", () => {
  it("joins by stable ID only and distinguishes exact, correction, conflict, and missing rows", () => {
    const rows = buildAtlasReconciliation({
      authorityId: "ATLAS_TEST", withheld: new Map([["POI-003", "owner-withheld placement"]]),
      simulatorRows: [simulator("POI-001"), simulator("POI-002"), simulator("POI-003"), simulator("POI-004"), simulator("POI-005")],
      activePoints: [atlas("POI-001"), atlas("POI-002", 11, 21), atlas("POI-003"), atlas("POI-004", 10, 20, "R02"), atlas("POI-006")],
    });
    expect(Object.fromEntries(rows.map((row) => [row.poiId, row.classification]))).toEqual({
      "POI-001": "EXACT_MATCH", "POI-002": "ATLAS_CORRECTION", "POI-003": "INVALID_GEOGRAPHY", "POI-004": "ID_CONFLICT", "POI-005": "SIMULATOR_ONLY", "POI-006": "ATLAS_ONLY",
    });
    expect(rows.find((row) => row.poiId === "POI-002")?.databaseAfter).toMatchObject({ latitude: 11, longitude: 21 });
    expect(rows.find((row) => row.poiId === "POI-004")?.databaseAfter).toMatchObject({ regionId: "R01" });
  });

  it("uses latitude/longitude with east-positive equirectangular projection", () => {
    expect(equirectangularAtlasPosition(41.625, 89.625)).toEqual({ xPercent: 74.89583333333333, yPercent: 26.875 });
    expect(equirectangularAtlasPosition(-72, -18)).toEqual({ xPercent: 45, yPercent: 90 });
    expect(() => equirectangularAtlasPosition(91, 0)).toThrow(/latitude/);
  });

  it("withholds conflicted placements from runtime without inventing a fallback", () => {
    const base = { poiType: "PEAK", workingLabel: "x", nameStatus: "WORKING", latitude: 0, longitude: 0, regionId: "R01", regionName: "One", siteId: "SITE-001", isMagical: false, isRuntimeEffectAnchor: false };
    const rows: AtlasPoi[] = [{ ...base, poiId: "POI-008", placementStatus: "WITHHELD_CONFLICT" }, { ...base, poiId: "POI-029", placementStatus: "AUTHORITATIVE" }, { ...base, poiId: "POI-092", placementStatus: "AUTHORITATIVE" }];
    expect(runtimeVisibleAtlasPois(rows).map((row) => row.poiId)).toEqual(["POI-029", "POI-092"]);
  });
});
