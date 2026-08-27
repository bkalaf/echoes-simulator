import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNamingBatches, buildNamingJob, validateNamingBatchResponse, validateNamingResponse } from "../../src/core/naming/naming.js";
import { enrichPendingNamingJobsWithPois, loadUnnamedPoisBySite } from "../../src/core/naming/poi-context.js";

describe("blocking naming workflow", () => {
  const context = {
    runId: "RUN_1", world: "CONCORD" as const, year: 0, reason: "INITIAL_SETUP",
    settlement: { settlementId: "SETTLEMENT_1", siteId: "SITE-001", currentName: "Anseris", nameSource: "OWNER_INPUT" as const, dominantFaction: "CONCORD", cultureId: "CLT_TEST", cultureState: "CALCULATED" as const, politicalForm: "REPUBLIC", economicForm: "OPEN_BAZAAR", dominantBreed: "BRD_TEST", population: "100" },
    unnamedPois: [{ poiId: "POI-1", workingLabel: "Working River", poiType: "RIVER" }],
  };

  it("does not regenerate fixed city names and produces a stable prompt", () => {
    const first = buildNamingJob(context);
    const second = buildNamingJob(context);
    expect(first.items.some((item) => item.entityType === "SETTLEMENT")).toBe(false);
    expect(first.items.map((item) => item.entityType)).toEqual(["POI", "GOVERNMENT", "FAMILY"]);
    expect(first.promptSha256).toBe(second.promptSha256);
    expect(first.promptText).toBe(second.promptText);
    expect(first.promptText).toContain("Settlement and governing-family names are independent.");
    expect(first.promptText).toContain("The family name may differ from the settlement name");
    expect(first.promptText).toContain("Shared naming remains allowed when intentionally chosen.");
  });

  it("rejects missing, extra, and factual response fields", () => {
    const job = buildNamingJob(context);
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: [] }).accepted).toBe(false);
    const decisions = job.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, decision: "NEW", name: `${item.entityType} Name`, ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "Local", sizeDescription: "Small", structureDescription: "Council" } : {}), ...(item.entityType === "FAMILY" ? { roleLabel: "GOVERNING_FAMILY" } : {}) }));
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions }).accepted).toBe(true);
    expect(validateNamingResponse(job, { schemaVersion: "eidolon-simulator-naming-response-v1", namingJobId: job.namingJobId, decisions: [...decisions, { requestId: "EXTRA", entityType: "POI", decision: "NEW", name: "Bad" }] }).accepted).toBe(false);
  });

  it("builds stable world/year batches and validates exact child-job coverage", () => {
    const concordOne = buildNamingJob(context);
    const concordTwo = buildNamingJob({ ...context, settlement: { ...context.settlement, settlementId: "SETTLEMENT_2", siteId: "SITE-002", currentName: null, nameSource: "UNNAMED" } });
    const ruin = buildNamingJob({ ...context, world: "RUIN", settlement: { ...context.settlement, settlementId: "SETTLEMENT_3", siteId: "SITE-003" } });
    const batches = buildNamingBatches([ruin, concordTwo, concordOne]);
    const repeated = buildNamingBatches([concordOne, ruin, concordTwo]);
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.world)).toEqual(["CONCORD", "RUIN"]);
    expect(batches.map((batch) => batch.namingBatchId)).toEqual(repeated.map((batch) => batch.namingBatchId));
    const concord = batches[0]!;
    expect(concord.jobs).toHaveLength(2);
    expect(concord.promptText).toContain("Settlement and governing-family names are independent.");
    expect(concord.promptText).toContain("eidolon-simulator-naming-batch-response-v1");
    expect(concord.promptText).toContain("Do not return a results key.");
    const jobs = concord.jobs.map((job) => ({
      namingJobId: job.namingJobId,
      decisions: job.items.map((item) => ({
        requestId: item.requestId, entityType: item.entityType, decision: "NEW", name: `${item.entityType} ${item.requestId}`,
        ...(item.entityType === "GOVERNMENT" ? { scopeDescription: "Local", sizeDescription: "Small", structureDescription: "Council" } : {}),
        ...(item.entityType === "FAMILY" ? { roleLabel: "GOVERNING_FAMILY" } : {}),
      })),
    }));
    const response = { schemaVersion: "eidolon-simulator-naming-batch-response-v1", namingBatchId: concord.namingBatchId, jobs };
    expect(validateNamingBatchResponse(concord, response)).toMatchObject({ accepted: true, errors: [] });
    expect(validateNamingBatchResponse(concord, { ...response, jobs: jobs.slice(1) })).toMatchObject({ accepted: false, errors: [expect.stringMatching(/Missing namingJobId/)] });
  });

  it("forbids naming before faction, forms, dominant Breed, and Culture state are calculated", () => {
    expect(() => buildNamingJob({ ...context, settlement: { ...context.settlement, dominantBreed: null } })).toThrow(/calculated faction/i);
    expect(() => buildNamingJob({ ...context, settlement: { ...context.settlement, cultureId: null, cultureState: undefined } })).toThrow(/Culture/i);
    expect(() => buildNamingJob({ ...context, settlement: { ...context.settlement, cultureId: null, cultureState: "NO_HUMAN_FOUNDING_CULTURE" } })).not.toThrow();
  });

  it("loads all non-canonical atlas POIs and upgrades an existing incomplete job deterministically", () => {
    const bySite = loadUnnamedPoisBySite(resolve("resources/canonical"));
    expect([...bySite.values()].flat()).toHaveLength(92);
    expect(bySite.size).toBe(62);
    expect(bySite.get("SITE-036")).toEqual(expect.arrayContaining([
      { poiId: "POI-080", workingLabel: "Highcourt Isle", poiType: "ISLAND" },
    ]));
    expect(bySite.get("SITE-017")).toEqual([
      { poiId: "POI-003", workingLabel: "Rainbow Heatherland Heart", poiType: "HEATHERLANDS" },
      { poiId: "POI-063", workingLabel: "Heather Hills", poiType: "HILLS" },
    ]);
    const incomplete = buildNamingJob({ ...context, settlement: { ...context.settlement, siteId: "SITE-017" }, unnamedPois: [] });
    const replacements = enrichPendingNamingJobsWithPois([incomplete], bySite);
    expect(replacements).toHaveLength(1);
    expect(replacements[0]!.priorNamingJobId).toBe(incomplete.namingJobId);
    expect(replacements[0]!.job.namingJobId).not.toBe(incomplete.namingJobId);
    expect(replacements[0]!.job.items.filter((item) => item.entityType === "POI").map((item) => item.entityId)).toEqual(["POI-003", "POI-063"]);
    expect(enrichPendingNamingJobsWithPois([replacements[0]!.job], bySite)).toEqual([]);
  });
});
