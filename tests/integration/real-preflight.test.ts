import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { preflightRealBundle } from "../../src/core/inputs/preflight.js";

describe("owner input bundle preflight", () => {
  it("uses August 17 as the starting authority and fails closed without a complete V3 pack", () => {
    const pack = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
    const report = preflightRealBundle(pack);
    expect(report.structuralStatus).toBe("PASS");
    expect(report.counts).toMatchObject({ breeds: 2056, civicBreeds: 1773, pets: 283, sites: 175, pois: 92, poiSites: 61, nonR10GroupAssignments: 72 });
    expect(report.coverage.administrationMode).toEqual({ resolved: 0, terminalNull: 0, invalidUnresearched: 1773, unresolved: 1773 });
    expect(report.coverage.personalityId).toEqual({ resolved: 0, terminalNull: 0, invalidUnresearched: 1773, unresolved: 1773 });
    expect(report.coverage.terrainBroad).toEqual({ resolved: 0, terminalNull: 0, invalidUnresearched: 1773, unresolved: 1773 });
    expect(report.initialPopulationTotal).toBe("2000000");
    expect(report.r10InitialSettlement).toBe(false);
    expect(report.canonicalReady).toBe(false);
    expect(report.activeIssues.map((issue) => issue.issueCode)).toEqual(expect.arrayContaining(["MISSING_COMPLETE_V3_RESEARCH_PACK", "BREED_RESEARCH_INCOMPLETE"]));
    expect(report.sourceRoles).toMatchObject({
      august17StartingAuthority: { rows: 2056 },
      august18SourceLeads: { semanticPrecedence: "SOURCE_LEADS_ONLY" },
      legacyCsv: { semanticPrecedence: "METADATA_ONLY" },
      v3SemanticAuthority: null,
    });
  }, 30_000);
});
