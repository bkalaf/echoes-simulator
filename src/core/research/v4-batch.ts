import type { Faction, WorldKey } from "../contracts/domain.js";
import { allocateEqualPopulation, deriveEconomicForm, derivePoliticalForm, projectRawProperties } from "../engine/local-mechanics.js";
import {
  PERSONALITY_DIMENSION_POLICY,
  RAW_DIMENSIONS,
  validateBatchCompleteness,
  validateEffectiveBreedSemantics,
  validateResearchEvidence,
  type EffectiveBreedSemantics,
  type ResearchUnit,
  type V4Citation,
  type V4InheritanceEdge,
  type V4ResearchEvidence,
  type V4Source,
  type V4UnitResult,
} from "./v4-contract.js";

const TERRAIN_BROAD = new Set(["MOUNTAIN", "FOREST", "WETLAND", "COASTAL", "OCEAN", "FRESHWATER", "DESERT", "GRASSLAND", "SUBTERRANEAN", "POLAR_ICE", "BUILT_ENVIRONMENT", "GENERALIST"]);
const TERRAIN_SPECIFIC = new Set(["ALPINE", "BOG", "BOREAL_FOREST", "BURROW", "CANOPY", "CANYON", "CASTLE", "CAVE", "CITY", "CLIFF", "CLOUD_FOREST", "COASTAL_CLIFF", "CORAL_REEF", "DELTA", "DUNES", "ESTUARY", "FARMLAND", "FJORD", "FLOODPLAIN", "FLOWERING_HABITAT", "FOREST_EDGE", "FOREST_FLOOR", "GENERALIST", "GLACIER", "HOT_DESERT", "ISLAND", "KARST", "KELP_FOREST", "LAKE", "MANGROVE", "MARSH", "MEADOW", "MINE", "MONTANE_FOREST", "MUDFLAT", "OASIS", "OLD_GROWTH_FOREST", "PACK_ICE", "PELAGIC", "PLATEAU", "POND", "PRAIRIE", "RAIN_FOREST", "RIVER", "ROAD", "RUINS", "SAVANNA", "SCRUBLAND", "SEAGRASS_BED", "SOIL", "STEPPE", "SWAMP", "TEMPLE", "TUNDRA", "TUNNEL", "VILLAGE", "VOLCANIC", "WOODLAND", "WORKSHOP"]);
const TARGET_FIELDS = ["personalityId", "terrainBroad", "terrainSpecific"] as const;
type TargetField = typeof TARGET_FIELDS[number];

export interface BatchManifest {
  batchId: string;
  regionId: string;
  units: ResearchUnit[];
}

export interface BatchJournalRow {
  journalEntryId: string;
  batchId: string;
  timestamp: string;
  query: string;
  searchResultChosen: string;
  actualOpenedUrl: string;
  title: string;
  organization: string;
  publisher: string;
  locator: string;
  boundedContext: string;
  sourceFact: string;
  targetUnitId: string;
  targetField: TargetField;
  accepted: boolean;
  rejectionReason: string | null;
  sourceOpened: boolean;
}

export interface BatchDecision {
  batchId: string;
  researchUnitId: string;
  personalityId: string;
  personalityBridge: string;
  terrainBroad: string[];
  terrainSpecific: string[];
  journalEntryIds: Record<TargetField, string>;
  inferenceClassification?: "DIRECT_BEHAVIOR_MAPPING" | "EIDOLON_AUTHORED_INFERENCE";
  status: "SIMULATION_READY";
}

export interface EffectivePersonalityProfileInput {
  policyRef: typeof PERSONALITY_DIMENSION_POLICY;
  personalityId: string;
  family: string;
  dimensions: Record<typeof RAW_DIMENSIONS[number], string>;
  overriddenFields: string[];
}

type PropertyMapping = Record<string, Record<Faction, string>>;
type MappingRow = Record<string, string>;

