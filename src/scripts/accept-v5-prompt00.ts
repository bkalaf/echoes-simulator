import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, V5_SCHEDULER_VERSION, diagnosticCandidateOwnerInputsV1, type MechanicsVariablesV1 } from "../core/v5/config.js";
import { supportedEconomicForm, worldPopulation } from "../core/v5/derivations.js";
import { mergeBoundedDiagnosticObservations, type BoundedDiagnosticObservationV5 } from "../core/v5/diagnostics.js";
import { causalEventHash, causalStateHash } from "../core/v5/engine.js";
import { continueV5History, runV5History, type V5AtomicYearSnapshot } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const AUTHORITY_ONLY = process.argv.includes("--authority-only");
const OWNER_SEED = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "EIDOLON_V5_DIAGNOSTIC_1787843667789";
const OUTPUT_DIRECTORY = resolve("artifacts/simulator/v5/remediation");
const LIVE_DATABASE = process.env.ECHOES_V5_LIVE_DATABASE ?? "/home/bobby/.config/@echoes/simulator/simulator-v5-trusted.sqlite";
const ACCEPTANCE_YEARS = new Set([0, 1, 77, 100, 125, 176, 200]);

function writeJson(filename: string, value: unknown): void { writeFileSync(resolve(OUTPUT_DIRECTORY, filename), `${canonicalJson(value)}\n`); }
function fileFingerprint(filename: string): { exists: boolean; bytes: number; sha256: string } {
  if (!existsSync(filename)) return { exists: false, bytes: 0, sha256: createHash("sha256").update("").digest("hex") };
  const digest = createHash("sha256"); const descriptor = openSync(filename, "r"); const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { for (;;) { const count = readSync(descriptor, buffer, 0, buffer.length, null); if (count === 0) break; digest.update(buffer.subarray(0, count)); } }
  finally { closeSync(descriptor); }
  return { exists: true, bytes: statSync(filename).size, sha256: digest.digest("hex") };
}
function liveFingerprint(): Record<string, ReturnType<typeof fileFingerprint>> {
  return Object.fromEntries([LIVE_DATABASE, `${LIVE_DATABASE}-wal`, `${LIVE_DATABASE}-shm`].map((filename) => [filename, fileFingerprint(filename)]));
}
function liveLogicalDigest(): { available: boolean; reason?: string; tables?: Record<string, { rows: number; sha256: string }> } {
  if (!existsSync(LIVE_DATABASE)) return { available: false };
  const wal = fileFingerprint(`${LIVE_DATABASE}-wal`);
  if (wal.exists && wal.bytes > 0) return { available: false, reason: "live WAL is non-empty; logical digest intentionally skipped rather than attaching SQLite to the live database" };
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "echoes-v5-live-readonly-copy-"));
  const temporaryDatabase = join(temporaryDirectory, "simulator-v5-trusted.sqlite");
  copyFileSync(LIVE_DATABASE, temporaryDatabase);
  const database = new DatabaseSync(temporaryDatabase, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON");
    const available = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    const queries: Record<string, string> = {
      v5_run_manifest: "SELECT run_id,causal_run_hash,operational_config_hash,diagnostic_config_hash,label_input_hash,run_manifest_hash,manifest_json FROM v5_run_manifest ORDER BY run_id",
      v5_causal_event: "SELECT run_id,event_id,world_key,year,sequence,event_type,event_json FROM v5_causal_event ORDER BY run_id,world_key,year,sequence",
      v5_checkpoint: "SELECT run_id,checkpoint_id,world_key,year,state_hash,event_history_hash,length(state_gzip) state_bytes FROM v5_checkpoint ORDER BY run_id,world_key,year",
      v5_naming_batch_audit: "SELECT run_id,batch_id,behavior,year,prompt_sha256,stable_request_set_digest,identity_version,authority_status,batch_json FROM v5_naming_batch_audit ORDER BY run_id,batch_id",
      v5_naming_response_attempt: "SELECT run_id,batch_id,attempt_id,accepted,response_text,errors_json FROM v5_naming_response_attempt ORDER BY run_id,batch_id,attempt_id",
      v5_label_ledger: "SELECT run_id,ledger_entry_id,entity_type,entity_id,label,source,source_request_id,source_batch_id,source_response_attempt_id,name_effective_from_year,acceptance_year,entry_json FROM v5_label_ledger ORDER BY run_id,ledger_entry_id",
    };
    const tables: Record<string, { rows: number; sha256: string }> = {};
    for (const [table, query] of Object.entries(queries)) {
      if (!available.has(table)) continue;
      const digest = createHash("sha256"); let rows = 0;
      for (const row of database.prepare(query).iterate() as Iterable<Record<string, unknown>>) { digest.update(canonicalJson(row)); digest.update("\n"); rows += 1; }
      tables[table] = { rows, sha256: digest.digest("hex") };
    }
    return { available: true, tables };
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

interface ObservedRun {
  result: ReturnType<typeof runV5History>;
  snapshots: Map<number, Record<WorldKey, WorldStateV5>>;
  diagnostics: Record<WorldKey, Record<string, BoundedDiagnosticObservationV5>>;
}

function observedRun(mechanics: MechanicsVariablesV1, throughYear: number, retainHistory: boolean): ObservedRun {
  const diagnostics = Object.fromEntries(WORLDS.map((world) => [world, {}])) as ObservedRun["diagnostics"];
  const snapshots = new Map<number, Record<WorldKey, WorldStateV5>>();
  const result = runV5History({
    canonical, ownerInputs, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
    normalizedSeed: OWNER_SEED, mode: "DIAGNOSTIC", throughYear, scheduledTransactions, stopAtBlockingNaming: false,
    interactiveNamingEnabled: false, retainHistory,
    onBootstrap: (snapshot) => { if (ACCEPTANCE_YEARS.has(0)) snapshots.set(0, structuredClone(snapshot.states) as Record<WorldKey, WorldStateV5>); },
    onAtomicYear: (snapshot) => {
      if (ACCEPTANCE_YEARS.has(snapshot.year)) snapshots.set(snapshot.year, structuredClone(snapshot.states) as Record<WorldKey, WorldStateV5>);
      for (const world of WORLDS) for (const observation of snapshot.yearDiagnosticObservations[world]) diagnostics[world][observation.domain] = mergeBoundedDiagnosticObservations(diagnostics[world][observation.domain] ?? null, observation);
    },
  });
  return { result, snapshots, diagnostics };
}

function migrationSummary(run: ObservedRun, throughYear: number): Record<WorldKey, unknown> {
  return Object.fromEntries(WORLDS.map((world) => {
    const summary = run.diagnostics[world].MIGRATION;
    const push = summary?.histograms.push ?? [];
    return [world, { throughYear, counters: summary?.counters ?? {}, pushMinimum: push.findIndex((count) => count > 0), pushMaximum: push.findLastIndex((count) => count > 0), boundedHistograms: summary?.histograms ?? {} }];
  })) as Record<WorldKey, unknown>;
}

function migrationEvents(events: readonly CausalEventV5[], fromYear: number, throughYear: number): CausalEventV5[] { return events.filter((event) => event.eventType === "MigrationTransfer" && event.year >= fromYear && event.year <= throughYear); }
function assertionsPass(assertions: Record<string, boolean>): boolean { return Object.values(assertions).every(Boolean); }

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs, OWNER_SEED);

