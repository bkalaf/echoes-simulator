import { parentPort } from "node:worker_threads";
import { parseWorkerRequest, WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { runDiagnosticHistory } from "../src/core/engine/diagnostic-runner.js";
import { resumeCanonicalRun } from "../src/core/engine/canonical-resume.js";
import { SimulatorStore } from "../src/persistence/sqlite-store.js";
import { resumePersistedV5Run, runPersistedV5Diagnostic } from "../src/core/v5/service.js";

parentPort?.on("message", (candidate: unknown) => {
  let requestId = "UNKNOWN";
  try {
    const request = parseWorkerRequest(candidate);
    requestId = request.requestId;
    let payload: unknown = { acceptedAction: request.action };
    if (request.action === "RUN_DIAGNOSTIC") {
      const seed = typeof request.payload.seed === "string" ? request.payload.seed : "EIDOLON_DESKTOP_DIAGNOSTIC_V1";
      payload = runDiagnosticHistory(seed, String(request.payload.resourceDirectory));
    }
    if (request.action === "RUN_V5_DIAGNOSTIC") {
      const store = new SimulatorStore(String(request.payload.databasePath));
      try {
        payload = runPersistedV5Diagnostic({ store, normalizedSeed: typeof request.payload.seed === "string" ? request.payload.seed : "EIDOLON_V5_DIAGNOSTIC", resourceDirectory: String(request.payload.resourceDirectory), throughYear: Number(request.payload.throughYear ?? 25) });
      } finally { store.close(); }
    }
    if (request.action === "RESUME_V5") {
      const store = new SimulatorStore(String(request.payload.databasePath));
      try { payload = resumePersistedV5Run({ store, runId: String(request.payload.runId), resourceDirectory: String(request.payload.resourceDirectory) }); }
      finally { store.close(); }
    }
    if (request.action === "RESUME_CANONICAL") {
      const databasePath = String(request.payload.databasePath);
      const runId = String(request.payload.runId);
      const canonicalDirectory = String(request.payload.canonicalDirectory);
      const store = new SimulatorStore(databasePath);
      try {
        const result = resumeCanonicalRun({ store, runId, canonicalDirectory });
        payload = { runId, status: result.status, currentYear: result.currentYear, nextNamingJobs: result.namingJobs.length };
      } finally {
        store.close();
      }
    }
    if (request.action === "GET_BREED_POPULATION") {
      const databasePath = String(request.payload.databasePath);
      const runId = String(request.payload.runId);
      const breedId = String(request.payload.breedId);
      const year = Number(request.payload.year);
      const store = new SimulatorStore(databasePath);
      try {
        payload = store.getBreedPopulationView(runId, breedId, Number.isFinite(year) ? Math.trunc(year) : 0);
      } finally {
        store.close();
      }
    }
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, ok: true, payload });
  } catch (error) {
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId, ok: false, error: error instanceof Error ? (error.stack ?? error.message) : "Invalid worker request" });
  }
});