export interface V4BatchBuildInput {
  manifest: BatchManifest;
  journals: BatchJournalRow[];
  decisions: BatchDecision[];
  effectiveProfiles: EffectivePersonalityProfileInput[];
  allCivicBreedIds: string[];
  totalInitialPopulation: bigint;
  propertyMapping: PropertyMapping;
  politicalRows: MappingRow[];
  economicRows: MappingRow[];
  regionEffectiveBreeds?: EffectiveBreedSemantics[];
}

interface PreviewWorld {
  totalPopulation: string;
  dominantBreed: string;
  dominantFaction: Faction;
  politicalForm: string;
  economicForm: string;
  noResolvedPopulationIssues: string[];
  propertyCoverage: Record<string, { resolvedPopulation: string; totalPopulation: string }>;
}

export interface V4BatchReport {
  schemaVersion: "eidolon-research-v4-batch-report-v1";
  batchId: string;
  regionId: string;
  status: "PASS";
  counts: {
    manifestUnits: number;
    manifestBreeds: number;
    resultUnits: number;
    effectiveBreeds: number;
    journalEntries: number;
    sources: number;
    citations: number;
    evidence: number;
    inheritanceEdges: number;
    dimensionValuesExpected: number;
    dimensionValuesMaterialized: number;
  };
  missingUnits: string[];
  missingBreeds: string[];
  criticalNulls: number;
  unresolvedCriticalFields: number;
  invalidPersonalityIds: number;
  invalidTerrainValues: number;
  twelveDimensionMaterializationPercent: number;
  regionPreview: { status: "PASS"; worlds: Record<WorldKey, PreviewWorld> };
}

export interface V4BatchArtifacts {
  unitResults: V4UnitResult[];
  sources: V4Source[];
  citations: V4Citation[];
  evidence: V4ResearchEvidence[];
  inheritanceEdges: V4InheritanceEdge[];
  effectiveBreeds: EffectiveBreedSemantics[];
  report: V4BatchReport;
}

