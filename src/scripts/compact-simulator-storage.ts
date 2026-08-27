import { resolve } from "node:path";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const databasePath = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: compact-simulator-storage <simulator.sqlite> [runId]");
const store = new SimulatorStore(databasePath);
try {
  const runId = process.argv[3] ?? store.selectedRun()?.runId;
  if (!runId) throw new Error("No canonical run is available to compact");
  const result = store.compactCanonicalStorage(runId, (message) => process.stdout.write(`${message}\n`));
  process.stdout.write(`verified compaction · ${JSON.stringify(result)}\n`);
  store.reclaimFreePages();
  process.stdout.write(`vacuum complete · ${databasePath}\n`);
} finally {
  store.close();
}
