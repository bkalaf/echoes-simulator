import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

async function launch(userData: string, environment: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", `--user-data-dir=${userData}`, "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", ...environment },
  });
}

test("clean startup is V5-first and legacy V4 diagnostics persist behind Diagnostics", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-clean-"));
  let application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Canonical data is simulation-ready.", { exact: true })).toBeVisible();
    await expect(page.getByText("V5 DIAGNOSTIC READY", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /RUN LEGACY V4/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "RUN V5 TO YEAR 25" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Setup & Preflight" })).toHaveCount(0);
    await expect(page.getByText("SELECT & VALIDATE", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await page.getByRole("button", { name: "RUN LEGACY V4 DIAGNOSTIC" }).click();
    await expect(page.getByText(/DIAGNOSTIC · COMPLETE · 2000/)).toBeVisible({ timeout: 60_000 });
  } finally { await application.close(); }

  application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await expect(page.getByText("LEGACY V4 RUNS", { exact: true })).toBeVisible();
    await expect(page.getByText(/DIAGNOSTIC · COMPLETE · 2000/)).toBeVisible();
    await expect(page.getByText("Canonical data is simulation-ready.", { exact: true })).toBeVisible();
  } finally { await application.close(); }
});

test("canonical naming supports visible rejection, individual acceptance, and atomic world batches", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-canonical-"));
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await page.getByRole("button", { name: "RUN LEGACY V4 CANONICAL" }).click();
    await expect(page.getByText("Run paused for required naming.", { exact: true })).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Naming Queue" }).click();
    const prompt = page.locator("textarea").first();
    await expect(prompt).toContainText("dominantFaction");
    await expect(prompt).toContainText("politicalForm");
    await expect(prompt).toContainText("economicForm");
    await expect(prompt).toContainText("dominantBreed");
    const namingResponses = await page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingNamingJob: { namingJobId: string; context: { world: string }; items: { requestId: string; entityType: string }[] }; pendingNamingBatches: { namingBatchId: string }[] }> } }).eidolonSimulator;
      const snapshot = await simulator.getOperatorSnapshot();
      const job = snapshot.pendingNamingJob;
      return {
        namingBatchId: snapshot.pendingNamingBatches[0]!.namingBatchId,
        namingJobId: job.namingJobId,
        rejected: JSON.stringify({ schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, results: job.items.map((item, index) => ({ requestId: item.requestId, name: `Rejected E2E Name ${index + 1}` })) }),
        accepted: JSON.stringify({ schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: job.items.map((item, index) => ({
          requestId: item.requestId, entityType: item.entityType, decision: "NEW", name: `E2E Owner Name ${index + 1}`,
          ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "The calculated founding settlement", sizeDescription: "Initial settlement government", structureDescription: "Uses the calculated political and economic forms" } : {}),
          ...(item.entityType === "FAMILY" ? { roleLabel: "Founding governing family" } : {}),
        })) }),
      };
    });
    await page.getByLabel("Naming response JSON").fill(namingResponses.rejected);
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("alert")).toContainText("REJECTED");
    await expect(page.getByRole("alert")).toContainText("decisions: Invalid input");
    await expect(page.getByRole("heading", { name: namingResponses.namingBatchId })).toBeVisible();
    await page.getByLabel("Naming response JSON").fill(namingResponses.accepted);
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("status")).toContainText("Naming response accepted and persisted.", { timeout: 60_000 });
    await expect(page.getByText("CONCORD · year 1 · 24 jobs · 87 exact requests", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Settlement Detail" }).click();
    await expect(page.getByLabel("Select Settlement")).toBeVisible();
    await page.getByRole("button", { name: "Naming Queue" }).click();
    const currentBatchResponse = async (): Promise<string> => page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingNamingBatches: { namingBatchId: string; jobs: { namingJobId: string; items: { requestId: string; entityType: string }[] }[] }[] }> } }).eidolonSimulator;
      const batch = (await simulator.getOperatorSnapshot()).pendingNamingBatches[0]!;
      return JSON.stringify({
        schemaVersion: "eidolon-simulator-naming-batch-response-v1",
        namingBatchId: batch.namingBatchId,
        jobs: batch.jobs.map((job, jobIndex) => ({
          namingJobId: job.namingJobId,
          decisions: job.items.map((item, itemIndex) => ({
            requestId: item.requestId, entityType: item.entityType, decision: "NEW",
            name: item.entityType === "FAMILY" ? `House E2E Lineage ${jobIndex + 1}` : `E2E Batch Name ${jobIndex + 1}-${itemIndex + 1}`,
            ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "The calculated founding settlement", sizeDescription: "Initial settlement government", structureDescription: "Uses the calculated political and economic forms" } : {}),
            ...(item.entityType === "FAMILY" ? { roleLabel: "Founding governing family" } : {}),
          })),
        })),
      });
    });
    const batchResponse = await currentBatchResponse();
    await page.getByLabel("Naming response JSON").fill(batchResponse);
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("status")).toContainText("Naming batch accepted: 24 jobs and 87 decisions persisted.", { timeout: 60_000 });
    await expect(page.getByText("SCHISM · year 1 · 24 jobs · 87 exact requests", { exact: true })).toBeVisible();
    await page.getByLabel("Naming response JSON").fill(await currentBatchResponse());
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("status")).toContainText("Naming batch accepted: 24 jobs and 87 decisions persisted.", { timeout: 10_000 });
    await expect(page.getByText("RUIN · year 1 · 24 jobs · 87 exact requests", { exact: true })).toBeVisible();
    await page.getByLabel("Naming response JSON").fill(await currentBatchResponse());
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("status")).toContainText("History continuation is running in the background.", { timeout: 10_000 });
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await expect(page.getByText("Archived V4 run controls", { exact: true })).toBeVisible();
  } finally { await application.close(); }
});

