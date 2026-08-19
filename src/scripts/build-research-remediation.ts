import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { auditV2LeadArchive } from "../core/research/adversarial-audit.js";
import { buildV3ResearchQueue } from "../core/research/v3-contract.js";

const root = resolve(".");
const pack = resolve(root, "ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const output = resolve(root, "artifacts/simulator/remediation/research");
mkdirSync(output, { recursive: true });

function parseRows(zip: Record<string, Uint8Array>, suffix: string): Record<string, unknown>[] {
  const entry = Object.entries(zip).find(([name]) => name.endsWith(suffix));
  if (!entry) throw new Error(`ZIP is missing ${suffix}`);
  return strFromU8(entry[1]).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const august17 = unzipSync(readFileSync(resolve(pack, "echoes_of_eidolon_breed_research_2026-08-17.zip")));
const startingBreeds = parseRows(august17, "breed_classifications.jsonl");
const queue = buildV3ResearchQueue(startingBreeds as unknown as Parameters<typeof buildV3ResearchQueue>[0]);
writeFileSync(resolve(output, "field_research_queue.jsonl"), `${queue.map((row) => canonicalJson(row)).join("\n")}\n`);

const byKind = Object.fromEntries(["HUMAN", "BEAST", "MYTHOS", "PET"].map((kind) => [kind, startingBreeds.filter((row) => row.populationKind === kind).length]));
const byDisposition = Object.fromEntries(["UNRESOLVED", "POLICY_NULL"].map((disposition) => [disposition, queue.filter((row) => row.disposition === disposition).length]));
writeFileSync(resolve(output, "research_queue_summary.json"), `${JSON.stringify({ schemaVersion: "eidolon-breed-research-queue-v3", sourceRole: "AUGUST_17_STARTING_AUTHORITY", breedCount: startingBreeds.length, populationKinds: byKind, requiredFieldsPerBreed: 18, taskCount: queue.length, dispositions: byDisposition, canonicalReady: false }, null, 2)}\n`);

const v2 = unzipSync(readFileSync(resolve(pack, "INPUTS/echoes_of_eidolon_breed_research_v2_semantic_remediated_2026-08-18(1).zip")));
const census = auditV2LeadArchive({
  breeds: parseRows(v2, "breed_classifications.jsonl"),
  statuses: parseRows(v2, "entity_research_status.jsonl"),
  dimensions: parseRows(v2, "dimension_audit.jsonl"),
  citations: parseRows(v2, "citations.jsonl"),
  traits: parseRows(v2, "trait_research.jsonl"),
  ecology: parseRows(v2, "ecology_audit.jsonl"),
});
writeFileSync(resolve(output, "august18_adversarial_census.json"), `${JSON.stringify(census, null, 2)}\n`);
writeFileSync(resolve(output, "assessment_findings.json"), `${JSON.stringify({ verdict: census.verdict, findings: census.systemicFindings }, null, 2)}\n`);

const failures = census.systemicFindings.filter((finding) => finding.status === "FAIL");
const reopened = census.systemicFindings.filter((finding) => finding.status === "REOPENED");
const report = `# August 18 source-lead adversarial assessment\n\nVerdict: **REJECT** as semantic authority. The archive remains usable only for source discovery and provenance leads.\n\n## Independently reproduced census\n\n- Breed rows: ${census.counts.breeds}\n- Research status: ${JSON.stringify(census.counts.researchStatuses)}\n- Dimension rows: ${census.counts.dimensionRows}; unresolved: ${census.counts.unresolvedDimensionRows}; authored inference: ${census.counts.authoredInferenceDimensionRows}\n- Citations without bounded context: ${census.counts.citationsWithoutBoundedContext}/${census.counts.citations}\n- Trait rows: ${census.counts.traitRows}; distinct texts: ${census.counts.distinctTraitTexts}; suspicious generic rows: ${census.counts.suspiciousGenericTraitRows}\n- Inherited ecology rows requiring re-verification: ${census.counts.inheritedEcologyRows}\n\n## Mandatory regressions\n\n${census.systemicFindings.map((finding) => `- ${finding.status} ${finding.caseId}: ${finding.detail}`).join("\n")}\n\n## Decision\n\n${failures.length} mandatory cases fail and ${reopened.length} remain reopened. No value from this archive is copied into V3 without a fresh, field-specific evidence chain. The fresh queue contains ${queue.length} tasks; ${byDisposition.POLICY_NULL} are owner-policy PET nulls and ${byDisposition.UNRESOLVED} require research.\n`;
writeFileSync(resolve(output, "assessment_report.md"), report);
console.log(JSON.stringify({ output, queue: queue.length, census: census.counts, failedRegressions: failures.length, reopenedRegressions: reopened.length }, null, 2));
