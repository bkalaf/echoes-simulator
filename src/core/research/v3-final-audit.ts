import { RESEARCH_FIELDS } from "./v3-contract.js";
import type { GenericRow } from "../inputs/importer.js";

const TERMINAL = new Set(["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE", "POLICY_DEFAULT", "POLICY_NULL", "RESOLVED_NULL"]);
const TERMINAL_NULL = new Set(["POLICY_NULL", "RESOLVED_NULL"]);
const PROHIBITED_GENERIC_TRAIT = /^(?:is kept|is raised|was developed|exists as)|source-defined/i;

export interface V3AssessmentInput {
  breeds: GenericRow[];
  evidence: GenericRow[];
  citations: GenericRow[];
  sources: GenericRow[];
}

export interface V3AssessmentOptions {
  expectedBreedCount?: number;
  enforceMandatoryRegressions?: boolean;
}

export interface V3FinalAssessment {
  verdict: "ACCEPT_FINAL" | "REJECT";
  safeToImport: boolean;
  researchCompletionClaimSupported: boolean;
  structuralIntegrityPassed: boolean;
  semanticEvidenceIntegrityPassed: boolean;
  counts: {
    breeds: number;
    fieldTasks: number;
    terminal: number;
    unresolved: number;
    reviewRequired: number;
    evidence: number;
    citations: number;
    sources: number;
  };
  findings: { code: string; message: string; breedId?: string; field?: string }[];
  mandatoryRegressions: { caseId: string; status: "PASS" | "FAIL"; detail: string }[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : value === null || value === undefined ? [] : [String(value)];
}

function fieldEvidenceKey(breedId: string, field: string): string {
  return `${breedId}\u0000${field}`;
}

export function assessV3Research(input: V3AssessmentInput, options: V3AssessmentOptions = {}): V3FinalAssessment {
  const expectedBreedCount = options.expectedBreedCount ?? 2056;
  const enforceMandatoryRegressions = options.enforceMandatoryRegressions ?? true;
  const findings: V3FinalAssessment["findings"] = [];
  const breedIds = new Set<string>();
  const sourceIds = new Set(input.sources.map((row) => String(row.sourceId)));
  const citationsById = new Map(input.citations.map((row) => [String(row.citationId), row]));
  const evidenceByField = new Map<string, GenericRow[]>();
  let terminal = 0;
  let unresolved = 0;
  let reviewRequired = 0;

  for (const evidence of input.evidence) {
    const key = fieldEvidenceKey(String(evidence.exactTargetEntity), String(evidence.targetField));
    evidenceByField.set(key, [...(evidenceByField.get(key) ?? []), evidence]);
  }

  if (input.breeds.length !== expectedBreedCount) findings.push({ code: "BREED_COUNT", message: `Expected ${expectedBreedCount} Breed rows, found ${input.breeds.length}` });
  for (const breed of input.breeds) {
    const breedId = String(breed.breedId);
    if (breedIds.has(breedId)) findings.push({ code: "DUPLICATE_BREED", message: "Duplicate Breed ID", breedId });
    breedIds.add(breedId);
    const dispositions = (breed.fieldDispositions ?? {}) as Record<string, unknown>;
    for (const field of RESEARCH_FIELDS) {
      const disposition = String(dispositions[field] ?? "UNRESOLVED");
      if (disposition === "REVIEW_REQUIRED") reviewRequired += 1;
      if (!TERMINAL.has(disposition)) {
        unresolved += 1;
        findings.push({ code: "NONTERMINAL_FIELD", message: `Disposition ${disposition} is not terminal`, breedId, field });
        continue;
      }
      terminal += 1;
      const value = breed[field];
      if (TERMINAL_NULL.has(disposition) && value !== null) findings.push({ code: "TERMINAL_NULL_HAS_VALUE", message: `${disposition} must store null`, breedId, field });
      if (!TERMINAL_NULL.has(disposition) && (value === null || value === undefined || (Array.isArray(value) && value.length === 0))) findings.push({ code: "RESOLVED_FIELD_EMPTY", message: `${disposition} requires a value`, breedId, field });
      const evidenceRows = evidenceByField.get(fieldEvidenceKey(breedId, field)) ?? [];
      if (!evidenceRows.length) {
        findings.push({ code: "MISSING_FIELD_EVIDENCE", message: "No exact field evidence row", breedId, field });
        continue;
      }
      for (const evidence of evidenceRows) {
        const citationRefs = strings(evidence.citationRefs);
        if (!citationRefs.length) findings.push({ code: "MISSING_CITATION_REF", message: "Evidence has no citation", breedId, field });
        if (disposition === "RESOLVED_NULL") {
          for (const required of ["researchQuestion", "queriesAttempted", "sourcesOpened", "factsFound", "nullRationale"] as const) {
            const candidate = evidence[required];
            if (candidate === null || candidate === undefined || candidate === "" || (Array.isArray(candidate) && candidate.length === 0)) findings.push({ code: "INCOMPLETE_RESOLVED_NULL", message: `Resolved-null evidence lacks ${required}`, breedId, field });
          }
        }
        for (const citationId of citationRefs) {
          const citation = citationsById.get(citationId);
          if (!citation) {
            findings.push({ code: "BROKEN_CITATION_REF", message: `Missing citation ${citationId}`, breedId, field });
            continue;
          }
          if (String(citation.exactTargetEntity) !== breedId || String(citation.targetField) !== field) findings.push({ code: "CITATION_TARGET_MISMATCH", message: `Citation ${citationId} target mismatch`, breedId, field });
          if (!String(citation.locator ?? "").trim() || !String(citation.boundedContext ?? "").trim() || !String(citation.sourceFactParaphrase ?? "").trim()) findings.push({ code: "UNBOUNDED_CITATION", message: `Citation ${citationId} lacks locator, bounded context, or paraphrase`, breedId, field });
          if (!sourceIds.has(String(citation.sourceId))) findings.push({ code: "BROKEN_SOURCE_REF", message: `Citation ${citationId} has no source`, breedId, field });
        }
      }
    }
  }

  for (const source of input.sources) {
    if (!String(source.canonicalUrlOrIdentifier ?? "").trim() || !String(source.title ?? "").trim() || !String(source.publisherOrHost ?? "").trim()) findings.push({ code: "INCOMPLETE_SOURCE", message: `Source ${String(source.sourceId)} lacks URL/identifier, title, or publisher` });
  }

  const byId = new Map(input.breeds.map((row) => [String(row.breedId), row]));
  const regression = (caseId: string, pass: boolean, detail: string): V3FinalAssessment["mandatoryRegressions"][number] => ({ caseId, status: pass ? "PASS" : "FAIL", detail });
  const goat = byId.get("BRD_DOMESTICATED_GOAT");
  const sheep = byId.get("BRD_DOMESTICATED_SHEEP");
  const flowerhorn = byId.get("BRD_FLOWERHORN_CICHLID");
  const iranian = byId.get("BRD_HUMAN_IRANIAN");
  const tapir = byId.get("BRD_MALAYAN_TAPIR");
  const aardvark = byId.get("BRD_AARDVARK");
  const manatee = byId.get("BRD_AFRICAN_MANATEE");
  const mongoose = byId.get("BRD_BANDED_MONGOOSE");
  const lungfish = byId.get("BRD_AUSTRALIAN_LUNGFISH");
  const ibex = byId.get("BRD_ALPINE_IBEX");
  const genericTraits = input.breeds.filter((row) => strings(row.traits).some((trait) => PROHIBITED_GENERIC_TRAIT.test(trait)));
  const mandatoryRegressions = enforceMandatoryRegressions ? [
    regression("DOMESTICATED_GOAT", Boolean(goat && strings(goat.traits).some((value) => /browse|shrub|brush|leaf/i.test(value)) && strings(goat.foodSpecific).some((value) => /LEAVES|WOODY_BIOMASS/i.test(value))), "Goat browsing and non-grass food must be represented."),
    regression("DOMESTICATED_SHEEP", Boolean(sheep && strings(sheep.foodSpecific).some((value) => /SEEDS_GRAINS/i.test(value))), "Sheep grain/seed feed must be represented."),
    regression("FLOWERHORN_WORKSHOP", Boolean(flowerhorn && !strings(flowerhorn.terrainSpecific).includes("WORKSHOP")), "Aquarium husbandry cannot establish WORKSHOP habitat."),
    regression("IRANIAN_CITY", Boolean(iranian && !strings(iranian.terrainSpecific).includes("CITY")), "CITY cannot be inferred from cuisine/diaspora evidence."),
    regression("MALAYAN_TAPIR_SETTLEMENT", Boolean(tapir && !strings(tapir.terrainSpecific).some((value) => value === "CITY" || value === "VILLAGE")), "Settlement proximity cannot become tapir habitat."),
    regression("AARDVARK_DIMENSION_CASCADE", Boolean(aardvark && ["structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource"].every((field) => aardvark[field] === null)), "Unsupported governance/economic dimensions remain null."),
    regression("HUMAN_GENERIC_WOUND_TEMPLATE", !input.breeds.some((row) => row.populationKind === "HUMAN" && /historical episode at (?:the )?cited locator/i.test(JSON.stringify(row))), "Generic Human wound templates are prohibited."),
    regression("CITATION_CONTEXT", !input.citations.some((row) => !String(row.boundedContext ?? "").trim()), "Every citation has bounded context."),
    regression("PET_GENERIC_TRAITS", !genericTraits.some((row) => row.populationKind === "PET"), "PET traits cannot use generic templates."),
    regression("AFRICAN_MANATEE_DAMS", Boolean(manatee && !strings(manatee.terrainSpecific).some((value) => /DAM/i.test(value))), "Dams are threats/barriers, not habitat."),
    regression("BANDED_MONGOOSE_SOCIALITY", Boolean(mongoose && strings(mongoose.traits).some((value) => /cooper|helper|pup|group/i.test(value))), "Banded mongoose cooperative care must be represented."),
    regression("AUSTRALIAN_LUNGFISH_PARENTAL_GUARDING", Boolean(lungfish && lungfish.personalityId === null && lungfish.motivation === null), "No parental-guarding personality inference is allowed."),
    regression("ALPINE_IBEX_ARBOREAL", Boolean(ibex && !strings(ibex.terrainBroad).includes("FOREST") && !strings(ibex.terrainSpecific).some((value) => /TREE|CANOPY|ARBOR/i.test(value))), "Forest feeding cannot become arboreal habitat."),
  ] : [];
  for (const item of mandatoryRegressions.filter((item) => item.status === "FAIL")) findings.push({ code: `REGRESSION_${item.caseId}`, message: item.detail });

  const structuralIntegrityPassed = input.breeds.length === expectedBreedCount && breedIds.size === expectedBreedCount;
  const semanticEvidenceIntegrityPassed = findings.length === 0;
  const researchCompletionClaimSupported = unresolved === 0 && reviewRequired === 0 && terminal === input.breeds.length * RESEARCH_FIELDS.length;
  const safeToImport = structuralIntegrityPassed && semanticEvidenceIntegrityPassed && researchCompletionClaimSupported;
  return {
    verdict: safeToImport ? "ACCEPT_FINAL" : "REJECT",
    safeToImport,
    researchCompletionClaimSupported,
    structuralIntegrityPassed,
    semanticEvidenceIntegrityPassed,
    counts: { breeds: input.breeds.length, fieldTasks: input.breeds.length * RESEARCH_FIELDS.length, terminal, unresolved, reviewRequired, evidence: input.evidence.length, citations: input.citations.length, sources: input.sources.length },
    findings,
    mandatoryRegressions,
  };
}
