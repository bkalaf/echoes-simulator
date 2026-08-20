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
    expect(store.getRun("RUN_RESTART")?.status).toBe("READY");
    expect(store.getAcceptedNames(job.namingJobId)).toHaveLength(job.items.length);
    expect(() => store.acceptNamingResponse(job.namingJobId, "ATTEMPT_DUPLICATE", "{valid}", decisions)).toThrow(/already accepted/i);
    expect(store.getAcceptedNames(job.namingJobId)).toHaveLength(job.items.length);
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
