import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
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
import { restoreMechanicsVariablesV1 } from "../core/v5/configuration.js";
import { settlementPopulation, worldPopulation } from "../core/v5/derivations.js";
import { causalStateHash } from "../core/v5/engine.js";
import {
  V5_EMPTY_EVENT_HISTORY_HASH,
  buildV5RunManifest,
  extendV5EventHistoryHash,
  restoreWorldStateV5,
} from "../core/v5/persistence.js";
import { normalizeSeed } from "../core/v5/random.js";
import { continueV5History, runV5History, type V5AtomicYearSnapshot } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";
import type { CausalEventV5, SocialTier, WorldKey, WorldStateV5 } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const MILESTONES = [100, 200, 500, 1000, 2000] as const;
const OWNER_SEED = normalizeSeed(process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "EIDOLON_V5_DIAGNOSTIC_1787843667789");
const OUTPUT_DIRECTORY = resolve("artifacts/simulator/v5/remediation");
const LATTICE_PATH = resolve(OUTPUT_DIRECTORY, "migration-one-field-lattice.json");
const JSON_OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, "migration-long-horizon-materiality.json");
const MARKDOWN_OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, "migration-long-horizon-comparison.md");
const CONTROL_CACHE_PATH = resolve("outputs/prompt00-migration-control-milestones.json");
const LABEL_SOURCE_EVIDENCE_PATH = resolve("outputs/prompt00-migration-label-source-evidence.json");

interface TransferRecord {
  year: number;
  amount: bigint;
  originSettlementId: string;
  destinationSettlementId: string;
  breedId: string;
  tier: SocialTier;
}

interface AggregateYearRecord {
  settlementId: string;
  year: number;
  amount: bigint;
  priorPopulation: bigint;
}

interface SafetyTotals {
  perCellChecks: number;
  perCellViolations: number;
  maximumActualToDesiredBps: number;
  maximumVoluntaryActualToDesiredBps: number;
  aggregateChecks: number;
  aggregateViolations: number;
  maximumAggregateActualToTheoreticalBps: number;
  populationConservationChecks: number;
  populationConservationViolations: number;
}

interface EmergentFoundingRecord {
  year: number;
  settlementId: string;
  regionId: string;
  ordinalAfterFounding: number;
}

interface WorldAccumulator {
  transfers: TransferRecord[];
  annualVolumes: Map<number, bigint>;
  sourceYears: Map<string, AggregateYearRecord>;
  destinationYears: Map<string, AggregateYearRecord>;
  cumulativePopulationExposure: bigint;
  exposureByMilestone: Map<number, bigint>;
  statesByMilestone: Map<number, WorldStateV5>;
  safety: SafetyTotals;
  safetyByMilestone: Map<number, SafetyTotals>;
  emergentFoundings: EmergentFoundingRecord[];
  eventHistoryHash: string;
  eventCount: number;
  maximumDiagnosticObservationsPerYear: number;
  malformedHistogramCount: number;
  maximumOrdinaryRegionSettlementCount: number;
  regionsAboveSeven: Set<string>;
  preDjtR10FoundingYears: number[];
  maximumTimedConditionCount: number;
}

interface LatticeCandidateRow {
  candidateId: string;
  canonicalConfiguration: string;
  changedFields: number;
  latticeDistance: number;
  migrationMaximumOutflowBps: number;
  pass: boolean;
}

interface LatticeReport {
  schemaVersion: string;
  selectedCandidateId: string;
  passingCandidateIds: string[];
  pairwiseOrThreeFieldRunsPerformed: boolean;
  candidates: LatticeCandidateRow[];
  pass: boolean;
}

function emptySafety(): SafetyTotals {
  return {
    perCellChecks: 0,
    perCellViolations: 0,
    maximumActualToDesiredBps: 0,
    maximumVoluntaryActualToDesiredBps: 0,
    aggregateChecks: 0,
    aggregateViolations: 0,
    maximumAggregateActualToTheoreticalBps: 0,
    populationConservationChecks: 0,
    populationConservationViolations: 0,
  };
}

function cloneSafety(value: SafetyTotals): SafetyTotals { return { ...value }; }

function emptyAccumulator(): WorldAccumulator {
  return {
    transfers: [], annualVolumes: new Map(), sourceYears: new Map(), destinationYears: new Map(),
    cumulativePopulationExposure: 0n, exposureByMilestone: new Map(), statesByMilestone: new Map(),
    safety: emptySafety(), safetyByMilestone: new Map(), emergentFoundings: [],
    eventHistoryHash: V5_EMPTY_EVENT_HISTORY_HASH, eventCount: 0,
    maximumDiagnosticObservationsPerYear: 0, malformedHistogramCount: 0,
    maximumOrdinaryRegionSettlementCount: 0, regionsAboveSeven: new Set(), preDjtR10FoundingYears: [],
    maximumTimedConditionCount: 0,
  };
}

function quantile(values: readonly bigint[], probabilityNumerator: number, probabilityDenominator: number): bigint {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const rank = Math.max(1, Math.ceil(sorted.length * probabilityNumerator / probabilityDenominator));
  return sorted[rank - 1]!;
}

