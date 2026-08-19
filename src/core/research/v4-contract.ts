export const PERSONALITY_DIMENSION_POLICY = "PERSONALITY_PROFILE_DIMENSIONS_V1" as const;
export const RAW_DIMENSIONS = [
  "motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode",
  "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture",
] as const;
export const SIMULATION_CRITICAL_FIELDS = ["personalityId", "terrainBroad", "terrainSpecific", ...RAW_DIMENSIONS] as const;
export const AUTHORING_ENRICHMENT_FIELDS = ["traits", "foodBroad", "foodSpecific"] as const;

export type ResearchUnitType = "HUMAN_CULTURE" | "BEAST_SPECIES" | "MYTHOS_SPECIES";
export interface ResearchUnit {
  unitType: ResearchUnitType;
  unitId: string;
  populationKind: "HUMAN" | "BEAST" | "MYTHOS";
  initialRegion: string;
  groupIds: string[];
  breedIds: string[];
}
export interface ResearchJournalEntry { journalEntryId: string; batchId: string; researchUnitId: string; researchedAt: string; queries: string[]; consideredUrls: string[]; openedSourceIds: string[]; }
export interface V4Source { sourceId: string; title: string; authorOrOrganization: string; publisher: string; stableUrlOrIdentifier: string; sourceOpened: true; }
export interface V4Citation { citationId: string; sourceId: string; locator: string; boundedContext: string; sourceFact: string; subjectAlignment: string; claimAlignment: string; }
export interface V4ResearchEvidence { evidenceId: string; researchUnitId: string; targetField: "personalityId" | "terrainBroad" | "terrainSpecific"; batchId: string; journalEntryId: string; researchedAt: string; sourceOpened: true; sourceUrl: string; sourceTitle: string; locator: string; boundedContext: string; sourceFact: string; normalizationBridge: string; generatedBy: "BATCH_RESEARCH"; }
export interface V4UnitResult { researchUnitId: string; personalityId: string; terrainBroad: string[]; terrainSpecific: string[]; evidenceRefs: string[]; status: "SIMULATION_READY"; }
export interface V4InheritanceEdge { researchUnitId: string; breedId: string; inheritanceRule: "EXACT_CULTURE" | "EXACT_SPECIES" | "EXACT_TRADITION"; unitEvidenceRefs: string[]; }
export interface PolicyDimensionValue { value: string; disposition: "OWNER_POLICY_VALUE"; policyRef: typeof PERSONALITY_DIMENSION_POLICY; }
export interface PersonalityPolicyProfile { family: string; baseDimensions: Record<typeof RAW_DIMENSIONS[number], string>; fieldRationales: Record<typeof RAW_DIMENSIONS[number], string>; duplicateProfileJustification?: string; }
export interface EffectiveBreedSemantics { schemaVersion: "eidolon-effective-breed-semantics-v4"; breedId: string; populationKind: "HUMAN" | "BEAST" | "MYTHOS"; researchUnitId: string; personalityId: string; terrainBroad: string[]; terrainSpecific: string[]; dimensions: Record<typeof RAW_DIMENSIONS[number], PolicyDimensionValue>; }
export interface V4AuditFinding { findingId: string; shardId: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; researchUnitId: string; field: string; status: "OPEN" | "REMEDIATED" | "PASS"; message: string; }

function exactSet(label: string, expected: readonly string[], actual: readonly string[]): void {
  const left = [...new Set(expected)].sort();
  const right = [...new Set(actual)].sort();
  if (left.length !== expected.length || right.length !== actual.length || left.join("\0") !== right.join("\0")) throw new Error(`${label} coverage is not exact`);
}

