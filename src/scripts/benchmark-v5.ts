import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, diagnosticCandidateOwnerInputsV1 } from "../core/v5/config.js";
import { worldPopulation } from "../core/v5/derivations.js";
import { normalizeSeed } from "../core/v5/random.js";
import { auditCausalRegistry, V5_CLOSURE_INVARIANTS } from "../core/v5/registry.js";
import { runV5History } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";

const throughYear = process.argv[2] === undefined ? 2000 : Number(process.argv[2]);
if (!Number.isSafeInteger(throughYear) || throughYear < 0) throw new Error("Usage: pnpm benchmark:v5 [nonnegative-through-year] [seed]");
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
const normalizedSeed = normalizeSeed(process.argv[3] ?? "EIDOLON_V5_BENCHMARK");
const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs, normalizedSeed);
const started = performance.now();
const result = runV5History({
  canonical,
  ownerInputs,
  mechanics: DEFAULT_MECHANICS_VARIABLES_V1,
  operational: DEFAULT_OPERATIONAL_CONFIG_V1,
  diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
  normalizedSeed,
  mode: "DIAGNOSTIC",
  throughYear,
  scheduledTransactions,
  stopAtBlockingNaming: false,
  retainHistory: false,
});
const elapsedMilliseconds = Math.round(performance.now() - started);
const registry = auditCausalRegistry();
if (!registry.pass || !Object.values(V5_CLOSURE_INVARIANTS).every((value) => typeof value !== "boolean" || value)) throw new Error(`V5 causal closure audit failed: ${canonicalJson({ registry, invariants: V5_CLOSURE_INVARIANTS })}`);
if (result.completedYear !== throughYear) throw new Error(`V5 benchmark stopped at ${result.completedYear}`);
const report = {
  schemaVersion: "echoes-v5-benchmark-v1",
  throughYear,
  elapsedMilliseconds,
  benchmarkMaximumMilliseconds: DEFAULT_DIAGNOSTIC_CONFIG_V1.benchmarkMaximumMilliseconds,
  withinConfiguredThreshold: elapsedMilliseconds <= DEFAULT_DIAGNOSTIC_CONFIG_V1.benchmarkMaximumMilliseconds,
  populations: Object.fromEntries(Object.entries(result.states).map(([world, state]) => [world, worldPopulation(state).toString()])),
  eventCounts: result.eventCounts,
  registry,
  invariants: V5_CLOSURE_INVARIANTS,
};
process.stdout.write(`${canonicalJson(report)}\n`);
if (!report.withinConfiguredThreshold) process.exitCode = 1;