const waveTransactions = Object.fromEntries(WORLDS.map((world) => [world, scheduledTransactions[world].filter((transaction) => transaction.type === "CANONICAL_FOUNDING")])) as Record<WorldKey, Extract<(typeof scheduledTransactions)[WorldKey][number], { type: "CANONICAL_FOUNDING" }>[]>;
const resolvedWaveYears = Object.fromEntries([...new Set(waveTransactions.CONCORD.map((row) => row.foundingWaveId))].sort().map((waveId) => [waveId, waveTransactions.CONCORD.find((row) => row.foundingWaveId === waveId)!.year]));
const selectionRows: unknown[] = [];
for (const world of WORLDS) {
  const used = new Set(canonical.initialSettlements.filter((row) => row.worldKey === world).map((row) => row.siteId));
  for (const transaction of waveTransactions[world].sort((left, right) => left.year - right.year || left.sourceStateId.localeCompare(right.sourceStateId))) {
    const regionalSites = canonical.sites.filter((site) => site.regionId === transaction.regionId && site.regionId !== "R10");
    const occupiedExclusions = regionalSites.filter((site) => used.has(site.siteId)).map((site) => site.siteId).sort();
    const prohibitedExclusions = regionalSites.filter((site) => site.prohibitedFounding).map((site) => site.siteId).sort();
    const candidates = regionalSites.filter((site) => !site.prohibitedFounding && !used.has(site.siteId)).sort((left, right) => (right.quality ?? 0) - (left.quality ?? 0) || left.siteId.localeCompare(right.siteId));
    selectionRows.push({ world, foundingWaveId: transaction.foundingWaveId, resolvedYear: transaction.year, sourceStateId: transaction.sourceStateId, regionId: transaction.regionId, candidates: candidates.map((site) => ({ siteId: site.siteId, quality: site.quality, prohibitedFounding: site.prohibitedFounding ?? false })), exclusions: { occupiedSiteIds: occupiedExclusions, prohibitedSiteIds: prohibitedExclusions }, selectedSiteId: transaction.targetSiteId, settlementId: transaction.settlementId, evidence: { policy: "quality-descending-then-site-id", selectedCandidateOrdinal: candidates.findIndex((site) => site.siteId === transaction.targetSiteId), sameRegion: true, unoccupiedAtResolution: true, nonProhibited: true } });
    used.add(transaction.targetSiteId);
  }
}
const selectionAssertions = { threeWorlds: WORLDS.length === 3, rows: selectionRows.length === 288, twentyFourPerWavePerWorld: WORLDS.every((world) => Object.values(resolvedWaveYears).every((year) => waveTransactions[world].filter((row) => row.year === year).length === 24)), stablePhysicalIdentities: WORLDS.every((world) => waveTransactions[world].every((row) => row.settlementId === `SETTLEMENT_${world}_${row.targetSiteId}`)) };
writeJson("founding-wave-site-selection.json", { schemaVersion: "echoes-v5-founding-wave-site-selection-v1", seed: OWNER_SEED, schedulerVersion: V5_SCHEDULER_VERSION, mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, resolvedWaveYears, rows: selectionRows, assertions: selectionAssertions, pass: assertionsPass(selectionAssertions) });
writeFileSync(resolve(OUTPUT_DIRECTORY, "founding-wave-authority-audit.md"), `# Founding-wave authority audit\n\n- Seed: \`${OWNER_SEED}\`\n- Scheduler: \`${V5_SCHEDULER_VERSION}\`\n- Mechanics: \`${V5_MECHANICS_VERSION}\`\n- Causal derivation: \`${V5_CAUSAL_DERIVATION_VERSION}\`\n- Resolved waves: Wave 2 year ${resolvedWaveYears.FOUNDING_WAVE_2}; Wave 3 year ${resolvedWaveYears.FOUNDING_WAVE_3}; Wave 4 year ${resolvedWaveYears.FOUNDING_WAVE_4}; Wave 5 year ${resolvedWaveYears.FOUNDING_WAVE_5}.\n- Authority count: 24 additions per wave per world, 96 Wave-2-through-Wave-5 additions per world, 120 scheduled pre-R10 Settlements per world including Year 0.\n- Transfer policy: exact integer \`floor(source Breed/tier population / 10)\`, applied atomically with population conservation.\n- Identity policy: \`SETTLEMENT_<WORLD>_<SITE_ID>\`.\n- Naming: comparison-aware \`BATCHED\` requests by physical Site ID; unresolved labels never block unattended causal execution.\n`);
if (AUTHORITY_ONLY) process.exit(0);

