import { createHash } from "node:crypto";

export const RESEARCH_RECORD_TYPES = ["TAXONOMY", "SPECIES", "CULTURE", "SPECIES_GROUP", "BREED"] as const;
export type ResearchRecordType = (typeof RESEARCH_RECORD_TYPES)[number];
export type BehaviorScore = 0 | 1 | 2 | 3 | 4;
export enum Aggressive { DEFENSIVE = "DEFENSIVE", NEUTRAL = "NEUTRAL", OFFENSIVE = "OFFENSIVE" }
export enum SocialEffort { MILITARY = "MILITARY", INFRASTRUCTURE = "INFRASTRUCTURE", SOCIAL_PROGRAMS = "SOCIAL_PROGRAMS" }
export enum IntellectualEffort { APPLICATION = "APPLICATION", BALANCED = "BALANCED", THEORY = "THEORY" }

export interface PrimitiveBehaviorScores {
  aggression: BehaviorScore;
  territorial: BehaviorScore;
  parental: BehaviorScore;
  social: BehaviorScore;
  nesting: BehaviorScore;
  intelligence: BehaviorScore;
}

export interface ResearchClassificationBase {
  recordType: ResearchRecordType;
  recordId: string;
  name: string;
  text: string;
  primitiveBehavior: Record<keyof PrimitiveBehaviorScores, { score: BehaviorScore; evidenceRefs: string[]; defaulted: boolean; rationale: string }>;
}
export interface TaxonomyResearchRecord extends ResearchClassificationBase { recordType: "TAXONOMY"; taxonomyType: TaxonomyType; }
export interface SpeciesResearchRecord extends ResearchClassificationBase { recordType: "SPECIES"; taxonomyDependencyIds: string[]; }
export interface CultureResearchRecord extends ResearchClassificationBase { recordType: "CULTURE"; }
export interface SpeciesGroupResearchRecord extends ResearchClassificationBase { recordType: "SPECIES_GROUP"; groupId: string; }
export interface BreedResearchRecord extends ResearchClassificationBase {
  recordType: "BREED";
  breedId: string;
  speciesId: string;
  cultureId: string | null;
  parentBreedId: string | null;
  populationKind: PopulationKind;
  groupId: string;
  personalityId?: string | null;
}
export type CanonicalResearchRecord = TaxonomyResearchRecord | SpeciesResearchRecord | CultureResearchRecord | SpeciesGroupResearchRecord | BreedResearchRecord;

export type TaxonomyType = "KINGDOM" | "PHYLUM" | "CLASS" | "ORDER" | "FAMILY" | "GENUS" | "SPECIES";
export type PopulationKind = "HUMAN" | "BEAST" | "MYTHOS" | "PET";
export type FindingSeverity = "INFO" | "WARNING" | "BLOCKER";
export type ImportDisposition =
  | "IMPORTED"
  | "IMPORTED_WITH_WARNINGS"
  | "DEFERRED_RELATIONSHIP"
  | "QUARANTINED_CANONICAL_CONFLICT"
  | "QUARANTINED_SCHEMA_ERROR"
  | "QUARANTINED_INVALID_ENUM"
  | "QUARANTINED_MISSING_DEPENDENCY"
  | "QUARANTINED_REVIEW_FAILURE";
export type IdempotencyStatus = "CREATED" | "UNCHANGED" | "UPDATED" | "RECOVERED_AND_IMPORTED";
export type OverallImportStatus = "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "COMPLETED_WITH_BLOCKERS";

export interface ReviewFindingPayload { severity?: unknown; code?: unknown; field?: unknown; message?: unknown; requiredFix?: unknown; }
export interface ReviewPayload { recordType?: unknown; recordId?: unknown; verdict?: unknown; findings?: ReviewFindingPayload[]; }

export interface SubmittedResearchRecord {
  ordinal: number;
  recordType: ResearchRecordType;
  recordId: string;
  sourceBatch: number;
  sourceArchive: string;
  sourceFilename: string;
  sourceSha256: string;
  rawPayload: Record<string, unknown>;
  reviewFilename: string | null;
  rawReviewPayload: ReviewPayload | null;
  reviewCandidates?: { filename: string; payload: ReviewPayload }[];
  evidenceFilename: string | null;
  rawEvidencePayload: Record<string, unknown> | null;
  sourcesFilename: string | null;
  rawSourcesPayload: Record<string, unknown> | null;
}

export interface ImportFinding {
  findingId: string;
  severity: FindingSeverity;
  code: string;
  recordType: ResearchRecordType | "CORPUS";
  recordId: string;
  recordName: string | null;
  field: string | null;
  submittedValue: unknown;
  canonicalValue: unknown;
  message: string;
  recommendedAction: string;
  primitiveInputs?: Partial<PrimitiveBehaviorScores>;
}

export interface ImportLedgerRow {
  importId: string;
  corpusVersion: string;
  ordinal: number;
  recordType: ResearchRecordType;
  recordId: string;
  recordName: string | null;
  sourceBatch: number;
  sourceArchive: string;
  sourceFilename: string;
  sourceSha256: string;
  rawPayload: Record<string, unknown>;
  reviewFilename: string | null;
  rawReviewPayload: ReviewPayload | null;
  evidenceFilename: string | null;
  rawEvidencePayload: Record<string, unknown> | null;
  sourcesFilename: string | null;
  rawSourcesPayload: Record<string, unknown> | null;
  reviewVerdict: "PASS" | "FAIL" | "MISSING_REVIEW" | "MULTIPLE_REVIEWS";
  importDisposition: ImportDisposition;
  canonicalMaterialized: boolean;
  canonicalPayload: Record<string, unknown> | null;
  issueCount: number;
  findingCodes: string[];
  idempotencyStatus: IdempotencyStatus;
  createdAt: string;
}

export interface ImportReconciliationRow {
  ordinal: number;
  recordType: ResearchRecordType;
  recordId: string;
  sourceBatch: number;
  sourceArchive: string;
  sourceFilename: string;
  sourceSha256: string;
  reviewVerdict: ImportLedgerRow["reviewVerdict"];
  importDisposition: ImportDisposition;
  canonicalMaterialized: boolean;
  idempotencyStatus: IdempotencyStatus;
  findingCodes: string[];
}

