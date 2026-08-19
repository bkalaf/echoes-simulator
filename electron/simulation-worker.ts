import { parentPort } from "node:worker_threads";
import { parseWorkerRequest, WORKER_SCHEMA_VERSION } from "./ipc-contract.js";
import { runDiagnosticHistory } from "../src/core/engine/diagnostic-runner.js";
import { preflightRealBundle } from "../src/core/inputs/preflight.js";

parentPort?.on("message", (candidate: unknown) => {
  try {
    const request = parseWorkerRequest(candidate);
    let payload: unknown = { acceptedAction: request.action };
    if (request.action === "RUN_DIAGNOSTIC") {
      const seed = typeof request.payload.seed === "string" ? request.payload.seed : "EIDOLON_DESKTOP_DIAGNOSTIC_V1";
      const result = runDiagnosticHistory(seed, String(request.payload.resourceDirectory));
      payload = {
        runId: result.runId,
        mode: result.mode,
        finalYear: result.finalYear,
        djtYear: result.djtYear,
        checkpointCount: result.checkpointCount,
        namingJobCount: result.namingJobCount,
        contentDigest: result.contentDigest,
        audit: result.audit,
        worlds: Object.fromEntries(Object.entries(result.worlds).map(([key, world]) => [key, { finalPopulation: world.finalPopulation.toString(), settlements: world.settlements.length, states: world.stateCount, federalCapitalSiteId: world.federalCapitalSiteId, events: world.events.length }])),
      };
    }
    if (request.action === "VALIDATE_REAL_INPUTS") {
      if (typeof request.payload.packDirectory !== "string") throw new Error("packDirectory is required");
      payload = preflightRealBundle(request.payload.packDirectory, typeof request.payload.supplementalZip === "string" ? request.payload.supplementalZip : undefined);
    }
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId: request.requestId, ok: true, payload });
  } catch (error) {
    parentPort?.postMessage({ schemaVersion: WORKER_SCHEMA_VERSION, requestId: "UNKNOWN", ok: false, error: error instanceof Error ? error.message : "Invalid worker request" });
  }
});
