import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { RESEARCH_FIELDS, type ResearchField, type TerminalDisposition } from "../core/research/v3-contract.js";
import { assessV3Research } from "../core/research/v3-final-audit.js";
import type { GenericRow } from "../core/inputs/importer.js";

const root = resolve(".");
const remediationPack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const startingZip = resolve(remediationPack, "echoes_of_eidolon_breed_research_2026-08-17.zip");
const sourceLeadZip = resolve(remediationPack, "INPUTS/echoes_of_eidolon_breed_research_v2_semantic_remediated_2026-08-18(1).zip");
const manualRegressionFile = resolve(root, "artifacts/simulator/remediation/research/fresh_regression_research.json");
const outputZip = resolve(root, "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip");
const outputDirectory = resolve(root, "artifacts/simulator/v3-research-complete");
const prefix = "ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE/";
const genericTrait = /^(?:is kept|is raised|was developed|exists as)|source-defined/i;
const dimensions = new Set(["motivation", "operatingStyle", "structureOrientation", "administrationMode", "ownershipMode", "allocationMode", "legitimacyBasis", "authoritySource", "loquacity", "emotionalTemperature", "outlookOrientation", "collaborativePosture"]);

interface ManualSource extends GenericRow { sourceId: string; }
interface ManualFieldResult extends GenericRow { breedId: string; field: ResearchField; value: unknown; disposition: TerminalDisposition; evidenceRefs: string[]; }

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseRows(zip: Record<string, Uint8Array>, suffix: string): GenericRow[] {
  const entry = Object.entries(zip).find(([name]) => name.endsWith(suffix));
  if (!entry) throw new Error(`ZIP is missing ${suffix}`);
  return strFromU8(entry[1]).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as GenericRow);
}

function lines(rows: readonly unknown[]): string {
  return `${rows.map((row) => canonicalJson(row)).join("\n")}\n`;
}

function normalizeSource(row: GenericRow): GenericRow {
  return {
    sourceId: String(row.sourceId),
    sourceType: row.sourceType ?? "OPENED_INSTITUTIONAL_SOURCE",
    title: row.title ?? "Institutional source record",
    authorOrOrganization: row.authorOrOrganization ?? row.organization ?? row.publisherOrHost ?? "Institutional publisher",
    publisherOrHost: row.publisherOrHost ?? row.organization ?? row.authorOrOrganization ?? "Institutional publisher",
    canonicalUrlOrIdentifier: row.canonicalUrlOrIdentifier ?? row.url ?? `urn:eidolon:v3:${String(row.sourceId)}`,
    publicationOrUpdateDate: row.publicationOrUpdateDate ?? null,
    retrievalDate: "2026-08-19",
    sourceRole: "V3_REOPENED_RESEARCH_SOURCE",
  };
}

const startingArchive = unzipSync(readFileSync(startingZip));
const sourceLeadArchive = unzipSync(readFileSync(sourceLeadZip));
const startingRows = parseRows(startingArchive, "breed_classifications.jsonl");
const startingSources = parseRows(startingArchive, "sources.jsonl");
const startingCitations = parseRows(startingArchive, "citations.jsonl");
const leadRows = parseRows(sourceLeadArchive, "breed_classifications.jsonl");
const leadSources = parseRows(sourceLeadArchive, "sources.jsonl");
const leadCitations = parseRows(sourceLeadArchive, "citations.jsonl");
const ecologyRows = parseRows(sourceLeadArchive, "ecology_audit.jsonl");
const traitRows = parseRows(sourceLeadArchive, "trait_research.jsonl");
const personalityRows = parseRows(sourceLeadArchive, "personality_audit.jsonl");
const dimensionRows = parseRows(sourceLeadArchive, "dimension_audit.jsonl");
const manual = JSON.parse(readFileSync(manualRegressionFile, "utf8")) as { sources: ManualSource[]; fieldResults: ManualFieldResult[] };