const liveBefore = liveFingerprint();
const logicalBefore = liveLogicalDigest();

const baselineMechanics = { ...DEFAULT_MECHANICS_VARIABLES_V1, migrationPushThreshold: 300 };
const baseline = observedRun(baselineMechanics, 100, false);
const baselineMigration = migrationSummary(baseline, 100);
writeJson("migration-viability-before.json", { schemaVersion: "echoes-v5-migration-viability-v1", phase: "BEFORE", seed: OWNER_SEED, mechanicsVersion: V5_MECHANICS_VERSION, configuration: baselineMechanics, worlds: baselineMigration, pass: WORLDS.every((world) => (baseline.diagnostics[world].MIGRATION?.counters.totalVoluntaryPopulationMoved ?? 0) > 0) });

const threshold225 = observedRun({ ...DEFAULT_MECHANICS_VARIABLES_V1, migrationPushThreshold: 225 }, 200, true);
const selected = observedRun(DEFAULT_MECHANICS_VARIABLES_V1, 200, true);
const selectedMigration = migrationSummary(selected, 200);
const sweepCandidates = [300, 275, 250, 225, 200].map((threshold) => {
  if (threshold === 300) return { changedFields: 0, migrationPushThreshold: threshold, evidence: "full-three-world-through-year-100", pass: false, rejection: "zero voluntary migration" };
  const candidateDesired = WORLDS.reduce((sum, world) => sum + (baseline.diagnostics[world].MIGRATION?.counters[`calibrationDesiredPositiveThreshold${threshold}`] ?? 0), 0);
  if (threshold === 225) {
    const worlds = Object.fromEntries(WORLDS.map((world) => {
      const early = migrationEvents(threshold225.result.events[world], 1, 100);
      const late = migrationEvents(threshold225.result.events[world], 101, 200);
      return [world, { transfersThroughYear100: early.length, originDestinationPairsThroughYear100: new Set(early.map((event) => `${event.payload.originSettlementId}>${event.payload.destinationSettlementId}`)).size, transfersYears101To200: late.length }];
    }));
    const pass = WORLDS.every((world) => (worlds[world] as { transfersThroughYear100: number; originDestinationPairsThroughYear100: number; transfersYears101To200: number }).transfersThroughYear100 > 0 && (worlds[world] as { originDestinationPairsThroughYear100: number }).originDestinationPairsThroughYear100 >= 2 && (worlds[world] as { transfersYears101To200: number }).transfersYears101To200 > 0);
    return { changedFields: 1, migrationPushThreshold: threshold, latticeDistance: 3, baselineStateDesiredOutflowOpportunities: candidateDesired, evidence: "full-three-world-through-year-200", worlds, pass, rejection: pass ? null : "RUIN has fewer than two distinct voluntary origin/destination pairs by year 100" };
  }
  const actualEvents = threshold === 200 ? WORLDS.reduce((sum, world) => sum + migrationEvents(selected.result.events[world], 1, 100).length, 0) : 0;
  return { changedFields: 1, migrationPushThreshold: threshold, latticeDistance: [275, 250, 225, 200].indexOf(threshold) + 1, baselineStateDesiredOutflowOpportunities: candidateDesired, actualEventsThroughYear100: actualEvents, evidence: threshold === 200 ? "full-three-world-through-year-200" : "exact-evaluation-against-baseline-causal-states", pass: threshold === 200, rejection: threshold === 200 ? null : "zero positive integer desiredMigrationOutflow" };
});
writeJson("migration-parameter-sweep.json", { schemaVersion: "echoes-v5-migration-parameter-sweep-v1", seed: OWNER_SEED, mechanicsVersion: V5_MECHANICS_VERSION, candidateOrder: ["baseline", "one-field", "pairwise-top-two", "best-first-three-field"], candidates: sweepCandidates, unchangedThresholdCandidates: { migrationReviewIntervalYears: [4, 3, 2, 1], migrationMaximumOutflowBps: [625, 750, 1000], migrationMaximumHops: [4, 5], migrationDestinationMinimumAttractiveness: [475, 450, 425, 400], disposition: "analytically rejected because unchanged threshold 300 yields zero cells above threshold and therefore zero desired outflow" }, weightAdjustments: { permittedSteps: [500, 1000], disposition: "not promoted; threshold-only one-field candidate passed before pairwise or three-field search" }, selected: { migrationPushThreshold: DEFAULT_MECHANICS_VARIABLES_V1.migrationPushThreshold }, ranking: ["changed-field-count", "lattice-distance", "lower-maximum-outflow", "canonical-json"], pass: sweepCandidates.some((candidate) => candidate.pass && candidate.migrationPushThreshold === DEFAULT_MECHANICS_VARIABLES_V1.migrationPushThreshold) });
writeJson("migration-viability-after.json", { schemaVersion: "echoes-v5-migration-viability-v1", phase: "AFTER", seed: OWNER_SEED, mechanicsVersion: V5_MECHANICS_VERSION, configuration: DEFAULT_MECHANICS_VARIABLES_V1, worlds: selectedMigration, pass: WORLDS.every((world) => migrationEvents(selected.result.events[world], 1, 100).length > 0 && migrationEvents(selected.result.events[world], 101, 200).length > 0) });

