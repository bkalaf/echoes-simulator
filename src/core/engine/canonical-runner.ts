import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { WorldKey } from "../contracts/domain.js";
import { createReplayCheckpoint } from "../checkpoints/checkpoint.js";
import { stableEventId } from "../events/event-store.js";
import { openValidatedZip, parseJsonLines, type GenericRow } from "../inputs/importer.js";
import { buildNamingJob } from "../naming/naming.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { initializeCivicCohorts, type Cohort } from "./cohort-engine.js";
import { projectResearchProperties } from "./local-mechanics.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const POLICY_VERSION = "owner-policy-2026-08-18-v1";
const ENGINE_VERSION = "canonical-cohort-engine-v1";

interface BootstrapInput {
  store: SimulatorStore;
  seed: string;
  packDirectory: string;
  semanticResearchZip: string;
  resourceDirectory: string;
}

interface RuntimeIssue {
  issueCode: "NO_RESOLVED_POPULATION_FOR_PROPERTY";
  world: WorldKey;
  year: number;
  settlement: string;
  property: string;
  totalPopulation: string;
  terminalNullPopulation: string;
}

export interface CanonicalBootstrapResult {
  runId: string;
  mode: "CANONICAL";
  status: "WAITING_FOR_NAMING";
  currentYear: 0;
  worlds: Record<WorldKey, { cohorts: number; settlements: number; population: string }>;
  runtimeIssues: RuntimeIssue[];
  namingJob: ReturnType<typeof buildNamingJob>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function csv(filename: string): Record<string, string>[] {
  return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

function researchRows(filename: string): GenericRow[] {
  const archive = openValidatedZip(filename);
  const member = archive.entries[`${archive.prefix}breed_classifications.jsonl`];
  if (!member) throw new Error("Semantic authority is missing breed_classifications.jsonl");
  return parseJsonLines(member);
}

function camelProperty(name: string): string {
  return `${name[0]!.toLowerCase()}${name.slice(1)}`;
}

function serializeCohort(cohort: Cohort): Record<string, unknown> {
  return { ...cohort, population: cohort.population.toString() };
}

export function bootstrapCanonicalRun(input: BootstrapInput): CanonicalBootstrapResult {
  const semantics = researchRows(input.semanticResearchZip);
  if (semantics.length !== 2056) throw new Error("Canonical run requires a complete 2,056-Breed semantic authority");
  const civic = semantics.filter((row) => row.populationKind !== "PET");
  if (civic.length !== 1773) throw new Error("Canonical run requires exactly 1,773 civic Breeds");
  const assignments = csv(join(input.packDirectory, "INPUTS/region_species_group_assignments(1).csv"));
  const foundingSites = csv(join(input.resourceDirectory, "reference/founding_sites.csv")).filter((row) => row.regionId !== "R10");
  if (foundingSites.length !== 24) throw new Error("Canonical initial state requires exactly 24 Settlements and no R10 Settlement");
  const propertyMappingRaw = JSON.parse(readFileSync(join(input.resourceDirectory, "reference/property_faction_mapping.json"), "utf8")) as Record<string, Record<WorldKey, string>>;
  const propertyMapping = Object.fromEntries(Object.entries(propertyMappingRaw).map(([key, values]) => [camelProperty(key), values]));
  const researched = new Map(semantics.map((row) => [String(row.breedId), Object.fromEntries(Object.keys(propertyMapping).map((field) => [field, {
    value: row[field] === undefined ? null : row[field] as string | null,
    disposition: String((row.fieldDispositions as Record<string, string> | undefined)?.[field] ?? "UNRESOLVED") as "VERIFIED_VALUE" | "INHERITED_VERIFIED_VALUE" | "POLICY_DEFAULT" | "POLICY_NULL" | "RESOLVED_NULL" | "UNRESOLVED" | "REVIEW_REQUIRED",
  }]))]));
  const seedHash = sha256(input.seed);
  const runId = `RUN_CANONICAL_${seedHash.slice(0, 20).toUpperCase()}`;
  if (input.store.getRun(runId)) throw new Error(`Canonical run ${runId} already exists`);
  input.store.createRun({ runId, mode: "CANONICAL", status: "RUNNING", seed: input.seed, seedHash, policyVersion: POLICY_VERSION });

  const runtimeIssues: RuntimeIssue[] = [];
  const worlds = {} as CanonicalBootstrapResult["worlds"];
  let namingContext: Parameters<typeof buildNamingJob>[0] | null = null;

  for (const world of WORLDS) {
    const cohorts = initializeCivicCohorts(world, civic.map((row) => ({ breedId: String(row.breedId), populationKind: String(row.populationKind) as "HUMAN" | "BEAST" | "MYTHOS" | "PET", groupId: String(row.groupId) })), assignments.map((row) => ({ groupId: row.groupId!, regionId: row.regionId! })), foundingSites.map((row) => ({ regionId: row.regionId!, siteId: row.siteId! })));
    input.store.saveCohorts(runId, 0, cohorts);
    const settlements = foundingSites.map((site) => {
      const settlementId = `SETTLEMENT_${world}_${site.siteId}`;
      const residents = cohorts.filter((cohort) => cohort.settlementId === settlementId);
      const population = residents.reduce((sum, cohort) => sum + cohort.population, 0n);
      const projected = projectResearchProperties(residents, researched, world, propertyMapping, { worldKey: world, year: 0, entityType: "SETTLEMENT", entityId: settlementId });
      for (const [property, projection] of Object.entries(projected.properties)) {
        if (projection.resolvedPopulation === 0n) runtimeIssues.push({ issueCode: "NO_RESOLVED_POPULATION_FOR_PROPERTY", world, year: 0, settlement: settlementId, property, totalPopulation: population.toString(), terminalNullPopulation: projection.terminalNullPopulation.toString() });
      }
      const data = {
        settlementId,
        siteId: site.siteId,
        regionId: site.regionId,
        stateId: `STATE_${world}_${site.regionId}`,
        name: site.currentSiteName,
        nameSource: "OWNER_INPUT",
        foundedYear: 0,
        population: population.toString(),
        dominantFaction: projected.dominantFaction,
        politicalForm: null,
        economicForm: null,
        properties: projected.properties,
        runtimeIssues: projected.blockers,
      };
      input.store.saveProjection(runId, world, 0, "SETTLEMENT", settlementId, data);
      input.store.appendEvent({ eventId: stableEventId(runId, world, 0, "INITIAL_SETTLEMENT_CREATED", settlementId, Number(site.regionId.slice(1))), runId, worldKey: world, year: 0, phaseOrder: 10, sequence: Number(site.regionId.slice(1)), eventType: "INITIAL_SETTLEMENT_CREATED", entityType: "SETTLEMENT", entityId: settlementId, payload: { siteId: site.siteId, regionId: site.regionId, population: population.toString(), nameSource: "OWNER_INPUT" } });
      if (!namingContext && world === "CONCORD") namingContext = {
        runId,
        world,
        year: 0,
        reason: "INITIAL_GOVERNMENT_AND_FAMILY",
        settlement: { settlementId, siteId: site.siteId, currentName: site.currentSiteName, nameSource: "OWNER_INPUT", dominantFaction: projected.dominantFaction, cultureId: null, politicalForm: null, economicForm: null, population: population.toString() },
        unnamedPois: [],
      };
      return data;
    });
    const checkpoint = createReplayCheckpoint({ runId, worldKey: world, state: { year: 0, settlements, cohorts: cohorts.map(serializeCohort), runtimeIssues: runtimeIssues.filter((issue) => issue.world === world) }, engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION });
    input.store.saveCheckpoint(checkpoint);
    worlds[world] = { cohorts: cohorts.length, settlements: settlements.length, population: cohorts.reduce((sum, cohort) => sum + cohort.population, 0n).toString() };
  }

  if (!namingContext) throw new Error("No initial Settlement was available for the naming workflow");
  const namingJob = buildNamingJob(namingContext);
  const concordCheckpoint = input.store.loadCheckpoint(runId, "CONCORD", 0);
  if (!concordCheckpoint) throw new Error("Canonical checkpoint was not persisted");
  input.store.persistNamingBarrier(namingJob, concordCheckpoint);
  return { runId, mode: "CANONICAL", status: "WAITING_FOR_NAMING", currentYear: 0, worlds, runtimeIssues, namingJob };
}