test("Breed Detail search and the POI-only master Atlas render through desktop IPC", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-operator-views-"));
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Breed Detail" }).click();
    await page.getByLabel("Search Breeds").fill("Orycteropus afer");
    await expect(page.getByLabel("Select Breed").locator("option")).toHaveCount(2, { timeout: 20_000 });
    await page.getByLabel("Select Breed").selectOption("BRD_AARDVARK");
    await expect(page.getByRole("heading", { name: "Aardvark", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Atlas" }).click();
    await expect(page.getByRole("img", { name: "Master Atlas world map" })).toBeVisible();
    await expect(page.locator(".poi-marker")).toHaveCount(92);
    await expect(page.locator(".atlas-stage .atlas-settlement")).toHaveCount(0);
  } finally { await application.close(); }
});

test("V5 operator views render persisted economics, comparisons, routes, people, families, and chambers", async () => {
  test.setTimeout(180_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-v5-views-"));
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "RUN V5 TO YEAR 25" }).click();
    await expect(page.getByText(/V5_DIAGNOSTIC_.*COMPLETE.*year 25/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Settlement Detail" }).click();
    await expect(page.getByLabel("Select Settlement")).toBeVisible();
    await expect(page.getByText("No resolved denominator", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "State Detail" }).click();
    await expect(page.getByLabel("Select State")).toBeVisible();
    const stateOptions = page.getByLabel("Select State").locator("option:not([disabled])");
    expect(await stateOptions.count()).toBeGreaterThan(1);
    await page.getByLabel("Select State").selectOption({ index: 2 });
    await expect(page.getByText("Actual government", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cities" }).click();
    await expect(page.getByLabel("Cross-world Cities comparison")).toBeVisible();
    await expect(page.locator(".city-world.faction-fill-concord, .city-world.faction-fill-schism, .city-world.faction-fill-ruin").first()).toBeVisible();
    expect(await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return [styles.getPropertyValue("--faction-concord").trim(), styles.getPropertyValue("--faction-schism").trim(), styles.getPropertyValue("--faction-ruin").trim()];
    })).toEqual(["#246edb", "#e6bd31", "#c9443b"]);
    await page.getByRole("button", { name: "Routes" }).click();
    await expect(page.getByLabel("Named Routes")).toBeVisible();
    await expect(page.getByText("38 physical Region corridors", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Atlas" }).click();
    await expect(page.getByLabel(/route overlay/).first()).toBeVisible();
    await page.getByLabel(/route overlay/).first().click();
    await expect(page.getByText("SELECTED ROUTE", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /POI-080 Highcourt Isle/ }).click();
    await expect(page.getByText("SITE-036", { exact: true })).toBeVisible();
    await expect(page.getByText("R06 · Highcourt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "People" }).click();
    await expect(page.getByLabel("Political People")).toBeVisible();
    await expect(page.getByLabel("People Family")).toBeVisible();
    await expect(page.getByLabel("People Office")).toBeVisible();
    await expect(page.getByText("PERSON DETAIL", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Families" }).click();
    await expect(page.getByLabel("Families")).toBeVisible();
    await expect(page.getByText("FAMILY / LEGACY DETAIL", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Conclave" }).click();
    await expect(page.getByLabel("CONCLAVE chamber")).toBeVisible();
    await page.getByRole("button", { name: "Senate" }).click();
    await expect(page.getByLabel("SENATE chamber")).toBeVisible();
  } finally { await application.close(); }
});

test("V5 year-2000 launch exposes live worker progress without legacy controls", async () => {
  test.setTimeout(60_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-v5-progress-"));
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "2000", exact: true }).click();
    await page.getByRole("button", { name: "RUN V5 TO YEAR 2000" }).click();
    await expect(page.getByText("V5 RUNNING", { exact: true })).toBeVisible();
    await expect(page.getByText(/year \d+ \/ 2000/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/phase .*last checkpoint .*next checkpoint/)).toBeVisible();
    await expect(page.getByRole("button", { name: /RUN LEGACY V4/ })).toHaveCount(0);
  } finally { await application.close(); }
});

test("invalid packaged canonical data is an internal defect with no validation workflow", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-invalid-"));
  const invalidResources = mkdtempSync(join(tmpdir(), "eidolon-invalid-resources-"));
  const application = await launch(userData, { EIDOLON_SIMULATOR_RESOURCE_DIRECTORY: invalidResources });
  try {
    const page = await application.firstWindow();
    await expect(page.getByText(/BUNDLED_CANONICAL_DATA_INVALID/).first()).toBeVisible();
    await page.getByRole("button", { name: "Diagnostics" }).click();
    await expect(page.getByRole("button", { name: "RUN LEGACY V4 CANONICAL" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "RUN LEGACY V4 DIAGNOSTIC" })).toBeEnabled();
    await expect(page.getByText("SELECT & VALIDATE", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Setup & Preflight" })).toHaveCount(0);
  } finally { await application.close(); }
});
