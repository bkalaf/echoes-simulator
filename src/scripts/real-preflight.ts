import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preflightRealBundle } from "../core/inputs/preflight.js";

const pack = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const report = preflightRealBundle(pack);
const outputDirectory = resolve("artifacts/simulator/remediation/REAL_PREFLIGHT");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "real-input-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ structuralStatus: report.structuralStatus, canonicalReady: report.canonicalReady, counts: report.counts, blockers: report.activeIssues.filter((issue) => issue.blocksCanonical).map((issue) => issue.issueCode) }));
