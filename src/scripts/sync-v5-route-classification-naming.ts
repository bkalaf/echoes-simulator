import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { loadRouteClassificationAuthority } from "../core/v5/route-classification.js";
import { buildNonCausalRouteNamingRequests } from "../core/v5/routes.js";
import type { WorldKey } from "../core/v5/types.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const databasePath = argument("--database");
const runId = argument("--run-id");
const resourceDirectory = resolve(argument("--resources") ?? "resources");
if (!databasePath || !runId) throw new Error("--database and --run-id are required");
if (argument("--confirm") !== "NONCAUSAL_ROUTE_NAMING_SYNC") throw new Error("Explicit --confirm NONCAUSAL_ROUTE_NAMING_SYNC is required");

const store = new SimulatorStore(resolve(databasePath));
try {
  const manifest = store.loadV5RunManifest(runId);
  const run = store.getRun(runId);
  if (!manifest || !run) throw new Error(`Unknown V5 run ${runId}`);
  const canonical = loadBundledCanonicalV5(resolve(resourceDirectory, "canonical"));
  const authority = loadRouteClassificationAuthority(resourceDirectory, canonical.routeCorridors);
  const worlds: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
  const causalFingerprint = (): string => createHash("sha256").update(canonicalJson({
    manifest: store.loadV5RunManifest(runId),
    events: worlds.map((world) => store.listV5CausalEvents(runId, world)),
    checkpoints: worlds.map((world) => store.listV5CheckpointMetadata(runId, world)),
  })).digest("hex");
  const before = causalFingerprint();
  const existing = store.listV5NamingRequests(runId);
  const additions = worlds.flatMap((world) => {
    const state = store.loadLatestV5Checkpoint(runId, world, run.currentYear ?? manifest.targetYear)?.state;
    return state ? buildNonCausalRouteNamingRequests(state, canonical, authority, manifest.causalOwnerInputs, manifest.mechanicsVariables, existing) : [];
  });
  store.saveV5NamingRequests(runId, additions);
  const batches = store.materializePendingV5NamingBatches(runId, manifest.operationalConfig.namingBatchMaximum);
  const after = causalFingerprint();
  if (before !== after) throw new Error("Non-causal Route naming sync changed causal manifest/events/checkpoints");
  process.stdout.write(`${JSON.stringify({ runId, authorityVersion: authority.authorityVersion, approvedCorridors: authority.classifications.length, namingRequestsAdded: additions.length, pendingImmutableBatches: batches.length, causalFingerprint: after, causalIdentityPreserved: true })}\n`);
} finally {
  store.close();
}