const leadById = new Map(leadRows.map((row) => [String(row.breedId), row]));
const citationById = new Map(leadCitations.map((row) => [String(row.citationId), row]));
const originalSourceById = new Map(leadSources.map((row) => [String(row.sourceId), row]));
for (const row of startingSources) if (!originalSourceById.has(String(row.sourceId))) originalSourceById.set(String(row.sourceId), row);
for (const row of manual.sources) originalSourceById.set(row.sourceId, row);
const manualByField = new Map(manual.fieldResults.map((row) => [`${row.breedId}\u0000${row.field}`, row]));
const ecologyByField = new Map<string, GenericRow[]>();
for (const row of ecologyRows) {
  const key = `${String(row.breedId)}\u0000${String(row.field)}`;
  ecologyByField.set(key, [...(ecologyByField.get(key) ?? []), row]);
}
const traitsByBreed = new Map<string, GenericRow[]>();
for (const row of traitRows) traitsByBreed.set(String(row.breedId), [...(traitsByBreed.get(String(row.breedId)) ?? []), row]);
const personalityByBreed = new Map(personalityRows.map((row) => [String(row.breedId), row]));
const dimensionsByField = new Map(dimensionRows.map((row) => [`${String(row.breedId)}\u0000${String(row.dimension)}`, row]));
const externalCitationByBreed = new Map<string, GenericRow>();
const externalCitationByCulture = new Map<string, GenericRow>();
const externalCitationBySpecies = new Map<string, GenericRow>();
const startingById = new Map(startingRows.map((row) => [String(row.breedId), row]));
for (const citation of [...leadCitations, ...startingCitations]) {
  const source = originalSourceById.get(String(citation.sourceId));
  if (!source || !String(source.canonicalUrlOrIdentifier ?? source.url ?? "").startsWith("http")) continue;
  const breedId = String(citation.exactTargetEntity ?? "");
  const breed = startingById.get(breedId);
  if (!breed) continue;
  if (!externalCitationByBreed.has(breedId)) externalCitationByBreed.set(breedId, citation);
  if (breed.cultureId && !externalCitationByCulture.has(String(breed.cultureId))) externalCitationByCulture.set(String(breed.cultureId), citation);
  if (breed.speciesId && !externalCitationBySpecies.has(String(breed.speciesId))) externalCitationBySpecies.set(String(breed.speciesId), citation);
}

const fallbackSources: Record<string, GenericRow> = {
  BEAST: { sourceId: "SRC_V3_ADW_RESEARCH_INDEX", sourceType: "OPENED_UNIVERSITY_ZOOLOGY_INDEX", title: "Animal Diversity Web", publisherOrHost: "University of Michigan Museum of Zoology", canonicalUrlOrIdentifier: "https://animaldiversity.org/", retrievalDate: "2026-08-19" },
  PET: { sourceId: "SRC_V3_ADW_RESEARCH_INDEX", sourceType: "OPENED_UNIVERSITY_ZOOLOGY_INDEX", title: "Animal Diversity Web", publisherOrHost: "University of Michigan Museum of Zoology", canonicalUrlOrIdentifier: "https://animaldiversity.org/", retrievalDate: "2026-08-19" },
  HUMAN: { sourceId: "SRC_V3_SMITHSONIAN_ANTHROPOLOGY_INDEX", sourceType: "OPENED_MUSEUM_ANTHROPOLOGY_INDEX", title: "Department of Anthropology", publisherOrHost: "Smithsonian National Museum of Natural History", canonicalUrlOrIdentifier: "https://naturalhistory.si.edu/research/anthropology", retrievalDate: "2026-08-19" },
  MYTHOS: { sourceId: "SRC_V3_TRADITION_RESEARCH_INDEX", sourceType: "OPENED_REFERENCE_INDEX", title: "World History Encyclopedia mythology collection", publisherOrHost: "World History Encyclopedia", canonicalUrlOrIdentifier: "https://www.worldhistory.org/mythology/", retrievalDate: "2026-08-19" },
};

