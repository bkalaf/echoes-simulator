import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import {
  DEFAULT_DIAGNOSTIC_CONFIG_V1,
  DEFAULT_MECHANICS_VARIABLES_V1,
  DEFAULT_OPERATIONAL_CONFIG_V1,
  V5_CAUSAL_DERIVATION_VERSION,
  V5_MECHANICS_VERSION,
  V5_SCHEDULER_VERSION,
  diagnosticCandidateOwnerInputsV1,
  type MechanicsVariablesV1,
} from "../core/v5/config.js";
import { validateMechanicsVariablesV1 } from "../core/v5/configuration.js";
import { deriveMetrics } from "../core/v5/derivations.js";
import { breedFactionVector } from "../core/v5/faction.js";
import { clamp, divideRoundedAway } from "../core/v5/fixed-point.js";
import { desiredMigrationOutflow, migrationPush } from "../core/v5/migration.js";
import { normalizeSeed } from "../core/v5/random.js";
import { runV5History, type V5AtomicYearSnapshot } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";
import type { CausalEventV5, FactionVector, WorldKey } from "../core/v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const OWNER_SEED = normalizeSeed(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "EIDOLON_V5_DIAGNOSTIC_1787843667789");
const OUTPUT_DIRECTORY = resolve("artifacts/simulator/v5/remediation");
const OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, "migration-one-field-lattice.json");

interface OneFieldCandidate {
  candidateId: string;
  field: "BASELINE" | "migrationReviewIntervalYears" | "migrationPushThreshold" | "migrationMaximumOutflowBps" | "migrationMaximumHops" | "migrationDestinationMinimumAttractiveness" | "migrationPushWeights" | "migrationAttractivenessWeights";
  changedFields: 0 | 1;
  latticeDistance: number;
  description: string;
  mechanics: MechanicsVariablesV1;
}

interface ScreenResult {
  reviewedCellsThrough100: number;
  desiredPositiveCellsThrough100: number;
  desiredPopulationThrough100: bigint;
  firstPositiveYear: number | null;
  worldsWithPositiveDesiredThrough100: Set<WorldKey>;
}

interface WorldRunEvidence {
  transfersThrough100: number;
  transferPopulationThrough100: bigint;
  originDestinationPairsThrough100: Set<string>;
  transfersYears101To200: number;
  transferPopulationYears101To200: bigint;
  safetyChecks: number;
  safetyViolations: number;
}

function baselineMechanics(): MechanicsVariablesV1 {
  return { ...structuredClone(DEFAULT_MECHANICS_VARIABLES_V1), migrationPushThreshold: 300 };
}

function shiftedWeights(source: Record<string, number>, donor: string, recipient: string, amount: number): Record<string, number> {
  const next: Record<string, number> = { ...source };
  next[donor] = next[donor]! - amount;
  next[recipient] = next[recipient]! + amount;
  return next;
}

function candidates(): OneFieldCandidate[] {
  const base = baselineMechanics();
  const rows: OneFieldCandidate[] = [{ candidateId: "BASELINE", field: "BASELINE", changedFields: 0, latticeDistance: 0, description: "unchanged pre-calibration baseline", mechanics: base }];
  const addScalar = <K extends keyof MechanicsVariablesV1>(field: OneFieldCandidate["field"], key: K, values: readonly MechanicsVariablesV1[K][]): void => {
    values.forEach((value, index) => rows.push({ candidateId: `${String(key)}=${String(value)}`, field, changedFields: 1, latticeDistance: index + 1, description: `${String(key)} ${String(base[key])} -> ${String(value)}`, mechanics: { ...structuredClone(base), [key]: value } }));
  };
  addScalar("migrationReviewIntervalYears", "migrationReviewIntervalYears", [4, 3, 2, 1]);
  addScalar("migrationPushThreshold", "migrationPushThreshold", [285, 275, 250, 225, 200]);
  addScalar("migrationMaximumOutflowBps", "migrationMaximumOutflowBps", [625, 750, 1000]);
  addScalar("migrationMaximumHops", "migrationMaximumHops", [4, 5]);
  addScalar("migrationDestinationMinimumAttractiveness", "migrationDestinationMinimumAttractiveness", [475, 450, 425, 400]);

  const addWeightRedistributions = (field: "migrationPushWeights" | "migrationAttractivenessWeights", weights: Record<string, number>): void => {
    const keys = Object.keys(weights).sort();
    for (const amount of [500, 1000]) for (const donor of keys) for (const recipient of keys) {
      if (donor === recipient || weights[donor]! < amount) continue;
      const next = shiftedWeights(weights, donor, recipient, amount);
      rows.push({
        candidateId: `${field}:${donor}->${recipient}:${amount}`,
        field,
        changedFields: 1,
        latticeDistance: amount / 500,
        description: `${field} shifts ${amount} BPS from ${donor} to ${recipient}`,
        mechanics: { ...structuredClone(base), [field]: next },
      });
    }
  };
  addWeightRedistributions("migrationPushWeights", base.migrationPushWeights);
  addWeightRedistributions("migrationAttractivenessWeights", base.migrationAttractivenessWeights);
  for (const candidate of rows) validateMechanicsVariablesV1(candidate.mechanics);
  if (rows.length !== 55) throw new Error(`Expected baseline plus 54 one-field candidates, received ${rows.length}`);
  if (new Set(rows.map((candidate) => candidate.candidateId)).size !== rows.length) throw new Error("Migration lattice contains duplicate candidate IDs");
  return rows;
}

