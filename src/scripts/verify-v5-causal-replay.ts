import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { inspectLegacyV5NamingTrust } from "../persistence/v5-legacy-trust.js";

function argument(name: string): string {
  const value = process.argv.find((candidate) => candidate.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) throw new Error(`Missing ${name}=...`);
  return resolve(value);
}

function causalSummary(filename: string) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const manifestRow = database.prepare("SELECT manifest_json FROM v5_run_manifest ORDER BY run_id LIMIT 1").get() as { manifest_json: string } | undefined;
    if (!manifestRow) throw new Error(`${filename} has no V5 manifest`);
    const parsedManifest = JSON.parse(manifestRow.manifest_json) as { runId: string; causalRunHash: string; targetYear: number; canonicalBundleHash: string; mechanicsVersion: string; causalDerivationVersion: string; normalizedSeed: string };
    const manifest = { runId: parsedManifest.runId, causalRunHash: parsedManifest.causalRunHash, targetYear: parsedManifest.targetYear, canonicalBundleHash: parsedManifest.canonicalBundleHash, mechanicsVersion: parsedManifest.mechanicsVersion, causalDerivationVersion: parsedManifest.causalDerivationVersion, normalizedSeed: parsedManifest.normalizedSeed };
    const eventCounts = Object.fromEntries((database.prepare("SELECT world_key,COUNT(*) count FROM v5_causal_event GROUP BY world_key ORDER BY world_key").all() as { world_key: string; count: number }[]).map((row) => [row.world_key, row.count]));
    const checkpoints = Object.fromEntries((database.prepare(`SELECT checkpoint.world_key,checkpoint.year,checkpoint.state_hash,checkpoint.event_history_hash
      FROM v5_checkpoint checkpoint JOIN (SELECT world_key,MAX(year) year FROM v5_checkpoint GROUP BY world_key) latest
      ON latest.world_key=checkpoint.world_key AND latest.year=checkpoint.year ORDER BY checkpoint.world_key`).all() as { world_key: string; year: number; state_hash: string; event_history_hash: string }[]).map((row) => [row.world_key, { year: row.year, stateHash: row.state_hash, eventHistoryHash: row.event_history_hash }]));
    return { filename, bytes: statSync(filename).size, manifest, eventCounts, checkpoints };
  } finally { database.close(); }
}

const baselinePath = argument("--baseline");
const candidatePath = argument("--candidate");
const legacyBefore = inspectLegacyV5NamingTrust(baselinePath);
const baseline = causalSummary(baselinePath);
const candidate = causalSummary(candidatePath);
const legacyAfter = inspectLegacyV5NamingTrust(baselinePath);
const causalEquivalent = baseline.manifest.causalRunHash === candidate.manifest.causalRunHash
  && canonicalJson(baseline.eventCounts) === canonicalJson(candidate.eventCounts)
  && canonicalJson(baseline.checkpoints) === canonicalJson(candidate.checkpoints);
const legacyUnchanged = legacyBefore.bytesBefore === legacyAfter.bytesAfter && legacyBefore.sha256Before === legacyAfter.sha256After;
const report = {
  schemaVersion: "echoes-v5-causal-replay-verification-v1",
  pass: causalEquivalent && legacyUnchanged,
  causalEquivalent,
  legacyDatabaseByteForByteUnchanged: legacyUnchanged,
  legacyTrustStatus: legacyAfter.trustStatus,
  baseline,
  candidate,
  legacyFingerprint: { bytesBefore: legacyBefore.bytesBefore, bytesAfter: legacyAfter.bytesAfter, sha256Before: legacyBefore.sha256Before, sha256After: legacyAfter.sha256After },
};
const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, "causal-replay-and-legacy-nonmutation.json");
writeFileSync(outputPath, `${canonicalJson(report)}\n`, "utf8");
process.stdout.write(`${canonicalJson({ outputPath, pass: report.pass, causalEquivalent, legacyDatabaseByteForByteUnchanged: legacyUnchanged, legacyTrustStatus: report.legacyTrustStatus, baseline: { bytes: baseline.bytes, manifest: baseline.manifest, eventCounts: baseline.eventCounts, checkpoints: baseline.checkpoints }, candidate: { bytes: candidate.bytes, manifest: candidate.manifest, eventCounts: candidate.eventCounts, checkpoints: candidate.checkpoints }, legacyFingerprint: report.legacyFingerprint })}\n`);
if (!report.pass) process.exitCode = 1;