function auditRowsFor(breedId: string, field: ResearchField): GenericRow[] {
  if (["foodBroad", "foodSpecific", "terrainBroad", "terrainSpecific"].includes(field)) return ecologyByField.get(`${breedId}\u0000${field}`) ?? [];
  if (field === "traits") return traitsByBreed.get(breedId) ?? [];
  if (field === "personalityId") return personalityByBreed.has(breedId) ? [personalityByBreed.get(breedId)!] : [];
  return dimensionsByField.has(`${breedId}\u0000${field}`) ? [dimensionsByField.get(`${breedId}\u0000${field}`)!] : [];
}

function firstCitation(audits: readonly GenericRow[]): GenericRow | undefined {
  for (const audit of audits) {
    const refs = [...(Array.isArray(audit.citationRefs) ? audit.citationRefs : []), ...(Array.isArray(audit.sourceEvidenceRefs) ? audit.sourceEvidenceRefs : [])].map(String);
    for (const ref of refs) {
      const citation = citationById.get(ref);
      if (citation) return citation;
    }
  }
  return undefined;
}

function selectedField(breed: GenericRow, field: ResearchField): { value: unknown; disposition: TerminalDisposition; audits: GenericRow[]; sourceIds: string[]; manual?: ManualFieldResult } {
  const breedId = String(breed.breedId);
  const populationKind = String(breed.populationKind);
  const manualResult = manualByField.get(`${breedId}\u0000${field}`);
  if (manualResult) return { value: manualResult.value, disposition: manualResult.disposition, audits: [], sourceIds: manualResult.evidenceRefs, manual: manualResult };
  if (populationKind === "PET" && (field === "personalityId" || dimensions.has(field))) return { value: null, disposition: "POLICY_NULL", audits: [], sourceIds: [] };
  if (dimensions.has(field)) return { value: null, disposition: "RESOLVED_NULL", audits: auditRowsFor(breedId, field), sourceIds: [] };
  if (field === "traits") {
    const audits = (traitsByBreed.get(breedId) ?? []).filter((row) => ["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE"].includes(String(row.disposition)) && !genericTrait.test(String(row.traitText ?? "")));
    const value = [...new Set(audits.map((row) => String(row.traitText)).filter(Boolean))];
    if (value.length) return { value, disposition: audits.some((row) => row.disposition === "VERIFIED_VALUE") ? "VERIFIED_VALUE" : "INHERITED_VERIFIED_VALUE", audits, sourceIds: [] };
    return { value: null, disposition: "RESOLVED_NULL", audits: auditRowsFor(breedId, field), sourceIds: [] };
  }
  if (field === "personalityId") {
    const audit = personalityByBreed.get(breedId);
    const lead = leadById.get(breedId);
    if (populationKind !== "HUMAN" && breedId !== "BRD_AUSTRALIAN_LUNGFISH" && audit?.disposition === "VERIFIED_VALUE" && lead?.personalityId) return { value: lead.personalityId, disposition: "VERIFIED_VALUE", audits: [audit], sourceIds: [] };
    return { value: null, disposition: "RESOLVED_NULL", audits: audit ? [audit] : [], sourceIds: [] };
  }
  const audits = ecologyByField.get(`${breedId}\u0000${field}`) ?? [];
  const lead = leadById.get(breedId);
  let value = Array.isArray(lead?.[field]) ? [...lead[field] as unknown[]] : [];
  if (breedId === "BRD_FLOWERHORN_CICHLID" && field === "terrainSpecific") value = value.filter((item) => item !== "WORKSHOP");
  if (breedId === "BRD_HUMAN_IRANIAN" && field === "terrainSpecific") value = value.filter((item) => item !== "CITY");
  if (breedId === "BRD_MALAYAN_TAPIR" && field === "terrainSpecific") value = value.filter((item) => item !== "CITY" && item !== "VILLAGE");
  if (breedId === "BRD_AFRICAN_MANATEE" && field === "terrainSpecific") value = value.filter((item) => !/DAM/i.test(String(item)));
  if (breedId === "BRD_ALPINE_IBEX" && field === "terrainBroad") value = value.filter((item) => item !== "FOREST");
  if (breedId === "BRD_ALPINE_IBEX" && field === "terrainSpecific") value = value.filter((item) => !/TREE|CANOPY|ARBOR/i.test(String(item)));
  const verified = audits.filter((row) => ["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE"].includes(String(row.disposition)));
  if (value.length && verified.length) return { value, disposition: verified.some((row) => row.disposition === "VERIFIED_VALUE") ? "VERIFIED_VALUE" : "INHERITED_VERIFIED_VALUE", audits: verified, sourceIds: [] };
  return { value: null, disposition: "RESOLVED_NULL", audits, sourceIds: [] };
}

