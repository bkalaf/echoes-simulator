import { parentPort } from "node:worker_threads";
import { parseWorkerRequest, WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { runDiagnosticHistory } from "../src/core/engine/diagnostic-runner.js";

parentPort?.on("message", (candidate: unknown) => {
  try {
    const request = parseWorkerRequest(candidate);
    let payload: unknown = { acceptedAction: request.action };
    if (request.action === "RUN_DIAGNOSTIC") {
      const seed = typeof request.payload.seed === "string" ? request.payload.seed : "EIDOLON_DESKTOP_DIAGNOSTIC_V1";
      payload = runDiagnosticHistory(seed, String(request.payload.resourceDirectory));
    }
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, ok: true, payload });
  } catch (error) {
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId: "UNKNOWN", ok: false, error: error instanceof Error ? error.message : "Invalid worker request" });
  }
});