export interface CanonicalChangeAuditRow {
  recordType: ResearchRecordType;
  recordId: string;
  field: string;
  before: unknown;
  after: unknown;
  source: string;
  sourceFilename: string;
  sourceSha256: string;
}

export interface CorpusImportOptions {
  corpusVersion: string;
  sourcePackage: string;
  sourcePackageSha256: string;
  importedAt: string;
  applicationVersion: string;
  schemaVersion: string;
  expectedRecordCounts: Record<ResearchRecordType, number>;
  expectedOrdinalStart: number;
  expectedOrdinalEnd: number;
  externalDependencyIds: ReadonlySet<string>;
  personalityIds: ReadonlySet<string>;
  baselineCanonicalById: ReadonlyMap<string, Record<string, unknown>>;
  previousLedger?: readonly ImportLedgerRow[];
}

export interface CorpusImportResult {
  overallStatus: OverallImportStatus;
  ledger: ImportLedgerRow[];
  reconciliation: ImportReconciliationRow[];
  changeAudit: CanonicalChangeAuditRow[];
  findings: ImportFinding[];
  observedRecordCounts: Record<ResearchRecordType, number>;
  canonicalMaterialized: number;
  importedWithWarnings: number;
  deferredRelationships: number;
  quarantined: number;
  severityCounts: Record<FindingSeverity, number>;
  missingOrdinals: number[];
  duplicateOrdinals: number[];
  duplicateRecordIds: string[];
  duplicatePayloads: string[][];
}

const PRIMITIVE_FIELDS = ["aggression", "territorial", "parental", "social", "nesting", "intelligence"] as const;
type PrimitiveField = (typeof PRIMITIVE_FIELDS)[number];
const DERIVED_CONTRACT = {
  motivation: { inputs: ["aggression", "territorial", "social"], values: ["SELFISH", "RECIPROCAL", "ALTRUISTIC"] },
  operatingStyle: { inputs: ["territorial", "social", "parental"], values: ["SOLO", "SITUATIONAL", "TEAMWORK"] },
  structureOrientation: { inputs: ["aggression", "nesting", "intelligence"], values: ["CHAOS", "NEUTRAL", "ORDERED"] },
  administrationMode: { inputs: ["social", "nesting", "intelligence"], values: ["DISTRIBUTED", "DELEGATED", "CENTRALIZED"] },
  ownershipMode: { inputs: ["territorial", "parental", "intelligence"], values: ["SINGLE_ENTITY", "SHARED_TITLE", "COMMON_USE"] },
  allocationMode: { inputs: ["territorial", "nesting", "intelligence"], values: ["MARKET", "PLANNED", "CUSTOMARY"] },
  legitimacyBasis: { inputs: ["territorial", "parental", "nesting"], values: ["MARTIAL", "ANCESTRAL", "CHARTERED"] },
  authoritySource: { inputs: ["social", "parental", "nesting"], values: ["DIVINE_MANDATE", "APPOINTMENT", "ELECTION"] },
  loquacity: { inputs: ["aggression", "social", "parental"], values: ["TO_THE_POINT", "LIGHT_BANTER", "TALKATIVE"] },
  emotionalTemperature: { inputs: ["aggression", "territorial", "intelligence"], values: ["IRRITABLE", "COMPOSED", "JOYFUL"] },
  outlookOrientation: { inputs: ["aggression", "parental", "nesting"], values: ["PESSIMISTIC", "NEUTRAL", "OPTIMISTIC"] },
  collaborativePosture: { inputs: ["aggression", "social", "intelligence"], values: ["WITHHOLDING", "JUST_ENOUGH", "HELPFUL"] },
  aggressive: { inputs: ["aggression", "territorial", "nesting"], values: [Aggressive.DEFENSIVE, Aggressive.NEUTRAL, Aggressive.OFFENSIVE] },
  socialEffort: { inputs: ["aggression", "social", "nesting"], values: [SocialEffort.MILITARY, SocialEffort.INFRASTRUCTURE, SocialEffort.SOCIAL_PROGRAMS] },
  intellectualEffort: { inputs: ["social", "parental", "intelligence"], values: [IntellectualEffort.APPLICATION, IntellectualEffort.BALANCED, IntellectualEffort.THEORY] },
} as const satisfies Record<string, { inputs: readonly PrimitiveField[]; values: readonly [string, string, string] }>;
type DerivedField = keyof typeof DERIVED_CONTRACT;