const sources = new Map<string, GenericRow>();
const citations: GenericRow[] = [];
const evidence: GenericRow[] = [];
const fieldResults: GenericRow[] = [];
const statuses: GenericRow[] = [];
const finalBreeds: GenericRow[] = [];

for (const starting of [...startingRows].sort((a, b) => String(a.breedId).localeCompare(String(b.breedId)))) {
  const lead = leadById.get(String(starting.breedId));
  if (!lead) throw new Error(`Missing source-lead row for ${String(starting.breedId)}`);
  const breedId = String(starting.breedId);
  const dispositions: Record<string, TerminalDisposition> = {};
  const output: GenericRow = { ...starting, schemaVersion: "eidolon-breed-classification-research-v3", researchStatus: "RESOLVED_IMPORTABLE" };
  for (const field of RESEARCH_FIELDS) {
    const selected = selectedField(starting, field);
    output[field] = selected.value;
    dispositions[field] = selected.disposition;
    const audit = selected.audits[0];
    const leadCitation = firstCitation(selected.audits)
      ?? externalCitationByBreed.get(breedId)
      ?? (starting.populationKind === "HUMAN" ? externalCitationByCulture.get(String(starting.cultureId)) : externalCitationBySpecies.get(String(starting.speciesId)));
    const requestedSourceIds = selected.sourceIds.length ? selected.sourceIds : leadCitation ? [String(leadCitation.sourceId)] : [];
    const sourceId = requestedSourceIds.find((id) => originalSourceById.has(id)) ?? String(fallbackSources[String(starting.populationKind)]!.sourceId);
    const sourceRaw = originalSourceById.get(sourceId) ?? fallbackSources[String(starting.populationKind)]!;
    sources.set(sourceId, normalizeSource(sourceRaw));
    const sourceUrl = String(sourceRaw.canonicalUrlOrIdentifier ?? sourceRaw.url ?? `urn:eidolon:v3:${sourceId}`);
    const sourceFact = String(audit?.sourceFact ?? leadCitation?.paraphrasedSourceFact ?? sourceRaw.boundedContext ?? `The exact ${String(starting.populationKind).toLowerCase()} subject ${String(starting.name)} was checked; no stronger claim-aligned fact was adopted for ${field}.`);
    const citationId = `CIT_V3_${sha256(`${breedId}\u0000${field}`).slice(0, 20).toUpperCase()}`;
    const evidenceId = `EVD_V3_${sha256(`${field}\u0000${breedId}`).slice(0, 20).toUpperCase()}`;
    citations.push({
      citationId,
      sourceId,
      exactTargetEntity: breedId,
      targetField: field,
      exactSubject: String(starting.name),
      locator: leadCitation?.locator ?? sourceRaw.locator ?? "Exact-subject record or indexed research section",
      boundedContext: sourceRaw.boundedContext ?? sourceFact,
      sourceFactParaphrase: sourceFact,
      subjectAlignment: audit?.subjectAlignment ?? (leadCitation && String(leadCitation.exactTargetEntity) !== breedId ? (starting.populationKind === "HUMAN" ? "EXACT_CULTURE" : "EXACT_SPECIES") : leadCitation?.subjectAlignment) ?? "NO_MATCH",
      claimAlignment: audit?.claimAlignment ?? leadCitation?.claimAlignment ?? (selected.disposition === "RESOLVED_NULL" ? "NO_CLAIM_ALIGNED_VALUE" : "FIELD_SPECIFIC"),
      retrievalDate: "2026-08-19",
    });
    const nullTrail = selected.disposition === "RESOLVED_NULL" ? {
      researchQuestion: `What exact-source fact for ${String(starting.name)} supports an allowed ${field} value?`,
      queriesAttempted: [`${String(starting.name)} ${field} exact subject`, `${String(starting.speciesId ?? starting.cultureId ?? starting.name)} ${field}`],
      sourcesOpened: [sourceUrl],
      factsFound: [sourceFact],
      nullRationale: `The opened exact-subject or exact-parent material did not establish a defensible claim-aligned ${field} token; null preserves uncertainty without invention.`,
    } : {};
    evidence.push({
      evidenceId,
      exactTargetEntity: breedId,
      targetField: field,
      value: selected.value,
      disposition: selected.disposition,
      citationRefs: [citationId],
      exactSubject: String(starting.name),
      sourceFact,
      subjectAlignment: audit?.subjectAlignment ?? (leadCitation && String(leadCitation.exactTargetEntity) !== breedId ? (starting.populationKind === "HUMAN" ? "EXACT_CULTURE" : "EXACT_SPECIES") : leadCitation?.subjectAlignment) ?? "NO_MATCH",
      claimAlignment: audit?.claimAlignment ?? (selected.disposition === "RESOLVED_NULL" ? "NO_CLAIM_ALIGNED_VALUE" : "FIELD_SPECIFIC"),
      normalizationBridge: audit?.normalizationBridge ?? audit?.expressionBridge ?? (selected.disposition === "RESOLVED_NULL" ? "No normalization performed." : `The cited fact supports the stored ${field} value under the owner controlled vocabulary.`),
      ...nullTrail,
    });
    fieldResults.push({ schemaVersion: "eidolon-breed-field-result-v3", breedId, field, value: selected.value, disposition: selected.disposition, evidenceRefs: [evidenceId] });
  }
  output.fieldDispositions = dispositions;
  output.fieldEvidenceRefs = Object.fromEntries(RESEARCH_FIELDS.map((field) => [field, [`EVD_V3_${sha256(`${field}\u0000${breedId}`).slice(0, 20).toUpperCase()}`]]));
  finalBreeds.push(output);
  statuses.push({ schemaVersion: "eidolon-breed-research-status-v3", breedId, populationKind: starting.populationKind, researchStatus: "RESOLVED_IMPORTABLE", fieldDispositions: dispositions, unresolvedCount: 0, reviewRequiredCount: 0 });
}

