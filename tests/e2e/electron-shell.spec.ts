import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, V5_MECHANICS_VERSION, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { bootstrapWorldV5 } from "../../src/core/v5/bootstrap.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, buildV5RunManifest, extendV5EventHistoryHash } from "../../src/core/v5/persistence.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import type { WorldKey, WorldStateV5 } from "../../src/core/v5/types.js";
import { buildDerogatoryDecisionBatchV5 } from "../../src/core/v5/derogatory-decisions.js";
import { CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1 } from "../../src/core/v5/historical-policies.js";

async function launch(userData: string, environment: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", `--user-data-dir=${userData}`, "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1", ...environment },
  });
}

function writeNamingGeographyFixture(directory: string): string {
  const worlds = ["CONCORD", "SCHISM", "RUIN"] as const;
  const patterns = ["AAA", "AAB", "ABA", "BAA", "ABC", "INCOMPLETE"] as const;
  const routes = ["ROUTE_CORRIDOR_R01_R03", "ROUTE_CORRIDOR_R01_R04", "ROUTE_CORRIDOR_R01_R05", "ROUTE_CORRIDOR_R01_R06", "ROUTE_CORRIDOR_R01_R08", "ROUTE_CORRIDOR_R02_R04"];
  const labels = (pattern: typeof patterns[number]) => pattern === "AAA" ? ["Shared", " shared ", "SHARED"] : pattern === "AAB" ? ["Pair", "PAIR", "Odd"] : pattern === "ABA" ? ["Pair", "Odd", "PAIR"] : pattern === "BAA" ? ["Odd", "Pair", "PAIR"] : pattern === "ABC" ? ["One", "Two", "Three"] : [null, "Pending", "Pending"];
  const rows = (["SETTLEMENT", "POI", "ROUTE"] as const).flatMap((entityType) => patterns.map((pattern, index) => {
    const physicalIdentity = entityType === "SETTLEMENT" ? `SITE-00${index + 1}` : entityType === "POI" ? `POI-00${index + 1}` : routes[index]!;
    const oddWorld = pattern === "AAB" ? "RUIN" : pattern === "ABA" ? "SCHISM" : pattern === "BAA" ? "CONCORD" : null;
    const values = labels(pattern);
    return {
      entityType, physicalIdentity, secondaryReference: entityType === "ROUTE" ? "R01 ↔ R03" : "test-only physical identity", continentGroup: "Raukaam", pattern,
      comparisonAuditStatus: "COMPARISON_AWARE",
      atlasTarget: entityType === "SETTLEMENT" ? { kind: "SITE", ids: [physicalIdentity] } : entityType === "POI" ? { kind: "POI", ids: [physicalIdentity] } : { kind: "ROUTE", ids: ["R01", "R03"] },
      cells: Object.fromEntries(worlds.map((world, worldIndex) => [world, { worldKey: world, entityId: `${entityType}_${world}_${physicalIdentity}`, label: values[worldIndex], display: values[worldIndex] ?? "PENDING", status: values[worldIndex] ? "ACCEPTED" : "PENDING", source: values[worldIndex] ? "OWNER_INPUT" : null, cssClass: pattern === "ABC" ? "name-divergence-all" : oddWorld === world ? "name-divergence-odd" : pattern === "INCOMPLETE" ? "name-incomplete" : null }]))
    };
  }));
  rows.push({ entityType: "ROUTE", physicalIdentity: "ROUTE_CORRIDOR_R03_R06", secondaryReference: "R03 ↔ R06", continentGroup: "Raukaam", pattern: "INCOMPLETE", comparisonAuditStatus: "UNCOORDINATED", atlasTarget: { kind: "ROUTE", ids: ["R03", "R06"] }, cells: Object.fromEntries(worlds.map((world) => [world, { worldKey: world, entityId: `WORLD_ROUTE_${world}_ROUTE_CORRIDOR_R03_R06`, label: null, display: "NOT READY FOR NAMING", status: "MODE_UNRESOLVED", source: null, cssClass: "name-incomplete" }])) } as never);
  const path = join(directory, "naming-geography-fixture.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: "echoes-naming-geography-v1", year: 2000, rows, summaries: { Raukaam: { AAA: 3, AAB_FAMILY: 9, ABC: 3, INCOMPLETE: 4 } } }), "utf8");
  return path;
}

function writeNineBatchRestartFixture(userData: string): { runId: string; batchIds: string[]; responses: string[] } {
  const runId = "RUN_ELECTRON_NINE_BATCH_RESTART";
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
  const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, {}])));
  const operational = { ...DEFAULT_OPERATIONAL_CONFIG_V1, namingBatchMaximum: 2, interactiveNamingEnabled: true };
  const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 5, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: normalizeSeed("electron restart naming"), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
  store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_NAMING", seed: "seed", seedHash: "hash", policyVersion: "v5" });
  store.setRunStatus(runId, "WAITING_FOR_NAMING", 5);
  store.saveV5RunManifest(manifest);
  store.recordV5AcceptedLabel({ ledgerEntryId: "LEDGER_CANONICAL_FIXTURE", runId, worldKey: null, entityType: "SETTLEMENT", entityId: "CANONICAL_FIXTURE", label: "Canonical Fixture", source: "CANONICAL_EXISTING", sourceRequestId: null, sourceAuthorityRef: "CANONICAL_NAME_AUTHORITY:FIXTURE", sourceBatchId: null, sourceResponseAttemptId: null, nameEffectiveFromYear: 0, acceptanceYear: 0, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: null, comparisonAuthorityRef: null }, "TEST");
  for (const worldKey of ["CONCORD", "SCHISM", "RUIN"] as const) {
    const state: WorldStateV5 = { schemaVersion: "echoes-world-state-v5", worldKey, year: 5, cohorts: [], settlements: [], states: [], families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [] };
    store.saveV5Checkpoint(runId, state, V5_EMPTY_EVENT_HISTORY_HASH);
  }
  store.saveV5NamingRequests(runId, Array.from({ length: 18 }, (_, index) => ({ requestId: `REQ_${String(index).padStart(2, "0")}`, entityType: "FAMILY", entityId: `FAMILY_${String(index).padStart(2, "0")}`, behavior: "BATCHED" as const, createdYear: index < 8 ? 0 : index < 14 ? 3 : 5, nameEffectiveFromYear: index < 8 ? 0 : index < 14 ? 3 : 5, worldKey: (["CONCORD", "SCHISM", "RUIN"] as const)[index % 3] as WorldKey, namingComparisonGroupId: null, comparisonAuthorityRef: null, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1" as const, acceptedLabel: null, context: { fixtureIndex: index } })));
  const batches = store.materializePendingV5NamingBatches(runId, 2);
  store.selectRun(runId);
  const responses = batches.map((batch, batchIndex) => JSON.stringify({ schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: batch.batchId, runId, decisions: batch.items.map((item, itemIndex) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `Restart Label ${batchIndex}-${itemIndex}`, nameEffectiveFromYear: item.nameEffectiveFromYear ?? item.createdYear })) }));
  store.close();
  return { runId, batchIds: batches.map((batch) => batch.batchId), responses };
}

function writePrompt01OperatorFixture(userData: string): string {
  const runId = "RUN_ELECTRON_PROMPT01_OPERATOR";
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
  const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
  const seed = normalizeSeed("electron prompt01 operator fixture");
  const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 25, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: seed, mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
  store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_NAMING", seed, seedHash: "prompt01-operator-fixture", policyVersion: V5_MECHANICS_VERSION, currentYear: 0 });
  store.saveV5RunManifest(manifest);
  for (const worldKey of ["CONCORD", "SCHISM", "RUIN"] as const) {
    const bootstrap = bootstrapWorldV5({ worldKey, canonical, ownerInputs: owner, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: seed, mode: "DIAGNOSTIC" });
    const events = [...bootstrap.events].sort((left, right) => left.eventId.localeCompare(right.eventId)).map((event, sequence) => ({ ...event, sequence }));
    store.appendV5CausalEvents(runId, events);
    store.saveV5NamingRequests(runId, bootstrap.namingRequests);
    store.saveV5Checkpoint(runId, bootstrap.state, extendV5EventHistoryHash(V5_EMPTY_EVENT_HISTORY_HASH, events));
  }
  store.materializePendingV5NamingBatches(runId);
  store.selectRun(runId);
  store.close();
  return runId;
}

function writeDerogatoryOperatorFixture(userData: string): string {
  const runId = "RUN_ELECTRON_DEROGATORY_OPERATOR";
  const store = new SimulatorStore(join(userData, "simulator.sqlite"));
  const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
  const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
  const seed = normalizeSeed("electron derogatory operator fixture");
  const manifest = buildV5RunManifest({ runId, mode: "DIAGNOSTIC", targetYear: 25, canonicalBundleHash: canonical.canonicalBundleHash, normalizedSeed: seed, mechanics: DEFAULT_MECHANICS_VARIABLES_V1, causalOwnerInputs: owner, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1 });
  store.createRun({ runId, mode: "DIAGNOSTIC", status: "WAITING_FOR_DEROGATORY_DECISIONS", seed, seedHash: "derogatory-operator-fixture", policyVersion: V5_MECHANICS_VERSION, currentYear: 14 });
  store.setRunStatus(runId, "WAITING_FOR_DEROGATORY_DECISIONS", 14);
  store.saveV5RunManifest(manifest);
  store.recordV5AcceptedLabel({ ledgerEntryId: "LEDGER_DEROGATORY_FIXTURE", runId, worldKey: null, entityType: "SETTLEMENT", entityId: "CANONICAL_DEROGATORY_FIXTURE", label: "Canonical Derogatory Fixture", source: "CANONICAL_EXISTING", sourceRequestId: null, sourceAuthorityRef: "CANONICAL_NAME_AUTHORITY:DEROGATORY_FIXTURE", sourceBatchId: null, sourceResponseAttemptId: null, nameEffectiveFromYear: 0, acceptanceYear: 0, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: null, comparisonAuthorityRef: null }, "TEST");
  const states = Object.fromEntries((["CONCORD", "SCHISM", "RUIN"] as const).map((worldKey) => {
    const bootstrap = bootstrapWorldV5({ worldKey, canonical, ownerInputs: owner, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: seed, mode: "DIAGNOSTIC" });
    const state = { ...bootstrap.state, year: 14 };
    store.saveV5Checkpoint(runId, state, V5_EMPTY_EVENT_HISTORY_HASH);
    return [worldKey, state];
  })) as Record<WorldKey, WorldStateV5>;
  store.saveV5DerogatoryDecisionBatch(runId, buildDerogatoryDecisionBatchV5(states, 15, CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1));
  store.selectRun(runId);
  store.close();
  return runId;
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
    const catalog = await page.evaluate(async () => (window as unknown as { eidolonSimulator: { getBreedCatalog(): Promise<{ breedId: string; name: string }[]> } }).eidolonSimulator.getBreedCatalog());
    expect(catalog).toHaveLength(2062);
    const selections = [catalog[0]!, catalog[Math.floor(catalog.length / 2)]!, catalog.at(-1)!];
    await expect(page.getByLabel("Select Breed").locator("option")).toHaveCount(2063, { timeout: 20_000 });
    for (const selection of selections) {
      await page.getByLabel("Select Breed").selectOption(selection.breedId);
      await expect(page.getByRole("heading", { name: selection.name, exact: true })).toBeVisible();
    }
    await page.getByLabel("Search Breeds").fill("definitely-no-canonical-breed-matches-this");
    await expect(page.getByLabel("Select Breed").locator("option")).toHaveCount(2);
    await expect(page.getByLabel("Select Breed")).toHaveValue(selections[2]!.breedId);
    await page.getByLabel("Search Breeds").fill("Orycteropus afer");
    await expect(page.getByLabel("Select Breed").locator("option")).toHaveCount(3, { timeout: 20_000 });
    await expect(page.getByLabel("Select Breed")).toHaveValue(selections[2]!.breedId);
    await expect(page.getByLabel("Select Breed").locator('option[value="BRD_AARDVARK"]')).toHaveCount(1);
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
  writePrompt01OperatorFixture(userData);
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Naming Queue" }).click();
    await expect(page.getByLabel("Naming batch prompt")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Naming batch prompt")).toHaveValue(/Treat these entities as alternate-world counterparts\./);
    await expect(page.getByLabel("Naming batch prompt")).toHaveValue(/Do not attempt to satisfy the simulator's 65\/25\/10 diagnostic target\./);
    const v5Response = await page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingV5NamingBatches: { batchId: string; runId: string; items: { requestId: string; entityType: string; entityId: string; nameEffectiveFromYear?: number; createdYear: number }[] }[] }> } }).eidolonSimulator;
      const batch = (await simulator.getOperatorSnapshot()).pendingV5NamingBatches[0]!;
      return JSON.stringify({ schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: batch.batchId, runId: batch.runId, decisions: batch.items.map((item, index) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `Isolated E2E LLM Name ${index + 1}`, nameEffectiveFromYear: item.nameEffectiveFromYear ?? item.createdYear })) });
    });
    await page.getByLabel("Naming response JSON").fill(v5Response);
    await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
    await expect(page.getByRole("status")).toContainText("Naming response accepted and persisted.", { timeout: 30_000 });
    await expect(page.getByText("ACCEPTED FROM LLM", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Settlement Detail" }).click();
    await expect(page.getByLabel("Select Settlement")).toBeVisible();
    await expect(page.getByText("No resolved denominator", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "State Detail" }).click();
    await expect(page.getByLabel("Select State")).toBeVisible();
    const stateOptions = page.getByLabel("Select State").locator("option:not([disabled])");
    expect(await stateOptions.count()).toBeGreaterThan(1);
    await page.getByLabel("Select State").selectOption({ index: 2 });
    await expect(page.getByText("Actual government", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cities", exact: true }).click();
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
    await expect(page.getByText("NO CANONICAL CONCLAVE OFFICE AUTHORITY", { exact: true })).toHaveCount(0);
    await expect(page.locator(".chamber-seat").first()).toBeVisible();
    const chamberPersonButton = page.getByRole("button", { name: /Open Political Person/ }).first();
    await expect(chamberPersonButton).toBeVisible();
    const chamberPersonId = (await chamberPersonButton.getAttribute("aria-label"))!.replace("Open Political Person ", "");
    await chamberPersonButton.click();
    await expect(page.getByText("PERSON DETAIL", { exact: true })).toBeVisible();
    await expect(page.getByText(chamberPersonId, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Senate" }).click();
    await expect(page.getByLabel("SENATE chamber")).toBeVisible();
    await expect(page.getByText("NO CANONICAL SENATE OFFICE AUTHORITY", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resources / Industry" }).click();
    await expect(page.getByRole("heading", { name: "RESOURCE GEOGRAPHY", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SETTLEMENT INDUSTRIES", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Conflict", exact: true }).click();
    await expect(page.getByRole("heading", { name: "DIPLOMATIC RELATIONS", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "SECURITY FORCES", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Derogatory Groups", exact: true }).click();
    await expect(page.getByRole("heading", { name: "ACTIVE AND HISTORICAL TARGET SELECTIONS", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Atrocities", exact: true }).click();
    await expect(page.getByRole("heading", { name: "ATROCITY OCCURRENCES", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FORCED DISPLACEMENT", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Enclaves", exact: true }).click();
    await expect(page.getByRole("heading", { name: "PRIVATE OPERATOR ENCLAVES", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Parameters / Event Triggers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "WITNESS ATROCITY STRUCTURAL SLOTS", exact: true })).toBeVisible();
    await expect(page.getByText("ATROCITY_WITNESS_17", { exact: true })).toBeVisible();
    await expect(page.getByText("ATROCITY_WITNESS_16_A", { exact: true })).toBeVisible();
    await expect(page.getByText("ATROCITY_WITNESS_16_B", { exact: true })).toBeVisible();
  } finally { await application.close(); }
});

test("Derogatory Groups exposes the complete immutable 63-decision prompt packet", async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-derogatory-prompt-"));
  writeDerogatoryOperatorFixture(userData);
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Derogatory Groups", exact: true }).click();
    const prompt = page.getByLabel("Derogatory decision prompt");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toHaveValue(/IMMUTABLE BATCH CONTEXT/);
    await expect(prompt).toHaveValue(/REQUIRED RESPONSE TEMPLATE/);
    await expect(prompt).toHaveValue(/echoes-derogatory-decision-response-v1/);
    await expect(prompt).toHaveValue(/DEROGATORY_DECISION_15_CONCORD_SOVEREIGN_SCAPEGOAT/);
    await expect(prompt).toHaveValue(/DEROGATORY_DECISION_15_RUIN_SOVEREIGN_OPPOSITION_INTERNAL_CRUELTY_FOCUS/);
    await expect(page.getByRole("button", { name: "COPY PROMPT" })).toBeVisible();
    await expect(page.getByRole("button", { name: "EXPORT PROMPT" })).toBeVisible();
  } finally { await application.close(); }
});

test("nine persisted V5 naming batches retain their IDs and advance across an app restart after every acceptance", async () => {
  test.setTimeout(240_000);
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-v5-batch-restarts-"));
  const fixture = writeNineBatchRestartFixture(userData);
  expect(fixture.batchIds).toHaveLength(9);
  for (let index = 0; index < fixture.responses.length; index += 1) {
    const application = await launch(userData);
    try {
      const page = await application.firstWindow();
      await page.getByRole("button", { name: "Naming Queue" }).click();
      if (index === 0) {
        await expect(page.getByRole("button", { name: "EXPORT ALL PROMPTS", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "UPLOAD ALL RESPONSES (.ZIP)", exact: true })).toBeVisible();
      }
      await expect(page.getByRole("heading", { name: fixture.batchIds[index]!, exact: true })).toBeVisible();
      const persistedIds = await page.evaluate(async () => {
        const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingV5NamingBatches: { batchId: string }[] }> } }).eidolonSimulator;
        return (await simulator.getOperatorSnapshot()).pendingV5NamingBatches.map((batch) => batch.batchId);
      });
      expect(persistedIds).toEqual(fixture.batchIds.slice(index));
      await page.getByLabel("Naming response JSON").fill(fixture.responses[index]!);
      await page.getByRole("button", { name: "VALIDATE & ACCEPT" }).click();
      await expect(page.getByRole("status")).toContainText("Naming response accepted and persisted.");
      if (index + 1 < fixture.batchIds.length) await expect(page.getByRole("heading", { name: fixture.batchIds[index + 1]!, exact: true })).toBeVisible();
      else await expect(page.getByRole("heading", { name: "No pending required naming batch", exact: true })).toBeVisible();
    } finally {
      await application.close();
    }
  }
  const application = await launch(userData);
  try {
    const page = await application.firstWindow();
    const final = await page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getOperatorSnapshot(): Promise<{ pendingV5NamingBatches: { batchId: string }[]; namingQueueSummary: { acceptedFromLlm: Record<string, number> } }> } }).eidolonSimulator;
      return simulator.getOperatorSnapshot();
    });
    expect(final.pendingV5NamingBatches).toEqual([]);
    expect(Object.values(final.namingQueueSummary.acceptedFromLlm).reduce((sum, count) => sum + count, 0)).toBe(18);
  } finally {
    await application.close();
  }
});

test("Naming Geography fixtures classify and style all three physical entity tables and highlight Route endpoints", async () => {
  const userData = mkdtempSync(join(tmpdir(), "eidolon-electron-naming-geography-"));
  const fixturePath = writeNamingGeographyFixture(userData);
  const application = await launch(userData, { NODE_ENV: "test", EIDOLON_V5_NAMING_GEOGRAPHY_FIXTURE: fixturePath });
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Naming Geography" }).click();
    await expect(page.getByText("SETTLEMENTS", { exact: true })).toBeVisible();
    await expect(page.getByText("POIs", { exact: true })).toBeVisible();
    await expect(page.getByText("NAMED ROUTES", { exact: true })).toBeVisible();
    await expect(page.getByText("Raukaam", { exact: true }).first()).toBeVisible();
    for (const tableName of ["SETTLEMENTS", "POIs", "NAMED ROUTES"]) {
      const table = page.locator("section.naming-table").filter({ hasText: tableName });
      await expect(table.locator(".name-divergence-all")).toHaveCount(3);
      await expect(table.locator(".name-divergence-odd")).toHaveCount(3);
      await expect(table.getByText("COMPARISON_AWARE", { exact: true }).first()).toBeVisible();
    }
    await expect(page.locator("td", { hasText: "NOT READY FOR NAMING" }).first()).toBeVisible();
    await page.getByLabel("POI canaries only").check();
    const poiTable = page.locator("section.naming-table").filter({ hasText: "POIs" });
    await expect(poiTable.getByRole("heading", { name: "4 physical identities" })).toBeVisible();
    const routeTable = page.locator("section.naming-table").filter({ hasText: "NAMED ROUTES" });
    await routeTable.getByRole("button", { name: "SHOW ON ATLAS" }).first().click();
    await expect(page.getByText("SELECTED ROUTE", { exact: true })).toBeVisible();
    await expect(page.locator(".region-endpoint.selected")).toHaveCount(2);
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
    const heartbeatLatencies = await page.evaluate(async () => {
      const simulator = (window as unknown as { eidolonSimulator: { getRuntimeInfo(): Promise<unknown> } }).eidolonSimulator;
      const values: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        await Promise.race([simulator.getRuntimeInfo(), new Promise((_, reject) => window.setTimeout(() => reject(new Error("Electron main-process heartbeat timed out")), 1_500))]);
        values.push(performance.now() - started);
        await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 100));
      }
      return values;
    });
    expect(Math.max(...heartbeatLatencies)).toBeLessThan(1_500);
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