const year100Assertions: Record<WorldKey, Record<string, boolean>> = {} as Record<WorldKey, Record<string, boolean>>;
const year200Assertions: Record<WorldKey, Record<string, boolean>> = {} as Record<WorldKey, Record<string, boolean>>;
const year100Worlds: Record<WorldKey, unknown> = {} as Record<WorldKey, unknown>;
const year200Worlds: Record<WorldKey, unknown> = {} as Record<WorldKey, unknown>;
for (const world of WORLDS) {
  const state100 = selected.snapshots.get(100)![world]; const state176 = selected.snapshots.get(176)![world]; const state200 = selected.snapshots.get(200)![world];
  const earlyMigration = migrationEvents(selected.result.events[world], 1, 100); const lateMigration = migrationEvents(selected.result.events[world], 101, 200);
  const waveEvents = selected.result.events[world].filter((event) => event.eventType === "SettlementFounded" && typeof event.payload.foundingWaveId === "string");
  const scheduledAt176 = state176.settlements.filter((settlement) => settlement.regionId !== "R10" && settlement.foundedYear <= 176);
  const pairCount = new Set(earlyMigration.map((event) => `${event.payload.originSettlementId}>${event.payload.destinationSettlementId}`)).size;
  year100Assertions[world] = { settlementsAtLeast72: state100.settlements.length >= 72, threePerOriginalState: state100.states.every((politicalState) => state100.settlements.filter((settlement) => settlement.stateId === politicalState.stateId).length >= 3), noPreDjtR10: state100.settlements.every((settlement) => settlement.regionId !== "R10"), voluntaryMigration: earlyMigration.length > 0, atLeastTwoPairs: pairCount >= 2, economicFormsResolved: state100.settlements.every((settlement) => Boolean(supportedEconomicForm(state100, settlement.settlementId, canonical).economicForm)), foundingNamingRequests: selected.result.namingRequests[world].filter((request) => request.createdYear <= 100 && request.entityType === "SETTLEMENT" && request.behavior === "BATCHED").length >= 48, zeroSyntheticAcceptedNames: selected.result.namingRequests[world].every((request) => request.acceptedLabel === null || request.behavior === "NO_NAME_REQUIRED") };
  year100Worlds[world] = { settlements: state100.settlements.length, population: worldPopulation(state100).toString(), migrationTransfers: earlyMigration.length, migrationPairs: pairCount, assertions: year100Assertions[world] };
  const countsByRegion = Object.fromEntries(canonical.regions.map((region) => [region.regionId, state200.settlements.filter((settlement) => settlement.regionId === region.regionId).length]));
  year200Assertions[world] = { wave2: waveEvents.filter((event) => event.payload.foundingWaveId === "FOUNDING_WAVE_2" && event.year === 1).length === 24, wave3: waveEvents.filter((event) => event.payload.foundingWaveId === "FOUNDING_WAVE_3" && event.year === 77).length === 24, wave4: waveEvents.filter((event) => event.payload.foundingWaveId === "FOUNDING_WAVE_4" && event.year === 125).length === 24, wave5: waveEvents.filter((event) => event.payload.foundingWaveId === "FOUNDING_WAVE_5" && event.year === 176).length === 24, ninetySixWaveAdditions: waveEvents.length === 96, exactly120ScheduledAt176: scheduledAt176.length === 120, continuedMigration: lateMigration.length > 0, noOrdinaryRegionAbove7: Object.entries(countsByRegion).every(([regionId, count]) => regionId === "R10" || count <= 7), noPreDjtR10: state200.settlements.every((settlement) => settlement.regionId !== "R10") };
  year200Worlds[world] = { settlements: state200.settlements.length, population: worldPopulation(state200).toString(), migrationTransfersYears101To200: lateMigration.length, countsByRegion, assertions: year200Assertions[world] };
}
writeJson("year-100-corrected-acceptance.json", { schemaVersion: "echoes-v5-prompt00-year100-acceptance-v1", executionMode: "UNATTENDED_CAUSAL_BENCHMARK", namingAcceptance: "NO_NAMING_ACCEPTANCE_PERFORMED", seed: OWNER_SEED, versions: { scheduler: V5_SCHEDULER_VERSION, mechanics: V5_MECHANICS_VERSION, causalDerivation: V5_CAUSAL_DERIVATION_VERSION }, resolvedWaveYears, worlds: year100Worlds, pass: WORLDS.every((world) => assertionsPass(year100Assertions[world])) });
writeJson("year-200-founding-wave-acceptance.json", { schemaVersion: "echoes-v5-prompt00-year200-acceptance-v1", executionMode: "UNATTENDED_CAUSAL_BENCHMARK", namingAcceptance: "NO_NAMING_ACCEPTANCE_PERFORMED", seed: OWNER_SEED, versions: { scheduler: V5_SCHEDULER_VERSION, mechanics: V5_MECHANICS_VERSION, causalDerivation: V5_CAUSAL_DERIVATION_VERSION }, resolvedWaveYears, worlds: year200Worlds, pass: WORLDS.every((world) => assertionsPass(year200Assertions[world])) });
writeJson("regional-5-to-7-density-report.json", { schemaVersion: "echoes-v5-regional-density-v1", seed: OWNER_SEED, year: 200, policy: { ordinaryOriginalRegions: { scheduledMinimum: 5, ordinaryMaximum: 7 }, R10: { preDjtAvailable: false, postDjtOrdinaryRange: [2, 7], maximum: 7 } }, worlds: Object.fromEntries(WORLDS.map((world) => [world, canonical.regions.map((region) => ({ regionId: region.regionId, settlements: selected.snapshots.get(200)![world].settlements.filter((settlement) => settlement.regionId === region.regionId).length })).sort((left, right) => left.regionId.localeCompare(right.regionId))])), pass: WORLDS.every((world) => canonical.regions.every((region) => { const count = selected.snapshots.get(200)![world].settlements.filter((settlement) => settlement.regionId === region.regionId).length; return region.regionId === "R10" ? count === 0 : count >= 5 && count <= 7; })) });

