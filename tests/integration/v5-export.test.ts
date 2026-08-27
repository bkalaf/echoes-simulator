import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPersistedV5Export } from "../../src/core/export/persisted-export.js";
import { verifyExportZip } from "../../src/core/export/exporter.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { runPersistedV5Diagnostic } from "../../src/core/v5/service.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

describe("V5 persisted read/export compatibility", () => {
  it("exports a completed V5 checkpoint through the existing verified ZIP contract", () => {
    const store = new SimulatorStore(resolve(mkdtempSync(resolve(tmpdir(), "echoes-v5-export-")), "run.sqlite"));
    try {
      const run = runPersistedV5Diagnostic({ store, resourceDirectory: resolve("resources"), normalizedSeed: normalizeSeed("V5_EXPORT_FIXTURE"), throughYear: 0 });
      expect(run.status).toBe("COMPLETE");
      const generated = buildPersistedV5Export(store, run.runId, resolve("resources/canonical"));
      const verified = verifyExportZip(generated.bytes);
      expect(verified.valid).toBe(true);
      expect(verified.manifest).toMatchObject({ runId: run.runId, mode: "DIAGNOSTIC", yearEnd: 0 });
    } finally { store.close(); }
  }, 30_000);
});
