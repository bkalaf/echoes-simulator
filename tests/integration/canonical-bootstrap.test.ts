import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapCanonicalRun } from "../../src/core/engine/canonical-runner.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

describe("canonical persisted runner", () => {
  it("initializes the complete civic cohort state and stops only at a real naming barrier", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-canonical-")), "simulator.sqlite"));
    const result = bootstrapCanonicalRun({
      store,
      seed: "CANONICAL_INTEGRATION_SEED",
      canonicalDirectory: resolve("resources/canonical"),
    });

    expect(result.status).toBe("WAITING_FOR_NAMING");
    expect(result.currentYear).toBe(0);
    expect(result.worlds).toEqual({ CONCORD: { cohorts: 1773, settlements: 24, population: "2000000" }, SCHISM: { cohorts: 1773, settlements: 24, population: "2000000" }, RUIN: { cohorts: 1773, settlements: 24, population: "2000000" } });
    expect(store.countCohorts(result.runId)).toBe(5319);
    expect(store.cohortPopulation(result.runId, "CONCORD", 0)).toBe(2_000_000n);
    expect(store.getRun(result.runId)?.status).toBe("WAITING_FOR_NAMING");
    expect(store.getPendingNamingJob(result.runId)?.items.length).toBeGreaterThan(0);
    expect(result.runtimeIssues).toEqual([]);
    expect(result.namingJob.context.settlement).toMatchObject({ dominantFaction: expect.any(String), politicalForm: expect.any(String), economicForm: expect.any(String), dominantBreed: expect.any(String), cultureId: expect.any(String) });
    store.close();
  }, 30_000);
});
