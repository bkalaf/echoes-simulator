import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

async function launch(userData: string, environment: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", `--user-data-dir=${userData}`, "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", ...environment },
  });
}

test("clean startup auto-loads V4 and a diagnostic persists across restart", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-clean-"));
  let application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Canonical data is simulation-ready.", { exact: true })).toBeVisible();
    await expect(page.getByText("V4 · SIMULATION READY", { exact: true })).toBeVisible();
    await expect(page.getByText("PASS", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "RUN DIAGNOSTIC" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "RUN CANONICAL" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Setup & Preflight" })).toHaveCount(0);
    await expect(page.getByText("SELECT & VALIDATE", { exact: true })).toHaveCount(0);
    mkdirSync(resolve("artifacts/simulator/live-ui"), { recursive: true });
    await page.screenshot({ path: resolve("artifacts/simulator/live-ui/v4-ready-clean-startup.png"), fullPage: true });
    await page.getByRole("button", { name: "RUN DIAGNOSTIC" }).click();
    await expect(page.getByText("DIAGNOSTIC_COMPLETE", { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally { await application.close(); }

  application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("DIAGNOSTIC_COMPLETE", { exact: true })).toBeVisible();
    await expect(page.getByText(/DIAGNOSTIC · COMPLETE · 2000/)).toBeVisible();
    await expect(page.getByText("Canonical data is simulation-ready.", { exact: true })).toBeVisible();
  } finally { await application.close(); }
});

test("canonical naming acceptance resumes the persisted engine beyond year zero", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-canonical-"));
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "RUN CANONICAL" }).click();
    await expect(page.getByText("Run paused for required naming.", { exact: true })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Naming Queue" }).click();
    const prompt = page.locator("textarea").first();
    await expect(prompt).toContainText("dominantFaction");
    await expect(prompt).toContainText("politicalForm");
    await expect(prompt).toContainText("economicForm");
    await expect(prompt).toContainText("dominantBreed");
    const response = await page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingNamingJob: { namingJobId: string; items: { requestId: string; entityType: string }[] } }> } }).eidolonSimulator;
      const job = (await simulator.getOperatorSnapshot()).pendingNamingJob;
      return JSON.stringify({ schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: job.items.map((item, index) => ({
        requestId: item.requestId, entityType: item.entityType, decision: "NEW", name: `E2E Owner Name ${index + 1}`,
        ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "The calculated founding settlement", sizeDescription: "Initial settlement government", structureDescription: "Uses the calculated political and economic forms" } : {}),
        ...(item.entityType === "FAMILY" ? { roleLabel: "Founding governing family" } : {}),
      })) });
    });
    await page.getByLabel("Naming response JSON").fill(response);
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByText(/year 1 · 3 exact request\(s\)/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Runs" }).click();
    await expect(page.getByText("1 / 2000", { exact: true })).toBeVisible();
    mkdirSync(resolve("artifacts/simulator/live-ui"), { recursive: true });
    await page.screenshot({ path: resolve("artifacts/simulator/live-ui/v4-ready-naming-resumed.png"), fullPage: true });
  } finally { await application.close(); }
});

test("invalid packaged canonical data is an internal defect with no validation workflow", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-invalid-"));
  const invalidResources = mkdtempSync(join(tmpdir(), "eidolon-invalid-resources-"));
  const application = await launch(userData, { EIDOLON_SIMULATOR_RESOURCE_DIRECTORY: invalidResources });
  try {
    const page = await application.firstWindow();
    await expect(page.getByText(/BUNDLED_CANONICAL_DATA_INVALID/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "RUN CANONICAL" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "RUN DIAGNOSTIC" })).toBeEnabled();
    await expect(page.getByText("SELECT & VALIDATE", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Setup & Preflight" })).toHaveCount(0);
  } finally { await application.close(); }
});
