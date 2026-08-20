import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  auditV4Shard,
  type AuditBatchArtifacts,
  type AuditShardManifest,
  type IndependentAuditResult,
} from "../core/research/v4-audit.js";
import type { BatchDecision, BatchJournalRow, BatchManifest } from "../core/research/v4-batch.js";
import type { EffectiveBreedSemantics, V4Citation, V4InheritanceEdge, V4ResearchEvidence, V4Source, V4UnitResult } from "../core/research/v4-contract.js";

const root = resolve(".");
const promptPack = resolve(root, "ECHOES_OF_EIDOLON_RESEARCH_V4_CODEX_PROMPT_PACK_2026-08-19");
const batchesRoot = resolve(root, "artifacts/research-v4/batches");
const auditRoot = resolve(root, "artifacts/research-v4/audits");
const architecturePath = resolve(root, "artifacts/simulator/v4/ARCHITECTURE_LOCK.json");
const requested = process.argv[2] ?? "all";
const AUDIT_ORDER = ["AUDIT_01", "AUDIT_02", "AUDIT_03", "AUDIT_04", "AUDIT_05", "AUDIT_06", "AUDIT_07"] as const;

function readJsonLines<T>(filename: string): T[] {
  const text = readFileSync(filename, "utf8").trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line) as T) : [];
}

function researchDigest(): string {
  const hash = createHash("sha256");
  for (const batchId of readdirSync(batchesRoot).sort()) {
    const directory = resolve(batchesRoot, batchId);
    if (!statSync(directory).isDirectory()) continue;
    for (const filename of readdirSync(directory).sort()) {
      hash.update(`${batchId}/${filename}\0`);
      hash.update(readFileSync(resolve(directory, filename)));
    }
  }
  return hash.digest("hex");
}

function loadBatches(): AuditBatchArtifacts[] {
  return readdirSync(batchesRoot).sort().filter((batchId) => /^R\d{2}_B\d{2}$/.test(batchId)).map((batchId) => {
    const directory = resolve(batchesRoot, batchId);
    const manifest = JSON.parse(readFileSync(resolve(promptPack, "units", `${batchId}.json`), "utf8")) as BatchManifest;
    return {
      batchId, manifestUnits: manifest.units,
      journals: readJsonLines<BatchJournalRow>(resolve(directory, "research_journal.jsonl")),
      decisions: readJsonLines<BatchDecision>(resolve(directory, "research_decisions.jsonl")),
      unitResults: readJsonLines<V4UnitResult>(resolve(directory, "unit_results.jsonl")),
      sources: readJsonLines<V4Source>(resolve(directory, "sources.jsonl")),
      citations: readJsonLines<V4Citation>(resolve(directory, "citations.jsonl")),
      evidence: readJsonLines<V4ResearchEvidence>(resolve(directory, "evidence.jsonl")),
      inheritanceEdges: readJsonLines<V4InheritanceEdge>(resolve(directory, "inheritance_edges.jsonl")),
      effectiveBreeds: readJsonLines<EffectiveBreedSemantics>(resolve(directory, "effective_breed_preview.jsonl")),
    };
  });
}

function reportMarkdown(result: IndependentAuditResult, beforeHash: string): string {
  const failures = result.units.filter((unit) => unit.status !== "PASS");
  const rows = failures.length
    ? failures.map((unit) => `| ${unit.researchUnitId} | ${unit.batchId ?? "—"} | ${unit.status} | ${[...unit.messages, ...unit.fields.flatMap((field) => field.messages), ...unit.inheritance.messages].join(" ").replaceAll("|", "\\|")} |`).join("\n")
    : "| — | — | — | No findings. Every assigned unit passed. |";
  return `# ${result.auditId} Independent V4 Audit\n\n` +
    `- Verdict: **${result.status}**\n` +
    `- Assigned/audited units: ${result.counts.manifestUnits} / ${result.counts.auditedUnits}\n` +
    `- Passing/failing units: ${result.counts.passingUnits} / ${result.counts.failingUnits}\n` +
    `- Passing evidence chains: ${result.counts.passingEvidenceChains} / ${result.counts.evidenceChains}\n` +
    `- Exact inherited Breeds inspected: ${result.counts.inheritedBreeds}\n` +
    `- Batch-artifact SHA-256 before and after audit: \`${beforeHash}\`\n` +
    `- Research artifacts modified by audit: **NO**\n\n` +
    `The audit independently reopened the persisted source transcript for every active critical evidence chain and checked opened-source provenance, bounded locator/context, exact subject and claim classification, Personality inference normalization, controlled terrain normalization, and exact Breed inheritance.\n\n` +
    `## Findings\n\n| Unit | Batch | Status | Detail |\n|---|---|---|---|\n${rows}\n`;
}

if (requested !== "all" && !AUDIT_ORDER.includes(requested as typeof AUDIT_ORDER[number])) throw new Error(`Expected one of ${AUDIT_ORDER.join(", ")} or all`);
const auditIds = requested === "all" ? [...AUDIT_ORDER] : [requested as typeof AUDIT_ORDER[number]];
const architecture = JSON.parse(readFileSync(architecturePath, "utf8")) as Record<string, unknown> & { completedRegionBatches: string[]; completedAuditShards: string[] };
if (architecture.completedRegionBatches.length !== 29) throw new Error("All 29 Region batches must be complete before independent audit");
const completed = architecture.completedAuditShards ?? [];
if (completed.join("\0") !== AUDIT_ORDER.slice(0, completed.length).join("\0")) throw new Error("Completed audit shards violate the locked run order");
const profiles = readJsonLines<{ personalityId: string }>(resolve(root, "resources/research-v4/personality/personality_expression_effective_profiles_v1.jsonl"));
const personalityIds = new Set(profiles.map((row) => row.personalityId));
const batches = loadBatches();
const beforeHash = researchDigest();
const generatedAt = new Date().toISOString();
const results: IndependentAuditResult[] = [];

for (const auditId of auditIds) {
  if (!completed.includes(auditId) && AUDIT_ORDER[completed.length] !== auditId) throw new Error(`Run-order violation: expected ${AUDIT_ORDER[completed.length]}, received ${auditId}`);
  const shard = JSON.parse(readFileSync(resolve(promptPack, "units", `${auditId}.json`), "utf8")) as AuditShardManifest;
  const result = auditV4Shard({ shard, batches, personalityIds, generatedAt, researchArtifactsUnmodified: true });
  const afterHash = researchDigest();
  if (afterHash !== beforeHash) throw new Error(`Audit mutated Region research artifacts: ${beforeHash} != ${afterHash}`);
  const directory = resolve(auditRoot, auditId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "audit_findings.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(directory, "audit_report.md"), reportMarkdown(result, beforeHash));
  if (result.status !== "PASS") {
    process.stdout.write(`${JSON.stringify({ auditId, status: result.status, counts: result.counts, output: basename(directory) }, null, 2)}\n`);
    process.exitCode = 1;
    break;
  }
  if (!completed.includes(auditId)) completed.push(auditId);
  results.push(result);
}

architecture.completedAuditShards = completed;
writeFileSync(architecturePath, `${JSON.stringify(architecture, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: process.exitCode ? "FAIL" : "PASS", researchArtifactSha256: beforeHash, audits: results.map((result) => ({ auditId: result.auditId, status: result.status, counts: result.counts })) }, null, 2)}\n`);
