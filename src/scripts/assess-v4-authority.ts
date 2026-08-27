import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8 } from "fflate";
import { openValidatedZip, parseJsonLines, sha256, type GenericRow } from "../core/inputs/importer.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { rebalanceBreedDimensions } from "../core/research/breed-dimension-balance.js";
import { applyBreedFactionProjection, BREED_FACTION_PROJECTION_POLICY, projectBreedFaction } from "../core/research/breed-faction-projection.js";
import { BREED_DIMENSION_BALANCE_POLICY, PERSONALITY_DIMENSION_POLICY, RAW_DIMENSIONS, type EffectiveBreedSemantics } from "../core/research/v4-contract.js";

const root = resolve(".");
const filename = resolve(root, process.argv[2] ?? "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip");
const outputDirectory = resolve(root, "artifacts/research-v4/acceptance");
const archive = openValidatedZip(filename);
const findings: { code: string; severity: "CRITICAL"; message: string; researchUnitId?: string; breedId?: string }[] = [];
const add = (code: string, message: string, detail: { researchUnitId?: string; breedId?: string } = {}): void => { findings.push({ code, severity: "CRITICAL", message, ...detail }); };
const member = (name: string): Uint8Array => { const value = archive.entries[`${archive.prefix}${name}`]; if (!value) throw new Error(`V4 authority lacks ${name}`); return value; };
const rows = (name: string): GenericRow[] => parseJsonLines(member(name));
const exact = (label: string, expected: readonly string[], actual: readonly string[]): void => {
  const left = [...expected].sort(); const right = [...actual].sort();
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length || left.join("\0") !== right.join("\0")) add(`EXACT_${label.toUpperCase().replaceAll(" ", "_")}`, `${label} coverage is not exact.`);
};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
const isGeneric = (source: GenericRow, citation: GenericRow): boolean => {
  let parsed: URL; try { parsed = new URL(String(source.stableUrlOrIdentifier)); } catch { return true; }
  if (/\b(search results?|category|index|homepage)\b/i.test(String(source.title))) return true;
  if (/\/(?:category|categories|tags?)(?:\/|$)/i.test(parsed.pathname)) return true;
  if (/\/search\/?$/i.test(parsed.pathname) || (/\/search\//i.test(parsed.pathname) && !/\/search\/[a-z0-9_-]+\/?$/i.test(parsed.pathname))) return true;
  return (parsed.pathname === "/" || parsed.pathname === "") && /^(?:home|homepage|index|root)$/i.test(String(citation.locator).trim());
};

const manifest = JSON.parse(strFromU8(member("manifest.json"))) as GenericRow;
const identities = rows("canonical_breed_identities.jsonl");
const units = rows("research_units.jsonl");
const unitResults = rows("unit_results.jsonl");
const journals = rows("research_journals.jsonl");
const sources = rows("sources.jsonl");
const citations = rows("citations.jsonl");
const evidence = rows("evidence.jsonl");
const edges = rows("inheritance_edges.jsonl");
const profiles = rows("personality/personality_expression_effective_profiles.jsonl");
const effective = rows("effective_breed_semantics.jsonl");
const pets = rows("pet_policy_semantics.jsonl");
const coverage = JSON.parse(strFromU8(member("critical_coverage.json"))) as Record<string, GenericRow>;
const balancePolicy = JSON.parse(strFromU8(member("policies/breed_dimension_balance_policy.json"))) as GenericRow;
const balanceReport = JSON.parse(strFromU8(member("breed_dimension_balance_report.json"))) as GenericRow;
const balanceChanges = rows("breed_dimension_balance_changes.jsonl");
const factionPolicy = JSON.parse(strFromU8(member("policies/breed_faction_projection_policy.json"))) as GenericRow;
const factionReport = JSON.parse(strFromU8(member("breed_faction_projection_report.json"))) as GenericRow;

if (manifest.schemaVersion !== "eidolon-breed-semantics-v4-manifest" || manifest.status !== "SIMULATION_READY" || manifest.semanticAuthorityVersion !== "V4" || manifest.breedDimensionPolicyRef !== BREED_DIMENSION_BALANCE_POLICY || manifest.breedFactionPolicyRef !== BREED_FACTION_PROJECTION_POLICY) add("MANIFEST_AUTHORITY", "Manifest does not declare the balanced, faction-projected V4 simulation-ready authority contract.");
if (balancePolicy.schemaVersion !== "eidolon-breed-dimension-balance-policy-v1" || balancePolicy.policyRef !== BREED_DIMENSION_BALANCE_POLICY || (balancePolicy.target as GenericRow)?.perControlledValue !== 593) add("BALANCE_POLICY", "Breed dimension balance policy is absent, stale, or has the wrong target.");
if (factionPolicy.schemaVersion !== "eidolon-breed-faction-projection-policy-v1" || factionPolicy.policyRef !== BREED_FACTION_PROJECTION_POLICY || factionPolicy.pointsPerAttribute !== 1 || (factionPolicy.dominantFaction as GenericRow)?.tolerance !== 1) add("FACTION_POLICY", "Breed faction projection policy is absent, stale, or malformed.");
if (identities.length !== 2062) add("BREED_COUNT", `Expected 2,062 identities, found ${identities.length}.`);
if (new Set(identities.map((row) => String(row.breedId))).size !== identities.length) add("DUPLICATE_BREED", "Canonical Breed identity is duplicated.");
const civic = identities.filter((row) => row.populationKind !== "PET");
if (civic.length !== 1779 || pets.length !== 283) add("POPULATION_KIND_COUNTS", `Expected 1,779 civic and 283 PET rows; found ${civic.length} and ${pets.length}.`);
for (const [kind, count] of Object.entries({ HUMAN: 631, BEAST: 967, MYTHOS: 181, PET: 283 })) if (identities.filter((row) => row.populationKind === kind).length !== count) add("POPULATION_KIND_COUNT", `${kind} identity count differs from ${count}.`);
if (units.length !== 1225 || unitResults.length !== 1225) add("RESEARCH_UNIT_COUNT", `Expected 1,225 units/results, found ${units.length}/${unitResults.length}.`);
if (evidence.length !== 3675 || citations.length !== 3675 || journals.filter((row) => row.accepted === true).length !== 3675) add("EVIDENCE_CHAIN_COUNT", "Every research unit must have three accepted evidence chains.");
if (effective.length !== 1779 || edges.length !== 1779) add("EFFECTIVE_COVERAGE_COUNT", "Effective civic semantics and inheritance edges must each cover 1,779 Breeds.");
exact("civic breed", civic.map((row) => String(row.breedId)), effective.map((row) => String(row.breedId)));
exact("inheritance breed", civic.map((row) => String(row.breedId)), edges.map((row) => String(row.breedId)));
exact("research unit", units.map((row) => String(row.unitId)), unitResults.map((row) => String(row.researchUnitId)));

const profileIds = new Set(profiles.map((row) => String(row.personalityId)));
const profileById = new Map(profiles.map((row) => [String(row.personalityId), row]));
if (profiles.length !== 369) add("PERSONALITY_PROFILE_COUNT", `Expected 369 effective Personality profiles, found ${profiles.length}.`);
const resultByUnit = new Map(unitResults.map((row) => [String(row.researchUnitId), row]));
const unitById = new Map(units.map((row) => [String(row.unitId), row]));
const sourceById = new Map(sources.map((row) => [String(row.sourceId), row]));
const journalById = new Map(journals.map((row) => [String(row.journalEntryId), row]));
const evidenceById = new Map(evidence.map((row) => [String(row.evidenceId), row]));
const citationById = new Map(citations.map((row) => [String(row.citationId), row]));
for (const row of effective) {
  const breedId = String(row.breedId); const dimensions = row.dimensions as Record<string, GenericRow> | undefined;
  if (!profileIds.has(String(row.personalityId)) || !strings(row.terrainBroad).length || !strings(row.terrainSpecific).length) add("CIVIC_CRITICAL_NULL", "Personality or terrain is absent/invalid.", { breedId });
  for (const field of RAW_DIMENSIONS) {
    const value = dimensions?.[field];
    const personalityValue = value?.disposition === "OWNER_POLICY_VALUE" && value?.policyRef === PERSONALITY_DIMENSION_POLICY;
    const balancedValue = value?.disposition === "OWNER_BALANCED_VALUE" && value?.policyRef === BREED_DIMENSION_BALANCE_POLICY;
    if (!String(value?.value ?? "") || (!personalityValue && !balancedValue)) add("DIMENSION_POLICY_INTEGRITY", `${field} is not a complete owner-policy or owner-balanced value.`, { breedId });
  }
  try {
    const expected = projectBreedFaction(dimensions as unknown as Record<string, { value: string }>, Object.fromEntries(RAW_DIMENSIONS.map((field) => [`${field[0]!.toUpperCase()}${field.slice(1)}`, (balanceReport.byField as Record<string, GenericRow>)?.[field]?.values])) as Record<string, Record<"CONCORD" | "SCHISM" | "RUIN", string>>);
    if (canonicalJson(expected.factionObject) !== canonicalJson(row.factionObject) || canonicalJson(expected.dominantFaction) !== canonicalJson(row.dominantFaction)) add("FACTION_PROJECTION_INTEGRITY", "Persisted factionObject/dominantFaction does not reproduce from all twelve controlled attributes.", { breedId });
  } catch (error) {
    add("FACTION_PROJECTION_INTEGRITY", error instanceof Error ? error.message : String(error), { breedId });
  }
  const unit = unitById.get(String(row.researchUnitId)); const result = resultByUnit.get(String(row.researchUnitId));
  if (!unit || !result || !strings(unit.breedIds).includes(breedId) || result.personalityId !== row.personalityId) add("INHERITANCE_ALIGNMENT", "Effective Breed does not resolve through its exact research unit.", { breedId });
}
for (const row of pets) {
  const breedId = String(row.breedId); const dimensions = row.dimensions as Record<string, GenericRow> | undefined;
  if (row.personalityId !== null || row.personalityDisposition !== "POLICY_NULL" || row.civicSimulation !== false) add("PET_POLICY", "PET Personality/civic policy is not explicit null/excluded.", { breedId });
  for (const field of RAW_DIMENSIONS) if (dimensions?.[field]?.value !== null || dimensions?.[field]?.disposition !== "POLICY_NULL") add("PET_POLICY", `${field} is not explicit POLICY_NULL.`, { breedId });
  if (canonicalJson(row.factionObject) !== canonicalJson({ CONCORD: 0, SCHISM: 0, RUIN: 0 }) || canonicalJson(row.dominantFaction) !== canonicalJson([]) || row.factionDisposition !== "POLICY_NULL" || row.factionPolicyRef !== BREED_FACTION_PROJECTION_POLICY) add("PET_FACTION_POLICY", "PET faction projection is not explicit zero/empty POLICY_NULL.", { breedId });
}
for (const [field, row] of Object.entries(coverage)) if (Number(row.civicResolved) !== 1779 || Number(row.invalidUnresolved) !== 0) add("CRITICAL_COVERAGE", `${field} does not report 1,779/1,779 resolved with zero invalid/unresolved.`);

const reportByField = balanceReport.byField as Record<string, GenericRow> | undefined;
const balanceMapping = Object.fromEntries(RAW_DIMENSIONS.map((field) => {
  const key = `${field[0]!.toUpperCase()}${field.slice(1)}`;
  return [key, reportByField?.[field]?.values];
})) as Record<string, Record<"CONCORD" | "SCHISM" | "RUIN", string>>;
const sourceFromProfiles = effective.map((row) => {
  const profile = profileById.get(String(row.personalityId));
  const dimensions = profile?.dimensions as Record<string, string> | undefined;
  return {
    ...row,
    dimensions: Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, {
      value: String(dimensions?.[field] ?? ""),
      disposition: "OWNER_POLICY_VALUE",
      policyRef: PERSONALITY_DIMENSION_POLICY,
    }])),
  } as unknown as EffectiveBreedSemantics;
});
try {
  const expectedBalance = rebalanceBreedDimensions(sourceFromProfiles, balanceMapping);
  const expectedFactionProjection = applyBreedFactionProjection(expectedBalance.rows, balanceMapping);
  if (canonicalJson(expectedFactionProjection.rows) !== canonicalJson(effective)) add("BALANCE_MATERIALIZATION", "Effective Breed semantics do not exactly reproduce from the Personality profiles, balance policy, and faction projection policy.");
  if (canonicalJson(expectedBalance.report) !== canonicalJson(balanceReport)) add("BALANCE_REPORT", "Recorded Breed balance report does not reproduce exactly.");
  if (canonicalJson(expectedBalance.changes) !== canonicalJson(balanceChanges)) add("BALANCE_CHANGE_AUDIT", "Recorded Breed balance changes do not reproduce exactly.");
  if (canonicalJson(expectedFactionProjection.report) !== canonicalJson(factionReport)) add("FACTION_PROJECTION_REPORT", "Recorded Breed faction projection report does not reproduce exactly.");
  if (expectedBalance.report.targetPerValue !== 593 || Object.values(expectedBalance.report.byField).some((field) => Object.values(field.after).some((count) => count !== 593))) add("BALANCE_DISTRIBUTION", "One or more civic Breed dimensions is not exactly 593/593/593.");
} catch (error) {
  add("BALANCE_REPRODUCTION", error instanceof Error ? error.message : String(error));
}

