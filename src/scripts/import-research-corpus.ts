import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { strFromU8 } from "fflate";
import { openValidatedZip, parseJsonLines } from "../core/inputs/importer.js";
import { openResearchCorpusArchive, type CorpusArchiveInventory } from "../core/research/corpus-archive.js";
import { importSubmittedResearchCorpus, RESEARCH_RECORD_TYPES, type CanonicalChangeAuditRow, type CorpusImportResult, type ImportLedgerRow, type ResearchRecordType } from "../core/research/corpus-import.js";

const root = resolve(".");
const source = resolve(process.argv[2] ?? "artifacts/research-corpus-remediation/EIDOLON_CHAT_CLASSIFICATION_ALL_RESPONSES_0001-6039_REMEDIATED_2026-08-26.zip");
const output = resolve(root, process.argv[3] ?? "resources/canonical/research-corpus");
const canonicalDirectory = resolve(root, "resources/canonical");
const stage = resolve(canonicalDirectory, ".research-corpus-stage");
const backup = resolve(canonicalDirectory, ".research-corpus-backup");
const importedAt = new Date().toISOString();
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows: readonly unknown[]): string => rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
function files(directory: string): string[] { return readdirSync(directory).flatMap((name) => { const path = resolve(directory, name); return statSync(path).isDirectory() ? files(path) : [path]; }).sort(); }

function loadBaseline(): { baseline: Map<string, Record<string, unknown>>; externalIds: Set<string> } {
  const manifest = JSON.parse(readFileSync(resolve(canonicalDirectory, "canonical_bundle_manifest.json"), "utf8")) as { breedSemanticFilename: string };
  const zip = openValidatedZip(resolve(canonicalDirectory, "breeds", manifest.breedSemanticFilename));
  const member = (name: string): Uint8Array => { const found = Object.entries(zip.entries).find(([key]) => key.endsWith(`/${name}`)); if (!found) throw new Error(`Canonical Breed authority lacks ${name}`); return found[1]; };
  const identities = parseJsonLines(member("canonical_breed_identities.jsonl"));
  const effective = parseJsonLines(member("effective_breed_semantics.jsonl"));
  const pets = parseJsonLines(member("pet_policy_semantics.jsonl"));
  const baseline = new Map(identities.map((row) => [String(row.breedId), structuredClone(row)]));
  for (const row of [...effective, ...pets]) {
    const id = String(row.breedId); const current = baseline.get(id) ?? { breedId: id };
    const dimensions = row.dimensions && typeof row.dimensions === "object" ? Object.fromEntries(Object.entries(row.dimensions as Record<string, unknown>).map(([field, value]) => [field, value && typeof value === "object" ? (value as Record<string, unknown>).value : null])) : {};
    baseline.set(id, { ...current, presentation: { accent: current.accent ?? null, appearance: current.appearance ?? null, clothing: current.clothing ?? null, architecture: current.architecture ?? null }, personalityId: row.personalityId ?? null, terrainBroad: row.terrainBroad ?? [], terrainSpecific: row.terrainSpecific ?? [], derived: dimensions });
  }
  return { baseline, externalIds: new Set(baseline.keys()) };
}

