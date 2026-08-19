import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvFile } from "../core/inputs/importer.js";
import {
  buildV4BatchArtifacts,
  type BatchDecision,
  type BatchJournalRow,
  type BatchManifest,
  type EffectivePersonalityProfileInput,
} from "../core/research/v4-batch.js";

const root = resolve(".");
const batchId = process.argv[2];
if (!batchId || !/^R\d{2}_B\d{2}$/.test(batchId)) throw new Error("Expected a Region batch ID such as R01_B01");
const promptPack = resolve(root, "ECHOES_OF_EIDOLON_RESEARCH_V4_CODEX_PROMPT_PACK_2026-08-19");
const ownerPack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const directory = resolve(root, "artifacts/research-v4/batches", batchId);
const architecturePath = resolve(root, "artifacts/simulator/v4/ARCHITECTURE_LOCK.json");
const REGION_BATCH_ORDER = [
  "R01_B01", "R01_B02", "R02_B01", "R02_B02", "R03_B01", "R04_B01", "R05_B01", "R06_B01", "R07_B01", "R08_B01",
  "R09_B01", "R11_B01", "R12_B01", "R13_B01", "R14_B01", "R14_B02", "R15_B01", "R16_B01", "R17_B01", "R18_B01",
  "R19_B01", "R20_B01", "R20_B02", "R21_B01", "R22_B01", "R23_B01", "R24_B01", "R25_B01", "R25_B02",
] as const;

function readJsonLines<T>(filename: string): T[] {
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function writeJsonLines(filename: string, rows: readonly unknown[]): void {
  writeFileSync(filename, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

const manifest = JSON.parse(readFileSync(resolve(promptPack, "units", `${batchId}.json`), "utf8")) as BatchManifest;
if (manifest.batchId !== batchId) throw new Error(`Batch manifest identity mismatch: ${manifest.batchId}`);
const architecture = JSON.parse(readFileSync(architecturePath, "utf8")) as Record<string, unknown> & { completedRegionBatches: string[] };
if (!Array.isArray(architecture.completedRegionBatches)) throw new Error("V4 architecture lock has no completed Region batch ledger");
const prefix = REGION_BATCH_ORDER.slice(0, architecture.completedRegionBatches.length);
if (prefix.join("\0") !== architecture.completedRegionBatches.join("\0")) throw new Error("Completed Region batches violate the locked run order");
if (!architecture.completedRegionBatches.includes(batchId) && REGION_BATCH_ORDER[architecture.completedRegionBatches.length] !== batchId) {
  throw new Error(`Run-order violation: expected ${REGION_BATCH_ORDER[architecture.completedRegionBatches.length] ?? "no further Region batch"}, received ${batchId}`);
}
const journals = readJsonLines<BatchJournalRow>(resolve(directory, "research_journal.jsonl"));
const decisions = readJsonLines<BatchDecision>(resolve(directory, "research_decisions.jsonl"));
const effectiveProfiles = readJsonLines<EffectivePersonalityProfileInput>(resolve(root, "resources/research-v4/personality/personality_expression_effective_profiles_v1.jsonl"));
const allCivicBreedIds = parseCsvFile(resolve(ownerPack, "INPUTS/full_breed_with_region_ids(1).csv"))
  .filter((row) => row.populationKind !== "PET")
  .map((row) => row.breedId!);
const propertyMapping = JSON.parse(readFileSync(resolve(root, "resources/reference/property_faction_mapping.json"), "utf8"));
const politicalRows = JSON.parse(readFileSync(resolve(root, "resources/reference/political_form_mapping.json"), "utf8")).rows;
const economicRows = JSON.parse(readFileSync(resolve(root, "resources/reference/economic_form_mapping.json"), "utf8")).rows;
const built = buildV4BatchArtifacts({
  manifest, journals, decisions, effectiveProfiles, allCivicBreedIds, totalInitialPopulation: 2_000_000n,
  propertyMapping, politicalRows, economicRows,
});

mkdirSync(directory, { recursive: true });
writeJsonLines(resolve(directory, "unit_results.jsonl"), built.unitResults);
writeJsonLines(resolve(directory, "sources.jsonl"), built.sources);
writeJsonLines(resolve(directory, "citations.jsonl"), built.citations);
writeJsonLines(resolve(directory, "evidence.jsonl"), built.evidence);
writeJsonLines(resolve(directory, "inheritance_edges.jsonl"), built.inheritanceEdges);
writeJsonLines(resolve(directory, "effective_breed_preview.jsonl"), built.effectiveBreeds);
writeFileSync(resolve(directory, "batch_report.json"), `${JSON.stringify(built.report, null, 2)}\n`);
if (!architecture.completedRegionBatches.includes(batchId)) architecture.completedRegionBatches.push(batchId);
architecture.status = architecture.completedRegionBatches.length === REGION_BATCH_ORDER.length
  ? "ARCHITECTURE_LOCKED_REGION_RESEARCH_COMPLETE"
  : "ARCHITECTURE_LOCKED_RESEARCH_IN_PROGRESS";
writeFileSync(architecturePath, `${JSON.stringify(architecture, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(built.report, null, 2)}\n`);
