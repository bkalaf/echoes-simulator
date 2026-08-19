import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preflightRealBundle } from "../core/inputs/preflight.js";

const pack = process.argv[2] ? resolve(process.argv[2]) : resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
const starting = process.argv[3] ? resolve(process.argv[3]) : resolve(pack, "echoes_of_eidolon_breed_research_2026-08-17.zip");
const v3 = process.argv[4] ? resolve(process.argv[4]) : resolve("ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip");
const report = preflightRealBundle(pack, starting, v3);
const outputDirectory = resolve("artifacts/simulator/remediation/REAL_PREFLIGHT");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "real-input-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ structuralStatus: report.structuralStatus, canonicalReady: report.canonicalReady, counts: report.counts, blockers: report.activeIssues.filter((issue) => issue.blocksCanonical).map((issue) => issue.issueCode) }));
