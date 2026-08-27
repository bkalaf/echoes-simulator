import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";
import { buildNamingJob } from "../../src/core/naming/naming.js";

describe("SQLite persistence", () => {
  it("keeps runtime data in an explicit external directory and rejects duplicate event order", () => {
    const directory = mkdtempSync(join(tmpdir(), "eidolon-simulator-test-"));
    const filename = join(directory, "run.sqlite");
    const store = new SimulatorStore(filename);
    store.createRun({ runId: "RUN_TEST", mode: "DIAGNOSTIC", status: "CREATED", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    store.appendEvent({ eventId: "EVT_1", runId: "RUN_TEST", worldKey: "CONCORD", year: 0, phaseOrder: 10, sequence: 0, eventType: "FOUNDING", entityType: "WORLD", entityId: "CONCORD", payload: { population: "10" } });
    expect(() => store.appendEvent({ eventId: "EVT_2", runId: "RUN_TEST", worldKey: "CONCORD", year: 0, phaseOrder: 10, sequence: 0, eventType: "DUPLICATE", entityType: "WORLD", entityId: "CONCORD", payload: {} })).toThrow();
    expect(store.eventCount("RUN_TEST")).toBe(1);
    store.close();
    expect(filename.startsWith(process.cwd())).toBe(false);
  });

  it("survives restart at a naming barrier and atomically applies an accepted response once", () => {
    const directory = mkdtempSync(join(tmpdir(), "eidolon-simulator-restart-"));
    const filename = join(directory, "run.sqlite");
    const job = buildNamingJob({
      runId: "RUN_RESTART", world: "SCHISM", year: 75, reason: "FOUNDING_WAVE",
      settlement: { settlementId: "SETTLEMENT_NEW", siteId: "SITE-025", currentName: null, nameSource: "UNNAMED", dominantFaction: "SCHISM", cultureId: "CLT_TEST", cultureState: "CALCULATED", politicalForm: "COUNCIL", economicForm: "MARKET", dominantBreed: "BRD_TEST", population: "123" },
      unnamedPois: [],
    });
    let store = new SimulatorStore(filename);
    store.createRun({ runId: "RUN_RESTART", mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    store.persistNamingBarrier(job, {
      schemaVersion: "eidolon-simulator-checkpoint-v1",
      checkpointId: "CHECKPOINT_75", runId: "RUN_RESTART", worldKey: "SCHISM", year: 75,
      stateHash: "state-hash", state: { cohorts: [{ cohortId: "C1", population: "123", wealthScore: 7 }] }, engineVersion: "v1", policyVersion: "policy-v1",
    });
    expect(store.getRun("RUN_RESTART")?.status).toBe("WAITING_FOR_NAMING");
    store.close();

    store = new SimulatorStore(filename);
    expect(store.getPendingNamingJob("RUN_RESTART")?.namingJobId).toBe(job.namingJobId);
    expect(store.loadCheckpoint("RUN_RESTART", "SCHISM", 75)?.state).toEqual({ cohorts: [{ cohortId: "C1", population: "123", wealthScore: 7 }] });
    store.recordRejectedNamingAttempt(job.namingJobId, "ATTEMPT_BAD", "{}", ["missing decisions"]);
    const decisions = job.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, name: `${item.entityType} Name` }));
    store.acceptNamingResponse(job.namingJobId, "ATTEMPT_GOOD", "{valid}", decisions);
    expect(store.getRun("RUN_RESTART")?.status).toBe("RUNNING");
    expect(store.getAcceptedNames(job.namingJobId)).toHaveLength(job.items.length);
    expect(() => store.acceptNamingResponse(job.namingJobId, "ATTEMPT_DUPLICATE", "{valid}", decisions)).toThrow(/already accepted/i);
    expect(store.getAcceptedNames(job.namingJobId)).toHaveLength(job.items.length);
    store.close();
  });

  it("atomically supersedes an incomplete pending naming job while preserving its rejected attempt", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-simulator-poi-upgrade-")), "run.sqlite"));
    const context = {
      runId: "RUN_POI_UPGRADE", world: "CONCORD" as const, year: 74, reason: "FOUNDING_WAVE",
      settlement: { settlementId: "SETTLEMENT_CONCORD_SITE-017", siteId: "SITE-017", currentName: null, nameSource: "UNNAMED" as const, dominantFaction: "CONCORD", cultureId: "CLT_TEST", cultureState: "CALCULATED" as const, politicalForm: "COUNCIL", economicForm: "MARKET", dominantBreed: "BRD_TEST", population: "123" },
    };
    const incomplete = buildNamingJob({ ...context, unnamedPois: [] });
    const upgraded = buildNamingJob({ ...context, unnamedPois: [{ poiId: "POI-003", workingLabel: "Rainbow Heatherland Heart", poiType: "HEATHERLANDS" }] });
    store.createRun({ runId: context.runId, mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    store.persistNamingBarrier(incomplete, { schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: "CHECKPOINT_POI_74", runId: context.runId, worldKey: "CONCORD", year: 74, stateHash: "hash", state: {}, engineVersion: "v1", policyVersion: "policy-v1" });
    store.recordRejectedNamingAttempt(incomplete.namingJobId, "ATTEMPT_BEFORE_UPGRADE", "{}", ["missing POI"]);
    expect(store.supersedePendingNamingJobs([{ priorNamingJobId: incomplete.namingJobId, job: upgraded }])).toBe(1);
    expect(store.listPendingNamingJobs(context.runId)).toEqual([upgraded]);
    expect(store.listNamingJobs(context.runId)).toEqual(expect.arrayContaining([
      { job: incomplete, status: "SUPERSEDED" },
      { job: upgraded, status: "PENDING" },
    ]));
    expect(store.getRun(context.runId)?.status).toBe("WAITING_FOR_NAMING");
    expect(store.supersedePendingNamingJobs([])).toBe(0);
    store.close();
  });

  it("stores compact Breed totals per checkpoint and returns three-world trends plus city bars", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-simulator-breed-view-")), "run.sqlite"));
    store.createRun({ runId: "RUN_BREED_VIEW", mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    const checkpoint = (worldKey: "CONCORD" | "SCHISM" | "RUIN", year: number, multiplier: number) => ({
      schemaVersion: "eidolon-simulator-checkpoint-v1" as const,
      checkpointId: `CHECKPOINT_${worldKey}_${year}`,
      runId: "RUN_BREED_VIEW",
      worldKey,
      year,
      stateHash: `${worldKey}-${year}`,
      state: {
        year,
        settlements: [
          { settlementId: `SETTLEMENT_${worldKey}_A`, siteId: "SITE-001", name: "Alpha" },
          { settlementId: `SETTLEMENT_${worldKey}_B`, siteId: "SITE-002", name: "Beta" },
        ],
        cohorts: [
          { cohortId: `C_${worldKey}_${year}_A`, worldKey, settlementId: `SETTLEMENT_${worldKey}_A`, breedId: "BRD_AARDVARK", population: String(10 * multiplier) },
          { cohortId: `C_${worldKey}_${year}_B`, worldKey, settlementId: `SETTLEMENT_${worldKey}_B`, breedId: "BRD_AARDVARK", population: String(5 * multiplier) },
          { cohortId: `C_${worldKey}_${year}_OTHER`, worldKey, settlementId: `SETTLEMENT_${worldKey}_B`, breedId: "BRD_OTHER", population: "999" },
        ],
      },
      engineVersion: "v1",
      policyVersion: "policy-v1",
    });
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) {
      store.saveCheckpoint(checkpoint(world, 0, 1));
      store.saveCheckpoint(checkpoint(world, 5, 2));
    }
    const result = store.getBreedPopulationView("RUN_BREED_VIEW", "BRD_AARDVARK", 4);
    expect(result.series.CONCORD).toEqual([{ year: 0, population: "15" }, { year: 5, population: "30" }]);
    expect(result.series.SCHISM).toEqual([{ year: 0, population: "15" }, { year: 5, population: "30" }]);
    expect(result.series.RUIN).toEqual([{ year: 0, population: "15" }, { year: 5, population: "30" }]);
    expect(result.cities.CONCORD).toEqual({ sampledYear: 0, rows: [
      { settlementId: "SETTLEMENT_CONCORD_A", siteId: "SITE-001", name: "Alpha", population: "10" },
      { settlementId: "SETTLEMENT_CONCORD_B", siteId: "SITE-002", name: "Beta", population: "5" },
    ] });
    expect(store.breedPopulationSummaryCount("RUN_BREED_VIEW")).toBe(6);
    store.close();
  });

  it("atomically accepts one world batch while preserving other pending world jobs", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-simulator-batch-")), "run.sqlite"));
    const makeJob = (world: "CONCORD" | "RUIN", settlementId: string) => buildNamingJob({
      runId: "RUN_BATCH", world, year: 10, reason: "FOUNDING_WAVE",
      settlement: { settlementId, siteId: settlementId.replace("SETTLEMENT", "SITE"), currentName: null, nameSource: "UNNAMED", dominantFaction: world, cultureId: "CLT_TEST", cultureState: "CALCULATED", politicalForm: "COUNCIL", economicForm: "MARKET", dominantBreed: "BRD_TEST", population: "100" },
      unnamedPois: [],
    });
    const concordJobs = [makeJob("CONCORD", "SETTLEMENT_1"), makeJob("CONCORD", "SETTLEMENT_2")];
    const ruinJob = makeJob("RUIN", "SETTLEMENT_3");
    store.createRun({ runId: "RUN_BATCH", mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    store.persistNamingBarriers([...concordJobs, ruinJob], [
      { schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: "CHECKPOINT_CONCORD_10", runId: "RUN_BATCH", worldKey: "CONCORD", year: 10, stateHash: "concord", state: {}, engineVersion: "v1", policyVersion: "policy-v1" },
      { schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: "CHECKPOINT_RUIN_10", runId: "RUN_BATCH", worldKey: "RUIN", year: 10, stateHash: "ruin", state: {}, engineVersion: "v1", policyVersion: "policy-v1" },
    ]);
    const responseFor = (job: ReturnType<typeof buildNamingJob>, attemptId: string) => ({
      namingJobId: job.namingJobId, attemptId, responseText: "{batch}", decisions: job.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, name: `${item.entityType} ${job.namingJobId}` })),
    });
    const invalid = [responseFor(concordJobs[0]!, "ATTEMPT_1"), { ...responseFor(concordJobs[1]!, "ATTEMPT_2"), decisions: [] }];
    expect(() => store.acceptNamingResponses(invalid)).toThrow(/do not exactly cover/i);
    expect(store.getAcceptedNames(concordJobs[0]!.namingJobId)).toHaveLength(0);
    expect(store.pendingNamingJobCount("RUN_BATCH")).toBe(3);
    store.acceptNamingResponses(concordJobs.map((job, index) => responseFor(job, `ATTEMPT_GOOD_${index}`)));
    expect(store.getRun("RUN_BATCH")?.status).toBe("WAITING_FOR_NAMING");
    expect(store.pendingNamingJobCount("RUN_BATCH")).toBe(1);
    expect(store.listPendingNamingJobs("RUN_BATCH").map((job) => job.namingJobId)).toEqual([ruinJob.namingJobId]);
    store.acceptNamingResponses([responseFor(ruinJob, "ATTEMPT_RUIN")]);
    expect(store.getRun("RUN_BATCH")?.status).toBe("RUNNING");
    expect(store.pendingNamingJobCount("RUN_BATCH")).toBe(0);
    store.close();
  });

  it("recovers only from the newest checkpoint shared by all canonical worlds", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-simulator-checkpoint-recovery-")), "run.sqlite"));
    store.createRun({ runId: "RUN_RECOVERY", mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    const checkpoint = (worldKey: "CONCORD" | "SCHISM" | "RUIN", year: number) => ({
      schemaVersion: "eidolon-simulator-checkpoint-v1" as const,
      checkpointId: `CHECKPOINT_${worldKey}_${year}`,
      runId: "RUN_RECOVERY",
      worldKey,
      year,
      stateHash: `${worldKey}-${year}`,
      state: { year },
      engineVersion: "v1",
      policyVersion: "policy-v1",
    });
    const saveComplete = (world: "CONCORD" | "SCHISM" | "RUIN", year: number) => { store.saveCheckpoint(checkpoint(world, year)); };
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) saveComplete(world, 35);
    saveComplete("CONCORD", 40);
    saveComplete("SCHISM", 40);
    expect(store.latestCompleteCheckpointYear("RUN_RECOVERY", ["CONCORD", "SCHISM", "RUIN"])).toBe(35);
    store.saveCheckpoint(checkpoint("RUIN", 40));
    expect(store.latestCompleteCheckpointYear("RUN_RECOVERY", ["CONCORD", "SCHISM", "RUIN"])).toBe(40);
    store.close();
  });

  it("loads operator views without materializing heavyweight migration or checkpoint payloads", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-simulator-bounded-view-")), "run.sqlite"));
    store.createRun({ runId: "RUN_VIEW", mode: "CANONICAL", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "policy-v1" });
    store.saveHistoryRows("RUN_VIEW", [
      { worldKey: "CONCORD", year: 5, historyType: "MIGRATION", entryId: "MIGRATION_1", data: { fromSettlementId: "S1", toSettlementId: "S2", population: "7" } },
      { worldKey: "CONCORD", year: 5, historyType: "SOCIAL", entryId: "SOCIAL_1", data: { large: "payload" } },
      { worldKey: "CONCORD", year: 5, historyType: "FOUNDING", entryId: "FOUNDING_1", data: { settlementId: "S1" } },
      { worldKey: "RUIN", year: 5, historyType: "FOUNDING", entryId: "FOUNDING_2", data: { settlementId: "S2" } },
    ]);
    store.saveCheckpoint({ schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: "CHECKPOINT_VIEW", runId: "RUN_VIEW", worldKey: "CONCORD", year: 5, stateHash: "hash-5", state: { veryLargeState: "not returned by metadata" }, engineVersion: "v1", policyVersion: "policy-v1" });
    expect(store.listHistoryRowsForView("RUN_VIEW", "CONCORD", 5)).toEqual([{ worldKey: "CONCORD", year: 5, historyType: "FOUNDING", entryId: "FOUNDING_1", data: { settlementId: "S1" } }]);
    expect(store.listCheckpointMetadata("RUN_VIEW", "CONCORD", 5)).toEqual([{ year: 5, stateHash: "hash-5" }]);
    store.setRunStatus("RUN_VIEW", "WAITING_FOR_NAMING", 5);
    expect(store.compactCanonicalStorage("RUN_VIEW")).toMatchObject({ archivedMigrationRows: 1, migrationSummaries: 1 });
    expect(store.listHistoryRows("RUN_VIEW", "MIGRATION")).toEqual([expect.objectContaining({ data: expect.objectContaining({ schemaVersion: "eidolon-simulator-migration-year-summary-v1", transferCount: 1, exactRowsRetention: "CHECKSUMMED_GZIP_ARCHIVE" }) })]);
    expect(store.listHistoryRows("RUN_VIEW", "MIGRATION_EXACT_ARCHIVE")).toEqual([{ worldKey: "CONCORD", year: 5, historyType: "MIGRATION_EXACT_ARCHIVE", entryId: "MIGRATION_1", data: { fromSettlementId: "S1", toSettlementId: "S2", population: "7" } }]);
    store.close();
  });

  it("persists the newest live preflight across restart without leaking archived blockers", () => {
    const directory = mkdtempSync(join(tmpdir(), "eidolon-simulator-preflight-"));
    const filename = join(directory, "runtime.sqlite");
    let store = new SimulatorStore(filename);
    store.savePreflight({
      preflightId: "PREFLIGHT_CURRENT",
      createdAt: "2026-08-19T09:30:00.000Z",
      inputDirectory: "/inputs/current",
      inputManifestIdentity: "sha256:current",
      startingResearchHash: "sha256:start",
      v3ResearchHash: null,
      report: {
        schemaVersion: "eidolon-simulator-real-preflight-v2",
        structuralStatus: "PASS",
        canonicalReady: false,
        activeIssues: [{ issueCode: "MISSING_COMPLETE_V3_RESEARCH_PACK", severity: "BLOCKER", blocksCanonical: true, message: "current" }],
      },
    });
    store.close();

    store = new SimulatorStore(filename);
    const current = store.getLatestPreflight();
    expect(current?.preflightId).toBe("PREFLIGHT_CURRENT");
    expect(JSON.stringify(current)).toContain("MISSING_COMPLETE_V3_RESEARCH_PACK");
    expect(JSON.stringify(current)).not.toContain("BREED_IDENTITY_CONFLICT");
    store.close();
  });
});
