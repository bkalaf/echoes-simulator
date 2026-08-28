import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CausalOwnerInputsV1, DiagnosticConfigV1, MechanicsVariablesV1, OperationalConfigV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_DURABLE_SCHEMA_VERSION, V5_MECHANICS_VERSION, V5_READ_MODEL_VERSION, V5_SCHEDULER_VERSION, causalOwnerInputsHash, causalRunHash, diagnosticConfigHash, mechanicsVariablesHash, operationalConfigHash } from "./config.js";
import { KEYED_RANDOM_VERSION_V1 } from "./random.js";
import type { CausalEventV5, WorldStateV5 } from "./types.js";

export interface V5RunManifest {
  schemaVersion: "echoes-v5-run-manifest-v1";
  runId: string;
  mode: "CANONICAL" | "DIAGNOSTIC";
  targetYear: number;
  causalRunHash: string;
  durableStateSchemaVersion: string;
  mechanicsVersion: string;
  causalDerivationVersion: string;
  readModelVersion: string;
  schedulerVersion: string;
  keyedRandomVersion: string;
  canonicalBundleHash: string;
  mechanicsVariablesHash: string;
  causalOwnerInputsHash: string;
  operationalConfigHash: string;
  diagnosticConfigHash: string;
  labelInputHash: string;
  runManifestHash: string;
  normalizedSeed: string;
  mechanicsVariables: MechanicsVariablesV1;
  causalOwnerInputs: CausalOwnerInputsV1;
  operationalConfig: OperationalConfigV1;
  diagnosticConfig: DiagnosticConfigV1;
  labels: Record<string, string>;
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
export function labelInputHash(labels: Readonly<Record<string, string>>): string { return hash(labels); }

export const V5_EVENT_HISTORY_HASH_VERSION = "echoes-v5-event-chain-v1";
export const V5_EMPTY_EVENT_HISTORY_HASH = createHash("sha256").update(V5_EVENT_HISTORY_HASH_VERSION, "utf8").digest("hex");

function extendEventHistoryHashWithCanonicalJson(priorHash: string, canonicalEventJson: string): string {
  if (!/^[0-9a-f]{64}$/.test(priorHash)) throw new Error(`Invalid V5 event-history hash ${priorHash}`);
  return createHash("sha256").update(priorHash, "utf8").update("\n", "utf8").update(canonicalEventJson, "utf8").digest("hex");
}

export function extendV5EventHistoryHash(priorHash: string, events: readonly CausalEventV5[]): string {
  return events.reduce((current, event) => extendEventHistoryHashWithCanonicalJson(current, canonicalJson(event)), priorHash);
}

export function extendV5EventHistoryHashFromCanonicalJson(priorHash: string, canonicalEvents: Iterable<string>): string {
  let current = priorHash;
  for (const eventJson of canonicalEvents) current = extendEventHistoryHashWithCanonicalJson(current, eventJson);
  return current;
}

export function buildV5RunManifest(input: { runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; targetYear?: number; canonicalBundleHash: string; normalizedSeed: string; mechanics: MechanicsVariablesV1; causalOwnerInputs: CausalOwnerInputsV1; operational: OperationalConfigV1; diagnostic: DiagnosticConfigV1; labels?: Record<string, string> }): V5RunManifest {
  const causal = causalRunHash({ canonicalBundleHash: input.canonicalBundleHash, mechanics: input.mechanics, normalizedSeed: input.normalizedSeed, causalOwnerInputs: input.causalOwnerInputs, keyedRandomVersion: KEYED_RANDOM_VERSION_V1 });
  const core = {
    schemaVersion: "echoes-v5-run-manifest-v1" as const, runId: input.runId, mode: input.mode, targetYear: input.targetYear ?? 2000, causalRunHash: causal,
    durableStateSchemaVersion: V5_DURABLE_SCHEMA_VERSION, mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION,
    readModelVersion: V5_READ_MODEL_VERSION, schedulerVersion: V5_SCHEDULER_VERSION, keyedRandomVersion: KEYED_RANDOM_VERSION_V1,
    canonicalBundleHash: input.canonicalBundleHash, mechanicsVariablesHash: mechanicsVariablesHash(input.mechanics), causalOwnerInputsHash: causalOwnerInputsHash(input.causalOwnerInputs),
    operationalConfigHash: operationalConfigHash(input.operational), diagnosticConfigHash: diagnosticConfigHash(input.diagnostic), labelInputHash: labelInputHash(input.labels ?? {}),
    normalizedSeed: input.normalizedSeed, mechanicsVariables: input.mechanics, causalOwnerInputs: input.causalOwnerInputs, operationalConfig: input.operational, diagnosticConfig: input.diagnostic, labels: input.labels ?? {},
  };
  return { ...core, runManifestHash: hash(core) };
}

export function v5RuntimeCompatibilityErrors(manifest: V5RunManifest): string[] {
  const expected = {
    durableStateSchemaVersion: V5_DURABLE_SCHEMA_VERSION,
    mechanicsVersion: V5_MECHANICS_VERSION,
    causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION,
    schedulerVersion: V5_SCHEDULER_VERSION,
    keyedRandomVersion: KEYED_RANDOM_VERSION_V1,
  } as const;
  return Object.entries(expected).flatMap(([field, value]) => manifest[field as keyof V5RunManifest] === value ? [] : [`${field}:${String(manifest[field as keyof V5RunManifest])}!=${value}`]);
}

export function buildNonCausalLabelManifestUpdateV5(manifest: V5RunManifest, labels: Record<string, string>): V5RunManifest {
  const { runManifestHash: _priorHash, ...priorCore } = manifest;
  const core = { ...priorCore, labelInputHash: labelInputHash(labels), labels };
  return { ...core, runManifestHash: hash(core) };
}

export function restoreWorldStateV5(value: unknown): WorldStateV5 {
  const state = structuredClone(value) as Omit<WorldStateV5, "cohorts"> & { cohorts: { settlementId: string; breedId: string; tiers: Record<"HIGH" | "MID" | "LOW", { population: bigint | string; prosperity: number }> }[] };
  return { ...state, worldRoutes: state.worldRoutes ?? [], cohorts: state.cohorts.map((cell) => ({ ...cell, tiers: {
    HIGH: { ...cell.tiers.HIGH, population: BigInt(cell.tiers.HIGH.population) },
    MID: { ...cell.tiers.MID, population: BigInt(cell.tiers.MID.population) },
    LOW: { ...cell.tiers.LOW, population: BigInt(cell.tiers.LOW.population) },
  } })) } as WorldStateV5;
}

export function v5CheckpointHash(state: WorldStateV5): string { return hash(state); }
export function v5EventHistoryHash(events: readonly CausalEventV5[]): string { return extendV5EventHistoryHash(V5_EMPTY_EVENT_HISTORY_HASH, events); }

export function assertReplayEquivalent(expectedStateHash: string, expectedEventHash: string, state: WorldStateV5, events: readonly CausalEventV5[]): void {
  const stateHash = v5CheckpointHash(state); const eventHash = v5EventHistoryHash(events);
  if (stateHash !== expectedStateHash) throw new Error(`V5 replay state mismatch ${stateHash} != ${expectedStateHash}`);
  if (eventHash !== expectedEventHash) throw new Error(`V5 replay event mismatch ${eventHash} != ${expectedEventHash}`);
}