const TERRAIN_BROAD = new Set(["BUILT_ENVIRONMENT", "COASTAL", "DESERT", "FOREST", "FRESHWATER", "GENERALIST", "GRASSLAND", "MOUNTAIN", "OCEAN", "POLAR_ICE", "SUBTERRANEAN", "WETLAND"]);
const TERRAIN_SPECIFIC = new Set(["ALPINE", "BOG", "BOREAL_FOREST", "BURROW", "CANOPY", "CANYON", "CASTLE", "CAVE", "CITY", "CLIFF", "CLOUD_FOREST", "COASTAL_CLIFF", "COLD_DESERT", "CORAL_REEF", "DELTA", "DUNES", "ESTUARY", "FARMLAND", "FJORD", "FLOODPLAIN", "FLOWERING_HABITAT", "FOREST_EDGE", "FOREST_FLOOR", "GENERALIST", "GLACIER", "HOT_DESERT", "ISLAND", "KARST", "KELP_FOREST", "LAKE", "MANGROVE", "MARSH", "MEADOW", "MINE", "MONTANE_FOREST", "MUDFLAT", "OASIS", "OLD_GROWTH_FOREST", "PACK_ICE", "PELAGIC", "PLATEAU", "POND", "PRAIRIE", "RAIN_FOREST", "RIVER", "ROAD", "RUINS", "SAVANNA", "SCRUBLAND", "SEAGRASS_BED", "SEA_CAVE", "SHADOW_FOREST", "SOIL", "STEPPE", "SWAMP", "TEMPLE", "TUNDRA", "TUNNEL", "UNDERGROUND_RIVER", "VILLAGE", "VOLCANIC", "WOODLAND", "WORKSHOP"]);
const FOOD_BROAD = new Set(["ANIMAL", "ARCANE_ESSENCE", "ELEMENTAL", "FUNGUS_DETRITUS", "MINERAL_MATERIAL", "NO_FEEDING", "PLANT"]);
const FOOD_SPECIFIC = new Set(["AIR_WIND", "ALGAE_SEAWEED", "ANGER", "AQUATIC_PLANTS", "ARTHROPODS", "BAMBOO", "BERRIES", "BIRDS", "BLOOD", "BONE_MARROW", "BREAD_PORRIDGE", "CARRION", "COLD_ICE", "DAIRY", "DESIRE", "DETRITUS_COMPOST", "DREAMS", "EGGS", "ELECTRICITY_STORM", "EMOTION", "ESSENCE_OF_FAITH", "FEAR", "FERMENTED_DRINK", "FIRE", "FISH", "FLOWERS_POLLEN", "FRUIT", "FUNGI", "GLASS_SAND", "GRASSES", "GRIEF", "HERBS_SPICES", "HONEY", "INSECTS", "LEAVES", "LIGHT", "MAGIC", "MEMORY", "METAL_ORE", "MIXED_DIET", "MOLLUSKS", "MOONLIGHT", "MUSIC_ATTENTION", "NECROMANTIC_ESSENCE", "NECTAR", "NO_FEEDING", "NUTS", "OATHS_HONOR", "OIL_FUEL", "PLANKTON_KRILL", "PREPARED_MEALS", "RED_MEAT", "REPTILES_AMPHIBIANS", "ROOTS_TUBERS", "SALT", "SAP_RESIN", "SEEDS_GRAINS", "SHELLFISH_CRUSTACEANS", "SIN", "SMALL_GAME", "STONE_CLAY", "WATER", "WOODY_BIOMASS", "WORMS_LARVAE"]);
const TAXONOMY_TYPES = new Set<TaxonomyType>(["KINGDOM", "PHYLUM", "CLASS", "ORDER", "FAMILY", "GENUS", "SPECIES"]);
const TAXONOMY_RANK = new Map([...TAXONOMY_TYPES].map((value, index) => [value, index]));
const POPULATION_KINDS = new Set<PopulationKind>(["HUMAN", "BEAST", "MYTHOS", "PET"]);

const ECONOMIC_FORMS: Record<string, string> = {
  "SINGLE_ENTITY|PLANNED": "COMMAND_DEMESNE", "COMMON_USE|PLANNED": "COMMUNE_PLAN", "COMMON_USE|CUSTOMARY": "FOLK_COMMONS",
  "SHARED_TITLE|CUSTOMARY": "GUILD_COMPACT", "SINGLE_ENTITY|MARKET": "MONOPOLY_ESTATE", "COMMON_USE|MARKET": "OPEN_BAZAAR",
  "SHARED_TITLE|MARKET": "SHAREHOLDER_BOURSE", "SHARED_TITLE|PLANNED": "SYNDICATE_CARTEL", "SINGLE_ENTITY|CUSTOMARY": "TRIBUTARY_DEMESNE",
};
const POLITICAL_FORMS: Record<string, string> = {
  "CENTRALIZED|MARTIAL|ELECTION": "ACCLAIMED_IMPERATOR", "CENTRALIZED|CHARTERED|APPOINTMENT": "APPOINTED_DIRECTORATE", "CENTRALIZED|CHARTERED|DIVINE_MANDATE": "COVENANT_CROWN",
  "CENTRALIZED|ANCESTRAL|DIVINE_MANDATE": "DIVINE_THRONE", "CENTRALIZED|CHARTERED|ELECTION": "ELECTED_EXECUTIVE", "CENTRALIZED|ANCESTRAL|ELECTION": "ELECTIVE_CROWN",
  "CENTRALIZED|MARTIAL|APPOINTMENT": "JUNTA", "CENTRALIZED|MARTIAL|DIVINE_MANDATE": "MILITANT_THEOCRACY", "CENTRALIZED|ANCESTRAL|APPOINTMENT": "REGENT_THRONE",
  "DELEGATED|CHARTERED|APPOINTMENT": "APPOINTED_COMMISSION", "DELEGATED|MARTIAL|ELECTION": "CAPTAINS_COUNCIL", "DELEGATED|CHARTERED|DIVINE_MANDATE": "CONSECRATED_REPUBLIC",
  "DELEGATED|ANCESTRAL|ELECTION": "ESTATES_DIET", "DELEGATED|ANCESTRAL|APPOINTMENT": "FEUDAL_ORDER", "DELEGATED|MARTIAL|APPOINTMENT": "GARRISON_COMMAND",
  "DELEGATED|MARTIAL|DIVINE_MANDATE": "MILITANT_ORDER", "DELEGATED|CHARTERED|ELECTION": "REPUBLIC", "DELEGATED|ANCESTRAL|DIVINE_MANDATE": "TEMPLE_HIERARCHY",
  "DISTRIBUTED|ANCESTRAL|ELECTION": "CHIEFTAIN_COUNCIL", "DISTRIBUTED|CHARTERED|DIVINE_MANDATE": "COVENANT_ASSEMBLY", "DISTRIBUTED|CHARTERED|APPOINTMENT": "DELEGATE_LEAGUE",
  "DISTRIBUTED|ANCESTRAL|APPOINTMENT": "ELDER_MOOT", "DISTRIBUTED|MARTIAL|ELECTION": "FREE_COMPANY", "DISTRIBUTED|ANCESTRAL|DIVINE_MANDATE": "HALLOWED_CUSTOM",
  "DISTRIBUTED|CHARTERED|ELECTION": "POPULAR_FEDERATION", "DISTRIBUTED|MARTIAL|APPOINTMENT": "RAIDER_CONFEDERACY", "DISTRIBUTED|MARTIAL|DIVINE_MANDATE": "ZEALOT_BANDS",
};
const FACTION_BY_FIELD: Record<string, Record<string, "CONCORD" | "SCHISM" | "RUIN">> = {
  administrationMode: { CENTRALIZED: "CONCORD", DISTRIBUTED: "SCHISM", DELEGATED: "RUIN" }, structureOrientation: { ORDERED: "CONCORD", NEUTRAL: "SCHISM", CHAOS: "RUIN" },
  operatingStyle: { TEAMWORK: "CONCORD", SITUATIONAL: "SCHISM", SOLO: "RUIN" }, motivation: { ALTRUISTIC: "CONCORD", RECIPROCAL: "SCHISM", SELFISH: "RUIN" },
  authoritySource: { APPOINTMENT: "CONCORD", ELECTION: "SCHISM", DIVINE_MANDATE: "RUIN" }, legitimacyBasis: { CHARTERED: "CONCORD", ANCESTRAL: "SCHISM", MARTIAL: "RUIN" },
  allocationMode: { PLANNED: "CONCORD", CUSTOMARY: "SCHISM", MARKET: "RUIN" }, ownershipMode: { SINGLE_ENTITY: "CONCORD", SHARED_TITLE: "SCHISM", COMMON_USE: "RUIN" },
  loquacity: { TALKATIVE: "CONCORD", LIGHT_BANTER: "SCHISM", TO_THE_POINT: "RUIN" }, emotionalTemperature: { COMPOSED: "CONCORD", JOYFUL: "SCHISM", IRRITABLE: "RUIN" },
  outlookOrientation: { OPTIMISTIC: "CONCORD", NEUTRAL: "SCHISM", PESSIMISTIC: "RUIN" }, collaborativePosture: { HELPFUL: "CONCORD", WITHHOLDING: "SCHISM", JUST_ENOUGH: "RUIN" },
};
const IDENTITY_FIELDS: Record<ResearchRecordType, readonly string[]> = {
  TAXONOMY: ["recordId", "name", "taxonomyType"], SPECIES: ["recordId", "name", "scientificName", "speciesKind", "originMode", "reproductiveMethod", "mortalityMode", "soulDisposition", "longevityClass", "juvenileStages", "nurseryMode", "continuityGroup", "continuityPropagationMode"],
  CULTURE: ["recordId", "name"], SPECIES_GROUP: ["recordId", "groupId", "name", "speciesKind"], BREED: ["recordId", "breedId", "name", "speciesId", "cultureId", "parentBreedId", "populationKind", "groupId"],
};
const AUDIT_FIELDS = ["text", "geographicOrigin", "presentation.accent", "presentation.appearance", "presentation.clothing", "presentation.architecture", "traits", "terrainBroad", "terrainSpecific", "foodBroad", "foodSpecific", ...PRIMITIVE_FIELDS.map((field) => `primitiveBehavior.${field}`), ...Object.keys(DERIVED_CONTRACT).map((field) => `derived.${field}`), "personalityId", "politicalForm", "economicForm", "factionScores", "faction", "factionTie"];

