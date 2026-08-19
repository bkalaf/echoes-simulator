import { describe, expect, it } from "vitest";
import { buildNamingJob, validateNamingResponse } from "../../src/core/naming/naming.js";

describe("blocking naming workflow", () => {
  const context = {
    runId: "RUN_1", world: "CONCORD" as const, year: 0, reason: "INITIAL_SETUP",
    settlement: { settlementId: "SETTLEMENT_1", siteId: "SITE-001", currentName: "Anseris", nameSource: "OWNER_INPUT" as const, dominantFaction: "CONCORD", cultureId: "CLT_TEST", politicalForm: "REPUBLIC", economicForm: "OPEN_BAZAAR", population: "100" },
    unnamedPois: [{ poiId: "POI-1", workingLabel: "Working River", poiType: "RIVER" }],
  };

  it("does not regenerate fixed city names and produces a stable prompt", () => {
    const first = buildNamingJob(context);
    const second = buildNamingJob(context);
    expect(first.items.some((item) => item.entityType === "SETTLEMENT")).toBe(false);
    expect(first.items.map((item) => item.entityType)).toEqual(["POI", "GOVERNMENT", "FAMILY"]);
    expect(first.promptSha256).toBe(second.promptSha256);
    expect(first.promptText).toBe(second.promptText);
  });

  it("rejects missing, extra, and factual response fields", () => {
    const job = buildNamingJob(context);
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: [] }).accepted).toBe(false);
    const decisions = job.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, decision: "NEW", name: `${item.entityType} Name`, ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "Local", sizeDescription: "Small", structureDescription: "Council" } : {}), ...(item.entityType === "FAMILY" ? { roleLabel: "GOVERNING_FAMILY" } : {}) }));
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions }).accepted).toBe(true);
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: [...decisions, { requestId: "EXTRA", entityType: "POI", decision: "NEW", name: "Bad" }] }).accepted).toBe(false);
  });
});
