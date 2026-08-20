import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorldKey } from "../contracts/domain.js";
import { resolveSharedCalendar } from "../events/calendar.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { buildExportZip, verifyExportZip } from "./exporter.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const json = <T>(filename: string): T => JSON.parse(readFileSync(filename, "utf8")) as T;

function checkpointSummary(checkpoint: ReturnType<SimulatorStore["listCheckpoints"]>[number]): Record<string, unknown> {
  const state = checkpoint.state as { cohorts?: { population: string }[]; settlements?: unknown[] };
  return { year: checkpoint.year, stateHash: checkpoint.stateHash, cohortCount: state.cohorts?.length ?? 0, settlementCount: state.settlements?.length ?? 0, totalPopulation: state.cohorts?.reduce((sum, cohort) => sum + BigInt(cohort.population), 0n).toString() ?? "0", engineVersion: checkpoint.engineVersion, policyVersion: checkpoint.policyVersion };
}

export function buildPersistedCanonicalExport(store: SimulatorStore, runId: string, canonicalDirectory: string): ReturnType<typeof buildExportZip> {
  const run = store.getRun(runId);
  if (!run || run.mode !== "CANONICAL" || run.status !== "COMPLETE" || run.currentYear !== 2_000) throw new Error("Only a completed persisted V4 canonical run can be exported");
  const manifest = json<{ bundleVersion: string; breedSemanticVersion: string; breedSemanticSha256: string; ownerPolicyVersion: string; personalityPolicyVersion: string; requiredFiles: Record<string, string> }>(resolve(canonicalDirectory, "canonical_bundle_manifest.json"));
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
  const result = buildExportZip({ runId, mode: "CANONICAL", seed: run.seed, policyVersion: run.policyVersion, finalYear: 2_000, readiness: [], inputHashes: manifest.requiredFiles, sourceVersions: { canonicalBundle: manifest.bundleVersion, breedSemantics: manifest.breedSemanticVersion, breedSemanticSha256: manifest.breedSemanticSha256, ownerPolicy: manifest.ownerPolicyVersion, personalityPolicy: manifest.personalityPolicyVersion }, sharedEvents, worlds });
  verifyExportZip(result.bytes);
  return result;
}
