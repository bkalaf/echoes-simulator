import { basename, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { openValidatedZip, parseCsvFile, parseJsonLines, mergeBreedRows, RESEARCH_SEMANTIC_FIELDS, sha256, type GenericRow } from "./importer.js";
import { assessV3Research } from "../research/v3-final-audit.js";

const INPUTS = {
  sourceLeads: "echoes_of_eidolon_breed_research_v2_semantic_remediated_2026-08-18(1).zip",
  legacyBreeds: "full_breed_with_region_ids(1).csv",
  assignments: "region_species_group_assignments(1).csv",
  sites: "sites_naming_master(1).csv",
  pois: "pois_by_site_naming(1).csv",
  rollup: "site_poi_naming_rollup(1).csv",
} as const;

const EXPECTED_HASHES: Record<keyof typeof INPUTS, string> = {
  sourceLeads: "0c9ed73354bbca9275054d1eade1f52c2088f35cfe702d9c9bb4ce482146b0c9",
  legacyBreeds: "7d542ebeebbdc3798a062af8a9e1553031932e6dc756f2fa29a824b3f2adca42",
  assignments: "43ee260b6a8c537e37d03ca5e8d27ec7a577b66089ea926a29579f2ac43f5b85",
  sites: "93a0fb42c6d22b598fa4d84c350fb7637c8106e2affc75435f555fb19867cc64",
  pois: "ddb4ded42860d17aea31e8bd192d1f504b9d0cc33664b6bc2e91fa4727882dc8",
  rollup: "55475133288bd293059df70d922e79a334ad2e0ec902553cef7c170b524e410b",
};

const DIMENSIONS = ["motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture"] as const;
const TERMINAL = new Set(["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE", "POLICY_DEFAULT", "POLICY_NULL", "RESOLVED_NULL"]);
const NULL_TERMINAL = new Set(["POLICY_NULL", "RESOLVED_NULL"]);

export interface CoverageCount { resolved: number; terminalNull: number; invalidUnresearched: number; unresolved: number; }
export interface PreflightIssue { issueCode: string; severity: "WARNING" | "BLOCKER"; blocksCanonical: boolean; message: string; details?: unknown; }
export interface RealPreflightReport {
  schemaVersion: "eidolon-simulator-real-preflight-v2";
  structuralStatus: "PASS";
  canonicalReady: boolean;
  inputFiles: { logicalKey: string; filename: string; bytes: number; sha256: string; expectedHashMatch: boolean }[];
  counts: { breeds: number; civicBreeds: number; pets: number; sites: number; pois: number; poiSites: number; rollupRows: number; nonR10GroupAssignments: number };
  coverage: Record<string, CoverageCount>;
  activeIssues: PreflightIssue[];
  resolvedOwnerDecisions: string[];
  initialPopulationTotal: string;
  r10InitialSettlement: false;
  sourceRoles: {
    august17StartingAuthority: { filename: string; sha256: string; rows: number };
    august18SourceLeads: { filename: string; sha256: string; semanticPrecedence: "SOURCE_LEADS_ONLY" };
    legacyCsv: { filename: string; semanticPrecedence: "METADATA_ONLY" };
    v3SemanticAuthority: null | { filename: string; sha256: string; rows: number; status: "RETIRED_FALSE_COMPLETION" };
  };
}

function getZipRows(filename: string, member: string): GenericRow[] {
  const zip = openValidatedZip(filename);
  const bytes = zip.entries[`${zip.prefix}${member}`];
  if (!bytes) throw new Error(`${basename(filename)} is missing ${member}`);
  return parseJsonLines(bytes);
}

function dispositionsFor(row: GenericRow): Record<string, string> {
  return (row.fieldDispositions ?? {}) as Record<string, string>;
}

function countCoverage(rows: GenericRow[], field: string, hasV3: boolean): CoverageCount {
  let resolved = 0;
  let terminalNull = 0;
  let invalidUnresearched = 0;
  for (const row of rows) {
    const disposition = hasV3 ? dispositionsFor(row)[field] : undefined;
    if (!disposition || !TERMINAL.has(disposition)) invalidUnresearched += 1;
    else if (NULL_TERMINAL.has(disposition)) terminalNull += 1;
    else resolved += 1;
  }
  return { resolved, terminalNull, invalidUnresearched, unresolved: invalidUnresearched };
}

function assertCorpus(rows: GenericRow[]): void {
  if (rows.length !== 2056 || new Set(rows.map((row) => row.breedId)).size !== 2056) throw new Error("Breed corpus must contain exactly 2,056 unique IDs");
  const expected = { HUMAN: 631, BEAST: 961, MYTHOS: 181, PET: 283 };
  for (const [kind, count] of Object.entries(expected)) if (rows.filter((row) => row.populationKind === kind).length !== count) throw new Error(`Breed corpus ${kind} count must be ${count}`);
}

export function preflightRealBundle(packDirectory: string, startingResearchZip = resolve(packDirectory, "echoes_of_eidolon_breed_research_2026-08-17.zip"), v3ResearchZip?: string): RealPreflightReport {
  const inputDirectory = existsSync(join(packDirectory, "INPUTS")) ? join(packDirectory, "INPUTS") : join(packDirectory, "inputs");
  const inputFiles = Object.entries(INPUTS).map(([logicalKey, filename]) => {
    const full = join(inputDirectory, filename);
    const bytes = readFileSync(full);
    const digest = sha256(bytes);
    if (digest !== EXPECTED_HASHES[logicalKey as keyof typeof INPUTS]) throw new Error(`Outer hash mismatch for ${filename}`);
    return { logicalKey, filename, bytes: bytes.byteLength, sha256: digest, expectedHashMatch: true };
  });

  const starting = getZipRows(startingResearchZip, "breed_classifications.jsonl");
  assertCorpus(starting);
  const legacy = parseCsvFile(join(inputDirectory, INPUTS.legacyBreeds));
  const legacyById = new Map(legacy.map((row) => [row.breedId, row]));
  if (legacyById.size !== 2056) throw new Error("Legacy metadata must contain 2,056 unique Breed IDs");

  let semanticRows = starting;
  let hasV3 = false;
  let v3Assessment: ReturnType<typeof assessV3Research> | null = null;
  let v3Authority: RealPreflightReport["sourceRoles"]["v3SemanticAuthority"] = null;
  if (v3ResearchZip) {
    semanticRows = getZipRows(v3ResearchZip, "breed_classifications.jsonl");
    assertCorpus(semanticRows);
    const startingIds = new Set(starting.map((row) => String(row.breedId)));
    if (semanticRows.some((row) => !startingIds.has(String(row.breedId)))) throw new Error("V3 contains an unknown Breed ID");
    v3Assessment = assessV3Research({ breeds: semanticRows, evidence: getZipRows(v3ResearchZip, "evidence.jsonl"), citations: getZipRows(v3ResearchZip, "citations.jsonl"), sources: getZipRows(v3ResearchZip, "sources.jsonl") });
    hasV3 = true;
    v3Authority = { filename: basename(v3ResearchZip), sha256: sha256(readFileSync(v3ResearchZip)), rows: semanticRows.length, status: "RETIRED_FALSE_COMPLETION" };
  }
  const merged = semanticRows.map((row) => {
    const metadata = legacyById.get(String(row.breedId));
    if (!metadata) throw new Error(`Missing legacy metadata for ${String(row.breedId)}`);
    return mergeBreedRows(row, metadata);
  });
  const civic = merged.filter((row) => row.populationKind !== "PET");
  const pets = merged.filter((row) => row.populationKind === "PET");

  const sites = parseCsvFile(join(inputDirectory, INPUTS.sites));
  const pois = parseCsvFile(join(inputDirectory, INPUTS.pois));
  const rollup = parseCsvFile(join(inputDirectory, INPUTS.rollup));
  const assignments = parseCsvFile(join(inputDirectory, INPUTS.assignments));
  if (sites.length !== 175 || new Set(sites.map((row) => row.siteId)).size !== 175) throw new Error("Site registry must contain 175 unique Sites");
  const sitesByRegion = new Map<string, number>();
  for (const site of sites) sitesByRegion.set(site.regionId, (sitesByRegion.get(site.regionId) ?? 0) + 1);
  if (sitesByRegion.size !== 25 || [...sitesByRegion.values()].some((count) => count !== 7)) throw new Error("Each Region must contain exactly seven Sites");
  if (pois.length !== 92 || pois.some((poi) => !sites.some((site) => site.siteId === poi.siteId))) throw new Error("POI registry is inconsistent");
  if (rollup.length !== 175) throw new Error("Site/POI rollup must contain 175 rows");
  const nonR10Assignments = assignments.filter((row) => row.regionId !== "R10");
  if (nonR10Assignments.length !== 72) throw new Error("Expected 72 non-R10 civic group assignments");
  const groupToRegion = new Map(nonR10Assignments.map((row) => [row.groupId, row.regionId]));
  if (civic.some((breed) => !groupToRegion.has(String(breed.groupId)))) throw new Error("A civic Breed has no initial Region assignment");

  const coverage = Object.fromEntries(RESEARCH_SEMANTIC_FIELDS.map((field) => [field, countCoverage(civic, field, hasV3)]));
  const activeIssues: PreflightIssue[] = [];
  if (!hasV3) activeIssues.push({ issueCode: "MISSING_SIMULATION_READY_V4_SEMANTICS", severity: "BLOCKER", blocksCanonical: true, message: "No simulation-ready V4 Breed semantic authority was supplied; V3 false completion is retired." });
  if (hasV3) activeIssues.push({ issueCode: "RETIRED_V3_AUTHORITY", severity: "BLOCKER", blocksCanonical: true, message: "The supplied V3 pack is retained only as RETIRED_FALSE_COMPLETION provenance and cannot authorize canonical execution." });
  if (v3Assessment && (!v3Assessment.safeToImport || v3Assessment.verdict !== "ACCEPT_FINAL")) activeIssues.push({ issueCode: "V3_RESEARCH_INTEGRITY_FAILED", severity: "BLOCKER", blocksCanonical: true, message: "The supplied V3 authority failed its recomputed structural or semantic evidence audit.", details: v3Assessment.findings });
  const invalidFields = Object.entries(coverage).filter(([, count]) => count.invalidUnresearched > 0);
  if (invalidFields.length) activeIssues.push({ issueCode: "BREED_RESEARCH_INCOMPLETE", severity: "BLOCKER", blocksCanonical: true, message: "One or more civic Breed fields are invalid or unresearched.", details: Object.fromEntries(invalidFields) });
  if (hasV3) {
    const petPolicyFailures = semanticRows.filter((row) => row.populationKind === "PET").filter((row) => row.personalityId !== null || DIMENSIONS.some((field) => row[field] !== null || dispositionsFor(row)[field] !== "POLICY_NULL"));
    if (petPolicyFailures.length) activeIssues.push({ issueCode: "PET_POLICY_VIOLATION", severity: "BLOCKER", blocksCanonical: true, message: "PET personality/dimension policy nulls are invalid.", details: { breedIds: petPolicyFailures.map((row) => row.breedId) } });
  }

  const sourceLeadFile = join(inputDirectory, INPUTS.sourceLeads);
  return {
    schemaVersion: "eidolon-simulator-real-preflight-v2",
    structuralStatus: "PASS",
    canonicalReady: activeIssues.every((issue) => !issue.blocksCanonical),
    inputFiles,
    counts: { breeds: merged.length, civicBreeds: civic.length, pets: pets.length, sites: sites.length, pois: pois.length, poiSites: new Set(pois.map((poi) => poi.siteId)).size, rollupRows: rollup.length, nonR10GroupAssignments: nonR10Assignments.length },
    coverage,
    activeIssues,
    resolvedOwnerDecisions: ["PET_EXCLUDED", "FOOD_DISABLED", "OWNER_MIGRATION_V1", "EVERY_BROAD_UNHAPPY_FOUND_OR_JOIN_V1", "WEALTH_SOCIAL_TIER_MOTIVE_V1", "GLOBAL_CULTURE_UNIQUENESS", "DJT_YEAR_500", "DJT_OUTBOUND_BOTH", "ADJACENT_FACTION_SECESSION_505", "REBALANCE_525_DISABLED", "CONCLAVE_ONE_PER_CITY_PRE90", "SENATE_TWO_PER_STATE"],
    initialPopulationTotal: "2000000",
    r10InitialSettlement: false,
    sourceRoles: {
      august17StartingAuthority: { filename: basename(startingResearchZip), sha256: sha256(readFileSync(startingResearchZip)), rows: starting.length },
      august18SourceLeads: { filename: basename(sourceLeadFile), sha256: sha256(readFileSync(sourceLeadFile)), semanticPrecedence: "SOURCE_LEADS_ONLY" },
      legacyCsv: { filename: INPUTS.legacyBreeds, semanticPrecedence: "METADATA_ONLY" },
      v3SemanticAuthority: v3Authority,
    },
  };
}
