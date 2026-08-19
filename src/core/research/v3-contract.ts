export const ECOLOGY_FIELDS = ["foodBroad", "foodSpecific", "terrainBroad", "terrainSpecific"] as const;
export const DIMENSION_FIELDS = ["motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture"] as const;
export const RESEARCH_FIELDS = ["traits", ...ECOLOGY_FIELDS, "personalityId", ...DIMENSION_FIELDS] as const;
export type ResearchField = typeof RESEARCH_FIELDS[number];
export type TerminalDisposition = "VERIFIED_VALUE" | "RESOLVED_NULL" | "POLICY_DEFAULT" | "POLICY_NULL" | "INHERITED_VERIFIED_VALUE";
export type ResearchDisposition = TerminalDisposition | "UNRESOLVED" | "REVIEW_REQUIRED";

export interface ResearchTask {
  taskId: string;
  breedId: string;
  name: string;
  populationKind: "HUMAN" | "BEAST" | "MYTHOS" | "PET";
  field: ResearchField;
  candidateValue: unknown;
  disposition: ResearchDisposition;
  policyReason: string | null;
}

interface StartingBreed {
  breedId: string;
  name: string;
  populationKind: ResearchTask["populationKind"];
  traits?: unknown;
  personalityId?: unknown;
}

export interface V3FieldResult {
  value: unknown;
  disposition: ResearchDisposition;
  evidenceRefs: string[];
  researchQuestion?: string;
  queriesAttempted?: string[];
  sourcesOpened?: string[];
  factsFound?: string[];
  nullRationale?: string;
}

export interface V3ResearchRow {
  breedId: string;
  populationKind: ResearchTask["populationKind"];
  fields: Partial<Record<ResearchField, V3FieldResult>>;
}

const terminal = new Set<TerminalDisposition>(["VERIFIED_VALUE", "RESOLVED_NULL", "POLICY_DEFAULT", "POLICY_NULL", "INHERITED_VERIFIED_VALUE"]);

export function buildV3ResearchQueue(breeds: readonly StartingBreed[]): ResearchTask[] {
  const seen = new Set<string>();
  const queue: ResearchTask[] = [];
  for (const breed of [...breeds].sort((a, b) => a.breedId.localeCompare(b.breedId))) {
    if (seen.has(breed.breedId)) throw new Error(`Duplicate Breed ${breed.breedId}`);
    seen.add(breed.breedId);
    for (const field of RESEARCH_FIELDS) {
      const policyNull = breed.populationKind === "PET" && (field === "personalityId" || DIMENSION_FIELDS.includes(field as typeof DIMENSION_FIELDS[number]));
      queue.push({
        taskId: `RSRCH_${breed.breedId}_${field}`,
        breedId: breed.breedId,
        name: breed.name,
        populationKind: breed.populationKind,
        field,
        candidateValue: field === "traits" ? breed.traits ?? null : field === "personalityId" ? breed.personalityId ?? null : null,
        disposition: policyNull ? "POLICY_NULL" : "UNRESOLVED",
        policyReason: policyNull ? "PET sapient personality/dimensions are inapplicable under owner policy" : null,
      });
    }
  }
  return queue;
}

export function validateV3ResearchRow(row: V3ResearchRow): void {
  for (const [field, result] of Object.entries(row.fields) as [ResearchField, V3FieldResult][]) {
    if (!terminal.has(result.disposition as TerminalDisposition)) throw new Error(`${row.breedId}.${field} is not terminal`);
    if (["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE"].includes(result.disposition) && result.evidenceRefs.length === 0) throw new Error(`${row.breedId}.${field} has no evidence`);
    if (result.disposition === "RESOLVED_NULL") {
      if (!result.researchQuestion || !result.queriesAttempted?.length || !result.sourcesOpened?.length || !result.factsFound?.length || !result.nullRationale) throw new Error(`${row.breedId}.${field} has incomplete resolved-null research`);
    }
    if (result.disposition === "POLICY_NULL" && result.value !== null) throw new Error(`${row.breedId}.${field} policy null must have null value`);
  }
}