function clone<T>(value: T): T { return structuredClone(value); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function get(value: Record<string, unknown> | null | undefined, path: string): unknown { return path.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value); }
function set(value: Record<string, unknown>, path: string, next: unknown): void {
  const parts = path.split("."); let current = value;
  for (const part of parts.slice(0, -1)) { const child = current[part]; current = child && typeof child === "object" && !Array.isArray(child) ? child as Record<string, unknown> : (current[part] = {}) as Record<string, unknown>; }
  current[parts.at(-1)!] = next;
}
function stableHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function stringArray(value: unknown): string[] | null { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export interface DerivedCalculation { derived: Record<DerivedField, { mean: number; anchor: 0 | 2 | 4; value: string; tieBreakReason: string | null }>; politicalForm: string; economicForm: string; factionScores: Record<"CONCORD" | "SCHISM" | "RUIN", number>; faction: "CONCORD" | "SCHISM" | "RUIN" | null; factionTie: string[]; }

export function recomputeClassificationDerived(scores: PrimitiveBehaviorScores, submitted: unknown): { calculation: DerivedCalculation | null; errors: { field: string; message: string }[] } {
  const submittedDerived = isRecord(submitted) ? submitted : {};
  const errors: { field: string; message: string }[] = [];
  const derived = {} as DerivedCalculation["derived"];
  for (const [field, contract] of Object.entries(DERIVED_CONTRACT) as [DerivedField, (typeof DERIVED_CONTRACT)[DerivedField]][]) {
    const total = contract.inputs.reduce((sum, input) => sum + scores[input], 0);
    const mean = Number((total / 3).toFixed(6));
    let anchor: 0 | 2 | 4;
    let tieBreakReason: string | null = null;
    const submittedField = isRecord(submittedDerived[field]) ? submittedDerived[field] : {};
    if (total === 3 || total === 9) {
      const allowed = total === 3 ? [0, 2] : [2, 4];
      const submittedAnchor = submittedField.anchor;
      const reason = submittedField.tieBreakReason;
      if (!allowed.includes(submittedAnchor as number) || typeof reason !== "string" || !reason.trim()) {
        errors.push({ field: `derived.${field}`, message: `Mean ${mean} requires a reviewed adjacent anchor and non-empty tieBreakReason; code cannot perform semantic tie-breaking.` });
        continue;
      }
      anchor = submittedAnchor as 0 | 2 | 4;
      tieBreakReason = reason.trim();
    } else anchor = mean < 1 ? 0 : mean < 3 ? 2 : 4;
    derived[field] = { mean, anchor, value: contract.values[anchor / 2]!, tieBreakReason };
  }
  if (Object.keys(derived).length !== Object.keys(DERIVED_CONTRACT).length) return { calculation: null, errors };
  const economicForm = ECONOMIC_FORMS[`${derived.ownershipMode.value}|${derived.allocationMode.value}`];
  const politicalForm = POLITICAL_FORMS[`${derived.administrationMode.value}|${derived.legitimacyBasis.value}|${derived.authoritySource.value}`];
  if (!economicForm || !politicalForm) return { calculation: null, errors: [...errors, { field: "derived", message: "Derived political/economic lookup failed." }] };
  const factionScores = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const [field, map] of Object.entries(FACTION_BY_FIELD)) factionScores[map[derived[field as DerivedField].value]!] += 2;
  const high = Math.max(...Object.values(factionScores));
  const factionTie = Object.entries(factionScores).filter(([, score]) => score === high).map(([faction]) => faction);
  return { calculation: { derived, politicalForm, economicForm, factionScores, faction: factionTie.length === 1 ? factionTie[0] as "CONCORD" | "SCHISM" | "RUIN" : null, factionTie: factionTie.length === 1 ? [] : factionTie }, errors };
}

