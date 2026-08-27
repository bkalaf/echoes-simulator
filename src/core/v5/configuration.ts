import { canonicalJson } from "../serialization/canonical-json.js";
import type { DiagnosticConfigV1, MechanicsVariablesV1, OperationalConfigV1 } from "./config.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1 } from "./config.js";

export interface EditableV5Configuration {
  mechanics: MechanicsVariablesV1;
  operational: OperationalConfigV1;
  diagnostic: DiagnosticConfigV1;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function bigintField(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw new Error(`${label} must be a nonnegative integer string`);
  return BigInt(value);
}

function assertIntegerTree(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error(`${path} must use safe integer fixed-point values`);
  if (Array.isArray(value)) value.forEach((row, index) => assertIntegerTree(row, `${path}[${index}]`));
  else if (value && typeof value === "object") for (const [key, row] of Object.entries(value)) assertIntegerTree(row, `${path}.${key}`);
}

function assertWeights(label: string, weights: Record<string, number>): void {
  if (Object.values(weights).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 10_000)) throw new Error(`${label} weights must be integer BPS`);
  if (Object.values(weights).reduce((sum, value) => sum + value, 0) !== 10_000) throw new Error(`${label} weights must total 10000`);
}

export function restoreMechanicsVariablesV1(value: unknown): MechanicsVariablesV1 {
  const row = object(value, "MechanicsVariablesV1");
  const restored = {
    ...row,
    initialPopulation: bigintField(row.initialPopulation, "initialPopulation"),
    initialTierWeights: (Array.isArray(row.initialTierWeights) ? row.initialTierWeights : []).map((item, index) => bigintField(item, `initialTierWeights[${index}]`)),
    foundingMinimumPopulation: bigintField(row.foundingMinimumPopulation, "foundingMinimumPopulation"),
    secessionMinimumPopulation: bigintField(row.secessionMinimumPopulation, "secessionMinimumPopulation"),
    conflictStatePopulationReference: bigintField(row.conflictStatePopulationReference, "conflictStatePopulationReference"),
  } as unknown as MechanicsVariablesV1;
  validateMechanicsVariablesV1(restored);
  return restored;
}

export function restoreOperationalConfigV1(value: unknown): OperationalConfigV1 {
  const row = object(value, "OperationalConfigV1");
  const restored = {
    ...row,
    interactiveNamingEnabled: row.interactiveNamingEnabled ?? false,
    namingBatchFlushIntervalYears: row.namingBatchFlushIntervalYears ?? 25,
    namingBatchMaximum: row.namingBatchMaximum ?? row.namingBatchSize ?? 50,
    namingBatchSize: row.namingBatchMaximum ?? row.namingBatchSize ?? 50,
  } as unknown as OperationalConfigV1;
  validateOperationalConfigV1(restored);
  return restored;
}

export function restoreDiagnosticConfigV1(value: unknown): DiagnosticConfigV1 {
  const row = object(value, "DiagnosticConfigV1");
  const restored = { ...row, endingPopulationGoal: bigintField(row.endingPopulationGoal, "endingPopulationGoal"), foundingNotabilityThreshold: bigintField(row.foundingNotabilityThreshold, "foundingNotabilityThreshold") } as unknown as DiagnosticConfigV1;
  validateDiagnosticConfigV1(restored);
  return restored;
}

export function validateMechanicsVariablesV1(value: MechanicsVariablesV1): void {
  if (value.schemaVersion !== "echoes-mechanics-variables-v1") throw new Error("Unsupported MechanicsVariablesV1 schema");
  assertIntegerTree(value, "mechanics");
  if (value.initialPopulation <= 0n) throw new Error("initialPopulation must be positive");
  if (value.initialTierWeights.length !== 3 || value.initialTierWeights.some((weight) => weight <= 0n)) throw new Error("initialTierWeights must contain three positive exact weights");
  if (value.structuralReviewIntervalYears <= 0 || value.migrationReviewIntervalYears <= 0) throw new Error("Review intervals must be positive");
  if (value.growthRatesPpm.LOW < 0 || value.growthRatesPpm.MEDIUM < 0 || value.growthRatesPpm.HIGH < 0 || Object.values(value.growthRatesPpm).some((rate) => rate > 1_000_000)) throw new Error("Growth rates must be PPM in 0..1000000");
  assertWeights("migrationPushWeights", value.migrationPushWeights);
  assertWeights("migrationAttractivenessWeights", value.migrationAttractivenessWeights);
  assertWeights("foundingSiteScoreWeights", value.foundingSiteScoreWeights);
  assertWeights("mobilityScoreWeights", value.mobilityScoreWeights);
  assertWeights("stateFactionWeights", value.stateFactionWeights);
  assertWeights("legitimacyWeights", value.legitimacyWeights);
  assertWeights("governmentTransitionWeights", value.governmentTransitionWeights);
  for (const [sector, weights] of Object.entries(value.sectorStrengthWeights)) assertWeights(`sectorStrengthWeights.${sector}`, weights);
  for (const [key, number] of Object.entries(value).filter(([, item]) => typeof item === "number") as [string, number][]) {
    if ((key.endsWith("Bps") || key.includes("MaximumChanceBps")) && (number < 0 || number > 10_000)) throw new Error(`${key} must be in 0..10000`);
  }
}

export function validateOperationalConfigV1(value: OperationalConfigV1): void {
  if (value.schemaVersion !== "echoes-operational-config-v1") throw new Error("Unsupported OperationalConfigV1 schema");
  assertIntegerTree(value, "operational");
  if (value.checkpointIntervalYears <= 0 || value.workerCount <= 0 || value.namingBatchSize <= 0 || value.namingBatchFlushIntervalYears <= 0 || value.namingBatchMaximum <= 0) throw new Error("Operational intervals, workers, and naming batch sizes must be positive");
}

export function validateDiagnosticConfigV1(value: DiagnosticConfigV1): void {
  if (value.schemaVersion !== "echoes-diagnostic-config-v1") throw new Error("Unsupported DiagnosticConfigV1 schema");
  assertIntegerTree(value, "diagnostic");
  if (value.endingPopulationGoal <= 0n || value.foundingNotabilityThreshold < 0n) throw new Error("Diagnostic population targets must be nonnegative and the ending goal positive");
  assertWeights("divergenceTargetsBps", value.divergenceTargetsBps);
}

export function parseEditableV5Configuration(input: { mechanicsJson: string; operationalJson: string; diagnosticJson: string }): EditableV5Configuration {
  return {
    mechanics: restoreMechanicsVariablesV1(JSON.parse(input.mechanicsJson)),
    operational: restoreOperationalConfigV1(JSON.parse(input.operationalJson)),
    diagnostic: restoreDiagnosticConfigV1(JSON.parse(input.diagnosticJson)),
  };
}

export function editableV5ConfigurationJson(configuration: EditableV5Configuration): { mechanicsJson: string; operationalJson: string; diagnosticJson: string } {
  return { mechanicsJson: canonicalJson(configuration.mechanics), operationalJson: canonicalJson(configuration.operational), diagnosticJson: canonicalJson(configuration.diagnostic) };
}

export function defaultEditableV5Configuration(): EditableV5Configuration {
  return { mechanics: structuredClone(DEFAULT_MECHANICS_VARIABLES_V1), operational: structuredClone(DEFAULT_OPERATIONAL_CONFIG_V1), diagnostic: structuredClone(DEFAULT_DIAGNOSTIC_CONFIG_V1) };
}