function percent(numerator: bigint, denominator: bigint, decimalPlaces = 6): string {
  if (denominator === 0n) return "0.000000%";
  const scale = 10n ** BigInt(decimalPlaces);
  const rounded = (numerator * 100n * scale + denominator / 2n) / denominator;
  const whole = rounded / scale;
  const fraction = (rounded % scale).toString().padStart(decimalPlaces, "0");
  return `${whole}.${fraction}%`;
}

function updateAggregate(map: Map<string, AggregateYearRecord>, settlementId: string, year: number, amount: bigint, priorPopulation: bigint): void {
  const key = `${year}\0${settlementId}`;
  const prior = map.get(key);
  map.set(key, { settlementId, year, amount: (prior?.amount ?? 0n) + amount, priorPopulation });
}

function serializeAggregateMaximum(records: Iterable<AggregateYearRecord>): Record<string, unknown> | null {
  let maximum: AggregateYearRecord | null = null;
  for (const record of records) if (!maximum || record.amount * maximum.priorPopulation > maximum.amount * record.priorPopulation || (record.amount * maximum.priorPopulation === maximum.amount * record.priorPopulation && `${record.year}/${record.settlementId}` < `${maximum.year}/${maximum.settlementId}`)) maximum = record;
  if (!maximum) return null;
  return {
    year: maximum.year,
    settlementId: maximum.settlementId,
    population: maximum.amount.toString(),
    priorSettlementPopulation: maximum.priorPopulation.toString(),
    percentageOfPriorSettlementPopulation: percent(maximum.amount, maximum.priorPopulation),
  };
}

function cohortDistribution(state: WorldStateV5, settlementId: string): { total: bigint; rows: Map<string, bigint> } {
  const rows = new Map<string, bigint>();
  let total = 0n;
  for (const cell of state.cohorts.filter((candidate) => candidate.settlementId === settlementId)) for (const tier of ["HIGH", "MID", "LOW"] as const) {
    const amount = cell.tiers[tier].population;
    rows.set(`${cell.breedId}/${tier}`, amount);
    total += amount;
  }
  return { total, rows };
}

function compositionDifferencePpm(candidate: WorldStateV5, control: WorldStateV5, settlementId: string): number {
  const candidateSettlement = candidate.settlements.find((row) => row.settlementId === settlementId);
  if (!candidateSettlement) return 0;
  const controlSettlement = control.settlements.find((row) => row.siteId === candidateSettlement.siteId);
  if (!controlSettlement) return 1_000_000;
  const left = cohortDistribution(candidate, settlementId);
  const right = cohortDistribution(control, controlSettlement.settlementId);
  if (left.total === 0n && right.total === 0n) return 0;
  if (left.total === 0n || right.total === 0n) return 1_000_000;
  const keys = new Set([...left.rows.keys(), ...right.rows.keys()]);
  let sum = 0n;
  for (const key of keys) {
    const delta = (left.rows.get(key) ?? 0n) * right.total - (right.rows.get(key) ?? 0n) * left.total;
    sum += delta < 0n ? -delta : delta;
  }
  return Number(sum * 1_000_000n / (2n * left.total * right.total));
}

function compositionMateriality(candidate: WorldStateV5, control: WorldStateV5): Record<string, unknown> {
  const differences = candidate.settlements.map((settlement) => ({ settlementId: settlement.settlementId, siteId: settlement.siteId, differencePpm: compositionDifferencePpm(candidate, control, settlement.settlementId) }));
  return {
    evaluatedSettlements: differences.length,
    changedAtLeast1Percent: differences.filter((row) => row.differencePpm >= 10_000).length,
    changedAtLeast5Percent: differences.filter((row) => row.differencePpm >= 50_000).length,
    changedAtLeast10Percent: differences.filter((row) => row.differencePpm >= 100_000).length,
    maximumDifferencePercent: `${((Math.max(0, ...differences.map((row) => row.differencePpm)) / 10_000).toFixed(4))}%`,
    method: "total-variation distance of Breed/tier shares against an otherwise identical no-voluntary-migration counterfactual, matched by physical Site ID",
  };
}

