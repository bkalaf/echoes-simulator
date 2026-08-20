import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { WorldKey } from "../contracts/domain.js";
import { createReplayCheckpoint } from "../checkpoints/checkpoint.js";
import { stableEventId } from "../events/event-store.js";
import { openValidatedZip, parseJsonLines } from "../inputs/importer.js";
import { buildNamingJob } from "../naming/naming.js";
import type { SimulatorStore } from "../../persistence/sqlite-store.js";
import { initializeCivicCohorts, type Cohort } from "./cohort-engine.js";
import { calculateYear0Readiness, type Year0Assignment, type Year0Identity, type Year0Site } from "./year0-readiness.js";
import type { EffectiveBreedSemantics } from "../research/v4-contract.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const POLICY_VERSION = "eidolon-simulator-owner-policy-v1@2026-08-18";
const ENGINE_VERSION = "canonical-cohort-engine-v4";

interface BootstrapInput { store: SimulatorStore; seed: string; canonicalDirectory: string; }
export interface CanonicalBootstrapResult {
  runId: string;
  mode: "CANONICAL";
  status: "WAITING_FOR_NAMING";
  currentYear: 0;
  worlds: Record<WorldKey, { cohorts: number; settlements: number; population: string }>;
  runtimeIssues: [];
  namingJob: ReturnType<typeof buildNamingJob>;
}

function csv<T>(filename: string): T[] { return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true }) as T[]; }
function serializeCohort(cohort: Cohort): Record<string, unknown> { return { ...cohort, population: cohort.population.toString() }; }

export function bootstrapCanonicalRun(input: BootstrapInput): CanonicalBootstrapResult {
  const canonicalManifest = JSON.parse(readFileSync(resolve(input.canonicalDirectory, "canonical_bundle_manifest.json"), "utf8")) as { buildReady: boolean; breedSemanticFilename: string; breedSemanticSha256: string };
  if (!canonicalManifest.buildReady) throw new Error("BUNDLED_CANONICAL_DATA_INVALID: manifest is not build-ready");
  const archive = openValidatedZip(resolve(input.canonicalDirectory, "breeds", canonicalManifest.breedSemanticFilename));
  const member = (name: string): Uint8Array => { const value = archive.entries[`${archive.prefix}${name}`]; if (!value) throw new Error(`BUNDLED_CANONICAL_DATA_INVALID: V4 authority lacks ${name}`); return value; };
  const identities = parseJsonLines(member("canonical_breed_identities.jsonl")) as unknown as Year0Identity[];
  const effectiveBreeds = parseJsonLines(member("effective_breed_semantics.jsonl")) as unknown as EffectiveBreedSemantics[];
  const assignments = csv<Year0Assignment>(resolve(input.canonicalDirectory, "atlas/region_species_group_assignments.csv"));
  const foundingSites = csv<Year0Site>(resolve(input.canonicalDirectory, "atlas/founding_sites.csv"));
  const propertyMapping = JSON.parse(readFileSync(resolve(input.canonicalDirectory, "reference/property_faction_mapping.json"), "utf8"));
  const politicalRows = JSON.parse(readFileSync(resolve(input.canonicalDirectory, "reference/political_form_mapping.json"), "utf8")).rows;
  const economicRows = JSON.parse(readFileSync(resolve(input.canonicalDirectory, "reference/economic_form_mapping.json"), "utf8")).rows;
  const readiness = calculateYear0Readiness({ seed: input.seed, identities, effectiveBreeds, assignments, foundingSites, propertyMapping, politicalRows, economicRows });
  if (readiness.status !== "PASS") throw new Error("BUNDLED_CANONICAL_DATA_INVALID: runtime year-0 invariant failed");

  const seedHash = createHash("sha256").update(input.seed).digest("hex");
  const runId = `RUN_CANONICAL_${seedHash.slice(0, 12).toUpperCase()}_${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  input.store.createRun({ runId, mode: "CANONICAL", status: "RUNNING", seed: input.seed, seedHash, policyVersion: POLICY_VERSION });
  input.store.selectRun(runId);
  const worlds = {} as CanonicalBootstrapResult["worlds"];

  for (const world of WORLDS) {
    const cohorts = initializeCivicCohorts(world, identities, assignments, foundingSites, 2_000_000n);
    input.store.saveCohorts(runId, 0, cohorts);
    const settlements = readiness.settlementWorldResults.filter((row) => row.world === world).map((row, index) => {
      const data = { ...row, stateId: `STATE_${world}_${row.regionId}`, name: row.currentName, nameSource: "OWNER_INPUT", foundedYear: 0, runtimeIssues: [] };
      input.store.saveProjection(runId, world, 0, "SETTLEMENT", row.settlementId, data);
      input.store.appendEvent({ eventId: stableEventId(runId, world, 0, "INITIAL_SETTLEMENT_CREATED", row.settlementId, index), runId, worldKey: world, year: 0, phaseOrder: 10, sequence: index, eventType: "INITIAL_SETTLEMENT_CREATED", entityType: "SETTLEMENT", entityId: row.settlementId, payload: data });
      return data;
    });
    const checkpoint = createReplayCheckpoint({ runId, worldKey: world, state: { year: 0, settlements, cohorts: cohorts.map(serializeCohort), runtimeIssues: [] }, engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION });
    input.store.saveCheckpoint(checkpoint);
    worlds[world] = { cohorts: cohorts.length, settlements: settlements.length, population: cohorts.reduce((sum, cohort) => sum + cohort.population, 0n).toString() };
  }

  const first = readiness.settlementWorldResults.find((row) => row.world === "CONCORD" && row.regionId === "R01");
  if (!first) throw new Error("Canonical readiness did not include the first naming context");
  const namingJob = buildNamingJob({
    runId, world: first.world, year: 0, reason: "INITIAL_GOVERNMENT_AND_FAMILY",
    settlement: {
      settlementId: first.settlementId, siteId: first.siteId, currentName: first.currentName, nameSource: "OWNER_INPUT",
      dominantFaction: first.dominantFaction, cultureId: first.cultureId, cultureState: first.cultureState,
      politicalForm: first.politicalForm, economicForm: first.economicForm, dominantBreed: first.dominantBreed, population: first.population,
    },
    unnamedPois: [],
  });
  const checkpoint = input.store.loadCheckpoint(runId, "CONCORD", 0);
  if (!checkpoint) throw new Error("Canonical checkpoint was not persisted");
  input.store.persistNamingBarrier(namingJob, checkpoint);
  return { runId, mode: "CANONICAL", status: "WAITING_FOR_NAMING", currentYear: 0, worlds, runtimeIssues: [], namingJob };
}