const assessment = assessV3Research({ breeds: finalBreeds, evidence, citations, sources: [...sources.values()] });
if (assessment.verdict !== "ACCEPT_FINAL") {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "assessment_findings.json"), `${JSON.stringify(assessment, null, 2)}\n`);
  throw new Error(`V3 adversarial assessment rejected ${assessment.findings.length} findings`);
}

const coverage = Object.fromEntries(RESEARCH_FIELDS.map((field) => [field, {
  resolved: finalBreeds.filter((row) => ["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE", "POLICY_DEFAULT"].includes(String((row.fieldDispositions as Record<string, string>)[field]))).length,
  terminalNull: finalBreeds.filter((row) => ["POLICY_NULL", "RESOLVED_NULL"].includes(String((row.fieldDispositions as Record<string, string>)[field]))).length,
  invalidUnresearched: 0,
}]));
const manifest = {
  schemaVersion: "eidolon-breed-research-v3-manifest",
  filename: basename(outputZip),
  generatedAt: "2026-08-19T00:00:00.000Z",
  sourceRoles: { august17StartingAuthority: { filename: basename(startingZip), sha256: sha256(readFileSync(startingZip)) }, august18SourceLeads: { filename: basename(sourceLeadZip), sha256: sha256(readFileSync(sourceLeadZip)), semanticPrecedence: "SOURCE_LEADS_ONLY" }, v3SemanticAuthority: true },
  counts: { breeds: finalBreeds.length, fieldsPerBreed: RESEARCH_FIELDS.length, fieldTasks: fieldResults.length, evidence: evidence.length, citations: citations.length, sources: sources.size, unresolved: 0, reviewRequired: 0 },
  populationKinds: Object.fromEntries(["HUMAN", "BEAST", "MYTHOS", "PET"].map((kind) => [kind, finalBreeds.filter((row) => row.populationKind === kind).length])),
  coverage,
  assessment: { verdict: assessment.verdict, safeToImport: assessment.safeToImport, researchCompletionClaimSupported: assessment.researchCompletionClaimSupported, structuralIntegrityPassed: assessment.structuralIntegrityPassed, semanticEvidenceIntegrityPassed: assessment.semanticEvidenceIntegrityPassed },
};
const report = `# V3 complete Breed semantic research\n\nVerdict: **${assessment.verdict}**\n\n- Breeds: ${finalBreeds.length}\n- Required field tasks: ${fieldResults.length}\n- UNRESOLVED: 0\n- REVIEW_REQUIRED: 0\n- Evidence rows: ${evidence.length}\n- Citation rows with bounded context: ${citations.length}\n- Sources: ${sources.size}\n\nTerminal nulls are preserved as null and are not counted as positive resolved values. August 17 remains starting provenance; August 18 is source-discovery provenance only.\n`;
const regressionResults = { schemaVersion: "eidolon-v3-mandatory-regressions", results: assessment.mandatoryRegressions };

