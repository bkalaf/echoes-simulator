import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { Faction, WorldKey } from "../contracts/domain.js";
import { createReplayCheckpoint, restoreReplayCheckpoint } from "../checkpoints/checkpoint.js";
import { stableEventId } from "../events/event-store.js";
import { openValidatedZip, parseJsonLines } from "../inputs/importer.js";
import { loadUnnamedPoisBySite } from "../naming/poi-context.js";
import type { EffectiveBreedSemantics } from "../research/v4-contract.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { runCanonicalHistory, type CanonicalHistoryInput, type CanonicalHistorySettlement, type CanonicalHistoryWorld, type CanonicalHistoryYearChunk } from "./canonical-history.js";
import { CANONICAL_POLICY_VERSION } from "./canonical-authority.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const ENGINE_VERSION = "canonical-cohort-engine-v4";

interface ResumeInput { store: SimulatorStore; runId: string; canonicalDirectory: string; yearEnd?: number; autoAcceptNaming?: boolean; }

function json<T>(filename: string): T { return JSON.parse(readFileSync(filename, "utf8")) as T; }
function csv<T>(filename: string): T[] { return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true }) as T[]; }
function deserializeWorld(store: SimulatorStore, runId: string, world: WorldKey, year: number): CanonicalHistoryWorld {
  const checkpoint = store.loadCheckpoint(runId, world, year);
  if (!checkpoint) throw new Error(`Canonical resume checkpoint is missing for ${world} year ${year}`);
  if (checkpoint.policyVersion !== CANONICAL_POLICY_VERSION) throw new Error(`Canonical checkpoint uses retired data authority ${checkpoint.policyVersion}`);
  const state = restoreReplayCheckpoint(checkpoint) as { year: number; settlements: Record<string, unknown>[]; cohorts?: Record<string, unknown>[] };
  const accepted = new Map(store.listAcceptedNamesForRun(runId).filter((row) => row.entityType === "SETTLEMENT").map((row) => [row.entityId, row.name]));
  const settlements = state.settlements.map((row): CanonicalHistorySettlement => ({
    settlementId: String(row.settlementId), siteId: String(row.siteId), regionId: String(row.regionId), stateId: String(row.stateId),
    name: accepted.get(String(row.settlementId)) ?? (row.name === null || row.name === undefined ? null : String(row.name)),
    nameSource: accepted.has(String(row.settlementId)) ? "OWNER_INPUT" : (String(row.nameSource ?? "UNNAMED") as CanonicalHistorySettlement["nameSource"]),
    foundedYear: Number(row.foundedYear ?? 0), cultureId: row.cultureId ? String(row.cultureId) : null,
    cultureState: String(row.cultureState) as CanonicalHistorySettlement["cultureState"], population: BigInt(String(row.population)),
    dominantFaction: String(row.dominantFaction) as Faction, politicalForm: String(row.politicalForm), economicForm: String(row.economicForm),
    dominantBreed: String(row.dominantBreed), dominantSpeciesKind: String(row.dominantSpeciesKind) as CanonicalHistorySettlement["dominantSpeciesKind"],
    propertyWinners: (row.propertyWinners ?? {}) as Record<string, string>,
    politicalLatch: (row.politicalLatch ?? ["administrationMode", "legitimacyBasis", "authoritySource"]) as string[],
    economicLatch: (row.economicLatch ?? ["ownershipMode", "allocationMode"]) as string[],
  }));
  const cohorts = state.cohorts?.map((row): CanonicalHistoryWorld["cohorts"][number] => ({
    cohortId: String(row.cohortId), worldKey: world, settlementId: String(row.settlementId), breedId: String(row.breedId), population: BigInt(String(row.population)), wealthScore: Number(row.wealthScore), createdYear: Number(row.createdYear), originCohortId: row.originCohortId === null || row.originCohortId === undefined ? null : String(row.originCohortId), createdByEventId: String(row.createdByEventId), outboundMigrationNotBeforeYear: row.outboundMigrationNotBeforeYear === null || row.outboundMigrationNotBeforeYear === undefined ? null : Number(row.outboundMigrationNotBeforeYear),
  })) ?? store.loadCohorts(runId, world, year);
  return { world, year: state.year, settlements, cohorts };
}

