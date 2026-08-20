import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

async function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", `--user-data-dir=${userData}`, "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" },
  });
}

test("clean startup is truthful and a diagnostic persists across restart", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-clean-"));
  let application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Inputs have not been validated.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "RUN DIAGNOSTIC" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "RUN CANONICAL" })).toBeDisabled();
    await expect(page.getByText("Validate a simulation-ready V4 input bundle first.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Setup & Preflight" }).click();
    await expect(page.getByText("NOT VALIDATED", { exact: true })).toHaveCount(2);
    await expect(page.getByText("0 active blockers")).toHaveCount(0);
    await page.getByRole("button", { name: "Runs" }).click();
    await page.getByRole("button", { name: "RUN DIAGNOSTIC" }).click();
    await expect(page.getByText("DIAGNOSTIC_COMPLETE", { exact: true })).toBeVisible({ timeout: 20_000 });
  } finally {
    await application.close();
  }

  application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("DIAGNOSTIC_COMPLETE", { exact: true })).toBeVisible();
    await expect(page.getByText(/DIAGNOSTIC · COMPLETE · 2000/)).toBeVisible();
    await expect(page.getByText("Inputs have not been validated.", { exact: true })).toBeVisible();
    mkdirSync(resolve("artifacts/simulator/live-ui"), { recursive: true });
    await page.screenshot({ path: resolve("artifacts/simulator/live-ui/operator-state-hotfix.png"), fullPage: true });
  } finally {
    await application.close();
  }
});

test("a current simulation-ready V4 preflight enables canonical run", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-ready-"));
  const authorityFilename = "fixture-v4-simulation-ready.zip";
  const authorityBytes = Buffer.from("fixture-v4-simulation-ready");
  const authoritySha256 = createHash("sha256").update(authorityBytes).digest("hex");
  writeFileSync(join(userData, authorityFilename), authorityBytes);
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  store.savePreflight({
    preflightId: "PREFLIGHT_V4_READY", createdAt: "2026-08-19T18:00:00.000Z", inputDirectory: userData,
    inputManifestIdentity: "fixture-v4-ready", startingResearchHash: "starting-hash", v3ResearchHash: null,
    semanticAuthorityVersion: "V4", semanticAuthorityFilename: authorityFilename,
    semanticAuthoritySha256: authoritySha256, semanticAuthorityVerdict: "ACCEPT_SIMULATION_READY",
    report: {
      schemaVersion: "eidolon-simulator-real-preflight-v3", structuralStatus: "PASS", canonicalReady: true, activeIssues: [],
      semanticAuthorityVersion: "V4", semanticAuthorityFilename: authorityFilename,
      semanticAuthoritySha256: authoritySha256, semanticAuthorityVerdict: "ACCEPT_SIMULATION_READY", year0Readiness: "PASS",
      policyVersion: "OWNER_POLICY_2026_08_19_V4", engineReadinessVersion: "eidolon-simulator-engine-readiness-v1",
      counts: { breeds: 2056, civicBreeds: 1773, pets: 283 }, coverage: {}, inputFiles: [],
      sourceRoles: { v4SemanticAuthority: { filename: authorityFilename, sha256: authoritySha256, verdict: "ACCEPT_SIMULATION_READY" } },
    },
  });
  store.close();

  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Canonical inputs are validated and simulation-ready.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "RUN CANONICAL" })).toBeEnabled();
    await page.getByRole("button", { name: "Setup & Preflight" }).click();
    await expect(page.getByText(/Semantic authority: V4 · SIMULATION_READY/)).toBeVisible();
    await expect(page.getByText("READY", { exact: true })).toBeVisible();
  } finally {
    await application.close();
  }
});

test("a blocked preflight shows a nonzero blocker and consistent controls", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-blocked-"));
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  store.savePreflight({
    preflightId: "PREFLIGHT_V4_BLOCKED", createdAt: "2026-08-19T18:10:00.000Z", inputDirectory: userData,
    inputManifestIdentity: "fixture-v4-blocked", startingResearchHash: "starting-hash", v3ResearchHash: null,
    report: {
      schemaVersion: "eidolon-simulator-real-preflight-v3", structuralStatus: "PASS", canonicalReady: false,
      activeIssues: [{ issueCode: "V4_RESEARCH_NOT_VALIDATED", severity: "BLOCKER", blocksCanonical: true, message: "V4 research authority has not yet been validated." }],
      counts: { breeds: 2056, civicBreeds: 1773, pets: 283 }, coverage: {}, inputFiles: [], sourceRoles: {},
    },
  });
  store.close();

  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Canonical execution is blocked.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "RUN DIAGNOSTIC" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "RUN CANONICAL" })).toBeDisabled();
    await page.getByRole("button", { name: "Setup & Preflight" }).click();
    await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
    await expect(page.getByText("1 active blocker", { exact: true })).toBeVisible();
    await expect(page.getByText("V4_RESEARCH_NOT_VALIDATED", { exact: true })).toBeVisible();
  } finally {
    await application.close();
  }
});
