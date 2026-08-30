import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { createAtrocityOccurrenceSlotsV5 } from "../core/v5/atrocity-slots.js";
import type { AtrocityShockDefinitionV5 } from "../core/v5/atrocities.js";
import { legacyImportTestCanonicalAuthorityV5, loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { diagnosticCandidateOwnerInputsV1, V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, V5_READ_MODEL_VERSION, V5_SCHEDULER_VERSION, type CausalOwnerInputsV1 } from "../core/v5/config.js";
import { buildDerogatoryDecisionBatchV5, type AcceptedDerogatoryDecisionBatchV5, type DerogatoryDecisionResponseV5 } from "../core/v5/derogatory-decisions.js";
import { causalStateHash } from "../core/v5/engine.js";
import { assertNoSecretEnclaveLeakV54, buildPrivateHistoricalExportV54, buildPublicHistoricalExportV54 } from "../core/v5/historical-export.js";
import { CANDIDATE_HISTORICAL_DYNAMISM_POLICIES_V1, V5_HISTORICAL_POLICY_KEYS, historicalPolicyHashV5 } from "../core/v5/historical-policies.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, extendV5EventHistoryHash } from "../core/v5/persistence.js";
import { causalPopulationTotalsV5, validatePopulationPartitionV5 } from "../core/v5/population-slices.js";
import { normalizeSeed } from "../core/v5/random.js";
import { runV5History } from "../core/v5/runner.js";
import { buildScheduledTransactionsV5 } from "../core/v5/schedule.js";
import { acceptPersistedV5DerogatoryDecisionBatch, resumePersistedV5Run, runPersistedV5Diagnostic } from "../core/v5/service.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const targetYear = targetArgument ? Number.parseInt(targetArgument.slice("--target=".length), 10) : 285;
if (!Number.isSafeInteger(targetYear) || targetYear < 285) throw new Error("Prompt 03 acceptance target must be an integer at least 285");

async function fileFingerprint(filename: string): Promise<{ path: string; exists: boolean; bytes: number; sha256: string | null }> {
  if (!existsSync(filename)) return { path: filename, exists: false, bytes: 0, sha256: null };
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => createReadStream(filename).on("data", (chunk) => hash.update(chunk)).on("end", resolvePromise).on("error", reject));
  return { path: filename, exists: true, bytes: statSync(filename).size, sha256: hash.digest("hex") };
}

async function liveFingerprints(): Promise<Awaited<ReturnType<typeof fileFingerprint>>[]> {
  const base = "/home/bobby/.config/@echoes/simulator";
  return Promise.all(["simulator.sqlite", "simulator.sqlite-wal", "simulator.sqlite-shm", "simulator-v5-trusted.sqlite", "simulator-v5-trusted.sqlite-wal", "simulator-v5-trusted.sqlite-shm"].map((name) => fileFingerprint(join(base, name))));
}

function writeArtifact(name: string, value: unknown): string {
  const filename = resolve(outputDirectory, name);
  writeFileSync(filename, `${canonicalJson(value)}\n`, "utf8");
  return filename;
}

function fixtureResponse(batch: ReturnType<typeof buildDerogatoryDecisionBatchV5>): DerogatoryDecisionResponseV5 {
  const action = batch.reviewYear === 15 ? "SELECT" as const : batch.reviewYear === 250 ? "REPLACE" as const : "KEEP" as const;
  return {
    schemaVersion: "echoes-derogatory-decision-response-v1",
    batchId: batch.batchId,
    contextSha256: batch.contextSha256,
    promptSha256: batch.promptSha256,
    provider: "V5_ACCEPTANCE_FIXTURE",
    model: "DETERMINISTIC_EXTERNAL_DECISION_FIXTURE",
    authorityRef: "ISOLATED_ACCEPTANCE_ONLY_NOT_HISTORICAL_AUTHORITY",
    decisions: batch.requests.map((request) => ({ decisionId: request.decisionId, action, selectedGroupId: action === "REPLACE" ? "beasts" : request.priorGroupId ?? "cave dwellers" })),
  };
}

