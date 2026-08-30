import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorldKey } from "../contracts/domain.js";
import { resolveSharedCalendar } from "../events/calendar.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { buildExportZip, verifyExportZip } from "./exporter.js";
import { canonicalV5FromRunAuthoritySnapshot } from "../../persistence/postgres-canonical.js";
import { adaptV5ToV4ReadExport, buildReadModelV1 } from "../v5/read-model.js";
import { assertNoSecretEnclaveLeakV54, buildPrivateHistoricalExportV54, buildPublicHistoricalExportV54 } from "../v5/historical-export.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const json = <T>(filename: string): T => JSON.parse(readFileSync(filename, "utf8")) as T;

function checkpointSummary(checkpoint: ReturnType<SimulatorStore["listCheckpoints"]>[number]): Record<string, unknown> {
  const state = checkpoint.state as { cohorts?: { population: string }[]; settlements?: unknown[] };
  return { year: checkpoint.year, stateHash: checkpoint.stateHash, cohortCount: state.cohorts?.length ?? 0, settlementCount: state.settlements?.length ?? 0, totalPopulation: state.cohorts?.reduce((sum, cohort) => sum + BigInt(cohort.population), 0n).toString() ?? "0", engineVersion: checkpoint.engineVersion, policyVersion: checkpoint.policyVersion };
}

export function buildPersistedCanonicalExport(store: SimulatorStore, runId: string, canonicalDirectory: string): ReturnType<typeof buildExportZip> {
  const run = store.getRun(runId);
  if (!run || run.mode !== "CANONICAL" || run.status !== "COMPLETE" || run.currentYear !== 2_000) throw new Error("Only a completed persisted V4 canonical run can be exported");
  const manifest = json<{ bundleVersion: string; breedSemanticVersion: string; breedSemanticSha256: string; ownerPolicyVersion: string; personalityPolicyVersion: string; breedDimensionPolicyVersion: string; breedFactionPolicyVersion: string; requiredFiles: Record<string, string> }>(resolve(canonicalDirectory, "canonical_bundle_manifest.json"));
  const skeleton = json<{ events: Parameters<typeof resolveSharedCalendar>[1] }>(resolve(canonicalDirectory, "reference/shared_event_skeleton.json"));
  const sharedEvents = resolveSharedCalendar(run.seed, skeleton.events);
  const allHistory = store.listHistoryRows(runId);
  const allNames = store.listAcceptedNamesForRun(runId);
  const namingJobs = store.listNamingJobs(runId);
  const worlds = Object.fromEntries(WORLDS.map((world) => {
    const settlements = store.listProjections(runId, world, 2_000, "SETTLEMENT") as Record<string, unknown>[];
    const cohorts = store.loadCohorts(runId, world, 2_000);
    const events = store.listEvents(runId, world);
    const history = allHistory.filter((row) => row.worldKey === world);
    const checkpoints = store.listCheckpoints(runId, world);
    const states = [...new Set(settlements.map((row) => String(row.stateId)))].sort().map((stateId) => ({ stateId, memberSettlementIds: settlements.filter((row) => row.stateId === stateId).map((row) => row.settlementId).sort() }));
    const names = allNames.filter((row) => row.entityId.includes(`_${world}_`) || row.entityId.startsWith(`SETTLEMENT_${world}_`));
    return [world, {
      totalPopulation: cohorts.reduce((sum, cohort) => sum + cohort.population, 0n), events, settlements,
      annual: checkpoints.map(checkpointSummary), annualStates: [], states,
      stateMembershipEvents: events.filter((event) => event.eventType === "STATE_MEMBERSHIP_CHANGED"),
      governmentEpochs: history.filter((row) => row.historyType === "GOVERNMENT_EPOCH").map((row) => row.data),
      economicEpochs: history.filter((row) => row.historyType === "ECONOMIC_EPOCH").map((row) => row.data),
      socialSummaries: history.filter((row) => row.historyType === "SOCIAL").map((row) => row.data),
      wealthSummaries: cohorts.map((cohort) => ({ cohortId: cohort.cohortId, breedId: cohort.breedId, settlementId: cohort.settlementId, wealth: cohort.wealthScore, population: cohort.population })),
      populationCheckpoints: checkpoints.map(checkpointSummary), populationDeltas: history.filter((row) => ["MIGRATION", "FOUNDING", "DJT"].includes(row.historyType)).map((row) => row.data),
      cohorts, propertyProjections: settlements.map((row) => ({ settlementId: row.settlementId, year: 2_000, propertyWinners: row.propertyWinners, dominantFaction: row.dominantFaction })),
      migrations: history.filter((row) => row.historyType === "MIGRATION").map((row) => row.data), founding: history.filter((row) => row.historyType === "FOUNDING").map((row) => row.data), djt: history.filter((row) => row.historyType === "DJT").map((row) => row.data),
      conclaveSeats: history.filter((row) => row.historyType === "INSTITUTION_CONCLAVE").map((row) => row.data), conclaveSnapshots: [], senateSeats: history.filter((row) => row.historyType === "INSTITUTION_SENATE").map((row) => row.data),
      names, renames: [], namingJobs: namingJobs.filter((row) => row.job.context.world === world), families: names.filter((row) => row.entityType === "FAMILY"),
    }];
  })) as unknown as Parameters<typeof buildExportZip>[0]["worlds"];
  const result = buildExportZip({ runId, mode: "CANONICAL", seed: run.seed, policyVersion: run.policyVersion, finalYear: 2_000, readiness: [], inputHashes: manifest.requiredFiles, sourceVersions: { canonicalBundle: manifest.bundleVersion, breedSemantics: manifest.breedSemanticVersion, breedSemanticSha256: manifest.breedSemanticSha256, ownerPolicy: manifest.ownerPolicyVersion, personalityPolicy: manifest.personalityPolicyVersion, breedDimensionPolicy: manifest.breedDimensionPolicyVersion, breedFactionPolicy: manifest.breedFactionPolicyVersion }, sharedEvents, worlds });
  verifyExportZip(result.bytes);
  return result;
}

