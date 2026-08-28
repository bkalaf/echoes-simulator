import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, diagnosticCandidateOwnerInputsV1 } from "../core/v5/config.js";
import { worldPopulation } from "../core/v5/derivations.js";
import { normalizeSeed } from "../core/v5/random.js";
import { runV5History } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";

const values = process.argv.slice(2, 5).map(Number);
if (values.length !== 3 || values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 20_000) || !(values[0]! < values[1]! && values[1]! < values[2]!)) throw new Error("Usage: pnpm calibrate:v5 LOW_PPM MEDIUM_PPM HIGH_PPM");
const [low, medium, high] = values as [number, number, number];
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
const mechanics = { ...DEFAULT_MECHANICS_VARIABLES_V1, growthRatesPpm: { LOW: low, MEDIUM: medium, HIGH: high } };
const normalizedSeed = normalizeSeed("EIDOLON_V5_GROWTH_CALIBRATION_V1");
const started = performance.now();
const result = runV5History({ canonical, ownerInputs, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed, mode: "DIAGNOSTIC", throughYear: 2000, scheduledTransactions: buildScheduledTransactionsV5(canonical, ownerInputs, normalizedSeed), stopAtBlockingNaming: false, retainHistory: false });
const report = {
  schemaVersion: "echoes-v5-growth-calibration-candidate-v1", seed: "EIDOLON_V5_GROWTH_CALIBRATION_V1", years: 2000, initialPopulationPerWorld: mechanics.initialPopulation.toString(), endingPopulationGoal: DEFAULT_DIAGNOSTIC_CONFIG_V1.endingPopulationGoal.toString(),
  growthRatesPpm: mechanics.growthRatesPpm, growthNonAlignmentDeductionPpm: mechanics.growthNonAlignmentDeductionPpm, elapsedMilliseconds: Math.round(performance.now() - started),
  worlds: Object.fromEntries(Object.entries(result.states).map(([world, state]) => [world, { population: worldPopulation(state).toString(), settlements: state.settlements.length, states: state.states.length, families: state.families.length, politicalPeople: state.politicalPeople.length, organizations: { total: state.organizations.length, corporations: state.organizations.filter((organization) => organization.type === "CORPORATION").length, crimeOrganizations: state.organizations.filter((organization) => organization.type === "CRIME_ORGANIZATION").length }, worldRoutes: state.worldRoutes.length }])), eventCounts: result.eventCounts,
};
const outputDirectory = resolve("artifacts/simulator/v5/calibration"); mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `growth-${low}-${medium}-${high}.json`); writeFileSync(outputPath, `${canonicalJson(report)}\n`); process.stdout.write(`${canonicalJson({ outputPath, ...report })}\n`);