function uniqueExact(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

function lowerFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function subjectAlignment(unit: ResearchUnit): string {
  if (unit.unitType === "HUMAN_CULTURE") return "EXACT_CULTURE";
  if (unit.unitType === "MYTHOS_SPECIES") return "EXACT_TRADITIONAL_ENTITY";
  return "EXACT_SPECIES";
}

function inheritanceRule(unit: ResearchUnit): V4InheritanceEdge["inheritanceRule"] {
  if (unit.unitType === "HUMAN_CULTURE") return "EXACT_CULTURE";
  if (unit.unitType === "MYTHOS_SPECIES") return "EXACT_TRADITION";
  return "EXACT_SPECIES";
}

function sourceId(batchId: string, index: number): string {
  return `SRC_${batchId}_${String(index + 1).padStart(3, "0")}`;
}

export function buildV4BatchArtifacts(input: V4BatchBuildInput): V4BatchArtifacts {
  const { manifest } = input;
  const manifestUnitIds = manifest.units.map((unit) => unit.unitId);
  const manifestBreedIds = manifest.units.flatMap((unit) => unit.breedIds);
  uniqueExact("Manifest unit coverage", manifestUnitIds);
  uniqueExact("Manifest Breed coverage", manifestBreedIds);
  uniqueExact("Decision unit coverage", input.decisions.map((row) => row.researchUnitId));
  validateBatchCompleteness(
    { unitIds: manifestUnitIds, breedIds: manifestBreedIds },
    { unitIds: input.decisions.map((row) => row.researchUnitId), effectiveBreedIds: manifestBreedIds },
  );
  if (!manifest.units.every((unit) => unit.initialRegion === manifest.regionId)) throw new Error("Manifest Region coverage is not exact");

  const unitById = new Map(manifest.units.map((unit) => [unit.unitId, unit]));
  const acceptedJournals = input.journals.filter((row) => row.accepted);
  uniqueExact("Journal entry identity", input.journals.map((row) => row.journalEntryId));
  const journalById = new Map(acceptedJournals.map((row) => [row.journalEntryId, row]));
  for (const row of input.journals) {
    if (row.batchId !== manifest.batchId) throw new Error(`Journal ${row.journalEntryId} has wrong batch`);
    if (!unitById.has(row.targetUnitId)) throw new Error(`Journal ${row.journalEntryId} targets an unknown unit`);
    if (row.accepted && row.sourceOpened !== true) throw new Error(`Journal ${row.journalEntryId} source was not opened`);
    if (row.accepted && (!row.query.trim() || !row.searchResultChosen.trim() || !row.locator.trim() || !row.boundedContext.trim() || !row.sourceFact.trim())) throw new Error(`Journal ${row.journalEntryId} lacks required provenance`);
    if (row.accepted) new URL(row.actualOpenedUrl);
    if (!row.accepted && !row.rejectionReason?.trim()) throw new Error(`Rejected journal ${row.journalEntryId} lacks rejection reason`);
  }

  const profileById = new Map(input.effectiveProfiles.map((profile) => [profile.personalityId, profile]));
  uniqueExact("Personality policy profile identity", input.effectiveProfiles.map((profile) => profile.personalityId));
  const decisionByUnit = new Map(input.decisions.map((decision) => [decision.researchUnitId, decision]));
  for (const unit of manifest.units) {
    const decision = decisionByUnit.get(unit.unitId);
    if (!decision) throw new Error(`Missing decision for ${unit.unitId}`);
    if (decision.batchId !== manifest.batchId || decision.status !== "SIMULATION_READY") throw new Error(`Decision ${unit.unitId} is not simulation ready`);
    if (!profileById.has(decision.personalityId)) throw new Error(`Invalid Personality Expression ${decision.personalityId}`);
    if (!decision.personalityBridge.trim()) throw new Error(`Decision ${unit.unitId} lacks a personality normalization bridge`);
    if (unit.unitType === "HUMAN_CULTURE" && decision.inferenceClassification !== "EIDOLON_AUTHORED_INFERENCE") {
      throw new Error(`Human Culture ${unit.unitId} requires explicit authored inference classification`);
    }
    if (unit.unitType !== "HUMAN_CULTURE" && decision.inferenceClassification === "EIDOLON_AUTHORED_INFERENCE") {
      throw new Error(`${unit.unitId} cannot use Human authored inference classification`);
    }
    if (!decision.terrainBroad.length || decision.terrainBroad.some((value) => !TERRAIN_BROAD.has(value))) throw new Error(`Invalid terrainBroad for ${unit.unitId}`);
    if (!decision.terrainSpecific.length || decision.terrainSpecific.some((value) => !TERRAIN_SPECIFIC.has(value))) throw new Error(`Invalid terrainSpecific for ${unit.unitId}`);
    uniqueExact(`${unit.unitId} terrainBroad`, decision.terrainBroad);
    uniqueExact(`${unit.unitId} terrainSpecific`, decision.terrainSpecific);
    for (const field of TARGET_FIELDS) {
      const journal = journalById.get(decision.journalEntryIds[field]);
      if (!journal || journal.targetUnitId !== unit.unitId || journal.targetField !== field) throw new Error(`Missing accepted ${field} journal for ${unit.unitId}`);
    }
  }

  const openedUrls = [...new Set(acceptedJournals.map((row) => row.actualOpenedUrl))].sort();
  const sourceIdByUrl = new Map(openedUrls.map((url, index) => [url, sourceId(manifest.batchId, index)]));
  const sources = openedUrls.map((url): V4Source => {
    const row = acceptedJournals.find((journal) => journal.actualOpenedUrl === url)!;
    return {
      sourceId: sourceIdByUrl.get(url)!, title: row.title, authorOrOrganization: row.organization,
      publisher: row.publisher, stableUrlOrIdentifier: url, sourceOpened: true,
    };
  });
  const citations = acceptedJournals.map((row): V4Citation => ({
    citationId: `CIT_${row.journalEntryId}`, sourceId: sourceIdByUrl.get(row.actualOpenedUrl)!, locator: row.locator,
    boundedContext: row.boundedContext, sourceFact: row.sourceFact,
    subjectAlignment: subjectAlignment(unitById.get(row.targetUnitId)!),
    claimAlignment: unitById.get(row.targetUnitId)!.unitType === "HUMAN_CULTURE" && row.targetField === "personalityId"
      ? "EIDOLON_AUTHORED_INFERENCE"
      : "ACCEPTED_DIRECT_EVIDENCE",
  }));
  const evidence = acceptedJournals.map((row): V4ResearchEvidence => {
    const decision = decisionByUnit.get(row.targetUnitId)!;
    const normalizationBridge = row.targetField === "personalityId"
      ? decision.personalityBridge
      : `${row.sourceFact} Normalized only to controlled ${row.targetField} tokens: ${decision[row.targetField].join(", ")}.`;
    const value: V4ResearchEvidence = {
      evidenceId: `EVD_${row.journalEntryId}`, researchUnitId: row.targetUnitId, targetField: row.targetField,
      batchId: manifest.batchId, journalEntryId: row.journalEntryId, researchedAt: row.timestamp, sourceOpened: true,
      sourceUrl: row.actualOpenedUrl, sourceTitle: row.title, locator: row.locator, boundedContext: row.boundedContext,
      sourceFact: row.sourceFact, normalizationBridge, generatedBy: "BATCH_RESEARCH",
    };
    validateResearchEvidence(value as unknown as Record<string, unknown>);
    return value;
  });
  const evidenceByJournal = new Map(evidence.map((row) => [row.journalEntryId, row.evidenceId]));
  const unitResults = manifest.units.map((unit): V4UnitResult => {
    const decision = decisionByUnit.get(unit.unitId)!;
    return {
      researchUnitId: unit.unitId, personalityId: decision.personalityId,
      terrainBroad: [...decision.terrainBroad], terrainSpecific: [...decision.terrainSpecific],
      evidenceRefs: TARGET_FIELDS.map((field) => evidenceByJournal.get(decision.journalEntryIds[field])!),
      status: "SIMULATION_READY",
    };
  });
  const inheritanceEdges = manifest.units.flatMap((unit): V4InheritanceEdge[] => {
    const result = unitResults.find((row) => row.researchUnitId === unit.unitId)!;
    return unit.breedIds.map((breedId) => ({ researchUnitId: unit.unitId, breedId, inheritanceRule: inheritanceRule(unit), unitEvidenceRefs: [...result.evidenceRefs] }));
  });
  const personalityIds = new Set(input.effectiveProfiles.map((profile) => profile.personalityId));
  const effectiveBreeds = manifest.units.flatMap((unit): EffectiveBreedSemantics[] => {
    const decision = decisionByUnit.get(unit.unitId)!;
    const profile = profileById.get(decision.personalityId)!;
    return unit.breedIds.map((breedId) => {
      const dimensions = Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, {
        value: profile.dimensions[field], disposition: "OWNER_POLICY_VALUE", policyRef: PERSONALITY_DIMENSION_POLICY,
      }])) as EffectiveBreedSemantics["dimensions"];
      const row: EffectiveBreedSemantics = {
        schemaVersion: "eidolon-effective-breed-semantics-v4", breedId, populationKind: unit.populationKind,
        researchUnitId: unit.unitId, personalityId: decision.personalityId,
        terrainBroad: [...decision.terrainBroad], terrainSpecific: [...decision.terrainSpecific], dimensions,
      };
      validateEffectiveBreedSemantics(row as unknown as Record<string, unknown>, personalityIds);
      return row;
    });
  });
  validateBatchCompleteness(
    { unitIds: manifestUnitIds, breedIds: manifestBreedIds },
    { unitIds: unitResults.map((row) => row.researchUnitId), effectiveBreedIds: effectiveBreeds.map((row) => row.breedId) },
  );

  uniqueExact("Global civic Breed identity", input.allCivicBreedIds);
  if (manifestBreedIds.some((breedId) => !input.allCivicBreedIds.includes(breedId))) throw new Error("Batch Breed is absent from global civic population");
  const regionEffectiveBreeds = [...(input.regionEffectiveBreeds ?? []), ...effectiveBreeds];
  uniqueExact("Region preview Breed identity", regionEffectiveBreeds.map((breed) => breed.breedId));
  if (effectiveBreeds.some((breed) => !regionEffectiveBreeds.some((candidate) => candidate.breedId === breed.breedId))) {
    throw new Error("Region preview omits a current batch Breed");
  }
  const allocation = allocateEqualPopulation(input.allCivicBreedIds, input.totalInitialPopulation);
  const cohorts = regionEffectiveBreeds.map((breed) => ({ breedId: breed.breedId, population: allocation.get(breed.breedId)! }));
  const totalPopulation = cohorts.reduce((sum, cohort) => sum + cohort.population, 0n);
  const properties = new Map(regionEffectiveBreeds.map((breed) => [breed.breedId, Object.fromEntries(Object.keys(input.propertyMapping).map((property) => [property, breed.dimensions[lowerFirst(property) as keyof typeof breed.dimensions].value]))]));
  const worlds = Object.fromEntries((["CONCORD", "SCHISM", "RUIN"] as WorldKey[]).map((world): [WorldKey, PreviewWorld] => {
    const projected = projectRawProperties(cohorts, properties, world, input.propertyMapping);
    const propertyCoverage = Object.fromEntries(Object.entries(projected.properties).map(([property, value]) => {
      if (value.resolvedPopulation !== totalPopulation || value.unresolvedPopulation !== 0n || value.winner === null) throw new Error(`${world} ${property} is not fully resolved`);
      return [lowerFirst(property), { resolvedPopulation: value.resolvedPopulation.toString(), totalPopulation: totalPopulation.toString() }];
    }));
    const winners = Object.fromEntries(Object.entries(projected.properties).map(([property, value]) => [lowerFirst(property), value.winner!])) as Record<string, string>;
    const dominantBreed = [...cohorts].sort((a, b) => a.population !== b.population ? (a.population > b.population ? -1 : 1) : a.breedId.localeCompare(b.breedId))[0]?.breedId;
    if (!dominantBreed) throw new Error(`${world} has no dominant Breed`);
    return [world, {
      totalPopulation: totalPopulation.toString(), dominantBreed, dominantFaction: projected.dominantFaction,
      politicalForm: derivePoliticalForm(winners, input.politicalRows), economicForm: deriveEconomicForm(winners, input.economicRows),
      noResolvedPopulationIssues: [], propertyCoverage,
    }];
  })) as Record<WorldKey, PreviewWorld>;

  const expectedDimensionValues = manifestBreedIds.length * RAW_DIMENSIONS.length;
  const materializedDimensionValues = effectiveBreeds.reduce((sum, breed) => sum + RAW_DIMENSIONS.filter((field) => Boolean(breed.dimensions[field]?.value)).length, 0);
  const report: V4BatchReport = {
    schemaVersion: "eidolon-research-v4-batch-report-v1", batchId: manifest.batchId, regionId: manifest.regionId, status: "PASS",
    counts: {
      manifestUnits: manifestUnitIds.length, manifestBreeds: manifestBreedIds.length, resultUnits: unitResults.length,
      effectiveBreeds: effectiveBreeds.length, journalEntries: input.journals.length, sources: sources.length,
      citations: citations.length, evidence: evidence.length, inheritanceEdges: inheritanceEdges.length,
      dimensionValuesExpected: expectedDimensionValues, dimensionValuesMaterialized: materializedDimensionValues,
    },
    missingUnits: [], missingBreeds: [], criticalNulls: 0, unresolvedCriticalFields: 0, invalidPersonalityIds: 0,
    invalidTerrainValues: 0, twelveDimensionMaterializationPercent: materializedDimensionValues / expectedDimensionValues * 100,
    regionPreview: { status: "PASS", worlds },
  };
  return { unitResults, sources, citations, evidence, inheritanceEdges, effectiveBreeds, report };
}
