import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, buildV5RunManifest, extendV5EventHistoryHash, labelInputHash, v5EventHistoryHash } from "../../src/core/v5/persistence.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import type { CausalEventV5, WorldStateV5 } from "../../src/core/v5/types.js";
import { buildBlockingNamingBatchV5, buildPersistedNamingBatchesV5, validateNamingBatchResponseV5 } from "../../src/core/v5/naming.js";
import { inspectLegacyV5NamingTrust } from "../../src/persistence/v5-legacy-trust.js";

const state: WorldStateV5 = {
  schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year: 5,
  cohorts: [{ settlementId: "S1", breedId: "B1", tiers: { HIGH: { population: 4n, prosperity: 700 }, MID: { population: 3n, prosperity: 500 }, LOW: { population: 3n, prosperity: 200 } } }],
  settlements: [{ settlementId: "S1", siteId: "SITE1", regionId: "R01", stateId: "STATE1", foundedYear: 0, unrest: 100, sectorStrengths: { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } }],
  states: [{ stateId: "STATE1", actualGovernment: "GOV", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, dominantFaction: "CONCORD", legitimacy: 800, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
  families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [],
};
const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: "EV_V5", worldKey: "CONCORD", year: 5, phase: "AUDIT", sequence: 0, eventType: "Audit", entityType: "WORLD", entityId: "CONCORD", causeEventIds: [], mechanicsVersion: "echoes-mechanics-v5.0.0", causalDerivationVersion: "echoes-derived-metrics-v1", keyedDecisionIdentity: null, mutations: [], payload: {} };

describe("V5 persistence and replay boundaries", () => {
  it("derives legacy naming distrust read-only and refuses schema initialization without changing one byte", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "echoes-v5-legacy-")), "legacy.sqlite");
    const legacy = new DatabaseSync(filename);
    legacy.exec("CREATE TABLE v5_run_manifest(run_id TEXT PRIMARY KEY); CREATE TABLE v5_label_input(run_id TEXT, entity_id TEXT, label TEXT); INSERT INTO v5_run_manifest VALUES ('LEGACY_RUN'); INSERT INTO v5_label_input VALUES ('LEGACY_RUN','STATE_1','Diagnostic STATE STATE_1');");
    legacy.close();
    const before = readFileSync(filename);
    const shaBefore = createHash("sha256").update(before).digest("hex");
    const bytesBefore = statSync(filename).size;
    const trust = inspectLegacyV5NamingTrust(filename);
    expect(trust).toMatchObject({ trustStatus: "LEGACY_UNTRUSTED_NAMING", requiresFreshTrustedDatabase: true, bytesBefore, bytesAfter: bytesBefore, sha256Before: shaBefore, sha256After: shaBefore });
    expect(() => new SimulatorStore(filename)).toThrow(/LEGACY_UNTRUSTED_NAMING/);
    expect(statSync(filename).size).toBe(bytesBefore);
    expect(createHash("sha256").update(readFileSync(filename)).digest("hex")).toBe(shaBefore);
  });

  it("produces the same event-history hash incrementally and in one pass", () => {
    const secondEvent: CausalEventV5 = { ...event, eventId: "EV_V5_SECOND", year: 6, sequence: 1 };
    const firstBatchHash = extendV5EventHistoryHash(V5_EMPTY_EVENT_HISTORY_HASH, [event]);
    expect(extendV5EventHistoryHash(firstBatchHash, [secondEvent])).toBe(v5EventHistoryHash([event, secondEvent]));
  });

  it("round-trips BigInt durable state, causal events, manifests, and noncausal labels", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-store-")), "run.sqlite"));
    store.createRun({ runId: "RUN_V5", mode: "DIAGNOSTIC", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const manifest = buildV5RunManifest({ runId: "RUN_V5", mode: "DIAGNOSTIC", canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("seed"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    store.saveV5RunManifest(manifest); store.appendV5CausalEvents("RUN_V5", [event]); const saved = store.saveV5Checkpoint("RUN_V5", state, v5EventHistoryHash([event]));
    store.recordV5AcceptedLabel({ ledgerEntryId: "LEDGER_S1", runId: "RUN_V5", worldKey: "CONCORD", entityType: "SETTLEMENT", entityId: "S1", label: "Accepted Name", source: "OWNER_INPUT", sourceRequestId: null, sourceAuthorityRef: "OWNER_AUDIT:TEST:S1", sourceBatchId: null, sourceResponseAttemptId: null, nameEffectiveFromYear: 5, acceptanceYear: 5, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: "SETTLEMENT_SITE:SITE1", comparisonAuthorityRef: "CANONICAL_SITE_ID:SITE1" }, "TEST");
    expect(store.loadV5RunManifest("RUN_V5")?.causalRunHash).toBe(manifest.causalRunHash);
    expect(store.listV5CausalEvents("RUN_V5", "CONCORD")).toEqual([event]);
    expect(store.loadLatestV5Checkpoint("RUN_V5", "CONCORD")?.state.cohorts[0]?.tiers.HIGH.population).toBe(4n);
    expect(store.loadLatestV5Checkpoint("RUN_V5", "CONCORD")?.stateHash).toBe(saved.stateHash);
    expect(store.summarizeV5CausalEventHistory("RUN_V5", "CONCORD")).toEqual({ eventHistoryHash: saved.eventHistoryHash, eventCount: 1 });
    expect(extendV5EventHistoryHash(V5_EMPTY_EVENT_HISTORY_HASH, [event])).toBe(saved.eventHistoryHash);
    expect(store.loadV5Labels("RUN_V5")).toEqual({ S1: "Accepted Name" });
    expect(store.loadV5Labels("RUN_V5", 4)).toEqual({});
    expect(store.loadV5Labels("RUN_V5", 5)).toEqual({ S1: "Accepted Name" });
    expect(labelInputHash({ S1: "Accepted Name" })).not.toBe(labelInputHash({ S1: "Changed Name" }));
    store.close();
  });

  it("keeps operational and diagnostic settings outside causal identity", () => {
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} }); const base = { runId: "RUN", mode: "DIAGNOSTIC" as const, canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("seed"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner };
    const five = buildV5RunManifest({ ...base, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, checkpointIntervalYears: 5 }, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    const ten = buildV5RunManifest({ ...base, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, checkpointIntervalYears: 10 }, diagnostic: { ...DEFAULT_DIAGNOSTIC_CONFIG_V1, endingPopulationGoal: 999n, divergenceTargetsBps: { identical: 1000, similar: 2000, material: 7000 }, migrationNotabilityThresholdBps: 999 } });
    expect(five.causalRunHash).toBe(ten.causalRunHash);
    expect(five.operationalConfigHash).not.toBe(ten.operationalConfigHash);
    expect(five.diagnosticConfigHash).not.toBe(ten.diagnosticConfigHash);
  });

  it("accepts one exact persisted blocking naming batch without changing causal state", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-naming-")), "run.sqlite"));
    store.createRun({ runId: "RUN_NAMES", mode: "DIAGNOSTIC", status: "WAITING_FOR_NAMING", seed: "seed", seedHash: "hash", policyVersion: "v5", currentYear: 5 });
    const requests = [
      { requestId: "REQ_STATE", entityType: "STATE", entityId: "STATE_NEW", behavior: "BLOCKING" as const, createdYear: 5, acceptedLabel: null },
      { requestId: "REQ_SETTLEMENT", entityType: "SETTLEMENT", entityId: "SETTLEMENT_NEW", behavior: "BLOCKING" as const, createdYear: 5, acceptedLabel: null },
      { requestId: "REQ_FAMILY", entityType: "FAMILY", entityId: "FAMILY_NEW", behavior: "BATCHED" as const, createdYear: 5, acceptedLabel: null },
    ];
    store.saveV5NamingRequests("RUN_NAMES", requests);
    const batch = buildBlockingNamingBatchV5("RUN_NAMES", store.listV5NamingRequests("RUN_NAMES"))!;
    expect(batch.items.map((request) => request.requestId)).toEqual(["REQ_SETTLEMENT", "REQ_STATE"]);
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v2" as const, batchId: batch.batchId, runId: batch.runId, decisions: batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: `Name ${request.entityId}`, nameEffectiveFromYear: request.createdYear })) };
    const validated = validateNamingBatchResponseV5(batch, response);
    expect(validated.accepted).toBe(true);
    store.saveV5NamingBatchAudit(batch); store.saveV5NamingResponseAttempt({ runId: "RUN_NAMES", batchId: batch.batchId, attemptId: "ATTEMPT_BLOCKING", accepted: true, response, errors: [] });
    store.acceptV5NamingRequests("RUN_NAMES", response.decisions, 5, "BLOCKING", { batchId: batch.batchId, responseAttemptId: "ATTEMPT_BLOCKING" });
    expect(store.getRun("RUN_NAMES")?.status).toBe("RUNNING");
    expect(store.loadV5Labels("RUN_NAMES")).toEqual({ SETTLEMENT_NEW: "Name SETTLEMENT_NEW", STATE_NEW: "Name STATE_NEW" });
    expect(store.listV5NamingRequests("RUN_NAMES").find((request) => request.requestId === "REQ_FAMILY")?.acceptedLabel).toBeNull();
    store.close();
  });

  it("accepts a deterministic non-blocking naming batch without changing run status", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-batched-naming-")), "run.sqlite"));
    store.createRun({ runId: "RUN_BATCHED_NAMES", mode: "DIAGNOSTIC", status: "COMPLETE", seed: "seed", seedHash: "hash", policyVersion: "v5", currentYear: 25 });
    const requests = [
      { requestId: "REQ_FAMILY_A", entityType: "FAMILY", entityId: "FAMILY_A", behavior: "BATCHED" as const, createdYear: 5, acceptedLabel: null },
      { requestId: "REQ_FAMILY_B", entityType: "FAMILY", entityId: "FAMILY_B", behavior: "BATCHED" as const, createdYear: 10, acceptedLabel: null },
    ];
    store.saveV5NamingRequests("RUN_BATCHED_NAMES", requests);
    const batch = buildPersistedNamingBatchesV5("RUN_BATCHED_NAMES", store.listV5NamingRequests("RUN_BATCHED_NAMES"), 10)[0]!;
    expect(batch.behavior).toBe("BATCHED");
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v2" as const, batchId: batch.batchId, runId: batch.runId, decisions: batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: `Name ${request.entityId}`, nameEffectiveFromYear: request.createdYear })) };
    store.saveV5NamingBatchAudit(batch); store.saveV5NamingResponseAttempt({ runId: "RUN_BATCHED_NAMES", batchId: batch.batchId, attemptId: "ATTEMPT_BATCHED", accepted: true, response, errors: [] });
    store.acceptV5NamingRequests("RUN_BATCHED_NAMES", response.decisions, 25, "BATCHED", { batchId: batch.batchId, responseAttemptId: "ATTEMPT_BATCHED" });
    expect(store.getRun("RUN_BATCHED_NAMES")?.status).toBe("COMPLETE");
    expect(store.loadV5Labels("RUN_BATCHED_NAMES")).toEqual({ FAMILY_A: "Name FAMILY_A", FAMILY_B: "Name FAMILY_B" });
    store.close();
  });
});