for (const row of citations) {
  const source = sourceById.get(String(row.sourceId));
  if (!source) { add("BROKEN_SOURCE_REF", `Citation ${String(row.citationId)} has no source.`); continue; }
  if (!String(row.locator ?? "").trim() || !String(row.boundedContext ?? "").trim() || !String(row.sourceFact ?? "").trim()) add("UNBOUNDED_CITATION", `Citation ${String(row.citationId)} is not bounded.`);
  if (isGeneric(source, row)) add("GENERIC_ACTIVE_SOURCE", `Citation ${String(row.citationId)} activates a generic source.`);
}
for (const row of evidence) {
  const unitId = String(row.researchUnitId); const unit = unitById.get(unitId); const journal = journalById.get(String(row.journalEntryId)); const citation = citationById.get(`CIT_${String(row.journalEntryId)}`);
  if (row.generatedBy !== "BATCH_RESEARCH" || row.sourceOpened !== true || !journal || journal.sourceOpened !== true || journal.accepted !== true || !citation) add("UNVERIFIED_EVIDENCE_CHAIN", `Evidence ${String(row.evidenceId)} is not an opened batch-research chain.`, { researchUnitId: unitId });
  if (!unit) { add("UNKNOWN_EVIDENCE_UNIT", `Evidence ${String(row.evidenceId)} targets an unknown unit.`, { researchUnitId: unitId }); continue; }
  const expectedSubject = unit.unitType === "HUMAN_CULTURE" ? "EXACT_CULTURE" : unit.unitType === "MYTHOS_SPECIES" ? "EXACT_TRADITIONAL_ENTITY" : "EXACT_SPECIES";
  const expectedClaim = unit.unitType === "HUMAN_CULTURE" && row.targetField === "personalityId" ? "EIDOLON_AUTHORED_INFERENCE" : "ACCEPTED_DIRECT_EVIDENCE";
  if (citation?.subjectAlignment !== expectedSubject) add("SUBJECT_ALIGNMENT", `Evidence ${String(row.evidenceId)} is not ${expectedSubject}.`, { researchUnitId: unitId });
  if (citation?.claimAlignment !== expectedClaim) add("CLAIM_ALIGNMENT", `Evidence ${String(row.evidenceId)} is not ${expectedClaim}.`, { researchUnitId: unitId });
  if (unit.unitType === "HUMAN_CULTURE" && row.targetField === "personalityId" && (!/authored inference/i.test(String(row.normalizationBridge)) && !/not (?:a |an )?(?:timeless|inherent|ethnic|psychological)|without (?:claiming|treating|asserting)|does not essentialize/i.test(String(row.normalizationBridge)))) add("HUMAN_ESSENTIALISM_GUARD", "Human Personality bridge lacks an explicit bounded authored-inference guard.", { researchUnitId: unitId });
}
for (const row of unitResults) {
  const refs = strings(row.evidenceRefs); if (refs.length !== 3 || new Set(refs).size !== 3 || refs.some((ref) => !evidenceById.has(ref))) add("UNIT_EVIDENCE_REFS", "Unit does not activate exactly three resolving evidence records.", { researchUnitId: String(row.researchUnitId) });
}
for (const row of edges) {
  const unit = unitById.get(String(row.researchUnitId)); const result = resultByUnit.get(String(row.researchUnitId));
  if (!unit || !result || !strings(unit.breedIds).includes(String(row.breedId)) || strings(row.unitEvidenceRefs).sort().join("\0") !== strings(result.evidenceRefs).sort().join("\0")) add("EXACT_INHERITANCE", "Inheritance edge is broadened or loses the unit evidence chain.", { researchUnitId: String(row.researchUnitId), breedId: String(row.breedId) });
}

