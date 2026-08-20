import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { Faction, WorldKey } from "../contracts/domain.js";
import { createReplayCheckpoint, restoreReplayCheckpoint } from "../checkpoints/checkpoint.js";
import { stableEventId } from "../events/event-store.js";
import { openValidatedZip, parseJsonLines } from "../inputs/importer.js";
import type { EffectiveBreedSemantics } from "../research/v4-contract.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { runCanonicalHistory, type CanonicalHistoryInput, type CanonicalHistorySettlement, type CanonicalHistoryWorld } from "./canonical-history.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const ENGINE_VERSION = "canonical-cohort-engine-v4";
const POLICY_VERSION = "eidolon-simulator-owner-policy-v1@2026-08-18";

interface ResumeInput { store: SimulatorStore; runId: string; canonicalDirectory: string; yearEnd?: number; autoAcceptNaming?: boolean; }

function json<T>(filename: string): T { return JSON.parse(readFileSync(filename, "utf8")) as T; }
function csv<T>(filename: string): T[] { return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true }) as T[]; }
function deserializeWorld(store: SimulatorStore, runId: string, world: WorldKey, year: number): CanonicalHistoryWorld {
  const checkpoint = store.loadCheckpoint(runId, world, year);
  if (!checkpoint) throw new Error(`Canonical resume checkpoint is missing for ${world} year ${year}`);
  const state = restoreReplayCheckpoint(checkpoint) as { year: number; settlements: Record<string, unknown>[] };
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
  return { world, year: state.year, settlements, cohorts: store.loadCohorts(runId, world, year) };
}

export function loadCanonicalHistoryInput(input: ResumeInput): CanonicalHistoryInput {
  const run = input.store.getRun(input.runId);
  if (!run || run.mode !== "CANONICAL") throw new Error(`Unknown canonical run ${input.runId}`);
  if (run.status !== "RUNNING") throw new Error(`Canonical run ${input.runId} is not ready to resume`);
  const manifest = json<{ breedSemanticFilename: string }>(resolve(input.canonicalDirectory, "canonical_bundle_manifest.json"));
  const archive = openValidatedZip(resolve(input.canonicalDirectory, "breeds", manifest.breedSemanticFilename));
  const member = (name: string): Uint8Array => { const value = archive.entries[`${archive.prefix}${name}`]; if (!value) throw new Error(`V4 authority lacks ${name}`); return value; };
  const identities = parseJsonLines(member("canonical_breed_identities.jsonl")) as unknown as CanonicalHistoryInput["identities"];
  const semantics = parseJsonLines(member("effective_breed_semantics.jsonl")) as unknown as EffectiveBreedSemantics[];
  const currentYear = run.currentYear ?? 0;
  const sites = csv<Record<string, string>>(resolve(input.canonicalDirectory, "atlas/sites_naming_master.csv")).map((row) => ({
    siteId: row.siteId!, regionId: row.regionId!, currentSiteName: row.currentSiteName ?? "", nameStatus: row.nameStatus ?? "WORKING",
    classification: row.classification ?? "", attractivenessTier: row.attractivenessTier ?? "0", poiIds: row.poiIds, poiCurrentLabels: row.poiCurrentLabels,
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

function persistWorldSnapshot(store: SimulatorStore, runId: string, world: CanonicalHistoryWorld): ReturnType<typeof createReplayCheckpoint> {
  const checkpoint = createReplayCheckpoint({ runId, worldKey: world.world, state: { year: world.year, settlements: world.settlements.map(serializeSettlement), cohorts: world.cohorts.map(serializeCohort), runtimeIssues: [] }, engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION });
  store.saveCheckpoint(checkpoint);
  store.saveCohorts(runId, world.year, world.cohorts);
  for (const settlement of world.settlements) store.saveProjection(runId, world.world, world.year, "SETTLEMENT", settlement.settlementId, serializeSettlement(settlement));
  return checkpoint;
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
  historyInput.onCheckpoint = (world) => { persistWorldSnapshot(input.store, input.runId, world); };
  const result = runCanonicalHistory(historyInput);
  persistCanonicalHistoryResult(input.store, input.runId, result);
  return result;
}
