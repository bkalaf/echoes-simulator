import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operator runtime data boundaries", () => {
  it("never reads archived verification artifacts for live operator state", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    const packageJson = readFileSync("package.json", "utf8");

    expect(electronMain).not.toContain("finalEvidence");
    expect(electronMain).not.toContain("readJsonIfPresent");
    expect(electronMain).not.toContain("artifacts/implementation/final-verification");
    expect(packageJson).not.toContain('"to": "final-verification"');
  });

  it("passes explicit starting and V3 research authorities through the worker", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    const worker = readFileSync("electron/simulation-worker.ts", "utf8");

    expect(electronMain).toContain("startingResearchZip");
    expect(electronMain).toContain("v3ResearchZip");
    expect(worker).toContain("request.payload.startingResearchZip");
    expect(worker).toContain("request.payload.v3ResearchZip");
    expect(worker).toMatch(/preflightRealBundle\([\s\S]*startingResearchZip[\s\S]*v3ResearchZip/);
  });

  it("assigns the returned live validation report to renderer state", () => {
    const renderer = readFileSync("src/main.tsx", "utf8");

    expect(renderer).toMatch(/const report = await window\.eidolonSimulator\.validateInputs/);
    expect(renderer).toMatch(/setSnapshot\([\s\S]*preflight: report/);
  });

  it("uses version-neutral semantic-authority wording in the renderer", () => {
    const renderer = readFileSync("src/main.tsx", "utf8");

    expect(renderer).not.toContain("V3 semantic authority");
    expect(renderer).not.toContain("persisted V3 authority");
  });
});
