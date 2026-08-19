import { describe, expect, it } from "vitest";
import { runDiagnosticHistory } from "../../src/core/engine/diagnostic-runner.js";

describe("complete synthetic diagnostic history", () => {
  it("runs three deterministic worlds through 2000 with invariant audits", () => {
    const first = runDiagnosticHistory("EIDOLON_DIAGNOSTIC_2026_08_18");
    const second = runDiagnosticHistory("EIDOLON_DIAGNOSTIC_2026_08_18");
    expect(first.finalYear).toBe(2000);
    expect(first.mode).toBe("DIAGNOSTIC");
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.sharedEvents).toEqual(second.sharedEvents);
    expect(first.audit.negativePopulationCount).toBe(0);
    expect(first.audit.conservationFailures).toBe(0);
    expect(first.audit.socialConservationFailures).toBe(0);
    expect(first.checkpointCount).toBe(1203);
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) {
      expect(first.worlds[world].initialSettlementCount).toBe(24);
      expect(first.worlds[world].settlements.some((settlement) => settlement.regionId === "R10" && settlement.foundedYear === first.djtYear)).toBe(true);
      expect(first.worlds[world].stateCount).toBe(25);
      expect(first.worlds[world].finalPopulation > 2_000_000n).toBe(true);
      expect(first.worlds[world].finalYear).toBe(2000);
      expect(first.worlds[world].events.some((event) => event.eventType === "MIGRATION_APPLIED")).toBe(true);
      expect(first.worlds[world].populationCheckpoints).toHaveLength(401);
      expect(first.worlds[world].populationDeltas.length).toBeGreaterThan(2000);
      expect(first.worlds[world].governmentEpochs.length).toBeGreaterThanOrEqual(25);
      expect(first.worlds[world].economicEpochs.length).toBeGreaterThanOrEqual(25);
      expect(first.worlds[world].settlements.reduce((sum, settlement) => sum + settlement.population, 0n)).toBe(first.worlds[world].finalPopulation);
    }
    expect(first.sharedEvents.some((event) => event.eventKey === "ATROCITY_08")).toBe(false);
  }, 30_000);
});
