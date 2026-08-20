import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAndPersistDiagnostic } from "../../src/core/operator/diagnostic-service.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

describe("persisted diagnostic workflow", () => {
  it("runs without a preflight, survives restart, and never creates canonical readiness", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "eidolon-diagnostic-persistence-")), "simulator.sqlite");
    let store = new SimulatorStore(filename);
    const completed = runAndPersistDiagnostic(store, "DIAGNOSTIC_WITHOUT_PREFLIGHT", resolve("resources"));

    expect(completed.mode).toBe("DIAGNOSTIC");
    expect(completed.status).toBe("COMPLETE");
    expect(completed.currentYear).toBe(2000);
    expect(store.getLatestPreflight()).toBeNull();
    expect(store.eventCount(completed.runId)).toBeGreaterThan(0);
    expect(store.checkpointCount(completed.runId)).toBe(3);
    store.close();

    store = new SimulatorStore(filename);
    expect(store.getRun(completed.runId)).toMatchObject({ mode: "DIAGNOSTIC", status: "COMPLETE", currentYear: 2000 });
    expect(store.listRuns().map((run) => run.runId)).toContain(completed.runId);
    expect(store.selectedRun()?.runId).toBe(completed.runId);
    expect(store.getLatestPreflight()).toBeNull();
    store.close();
  });
});