export function validateEffectiveBreedSemantics(candidate: Record<string, unknown>, personalityIds: ReadonlySet<string>): void {
  if (!String(candidate.breedId ?? "") || candidate.populationKind === "PET") throw new Error("Effective civic Breed identity is invalid");
  const personalityId = candidate.personalityId;
  if (typeof personalityId !== "string" || !personalityId) throw new Error("Civic personalityId cannot be null");
  if (!personalityIds.has(personalityId)) throw new Error(`Invalid Personality Expression ${personalityId}`);
  for (const terrain of ["terrainBroad", "terrainSpecific"] as const) if (!Array.isArray(candidate[terrain]) || !(candidate[terrain] as unknown[]).length) throw new Error(`Civic ${terrain} cannot be null`);
  const dimensions = candidate.dimensions as Record<string, Record<string, unknown>> | undefined;
  for (const field of RAW_DIMENSIONS) {
    const value = dimensions?.[field];
    if (!value || typeof value.value !== "string" || !value.value) throw new Error(`Civic raw dimension ${field} cannot be null`);
    if (value.disposition !== "OWNER_POLICY_VALUE") throw new Error(`${field} must use OWNER_POLICY_VALUE`);
    if (value.policyRef !== PERSONALITY_DIMENSION_POLICY) throw new Error(`${field} is missing policyRef ${PERSONALITY_DIMENSION_POLICY}`);
  }
}

export function validateResearchEvidence(evidence: Record<string, unknown>): void {
  if (evidence.generatedBy === "CONSOLIDATION") throw new Error("Consolidation-generated evidence is prohibited");
  for (const key of ["batchId", "journalEntryId", "researchedAt", "locator", "boundedContext", "sourceFact", "normalizationBridge"] as const) if (!String(evidence[key] ?? "").trim()) throw new Error(`Evidence lacks ${key}`);
  if (evidence.sourceOpened !== true) throw new Error("Evidence source was not opened");
  const url = new URL(String(evidence.sourceUrl));
  const genericLocator = /^(?:home|homepage|index|root)$/i.test(String(evidence.locator).trim());
  if ((url.pathname === "/" || url.pathname === "") && genericLocator) throw new Error("Generic fallback source cannot be active evidence");
}

export function validateBatchCompleteness(manifest: { unitIds: string[]; breedIds: string[] }, result: { unitIds: string[]; effectiveBreedIds: string[] }): void {
  exactSet("Research unit", manifest.unitIds, result.unitIds);
  exactSet("Breed", manifest.breedIds, result.effectiveBreedIds);
}

export function validateV4Authority(manifest: Record<string, unknown>): void {
  if (manifest.status === "RETIRED_FALSE_COMPLETION" || /v3/i.test(String(manifest.schemaVersion ?? ""))) throw new Error("Retired V3 cannot satisfy V4 authority");
  if (manifest.schemaVersion !== "eidolon-breed-semantics-v4-manifest" || manifest.status !== "SIMULATION_READY") throw new Error("Unknown or incomplete V4 authority");
}

export function reconcileResearchUnitIndex(index: { units: ResearchUnit[] }, breeds: readonly Record<string, unknown>[], assignments: readonly { groupId: string; regionId: string }[]): { units: number; civicBreeds: number } {
  const breedById = new Map(breeds.filter((breed) => breed.populationKind !== "PET").map((breed) => [String(breed.breedId), breed]));
  const regionByGroup = new Map(assignments.filter((row) => row.regionId !== "R10").map((row) => [row.groupId, row.regionId]));
  const covered: string[] = [];
  for (const unit of index.units) {
    if (!unit.breedIds.length) throw new Error(`Unit ${unit.unitId} has no Breeds`);
    for (const breedId of unit.breedIds) {
      const breed = breedById.get(breedId);
      if (!breed) throw new Error(`Identity drift: unknown civic Breed ${breedId}`);
      const expectedUnit = unit.unitType === "HUMAN_CULTURE" ? String(breed.cultureId) : String(breed.speciesId);
      if (expectedUnit !== unit.unitId || breed.populationKind !== unit.populationKind) throw new Error(`Identity drift in ${breedId}: ${expectedUnit} != ${unit.unitId}`);
      const region = regionByGroup.get(String(breed.groupId));
      if (region !== unit.initialRegion) throw new Error(`Region drift in ${breedId}: ${region} != ${unit.initialRegion}`);
      covered.push(breedId);
    }
  }
  exactSet("Civic Breed reconciliation", [...breedById.keys()], covered);
  if (new Set(index.units.map((unit) => `${unit.unitType}:${unit.unitId}`)).size !== index.units.length) throw new Error("Duplicate research unit identity");
  return { units: index.units.length, civicBreeds: covered.length };
}