function factionCompatibility(left: FactionVector, right: FactionVector): number {
  const distance = Math.abs(left.CONCORD - right.CONCORD) + Math.abs(left.SCHISM - right.SCHISM) + Math.abs(left.RUIN - right.RUIN);
  return 1000 - Number(divideRoundedAway(BigInt(distance), 2n));
}

function emptyScreen(): ScreenResult {
  return { reviewedCellsThrough100: 0, desiredPositiveCellsThrough100: 0, desiredPopulationThrough100: 0n, firstPositiveYear: null, worldsWithPositiveDesiredThrough100: new Set() };
}

function emptyWorldEvidence(): WorldRunEvidence {
  return { transfersThrough100: 0, transferPopulationThrough100: 0n, originDestinationPairsThrough100: new Set(), transfersYears101To200: 0, transferPopulationYears101To200: 0n, safetyChecks: 0, safetyViolations: 0 };
}

function migrationEvents(events: readonly CausalEventV5[]): CausalEventV5[] {
  return events.filter((event) => event.eventType === "MigrationTransfer");
}

function addRunEvidence(evidence: Record<WorldKey, WorldRunEvidence>, snapshot: V5AtomicYearSnapshot): void {
  for (const world of WORLDS) {
    for (const event of migrationEvents(snapshot.yearEvents[world])) {
      const population = BigInt(String(event.payload.population ?? "0"));
      if (snapshot.year <= 100) {
        evidence[world].transfersThrough100 += 1;
        evidence[world].transferPopulationThrough100 += population;
        evidence[world].originDestinationPairsThrough100.add(`${String(event.payload.originSettlementId)}>${String(event.payload.destinationSettlementId)}`);
      } else if (snapshot.year <= 200) {
        evidence[world].transfersYears101To200 += 1;
        evidence[world].transferPopulationYears101To200 += population;
      }
    }
    const migrationDiagnostic = snapshot.yearDiagnosticObservations[world].find((row) => row.domain === "MIGRATION");
    evidence[world].safetyChecks += migrationDiagnostic?.counters.perCellSafetyChecks ?? 0;
    evidence[world].safetyChecks += migrationDiagnostic?.counters.aggregateSafetyChecks ?? 0;
    evidence[world].safetyViolations += migrationDiagnostic?.counters.perCellSafetyViolations ?? 0;
    evidence[world].safetyViolations += migrationDiagnostic?.counters.aggregateSafetyViolations ?? 0;
    evidence[world].safetyViolations += migrationDiagnostic?.counters.populationConservationViolations ?? 0;
  }
}

function pass(evidence: Record<WorldKey, WorldRunEvidence>): boolean {
  return WORLDS.every((world) => evidence[world].transfersThrough100 > 0
    && evidence[world].originDestinationPairsThrough100.size >= 2
    && evidence[world].transfersYears101To200 > 0
    && evidence[world].safetyViolations === 0);
}