function dependencies(record: SubmittedResearchRecord): string[] {
  const raw = record.rawPayload;
  const result = new Set<string>();
  if (record.recordType === "TAXONOMY") for (const decision of Array.isArray(raw.parentInheritanceDecisions) ? raw.parentInheritanceDecisions : []) if (isRecord(decision) && typeof decision.parentRecordId === "string") result.add(decision.parentRecordId);
  if (record.recordType === "SPECIES") for (const id of stringArray(raw.taxonomyDependencyIds) ?? []) result.add(id);
  if (record.recordType === "BREED") {
    for (const field of ["speciesId", "cultureId", "parentBreedId", "groupId"] as const) if (typeof raw[field] === "string" && raw[field]) result.add(raw[field] as string);
    for (const id of stringArray(raw.dependencyRecordIds) ?? []) result.add(id);
  }
  return [...result];
}

function taxonomyCycles(records: readonly SubmittedResearchRecord[]): Set<string> {
  const taxonomy = new Set(records.filter((record) => record.recordType === "TAXONOMY").map((record) => record.recordId));
  const edges = new Map(records.filter((record) => record.recordType === "TAXONOMY").map((record) => [record.recordId, dependencies(record).filter((id) => taxonomy.has(id))]));
  const cyclic = new Set<string>(); const visiting = new Set<string>(); const visited = new Set<string>(); const stack: string[] = [];
  const walk = (id: string): void => { if (visiting.has(id)) { const start = stack.indexOf(id); for (const member of stack.slice(start)) cyclic.add(member); return; } if (visited.has(id)) return; visiting.add(id); stack.push(id); for (const parent of edges.get(id) ?? []) walk(parent); stack.pop(); visiting.delete(id); visited.add(id); };
  for (const id of taxonomy) walk(id);
  return cyclic;
}