function previousLedger(): ImportLedgerRow[] {
  const filename = resolve(output, "IMPORT_LEDGER.jsonl");
  if (!existsSync(filename)) return [];
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ImportLedgerRow);
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right))); }
function typeSummary(result: CorpusImportResult, type: ResearchRecordType): Record<string, number> {
  const rows = result.ledger.filter((row) => row.recordType === type); const blockers = result.findings.filter((finding) => finding.recordType === type && finding.severity === "BLOCKER");
  return { submitted: rows.length, passReviewed: rows.filter((row) => row.reviewVerdict === "PASS").length, materialized: rows.filter((row) => row.canonicalMaterialized).length, materializedWithWarnings: rows.filter((row) => row.importDisposition === "IMPORTED_WITH_WARNINGS").length, deferred: rows.filter((row) => row.importDisposition === "DEFERRED_RELATIONSHIP").length, quarantined: rows.filter((row) => row.importDisposition.startsWith("QUARANTINED")).length, blockerFindings: blockers.length };
}
function report(result: CorpusImportResult, inventory: CorpusArchiveInventory, expectedRecordCount: number, fieldChangeCounts: Record<string, number>, rowChangeCounts: Record<string, number>): string {
  const grouped = Object.entries(countBy(result.findings.map((finding) => finding.code))).sort(([, left], [, right]) => right - left);
  const highPriority = result.findings.filter((finding) => finding.severity === "BLOCKER").slice(0, 250);
  const typeRows = RESEARCH_RECORD_TYPES.map((type) => { const summary = typeSummary(result, type); return `| ${type} | ${summary.submitted} | ${summary.passReviewed} | ${summary.materialized} | ${summary.materializedWithWarnings} | ${summary.deferred} | ${summary.quarantined} | ${summary.blockerFindings} |`; }).join("\n");
  const actions = highPriority.length ? highPriority.map((finding) => `| ${finding.recordType} | ${finding.recordId} | ${finding.recordName ?? ""} | ${finding.field ?? ""} | ${finding.code} | ${finding.recommendedAction.replaceAll("|", "\\|")} |`).join("\n") : "| — | — | — | — | — | No owner action required. |";
  const blockerSummary = result.severityCounts.BLOCKER === 0
    ? "The process completed with no record-level blockers."
    : "The process completed successfully despite record-level blockers.";
  return `# Echoes of Eidolon research corpus import report\n\n## Executive summary\n\n- Overall import status: **${result.overallStatus}**\n- Expected records: ${expectedRecordCount.toLocaleString("en-US")}\n- Observed records: ${result.ledger.length}\n- Ledger records: ${result.ledger.length}\n- Canonical materialized: ${result.canonicalMaterialized}\n- Imported with warnings: ${result.importedWithWarnings}\n- Deferred relationships: ${result.deferredRelationships}\n- Quarantined: ${result.quarantined}\n- Blocker findings: ${result.severityCounts.BLOCKER}\n- Warning findings: ${result.severityCounts.WARNING}\n- Info findings: ${result.severityCounts.INFO}\n\n${blockerSummary} Raw semantic, review, evidence, and source payloads are retained in \`IMPORT_LEDGER.jsonl\`; no submitted semantic file was dropped.\n\n## Source package reconciliation\n\n- Source package: ${inventory.sourcePackage}\n- Source SHA-256: \`${inventory.sourcePackageSha256}\`\n- Semantic files: ${inventory.artifactCounts.semantic}\n- Review files: ${inventory.artifactCounts.review}\n- Evidence files: ${inventory.artifactCounts.evidence}\n- Source files: ${inventory.artifactCounts.source}\n- Ordinal coverage: ${inventory.ordinalCoverageStart ?? "—"}–${inventory.ordinalCoverageEnd ?? "—"}\n- Missing ordinals: ${inventory.missingOrdinals.length ? inventory.missingOrdinals.join(", ") : "none"}\n- Duplicate ordinals: ${inventory.duplicateOrdinals.length ? inventory.duplicateOrdinals.join(", ") : "none"}\n- Duplicate record IDs: ${inventory.duplicateRecordIds.length ? inventory.duplicateRecordIds.join(", ") : "none"}\n- Duplicate payload groups: ${inventory.duplicatePayloads.length}\n- Multiple final candidates: ${inventory.multipleFinalCandidates.length}\n- Missing semantic outputs: ${inventory.missingSemanticOutputs.length}\n- Missing reviews: ${inventory.missingReviews.length}\n- Multiple reviews: ${inventory.multipleReviews.length}\n\nThe complete filename inventory and discrepancy arrays are in \`SOURCE_PACKAGE_INVENTORY.json\`.\n\n## Counts by type\n\n| Type | Submitted | PASS-reviewed | Materialized | Materialized with warnings | Deferred | Quarantined | Blocker findings |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${typeRows}\n\n## Findings grouped by code\n\n${grouped.map(([code, count]) => `- ${code} — ${count}`).join("\n") || "- None"}\n\n## Highest-priority owner actions\n\nThe table shows the first ${highPriority.length} blocker findings in deterministic record/validation order. Every blocker, including exact submitted/canonical values, is present in \`IMPORT_FINDINGS.json\`.\n\n| Type | Record ID | Name | Field | Code | Recommended action |\n|---|---|---|---|---|---|\n${actions}\n\n## Canonical change audit\n\nChanged canonical entity rows by record type: ${JSON.stringify(rowChangeCounts)}. Changed canonical field rows by record type: ${JSON.stringify(fieldChangeCounts)}. Exact before/after values are in \`CANONICAL_CHANGE_AUDIT.jsonl\`. Existing canonical identity/lifecycle values were retained on conflict, and unchanged fields are omitted.\n\n## Application/schema changes\n\n- Database migrations: none; this standalone application has no relational worldbuilding entity database.\n- Schema migration: added versioned \`eidolon-research-corpus-import-v1\` ledger/findings contract and bundled canonical research layer.\n- Domain types: added \`text\`, six 0–4 primitive scores, \`Aggressive\`, \`SocialEffort\`, \`IntellectualEffort\`, five research entity types, dispositions, findings, reconciliation, and change-audit types.\n- Existing V4 Breed identity and Personality values are used as the before-state and preserved where submitted research is missing or conflicting.\n\n## Verification policy\n\nSemantic findings produce \`COMPLETED_WITH_WARNINGS\` or \`COMPLETED_WITH_BLOCKERS\` with process exit 0. Only unreadable ZIP/checksum/disk/execution failures abort.\n`;
}