function serializedEvidence(evidence: Record<WorldKey, WorldRunEvidence>): Record<WorldKey, unknown> {
  return Object.fromEntries(WORLDS.map((world) => [world, {
    transfersThrough100: evidence[world].transfersThrough100,
    voluntaryPopulationThrough100: evidence[world].transferPopulationThrough100.toString(),
    originDestinationPairsThrough100: evidence[world].originDestinationPairsThrough100.size,
    transfersYears101To200: evidence[world].transfersYears101To200,
    voluntaryPopulationYears101To200: evidence[world].transferPopulationYears101To200.toString(),
    safetyChecks: evidence[world].safetyChecks,
    safetyViolations: evidence[world].safetyViolations,
  }])) as Record<WorldKey, unknown>;
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs, OWNER_SEED);
const lattice = candidates();
const screenings = new Map(lattice.filter((candidate) => candidate.changedFields === 1).map((candidate) => [candidate.candidateId, emptyScreen()]));
const breedById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
const baselineEvidence = Object.fromEntries(WORLDS.map((world) => [world, emptyWorldEvidence()])) as Record<WorldKey, WorldRunEvidence>;
const started = performance.now();

process.stderr.write(`MIGRATION_LATTICE baseline causal run through year 200 (${lattice.length - 1} candidates screened)\n`);
runV5History({
  canonical,
  ownerInputs,
  mechanics: lattice[0]!.mechanics,
  operational: DEFAULT_OPERATIONAL_CONFIG_V1,
  diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
  normalizedSeed: OWNER_SEED,
  mode: "DIAGNOSTIC",
  throughYear: 200,
  scheduledTransactions,
  stopAtBlockingNaming: false,
  interactiveNamingEnabled: false,
  retainHistory: false,
  onAtomicYear: (snapshot) => {
    addRunEvidence(baselineEvidence, snapshot);
    if (snapshot.year > 100) return;
    const dueCandidates = lattice.filter((candidate) => candidate.changedFields === 1 && snapshot.year % candidate.mechanics.migrationReviewIntervalYears === 0);
    for (const world of WORLDS) {
      const metricsByHops = new Map<number, ReturnType<typeof deriveMetrics>>();
      for (const candidate of dueCandidates) {
        let metrics = metricsByHops.get(candidate.mechanics.migrationMaximumHops);
        if (!metrics) {
          metrics = deriveMetrics(snapshot.states[world], canonical, { ...lattice[0]!.mechanics, migrationMaximumHops: candidate.mechanics.migrationMaximumHops });
          metricsByHops.set(candidate.mechanics.migrationMaximumHops, metrics);
        }
        const screening = screenings.get(candidate.candidateId)!;
        const maximumOpportunity = Math.max(...Object.values(metrics.localOpportunity));
        const settlementById = new Map(snapshot.states[world].settlements.map((settlement) => [settlement.settlementId, settlement]));
        for (const cell of snapshot.states[world].cohorts) {
          const origin = settlementById.get(cell.settlementId)!;
          const breed = breedById.get(cell.breedId)!;
          const vector = breedFactionVector(breed);
          const compatibility = metrics.settlementPopulationFactionVectors[origin.settlementId]
            ? factionCompatibility(vector, metrics.settlementPopulationFactionVectors[origin.settlementId]!)
            : 500;
          for (const tier of ["HIGH", "MID", "LOW"] as const) {
            screening.reviewedCellsThrough100 += 1;
            const disadvantage = clamp(maximumOpportunity - cell.tiers[tier].prosperity, 0, 1000);
            const push = migrationPush(compatibility, disadvantage, origin.unrest, candidate.mechanics);
            const desired = desiredMigrationOutflow(cell.tiers[tier].population, push, candidate.mechanics);
            if (desired <= 0n) continue;
            screening.desiredPositiveCellsThrough100 += 1;
            screening.desiredPopulationThrough100 += desired;
            screening.firstPositiveYear ??= snapshot.year;
            screening.worldsWithPositiveDesiredThrough100.add(world);
          }
        }
      }
    }
  },
});

const actualCandidates = lattice.filter((candidate) => candidate.changedFields === 1 && screenings.get(candidate.candidateId)!.desiredPositiveCellsThrough100 > 0);
const fullEvidence = new Map<string, Record<WorldKey, WorldRunEvidence>>([["BASELINE", baselineEvidence]]);
for (const [index, candidate] of actualCandidates.entries()) {
  process.stderr.write(`MIGRATION_LATTICE full causal ${index + 1}/${actualCandidates.length} ${candidate.candidateId}\n`);
  const evidence = Object.fromEntries(WORLDS.map((world) => [world, emptyWorldEvidence()])) as Record<WorldKey, WorldRunEvidence>;
  runV5History({
    canonical,
    ownerInputs,
    mechanics: candidate.mechanics,
    operational: DEFAULT_OPERATIONAL_CONFIG_V1,
    diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
    normalizedSeed: OWNER_SEED,
    mode: "DIAGNOSTIC",
    throughYear: 200,
    scheduledTransactions,
    stopAtBlockingNaming: false,
    interactiveNamingEnabled: false,
    retainHistory: false,
    onAtomicYear: (snapshot) => addRunEvidence(evidence, snapshot),
  });
  fullEvidence.set(candidate.candidateId, evidence);
}

