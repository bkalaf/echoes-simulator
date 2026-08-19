import type { GenericRow } from "../inputs/importer.js";

export interface RegressionFinding {
  caseId: string;
  status: "PASS" | "FAIL" | "REOPENED";
  affectedBreedIds: string[];
  detail: string;
}

export interface V2AdversarialCensus {
  verdict: "REJECT";
  counts: {
    breeds: number;
    populationKinds: Record<string, number>;
    researchStatuses: Record<string, number>;
    dimensionRows: number;
    unresolvedDimensionRows: number;
    authoredInferenceDimensionRows: number;
    citations: number;
    citationsWithoutBoundedContext: number;
    traitRows: number;
    distinctTraitTexts: number;
    suspiciousGenericTraitRows: number;
    inheritedEcologyRows: number;
  };
  unresolvedFields: Record<string, number>;
  systemicFindings: RegressionFinding[];
}

function frequencies(rows: readonly GenericRow[], field: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field] ?? "NULL");
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function rowById(rows: readonly GenericRow[], breedId: string): GenericRow {
  const row = rows.find((candidate) => candidate.breedId === breedId);
  if (!row) throw new Error(`Missing mandatory regression Breed ${breedId}`);
  return row;
}

export function auditV2LeadArchive(data: {
  breeds: GenericRow[];
  statuses: GenericRow[];
  dimensions: GenericRow[];
  citations: GenericRow[];
  traits: GenericRow[];
  ecology: GenericRow[];
}): V2AdversarialCensus {
  const { breeds, statuses, dimensions, citations, traits, ecology } = data;
  const unresolvedFields: Record<string, number> = {};
  for (const status of statuses) {
    const dispositions = status.fieldDispositions as Record<string, unknown> | undefined;
    for (const [field, disposition] of Object.entries(dispositions ?? {})) {
      if (disposition === "UNRESOLVED" || disposition === "REVIEW_REQUIRED") unresolvedFields[field] = (unresolvedFields[field] ?? 0) + 1;
    }
  }
  const genericPattern = /^(?:is kept|is raised|was developed|exists as)|source-defined/i;
  const suspiciousTraits = traits.filter((row) => genericPattern.test(String(row.traitText ?? "")));
  const citationsWithoutContext = citations.filter((row) => !row.excerpt && !row.sourceExcerpt && !row.contextSnippet && !row.quotedText);

  const goat = rowById(breeds, "BRD_DOMESTICATED_GOAT");
  const sheep = rowById(breeds, "BRD_DOMESTICATED_SHEEP");
  const flowerhorn = rowById(breeds, "BRD_FLOWERHORN_CICHLID");
  const iranian = rowById(breeds, "BRD_HUMAN_IRANIAN");
  const tapir = rowById(breeds, "BRD_MALAYAN_TAPIR");
  const aardvarkDimensions = dimensions.filter((row) => row.breedId === "BRD_AARDVARK" && row.disposition === "EIDOLON_AUTHORED_INFERENCE");
  const humanGenericWounds = [...traits, ...dimensions].filter((row) => /historical episode at (?:the )?cited locator/i.test(JSON.stringify(row)));
  const petIds = new Set(breeds.filter((row) => row.populationKind === "PET").map((row) => String(row.breedId)));
  const genericPetTraits = suspiciousTraits.filter((row) => petIds.has(String(row.breedId)));
  const manatee = rowById(breeds, "BRD_AFRICAN_MANATEE");
  const mongoose = rowById(breeds, "BRD_BANDED_MONGOOSE");
  const lungfish = rowById(breeds, "BRD_AUSTRALIAN_LUNGFISH");
  const ibex = rowById(breeds, "BRD_ALPINE_IBEX");

  const findings: RegressionFinding[] = [
    { caseId: "DOMESTICATED_GOAT", status: "FAIL", affectedBreedIds: [String(goat.breedId)], detail: `Only trait=${JSON.stringify(goat.traits)} and foodSpecific=${JSON.stringify(goat.foodSpecific)}; the livestock-only/GRASSES template must be reopened.` },
    { caseId: "DOMESTICATED_SHEEP", status: "FAIL", affectedBreedIds: [String(sheep.breedId)], detail: `Only trait=${JSON.stringify(sheep.traits)} and foodSpecific=${JSON.stringify(sheep.foodSpecific)}; grain/seed-feed evidence is not represented.` },
    { caseId: "FLOWERHORN_WORKSHOP", status: asStrings(flowerhorn.terrainSpecific).includes("WORKSHOP") ? "FAIL" : "PASS", affectedBreedIds: [String(flowerhorn.breedId)], detail: `terrainSpecific=${JSON.stringify(flowerhorn.terrainSpecific)}; aquarium husbandry does not establish WORKSHOP habitat.` },
    { caseId: "IRANIAN_CITY", status: asStrings(iranian.terrainSpecific).includes("CITY") ? "FAIL" : "PASS", affectedBreedIds: [String(iranian.breedId)], detail: `terrainSpecific=${JSON.stringify(iranian.terrainSpecific)}; the prior cuisine/diaspora bridge is not habitat evidence.` },
    { caseId: "MALAYAN_TAPIR_SETTLEMENT", status: asStrings(tapir.terrainSpecific).some((value) => value === "CITY" || value === "VILLAGE") ? "FAIL" : "PASS", affectedBreedIds: [String(tapir.breedId)], detail: `terrainSpecific=${JSON.stringify(tapir.terrainSpecific)}; proximity to settlements cannot normalize to settlement habitat.` },
    { caseId: "AARDVARK_DIMENSION_CASCADE", status: aardvarkDimensions.length > 0 ? "FAIL" : "PASS", affectedBreedIds: ["BRD_AARDVARK"], detail: `${aardvarkDimensions.length} dimensions were authored from a personality/behavior bridge instead of field-specific evidence.` },
    { caseId: "HUMAN_GENERIC_WOUND_TEMPLATE", status: humanGenericWounds.length > 0 ? "FAIL" : "REOPENED", affectedBreedIds: [...new Set(humanGenericWounds.map((row) => String(row.breedId)))].sort(), detail: `${humanGenericWounds.length} exact generic-template matches; all Human personality assignments remain reopened for subject, actor/victim, scope, and locator review.` },
    { caseId: "CITATION_CONTEXT", status: citationsWithoutContext.length > 0 ? "FAIL" : "PASS", affectedBreedIds: [], detail: `${citationsWithoutContext.length}/${citations.length} citation rows have no bounded excerpt/context field.` },
    { caseId: "PET_GENERIC_TRAITS", status: genericPetTraits.length > 0 ? "FAIL" : "PASS", affectedBreedIds: [...new Set(genericPetTraits.map((row) => String(row.breedId)))].sort(), detail: `${genericPetTraits.length} PET trait rows match a prohibited generic opening/template.` },
    { caseId: "AFRICAN_MANATEE_DAMS", status: "REOPENED", affectedBreedIds: [String(manatee.breedId)], detail: `Ecology is empty and dam-related claims were not freshly verified: terrainBroad=${JSON.stringify(manatee.terrainBroad)}.` },
    { caseId: "BANDED_MONGOOSE_SOCIALITY", status: "REOPENED", affectedBreedIds: [String(mongoose.breedId)], detail: `Prior group-defense trait exists, but its full evidence chain and independent dimensions require fresh verification.` },
    { caseId: "AUSTRALIAN_LUNGFISH_PARENTAL_GUARDING", status: "FAIL", affectedBreedIds: [String(lungfish.breedId)], detail: `A parental-care fact was converted to personality=${String(lungfish.personalityId)} and motivation=${String(lungfish.motivation)}; both are reopened.` },
    { caseId: "ALPINE_IBEX_ARBOREAL", status: asStrings(ibex.terrainBroad).includes("FOREST") || asStrings(ibex.terrainSpecific).some((value) => /TREE|CANOPY|ARBOR/i.test(value)) ? "FAIL" : "PASS", affectedBreedIds: [String(ibex.breedId)], detail: `terrainBroad=${JSON.stringify(ibex.terrainBroad)} terrainSpecific=${JSON.stringify(ibex.terrainSpecific)}.` },
  ];

  return {
    verdict: "REJECT",
    counts: {
      breeds: breeds.length,
      populationKinds: frequencies(breeds, "populationKind"),
      researchStatuses: frequencies(breeds, "researchStatus"),
      dimensionRows: dimensions.length,
      unresolvedDimensionRows: dimensions.filter((row) => row.disposition === "UNRESOLVED").length,
      authoredInferenceDimensionRows: dimensions.filter((row) => row.disposition === "EIDOLON_AUTHORED_INFERENCE").length,
      citations: citations.length,
      citationsWithoutBoundedContext: citationsWithoutContext.length,
      traitRows: traits.length,
      distinctTraitTexts: new Set(traits.map((row) => String(row.traitText))).size,
      suspiciousGenericTraitRows: suspiciousTraits.length,
      inheritedEcologyRows: ecology.filter((row) => row.disposition === "INHERITED_VERIFIED_VALUE").length,
    },
    unresolvedFields: Object.fromEntries(Object.entries(unresolvedFields).sort(([, a], [, b]) => b - a)),
    systemicFindings: findings,
  };
}