export function importSubmittedResearchCorpus(submittedRecords: readonly SubmittedResearchRecord[], options: CorpusImportOptions): CorpusImportResult {
  const records = [...submittedRecords].sort((left, right) => left.ordinal - right.ordinal || left.sourceFilename.localeCompare(right.sourceFilename));
  const findings: ImportFinding[] = []; let findingSequence = 0;
  const add = (record: SubmittedResearchRecord | null, severity: FindingSeverity, code: string, field: string | null, submittedValue: unknown, canonicalValue: unknown, message: string, recommendedAction: string, primitiveInputs?: Partial<PrimitiveBehaviorScores>): void => {
    findings.push({ findingId: `FND_${String(++findingSequence).padStart(6, "0")}`, severity, code, recordType: record?.recordType ?? "CORPUS", recordId: record?.recordId ?? "CORPUS", recordName: typeof record?.rawPayload.name === "string" ? record.rawPayload.name : null, field, submittedValue, canonicalValue, message, recommendedAction, ...(primitiveInputs ? { primitiveInputs } : {}) });
  };
  const counts = Object.fromEntries(RESEARCH_RECORD_TYPES.map((type) => [type, records.filter((record) => record.recordType === type).length])) as Record<ResearchRecordType, number>;
  for (const type of RESEARCH_RECORD_TYPES) if (counts[type] !== options.expectedRecordCounts[type]) add(null, "BLOCKER", "RECORD_COUNT_MISMATCH", type, counts[type], options.expectedRecordCounts[type], `Observed ${counts[type]} ${type} records; expected ${options.expectedRecordCounts[type]}.`, "Reconcile the package manifest and missing/extra semantic files; do not discard observed records.");

  const ordinals = new Map<number, SubmittedResearchRecord[]>(); const ids = new Map<string, SubmittedResearchRecord[]>(); const payloads = new Map<string, SubmittedResearchRecord[]>();
  for (const record of records) { ordinals.set(record.ordinal, [...(ordinals.get(record.ordinal) ?? []), record]); ids.set(record.recordId, [...(ids.get(record.recordId) ?? []), record]); payloads.set(record.sourceSha256, [...(payloads.get(record.sourceSha256) ?? []), record]); }
  const missingOrdinals: number[] = []; for (let ordinal = options.expectedOrdinalStart; ordinal <= options.expectedOrdinalEnd; ordinal++) if (!ordinals.has(ordinal)) missingOrdinals.push(ordinal);
  const duplicateOrdinals = [...ordinals].filter(([, candidates]) => candidates.length > 1).map(([ordinal]) => ordinal).sort((a, b) => a - b);
  const duplicateRecordIds = [...ids].filter(([, candidates]) => candidates.length > 1).map(([id]) => id).sort();
  const duplicatePayloads = [...payloads].filter(([, candidates]) => candidates.length > 1).map(([, candidates]) => candidates.map((record) => record.sourceFilename).sort());
  for (const ordinal of missingOrdinals) add(null, "BLOCKER", "MISSING_ORDINAL", "ordinal", ordinal, null, `No semantic record was supplied for ordinal ${ordinal}.`, "Supply the missing final semantic output in a corrected corpus.");
  for (const ordinal of duplicateOrdinals) add(null, "BLOCKER", "DUPLICATE_ORDINAL", "ordinal", ordinal, null, `Multiple semantic records claim ordinal ${ordinal}.`, "Establish deterministic final provenance or retain all candidates and remediate the ambiguity.");
  for (const id of duplicateRecordIds) add(null, "BLOCKER", "DUPLICATE_RECORD_ID", "recordId", id, null, `Multiple semantic records claim record ID ${id}.`, "Establish deterministic final provenance or quarantine all ambiguous canonical candidates.");
  for (const filenames of duplicatePayloads) add(null, "WARNING", "DUPLICATE_PAYLOAD", "sourceSha256", filenames, null, `Identical semantic payload bytes occur in ${filenames.join(", ")}.`, "Confirm whether the duplicate payloads are intended; both submitted records remain preserved.");

  const knownIds = new Set([...records.map((record) => record.recordId), ...options.externalDependencyIds]);
  const recordById = new Map(records.map((record) => [record.recordId, record]));
  const reviewById = new Map(records.map((record) => [record.recordId, record.rawReviewPayload?.verdict]));
  const cycles = taxonomyCycles(records);
  const previousBySource = new Map((options.previousLedger ?? []).map((row) => [row.sourceFilename, row]));
  const ledger: ImportLedgerRow[] = []; const changeAudit: CanonicalChangeAuditRow[] = [];

  for (const record of records) {
    const startFinding = findings.length;
    const raw = record.rawPayload; const canonical = clone(raw);
    let fatalSchema = false; let fatalEnum = false; let duplicateConflict = duplicateRecordIds.includes(record.recordId) || duplicateOrdinals.includes(record.ordinal);
    let missingRelationship = false;
    const reviewCandidates = record.reviewCandidates ?? (record.rawReviewPayload && record.reviewFilename ? [{ filename: record.reviewFilename, payload: record.rawReviewPayload }] : []);
    let reviewVerdict: ImportLedgerRow["reviewVerdict"];
    if (reviewCandidates.length === 0) reviewVerdict = "MISSING_REVIEW";
    else if (reviewCandidates.length > 1) reviewVerdict = "MULTIPLE_REVIEWS";
    else reviewVerdict = reviewCandidates[0]!.payload.verdict === "PASS" ? "PASS" : "FAIL";
    if (reviewVerdict === "MISSING_REVIEW") add(record, "BLOCKER", "MISSING_REVIEW", null, null, null, "The semantic record has no individual review file.", "Provide the missing review; the raw record remains quarantined.");
    if (reviewVerdict === "MULTIPLE_REVIEWS") add(record, "BLOCKER", "MULTIPLE_REVIEWS", null, reviewCandidates.map((candidate) => candidate.filename), null, "Multiple reviews lack deterministic final precedence.", "Establish final review provenance before canonical materialization.");
    if (reviewVerdict === "FAIL") add(record, "BLOCKER", "FAILED_REVIEW", null, "FAIL", null, "The individual record review did not pass.", "Apply the exact review remediation and submit a corrected reviewed record.");
    for (const reviewFinding of record.rawReviewPayload?.findings ?? []) {
      const severity = reviewFinding.severity === "BLOCKER" ? "BLOCKER" : reviewFinding.severity === "INFO" ? "INFO" : "WARNING";
      add(record, severity, typeof reviewFinding.code === "string" ? reviewFinding.code : "REVIEW_FINDING", typeof reviewFinding.field === "string" ? reviewFinding.field : null, null, null, typeof reviewFinding.message === "string" ? reviewFinding.message : "Review finding preserved without a message.", typeof reviewFinding.requiredFix === "string" ? reviewFinding.requiredFix : "Review the submitted finding.");
    }

    if (raw.recordType !== record.recordType || raw.recordId !== record.recordId || typeof raw.name !== "string" || !raw.name.trim()) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", "identity", { recordType: raw.recordType, recordId: raw.recordId, name: raw.name }, null, "Semantic identity fields are missing or disagree with the source filename.", "Correct the record schema without changing unrelated records."); }
    const text = raw.text;
    const paragraphs = typeof text === "string" ? text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length : 0;
    if (typeof text !== "string" || !text.trim() || paragraphs < 2 || paragraphs > 3 || text.includes("\uFFFD") || /\b(?:TODO|PLACEHOLDER)\b/i.test(text)) { fatalSchema = true; add(record, "BLOCKER", "MALFORMED_WIKI_TEXT", "text", text, null, "Wiki text must be a substantive, correctly encoded 2–3 paragraph string.", "Repair only the reviewed wiki text and resubmit the record."); }
    if (!isRecord(raw.presentation) || !Array.isArray(raw.traits) || raw.traits.length === 0) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", "presentation/traits", { presentation: raw.presentation, traits: raw.traits }, null, "Required presentation or trait structures are malformed or empty.", "Repair the required semantic structure and resubmit."); }

    const primitive = raw.primitiveBehavior;
    const scores = {} as PrimitiveBehaviorScores;
    if (!isRecord(primitive)) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", "primitiveBehavior", primitive, null, "primitiveBehavior must contain all six scores.", "Provide six reviewed scores from 0 through 4."); }
    else for (const field of PRIMITIVE_FIELDS) {
      const entry = primitive[field]; const score = isRecord(entry) ? entry.score : undefined;
      if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > 4) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", `primitiveBehavior.${field}.score`, score, null, "Primitive behavior score must be an integer from 0 through 4.", "Correct the reviewed score; do not coerce it during import."); }
      else scores[field] = score as BehaviorScore;
    }

    const controlledArrays: [string, ReadonlySet<string>][] = [["terrainBroad", TERRAIN_BROAD], ["terrainSpecific", TERRAIN_SPECIFIC], ["foodBroad", FOOD_BROAD], ["foodSpecific", FOOD_SPECIFIC]];
    for (const [field, allowed] of controlledArrays) {
      const values = stringArray(raw[field]);
      if (!values) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", field, raw[field], null, `${field} must be an array of controlled enum strings.`, "Repair the malformed field without inventing values."); continue; }
      const valid = values.filter((value) => allowed.has(value));
      for (const invalid of values.filter((value) => !allowed.has(value))) add(record, "BLOCKER", "INVALID_ENUM", field, invalid, null, `Invalid controlled ${field} value ${invalid} was preserved raw and omitted from canonical materialization.`, "Replace it only through reviewed semantic remediation; do not coerce it.");
      canonical[field] = valid;
    }
    if (record.recordType === "TAXONOMY" && !TAXONOMY_TYPES.has(raw.taxonomyType as TaxonomyType)) { fatalEnum = true; add(record, "BLOCKER", "INVALID_ENUM", "taxonomyType", raw.taxonomyType, null, "Invalid Taxonomy rank prevents safe canonical identity materialization.", "Submit a reviewed controlled Taxonomy rank."); }
    if (record.recordType === "BREED") {
      if (raw.breedId !== record.recordId || typeof raw.speciesId !== "string" || typeof raw.groupId !== "string") { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", "breed identity", { breedId: raw.breedId, speciesId: raw.speciesId, groupId: raw.groupId }, null, "Breed identity/relationship fields are malformed.", "Correct the reviewed Breed contract; preserve the raw record until then."); }
      if (!POPULATION_KINDS.has(raw.populationKind as PopulationKind)) { fatalEnum = true; add(record, "BLOCKER", "INVALID_ENUM", "populationKind", raw.populationKind, null, "Invalid populationKind prevents safe canonical identity materialization.", "Submit a reviewed controlled population kind."); }
    }
    if (record.recordType === "SPECIES_GROUP" && raw.groupId !== record.recordId) { fatalSchema = true; add(record, "BLOCKER", "SCHEMA_ERROR", "groupId", raw.groupId, record.recordId, "Species Group groupId must equal its canonical record ID.", "Correct the reviewed group identity."); }

    if (!fatalSchema && Object.keys(scores).length === PRIMITIVE_FIELDS.length) {
      const recomputed = recomputeClassificationDerived(scores, raw.derived);
      for (const error of recomputed.errors) add(record, "BLOCKER", "DERIVED_TIE_BREAK_INVALID", error.field, get(raw, error.field), null, error.message, "Provide the reviewed adjacent anchor and semantic tie-break reason; code must not choose it.", scores);
      if (recomputed.calculation) {
        for (const field of Object.keys(DERIVED_CONTRACT) as DerivedField[]) for (const leaf of ["mean", "anchor", "value", "tieBreakReason"] as const) {
          const submittedValue = get(raw, `derived.${field}.${leaf}`); const canonicalValue = recomputed.calculation.derived[field][leaf];
          if (!same(submittedValue, canonicalValue)) add(record, "WARNING", "DERIVED_VALUE_MISMATCH", `derived.${field}.${leaf}`, submittedValue, canonicalValue, "Submitted derived value disagrees with deterministic recomputation from the six primitive scores.", "Keep primitive scores; use the recomputed canonical derived value and remediate the submitted projection if needed.", scores);
        }
        for (const field of ["politicalForm", "economicForm", "factionScores", "faction", "factionTie"] as const) {
          const canonicalValue = recomputed.calculation[field]; if (!same(raw[field], canonicalValue)) add(record, "WARNING", "DERIVED_VALUE_MISMATCH", field, raw[field], canonicalValue, "Submitted projection disagrees with deterministic recomputation.", "Keep primitive scores and canonicalize the deterministic projection.", scores);
        }
        Object.assign(canonical, recomputed.calculation);
      }
    }

    const embeddedEvidence = raw.evidence; const standaloneEvidence = record.rawEvidencePayload?.evidence;
    if (record.rawEvidencePayload === null) add(record, "BLOCKER", "MISSING_EVIDENCE_FILE", "evidence", null, embeddedEvidence, "The standalone evidence artifact is missing.", "Supply the matching evidence file; embedded evidence remains preserved raw.");
    else if (!same(embeddedEvidence, standaloneEvidence)) add(record, "BLOCKER", "EVIDENCE_ARTIFACT_MISMATCH", "evidence", standaloneEvidence, embeddedEvidence, "Standalone and embedded evidence payloads disagree.", "Reconcile provenance without discarding either submitted payload.");
    const embeddedSources = raw.sources; const standaloneSources = record.rawSourcesPayload?.sources;
    if (record.rawSourcesPayload === null) add(record, "BLOCKER", "MISSING_SOURCE_FILE", "sources", null, embeddedSources, "The standalone source artifact is missing.", "Supply the matching source file; embedded sources remain preserved raw.");
    else if (!same(embeddedSources, standaloneSources)) add(record, "BLOCKER", "SOURCE_ARTIFACT_MISMATCH", "sources", standaloneSources, embeddedSources, "Standalone and embedded source payloads disagree.", "Reconcile provenance without discarding either submitted payload.");

    const defaults = [...new Set([...(Array.isArray(raw.defaultedFields) ? raw.defaultedFields.flatMap((entry) => isRecord(entry) && typeof entry.field === "string" ? [entry.field] : []) : []), ...(isRecord(primitive) ? PRIMITIVE_FIELDS.filter((field) => isRecord(primitive[field]) && primitive[field].defaulted === true).map((field) => `primitiveBehavior.${field}`) : [])])];
    if (defaults.length) add(record, "INFO", "DEFAULT_VALUES_EXPLICIT", "defaultedFields", defaults, defaults, "Explicit reviewed defaults are preserved with their provenance.", "No action unless owner review chooses to replace a default with new evidence.");

    for (const dependency of dependencies(record)) {
      if (!knownIds.has(dependency)) { missingRelationship = true; add(record, "BLOCKER", "MISSING_DEPENDENCY", "relationship", dependency, null, `Required relationship target ${dependency} is not supplied or present in the canonical dependency registry.`, "Supply the exact dependency; do not invent a replacement ID."); }
      else if (reviewById.get(dependency) === "FAIL") { missingRelationship = true; add(record, "BLOCKER", "DEPENDENCY_REVIEW_FAILURE", "relationship", dependency, null, `Relationship target ${dependency} has a FAIL review.`, "Remediate and re-review the dependency before inheriting its semantics."); }
    }
    if (record.recordType === "TAXONOMY") {
      if (cycles.has(record.recordId)) { missingRelationship = true; add(record, "BLOCKER", "TAXONOMY_PARENT_CYCLE", "parentInheritanceDecisions", dependencies(record), null, "Taxonomy dependency graph contains a cycle involving this record.", "Correct the explicit parent chain; do not auto-select a replacement parent."); }
      const childRank = TAXONOMY_RANK.get(raw.taxonomyType as TaxonomyType);
      for (const parentId of dependencies(record)) { const parent = recordById.get(parentId); if (parent?.recordType !== "TAXONOMY") continue; const parentRank = TAXONOMY_RANK.get(parent.rawPayload.taxonomyType as TaxonomyType); if (childRank !== undefined && parentRank !== undefined && parentRank >= childRank) { missingRelationship = true; add(record, "BLOCKER", "TAXONOMY_PARENT_RANK_CONFLICT", "parentInheritanceDecisions", { parentId, parentRank: parent.rawPayload.taxonomyType }, raw.taxonomyType, "Explicit Taxonomy parent is not a broader rank than the child.", "Review the exact owner-canonical parent chain without biologically renaming the node."); } }
    }

    const baseline = options.baselineCanonicalById.get(record.recordId);
    if (baseline) for (const field of IDENTITY_FIELDS[record.recordType]) {
      const current = get(baseline, field); const proposed = get(raw, field);
      if (current !== undefined && !same(current, proposed)) { add(record, "BLOCKER", "CANONICAL_IDENTITY_CONFLICT", field, proposed, current, `Submitted research conflicts with existing canonical identity field ${field}; current identity was preserved.`, "Obtain explicit owner approval for an identity correction before changing this field."); set(canonical, field, clone(current)); }
    }
    if (record.recordType === "BREED") {
      const submittedPersonality = raw.personalityId;
      const currentPersonality = get(baseline, "personalityId");
      if (raw.populationKind === "PET" && (submittedPersonality === null || submittedPersonality === undefined || submittedPersonality === "")) set(canonical, "personalityId", null);
      else if (typeof submittedPersonality !== "string" || !submittedPersonality) { add(record, "BLOCKER", "MISSING_REQUIRED_FIELD", "personalityId", submittedPersonality, currentPersonality ?? null, "Civic Breed response omits the requested personalityId; existing canonical value is preserved when available.", "Supply an individually reviewed Personality Expression ID; do not infer one during import."); set(canonical, "personalityId", currentPersonality ?? null); }
      else if (!options.personalityIds.has(submittedPersonality)) { add(record, "BLOCKER", "INVALID_PERSONALITY_ID", "personalityId", submittedPersonality, currentPersonality ?? null, "Submitted Personality Expression ID is absent from the controlled registry.", "Correct the reviewed ID or add an owner-approved registry entry; do not substitute a near match."); set(canonical, "personalityId", currentPersonality ?? null); }
    }

    const recordFindings = findings.slice(startFinding);
    const reviewQuarantine = reviewVerdict !== "PASS";
    const canonicalMaterialized = !(reviewQuarantine || fatalSchema || fatalEnum || duplicateConflict);
    let importDisposition: ImportDisposition;
    if (reviewQuarantine) importDisposition = "QUARANTINED_REVIEW_FAILURE";
    else if (duplicateConflict) importDisposition = "QUARANTINED_CANONICAL_CONFLICT";
    else if (fatalSchema) importDisposition = "QUARANTINED_SCHEMA_ERROR";
    else if (fatalEnum) importDisposition = "QUARANTINED_INVALID_ENUM";
    else if (missingRelationship) importDisposition = "DEFERRED_RELATIONSHIP";
    else if (recordFindings.some((finding) => finding.severity !== "INFO")) importDisposition = "IMPORTED_WITH_WARNINGS";
    else importDisposition = "IMPORTED";
    const canonicalPayload = canonicalMaterialized ? canonical : null;
    const previous = previousBySource.get(record.sourceFilename);
    const idempotencyStatus: IdempotencyStatus = !previous ? "CREATED" : !previous.canonicalMaterialized && canonicalMaterialized ? "RECOVERED_AND_IMPORTED" : previous.sourceSha256 === record.sourceSha256 && previous.importDisposition === importDisposition && same(previous.canonicalPayload, canonicalPayload) ? "UNCHANGED" : "UPDATED";
    const row: ImportLedgerRow = {
      importId: `${options.corpusVersion}:${String(record.ordinal).padStart(4, "0")}:${stableHash(record.sourceFilename).slice(0, 12)}`, corpusVersion: options.corpusVersion,
      ordinal: record.ordinal, recordType: record.recordType, recordId: record.recordId, recordName: typeof raw.name === "string" ? raw.name : null,
      sourceBatch: record.sourceBatch, sourceArchive: record.sourceArchive, sourceFilename: record.sourceFilename, sourceSha256: record.sourceSha256, rawPayload: clone(raw),
      reviewFilename: record.reviewFilename, rawReviewPayload: clone(record.rawReviewPayload), evidenceFilename: record.evidenceFilename, rawEvidencePayload: clone(record.rawEvidencePayload), sourcesFilename: record.sourcesFilename, rawSourcesPayload: clone(record.rawSourcesPayload),
      reviewVerdict, importDisposition, canonicalMaterialized, canonicalPayload, issueCount: recordFindings.length, findingCodes: [...new Set(recordFindings.map((finding) => finding.code))].sort(), idempotencyStatus, createdAt: previous?.createdAt ?? options.importedAt,
    };
    ledger.push(row);

    if (canonicalPayload && idempotencyStatus !== "UNCHANGED") {
      const before = previous?.canonicalPayload ?? baseline ?? null;
      for (const field of AUDIT_FIELDS) { const oldValue = get(before, field); const newValue = get(canonicalPayload, field); if (!same(oldValue, newValue)) changeAudit.push({ recordType: record.recordType, recordId: record.recordId, field, before: oldValue ?? null, after: newValue ?? null, source: record.sourceArchive, sourceFilename: record.sourceFilename, sourceSha256: record.sourceSha256 }); }
    }
  }

  const reconciliation = ledger.map((row): ImportReconciliationRow => ({ ordinal: row.ordinal, recordType: row.recordType, recordId: row.recordId, sourceBatch: row.sourceBatch, sourceArchive: row.sourceArchive, sourceFilename: row.sourceFilename, sourceSha256: row.sourceSha256, reviewVerdict: row.reviewVerdict, importDisposition: row.importDisposition, canonicalMaterialized: row.canonicalMaterialized, idempotencyStatus: row.idempotencyStatus, findingCodes: row.findingCodes }));
  const severityCounts = { INFO: findings.filter((finding) => finding.severity === "INFO").length, WARNING: findings.filter((finding) => finding.severity === "WARNING").length, BLOCKER: findings.filter((finding) => finding.severity === "BLOCKER").length };
  const overallStatus: OverallImportStatus = severityCounts.BLOCKER > 0 ? "COMPLETED_WITH_BLOCKERS" : severityCounts.WARNING > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
  const quarantined = ledger.filter((row) => row.importDisposition.startsWith("QUARANTINED")).length;
  return { overallStatus, ledger, reconciliation, changeAudit, findings, observedRecordCounts: counts, canonicalMaterialized: ledger.filter((row) => row.canonicalMaterialized).length, importedWithWarnings: ledger.filter((row) => row.importDisposition === "IMPORTED_WITH_WARNINGS").length, deferredRelationships: ledger.filter((row) => row.importDisposition === "DEFERRED_RELATIONSHIP").length, quarantined, severityCounts, missingOrdinals, duplicateOrdinals, duplicateRecordIds, duplicatePayloads };
}