export function buildPersistedV5Export(store: SimulatorStore, runId: string): ReturnType<typeof buildExportZip> {
  const run = store.getRun(runId);
  const manifest = store.loadV5RunManifest(runId);
  if (!run || !manifest || run.status !== "COMPLETE") throw new Error("Only a completed persisted V5 run can be exported");
  const canonical = canonicalV5FromRunAuthoritySnapshot(manifest.authoritySnapshot, manifest.canonicalBundleHash, run.currentYear ?? manifest.targetYear);
  const labels = store.loadV5Labels(runId, run.currentYear ?? manifest.targetYear);
  const worlds = Object.fromEntries(WORLDS.map((world) => {
    const checkpoint = store.loadLatestV5Checkpoint(runId, world, run.currentYear ?? manifest.targetYear);
    if (!checkpoint || checkpoint.state.year !== run.currentYear) throw new Error(`V5 export lacks final ${world} checkpoint`);
    const state = checkpoint.state;
    const compatible = adaptV5ToV4ReadExport(state, canonical, manifest.mechanicsVariables);
    const read = buildReadModelV1(state, canonical, manifest.mechanicsVariables, labels);
    const events = store.listV5CausalEvents(runId, world, state.year);
    const checkpoints = store.listV5CheckpointMetadata(runId, world, state.year);
    const privateHistoricalV54 = buildPrivateHistoricalExportV54(state, events);
    const publicHistoricalV54 = buildPublicHistoricalExportV54(state, events);
    assertNoSecretEnclaveLeakV54(state, publicHistoricalV54);
    return [world, {
      totalPopulation: BigInt(read.totalPopulation),
      events,
      settlements: compatible.settlements.map((settlement) => ({ ...settlement, name: read.settlements.find((row) => row.settlementId === settlement.settlementId)?.label ?? settlement.settlementId })),
      annual: checkpoints,
      annualStates: [],
      states: read.states,
      stateMembershipEvents: events.filter((event) => event.eventType === "StateMembershipChanged" || event.eventType === "StateSeceded"),
      governmentEpochs: events.filter((event) => event.eventType === "GovernmentTransition"),
      economicEpochs: [],
      socialSummaries: events.filter((event) => event.eventType === "TierMobilityTransfer"),
      wealthSummaries: compatible.cohorts.map((cohort) => ({ cohortId: cohort.cohortId, breedId: cohort.breedId, settlementId: cohort.settlementId, wealth: cohort.wealthScore, population: cohort.population, tiers: cohort.tiers })),
      populationCheckpoints: checkpoints,
      populationDeltas: events.filter((event) => ["NaturalDemographyCompleted", "MigrationTransfer", "FoundingTransfer", "WarEpisode"].includes(event.eventType)),
      cohorts: compatible.cohorts,
      propertyProjections: read.settlements.map((settlement) => ({ settlementId: settlement.settlementId, year: state.year, dominantFaction: settlement.dominantFaction })),
      migrations: events.filter((event) => event.eventType === "MigrationTransfer"),
      founding: events.filter((event) => event.eventType === "SettlementFounded"),
      djt: events.filter((event) => event.eventType === "DJT"),
      conclaveSeats: [], conclaveSnapshots: [], senateSeats: [],
      names: Object.entries(labels).map(([entityId, name]) => ({ entityId, name })),
      renames: [], namingJobs: store.listV5NamingRequests(runId), families: state.families, privateHistoricalV54, publicHistoricalV54,
    }];
  })) as unknown as Parameters<typeof buildExportZip>[0]["worlds"];
  const result = buildExportZip({
    runId,
    mode: manifest.mode,
    seed: run.seed,
    policyVersion: manifest.mechanicsVersion,
    finalYear: run.currentYear ?? manifest.targetYear,
    readiness: manifest.mode === "DIAGNOSTIC" ? [{ issueCode: "DIAGNOSTIC_V5", severity: "WARNING", blocksCanonical: false, message: "Diagnostic candidate policies; not canonical history." }] : [],
    inputHashes: { canonicalBundleHash: manifest.canonicalBundleHash, mechanicsVariablesHash: manifest.mechanicsVariablesHash, causalOwnerInputsHash: manifest.causalOwnerInputsHash },
    sourceVersions: { mechanics: manifest.mechanicsVersion, causalDerivations: manifest.causalDerivationVersion, scheduler: manifest.schedulerVersion, keyedRandom: manifest.keyedRandomVersion, readModel: manifest.readModelVersion },
    sharedEvents: [...canonical.canonicalEvents],
    worlds,
  });
  verifyExportZip(result.bytes);
  return result;
}