const auditUnits: GenericRow[] = [];
for (let number = 1; number <= 7; number += 1) {
  const audit = JSON.parse(strFromU8(member(`audits/AUDIT_0${number}/audit_findings.json`))) as GenericRow;
  if (audit.status !== "PASS" || Number((audit.counts as GenericRow).failingUnits) !== 0 || audit.researchArtifactsUnmodified !== true) add("AUDIT_SHARD", `AUDIT_0${number} is not an independent PASS.`);
  auditUnits.push(...(audit.units as GenericRow[]));
}
if (auditUnits.length !== 1225 || auditUnits.some((row) => row.status !== "PASS")) add("AUDIT_UNIT_COVERAGE", "All 1,225 research units must have independent PASS findings.");
exact("audited unit", units.map((row) => String(row.unitId)), auditUnits.map((row) => String(row.researchUnitId)));

const effectiveByBreed = new Map(effective.map((row) => [String(row.breedId), row]));
const petByBreed = new Map(pets.map((row) => [String(row.breedId), row]));
const regressionResults = [
  { caseId: "FLOWERHORN_WORKSHOP", pass: !strings(petByBreed.get("BRD_FLOWERHORN_CICHLID")?.terrainSpecific).includes("WORKSHOP"), detail: "PET Flowerhorn husbandry does not create WORKSHOP civic habitat." },
  { caseId: "IRANIAN_CITY", pass: !strings(effectiveByBreed.get("BRD_HUMAN_IRANIAN")?.terrainSpecific).includes("CITY"), detail: "Iranian CITY is not inferred from non-habitat evidence." },
  { caseId: "MALAYAN_TAPIR_SETTLEMENT", pass: !strings(effectiveByBreed.get("BRD_MALAYAN_TAPIR")?.terrainSpecific).some((token) => token === "CITY" || token === "VILLAGE"), detail: "Tapir settlement proximity is not habitat." },
  { caseId: "AFRICAN_MANATEE_DAMS", pass: !strings(effectiveByBreed.get("BRD_AFRICAN_MANATEE")?.terrainSpecific).some((token) => /DAM/i.test(token)), detail: "Dams are not manatee habitat." },
  { caseId: "AUSTRALIAN_LUNGFISH_PARENTAL_GUARDING", pass: !/PARENT|GUARD/i.test(String(effectiveByBreed.get("BRD_AUSTRALIAN_LUNGFISH")?.personalityId)), detail: "Unsupported parental guarding is not mapped." },
  { caseId: "ALPINE_IBEX_ARBOREAL", pass: !strings(effectiveByBreed.get("BRD_ALPINE_IBEX")?.terrainSpecific).some((token) => /CANOPY|TREE|ARBOR/i.test(token)), detail: "Ibex does not receive arboreal terrain." },
  { caseId: "HUMAN_GENERIC_WOUND_TEMPLATE", pass: !evidence.some((row) => row.targetField === "personalityId" && /^CLT_/.test(String(row.researchUnitId)) && /historical episode at (?:the )?cited locator/i.test(String(row.normalizationBridge))), detail: "Generic Human wound templates are absent." },
  { caseId: "POLICY_NOT_EMPIRICAL_GOVERNMENT", pass: effective.every((row) => RAW_DIMENSIONS.every((field) => ["OWNER_POLICY_VALUE", "OWNER_BALANCED_VALUE"].includes(String((row.dimensions as Record<string, GenericRow>)[field]?.disposition)))), detail: "Animal/Mythos dimensions are explicitly owner-policy results, not empirical government claims." },
];
for (const regression of regressionResults) if (!regression.pass) add(`REGRESSION_${regression.caseId}`, regression.detail);