function updateCanonicalManifest(result: CorpusImportResult, corpusVersion: string, sourcePackageSha256: string): void {
  const manifestPath = resolve(canonicalDirectory, "canonical_bundle_manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const breedSemanticFilename = String(manifest.breedSemanticFilename);
  const breedSemanticSha256 = sha256(readFileSync(resolve(canonicalDirectory, "breeds", breedSemanticFilename)));
  const excluded = new Set([manifestPath, resolve(canonicalDirectory, "integrity/checksums.sha256")]);
  const canonicalFiles = files(canonicalDirectory).filter((path) => !relative(canonicalDirectory, path).replaceAll("\\", "/").startsWith(".research-corpus-"));
  const requiredFiles = Object.fromEntries(canonicalFiles.filter((path) => !excluded.has(path)).map((path) => [relative(canonicalDirectory, path).replaceAll("\\", "/"), sha256(readFileSync(path))]));
  Object.assign(manifest, {
    breedSemanticSha256,
    researchCorpusImportVersion: corpusVersion,
    researchCorpusImportStatus: result.overallStatus,
    researchCorpusSourcePackage: basename(source),
    researchCorpusSourcePackageSha256: sourcePackageSha256,
    researchCorpusManifest: "research-corpus/IMPORT_MANIFEST.json",
    requiredFiles,
    contentSha256: sha256(`${Object.entries(requiredFiles).map(([name, hash]) => `${hash}  ${name}`).join("\n")}\n`),
  });
  writeFileSync(manifestPath, json(manifest));
  const checksumPath = resolve(canonicalDirectory, "integrity/checksums.sha256");
  const checksums = canonicalFiles.filter((path) => path !== checksumPath).map((path) => `${sha256(readFileSync(path))}  ${relative(canonicalDirectory, path).replaceAll("\\", "/")}`).join("\n");
  writeFileSync(checksumPath, `${checksums}\n`);
}

if (!existsSync(source)) throw new Error(`Source package not found: ${source}`);
const opened = openResearchCorpusArchive(source);
const manifestCounts = opened.masterManifest?.expectedRecordCounts;
const EXPECTED_COUNTS: Record<ResearchRecordType, number> = Object.fromEntries(RESEARCH_RECORD_TYPES.map((type) => [type, manifestCounts && typeof manifestCounts === "object" && Number.isInteger((manifestCounts as Record<string, unknown>)[type]) ? Number((manifestCounts as Record<string, unknown>)[type]) : opened.inventory.observedRecordCounts[type]])) as Record<ResearchRecordType, number>;
const expectedRecordCount = Object.values(EXPECTED_COUNTS).reduce((sum, count) => sum + count, 0);
const expectedOrdinalEnd = opened.inventory.ordinalCoverageEnd ?? expectedRecordCount;
const { baseline, externalIds } = loadBaseline();
const personalityRows = JSON.parse(readFileSync(resolve(root, "resources/personality/personality-expression-registry-v3.json"), "utf8")) as { personalityId: string }[];
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
const corpusVersion = `EIDOLON_CHAT_CLASSIFICATION_0001_${String(expectedOrdinalEnd).padStart(4, "0")}_${opened.inventory.sourcePackageSha256.slice(0, 16).toUpperCase()}`;
const previous = previousLedger();
const previousAuditPath = resolve(output, "CANONICAL_CHANGE_AUDIT.jsonl");
const previousAudit = existsSync(previousAuditPath) ? readFileSync(previousAuditPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as CanonicalChangeAuditRow) : [];
const result = importSubmittedResearchCorpus(opened.records, {
  corpusVersion, sourcePackage: opened.inventory.sourcePackage, sourcePackageSha256: opened.inventory.sourcePackageSha256, importedAt,
  applicationVersion: packageJson.version, schemaVersion: "eidolon-research-corpus-import-v1", expectedRecordCounts: EXPECTED_COUNTS,
  expectedOrdinalStart: 1, expectedOrdinalEnd, externalDependencyIds: externalIds, personalityIds: new Set(personalityRows.map((row) => row.personalityId)), baselineCanonicalById: baseline, previousLedger: previous,
});

const previousHistoryPath = resolve(output, "IMPORT_HISTORY.jsonl");
const previousHistory = existsSync(previousHistoryPath) ? readFileSync(previousHistoryPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown) : [];
const cumulativeAudit = [...previousAudit, ...result.changeAudit];
const fieldChangeCounts = Object.fromEntries(RESEARCH_RECORD_TYPES.map((type) => [type, cumulativeAudit.filter((row) => row.recordType === type).length]));
const rowChangeCounts = Object.fromEntries(RESEARCH_RECORD_TYPES.map((type) => [type, new Set(cumulativeAudit.filter((row) => row.recordType === type).map((row) => row.recordId)).size]));
const history = [...previousHistory, { importedAt, corpusVersion, sourcePackageSha256: opened.inventory.sourcePackageSha256, overallStatus: result.overallStatus, ledgerRecordCount: result.ledger.length, canonicalMaterialized: result.canonicalMaterialized, severityCounts: result.severityCounts, dispositions: countBy(result.ledger.map((row) => row.importDisposition)), idempotencyStatuses: countBy(result.ledger.map((row) => row.idempotencyStatus)) }];

rmSync(stage, { recursive: true, force: true }); rmSync(backup, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
writeFileSync(resolve(stage, "IMPORT_LEDGER.jsonl"), jsonl(result.ledger));
writeFileSync(resolve(stage, "IMPORT_RECONCILIATION.jsonl"), jsonl(result.reconciliation));
writeFileSync(resolve(stage, "CANONICAL_CHANGE_AUDIT.jsonl"), jsonl(cumulativeAudit));
writeFileSync(resolve(stage, "IMPORT_HISTORY.jsonl"), jsonl(history));
writeFileSync(resolve(stage, "SOURCE_PACKAGE_INVENTORY.json"), json({ schemaVersion: "eidolon-research-corpus-source-inventory-v1", ...opened.inventory, masterManifest: opened.masterManifest }));
writeFileSync(resolve(stage, "IMPORT_FINDINGS.json"), json({ schemaVersion: "eidolon-research-corpus-import-findings-v1", overallStatus: result.overallStatus, expectedRecordCount, observedRecordCount: result.ledger.length, ledgerRecordCount: result.ledger.length, summary: result.severityCounts, findings: result.findings }));
writeFileSync(resolve(stage, "IMPORT_REPORT.md"), report(result, opened.inventory, expectedRecordCount, fieldChangeCounts, rowChangeCounts));
mkdirSync(resolve(stage, "source"), { recursive: true });
copyFileSync(source, resolve(stage, "source", basename(source)));
const artifactHashes = Object.fromEntries(files(stage).map((path) => [relative(stage, path).replaceAll("\\", "/"), sha256(readFileSync(path))]));
const manifest = {
  schemaVersion: "eidolon-research-corpus-import-manifest-v1", corpusVersion, sourcePackage: opened.inventory.sourcePackage, sourcePackageSha256: opened.inventory.sourcePackageSha256,
  expectedRecordCounts: EXPECTED_COUNTS, observedRecordCounts: result.observedRecordCounts, expectedRecordCount, observedRecordCount: result.ledger.length, ledgerRecordCount: result.ledger.length,
  importTimestamp: importedAt, applicationVersion: packageJson.version, applicationSchemaVersion: "eidolon-research-corpus-import-v1", overallImportStatus: result.overallStatus,
  ordinalCoverageStart: opened.inventory.ordinalCoverageStart, ordinalCoverageEnd: opened.inventory.ordinalCoverageEnd, missingOrdinals: opened.inventory.missingOrdinals, duplicateOrdinals: opened.inventory.duplicateOrdinals,
  duplicateRecordIds: opened.inventory.duplicateRecordIds, duplicatePayloads: opened.inventory.duplicatePayloads, multipleFinalCandidates: opened.inventory.multipleFinalCandidates,
  reviewCounts: countBy(result.ledger.map((row) => row.reviewVerdict)), dispositionCounts: countBy(result.ledger.map((row) => row.importDisposition)), severityCounts: result.severityCounts,
  canonicalMaterialized: result.canonicalMaterialized, canonicalTableRowChangeCounts: rowChangeCounts, canonicalFieldChangeCounts: fieldChangeCounts, currentRunCanonicalFieldChanges: result.changeAudit.length, databaseMigrations: [], schemaMigrations: ["eidolon-research-corpus-import-v1 bundled JSONL research layer"],
  domainTypeChanges: ["text on Taxonomy, Species, Culture, Species Group, and Breed research records", "BehaviorScore and six primitive behavior fields", "Aggressive", "SocialEffort", "IntellectualEffort", "ledger/disposition/finding/reconciliation/change-audit contracts"],
  artifactHashes,
};
writeFileSync(resolve(stage, "IMPORT_MANIFEST.json"), json(manifest));
const stageChecksums = files(stage).map((path) => `${sha256(readFileSync(path))}  ${relative(stage, path).replaceAll("\\", "/")}`).join("\n");
writeFileSync(resolve(stage, "checksums.sha256"), `${stageChecksums}\n`);

const priorCanonicalManifest = readFileSync(resolve(canonicalDirectory, "canonical_bundle_manifest.json"));
const priorCanonicalChecksums = readFileSync(resolve(canonicalDirectory, "integrity/checksums.sha256"));
try {
  if (existsSync(output)) renameSync(output, backup);
  renameSync(stage, output);
  updateCanonicalManifest(result, corpusVersion, opened.inventory.sourcePackageSha256);
  rmSync(backup, { recursive: true, force: true });
} catch (error) {
  writeFileSync(resolve(canonicalDirectory, "canonical_bundle_manifest.json"), priorCanonicalManifest);
  writeFileSync(resolve(canonicalDirectory, "integrity/checksums.sha256"), priorCanonicalChecksums);
  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, output);
  throw error;
}

process.stdout.write(json({ message: "Import completed.", expectedRecords: expectedRecordCount, observedRecords: result.ledger.length, accountedForInImportLedger: result.ledger.length, canonicalMaterialized: result.canonicalMaterialized, importedWithWarnings: result.importedWithWarnings, deferred: result.deferredRelationships, quarantined: result.quarantined, findings: result.severityCounts, overallStatus: result.overallStatus, output }));