function directExecution(input: { canonical: ReturnType<typeof loadBundledCanonicalV5>; ownerInputs: CausalOwnerInputsV1; accepted: readonly AcceptedDerogatoryDecisionBatchV5[]; normalizedSeed: string; targetYear: number; mechanics: ReturnType<SimulatorStore["loadV5Configuration"]>["mechanics"]; operational: ReturnType<SimulatorStore["loadV5Configuration"]>["operational"]; diagnostic: ReturnType<SimulatorStore["loadV5Configuration"]>["diagnostic"] }): { states: Record<WorldKey, WorldStateV5>; historyHashes: Record<WorldKey, string>; decisionStreamHash: string | undefined } {
  const historyHashes = { CONCORD: V5_EMPTY_EVENT_HISTORY_HASH, SCHISM: V5_EMPTY_EVENT_HISTORY_HASH, RUIN: V5_EMPTY_EVENT_HISTORY_HASH } as Record<WorldKey, string>;
  const extend = (snapshot: { yearEvents: Readonly<Record<WorldKey, readonly CausalEventV5[]>> }): void => { for (const world of WORLDS) historyHashes[world] = extendV5EventHistoryHash(historyHashes[world], snapshot.yearEvents[world]); };
  const result = runV5History({ canonical: input.canonical, ownerInputs: input.ownerInputs, mechanics: input.mechanics, operational: input.operational, diagnostic: input.diagnostic, normalizedSeed: input.normalizedSeed, mode: "DIAGNOSTIC", throughYear: input.targetYear, scheduledTransactions: buildScheduledTransactionsV5(input.canonical, input.ownerInputs, input.normalizedSeed), stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: false, acceptedDerogatoryDecisionBatches: input.accepted, onBootstrap: extend, onAtomicYear: extend });
  if (result.status !== "COMPLETE") throw new Error(`Direct acceptance execution paused unexpectedly: ${result.status}`);
  return { states: result.states, historyHashes, decisionStreamHash: result.derogatoryDecisionStreamHash };
}

const startedAt = Date.now();
const liveBefore = await liveFingerprints();
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const canonicalAuthority = legacyImportTestCanonicalAuthorityV5(resolve("resources/canonical"));
const normalizedSeed = normalizeSeed("ECHOES_V54_PROMPT03_ACCEPTANCE");
const governmentMappings = Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }]));
const baseOwner = diagnosticCandidateOwnerInputsV1(governmentMappings);
const targetScope = "SOVEREIGN_SCAPEGOAT" as const;
const slots = createAtrocityOccurrenceSlotsV5().map((slot) => slot.occurrenceId === "ATROCITY_17_A" ? { ...slot, status: "CONFIGURED" as const, triggerYear: 20, targetScope, shockDefinitionId: "PROMPT03_TEST_ATROCITY_17_A" } : slot);
const concordInitial = canonical.initialSettlements.filter((row) => row.worldKey === "CONCORD").sort((a, b) => a.settlementId.localeCompare(b.settlementId));
const host = concordInitial.find((row) => {
  const site = canonical.sites.find((candidate) => candidate.siteId === row.siteId);
  return site && [...site.terrainBroad, ...site.terrainSpecific].some((tag) => CANDIDATE_HISTORICAL_DYNAMISM_POLICIES_V1.PERSECUTION_DISPLACEMENT_ENCLAVE.underwaterTerrain.includes(tag));
});
if (!host || !concordInitial[1]) throw new Error("Acceptance fixture cannot resolve two Concord Settlements including an underwater-capable host");
const defender = host;
const attacker = concordInitial.find((row) => row.stateId !== defender.stateId)!;
const destination = concordInitial.find((row) => row.settlementId !== defender.settlementId)!;
const atrocity: AtrocityShockDefinitionV5 = {
  schemaVersion: "echoes-atrocity-shock-definition-v1", shockDefinitionId: "PROMPT03_TEST_ATROCITY_17_A", occurrenceId: "ATROCITY_17_A", triggerYear: 20,
  targetScope, authorityStatus: "TEST_FIXTURE", authorityRef: "ISOLATED_ACCEPTANCE_ONLY_NOT_HISTORICAL_AUTHORITY", worldKeys: ["CONCORD"],
  effects: [{ type: "MORTALITY", mortalityBps: 10 }, { type: "GROWTH_SUPPRESSION", modifierPpm: -50_000, durationYears: 5 }, { type: "SEIZURE", confiscationScore: 100 }, { type: "RESTRICTION", restrictionKey: "FIXTURE_MOVEMENT_RESTRICTION" }, { type: "FACTION_OPINION", faction: "RUIN", delta: -50 }, { type: "SANCTUARY", hostSettlementId: host.settlementId }, { type: "ENCLAVE_AUTHORIZATION", hostSettlementId: host.settlementId, form: "UNDERWATER", secrecyState: "HIDDEN", authorizationRef: "ISOLATED_ACCEPTANCE_AUTHORIZATION" }, { type: "DISPLACEMENT", sourceSettlementId: host.settlementId, shareBps: 100, destination: "AUTHORIZED_ENCLAVE" }],
};
const ownerInputs: CausalOwnerInputsV1 = {
  ...baseOwner,
  atrocityOccurrenceSlots: slots,
  atrocityShockDefinitions: [atrocity],
  scheduledHistoricalConflictActions: [
    { worldKey: "CONCORD" as const, action: { actionId: "EVT_CONCORD_30_PROMPT03_EMBARGO", year: 30, type: "EMBARGO" as const, stateAId: attacker.stateId, stateBId: defender.stateId, affectedSettlementIds: [defender.settlementId] } },
    { worldKey: "CONCORD" as const, action: { actionId: "EVT_CONCORD_31_PROMPT03_SIEGE", year: 31, type: "SIEGE" as const, attackerStateId: attacker.stateId, defenderStateId: defender.stateId, settlementId: defender.settlementId, displacementDestinationSettlementId: destination.settlementId } },
  ],
};

