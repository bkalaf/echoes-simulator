import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkerRequest } from "../../electron/ipc-contract.js";

describe("worker and renderer security", () => {
  it("rejects unknown worker schema versions", () => {
    expect(() => parseWorkerRequest({ schemaVersion: "unknown", requestId: "r", action: "STATUS", payload: {} })).toThrow();
  });

  it("routes canonical continuation through the worker contract", () => {
    expect(parseWorkerRequest({ schemaVersion: "eidolon-simulator-worker-v1", requestId: "resume-1", action: "RESUME_CANONICAL", payload: { runId: "RUN_1" } }).action).toBe("RESUME_CANONICAL");
  });

  it("routes heavyweight Breed history reads through the worker contract", () => {
    expect(parseWorkerRequest({ schemaVersion: "eidolon-simulator-worker-v1", requestId: "breed-1", action: "GET_BREED_POPULATION", payload: { runId: "RUN_1", breedId: "BRD_AARDVARK", year: 10 } }).action).toBe("GET_BREED_POPULATION");
  });

  it("pins Electron isolation and a narrow preload", () => {
    const main = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../../electron/preload.cts", import.meta.url), "utf8");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain('"preload.cjs"');
    expect(main).toContain('runWorker("RESUME_CANONICAL"');
    expect(main).not.toContain("resumeCanonicalRun({ store: getStore()");
    expect(preload).not.toContain("ipcRenderer.send");
    expect(preload).not.toContain("require(\"fs\")");
  });
});
