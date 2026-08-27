import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapCanonicalRun } from "../../src/core/engine/canonical-runner.js";
import { resumeCanonicalRun } from "../../src/core/engine/canonical-resume.js";
import { CANONICAL_POLICY_VERSION } from "../../src/core/engine/canonical-authority.js";
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
    expect(result.worlds).toEqual({ CONCORD: { cohorts: 1779, settlements: 24, population: "2000000" }, SCHISM: { cohorts: 1779, settlements: 24, population: "2000000" }, RUIN: { cohorts: 1779, settlements: 24, population: "2000000" } });
    expect(store.countCohorts(result.runId)).toBe(5337);
    expect(store.cohortPopulation(result.runId, "CONCORD", 0)).toBe(2_000_000n);
    expect(store.getRun(result.runId)).toMatchObject({ status: "WAITING_FOR_NAMING", policyVersion: CANONICAL_POLICY_VERSION });
    expect(store.getPendingNamingJob(result.runId)?.items.length).toBeGreaterThan(0);
    expect(result.runtimeIssues).toEqual([]);
    expect(result.namingJob.context.settlement).toMatchObject({ dominantFaction: expect.any(String), politicalForm: expect.any(String), economicForm: expect.any(String), dominantBreed: expect.any(String), cultureId: expect.any(String) });

    store.acceptNamingResponse(result.namingJob.namingJobId, "ATTEMPT_INITIAL_OWNER_NAMES", "{}", result.namingJob.items.map((item, index) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, name: `Accepted owner name ${index + 1}` })));
    expect(store.getRun(result.runId)?.status).toBe("RUNNING");
    const resumed = resumeCanonicalRun({ store, runId: result.runId, canonicalDirectory: resolve("resources/canonical"), yearEnd: 2 });
    expect(resumed.status).toBe("WAITING_FOR_NAMING");
    expect(resumed.currentYear).toBe(1);
    expect(store.getRun(result.runId)).toMatchObject({ status: "WAITING_FOR_NAMING", currentYear: 1 });
    expect(store.pendingNamingJobCount(result.runId)).toBe(72);
    expect(store.countCohorts(result.runId, undefined, 1)).toBeGreaterThan(5337);
    expect(store.listHistoryRows(result.runId, "MIGRATION")).toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ schemaVersion: "eidolon-simulator-migration-year-summary-v1", exactRowsRetention: "REGENERABLE_FROM_PRIOR_CHECKPOINT_AND_CANONICAL_INPUTS" }) })]));
    expect(resumed.namingJobs.every((job) => job.context.settlement.dominantFaction && job.context.settlement.politicalForm && job.context.settlement.economicForm && job.context.settlement.dominantBreed)).toBe(true);
    expect(resumed.namingJobs.some((job) => job.items.some((item) => item.entityType === "POI"))).toBe(true);
    expect(resumed.namingJobs.flatMap((job) => job.context.unnamedPois).every((poi) => poi.poiId.startsWith("POI-") && poi.workingLabel && poi.poiType)).toBe(true);
    store.close();
  }, 120_000);
});