const temporaryDirectory = mkdtempSync(join(tmpdir(), "echoes-v54-prompt03-"));
const databasePath = join(temporaryDirectory, "acceptance.sqlite");
const store = new SimulatorStore(databasePath);
const configuration = store.loadV5Configuration();
store.saveV5Configuration({ ...configuration, operational: { ...configuration.operational, checkpointIntervalYears: 25, interactiveNamingEnabled: false } });
let run: ReturnType<typeof resumePersistedV5Run> = runPersistedV5Diagnostic({ store, canonicalAuthority, normalizedSeed, throughYear: targetYear, namingMode: "UNATTENDED_CAUSAL_BENCHMARK", causalOwnerInputs: ownerInputs });
while (run.status === "WAITING_FOR_DEROGATORY_DECISIONS") {
  const batch = store.listV5DerogatoryDecisionBatches(run.runId).find((candidate) => candidate.reviewYear === run.currentYear + 1);
  if (!batch) throw new Error(`Missing persisted Derogatory decision batch after year ${run.currentYear}`);
  const accepted = acceptPersistedV5DerogatoryDecisionBatch({ store, runId: run.runId, response: fixtureResponse(batch) });
  if (!accepted.accepted) throw new Error(`Acceptance fixture decision batch rejected: ${accepted.errors.join("; ")}`);
  run = resumePersistedV5Run({ store, runId: run.runId });
}
if (run.status !== "COMPLETE" || run.currentYear !== targetYear) throw new Error(`Prompt 03 persisted acceptance stopped at ${run.status}/${run.currentYear}`);

const manifest = store.loadV5RunManifest(run.runId)!;
const acceptedBatches = store.listV5AcceptedDerogatoryDecisionBatches(run.runId);
const persistedStates = Object.fromEntries(WORLDS.map((world) => [world, store.loadLatestV5Checkpoint(run.runId, world, targetYear)!.state])) as Record<WorldKey, WorldStateV5>;
const persistedCheckpoints = Object.fromEntries(WORLDS.map((world) => [world, store.loadLatestV5Checkpoint(run.runId, world, targetYear)!])) as Record<WorldKey, NonNullable<ReturnType<SimulatorStore["loadLatestV5Checkpoint"]>>>;
for (const world of WORLDS) validatePopulationPartitionV5(persistedStates[world]);
const eventTypes = Object.fromEntries(WORLDS.map((world) => [world, store.listV5CausalEvents(run.runId, world, targetYear).map((event) => event.eventType)])) as Record<WorldKey, string[]>;
const allEventTypes = WORLDS.flatMap((world) => eventTypes[world]);
for (const required of ["SettlementFounded", "MigrationTransfer", "ConclaveReformed", "SenateSeatMaterialized", "AtrocityOccurrenceResolved", "HistoricalEmbargo", "HistoricalSiege"]) if (!allEventTypes.includes(required)) throw new Error(`Acceptance did not exercise ${required}`);
if (acceptedBatches.map((batch) => batch.batch.reviewYear).join(",") !== "15,150,250") throw new Error("Acceptance did not cross exactly the 15/150/250 external-decision barriers");