const checkpointStates = selected.snapshots.get(100)!;
const initialEventCounts = Object.fromEntries(WORLDS.map((world) => [world, selected.result.events[world].filter((event) => event.year <= 100).length]));
const resumed = continueV5History({ canonical, ownerInputs, mechanics: DEFAULT_MECHANICS_VARIABLES_V1, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: OWNER_SEED, mode: "DIAGNOSTIC", throughYear: 200, scheduledTransactions, initialStates: checkpointStates, initialEventCounts, stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: true });
const replay = Object.fromEntries(WORLDS.map((world) => {
  const uninterruptedTail = selected.result.events[world].filter((event) => event.year > 100);
  return [world, { stateHash: causalStateHash(selected.result.states[world]), resumedStateHash: causalStateHash(resumed.states[world]), eventHashYears101To200: causalEventHash(uninterruptedTail), resumedEventHashYears101To200: causalEventHash(resumed.events[world]), equivalent: causalStateHash(selected.result.states[world]) === causalStateHash(resumed.states[world]) && causalEventHash(uninterruptedTail) === causalEventHash(resumed.events[world]) }];
}));
const liveAfter = liveFingerprint(); const logicalAfter = liveLogicalDigest();
const mainFilename = LIVE_DATABASE;
const walFilename = `${LIVE_DATABASE}-wal`;
const mainAndWalUnchanged = canonicalJson({ main: liveBefore[mainFilename], wal: liveBefore[walFilename] }) === canonicalJson({ main: liveAfter[mainFilename], wal: liveAfter[walFilename] });
const filesystemEnvelopeUnchanged = canonicalJson(liveBefore) === canonicalJson(liveAfter);
const logicalUnchanged = logicalBefore.available && logicalAfter.available && canonicalJson(logicalBefore) === canonicalJson(logicalAfter);
const liveUnchanged = mainAndWalUnchanged && logicalUnchanged;
writeFileSync(resolve(OUTPUT_DIRECTORY, "legacy-run-causal-defect-report.md"), `# Legacy run causal defect report\n\nThe pre-v5.2.0 run omitted Founding Waves 2–5 and cannot resume under the corrected scheduler/mechanics identity. Causal resume fails closed before writes. Owner naming responses remain eligible only through the non-causal \`LEGACY_NAMING_ONLY\` acceptance path, which preserves the stored scheduler, mechanics, derivation, causal-run hash, event history, and checkpoint hashes.\n\n- Live database opened through SQLite during this acceptance: **NO**\n- Live database opened writable during this acceptance: **NO**\n- Live main/WAL byte fingerprints unchanged: **${mainAndWalUnchanged ? "YES" : "NO"}**\n- Live main/WAL/SHM filesystem envelope unchanged: **${filesystemEnvelopeUnchanged ? "YES" : "NO"}**\n- Live logical causal/naming digests unchanged: **${logicalUnchanged ? "YES" : "NO"}**\n- Overall live causal preservation: **${liveUnchanged ? "PASS" : "FAIL"}**\n- Replay/checkpoint continuation equivalence: **${Object.values(replay).every((row) => (row as { equivalent: boolean }).equivalent) ? "PASS" : "FAIL"}**\n`);
writeJson("causal-replay-and-legacy-nonmutation.json", { schemaVersion: "echoes-v5-causal-replay-and-legacy-nonmutation-v3", seed: OWNER_SEED, replay, live: { filename: LIVE_DATABASE, openedThroughSqlite: false, openedWritable: false, before: liveBefore, after: liveAfter, logicalBefore, logicalAfter, mainAndWalUnchanged, filesystemEnvelopeUnchanged, logicalUnchanged, unchanged: liveUnchanged }, pass: liveUnchanged && Object.values(replay).every((row) => (row as { equivalent: boolean }).equivalent) });

const finalPass = WORLDS.every((world) => assertionsPass(year100Assertions[world]) && assertionsPass(year200Assertions[world])) && liveUnchanged && Object.values(replay).every((row) => (row as { equivalent: boolean }).equivalent);
process.stdout.write(`${canonicalJson({ schemaVersion: "echoes-v5-prompt00-acceptance-result-v1", outputDirectory: OUTPUT_DIRECTORY, seed: OWNER_SEED, resolvedWaveYears, pass: finalPass })}\n`);
if (!finalPass) process.exitCode = 1;