export function loadCanonicalHistoryInput(input: ResumeInput): CanonicalHistoryInput {
  const run = input.store.getRun(input.runId);
  if (!run || run.mode !== "CANONICAL") throw new Error(`Unknown canonical run ${input.runId}`);
  if (run.status !== "RUNNING") throw new Error(`Canonical run ${input.runId} is not ready to resume`);
  if (run.policyVersion !== CANONICAL_POLICY_VERSION) throw new Error(`Canonical run ${input.runId} uses retired data authority ${run.policyVersion}`);
  const manifest = json<{ breedSemanticFilename: string }>(resolve(input.canonicalDirectory, "canonical_bundle_manifest.json"));
  const archive = openValidatedZip(resolve(input.canonicalDirectory, "breeds", manifest.breedSemanticFilename));
  const member = (name: string): Uint8Array => { const value = archive.entries[`${archive.prefix}${name}`]; if (!value) throw new Error(`V4 authority lacks ${name}`); return value; };
  const identities = parseJsonLines(member("canonical_breed_identities.jsonl")) as unknown as CanonicalHistoryInput["identities"];
  const semantics = parseJsonLines(member("effective_breed_semantics.jsonl")) as unknown as EffectiveBreedSemantics[];
  const currentYear = Math.max(run.currentYear ?? 0, input.store.latestCompleteCheckpointYear(run.runId, WORLDS) ?? 0);
  if (currentYear !== run.currentYear) input.store.setRunStatus(run.runId, "RUNNING", currentYear);
  const unnamedPoisBySite = loadUnnamedPoisBySite(input.canonicalDirectory);
  const sites = csv<Record<string, string>>(resolve(input.canonicalDirectory, "atlas/sites_naming_master.csv")).map((row) => ({
    siteId: row.siteId!, regionId: row.regionId!, currentSiteName: row.currentSiteName ?? "", nameStatus: row.nameStatus ?? "WORKING",
    classification: row.classification ?? "", attractivenessTier: row.attractivenessTier ?? "0", unnamedPois: unnamedPoisBySite.get(row.siteId!) ?? [],
  }));
  const adjacency = json<{ regions: Record<string, string[]> }>(resolve(input.canonicalDirectory, "reference/region_adjacency.json")).regions;
  const propertyMapping = json<CanonicalHistoryInput["propertyMapping"]>(resolve(input.canonicalDirectory, "reference/property_faction_mapping.json"));
  const politicalRows = json<{ rows: Record<string, string>[] }>(resolve(input.canonicalDirectory, "reference/political_form_mapping.json")).rows;
  const economicRows = json<{ rows: Record<string, string>[] }>(resolve(input.canonicalDirectory, "reference/economic_form_mapping.json")).rows;
  const growthPolicy = json<CanonicalHistoryInput["growthPolicy"]>(resolve(input.canonicalDirectory, "reference/growth_policy.json"));
  const sovereign = json<CanonicalHistoryInput["sovereign"]>(resolve(input.canonicalDirectory, "reference/sovereign_and_djt.json"));
  const sharedEvents = json<{ events: CanonicalHistoryInput["sharedEvents"] }>(resolve(input.canonicalDirectory, "reference/shared_event_skeleton.json")).events;
  return { runId: run.runId, seed: run.seed, yearEnd: input.yearEnd ?? 2_000, worlds: WORLDS.map((world) => deserializeWorld(input.store, run.runId, world, currentYear)), identities, semantics, sites, adjacency, propertyMapping, politicalRows, economicRows, growthPolicy, sovereign, sharedEvents, autoAcceptNaming: input.autoAcceptNaming ?? false, checkpointInterval: 5 };
}

function serializeSettlement(settlement: CanonicalHistorySettlement): Record<string, unknown> { return { ...settlement, population: settlement.population.toString(), runtimeIssues: [] }; }
function serializeCohort(cohort: CanonicalHistoryWorld["cohorts"][number]): Record<string, unknown> { return { ...cohort, population: cohort.population.toString() }; }

function persistWorldSnapshot(store: SimulatorStore, runId: string, world: CanonicalHistoryWorld, persistNormalizedCohorts = true): ReturnType<typeof createReplayCheckpoint> {
  const checkpoint = createReplayCheckpoint({ runId, worldKey: world.world, state: { year: world.year, settlements: world.settlements.map(serializeSettlement), cohorts: world.cohorts.map(serializeCohort), runtimeIssues: [] }, engineVersion: ENGINE_VERSION, policyVersion: CANONICAL_POLICY_VERSION });
  if (persistNormalizedCohorts) store.saveCohorts(runId, world.year, world.cohorts);
  for (const settlement of world.settlements) store.saveProjection(runId, world.world, world.year, "SETTLEMENT", settlement.settlementId, serializeSettlement(settlement));
  // The checkpoint row is the completion marker and is written after any
  // optional normalized state for this world has committed.
  store.saveCheckpoint(checkpoint);
  return checkpoint;
}

