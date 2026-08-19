import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { bootstrapCanonicalRun } from "../../src/core/engine/canonical-runner.js";
import { preflightRealBundle } from "../../src/core/inputs/preflight.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

test("launches with the current persisted preflight and canonical naming barrier", async () => {
  const rendererErrors: string[] = [];
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-e2e-"));
  const pack = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18");
  const v3 = resolve("ECHOES_OF_EIDOLON_BREED_RESEARCH_V3_RESEARCH_COMPLETE.zip");
  const report = preflightRealBundle(pack, resolve(pack, "echoes_of_eidolon_breed_research_2026-08-17.zip"), v3);
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  store.savePreflight({ preflightId: "PREFLIGHT_E2E_CURRENT", createdAt: "2026-08-19T17:00:00.000Z", inputDirectory: pack, inputManifestIdentity: "e2e", startingResearchHash: report.sourceRoles.august17StartingAuthority.sha256, v3ResearchHash: report.sourceRoles.v3SemanticAuthority!.sha256, report });
  bootstrapCanonicalRun({ store, seed: "EIDOLON_E2E_CANONICAL", packDirectory: pack, v3ResearchZip: v3, resourceDirectory: resolve("resources") });
  store.close();

  const application = await electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", `--user-data-dir=${userData}`, "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" },
  });
  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") rendererErrors.push(message.text()); });
    await expect(page).toHaveTitle(/Echoes of Eidolon/i);
    await expect.poll(() => page.evaluate(() => typeof window.eidolonSimulator)).toBe("object");
    await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeVisible();
    await expect(page.getByText("WAITING_FOR_NAMING", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Setup & Preflight" }).click();
    await expect(page.getByText("READY", { exact: true })).toBeVisible();
    await expect(page.getByText("BREED_IDENTITY_CONFLICT")).toHaveCount(0);
    await expect(page.getByText("MISSING_COMPLETE_V3_RESEARCH_PACK")).toHaveCount(0);
    mkdirSync(resolve("artifacts/simulator/live-ui"), { recursive: true });
    await page.screenshot({ path: resolve("artifacts/simulator/live-ui/current-preflight.png"), fullPage: true });

    await page.getByRole("button", { name: "Naming Queue" }).click();
    await expect(page.getByText(/NAMING_JOB_/)).toBeVisible();
    await expect(page.getByLabel("Naming response JSON")).toBeVisible();
    expect(rendererErrors).toEqual([]);
  } finally {
    await application.close();
  }
});
