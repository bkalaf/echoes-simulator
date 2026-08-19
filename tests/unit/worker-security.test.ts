import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkerRequest } from "../../electron/ipc-contract.js";

describe("worker and renderer security", () => {
  it("rejects unknown worker schema versions", () => {
    expect(() => parseWorkerRequest({ schemaVersion: "unknown", requestId: "r", action: "STATUS", payload: {} })).toThrow();
  });

  it("pins Electron isolation and a narrow preload", () => {
    const main = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../../electron/preload.cts", import.meta.url), "utf8");
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain('"preload.cjs"');
    expect(preload).not.toContain("ipcRenderer.send");
    expect(preload).not.toContain("require(\"fs\")");
  });
});
