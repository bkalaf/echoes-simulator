import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { RAW_DIMENSIONS } from "../core/research/v4-contract.js";

type Row = Record<string, unknown>;
const root = resolve(".");
const sourceZip = resolve(root, "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip");
const outputDirectory = resolve(root, "artifacts/research-v4/review-csv");
const archive = unzipSync(readFileSync(sourceZip));
const entries = Object.entries(archive);

function member(suffix: string): Uint8Array {
  const match = entries.find(([name]) => name.endsWith(`/${suffix}`));
  if (!match) throw new Error(`V4 archive member missing: ${suffix}`);
  return match[1];
}

function json<T>(suffix: string): T { return JSON.parse(strFromU8(member(suffix))) as T; }
function jsonl(suffix: string): Row[] { return strFromU8(member(suffix)).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Row); }
function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).join(" | ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function escapeCsv(value: unknown): string {
  const rendered = text(value);
  return /[",\r\n]/.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered;
}
function csvBytes(rows: readonly Row[], columns: readonly string[]): Uint8Array {
  const lines = [columns.map(escapeCsv).join(","), ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))];
  return strToU8(`\uFEFF${lines.join("\r\n")}\r\n`);
}
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function dimensions(row: Row | undefined): Row { return (row?.dimensions as Row | undefined) ?? {}; }
function evidenceKey(unitId: string, field: string): string { return `${unitId}\0${field}`; }

const identities = jsonl("canonical_breed_identities.jsonl");
const effective = jsonl("effective_breed_semantics.jsonl");
const pets = jsonl("pet_policy_semantics.jsonl");
const units = jsonl("research_units.jsonl");
const unitResults = jsonl("unit_results.jsonl");
const inheritance = jsonl("inheritance_edges.jsonl");
const evidence = jsonl("evidence.jsonl");
const citations = jsonl("citations.jsonl");
const sources = jsonl("sources.jsonl");
const journals = jsonl("research_journals.jsonl");
const familyProfiles = jsonl("personality/personality_family_dimension_profiles.jsonl");
const expressionProfiles = jsonl("personality/personality_expression_effective_profiles.jsonl");
const expressionOverrides = jsonl("personality/personality_expression_dimension_overrides.jsonl");
const optionalGaps = json<Row>("optional_authoring_gaps.json");
const manifest = json<Row>("manifest.json");

const semanticByBreed = new Map([...effective, ...pets].map((row) => [String(row.breedId), row]));
const resultByUnit = new Map(unitResults.map((row) => [String(row.researchUnitId), row]));
const edgeByBreed = new Map(inheritance.map((row) => [String(row.breedId), row]));
const citationById = new Map(citations.map((row) => [String(row.citationId), row]));
const sourceById = new Map(sources.map((row) => [String(row.sourceId), row]));
const journalById = new Map(journals.map((row) => [String(row.journalEntryId), row]));
const breedsByUnit = new Map<string, string[]>();
for (const edge of inheritance) breedsByUnit.set(String(edge.researchUnitId), [...(breedsByUnit.get(String(edge.researchUnitId)) ?? []), String(edge.breedId)]);
const evidenceByUnitField = new Map<string, Row[]>();
for (const row of evidence) evidenceByUnitField.set(evidenceKey(String(row.researchUnitId), String(row.targetField)), [...(evidenceByUnitField.get(evidenceKey(String(row.researchUnitId), String(row.targetField))) ?? []), row]);