function updateAccumulator(
  accumulators: Record<WorldKey, WorldAccumulator>,
  priorStates: Partial<Record<WorldKey, WorldStateV5>>,
  snapshot: V5AtomicYearSnapshot,
  djtYear: number,
): void {
  for (const world of WORLDS) {
    const accumulator = accumulators[world];
    const state = snapshot.states[world];
    accumulator.cumulativePopulationExposure += worldPopulation(state);
    accumulator.eventHistoryHash = extendV5EventHistoryHash(accumulator.eventHistoryHash, snapshot.yearEvents[world]);
    accumulator.eventCount += snapshot.yearEvents[world].length;
    accumulator.maximumDiagnosticObservationsPerYear = Math.max(accumulator.maximumDiagnosticObservationsPerYear, snapshot.yearDiagnosticObservations[world].length);
    accumulator.maximumTimedConditionCount = Math.max(accumulator.maximumTimedConditionCount, state.timedConditions.length);

    const priorState = priorStates[world];
    for (const event of snapshot.yearEvents[world]) {
      if (event.eventType === "MigrationTransfer") {
        const record: TransferRecord = {
          year: event.year,
          amount: BigInt(String(event.payload.population ?? "0")),
          originSettlementId: String(event.payload.originSettlementId),
          destinationSettlementId: String(event.payload.destinationSettlementId),
          breedId: String(event.payload.breedId),
          tier: String(event.payload.tier) as SocialTier,
        };
        accumulator.transfers.push(record);
        accumulator.annualVolumes.set(record.year, (accumulator.annualVolumes.get(record.year) ?? 0n) + record.amount);
        const sourcePopulation = priorState ? settlementPopulation(priorState, record.originSettlementId) : 0n;
        const destinationPopulation = priorState ? settlementPopulation(priorState, record.destinationSettlementId) : 0n;
        updateAggregate(accumulator.sourceYears, record.originSettlementId, record.year, record.amount, sourcePopulation);
        updateAggregate(accumulator.destinationYears, record.destinationSettlementId, record.year, record.amount, destinationPopulation);
      }
      if (event.eventType === "SettlementFounded" && event.payload.foundingCause === "EMERGENT_MIGRATION") {
        const settlement = state.settlements.find((row) => row.settlementId === event.entityId);
        const regionId = settlement?.regionId ?? String(event.payload.targetRegionId);
        accumulator.emergentFoundings.push({ year: event.year, settlementId: event.entityId, regionId, ordinalAfterFounding: state.settlements.filter((row) => row.regionId === regionId).length });
      }
    }

    for (const observation of snapshot.yearDiagnosticObservations[world]) {
      for (const bins of Object.values(observation.histograms)) if (bins.length !== 1001) accumulator.malformedHistogramCount += 1;
      if (observation.domain !== "MIGRATION") continue;
      const counters = observation.counters;
      accumulator.safety.perCellChecks += counters.perCellSafetyChecks ?? 0;
      accumulator.safety.perCellViolations += counters.perCellSafetyViolations ?? 0;
      accumulator.safety.maximumActualToDesiredBps = Math.max(accumulator.safety.maximumActualToDesiredBps, counters.maximumActualToDesiredBps ?? 0);
      accumulator.safety.maximumVoluntaryActualToDesiredBps = Math.max(accumulator.safety.maximumVoluntaryActualToDesiredBps, counters.maximumVoluntaryActualToDesiredBps ?? 0);
      accumulator.safety.aggregateChecks += counters.aggregateSafetyChecks ?? 0;
      accumulator.safety.aggregateViolations += counters.aggregateSafetyViolations ?? 0;
      accumulator.safety.maximumAggregateActualToTheoreticalBps = Math.max(accumulator.safety.maximumAggregateActualToTheoreticalBps, counters.aggregateActualToTheoreticalBps ?? 0);
      accumulator.safety.populationConservationChecks += counters.populationConservationChecks ?? 0;
      accumulator.safety.populationConservationViolations += counters.populationConservationViolations ?? 0;
    }

    const counts = new Map<string, number>();
    for (const settlement of state.settlements) counts.set(settlement.regionId, (counts.get(settlement.regionId) ?? 0) + 1);
    for (const [regionId, count] of counts) {
      if (regionId !== "R10") accumulator.maximumOrdinaryRegionSettlementCount = Math.max(accumulator.maximumOrdinaryRegionSettlementCount, count);
      if (regionId !== "R10" && count > 7) accumulator.regionsAboveSeven.add(`${snapshot.year}/${regionId}/${count}`);
    }
    if (snapshot.year < djtYear && (counts.get("R10") ?? 0) > 0) accumulator.preDjtR10FoundingYears.push(snapshot.year);
    if (MILESTONES.includes(snapshot.year as typeof MILESTONES[number])) {
      accumulator.exposureByMilestone.set(snapshot.year, accumulator.cumulativePopulationExposure);
      accumulator.statesByMilestone.set(snapshot.year, structuredClone(state));
      accumulator.safetyByMilestone.set(snapshot.year, cloneSafety(accumulator.safety));
    }
    priorStates[world] = structuredClone(state);
  }
}