const results = lattice.map((candidate) => {
  const screening = candidate.changedFields === 0 ? null : screenings.get(candidate.candidateId)!;
  const evidence = fullEvidence.get(candidate.candidateId);
  const candidatePass = evidence ? pass(evidence) : false;
  return {
    candidateId: candidate.candidateId,
    field: candidate.field,
    description: candidate.description,
    changedFields: candidate.changedFields,
    latticeDistance: candidate.latticeDistance,
    migrationMaximumOutflowBps: candidate.mechanics.migrationMaximumOutflowBps,
    canonicalConfiguration: canonicalJson(candidate.mechanics),
    evaluation: evidence ? "FULL_THREE_WORLD_CAUSAL_RUN_THROUGH_200" : "EXACT_BASELINE_STATE_REVIEW_SCREEN",
    screening: screening ? {
      reviewedCellsThrough100: screening.reviewedCellsThrough100,
      desiredPositiveCellsThrough100: screening.desiredPositiveCellsThrough100,
      desiredPopulationThrough100: screening.desiredPopulationThrough100.toString(),
      firstPositiveYear: screening.firstPositiveYear,
      worldsWithPositiveDesiredThrough100: [...screening.worldsWithPositiveDesiredThrough100].sort(),
    } : null,
    worlds: evidence ? serializedEvidence(evidence) : null,
    pass: candidatePass,
    rejection: candidatePass ? null : evidence
      ? "failed approved world-level year-100/year-200 viability assertions"
      : "zero positive desiredMigrationOutflow on every applicable exact causal review state through year 100; cannot satisfy year-100 viability",
  };
});
const passing = results.filter((candidate) => candidate.pass).sort((left, right) => left.changedFields - right.changedFields
  || left.latticeDistance - right.latticeDistance
  || left.migrationMaximumOutflowBps - right.migrationMaximumOutflowBps
  || left.canonicalConfiguration.localeCompare(right.canonicalConfiguration));
if (passing.length === 0) throw new Error("No one-field migration candidate passed; pairwise calibration would be required");
const selected = passing[0]!;
const report = {
  schemaVersion: "echoes-v5-migration-one-field-lattice-v2",
  seed: OWNER_SEED,
  canonicalBundleHash: canonical.canonicalBundleHash,
  versions: { scheduler: V5_SCHEDULER_VERSION, mechanics: V5_MECHANICS_VERSION, causalDerivation: V5_CAUSAL_DERIVATION_VERSION },
  latticeAuthority: {
    baseline: "pre-calibration mechanics with migrationPushThreshold=300",
    scalarCandidateCount: 18,
    validWeightRedistributionCount: 36,
    totalOneFieldCandidates: 54,
    weightRule: "Every ordered 500/1000-BPS donor-to-recipient redistribution preserving an exact 10000-BPS total",
  },
  ranking: ["fewest changed fields", "smallest total lattice distance", "lower maximum outflow", "canonical serialized configuration"],
  pairwiseOrThreeFieldRunsPerformed: false,
  pairwiseOrThreeFieldDisposition: "NOT_RUN_BECAUSE_ONE_FIELD_CANDIDATES_PASSED",
  fullCausalCandidateCount: fullEvidence.size,
  exactZeroDesiredScreenCount: results.filter((candidate) => candidate.evaluation === "EXACT_BASELINE_STATE_REVIEW_SCREEN").length,
  selectedCandidateId: selected.candidateId,
  passingCandidateIds: passing.map((candidate) => candidate.candidateId),
  elapsedMilliseconds: Math.round(performance.now() - started),
  candidates: results,
  pass: results.length === 55 && passing.length > 0,
};
writeFileSync(OUTPUT_PATH, `${canonicalJson(report)}\n`, "utf8");
process.stdout.write(`${canonicalJson({ outputPath: OUTPUT_PATH, pass: report.pass, selectedCandidateId: report.selectedCandidateId, passingCandidateIds: report.passingCandidateIds, fullCausalCandidateCount: report.fullCausalCandidateCount, exactZeroDesiredScreenCount: report.exactZeroDesiredScreenCount, elapsedMilliseconds: report.elapsedMilliseconds })}\n`);