const evidenceFields = ["personalityId", "terrainBroad", "terrainSpecific"] as const;
const masterRows = identities.map((identity): Row => {
  const breedId = String(identity.breedId);
  const semantic = semanticByBreed.get(breedId);
  const edge = edgeByBreed.get(breedId);
  const researchUnitId = String(semantic?.researchUnitId ?? edge?.researchUnitId ?? "");
  const unitResult = resultByUnit.get(researchUnitId);
  const dimensionValues = dimensions(semantic);
  const row: Row = {
    breedId, name: identity.name, populationKind: identity.populationKind,
    civicSimulation: identity.populationKind !== "PET", groupId: identity.groupId, regionId: identity.regionId,
    regionAssignmentScope: identity.regionAssignmentScope, speciesId: identity.speciesId, cultureId: identity.cultureId,
    parentBreedId: identity.parentBreedId, appearance: identity.appearance, architecture: identity.architecture, clothing: identity.clothing, accent: identity.accent,
    researchUnitId, inheritanceRule: edge?.inheritanceRule, unitStatus: unitResult?.status,
    personalityId: semantic?.personalityId, personalityDisposition: semantic?.personalityDisposition,
    terrainBroad: semantic?.terrainBroad, terrainSpecific: semantic?.terrainSpecific,
    traits: "", traitsDisposition: "OUT_OF_SCOPE_OPTIONAL",
    foodBroad: "", foodBroadDisposition: "OUT_OF_SCOPE_OPTIONAL",
    foodSpecific: "", foodSpecificDisposition: "OUT_OF_SCOPE_OPTIONAL",
    evidenceRefs: edge?.unitEvidenceRefs ?? unitResult?.evidenceRefs ?? [],
  };
  for (const field of RAW_DIMENSIONS) {
    const value = dimensionValues[field] as Row | undefined;
    row[field] = value?.value;
    row[`${field}Disposition`] = value?.disposition;
    row[`${field}PolicyRef`] = value?.policyRef;
  }
  const criticalMissing: string[] = [];
  if (identity.populationKind !== "PET") {
    if (!semantic?.personalityId) criticalMissing.push("personalityId");
    if (!Array.isArray(semantic?.terrainBroad) || semantic.terrainBroad.length === 0) criticalMissing.push("terrainBroad");
    if (!Array.isArray(semantic?.terrainSpecific) || semantic.terrainSpecific.length === 0) criticalMissing.push("terrainSpecific");
    for (const field of RAW_DIMENSIONS) if (!(dimensionValues[field] as Row | undefined)?.value) criticalMissing.push(field);
  }
  row.criticalMissingFieldCount = criticalMissing.length;
  row.criticalMissingFields = criticalMissing;
  row.optionalUnresearchedFieldCount = 3;
  row.reviewFlags = identity.populationKind === "PET" ? "PET_EXCLUDED_BY_POLICY | OPTIONAL_TRAITS_FOOD_NOT_RESEARCHED" : "OPTIONAL_TRAITS_FOOD_NOT_RESEARCHED";
  for (const field of evidenceFields) {
    const chain = evidenceByUnitField.get(evidenceKey(researchUnitId, field)) ?? [];
    const chainCitations = chain.map((item) => citationById.get(`CIT_${String(item.evidenceId).slice(4)}`)).filter((item): item is Row => Boolean(item));
    const chainSources = chainCitations.map((item) => sourceById.get(String(item.sourceId))).filter((item): item is Row => Boolean(item));
    row[`${field}EvidenceIds`] = chain.map((item) => item.evidenceId);
    row[`${field}SourceUrls`] = chain.map((item) => item.sourceUrl);
    row[`${field}SourceTitles`] = chain.map((item) => item.sourceTitle);
    row[`${field}Publishers`] = chainSources.map((item) => item.publisher);
    row[`${field}Locators`] = chain.map((item) => item.locator);
    row[`${field}BoundedContexts`] = chain.map((item) => item.boundedContext);
    row[`${field}SourceFacts`] = chain.map((item) => item.sourceFact);
    row[`${field}NormalizationBridges`] = chain.map((item) => item.normalizationBridge);
    row[`${field}SubjectAlignments`] = chainCitations.map((item) => item.subjectAlignment);
    row[`${field}ClaimAlignments`] = chainCitations.map((item) => item.claimAlignment);
  }
  return row;
}).sort((left, right) => String(left.breedId).localeCompare(String(right.breedId)));

const identityColumns = ["breedId", "name", "populationKind", "civicSimulation", "groupId", "regionId", "regionAssignmentScope", "speciesId", "cultureId", "parentBreedId", "appearance", "architecture", "clothing", "accent"];
const researchColumns = ["researchUnitId", "inheritanceRule", "unitStatus", "personalityId", "personalityDisposition", "terrainBroad", "terrainSpecific", "traits", "traitsDisposition", "foodBroad", "foodBroadDisposition", "foodSpecific", "foodSpecificDisposition", "evidenceRefs"];
const dimensionColumns = RAW_DIMENSIONS.flatMap((field) => [field, `${field}Disposition`, `${field}PolicyRef`]);
const reviewColumns = ["criticalMissingFieldCount", "criticalMissingFields", "optionalUnresearchedFieldCount", "reviewFlags"];
const evidenceColumns = evidenceFields.flatMap((field) => [`${field}EvidenceIds`, `${field}SourceUrls`, `${field}SourceTitles`, `${field}Publishers`, `${field}Locators`, `${field}BoundedContexts`, `${field}SourceFacts`, `${field}NormalizationBridges`, `${field}SubjectAlignments`, `${field}ClaimAlignments`]);