function milestoneReport(accumulator: WorldAccumulator, year: number, controlState: WorldStateV5): Record<string, unknown> {
  const transfers = accumulator.transfers.filter((row) => row.year <= year);
  const amounts = transfers.map((row) => row.amount);
  const cumulative = amounts.reduce((sum, amount) => sum + amount, 0n);
  const state = accumulator.statesByMilestone.get(year)!;
  const currentPopulation = worldPopulation(state);
  const calendarAnnual = Array.from({ length: year }, (_, index) => accumulator.annualVolumes.get(index + 1) ?? 0n);
  const reviewAnnual = Array.from({ length: Math.floor(year / DEFAULT_MECHANICS_VARIABLES_V1.migrationReviewIntervalYears) }, (_, index) => accumulator.annualVolumes.get((index + 1) * DEFAULT_MECHANICS_VARIABLES_V1.migrationReviewIntervalYears) ?? 0n);
  const safety = accumulator.safetyByMilestone.get(year)!;
  return {
    cumulativeVoluntaryPopulationMoved: cumulative.toString(),
    cumulativeMovedAsPercentageOfCurrentWorldPopulation: percent(cumulative, currentPopulation),
    cumulativeMovedAsPercentageOfCumulativeAnnualPopulationExposure: percent(cumulative, accumulator.exposureByMilestone.get(year)!),
    currentWorldPopulation: currentPopulation.toString(),
    cumulativeAnnualPopulationExposure: accumulator.exposureByMilestone.get(year)!.toString(),
    uniqueOriginDestinationSettlementPairs: new Set(transfers.map((row) => `${row.originSettlementId}>${row.destinationSettlementId}`)).size,
    uniqueBreedsMoved: new Set(transfers.map((row) => row.breedId)).size,
    uniqueTiersMoved: new Set(transfers.map((row) => row.tier)).size,
    compositionChangedBecauseOfVoluntaryMigration: compositionMateriality(state, controlState),
    transferPopulation: { count: amounts.length, median: quantile(amounts, 1, 2).toString(), p90: quantile(amounts, 9, 10).toString() },
    annualMigrationVolume: {
      calendarYearsIncludingZero: { median: quantile(calendarAnnual, 1, 2).toString(), p90: quantile(calendarAnnual, 9, 10).toString() },
      migrationReviewYearsIncludingZero: { median: quantile(reviewAnnual, 1, 2).toString(), p90: quantile(reviewAnnual, 9, 10).toString() },
    },
    largestSourceYearPopulationLoss: serializeAggregateMaximum([...accumulator.sourceYears.values()].filter((row) => row.year <= year)),
    largestDestinationYearMigrationGain: serializeAggregateMaximum([...accumulator.destinationYears.values()].filter((row) => row.year <= year)),
    emergentSixthOrSeventhSettlements: accumulator.emergentFoundings.filter((row) => row.year <= year && (row.ordinalAfterFounding === 6 || row.ordinalAfterFounding === 7)),
    safetyCeilings: safety,
  };
}

const captureLabelEvidenceArgument = process.argv.find((argument) => argument.startsWith("--capture-label-source-evidence="));
if (captureLabelEvidenceArgument) {
  const databasePath = resolve(captureLabelEvidenceArgument.slice("--capture-label-source-evidence=".length));
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const run = database.prepare("SELECT run_id,current_year,status FROM simulation_run WHERE run_id LIKE 'V5_MIGRATION_LONG_%'").get() as { run_id: string; current_year: number; status: string } | undefined;
    if (!run || run.current_year !== 2000) throw new Error("Label-source evidence may only be captured from the completed year-2000 temporary benchmark");
    const sources = database.prepare("SELECT source,COUNT(*) AS count FROM v5_label_ledger GROUP BY source ORDER BY source").all() as { source: string; count: number }[];
    mkdirSync(resolve("outputs"), { recursive: true });
    writeFileSync(LABEL_SOURCE_EVIDENCE_PATH, `${canonicalJson({ schemaVersion: "echoes-v5-migration-label-source-evidence-v1", temporaryDatabase: true, runId: run.run_id, currentYear: run.current_year, status: run.status, sources })}\n`, "utf8");
  } finally {
    database.close();
  }
  process.stdout.write(`${canonicalJson({ outputPath: LABEL_SOURCE_EVIDENCE_PATH })}\n`);
  process.exit(0);
}

