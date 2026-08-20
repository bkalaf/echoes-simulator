import {
  RAW_DIMENSIONS,
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
import type { BatchDecision, BatchJournalRow } from "./v4-batch.js";

export const V4_AUDIT_STATUSES = [
  "PASS", "FAIL_SOURCE", "FAIL_SUBJECT_ALIGNMENT", "FAIL_CLAIM_ALIGNMENT", "FAIL_NORMALIZATION",
  "FAIL_PERSONALITY_MAPPING", "FAIL_TERRAIN_MAPPING", "FAIL_INHERITANCE", "FAIL_GENERIC_SOURCE", "NOT_VERIFIABLE",
] as const;
export type V4AuditStatus = typeof V4_AUDIT_STATUSES[number];
type TargetField = "personalityId" | "terrainBroad" | "terrainSpecific";

export interface AuditManifestUnit {
  unitType: ResearchUnit["unitType"];
  unitId: string;
  initialRegion: string;
}

export interface AuditShardManifest {
  auditShardId: string;
  unitCount: number;
  regions: string[];
  units: AuditManifestUnit[];
}

export interface AuditBatchArtifacts {
  batchId: string;
  manifestUnits: ResearchUnit[];
  journals: BatchJournalRow[];
  decisions: BatchDecision[];
  unitResults: V4UnitResult[];
  sources: V4Source[];
  citations: V4Citation[];
  evidence: V4ResearchEvidence[];
  inheritanceEdges: V4InheritanceEdge[];
  effectiveBreeds: EffectiveBreedSemantics[];
}

export interface AuditFieldResult {
  field: TargetField;
  status: V4AuditStatus;
  evidenceId: string | null;
  journalEntryId: string | null;
  sourceId: string | null;
  citationId: string | null;
  messages: string[];
}

export interface AuditUnitResult {
  researchUnitId: string;
  unitType: ResearchUnit["unitType"];
  regionId: string;
  batchId: string | null;
  status: V4AuditStatus;
  fields: AuditFieldResult[];
  inheritance: { status: V4AuditStatus; expectedBreedIds: string[]; actualBreedIds: string[]; messages: string[] };
  messages: string[];
}

export interface IndependentAuditResult {
  schemaVersion: "eidolon-research-v4-independent-audit-v1";
  auditId: string;
  status: "PASS" | "FAIL";
  generatedAt: string;
  researchArtifactsUnmodified: boolean;
  counts: {
    manifestUnits: number;
    auditedUnits: number;
    passingUnits: number;
    failingUnits: number;
    evidenceChains: number;
    passingEvidenceChains: number;
    inheritedBreeds: number;
  };
  statusCounts: Record<V4AuditStatus, number>;
  units: AuditUnitResult[];
}

const TARGET_FIELDS: TargetField[] = ["personalityId", "terrainBroad", "terrainSpecific"];
const TERRAIN_BROAD = new Set(["MOUNTAIN", "FOREST", "WETLAND", "COASTAL", "OCEAN", "FRESHWATER", "DESERT", "GRASSLAND", "SUBTERRANEAN", "POLAR_ICE", "BUILT_ENVIRONMENT", "GENERALIST"]);
const TERRAIN_SPECIFIC = new Set(["ALPINE", "BOG", "BOREAL_FOREST", "BURROW", "CANOPY", "CANYON", "CASTLE", "CAVE", "CITY", "CLIFF", "CLOUD_FOREST", "COASTAL_CLIFF", "CORAL_REEF", "DELTA", "DUNES", "ESTUARY", "FARMLAND", "FJORD", "FLOODPLAIN", "FLOWERING_HABITAT", "FOREST_EDGE", "FOREST_FLOOR", "GENERALIST", "GLACIER", "HOT_DESERT", "ISLAND", "KARST", "KELP_FOREST", "LAKE", "MANGROVE", "MARSH", "MEADOW", "MINE", "MONTANE_FOREST", "MUDFLAT", "OASIS", "OLD_GROWTH_FOREST", "PACK_ICE", "PELAGIC", "PLATEAU", "POND", "PRAIRIE", "RAIN_FOREST", "RIVER", "ROAD", "RUINS", "SAVANNA", "SCRUBLAND", "SEAGRASS_BED", "SOIL", "STEPPE", "SWAMP", "TEMPLE", "TUNDRA", "TUNNEL", "VILLAGE", "VOLCANIC", "WOODLAND", "WORKSHOP"]);
const FAILURE_PRIORITY = V4_AUDIT_STATUSES.filter((status) => status !== "PASS");

function expectedSubjectAlignment(unit: ResearchUnit): string {
  if (unit.unitType === "HUMAN_CULTURE") return "EXACT_CULTURE";
  if (unit.unitType === "MYTHOS_SPECIES") return "EXACT_TRADITIONAL_ENTITY";
  return "EXACT_SPECIES";
}

function expectedInheritanceRule(unit: ResearchUnit): V4InheritanceEdge["inheritanceRule"] {
  if (unit.unitType === "HUMAN_CULTURE") return "EXACT_CULTURE";
  if (unit.unitType === "MYTHOS_SPECIES") return "EXACT_TRADITION";
  return "EXACT_SPECIES";
}

function failure(statuses: readonly V4AuditStatus[]): V4AuditStatus {
  return FAILURE_PRIORITY.find((status) => statuses.includes(status)) ?? "PASS";
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0") && new Set(left).size === left.length && new Set(right).size === right.length;
}

function isGenericSource(source: V4Source, journal: BatchJournalRow): boolean {
  let parsed: URL;
  try { parsed = new URL(source.stableUrlOrIdentifier); } catch { return true; }
  if (/\b(search results?|category|index|homepage)\b/i.test(source.title)) return true;
  if (/\/(?:category|categories|tags?)(?:\/|$)/i.test(parsed.pathname)) return true;
  if (/\/(?:search)\/?$/i.test(parsed.pathname) || (/\/(?:search)\//i.test(parsed.pathname) && !/\/(?:search)\/[a-z0-9_-]+\/?$/i.test(parsed.pathname))) return true;
  return (parsed.pathname === "/" || parsed.pathname === "") && /^(?:home|homepage|index|root)$/i.test(journal.locator.trim());
}

function fieldResult(field: TargetField, input: {
  unit: ResearchUnit;
  batch: AuditBatchArtifacts;
  decision: BatchDecision;
  result: V4UnitResult;
  personalityIds: ReadonlySet<string>;
}): AuditFieldResult {
  const { unit, batch, decision, result, personalityIds } = input;
  const messages: string[] = [];
  const statuses: V4AuditStatus[] = [];
  const journalId = decision.journalEntryIds[field];
  const journal = batch.journals.find((row) => row.journalEntryId === journalId);
  const evidence = batch.evidence.find((row) => row.journalEntryId === journalId && row.targetField === field && row.researchUnitId === unit.unitId);
  const citation = batch.citations.find((row) => row.citationId === `CIT_${journalId}`);
  const source = journal ? batch.sources.find((row) => row.stableUrlOrIdentifier === journal.actualOpenedUrl) : undefined;

  const add = (status: V4AuditStatus, message: string): void => { statuses.push(status); messages.push(message); };
  if (!journal || !evidence || !citation || !source) {
    add("NOT_VERIFIABLE", "The journal, evidence, citation, and opened source chain is not complete.");
  } else {
    if (!journal.accepted || journal.sourceOpened !== true || evidence.sourceOpened !== true || source.sourceOpened !== true) add("FAIL_SOURCE", "An active source-chain record is not accepted/opened.");
    if (journal.batchId !== batch.batchId || journal.targetUnitId !== unit.unitId || journal.targetField !== field || evidence.batchId !== batch.batchId) add("FAIL_SOURCE", "The source chain targets a different batch, unit, or field.");
    if (!journal.query.trim() || !journal.searchResultChosen.trim() || !journal.title.trim() || !journal.organization.trim() || !journal.publisher.trim()) add("NOT_VERIFIABLE", "Search and publisher provenance is incomplete.");
    if (!journal.locator.trim() || !journal.boundedContext.trim() || !journal.sourceFact.trim()) add("NOT_VERIFIABLE", "The locator, bounded context, or source-fact paraphrase is empty.");
    if (journal.actualOpenedUrl !== evidence.sourceUrl || journal.title !== evidence.sourceTitle || journal.locator !== evidence.locator || journal.boundedContext !== evidence.boundedContext || journal.sourceFact !== evidence.sourceFact) add("FAIL_SOURCE", "Journal and evidence provenance do not agree exactly.");
    if (citation.sourceId !== source.sourceId || citation.locator !== journal.locator || citation.boundedContext !== journal.boundedContext || citation.sourceFact !== journal.sourceFact) add("FAIL_SOURCE", "Citation and journal provenance do not agree exactly.");
    if (citation.subjectAlignment !== expectedSubjectAlignment(unit)) add("FAIL_SUBJECT_ALIGNMENT", `Expected ${expectedSubjectAlignment(unit)}, received ${citation.subjectAlignment}.`);
    const expectedClaim = unit.unitType === "HUMAN_CULTURE" && field === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE";
    if (citation.claimAlignment !== expectedClaim) add("FAIL_CLAIM_ALIGNMENT", `Expected ${expectedClaim}, received ${citation.claimAlignment}.`);
    if (isGenericSource(source, journal)) add("FAIL_GENERIC_SOURCE", "A homepage, search, category, or index source is supporting an active value.");
    try { validateResearchEvidence(evidence as unknown as Record<string, unknown>); } catch (error) { add("FAIL_SOURCE", error instanceof Error ? error.message : String(error)); }

    if (field === "personalityId") {
      if (!personalityIds.has(decision.personalityId) || result.personalityId !== decision.personalityId) add("FAIL_PERSONALITY_MAPPING", "The Personality ID is absent from policy or differs between the decision and unit result.");
      if (evidence.normalizationBridge !== decision.personalityBridge || !decision.personalityBridge.trim()) add("FAIL_PERSONALITY_MAPPING", "The active Personality evidence does not preserve the reviewed inference bridge.");
      if (unit.unitType === "HUMAN_CULTURE" && decision.inferenceClassification !== "EIDOLON_AUTHORED_INFERENCE") add("FAIL_PERSONALITY_MAPPING", "Human Culture mapping lacks the required owner-authored inference classification.");
      if (unit.unitType !== "HUMAN_CULTURE" && decision.inferenceClassification === "EIDOLON_AUTHORED_INFERENCE") add("FAIL_PERSONALITY_MAPPING", "Non-Human direct behavior evidence is incorrectly classified as Human authored inference.");
    } else {
      const selected = decision[field];
      const allowed = field === "terrainBroad" ? TERRAIN_BROAD : TERRAIN_SPECIFIC;
      if (!selected.length || new Set(selected).size !== selected.length || selected.some((token) => !allowed.has(token))) add("FAIL_TERRAIN_MAPPING", `The ${field} token set is empty, duplicated, or outside the controlled vocabulary.`);
      if (!sameStrings(result[field], selected)) add("FAIL_TERRAIN_MAPPING", `The ${field} decision and unit result differ.`);
      if (!selected.every((token) => evidence.normalizationBridge.includes(token)) || !evidence.normalizationBridge.includes(`controlled ${field} tokens`)) add("FAIL_NORMALIZATION", `The ${field} normalization bridge does not enumerate the selected controlled tokens.`);
    }
  }
  if (!result.evidenceRefs.includes(evidence?.evidenceId ?? "")) add("FAIL_SOURCE", "The unit result does not activate this evidence record.");
  return { field, status: failure(statuses), evidenceId: evidence?.evidenceId ?? null, journalEntryId: journal?.journalEntryId ?? null, sourceId: source?.sourceId ?? null, citationId: citation?.citationId ?? null, messages };
}

export function auditV4Shard(input: {
  shard: AuditShardManifest;
  batches: AuditBatchArtifacts[];
  personalityIds: ReadonlySet<string>;
  generatedAt: string;
  researchArtifactsUnmodified?: boolean;
}): IndependentAuditResult {
  const unitLocations = new Map<string, { unit: ResearchUnit; batch: AuditBatchArtifacts }>();
  for (const batch of input.batches) for (const unit of batch.manifestUnits) {
    if (unitLocations.has(unit.unitId)) throw new Error(`Research unit ${unit.unitId} appears in multiple batches`);
    unitLocations.set(unit.unitId, { unit, batch });
  }
  if (input.shard.units.length !== input.shard.unitCount || new Set(input.shard.units.map((unit) => unit.unitId)).size !== input.shard.unitCount) throw new Error(`${input.shard.auditShardId} manifest coverage is not exact`);

  const units = input.shard.units.map((auditUnit): AuditUnitResult => {
    const located = unitLocations.get(auditUnit.unitId);
    if (!located) return {
      researchUnitId: auditUnit.unitId, unitType: auditUnit.unitType, regionId: auditUnit.initialRegion, batchId: null,
      status: "NOT_VERIFIABLE", fields: [], inheritance: { status: "NOT_VERIFIABLE", expectedBreedIds: [], actualBreedIds: [], messages: ["Research unit is absent from every completed Region batch."] },
      messages: ["Research unit is absent from every completed Region batch."],
    };
    const { unit, batch } = located;
    const messages: string[] = [];
    if (unit.unitType !== auditUnit.unitType || unit.initialRegion !== auditUnit.initialRegion) messages.push("Audit and Region manifests disagree on unit type or Region.");
    const decision = batch.decisions.find((row) => row.researchUnitId === unit.unitId);
    const result = batch.unitResults.find((row) => row.researchUnitId === unit.unitId);
    if (!decision || !result || decision.status !== "SIMULATION_READY" || result.status !== "SIMULATION_READY") return {
      researchUnitId: unit.unitId, unitType: unit.unitType, regionId: unit.initialRegion, batchId: batch.batchId,
      status: "NOT_VERIFIABLE", fields: [], inheritance: { status: "NOT_VERIFIABLE", expectedBreedIds: [...unit.breedIds], actualBreedIds: [], messages: ["No simulation-ready decision/result pair exists."] },
      messages: [...messages, "No simulation-ready decision/result pair exists."],
    };
    const fields = TARGET_FIELDS.map((field) => fieldResult(field, { unit, batch, decision, result, personalityIds: input.personalityIds }));
    if (result.evidenceRefs.length !== TARGET_FIELDS.length || new Set(result.evidenceRefs).size !== TARGET_FIELDS.length) fields[0]!.messages.push("The unit result does not have exactly three unique active evidence references"), fields[0]!.status = "FAIL_SOURCE";

    const edges = batch.inheritanceEdges.filter((edge) => edge.researchUnitId === unit.unitId);
    const actualBreedIds = edges.map((edge) => edge.breedId);
    const inheritanceMessages: string[] = [];
    if (!sameStrings(unit.breedIds, actualBreedIds)) inheritanceMessages.push("Inherited Breed coverage differs from the exact research-unit Breed set.");
    for (const edge of edges) {
      if (edge.inheritanceRule !== expectedInheritanceRule(unit)) inheritanceMessages.push(`${edge.breedId} uses ${edge.inheritanceRule}, expected ${expectedInheritanceRule(unit)}.`);
      if (!sameStrings(edge.unitEvidenceRefs, result.evidenceRefs)) inheritanceMessages.push(`${edge.breedId} does not preserve the unit's exact active evidence set.`);
    }
    const effective = batch.effectiveBreeds.filter((row) => row.researchUnitId === unit.unitId);
    if (!sameStrings(effective.map((row) => row.breedId), unit.breedIds)) inheritanceMessages.push("Effective Breed coverage differs from the exact research-unit Breed set.");
    for (const row of effective) {
      try { validateEffectiveBreedSemantics(row as unknown as Record<string, unknown>, input.personalityIds); } catch (error) { inheritanceMessages.push(error instanceof Error ? error.message : String(error)); }
      if (row.personalityId !== decision.personalityId || !sameStrings(row.terrainBroad, decision.terrainBroad) || !sameStrings(row.terrainSpecific, decision.terrainSpecific)) inheritanceMessages.push(`${row.breedId} does not inherit the exact unit semantics.`);
      if (Object.keys(row.dimensions).length !== RAW_DIMENSIONS.length) inheritanceMessages.push(`${row.breedId} does not materialize exactly twelve raw dimensions.`);
    }
    const inheritance = { status: (inheritanceMessages.length ? "FAIL_INHERITANCE" : "PASS") as V4AuditStatus, expectedBreedIds: [...unit.breedIds], actualBreedIds, messages: inheritanceMessages };
    const status = failure([...fields.map((field) => field.status), inheritance.status, ...(messages.length ? ["NOT_VERIFIABLE" as const] : [])]);
    return { researchUnitId: unit.unitId, unitType: unit.unitType, regionId: unit.initialRegion, batchId: batch.batchId, status, fields, inheritance, messages };
  });

  const statusCounts = Object.fromEntries(V4_AUDIT_STATUSES.map((status) => [status, units.filter((unit) => unit.status === status).length])) as Record<V4AuditStatus, number>;
  const passingEvidenceChains = units.flatMap((unit) => unit.fields).filter((field) => field.status === "PASS").length;
  return {
    schemaVersion: "eidolon-research-v4-independent-audit-v1", auditId: input.shard.auditShardId,
    status: units.every((unit) => unit.status === "PASS") ? "PASS" : "FAIL", generatedAt: input.generatedAt,
    researchArtifactsUnmodified: input.researchArtifactsUnmodified ?? true,
    counts: {
      manifestUnits: input.shard.unitCount, auditedUnits: units.length,
      passingUnits: statusCounts.PASS, failingUnits: units.length - statusCounts.PASS,
      evidenceChains: units.flatMap((unit) => unit.fields).length, passingEvidenceChains,
      inheritedBreeds: units.reduce((sum, unit) => sum + unit.inheritance.actualBreedIds.length, 0),
    }, statusCounts, units,
  };
}
