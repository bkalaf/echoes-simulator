import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { buildPoiCoverage } from "../core/atlas/coverage.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { worldPopulation } from "../core/v5/derivations.js";
import { v5CheckpointHash } from "../core/v5/persistence.js";
import { buildReadModelV1 } from "../core/v5/read-model.js";
import { normalizeSeed } from "../core/v5/random.js";
import { buildRouteCoverageReadModel } from "../core/v5/routes.js";
import { buildPersistedNamingBatchesV5 } from "../core/v5/naming.js";
import { acceptPersistedV5NamingBatch, resumePersistedV5Run, runPersistedV5Diagnostic } from "../core/v5/service.js";
import type { FactionVector, WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const outputDirectory = resolve("artifacts/simulator/v5/acceptance");
mkdirSync(outputDirectory, { recursive: true });
const executionId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const seed = normalizeSeed("EIDOLON_V5_REMEDIATION_ACCEPTANCE_V1");

function faction(vector: FactionVector): WorldKey {
  return vector.CONCORD >= vector.SCHISM && vector.CONCORD >= vector.RUIN ? "CONCORD" : vector.SCHISM >= vector.RUIN ? "SCHISM" : "RUIN";
}

function personFaction(state: WorldStateV5, personId: string): WorldKey {
  const person = state.politicalPeople.find((candidate) => candidate.personId === personId);
  if (!person) throw new Error(`OfficeTerm references unknown PoliticalPerson ${personId}`);
  const family = person.familyId ? state.families.find((candidate) => candidate.familyId === person.familyId) : undefined;
  if (family) return faction(family.factionAffinity);
  const breed = canonical.breeds.find((candidate) => candidate.breedId === person.breedId);
  if (!breed) throw new Error(`PoliticalPerson ${personId} references unknown Breed ${person.breedId}`);
  return faction(breed.factionObject);
}

function chamberComposition(state: WorldStateV5, kind: "CONCLAVE" | "SENATE"): Record<string, number> {
  const institutionIds = new Set(state.institutions.filter((institution) => institution.dissolvedYear === null && institution.institutionType.toUpperCase().includes(kind)).map((institution) => institution.institutionId));
  const offices = state.offices.filter((office) => institutionIds.has(office.institutionId) || office.titleKey.toUpperCase().includes(kind));
  const counts = { CONCORD: 0, SCHISM: 0, RUIN: 0, VACANT: 0, TOTAL: offices.length };
  for (const office of offices) {
    const term = state.officeTerms.find((candidate) => candidate.officeId === office.officeId && candidate.startYear <= state.year && (candidate.endYear === null || candidate.endYear > state.year));
    if (!term) counts.VACANT += 1;
    else counts[personFaction(state, term.personId)] += 1;
  }
  return counts;
}

function runQuickDiagnostic(): Record<string, unknown> {
  const databasePath = resolve(outputDirectory, `quick-25-${executionId}.sqlite`);
  const store = new SimulatorStore(databasePath);
  const started = performance.now();
  try {
    const result = runPersistedV5Diagnostic({ store, resourceDirectory: resolve("resources"), normalizedSeed: seed, throughYear: 25 });
    if (result.status !== "COMPLETE" || result.currentYear !== 25) throw new Error(`V5 quick diagnostic stopped at ${result.currentYear}/${result.status}`);
    return { ...result, elapsedMilliseconds: Math.round(performance.now() - started), databasePath, checkpointCount: store.v5CheckpointCount(result.runId), causalEventCount: store.v5EventCount(result.runId) };
  } finally { store.close(); }
}

const quick = runQuickDiagnostic();
const databasePath = resolve(outputDirectory, `full-2000-${executionId}.sqlite`);
const store = new SimulatorStore(databasePath);
const started = performance.now();
try {
  const initialResult = runPersistedV5Diagnostic({ store, resourceDirectory: resolve("resources"), normalizedSeed: seed, throughYear: 2000 });
  let result: { runId: string; status: "COMPLETE" | "WAITING_FOR_NAMING"; currentYear: number; divergence: typeof initialResult.divergence } = initialResult;
  let diagnosticBlockingNamesAccepted = 0;
  while (result.status === "WAITING_FOR_NAMING") {
    const manifest = store.loadV5RunManifest(result.runId);
    if (!manifest) throw new Error("V5 naming checkpoint lacks a run manifest");
    const batch = buildPersistedNamingBatchesV5(result.runId, store.listV5NamingRequests(result.runId), manifest.operationalConfig.namingBatchSize).find((candidate) => candidate.behavior === "BLOCKING");
    if (!batch) throw new Error(`V5 run stopped for naming at ${result.currentYear} without a blocking batch`);
    const response = {
      schemaVersion: "echoes-v5-naming-batch-response-v1" as const,
      batchId: batch.batchId,
      runId: batch.runId,
      decisions: batch.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `Diagnostic ${item.entityType} ${item.entityId}` })),
    };
    const accepted = acceptPersistedV5NamingBatch({ store, runId: result.runId, response });
    if (!accepted.accepted) throw new Error(`Diagnostic naming batch was rejected: ${accepted.errors.join("; ")}`);
    diagnosticBlockingNamesAccepted += accepted.acceptedDecisions ?? 0;
    result = resumePersistedV5Run({ store, resourceDirectory: resolve("resources"), runId: result.runId });
  }
  const elapsedMilliseconds = Math.round(performance.now() - started);
  if (result.status !== "COMPLETE" || result.currentYear !== 2000) throw new Error(`V5 full diagnostic stopped at ${result.currentYear}/${result.status}`);
  const manifest = store.loadV5RunManifest(result.runId);
  if (!manifest) throw new Error("Completed V5 diagnostic lacks a run manifest");

  const checkpointYears = Object.fromEntries(WORLDS.map((world) => [world, store.listV5CheckpointYears(result.runId, world)])) as Record<WorldKey, number[]>;
  const expectedYears = Array.from({ length: 401 }, (_, index) => index * 5);
  for (const world of WORLDS) {
    if (canonicalJson(checkpointYears[world]) !== canonicalJson(expectedYears)) throw new Error(`Unexpected checkpoint cadence for ${world}`);
  }

  let occupiedEconomicFormChecks = 0;
  const yearNavigation = {} as Record<string, Record<WorldKey, number>>;
  for (const year of expectedYears) {
    for (const world of WORLDS) {
      const checkpoint = store.loadLatestV5Checkpoint(result.runId, world, year);
      if (!checkpoint || checkpoint.state.year !== year) throw new Error(`Missing exact checkpoint ${world}/${year}`);
      const readModel = buildReadModelV1(checkpoint.state, canonical, manifest.mechanicsVariables, manifest.labels);
      const occupied = readModel.settlements.filter((settlement) => BigInt(settlement.population) > 0n);
      occupiedEconomicFormChecks += occupied.length;
      if (occupied.some((settlement) => !settlement.supportedEconomicForm)) throw new Error(`Unresolved economic form at ${world}/${year}`);
      if ([0, 25, 500, 1000, 2000].includes(year)) (yearNavigation[String(year)] ??= {} as Record<WorldKey, number>)[world] = checkpoint.state.year;
    }
  }

  const finalStates = Object.fromEntries(WORLDS.map((world) => {
    const checkpoint = store.loadLatestV5Checkpoint(result.runId, world, 2000);
    if (!checkpoint) throw new Error(`Missing final checkpoint for ${world}`);
    return [world, checkpoint.state];
  })) as Record<WorldKey, WorldStateV5>;
  const beforeReplay = Object.fromEntries(WORLDS.map((world) => {
    const state = finalStates[world];
    const events = store.summarizeV5CausalEventHistory(result.runId, world, 2000);
    return [world, { stateHash: v5CheckpointHash(state), eventHash: events.eventHistoryHash, eventCount: events.eventCount }];
  })) as Record<WorldKey, { stateHash: string; eventHash: string; eventCount: number }>;
  const replay = resumePersistedV5Run({ store, resourceDirectory: resolve("resources"), runId: result.runId });
  const afterReplay = Object.fromEntries(WORLDS.map((world) => {
    const checkpoint = store.loadLatestV5Checkpoint(result.runId, world, 2000);
    if (!checkpoint) throw new Error(`Replay lost final checkpoint for ${world}`);
    const events = store.summarizeV5CausalEventHistory(result.runId, world, 2000);
    return [world, { stateHash: v5CheckpointHash(checkpoint.state), eventHash: events.eventHistoryHash, eventCount: events.eventCount }];
  })) as typeof beforeReplay;
  if (canonicalJson(beforeReplay) !== canonicalJson(afterReplay)) throw new Error("Completed-run replay changed causal state or events");

  const labels = store.loadV5Labels(result.runId);
  const requests = store.listV5NamingRequests(result.runId);
  const labelsByWorld = Object.fromEntries(WORLDS.map((world) => [world, labels]));
  const requestsByWorld = Object.fromEntries(WORLDS.map((world) => [world, requests.filter((request) => request.entityId.includes(`_${world}_`))]));
  const poi = buildPoiCoverage(canonical, finalStates, labelsByWorld, requestsByWorld);
  const routes = buildRouteCoverageReadModel(canonical, finalStates, labelsByWorld, requestsByWorld);
  const routeNames = Object.fromEntries(WORLDS.map((world) => [world, {
    active: finalStates[world].worldRoutes.length,
    named: routes.rows.filter((row) => row.worlds[world]?.nameStatus === "ACCEPTED").length,
    unresolved: routes.rows.filter((row) => row.worlds[world]?.nameStatus === "PENDING").length,
  }]));
  const routeNameDifferences = routes.rows.filter((row) => new Set(WORLDS.map((world) => row.worlds[world]?.name ?? null)).size > 1).length;
  const worlds = Object.fromEntries(WORLDS.map((world) => {
    const state = finalStates[world];
    return [world, {
      population: worldPopulation(state).toString(),
      settlements: state.settlements.length,
      states: state.states.length,
      families: state.families.length,
      politicalPeople: state.politicalPeople.length,
      organizations: {
        total: state.organizations.length,
        corporations: state.organizations.filter((organization) => organization.type === "CORPORATION").length,
        crimeOrganizations: state.organizations.filter((organization) => organization.type === "CRIME_ORGANIZATION").length,
        active: state.organizations.filter((organization) => organization.status === "ACTIVE").length,
        declining: state.organizations.filter((organization) => organization.status === "DECLINING").length,
        dissolved: state.organizations.filter((organization) => organization.status === "DISSOLVED").length,
      },
      conclave: chamberComposition(state, "CONCLAVE"),
      senate: chamberComposition(state, "SENATE"),
    }];
  }));
  const report = {
    schemaVersion: "echoes-v5-remediation-acceptance-v1",
    runId: result.runId,
    causalRunHash: initialResult.causalRunHash,
    databasePath,
    databaseBytes: statSync(databasePath).size,
    elapsedMilliseconds,
    diagnosticBlockingNamesAccepted,
    quick,
    replay: { ...replay, equivalent: true, hashes: afterReplay },
    checkpoints: { total: store.v5CheckpointCount(result.runId), perWorld: Object.fromEntries(WORLDS.map((world) => [world, checkpointYears[world].length])), yearNavigation },
    causalEvents: { total: store.v5EventCount(result.runId), perWorld: Object.fromEntries(WORLDS.map((world) => [world, beforeReplay[world].eventCount])) },
    occupiedEconomicFormChecks,
    worlds,
    poi: poi.summary,
    hydrology: poi.hydrology,
    routes: { directedEdgeCount: routes.directedEdgeCount, corridorCount: routes.corridorCount, bidirectionalPairs: routes.bidirectionalPairs, oneDirectionPairs: routes.oneDirectionPairs, modeCounts: Object.fromEntries(["LAND", "SEA", "AIR", "NONE", "UNRESOLVED"].map((mode) => [mode, routes.rows.filter((row) => row.primaryMode === mode).length])), tradeDesignatedCorridors: routes.rows.filter((row) => row.tradeDesignation).length, portalOnlyCorridors: routes.rows.filter((row) => row.portalCapability && row.primaryMode === "NONE").length, worldRoutes: routeNames, crossWorldRouteNameDifferences: routeNameDifferences },
    divergence: result.divergence,
  };
  const outputPath = resolve(outputDirectory, `acceptance-report-${executionId}.json`);
  writeFileSync(outputPath, `${canonicalJson(report)}\n`);
  process.stdout.write(`${canonicalJson({ outputPath, ...report })}\n`);
} finally { store.close(); }