const uninterrupted = directExecution({ canonical, ownerInputs, accepted: acceptedBatches, normalizedSeed, targetYear, mechanics: manifest.mechanicsVariables, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig });
const replay = directExecution({ canonical, ownerInputs, accepted: acceptedBatches, normalizedSeed, targetYear, mechanics: manifest.mechanicsVariables, operational: manifest.operationalConfig, diagnostic: manifest.diagnosticConfig });
const replayComparison = (world: WorldKey): Record<string, string> => ({
  persistedStateHash: persistedCheckpoints[world].stateHash,
  uninterruptedStateHash: causalStateHash(uninterrupted.states[world]),
  replayStateHash: causalStateHash(replay.states[world]),
  persistedEventHistoryHash: persistedCheckpoints[world].eventHistoryHash,
  uninterruptedEventHistoryHash: uninterrupted.historyHashes[world],
  replayEventHistoryHash: replay.historyHashes[world],
  populationPartitionHash: createHash("sha256").update(canonicalJson(persistedStates[world].populationSlices ?? [])).digest("hex"),
});
const replayComparisons: Record<WorldKey, Record<string, string>> = { CONCORD: replayComparison("CONCORD"), SCHISM: replayComparison("SCHISM"), RUIN: replayComparison("RUIN") };
for (const [world, comparison] of Object.entries(replayComparisons)) {
  if (new Set([comparison.persistedStateHash, comparison.uninterruptedStateHash, comparison.replayStateHash]).size !== 1) throw new Error(`State replay mismatch for ${world}`);
  if (new Set([comparison.persistedEventHistoryHash, comparison.uninterruptedEventHistoryHash, comparison.replayEventHistoryHash]).size !== 1) throw new Error(`Event replay mismatch for ${world}`);
}
if (new Set([acceptedBatches.at(-1)!.decisionStreamHash, uninterrupted.decisionStreamHash!, replay.decisionStreamHash!]).size !== 1) throw new Error("Derogatory decision stream replay mismatch");

const eventsByWorld = Object.fromEntries(WORLDS.map((world) => [world, store.listV5CausalEvents(run.runId, world, targetYear)])) as Record<WorldKey, CausalEventV5[]>;
const privateHistory = { schemaVersion: "echoes-v5.4-private-multiworld-history-v1", worlds: WORLDS.map((world) => buildPrivateHistoricalExportV54(persistedStates[world], eventsByWorld[world])) };
const publicHistory = { schemaVersion: "echoes-v5.4-public-multiworld-history-v1", worlds: WORLDS.map((world) => buildPublicHistoricalExportV54(persistedStates[world], eventsByWorld[world])) };
for (const world of WORLDS) assertNoSecretEnclaveLeakV54(persistedStates[world], publicHistory.worlds.find((row) => row.worldKey === world)!);
const privateHistoryPath = writeArtifact("v54-private-history.json", privateHistory);
const publicHistoryPath = writeArtifact("v54-public-history.json", publicHistory);
const storage = { databasePath, mainBytes: statSync(databasePath).size, walBytes: statSync(`${databasePath}-wal`, { throwIfNoEntry: false })?.size ?? 0, shmBytes: statSync(`${databasePath}-shm`, { throwIfNoEntry: false })?.size ?? 0, eventCount: store.v5EventCount(run.runId), checkpointCount: store.v5CheckpointCount(run.runId), accounting: store.v5StoragePayloadAccounting(run.runId), pages: store.v5StoragePageAccounting() };
const storageBounds = { maximumMainBytes: 1_073_741_824, maximumEventCount: 1_000_000 };
if (storage.mainBytes > storageBounds.maximumMainBytes) throw new Error(`Prompt 03 durable main database exceeded ${storageBounds.maximumMainBytes} bytes: ${storage.mainBytes}`);
if (storage.eventCount > storageBounds.maximumEventCount) throw new Error(`Prompt 03 event ledger exceeded ${storageBounds.maximumEventCount} rows: ${storage.eventCount}`);
store.close();
const liveAfter = await liveFingerprints();
const liveUnchanged = canonicalJson(liveBefore) === canonicalJson(liveAfter);
if (!liveUnchanged) throw new Error("Live simulator database main/WAL/SHM fingerprints changed during isolated Prompt 03 acceptance");

