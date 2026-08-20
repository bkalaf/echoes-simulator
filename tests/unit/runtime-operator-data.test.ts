import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operator runtime data boundaries", () => {
  it("loads only bundled canonical resources and never archived verification artifacts", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    expect(electronMain).toContain("loadBundledCanonical(runtimeResources)");
    expect(electronMain).not.toMatch(/finalEvidence|readJsonIfPresent|artifacts\/implementation\/final-verification/);
  });

  it("contains no manual input selection or validation IPC/UI", () => {
    const runtime = ["electron/main.ts", "electron/preload.cts", "src/main.tsx", "src/electron-api.d.ts"].map((filename) => readFileSync(filename, "utf8")).join("\n");
    expect(runtime).not.toMatch(/Setup & Preflight|SELECT & VALIDATE|selectInputDirectory|validateInputs|revalidateInputs|simulator:select-input-directory|simulator:validate-inputs/);
  });

  it("packages and verifies the one canonical resource boundary", () => {
    const packageJson = readFileSync("package.json", "utf8");
    expect(packageJson).toContain("pnpm canonical:verify");
    expect(packageJson).toContain('"from": "resources"');
    expect(readFileSync("resources/canonical/canonical_bundle_manifest.json", "utf8")).toContain('"buildReady": true');
  });
});
