import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { runDiagnosticHistory } from "../core/engine/diagnostic-runner.js";
import { buildExportZip, verifyExportZip } from "../core/export/exporter.js";
import { verifyForConsumer } from "../core/export/consumer-verifier.js";
import { preflightRealBundle } from "../core/inputs/preflight.js";

const packDirectory = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const outputDirectory = resolve("artifacts/implementation/final-verification");
const seed = "EIDOLON_DIAGNOSTIC_2026_08_18_V1";

mkdirSync(outputDirectory, { recursive: true });
const preflight = preflightRealBundle(packDirectory);
const diagnostic = runDiagnosticHistory(seed);
const schemas = Object.fromEntries([
  "export_manifest.schema.json",
  "naming_batch_response.schema.json",
  "naming_response.schema.json",
  "readiness_issue.schema.json",
  "run_manifest.schema.json",
  "simulation_event.schema.json",
].map((filename) => [filename, JSON.parse(readFileSync(resolve("resources/contracts", filename), "utf8"))]));
const inputHashes = Object.fromEntries(preflight.inputFiles.map((file) => [file.filename, file.sha256]));
inputHashes[preflight.sourceRoles.august17StartingAuthority.filename] = preflight.sourceRoles.august17StartingAuthority.sha256;

const exported = buildExportZip({
  ...diagnostic,
  readiness: preflight.activeIssues,
  inputHashes,
  schemas,
  sourceVersions: {
    simulator: "@echoes/simulator@0.1.0",
    ownerPolicy: diagnostic.policyVersion,
    personalitySnapshot: "personality-expression-registry-v3",
  },
});
const exportPath = resolve(outputDirectory, `EIDOLON_SIMULATION_${diagnostic.runId}.zip`);
writeFileSync(exportPath, exported.bytes);
const verified = verifyExportZip(readFileSync(exportPath));
const consumer = verifyForConsumer(readFileSync(exportPath));
const manifest = {
  schemaVersion: "eidolon-simulator-diagnostic-run-manifest-v1",
  runId: diagnostic.runId,
  mode: diagnostic.mode,
  seed,
  finalYear: diagnostic.finalYear,
  djtYear: diagnostic.djtYear,
  checkpointCount: diagnostic.checkpointCount,
  namingJobCount: diagnostic.namingJobCount,
  contentDigest: diagnostic.contentDigest,
  exportFilename: basename(exportPath),
  exportSha256: exported.sha256,
  exportContentDigest: exported.contentDigest,
  worldSummary: Object.fromEntries(Object.entries(diagnostic.worlds).map(([world, data]) => [world, { finalPopulation: data.finalPopulation, settlements: data.settlements.length, states: data.stateCount, events: data.events.length, federalCapitalSiteId: data.federalCapitalSiteId }])),
  audit: diagnostic.audit,
  canonicalReady: preflight.canonicalReady,
  activeIssues: preflight.activeIssues,
};
writeFileSync(resolve(outputDirectory, "diagnostic-run-manifest.json"), `${canonicalJson(manifest)}\n`);
writeFileSync(resolve(outputDirectory, "real-input-preflight.json"), `${canonicalJson(preflight)}\n`);
writeFileSync(resolve(outputDirectory, "export-validation.json"), `${canonicalJson({ valid: verified.valid, exportSha256: exported.sha256, contentDigest: exported.contentDigest, checkedFiles: verified.files.length, consumer: { runId: consumer.runId, mode: consumer.mode, populationEncoding: consumer.populationEncoding, worldTotals: consumer.worldTotals, idempotencyKeyCount: consumer.idempotencyKeys.length } })}\n`);
writeFileSync(resolve(outputDirectory, "diagnostic-run-summary.md"), `# Diagnostic run summary\n\n- Run: ${diagnostic.runId}\n- Mode: DIAGNOSTIC\n- Seed: ${seed}\n- Final year: ${diagnostic.finalYear}\n- Worlds: CONCORD, SCHISM, RUIN\n- Checkpoints: ${diagnostic.checkpointCount}\n- Naming jobs: ${diagnostic.namingJobCount}\n- DJT resolved year: ${diagnostic.djtYear}\n- Conservation failures: ${diagnostic.audit.conservationFailures}\n- Social conservation failures: ${diagnostic.audit.socialConservationFailures}\n- Negative population observations: ${diagnostic.audit.negativePopulationCount}\n- Canonical ready: no\n- Active canonical blockers: ${preflight.activeIssues.filter((issue) => issue.blocksCanonical).map((issue) => issue.issueCode).join(", ")}\n- Export: ${basename(exportPath)}\n- Export SHA-256: ${exported.sha256}\n`);

process.stdout.write(`${canonicalJson({ exportPath, exportSha256: exported.sha256, checkedFiles: verified.files.length, manifest })}\n`);