function persistHistoryYear(store: SimulatorStore, runId: string, year: number, chunk: CanonicalHistoryYearChunk): void {
  const sequenceByWorld = new Map<WorldKey, number>();
  for (const event of chunk.events) {
    const sequence = sequenceByWorld.get(event.world) ?? 0;
    sequenceByWorld.set(event.world, sequence + 1);
    store.upsertEvent({ eventId: stableEventId(runId, event.world, year, event.eventType, event.entityId, sequence), runId, worldKey: event.world, year, phaseOrder: 100, sequence, eventType: event.eventType, entityType: "HISTORY", entityId: event.entityId, payload: event.payload });
  }
  const migrationSummaries = chunk.migrationSummaries.filter((summary) => summary.transferCount > 0).map((summary) => ({
      worldKey: summary.world, year, historyType: "MIGRATION", entryId: `MIGRATION_SUMMARY_${summary.world}_${year}`,
      data: {
        schemaVersion: "eidolon-simulator-migration-year-summary-v1", world: summary.world, year, transferCount: summary.transferCount, population: summary.population, migrantWealth: 0,
        routes: summary.routes,
        exactRowsSha256: summary.exactRowsSha256, exactRowsRetention: "REGENERABLE_FROM_PRIOR_CHECKPOINT_AND_CANONICAL_INPUTS",
      },
    }));
  store.saveHistoryRows(runId, [
    ...migrationSummaries,
    ...chunk.founding.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "FOUNDING", entryId: `FOUNDING_${row.world}_${year}_${index}`, data: row })),
    ...chunk.djt.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "DJT", entryId: `DJT_${row.world}_${year}_${index}`, data: row })),
    ...chunk.governmentEpochs.map((row, index) => ({ worldKey: row.world, year: row.startYear, historyType: "GOVERNMENT_EPOCH", entryId: `GOV_${row.world}_${year}_${index}`, data: row })),
    ...chunk.economicEpochs.map((row, index) => ({ worldKey: row.world, year: row.startYear, historyType: "ECONOMIC_EPOCH", entryId: `ECON_${row.world}_${year}_${index}`, data: row })),
    ...chunk.social.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "SOCIAL", entryId: `SOCIAL_${row.world}_${year}_${index}`, data: row })),
    ...chunk.institutions.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: `INSTITUTION_${row.type}`, entryId: `INSTITUTION_${row.world}_${year}_${index}`, data: row })),
  ]);
}

export function persistCanonicalHistoryResult(store: SimulatorStore, runId: string, result: ReturnType<typeof runCanonicalHistory>): void {
  const checkpoints = result.worlds.map((world) => persistWorldSnapshot(store, runId, world));
  const eventsByWorld = new Map<WorldKey, typeof result.events>();
  for (const event of result.events) eventsByWorld.set(event.world, [...(eventsByWorld.get(event.world) ?? []), event]);
  for (const [world, events] of eventsByWorld) events.forEach((event, sequence) => store.appendEvent({ eventId: stableEventId(runId, world, event.year, event.eventType, event.entityId, sequence), runId, worldKey: world, year: event.year, phaseOrder: 100, sequence, eventType: event.eventType, entityType: "HISTORY", entityId: event.entityId, payload: event.payload }));
  store.saveHistoryRows(runId, [
    ...result.migrations.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "MIGRATION", entryId: `MIGRATION_${index}`, data: row })),
    ...result.founding.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "FOUNDING", entryId: `FOUNDING_${index}`, data: row })),
    ...result.djt.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "DJT", entryId: `DJT_${index}`, data: row })),
    ...result.governmentEpochs.map((row, index) => ({ worldKey: row.world, year: row.startYear, historyType: "GOVERNMENT_EPOCH", entryId: `GOV_${index}`, data: row })),
    ...result.economicEpochs.map((row, index) => ({ worldKey: row.world, year: row.startYear, historyType: "ECONOMIC_EPOCH", entryId: `ECON_${index}`, data: row })),
    ...result.social.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: "SOCIAL", entryId: `SOCIAL_${index}`, data: row })),
    ...result.institutions.map((row, index) => ({ worldKey: row.world, year: row.year, historyType: `INSTITUTION_${row.type}`, entryId: `INSTITUTION_${index}`, data: row })),
  ]);
  if (result.status === "WAITING_FOR_NAMING") store.persistNamingBarriers(result.namingJobs, checkpoints);
  else {
    for (const checkpoint of checkpoints) store.saveCheckpoint(checkpoint);
    store.setRunStatus(runId, "COMPLETE", result.currentYear);
  }
}

export function resumeCanonicalRun(input: ResumeInput): ReturnType<typeof runCanonicalHistory> {
  const historyInput = loadCanonicalHistoryInput(input);
  const persistedWorldsByYear = new Map<number, Set<WorldKey>>();
  historyInput.onCheckpoint = (world) => {
    persistWorldSnapshot(input.store, input.runId, world, false);
    const persistedWorlds = persistedWorldsByYear.get(world.year) ?? new Set<WorldKey>();
    persistedWorlds.add(world.world);
    persistedWorldsByYear.set(world.year, persistedWorlds);
    if (persistedWorlds.size === WORLDS.length) input.store.setRunStatus(input.runId, "RUNNING", world.year);
  };
  historyInput.onHistoryYear = (year, chunk) => { persistHistoryYear(input.store, input.runId, year, chunk); };
  const result = runCanonicalHistory(historyInput);
  persistCanonicalHistoryResult(input.store, input.runId, result);
  return result;
}
