import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayCheckpoint } from "../../src/core/checkpoints/checkpoint.js";
import { buildPersistedCanonicalExport } from "../../src/core/export/persisted-export.js";
import { verifyExportZip } from "../../src/core/export/exporter.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

describe("persisted canonical export", () => {
  it("exports and reopens the selected SQLite history rather than an archived artifact", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "eidolon-export-store-")), "simulator.sqlite"));
    const runId = "RUN_PERSISTED_EXPORT";
    store.createRun({ runId, mode: "CANONICAL", status: "RUNNING", seed: "PERSISTED_EXPORT_SEED", seedHash: "hash", policyVersion: "eidolon-simulator-owner-policy-v1@2026-08-18" });
    for (const worldKey of ["CONCORD", "SCHISM", "RUIN"] as const) {
      const cohort = { cohortId: `COHORT_${worldKey}`, worldKey, settlementId: `SETTLEMENT_${worldKey}_SITE-001`, breedId: "BRD_TEST", population: 10n, wealthScore: 4, createdYear: 0, originCohortId: null, createdByEventId: `EVENT_${worldKey}`, outboundMigrationNotBeforeYear: null };
      const settlement = { settlementId: cohort.settlementId, siteId: "SITE-001", regionId: "R01", stateId: `STATE_${worldKey}_R01`, population: "10", propertyWinners: { motivation: "ALTRUISTIC" }, dominantFaction: worldKey };
      store.saveCohorts(runId, 2_000, [cohort]);
      store.saveProjection(runId, worldKey, 2_000, "SETTLEMENT", cohort.settlementId, settlement);
      store.appendEvent({ eventId: `EVENT_${worldKey}_COMPLETE`, runId, worldKey, year: 2_000, phaseOrder: 100, sequence: 0, eventType: "CANONICAL_COMPLETE", entityType: "WORLD", entityId: worldKey, payload: {} });
      store.saveCheckpoint(createReplayCheckpoint({ runId, worldKey, state: { year: 2_000, settlements: [settlement], cohorts: [{ ...cohort, population: "10" }] }, engineVersion: "canonical-cohort-engine-v4", policyVersion: "eidolon-simulator-owner-policy-v1@2026-08-18" }));
      store.saveHistoryRows(runId, [{ worldKey, year: 100, historyType: "MIGRATION", entryId: `MIGRATION_${worldKey}`, data: { population: "1", migrantWealth: 0 } }]);
    }
    store.setRunStatus(runId, "COMPLETE", 2_000);
    const generated = buildPersistedCanonicalExport(store, runId, resolve("resources/canonical"));
    const verified = verifyExportZip(generated.bytes);
    expect(verified.valid).toBe(true);
    expect(verified.manifest).toMatchObject({ runId, mode: "CANONICAL", completionStatus: "COMPLETE" });
    expect(verified.files.filter((file) => file.path.endsWith("migration.jsonl"))).toHaveLength(3);
    expect(verified.files.filter((file) => file.path.endsWith("population/cohorts.jsonl"))).toHaveLength(3);
    store.close();
  });
});