const policyReadiness = { schemaVersion: "echoes-v5.4-policy-readiness-v1", canonicalStatus: "POINT_OF_USE_FAIL_CLOSED", diagnosticOptIns: ownerInputs.diagnosticHistoricalPolicyOptIns, policies: V5_HISTORICAL_POLICY_KEYS.map((key) => ({ policyKey: key, authorityStatus: ownerInputs.historicalDynamismPolicies?.[key]?.authorityStatus, sha256: historicalPolicyHashV5(ownerInputs.historicalDynamismPolicies?.[key]), canonicalApproved: ownerInputs.historicalDynamismApprovedPolicyHashes?.[key] === historicalPolicyHashV5(ownerInputs.historicalDynamismPolicies?.[key]) })) };
const integration = { schemaVersion: "echoes-v5.4-prompt03-integration-acceptance-v1", pass: true, runId: run.runId, targetYear, versions: { scheduler: V5_SCHEDULER_VERSION, mechanics: V5_MECHANICS_VERSION, readModel: V5_READ_MODEL_VERSION, causalDerivation: V5_CAUSAL_DERIVATION_VERSION }, causalDerivationContractChanged: false, acceptedReviewYears: acceptedBatches.map((batch) => batch.batch.reviewYear), acceptedDecisionCounts: acceptedBatches.map((batch) => batch.acceptedSelections.length), fixtureAuthority: "ISOLATED_ACCEPTANCE_ONLY_NOT_HISTORICAL_AUTHORITY", exercisedEventTypes: [...new Set(allEventTypes)].filter((type) => ["SettlementFounded", "MigrationTransfer", "ConclaveReformed", "SenateSeatMaterialized", "AtrocityOccurrenceResolved", "HistoricalEmbargo", "HistoricalSiege"].includes(type)), populations: Object.fromEntries(WORLDS.map((world) => [world, Object.fromEntries(Object.entries(causalPopulationTotalsV5(persistedStates[world])).map(([key, value]) => [key, value.toString()]))])), privateHistoryPath, publicHistoryPath, elapsedMilliseconds: Date.now() - startedAt };
const replayReport = { schemaVersion: "echoes-v5.4-replay-verification-v1", pass: true, decisionStreamHash: acceptedBatches.at(-1)!.decisionStreamHash, comparisons: replayComparisons };
const fixtureReport = { schemaVersion: "echoes-v5.4-focused-fixtures-v1", focusedFixtureCount: 25, requiredDomains: ["fractional membership", "overlap fail-closed", "approved overlap", "differentiated opinion", "targeted mortality", "growth suppression", "forced transfer", "Enclave admission and integration", "SELECT KEEP REPLACE", "disabled atrocity slot", "typed atrocity", "resource geography", "40 industries", "Guild formation", "occupation versus legal membership", "all typed conflict actions", "point-of-use atomic rollback", "public secrecy redaction", "read-only v5.3 projection", "policy disclosure", "security-force enum", "21 scopes", "18 Witness slots", "immutable SQLite authority", "causal replay"] };
writeArtifact("v54-policy-readiness.json", policyReadiness);
writeArtifact("v54-policy-blocker-fixture.json", { schemaVersion: "echoes-v5.4-policy-blocker-fixture-v1", verifiedBy: "tests/unit/v5-prompt03.test.ts", requiredFields: ["policyKey", "policySha256", "policyDocument", "humanReadablePolicy", "causalOperation", "worldKey", "year", "entityType", "entityId", "requiredApproval"], atomicRollback: true });
writeArtifact("v54-fixture-coverage.json", fixtureReport);
writeArtifact("v54-integration-acceptance.json", integration);
writeArtifact("v54-replay-verification.json", replayReport);
writeArtifact("v54-storage-verification.json", { schemaVersion: "echoes-v5.4-storage-verification-v1", pass: true, boundedTargetYear: targetYear, bounds: storageBounds, ...storage });
writeArtifact("v54-live-database-nonmutation.json", { schemaVersion: "echoes-v5.4-live-database-nonmutation-v1", pass: liveUnchanged, before: liveBefore, after: liveAfter });
process.stdout.write(`${canonicalJson({ pass: true, runId: run.runId, targetYear, databasePath, outputDirectory, elapsedMilliseconds: integration.elapsedMilliseconds })}\n`);