const enrichedEvidence = evidence.map((row): Row => {
  const citation = citationById.get(`CIT_${String(row.evidenceId).slice(4)}`);
  const source = citation ? sourceById.get(String(citation.sourceId)) : undefined;
  const journal = journalById.get(String(row.journalEntryId));
  return { ...row, citationId: citation?.citationId, sourceId: citation?.sourceId, subjectAlignment: citation?.subjectAlignment, claimAlignment: citation?.claimAlignment, citationBoundedContext: citation?.boundedContext, authorOrOrganization: source?.authorOrOrganization, publisher: source?.publisher, stableUrlOrIdentifier: source?.stableUrlOrIdentifier, inheritedBreedCount: breedsByUnit.get(String(row.researchUnitId))?.length ?? 0, inheritedBreedIds: breedsByUnit.get(String(row.researchUnitId)) ?? [], journalQuery: journal?.query, journalSearchResultChosen: journal?.searchResultChosen, journalActualOpenedUrl: journal?.actualOpenedUrl, journalAccepted: journal?.accepted };
});

const unitById = new Map(units.map((row) => [String(row.unitId), row]));
const unitReview = unitResults.map((row): Row => ({ ...unitById.get(String(row.researchUnitId)), ...row, inheritedBreedCount: breedsByUnit.get(String(row.researchUnitId))?.length ?? 0, inheritedBreedIds: breedsByUnit.get(String(row.researchUnitId)) ?? [] }));

const auditRows: Row[] = [];
for (let index = 1; index <= 7; index += 1) {
  const auditId = `AUDIT_${String(index).padStart(2, "0")}`;
  const audit = json<{ status: string; units: { researchUnitId: string; unitType: string; regionId: string; batchId: string; status: string; fields: Row[]; inheritance: Row; messages: unknown[] }[] }>(`audits/${auditId}/audit_findings.json`);
  for (const unit of audit.units) for (const field of unit.fields) auditRows.push({ auditId, auditStatus: audit.status, researchUnitId: unit.researchUnitId, unitType: unit.unitType, regionId: unit.regionId, batchId: unit.batchId, unitStatus: unit.status, ...field, unitMessages: unit.messages, inheritanceStatus: unit.inheritance.status, expectedBreedIds: unit.inheritance.expectedBreedIds, actualBreedIds: unit.inheritance.actualBreedIds, inheritanceMessages: unit.inheritance.messages });
}

const flattenProfile = (row: Row, dimensionKey: "baseDimensions" | "dimensions"): Row => ({ ...row, ...Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, (row[dimensionKey] as Row | undefined)?.[field]])), [dimensionKey]: undefined });
const files = new Map<string, Uint8Array>();
files.set("breed_review_master.csv", csvBytes(masterRows, [...identityColumns, ...researchColumns, ...dimensionColumns, ...reviewColumns, ...evidenceColumns]));
files.set("research_units.csv", csvBytes(unitReview, ["researchUnitId", "unitType", "populationKind", "initialRegion", "groupIds", "breedIds", "personalityId", "terrainBroad", "terrainSpecific", "status", "evidenceRefs", "inheritedBreedCount", "inheritedBreedIds"]));
files.set("research_evidence.csv", csvBytes(enrichedEvidence, ["evidenceId", "researchUnitId", "targetField", "batchId", "journalEntryId", "researchedAt", "sourceOpened", "sourceUrl", "sourceTitle", "locator", "boundedContext", "sourceFact", "normalizationBridge", "generatedBy", "citationId", "sourceId", "authorOrOrganization", "publisher", "stableUrlOrIdentifier", "subjectAlignment", "claimAlignment", "citationBoundedContext", "journalQuery", "journalSearchResultChosen", "journalActualOpenedUrl", "journalAccepted", "inheritedBreedCount", "inheritedBreedIds"]));
files.set("research_sources.csv", csvBytes(sources, ["sourceId", "title", "authorOrOrganization", "publisher", "stableUrlOrIdentifier", "sourceOpened"]));
files.set("research_citations.csv", csvBytes(citations, ["citationId", "sourceId", "locator", "boundedContext", "sourceFact", "subjectAlignment", "claimAlignment"]));
files.set("research_journals.csv", csvBytes(journals, ["journalEntryId", "batchId", "targetUnitId", "targetField", "timestamp", "query", "searchResultChosen", "actualOpenedUrl", "sourceOpened", "accepted", "rejectionReason", "title", "organization", "publisher", "locator", "boundedContext", "sourceFact"]));
files.set("inheritance_edges.csv", csvBytes(inheritance, ["researchUnitId", "breedId", "inheritanceRule", "unitEvidenceRefs"]));
files.set("personality_family_profiles.csv", csvBytes(familyProfiles.map((row) => flattenProfile(row, "baseDimensions")), ["policyRef", "family", "meaning", ...RAW_DIMENSIONS, "fieldRationales", "duplicateProfileJustification"]));
files.set("personality_expression_profiles.csv", csvBytes(expressionProfiles.map((row) => flattenProfile(row, "dimensions")), ["policyRef", "personalityId", "family", ...RAW_DIMENSIONS, "overriddenFields"]));
files.set("personality_expression_overrides.csv", csvBytes(expressionOverrides, ["policyRef", "personalityId", "family", "expression", "reviewed", "reviewRationale", "overrides"]));
files.set("independent_audit_fields.csv", csvBytes(auditRows, ["auditId", "auditStatus", "researchUnitId", "unitType", "regionId", "batchId", "unitStatus", "field", "status", "evidenceId", "journalEntryId", "sourceId", "citationId", "messages", "unitMessages", "inheritanceStatus", "expectedBreedIds", "actualBreedIds", "inheritanceMessages"]));

