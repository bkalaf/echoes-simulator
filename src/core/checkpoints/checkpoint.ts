import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CheckpointEnvelope, WorldKey } from "../contracts/domain.js";

export function checkpointDigest(state: unknown): string {
  return createHash("sha256").update(canonicalJson(state), "utf8").digest("hex");
}

export function createReplayCheckpoint<T extends { year: number }>(input: {
  runId: string;
  worldKey: WorldKey;
  state: T;
  engineVersion: string;
  policyVersion: string;
}): CheckpointEnvelope<T> {
  const state = structuredClone(input.state);
  const stateHash = checkpointDigest(state);
  return {
    schemaVersion: "eidolon-simulator-checkpoint-v1",
    checkpointId: `CHECKPOINT_${input.runId}_${input.worldKey}_${state.year}_${stateHash.slice(0, 16)}`,
    runId: input.runId,
    worldKey: input.worldKey,
    year: state.year,
    stateHash,
    state,
    engineVersion: input.engineVersion,
    policyVersion: input.policyVersion,
  };
}

export function restoreReplayCheckpoint<T>(checkpoint: CheckpointEnvelope<T>): T {
  const actual = checkpointDigest(checkpoint.state);
  if (actual !== checkpoint.stateHash) throw new Error(`Checkpoint state hash mismatch: ${actual} != ${checkpoint.stateHash}`);
  return structuredClone(checkpoint.state);
}

export function replayFromCheckpoint<T, E>(checkpoint: CheckpointEnvelope<T>, events: readonly E[], reducer: (state: T, event: E) => T): T {
  return events.reduce((state, event) => reducer(state, event), restoreReplayCheckpoint(checkpoint));
}