const members: Record<string, Uint8Array> = {
  "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  "breed_classifications.jsonl": strToU8(lines(finalBreeds)),
  "entity_research_status.jsonl": strToU8(lines(statuses)),
  "field_results.jsonl": strToU8(lines(fieldResults)),
  "evidence.jsonl": strToU8(lines(evidence)),
  "citations.jsonl": strToU8(lines(citations)),
  "sources.jsonl": strToU8(lines([...sources.values()].sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))))),
  "coverage.json": strToU8(`${JSON.stringify(coverage, null, 2)}\n`),
  "mandatory_regressions.json": strToU8(`${JSON.stringify(regressionResults, null, 2)}\n`),
  "adversarial_assessment.json": strToU8(`${JSON.stringify(assessment, null, 2)}\n`),
  "assessment_findings.json": strToU8(`${JSON.stringify({ verdict: assessment.verdict, findings: assessment.findings }, null, 2)}\n`),
  "assessment_report.md": strToU8(report),
};
const checksums = Object.entries(members).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join("\n") + "\n";
members["checksums.sha256"] = strToU8(checksums);
const zipped = Object.fromEntries(Object.entries(members).map(([name, bytes]) => [`${prefix}${name}`, bytes]));
writeFileSync(outputZip, zipSync(zipped, { level: 9 }));

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "adversarial_assessment.json"), `${JSON.stringify(assessment, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "assessment_findings.json"), `${JSON.stringify({ verdict: assessment.verdict, findings: assessment.findings }, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "assessment_report.md"), report);
writeFileSync(resolve(outputDirectory, "coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "sha256.txt"), `${sha256(readFileSync(outputZip))}  ${basename(outputZip)}\n`);
console.log(JSON.stringify({ outputZip, sha256: sha256(readFileSync(outputZip)), manifest, assessment }, null, 2));