const civicRows = masterRows.filter((row) => row.civicSimulation === true);
const summaryRows: Row[] = [
  { category: "IDENTITY", metric: "allBreeds", value: masterRows.length, reviewMeaning: "All canonical Breed identities" },
  { category: "IDENTITY", metric: "civicBreeds", value: civicRows.length, reviewMeaning: "Included in civic simulation" },
  { category: "IDENTITY", metric: "petBreeds", value: masterRows.length - civicRows.length, reviewMeaning: "Excluded by PET policy" },
  { category: "CRITICAL", metric: "civicRowsWithCriticalBlanks", value: civicRows.filter((row) => Number(row.criticalMissingFieldCount) > 0).length, reviewMeaning: "Blank among Personality, terrain, or twelve dimensions" },
  { category: "OPTIONAL_GAP", metric: "traitsResearchedBreeds", value: 0, reviewMeaning: "V4 declares traits OUT_OF_SCOPE_OPTIONAL for all Breeds" },
  { category: "OPTIONAL_GAP", metric: "foodBroadResearchedBreeds", value: 0, reviewMeaning: "V4 declares foodBroad OUT_OF_SCOPE_OPTIONAL for all Breeds" },
  { category: "OPTIONAL_GAP", metric: "foodSpecificResearchedBreeds", value: 0, reviewMeaning: "V4 declares foodSpecific OUT_OF_SCOPE_OPTIONAL for all Breeds" },
  { category: "EVIDENCE", metric: "evidenceRows", value: enrichedEvidence.length, reviewMeaning: "Personality and terrain evidence records" },
  { category: "EVIDENCE", metric: "sourceRows", value: sources.length, reviewMeaning: "Distinct source records" },
  { category: "AUDIT", metric: "auditFieldRows", value: auditRows.length, reviewMeaning: "Independent field-level audit records" },
];
files.set("review_summary.csv", csvBytes(summaryRows, ["category", "metric", "value", "reviewMeaning"]));

const readme = `# V4 Breed data review export\n\nSource: ${sourceZip}\nSource SHA-256: ${sha256(readFileSync(sourceZip))}\nManifest status: ${String(manifest.status)}\n\nThis export preserves the V4 authority as written. It does not treat the pack's SIMULATION_READY claim as proof that every owner-requested authoring field was researched. In particular, optional_authoring_gaps.json marks traits, foodBroad, and foodSpecific OUT_OF_SCOPE_OPTIONAL for all 2,056 Breeds; the master CSV exposes those fields as blank with that disposition.\n\nArrays are separated with \" | \". Nested policy/audit objects remain JSON inside quoted CSV cells. UTF-8 CSV files include a BOM for spreadsheet compatibility.\n`;
files.set("README.md", strToU8(readme));

const checksums = [...files].sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join("\n") + "\n";
files.set("checksums.sha256", strToU8(checksums));
mkdirSync(outputDirectory, { recursive: true });
for (const [name, bytes] of files) writeFileSync(resolve(outputDirectory, name), bytes);
const fixedDate = new Date("1980-01-02T00:00:00.000Z");
const zippable: Zippable = {};
for (const [name, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) zippable[`ECHOES_OF_EIDOLON_V4_BREED_REVIEW/${name}`] = [bytes, { mtime: fixedDate }];
const reviewZip = zipSync(zippable, { level: 6 });
writeFileSync(resolve(outputDirectory, "ECHOES_OF_EIDOLON_V4_BREED_REVIEW_CSV.zip"), reviewZip);
process.stdout.write(`${JSON.stringify({ outputDirectory, sourceSha256: sha256(readFileSync(sourceZip)), masterRows: masterRows.length, civicRows: civicRows.length, petRows: masterRows.length - civicRows.length, civicRowsWithCriticalBlanks: civicRows.filter((row) => Number(row.criticalMissingFieldCount) > 0).length, optionalFieldsUnresearchedForAllBreeds: ["traits", "foodBroad", "foodSpecific"], evidenceRows: enrichedEvidence.length, sources: sources.length, auditFieldRows: auditRows.length, reviewZipSha256: sha256(reviewZip) }, null, 2)}\n`);
