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

  it("exposes Breed Detail and a POI-only Atlas without weakening the preload boundary", () => {
    const renderer = readFileSync("src/main.tsx", "utf8");
    const preload = readFileSync("electron/preload.cts", "utf8");
    expect(renderer).toContain('"Breed Detail"');
    expect(renderer).toContain('"Atlas"');
    expect(preload).toContain("getBreedCatalog");
    expect(preload).toContain("getBreedPopulation");
    expect(preload).toContain("getAtlasData");
  });

  it("keeps heavyweight V5 reads away from the Electron window loop and coalesces polling", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    const renderer = readFileSync("src/main.tsx", "utf8");
    const worker = readFileSync("electron/simulation-worker.ts", "utf8");
    expect(electronMain).toContain("v5CausalEventCount");
    expect(electronMain).not.toMatch(/listV5CausalEvents\([^\n]+\)\.length/);
    expect(renderer).toContain("refreshInFlight");
    expect(renderer).not.toContain("setInterval(() => { void refresh(true); }, 2_000)");
    expect(worker).toContain('request.action === "GET_V5_RUN_VIEW"');
  });

  it("exposes folder export and ZIP-wide response upload on the V5 Naming Queue", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    const preload = readFileSync("electron/preload.cts", "utf8");
    const renderer = readFileSync("src/main.tsx", "utf8");
    expect(electronMain).toContain('"simulator:export-all-naming-prompts"');
    expect(electronMain).toContain('"simulator:upload-all-naming-responses"');
    expect(preload).toContain("exportAllNamingPrompts");
    expect(preload).toContain("uploadAllNamingResponses");
    expect(renderer).toContain("EXPORT ALL PROMPTS");
    expect(renderer).toContain("UPLOAD ALL RESPONSES (.ZIP)");
  });
});