if (process.argv.includes("--reassess-existing")) {
  const report = JSON.parse(readFileSync(JSON_OUTPUT_PATH, "utf8")) as {
    worlds: Record<WorldKey, { longHorizonAssertions: Record<string, boolean> }>;
    replayCheckpointEquivalence: Record<WorldKey, { equivalent: boolean }>;
    storageEvidence: Record<string, unknown>;
    pass: boolean;
  };
  const evidence = JSON.parse(readFileSync(LABEL_SOURCE_EVIDENCE_PATH, "utf8")) as { temporaryDatabase: boolean; currentYear: number; sources: { source: string; count: number }[] };
  if (!evidence.temporaryDatabase || evidence.currentYear !== 2000) throw new Error("Invalid temporary benchmark label-source evidence");
  const acceptedLabelsBySource = Object.fromEntries(evidence.sources.map((row) => [row.source, row.count]));
  const nonCanonicalAcceptedLabels = evidence.sources.filter((row) => row.source !== "CANONICAL_EXISTING").reduce((sum, row) => sum + row.count, 0);
  report.storageEvidence.acceptedLabelsBySource = acceptedLabelsBySource;
  report.storageEvidence.nonCanonicalAcceptedLabels = nonCanonicalAcceptedLabels;
  const assertionsPass = WORLDS.every((world) => Object.values(report.worlds[world].longHorizonAssertions).every(Boolean))
    && WORLDS.every((world) => report.replayCheckpointEquivalence[world].equivalent)
    && Boolean(report.storageEvidence.diagnosticHistogramsBounded)
    && nonCanonicalAcceptedLabels === 0;
  report.pass = assertionsPass;
  writeFileSync(JSON_OUTPUT_PATH, `${canonicalJson(report)}\n`, "utf8");
  const viabilityPath = resolve(OUTPUT_DIRECTORY, "migration-viability-after.json");
  const viability = JSON.parse(readFileSync(viabilityPath, "utf8")) as Record<string, unknown>;
  viability.pass = assertionsPass;
  writeFileSync(viabilityPath, `${canonicalJson(viability)}\n`, "utf8");
  rmSync(LABEL_SOURCE_EVIDENCE_PATH, { force: true });
  process.stdout.write(`${canonicalJson({ jsonOutputPath: JSON_OUTPUT_PATH, correctedAssertion: "NO_NON_CANONICAL_ACCEPTED_LABELS", pass: assertionsPass })}\n`);
  if (!assertionsPass) process.exitCode = 1;
  process.exit();
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const lattice = JSON.parse(readFileSync(LATTICE_PATH, "utf8")) as LatticeReport;
if (!lattice.pass || lattice.candidates.length !== 55) throw new Error("Complete one-field migration lattice is unavailable or failed");
if (lattice.pairwiseOrThreeFieldRunsPerformed) throw new Error("Pairwise/three-field runs must not be performed after a one-field candidate passes");
const passingCandidates = lattice.candidates.filter((candidate) => candidate.pass);
if (passingCandidates.length === 0) throw new Error("No passing one-field migration candidate exists");
const selectedCandidate = passingCandidates.slice().sort((left, right) => left.changedFields - right.changedFields
  || left.latticeDistance - right.latticeDistance
  || left.migrationMaximumOutflowBps - right.migrationMaximumOutflowBps
  || left.canonicalConfiguration.localeCompare(right.canonicalConfiguration))[0]!;
if (selectedCandidate.candidateId !== lattice.selectedCandidateId) throw new Error("Lattice selection does not match the approved ranking");
const selectedMechanics = restoreMechanicsVariablesV1(JSON.parse(selectedCandidate.canonicalConfiguration));
if (canonicalJson(selectedMechanics) !== canonicalJson(DEFAULT_MECHANICS_VARIABLES_V1)) throw new Error("Selected one-field candidate differs from the currently configured Prompt-00 mechanics");

const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwnerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const ownerInputs = { ...baseOwnerInputs, canonicalPolicies: djtPolicy ? { ...baseOwnerInputs.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwnerInputs.canonicalPolicies };
const scheduledTransactions = buildScheduledTransactionsV5(canonical, ownerInputs, OWNER_SEED);
const djtYear = Math.min(...WORLDS.flatMap((world) => scheduledTransactions[world].filter((row) => row.type === "DJT").map((row) => row.year)));
const started = performance.now();

const controlStates = Object.fromEntries(WORLDS.map((world) => [world, new Map<number, WorldStateV5>()])) as Record<WorldKey, Map<number, WorldStateV5>>;
const controlMechanics: MechanicsVariablesV1 = { ...structuredClone(selectedMechanics), migrationPushThreshold: 1000 };
const controlCacheIdentity = createHash("sha256").update(canonicalJson({ seed: OWNER_SEED, canonicalBundleHash: canonical.canonicalBundleHash, mechanics: controlMechanics })).digest("hex");
if (existsSync(CONTROL_CACHE_PATH)) {
  const cached = JSON.parse(readFileSync(CONTROL_CACHE_PATH, "utf8")) as { identity: string; worlds: Record<WorldKey, Record<string, unknown>> };
  if (cached.identity === controlCacheIdentity) {
    for (const world of WORLDS) for (const year of MILESTONES) controlStates[world].set(year, restoreWorldStateV5(cached.worlds[world][String(year)]));
    process.stderr.write("MIGRATION_LONG_HORIZON loaded validated no-voluntary control milestone cache\n");
  }
}
if (WORLDS.some((world) => controlStates[world].size !== MILESTONES.length)) {
  process.stderr.write("MIGRATION_LONG_HORIZON no-voluntary counterfactual through year 2000\n");
  runV5History({
    canonical, ownerInputs, mechanics: controlMechanics,
    operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
    normalizedSeed: OWNER_SEED, mode: "DIAGNOSTIC", throughYear: 2000, scheduledTransactions,
    stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: false,
    onAtomicYear: (snapshot) => {
      if (MILESTONES.includes(snapshot.year as typeof MILESTONES[number])) for (const world of WORLDS) controlStates[world].set(snapshot.year, structuredClone(snapshot.states[world]));
      if (snapshot.year % 100 === 0) process.stderr.write(`MIGRATION_LONG_HORIZON control year ${snapshot.year}/2000\n`);
    },
  });
  mkdirSync(resolve("outputs"), { recursive: true });
  writeFileSync(CONTROL_CACHE_PATH, `${canonicalJson({ identity: controlCacheIdentity, worlds: Object.fromEntries(WORLDS.map((world) => [world, Object.fromEntries(MILESTONES.map((year) => [year, controlStates[world].get(year)!]))])) })}\n`, "utf8");
}

process.stderr.write(`MIGRATION_LONG_HORIZON selected ${selectedCandidate.candidateId} persisted unattended run through year 2000\n`);
const accumulators = Object.fromEntries(WORLDS.map((world) => [world, emptyAccumulator()])) as Record<WorldKey, WorldAccumulator>;
const priorStates: Partial<Record<WorldKey, WorldStateV5>> = {};
mkdirSync(resolve("outputs"), { recursive: true });
const tempDirectory = mkdtempSync(resolve("outputs/echoes-v5-migration-long-"));
const databasePath = resolve(tempDirectory, "selected-2000.sqlite");
const store = new SimulatorStore(databasePath);
const runId = `V5_MIGRATION_LONG_${createHash("sha256").update(`${OWNER_SEED}\0${selectedCandidate.candidateId}`).digest("hex").slice(0, 16)}`;
const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 2000, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: OWNER_SEED, mechanics: selectedMechanics, causalOwnerInputs: ownerInputs, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
store.saveV5Configuration({ mechanics: selectedMechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
store.createRun({ runId, mode: "DIAGNOSTIC", status: "RUNNING", seed: OWNER_SEED, seedHash: createHash("sha256").update(OWNER_SEED).digest("hex"), policyVersion: V5_MECHANICS_VERSION, currentYear: 0 });
store.saveV5RunManifest(manifest);
store.selectRun(runId);
const persist = (snapshot: V5AtomicYearSnapshot): void => {
  updateAccumulator(accumulators, priorStates, snapshot, djtYear);
  for (const world of WORLDS) {
    store.appendV5CausalEvents(runId, snapshot.yearEvents[world]);
    store.saveV5NamingRequests(runId, snapshot.yearNamingRequests[world]);
    store.mergeV5DiagnosticObservations(runId, snapshot.yearDiagnosticObservations[world]);
    if (snapshot.checkpointDue) store.saveV5Checkpoint(runId, snapshot.states[world], accumulators[world].eventHistoryHash);
  }
  store.setRunStatus(runId, "RUNNING", snapshot.year);
  if (snapshot.year > 0 && snapshot.year % 100 === 0) process.stderr.write(`MIGRATION_LONG_HORIZON selected year ${snapshot.year}/2000\n`);
};

let selectedResult: ReturnType<typeof runV5History>;
let storageEvidence: Record<string, unknown>;
let replayEvidence: Record<WorldKey, unknown>;
try {
  selectedResult = runV5History({
    canonical, ownerInputs, mechanics: selectedMechanics,
    operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
    normalizedSeed: OWNER_SEED, mode: "DIAGNOSTIC", throughYear: 2000, scheduledTransactions,
    stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: false,
    onBootstrap: persist, onAtomicYear: persist,
  });
  store.setRunStatus(runId, selectedResult.status, selectedResult.completedYear);
  const checkpointYear = 1000;
  const checkpointStates = Object.fromEntries(WORLDS.map((world) => [world, store.loadLatestV5Checkpoint(runId, world, checkpointYear)!.state])) as Record<WorldKey, WorldStateV5>;
  const eventCountsAtCheckpoint = Object.fromEntries(WORLDS.map((world) => [world, store.summarizeV5CausalEventHistory(runId, world, checkpointYear).eventCount]));
  const replayHashes = Object.fromEntries(WORLDS.map((world) => [world, V5_EMPTY_EVENT_HISTORY_HASH])) as Record<WorldKey, string>;
  process.stderr.write("MIGRATION_LONG_HORIZON checkpoint continuation year 1000 to 2000\n");
  const resumed = continueV5History({
    canonical, ownerInputs, mechanics: selectedMechanics,
    operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
    normalizedSeed: OWNER_SEED, mode: "DIAGNOSTIC", throughYear: 2000, scheduledTransactions,
    initialStates: checkpointStates, initialEventCounts: eventCountsAtCheckpoint,
    stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: false,
    onAtomicYear: (snapshot) => {
      for (const world of WORLDS) replayHashes[world] = extendV5EventHistoryHash(replayHashes[world], snapshot.yearEvents[world]);
      if (snapshot.year % 100 === 0) process.stderr.write(`MIGRATION_LONG_HORIZON replay year ${snapshot.year}/2000\n`);
    },
  });
  replayEvidence = Object.fromEntries(WORLDS.map((world) => {
    const persistedTail = store.listV5CausalEvents(runId, world, 2000).filter((event) => event.year > checkpointYear);
    const persistedTailHash = extendV5EventHistoryHash(V5_EMPTY_EVENT_HISTORY_HASH, persistedTail);
    const stateEquivalent = causalStateHash(resumed.states[world]) === causalStateHash(selectedResult.states[world]);
    const eventTailEquivalent = replayHashes[world] === persistedTailHash;
    return [world, { checkpointYear, resumedStateHash: causalStateHash(resumed.states[world]), uninterruptedStateHash: causalStateHash(selectedResult.states[world]), resumedTailEventHash: replayHashes[world], uninterruptedTailEventHash: persistedTailHash, stateEquivalent, eventTailEquivalent, equivalent: stateEquivalent && eventTailEquivalent }];
  })) as Record<WorldKey, unknown>;
  const summaries = store.listV5DiagnosticSummaries(runId);
  const trustedLabels = store.loadV5TrustedLabelLedger(runId);
  const acceptedLabelsBySource = Object.fromEntries(
    [...new Set(trustedLabels.map((entry) => entry.source))]
      .sort()
      .map((source) => [source, trustedLabels.filter((entry) => entry.source === source).length]),
  );
  const nonCanonicalAcceptedLabels = trustedLabels.filter((entry) => entry.source !== "CANONICAL_EXISTING");
  storageEvidence = {
    temporaryDatabase: true,
    databaseDeletedAfterMeasurement: true,
    databaseBytes: statSync(databasePath).size + (statSync(`${databasePath}-wal`, { throwIfNoEntry: false })?.size ?? 0) + (statSync(`${databasePath}-shm`, { throwIfNoEntry: false })?.size ?? 0),
    causalEventCount: store.v5EventCount(runId),
    checkpointCount: store.v5CheckpointCount(runId),
    diagnosticStorage: store.v5DiagnosticStorageStats(runId),
    payloadAccounting: store.v5StoragePayloadAccounting(runId),
    pageAccounting: store.v5StoragePageAccounting(),
    diagnosticSummaryCount: summaries.length,
    diagnosticHistogramsBounded: summaries.every((summary) => Object.values(summary.histograms).every((bins) => bins.length === 1001)),
    maximumDiagnosticSummaryHistogramBins: Math.max(0, ...summaries.flatMap((summary) => Object.values(summary.histograms).map((bins) => bins.length))),
    pendingNamingRequests: store.listV5NamingRequests(runId).filter((request) => request.acceptedLabel === null).length,
    acceptedTrustedLabels: trustedLabels.length,
    acceptedLabelsBySource,
    nonCanonicalAcceptedLabels: nonCanonicalAcceptedLabels.length,
  };
} finally {
  store.close();
  rmSync(tempDirectory, { recursive: true, force: true });
}

const worlds = Object.fromEntries(WORLDS.map((world) => [world, {
  milestones: Object.fromEntries(MILESTONES.map((year) => [year, milestoneReport(accumulators[world], year, controlStates[world].get(year)!)])),
  longHorizonAssertions: {
    populationConserved: accumulators[world].safety.populationConservationViolations === 0,
    perCellSafetyCeilings: accumulators[world].safety.perCellViolations === 0 && accumulators[world].safety.maximumVoluntaryActualToDesiredBps <= 10_000,
    aggregateSafetyCeilings: accumulators[world].safety.aggregateViolations === 0 && accumulators[world].safety.maximumAggregateActualToTheoreticalBps <= 10_000,
    noRunawaySourceYearLoss: [...accumulators[world].sourceYears.values()].every((row) => row.priorPopulation === 0n || row.amount * 10_000n <= row.priorPopulation * BigInt(selectedMechanics.migrationMaximumOutflowBps)),
    noOrdinaryRegionAboveSeven: accumulators[world].regionsAboveSeven.size === 0,
    noPreDjtR10Founding: accumulators[world].preDjtR10FoundingYears.length === 0,
    boundedInMemoryDiagnostics: accumulators[world].malformedHistogramCount === 0 && accumulators[world].maximumDiagnosticObservationsPerYear <= 2,
  },
  boundedDiagnostics: {
    maximumObservationsPerYear: accumulators[world].maximumDiagnosticObservationsPerYear,
    malformedHistogramCount: accumulators[world].malformedHistogramCount,
    maximumTimedConditionCount: accumulators[world].maximumTimedConditionCount,
  },
  maximumOrdinaryRegionSettlementCount: accumulators[world].maximumOrdinaryRegionSettlementCount,
  naturalEmergentFoundings: accumulators[world].emergentFoundings,
}])) as Record<WorldKey, unknown>;

const worldRows = worlds as Record<WorldKey, { milestones: Record<string, Record<string, unknown>>; longHorizonAssertions: Record<string, boolean> }>;
const compositionAt2000 = WORLDS.map((world) => worldRows[world].milestones["2000"]!.compositionChangedBecauseOfVoluntaryMigration as { changedAtLeast1Percent: number; changedAtLeast5Percent: number; changedAtLeast10Percent: number });
const historicallyMaterial = compositionAt2000.some((row) => row.changedAtLeast1Percent > 0)
  && WORLDS.every((world) => Number(worldRows[world].milestones["2000"]!.uniqueOriginDestinationSettlementPairs) >= 2)
  && WORLDS.every((world) => BigInt(String(worldRows[world].milestones["2000"]!.cumulativeVoluntaryPopulationMoved)) > BigInt(String(worldRows[world].milestones["200"]!.cumulativeVoluntaryPopulationMoved)));
const replayPass = WORLDS.every((world) => (replayEvidence[world] as { equivalent: boolean }).equivalent);
const assertionsPass = WORLDS.every((world) => Object.values(worldRows[world].longHorizonAssertions).every(Boolean))
  && replayPass
  && Boolean(storageEvidence.diagnosticHistogramsBounded)
  && Number(storageEvidence.nonCanonicalAcceptedLabels) === 0;

const report = {
  schemaVersion: "echoes-v5-migration-long-horizon-materiality-v1",
  executionMode: "UNATTENDED_CAUSAL_BENCHMARK",
  namingAcceptance: "NO_NAMING_ACCEPTANCE_PERFORMED",
  seed: OWNER_SEED,
  canonicalBundleHash: canonical.canonicalBundleHash,
  versions: { scheduler: V5_SCHEDULER_VERSION, mechanics: V5_MECHANICS_VERSION, causalDerivation: V5_CAUSAL_DERIVATION_VERSION },
  lattice: {
    totalConfigurationsIncludingBaseline: lattice.candidates.length,
    passingCandidateIds: passingCandidates.map((candidate) => candidate.candidateId),
    selectedCandidateId: selectedCandidate.candidateId,
    pairwiseOrThreeFieldRunsPerformed: false,
    ranking: ["fewest changed fields", "smallest total lattice distance", "lower maximum outflow", "canonical serialized configuration"],
  },
  counterfactual: { migrationPushThreshold: 1000, causalPurpose: "composition attribution only; not a calibration candidate" },
  djtYear,
  worlds,
  replayCheckpointEquivalence: replayEvidence,
  storageEvidence,
  materialityAssessment: {
    historicallyMaterial,
    arbitraryRequiredMigrationPercentageUsed: false,
    evidenceRule: "sustained post-year-200 movement, multiple origin/destination pairs in every world, and at least one Settlement crossing the owner-requested 1% composition-change observation level by year 2000",
  },
  recommendation: {
    action: selectedCandidate.candidateId === "migrationPushThreshold=200" ? "RETAIN_THRESHOLD_200" : "PROMOTE_RANKED_ONE_FIELD_CANDIDATE_AND_RERUN_PROMPT00",
    candidateId: selectedCandidate.candidateId,
    rationale: "This is the highest-ranked passing candidate under the approved ranking; all other one-field candidates failed the viability gate or ranked lower.",
  },
  elapsedMilliseconds: Math.round(performance.now() - started),
  pass: assertionsPass,
};
writeFileSync(JSON_OUTPUT_PATH, `${canonicalJson(report)}\n`, "utf8");
writeFileSync(resolve(OUTPUT_DIRECTORY, "migration-parameter-sweep.json"), `${canonicalJson(lattice)}\n`, "utf8");
writeFileSync(resolve(OUTPUT_DIRECTORY, "migration-viability-after.json"), `${canonicalJson({ schemaVersion: "echoes-v5-migration-viability-after-v2", seed: OWNER_SEED, selectedCandidateId: selectedCandidate.candidateId, milestones: Object.fromEntries(WORLDS.map((world) => [world, worldRows[world].milestones])), historicallyMaterial, pass: assertionsPass })}\n`, "utf8");

const tableRows = MILESTONES.flatMap((year) => WORLDS.map((world) => {
  const row = worldRows[world].milestones[String(year)]!;
  const composition = row.compositionChangedBecauseOfVoluntaryMigration as { changedAtLeast1Percent: number; changedAtLeast5Percent: number; changedAtLeast10Percent: number };
  const transfer = row.transferPopulation as { median: string; p90: string };
  const annual = row.annualMigrationVolume as { calendarYearsIncludingZero: { median: string; p90: string } };
  return `| ${selectedCandidate.candidateId} | ${world} | ${year} | ${row.cumulativeVoluntaryPopulationMoved} | ${row.cumulativeMovedAsPercentageOfCurrentWorldPopulation} | ${row.cumulativeMovedAsPercentageOfCumulativeAnnualPopulationExposure} | ${row.uniqueOriginDestinationSettlementPairs} | ${row.uniqueBreedsMoved}/${row.uniqueTiersMoved} | ${composition.changedAtLeast1Percent}/${composition.changedAtLeast5Percent}/${composition.changedAtLeast10Percent} | ${transfer.median}/${transfer.p90} | ${annual.calendarYearsIncludingZero.median}/${annual.calendarYearsIncludingZero.p90} | ${(row.emergentSixthOrSeventhSettlements as unknown[]).length} |`;
}));
const markdown = `# Prompt-00 migration materiality and long-horizon comparison\n\n- Complete lattice: 54 one-field candidates plus the unchanged baseline.\n- Passing one-field candidates: ${passingCandidates.map((candidate) => `\`${candidate.candidateId}\``).join(", ")}.\n- Pairwise and three-field combinations: not run because a one-field candidate passed.\n- Selected candidate: \`${selectedCandidate.candidateId}\`.\n- Historically material: **${historicallyMaterial ? "YES" : "NO"}**. No arbitrary required migration percentage was introduced.\n\n| Candidate | World | Year | Cumulative moved | % current population | % cumulative population exposure | Unique pairs | Breeds/tiers | Settlements changed >=1%/>=5%/>=10% | Transfer median/p90 | Annual median/p90 | Natural 6th/7th |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${tableRows.join("\n")}\n\n## Recommendation\n\n${report.recommendation.action === "RETAIN_THRESHOLD_200" ? "Retain `migrationPushThreshold = 200`. It is the sole passing one-field candidate and therefore the least-invasive passing configuration under the approved ranking." : `Promote \`${selectedCandidate.candidateId}\` and rerun Prompt-00 acceptance.`}\n\nDetailed source/destination extrema, safety ceilings, counterfactual composition evidence, replay hashes, and bounded-storage measurements are in \`${JSON_OUTPUT_PATH}\`.\n`;
writeFileSync(MARKDOWN_OUTPUT_PATH, markdown, "utf8");
rmSync(CONTROL_CACHE_PATH, { force: true });
process.stdout.write(`${canonicalJson({ jsonOutputPath: JSON_OUTPUT_PATH, markdownOutputPath: MARKDOWN_OUTPUT_PATH, selectedCandidateId: selectedCandidate.candidateId, passingCandidateIds: passingCandidates.map((candidate) => candidate.candidateId), historicallyMaterial, replayPass, pass: assertionsPass, elapsedMilliseconds: report.elapsedMilliseconds })}\n`);
if (!assertionsPass) process.exitCode = 1;
