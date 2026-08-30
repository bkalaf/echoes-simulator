import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, buildV5RunManifest, extendV5EventHistoryHash, labelInputHash, projectWorldStateV54ReadOnly, v5EventHistoryHash } from "../../src/core/v5/persistence.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import type { CausalEventV5, WorldStateV5 } from "../../src/core/v5/types.js";
import { buildBlockingNamingBatchV5, buildPersistedNamingBatchesV5, validateNamingBatchResponseV5 } from "../../src/core/v5/naming.js";
import { inspectLegacyV5NamingTrust } from "../../src/persistence/v5-legacy-trust.js";
import { acceptPersistedV5NamingBatch, acceptPersistedV5NamingBatches, catchUpPersistedV5Projection, resumePersistedV5Run } from "../../src/core/v5/service.js";
import { acceptDerogatoryDecisionResponseV5, buildDerogatoryDecisionBatchV5, V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH } from "../../src/core/v5/derogatory-decisions.js";
import { CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1, type CausalPolicyBlockerV5 } from "../../src/core/v5/historical-policies.js";

const state: WorldStateV5 = {
  schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year: 5,
  cohorts: [{ settlementId: "S1", breedId: "B1", tiers: { HIGH: { population: 4n, prosperity: 700 }, MID: { population: 3n, prosperity: 500 }, LOW: { population: 3n, prosperity: 200 } } }],
  settlements: [{ settlementId: "S1", siteId: "SITE1", regionId: "R01", stateId: "STATE1", foundedYear: 0, unrest: 100, sectorStrengths: { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } }],
  states: [{ stateId: "STATE1", actualGovernment: "GOV", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, dominantFaction: "CONCORD", legitimacy: 800, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
  families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [],
};
const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: "EV_V5", worldKey: "CONCORD", year: 5, phase: "AUDIT", sequence: 0, eventType: "Audit", entityType: "WORLD", entityId: "CONCORD", causeEventIds: [], mechanicsVersion: "echoes-mechanics-v5.0.0", causalDerivationVersion: "echoes-derived-metrics-v1", keyedDecisionIdentity: null, mutations: [], payload: {} };

describe("V5 persistence and replay boundaries", () => {
  it("catches a stale projection up idempotently from committed SQLite years", async () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-projection-catchup-")), "run.sqlite"));
    const runId = "RUN_PROJECTION_CATCHUP";
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    for (const year of [1, 2]) for (const worldKey of ["CONCORD", "SCHISM", "RUIN"] as const) {
      store.appendV5CausalEvents(runId, [{ ...event, eventId: `EV_${worldKey}_${year}`, worldKey, entityId: worldKey, year }]);
    }
    store.noteV5CausalYearCommitted(runId, 2);
    store.markV5ProjectionStale(runId, 2, new Error("POSTGRES_DOWN"));
    const attempts: number[] = [];
    await catchUpPersistedV5Projection({
      store,
      runId,
      projectAtomicYear: async (year, eventsByWorld) => {
        attempts.push(year);
        expect(Object.values(eventsByWorld).every((events) => events.length === 1 && events[0]?.year === year)).toBe(true);
        if (year === 2) throw new Error("POSTGRES_DOWN");
      },
    });
    expect(store.loadV5ProjectionWatermark(runId)).toMatchObject({ projectedThroughYear: 1, causalCommittedYear: 2, status: "STALE" });
    await catchUpPersistedV5Projection({ store, runId, projectAtomicYear: async (year) => { attempts.push(year); } });
    expect(attempts).toEqual([1, 2, 2]);
    expect(store.loadV5ProjectionWatermark(runId)).toMatchObject({ projectedThroughYear: 2, causalCommittedYear: 2, status: "CURRENT", lastErrorCode: null });
    expect(store.loadV5ProjectionCatchupTasks(runId).filter((task) => task.status === "COMPLETE")).toHaveLength(2);
    store.close();
  });

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

  it("loads only the requested recent V5 timeline tail in chronological order", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-recent-events-")), "run.sqlite"));
    store.createRun({ runId: "RUN_RECENT", mode: "DIAGNOSTIC", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    const events = Array.from({ length: 5 }, (_, index) => ({ ...event, eventId: `EV_${index}`, year: index, sequence: index }));
    store.appendV5CausalEvents("RUN_RECENT", events);
    expect(store.listRecentV5CausalEvents("RUN_RECENT", "CONCORD", 4, 2).map((row) => row.eventId)).toEqual(["EV_3", "EV_4"]);
    expect(store.listRecentV5CausalEvents("RUN_RECENT", "CONCORD", 2, 2).map((row) => row.eventId)).toEqual(["EV_1", "EV_2"]);
    expect(store.listRecentV5CausalEvents("RUN_RECENT", "CONCORD", 4, 0)).toEqual([]);
    store.close();
  });

  it("round-trips BigInt durable state, causal events, manifests, and noncausal labels", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-store-")), "run.sqlite"));
    store.createRun({ runId: "RUN_V5", mode: "DIAGNOSTIC", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const manifest = buildV5RunManifest({ runId: "RUN_V5", mode: "DIAGNOSTIC", canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("seed"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    store.saveV5RunManifest(manifest); store.appendV5CausalEvents("RUN_V5", [event]); const saved = store.saveV5Checkpoint("RUN_V5", state, v5EventHistoryHash([event]));
    store.recordV5AcceptedLabel({ ledgerEntryId: "LEDGER_S1", runId: "RUN_V5", worldKey: "CONCORD", entityType: "SETTLEMENT", entityId: "S1", label: "Accepted Name", source: "OWNER_INPUT", sourceRequestId: null, sourceAuthorityRef: "OWNER_AUDIT:TEST:S1", sourceBatchId: null, sourceResponseAttemptId: null, nameEffectiveFromYear: 5, acceptanceYear: 5, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: "SETTLEMENT_SITE:SITE1", comparisonAuthorityRef: "CANONICAL_SITE_ID:SITE1" }, "TEST");
    expect(store.loadV5RunManifest("RUN_V5")?.causalRunHash).toBe(manifest.causalRunHash);
    expect(store.loadV5RunManifest("RUN_V5")?.causalOwnerInputs.historicalDynamismPolicies?.CIVIC_INSTITUTION_SECURITY?.institutionFormationMinimumPopulation).toBe(25_000n);
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

  it("persists complete point-of-use blockers and immutable 63-decision authority", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "echoes-v54-authority-")), "run.sqlite");
    const store = new SimulatorStore(filename);
    const runId = "RUN_V54_AUTHORITY";
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_DEROGATORY_DECISIONS", seed: "seed", seedHash: "hash", policyVersion: "echoes-mechanics-v5.4.0", currentYear: 14 });
    const blocker: CausalPolicyBlockerV5 = { schemaVersion: "echoes-v5-causal-policy-blocker-v1", policyKey: "RESOURCE_INDUSTRY", policySha256: "a".repeat(64), policyDocument: { humanReadableName: "Complete candidate values", value: 42 }, humanReadablePolicy: "Complete candidate values", causalOperation: "PLACE_PHYSICAL_RESOURCE_GEOGRAPHY", worldKey: "CONCORD", year: 1, entityType: "WORLD", entityId: "CONCORD", requiredApproval: "Approve the exact hash" };
    store.saveV5PolicyBlocker(runId, blocker);
    expect(store.listV5PolicyBlockers(runId)).toEqual([blocker]);
    const worlds = { CONCORD: { ...state, worldKey: "CONCORD" as const, year: 14 }, SCHISM: { ...state, worldKey: "SCHISM" as const, year: 14 }, RUIN: { ...state, worldKey: "RUIN" as const, year: 14 } };
    const batch = buildDerogatoryDecisionBatchV5(worlds, 15, CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1);
    store.saveV5DerogatoryDecisionBatch(runId, batch);
    const response = { schemaVersion: "echoes-derogatory-decision-response-v1" as const, batchId: batch.batchId, contextSha256: batch.contextSha256, promptSha256: batch.promptSha256, provider: "fixture", model: "fixture", authorityRef: "ISOLATED_TEST", decisions: batch.requests.map((request) => ({ decisionId: request.decisionId, action: "SELECT" as const, selectedGroupId: "humans" as const })) };
    const accepted = acceptDerogatoryDecisionResponseV5(batch, response, V5_EMPTY_DEROGATORY_DECISION_STREAM_HASH);
    store.saveV5DerogatoryDecisionAttempt({ runId, batchId: batch.batchId, attemptId: "ATTEMPT_1", accepted: true, response, errors: [] });
    store.saveV5AcceptedDerogatoryDecisionBatch(runId, accepted);
    expect(store.loadV5DerogatoryDecisionBatch(runId, batch.batchId)).toEqual(batch);
    expect(store.listV5AcceptedDerogatoryDecisionBatches(runId)).toEqual([accepted]);
    store.close();
    const raw = new DatabaseSync(filename);
    expect(() => raw.prepare("UPDATE v5_policy_blocker SET policy_key='X' WHERE run_id=?").run(runId)).toThrow(/immutable/);
    expect(() => raw.prepare("UPDATE v5_derogatory_decision_attempt SET accepted=0 WHERE run_id=?").run(runId)).toThrow(/immutable/);
    expect(() => raw.prepare("DELETE FROM v5_derogatory_decision_stream WHERE run_id=?").run(runId)).toThrow(/immutable/);
    raw.close();
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

  it("accepts a complete response archive atomically without replacing a Derogatory decision blocker", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-bulk-naming-")), "run.sqlite"));
    const runId = "RUN_BULK_NAMES";
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_DEROGATORY_DECISIONS", seed: "seed", seedHash: "hash", policyVersion: "v5", currentYear: 14 });
    store.setRunStatus(runId, "WAITING_FOR_DEROGATORY_DECISIONS", 14);
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("bulk names"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, namingBatchMaximum: 1 }, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    store.saveV5RunManifest(manifest);
    store.saveV5NamingRequests(runId, [
      { requestId: "REQ_BULK_A", entityType: "FAMILY", entityId: "FAMILY_BULK_A", behavior: "BATCHED", createdYear: 10, nameEffectiveFromYear: 10, acceptedLabel: null },
      { requestId: "REQ_BULK_B", entityType: "FAMILY", entityId: "FAMILY_BULK_B", behavior: "BATCHED", createdYear: 11, nameEffectiveFromYear: 11, acceptedLabel: null },
    ]);
    const batches = store.materializePendingV5NamingBatches(runId, 1);
    const responses = batches.map((batch, index) => ({ schemaVersion: "echoes-v5-naming-batch-response-v2" as const, batchId: batch.batchId, runId, decisions: batch.items.map((request) => ({ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: `External Bulk Label ${index + 1}`, nameEffectiveFromYear: request.nameEffectiveFromYear ?? request.createdYear })) }));
    const accepted = acceptPersistedV5NamingBatches({ store, runId, batches, responses });
    expect(accepted, accepted.errors.join(" · ")).toMatchObject({ accepted: true, acceptedBatches: 2, acceptedDecisions: 2, pendingBatched: 0 });
    expect(store.getRun(runId)?.status).toBe("WAITING_FOR_DEROGATORY_DECISIONS");
    expect(store.loadV5Labels(runId)).toEqual({ FAMILY_BULK_A: "External Bulk Label 1", FAMILY_BULK_B: "External Bulk Label 2" });
    store.close();
  });

  it("keeps nine materialized batch IDs immutable through refreshes and restarts while accepting every originally captured response", () => {
    const directory = mkdtempSync(join(tmpdir(), "echoes-v5-nine-batches-"));
    const filename = join(directory, "run.sqlite");
    const runId = "RUN_NINE_IMMUTABLE_BATCHES";
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 25, canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("nine batches"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, namingBatchMaximum: 50 }, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    const targets = [48, 48, 48, 48, 50, 50, 50, 50, 19] as const;
    const years = [0, 0, 0, 0, 24, 25, 25, 25, 21] as const;
    const requests: Array<{ requestId: string; entityType: string; entityId: string; behavior: "BATCHED"; createdYear: number; nameEffectiveFromYear: number; worldKey: "CONCORD" | "SCHISM" | "RUIN"; namingComparisonGroupId: string; comparisonAuthorityRef: string; comparisonGroupingVersion: "echoes-naming-comparison-groups-v1"; acceptedLabel: null; context: { creationYear: number } }> = [];
    let groupIndex = 0;
    for (let batchIndex = 0; batchIndex < targets.length; batchIndex += 1) {
      const sizes = batchIndex < 4 ? Array(16).fill(3) : batchIndex < 8 ? [...Array(16).fill(3), 2] : [...Array(6).fill(3), 1];
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(targets[batchIndex]);
      for (const size of sizes) {
        const group = `GROUP_${String(groupIndex).padStart(4, "0")}`;
        groupIndex += 1;
        for (const worldKey of (["CONCORD", "SCHISM", "RUIN"] as const).slice(0, size)) {
          const requestId = `REQ_${group}_${worldKey}`;
          requests.push({ requestId, entityType: "FAMILY", entityId: `FAMILY_${group}_${worldKey}`, behavior: "BATCHED", createdYear: years[batchIndex]!, nameEffectiveFromYear: years[batchIndex]!, worldKey, namingComparisonGroupId: group, comparisonAuthorityRef: `TEST_GROUP:${group}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: null, context: { creationYear: years[batchIndex]! } });
        }
      }
    }
    expect(requests).toHaveLength(411);

    let store = new SimulatorStore(filename);
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_NAMING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    store.setRunStatus(runId, "WAITING_FOR_NAMING", 25);
    store.saveV5RunManifest(manifest);
    store.appendV5CausalEvents(runId, [event]);
    const checkpoint = store.saveV5Checkpoint(runId, state, v5EventHistoryHash([event]));
    store.saveV5NamingRequests(runId, requests);
    const causalSignature = () => ({
      causalRunHash: store.loadV5RunManifest(runId)!.causalRunHash,
      eventCount: store.v5EventCount(runId),
      eventHistory: store.summarizeV5CausalEventHistory(runId, "CONCORD"),
      stateHash: store.loadLatestV5Checkpoint(runId, "CONCORD")!.stateHash,
      checkpointEventHash: store.loadLatestV5Checkpoint(runId, "CONCORD")!.eventHistoryHash,
    });
    const causalBefore = causalSignature();
    expect(causalBefore.stateHash).toBe(checkpoint.stateHash);
    const batches = store.materializePendingV5NamingBatches(runId, 50);
    expect(batches.map((batch) => batch.items.length)).toEqual(targets);
    expect([...new Set(batches.map((batch) => batch.year))].sort((a, b) => a - b)).toEqual([0, 21, 24, 25]);
    expect(batches.every((batch) => batch.batchId === `V5_NAMING_${runId}_${batch.behavior}_${batch.year}_${batch.stableRequestSetDigest}`)).toBe(true);
    const capturedIds = batches.map((batch) => batch.batchId);
    const responses = batches.map((batch, batchIndex) => ({ schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: batch.batchId, runId, decisions: batch.items.map((item, itemIndex) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `Original owner label ${batchIndex}-${itemIndex}`, nameEffectiveFromYear: item.nameEffectiveFromYear ?? item.createdYear })) }));

    const incompleteGroup = { ...responses[0]!, decisions: responses[0]!.decisions.slice(1) };
    expect(acceptPersistedV5NamingBatch({ store, runId, response: incompleteGroup }).accepted).toBe(false);
    expect(store.loadV5TrustedLabelLedger(runId).filter((entry) => entry.source === "LLM_NAMING_RESPONSE")).toHaveLength(0);

    for (let index = 0; index < responses.length; index += 1) {
      expect(store.materializePendingV5NamingBatches(runId, 50).map((batch) => batch.batchId)).toEqual(capturedIds.slice(index));
      expect(store.materializePendingV5NamingBatches(runId, 50).map((batch) => batch.batchId)).toEqual(capturedIds.slice(index));
      if (index > 0) {
        store.close();
        store = new SimulatorStore(filename);
        expect(store.materializePendingV5NamingBatches(runId, 50).map((batch) => batch.batchId)).toEqual(capturedIds.slice(index));
      }
      const accepted = acceptPersistedV5NamingBatch({ store, runId, response: responses[index] });
      expect(accepted).toMatchObject({ accepted: true, acceptedDecisions: targets[index], pendingBatched: targets.slice(index + 1).reduce((sum, count) => sum + count, 0) });
      expect(store.materializePendingV5NamingBatches(runId, 50).map((batch) => batch.batchId)).toEqual(capturedIds.slice(index + 1));
      expect(causalSignature()).toEqual(causalBefore);
      if (index === 0) expect(acceptPersistedV5NamingBatch({ store, runId, response: responses[0] }).errors.join(" ")).toMatch(/replay rejected/);
    }
    expect(store.materializePendingV5NamingBatches(runId, 50)).toEqual([]);
    const ledger = store.loadV5TrustedLabelLedger(runId).filter((entry) => entry.source === "LLM_NAMING_RESPONSE");
    expect(ledger).toHaveLength(411);
    const expectedBatchByRequest = new Map(responses.flatMap((response) => response.decisions.map((decision) => [decision.requestId, response.batchId] as const)));
    expect(ledger.every((entry) => entry.sourceRequestId && entry.sourceBatchId === expectedBatchByRequest.get(entry.sourceRequestId))).toBe(true);
    expect(store.listV5NamingBatchAudits(runId)).toHaveLength(9);
    expect(store.listV5NamingBatchAudits(runId).every((batch) => batch.promptText && batch.promptSha256 && batch.comparisonGroupingVersion && batch.createdAt && batch.items.length > 0)).toBe(true);
    expect(causalSignature()).toEqual(causalBefore);
    store.close();
    const immutable = new DatabaseSync(filename);
    expect(() => immutable.prepare("UPDATE v5_naming_batch_audit SET year=year+1 WHERE run_id=?").run(runId)).toThrow(/immutable/);
    expect(() => immutable.prepare("DELETE FROM v5_naming_batch_audit WHERE run_id=?").run(runId)).toThrow(/immutable/);
    immutable.close();
  });

  it("recovers and accepts the exact original indexed V2 batch ID while rejecting digest substitutions and replay", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-recovered-v2-")), "run.sqlite"));
    const runId = "RUN_RECOVER_EXPORTED_V2";
    const owner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
    const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 12, canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("legacy response"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, namingBatchMaximum: 50 }, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_NAMING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
    store.setRunStatus(runId, "WAITING_FOR_NAMING", 12);
    store.saveV5RunManifest(manifest);
    const requests = (["CONCORD", "SCHISM", "RUIN"] as const).map((worldKey) => ({ requestId: `REQ_${worldKey}`, entityType: "FAMILY", entityId: `FAMILY_${worldKey}`, behavior: "BATCHED" as const, createdYear: 12, nameEffectiveFromYear: 12, worldKey, namingComparisonGroupId: "FAMILY:ONE", comparisonAuthorityRef: "TEST:FAMILY:ONE", comparisonGroupingVersion: "echoes-naming-comparison-groups-v1" as const, acceptedLabel: null, context: { creationYear: 12 } }));
    store.saveV5NamingRequests(runId, requests);
    const contentBatch = buildPersistedNamingBatchesV5(runId, requests, 50)[0]!;
    const originalBatchId = `V5_NAMING_${runId}_BATCHED_12_8_${contentBatch.stableRequestSetDigest}`;
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: originalBatchId, runId, decisions: contentBatch.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `Recovered ${item.worldKey}`, nameEffectiveFromYear: 12 })) };
    const substitution = { ...response, batchId: originalBatchId.replace(contentBatch.stableRequestSetDigest, "0000000000000000") };
    expect(acceptPersistedV5NamingBatch({ store, runId, response: substitution }).errors.join(" ")).toMatch(/digest/);
    expect(store.loadV5NamingBatchAudit(runId, substitution.batchId)).toBeNull();
    expect(acceptPersistedV5NamingBatch({ store, runId, response })).toMatchObject({ accepted: true, acceptedDecisions: 3, pendingBatched: 0 });
    expect(store.loadV5NamingBatchAudit(runId, originalBatchId)).toMatchObject({ batchId: originalBatchId, displayOrdinal: 8, authorityStatus: "RECOVERED_EXPORTED_V2_BATCH", stableRequestSetDigest: contentBatch.stableRequestSetDigest });
    expect(store.loadV5TrustedLabelLedger(runId).every((entry) => entry.sourceBatchId === originalBatchId)).toBe(true);
    expect(acceptPersistedV5NamingBatch({ store, runId, response }).errors.join(" ")).toMatch(/replay rejected/);
    store.close();
  });

  it("fails causal resume closed on an older scheduler/mechanics identity before writing one byte", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "echoes-v5-version-gate-")), "run.sqlite");
    let store = new SimulatorStore(filename);
    const runId = "RUN_OLD_CAUSAL_IDENTITY";
    const current = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 25, canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("old causal"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: diagnosticCandidateOwnerInputsV1({ GOV: {} }), operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    const legacy = { ...current, mechanicsVersion: "echoes-mechanics-v5.1.0", schedulerVersion: "echoes-scheduler-v5.1.0" };
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "RUNNING", seed: "seed", seedHash: "hash", policyVersion: legacy.mechanicsVersion });
    store.saveV5RunManifest(legacy);
    store.recordV5AcceptedLabel({ ledgerEntryId: "LEDGER_VERSION_GATE", runId, worldKey: "CONCORD", entityType: "STATE", entityId: "STATE_VERSION_GATE", label: "Version Gate", source: "OWNER_INPUT", sourceRequestId: null, sourceAuthorityRef: "OWNER_AUDIT:VERSION_GATE", sourceBatchId: null, sourceResponseAttemptId: null, nameEffectiveFromYear: 0, acceptanceYear: 0, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: null, comparisonAuthorityRef: null }, "TEST");
    store.close();
    const before = createHash("sha256").update(readFileSync(filename)).digest("hex");
    store = new SimulatorStore(filename);
    expect(() => resumePersistedV5Run({ store, runId })).toThrow(/V5_CAUSAL_RESUME_VERSION_MISMATCH.*mechanicsVersion.*schedulerVersion/);
    store.close();
    expect(createHash("sha256").update(readFileSync(filename)).digest("hex")).toBe(before);
  });

  it("accepts legacy naming only without upgrading causal identity, events, or checkpoints", () => {
    const store = new SimulatorStore(join(mkdtempSync(join(tmpdir(), "echoes-v5-legacy-naming-only-")), "run.sqlite"));
    const runId = "RUN_LEGACY_NAMING_ONLY";
    const current = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 5, canonicalBundleHash: "bundle", normalizedSeed: normalizeSeed("legacy naming only"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: diagnosticCandidateOwnerInputsV1({ GOV: {} }), operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
    const legacy = { ...current, mechanicsVersion: "echoes-mechanics-v5.1.0", schedulerVersion: "echoes-scheduler-v5.1.0" };
    store.createRun({ runId, mode: "DIAGNOSTIC", status: "COMPLETE", seed: "seed", seedHash: "hash", policyVersion: legacy.mechanicsVersion });
    store.setRunStatus(runId, "COMPLETE", 5);
    store.saveV5RunManifest(legacy);
    store.appendV5CausalEvents(runId, [event]);
    const checkpoint = store.saveV5Checkpoint(runId, state, v5EventHistoryHash([event]));
    const request = { requestId: "REQ_LEGACY", entityType: "SETTLEMENT", entityId: "S1", behavior: "BATCHED" as const, createdYear: 5, nameEffectiveFromYear: 5, worldKey: "CONCORD" as const, namingComparisonGroupId: "SETTLEMENT_SITE:SITE1", comparisonAuthorityRef: "CANONICAL_SITE_ID:SITE1", comparisonGroupingVersion: "echoes-naming-comparison-groups-v1" as const, acceptedLabel: null, context: { creationYear: 5 } };
    store.saveV5NamingRequests(runId, [request]);
    const batch = buildPersistedNamingBatchesV5(runId, [request], 50)[0]!;
    store.saveV5NamingBatchAudit(batch);
    const response = { schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: batch.batchId, runId, decisions: [{ requestId: request.requestId, entityType: request.entityType, entityId: request.entityId, label: "Owner Legacy Label", nameEffectiveFromYear: 5 }] };
    const before = { causalRunHash: legacy.causalRunHash, mechanicsVersion: legacy.mechanicsVersion, schedulerVersion: legacy.schedulerVersion, causalDerivationVersion: legacy.causalDerivationVersion, events: store.listV5CausalEvents(runId, "CONCORD"), checkpoint };
    expect(acceptPersistedV5NamingBatch({ store, runId, response })).toMatchObject({ accepted: true, acceptanceMode: "LEGACY_NAMING_ONLY", acceptedDecisions: 1 });
    const after = store.loadV5RunManifest(runId)!;
    expect({ causalRunHash: after.causalRunHash, mechanicsVersion: after.mechanicsVersion, schedulerVersion: after.schedulerVersion, causalDerivationVersion: after.causalDerivationVersion, events: store.listV5CausalEvents(runId, "CONCORD"), checkpoint: store.loadLatestV5Checkpoint(runId, "CONCORD") }).toEqual({ ...before, checkpoint: { state: projectWorldStateV54ReadOnly(state), stateHash: checkpoint.stateHash, eventHistoryHash: checkpoint.eventHistoryHash } });
    expect(after.labels).toEqual({ S1: "Owner Legacy Label" });
    store.close();
  });
});