const verdict = findings.length === 0 ? "ACCEPT_SIMULATION_READY" : "REJECT";
const assessment = {
  schemaVersion: "eidolon-v4-adversarial-acceptance-v1", verdict, safeToImport: verdict === "ACCEPT_SIMULATION_READY", researchCompletionClaimSupported: verdict === "ACCEPT_SIMULATION_READY",
  structuralIntegrityPassed: !findings.some((finding) => /COUNT|EXACT|MANIFEST|REF/.test(finding.code)), semanticEvidenceIntegrityPassed: findings.length === 0,
  archive: { filename, sha256: sha256(readFileSync(filename)), internalChecksumsVerified: true },
  counts: { breeds: identities.length, civicBreeds: civic.length, pets: pets.length, units: units.length, auditedUnits: auditUnits.length, effectiveCivicBreeds: effective.length, evidence: evidence.length, citations: citations.length, sources: sources.length, findings: findings.length },
  regressionResults, findings,
};
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "v4_adversarial_acceptance.json"), `${JSON.stringify(assessment, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "findings.json"), `${JSON.stringify({ verdict, findings }, null, 2)}\n`);
writeFileSync(resolve(outputDirectory, "assessment_report.md"), `# V4 adversarial acceptance\n\nVerdict: **${verdict}**\n\n- Breed identities: ${identities.length}\n- Civic/PET: ${civic.length} / ${pets.length}\n- Audited units: ${auditUnits.length}\n- Active evidence chains: ${evidence.length}\n- Critical findings: ${findings.length}\n- V4 ZIP SHA-256: \`${assessment.archive.sha256}\`\n\n${regressionResults.map((row) => `- ${row.caseId}: ${row.pass ? "PASS" : "FAIL"} — ${row.detail}`).join("\n")}\n`);
process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
if (verdict !== "ACCEPT_SIMULATION_READY") process.exitCode = 1;
