import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildNamingPromptExportV5, parseNamingResponseZipV5 } from "../../src/core/v5/naming-bulk.js";
import { buildPersistedNamingBatchesV5, type NamingBatchResponseV5 } from "../../src/core/v5/naming.js";

function fixture() {
  const runId = "RUN_BULK_FILES";
  const requests = [
    { requestId: "REQ_A", entityType: "FAMILY", entityId: "FAMILY_A", behavior: "BATCHED" as const, createdYear: 5, nameEffectiveFromYear: 5, acceptedLabel: null },
    { requestId: "REQ_B", entityType: "FAMILY", entityId: "FAMILY_B", behavior: "BATCHED" as const, createdYear: 6, nameEffectiveFromYear: 6, acceptedLabel: null },
  ];
  const batches = buildPersistedNamingBatchesV5(runId, requests, 1);
  const responses: NamingBatchResponseV5[] = batches.map((batch, index) => ({
    schemaVersion: "echoes-v5-naming-batch-response-v2",
    batchId: batch.batchId,
    runId,
    decisions: batch.items.map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: `External Label ${index + 1}`, nameEffectiveFromYear: item.nameEffectiveFromYear ?? item.createdYear })),
  }));
  return { runId, batches, responses };
}

describe("V5 bulk naming files", () => {
  it("exports every immutable prompt with an indexed manifest", () => {
    const { runId, batches } = fixture();
    const exported = buildNamingPromptExportV5(runId, batches, "2026-08-29T00:00:00.000Z");
    expect(exported).toMatchObject({ batchCount: 2, requestCount: 2, manifestFilename: "naming-prompt-manifest.json" });
    expect(exported.promptFiles.map((file) => file.filename)).toEqual(expect.arrayContaining([expect.stringMatching(/^001_.*\.prompt\.txt$/), expect.stringMatching(/^002_.*\.prompt\.txt$/)]));
    expect(JSON.parse(exported.manifestText)).toMatchObject({ schemaVersion: "echoes-v5-naming-prompt-export-v1", runId, batchCount: 2, requestCount: 2 });
  });

  it("accepts exactly one valid response JSON per pending batch regardless of ZIP folder layout", () => {
    const { batches, responses } = fixture();
    const bytes = zipSync({
      "export/naming-prompt-manifest.json": strToU8("{}"),
      "responses/two.json": strToU8(JSON.stringify(responses[1])),
      "responses/one.json": strToU8(JSON.stringify(responses[0])),
      "README.txt": strToU8("Response bundle"),
    });
    expect(parseNamingResponseZipV5(bytes, batches)).toEqual({ accepted: true, errors: [], responses });
  });

  it("rejects an incomplete or duplicate ZIP before returning any responses", () => {
    const { batches, responses } = fixture();
    const incomplete = parseNamingResponseZipV5(zipSync({ "one.json": strToU8(JSON.stringify(responses[0])) }), batches);
    expect(incomplete.accepted).toBe(false);
    expect(incomplete.responses).toBeUndefined();
    expect(incomplete.errors.join(" ")).toContain(`Missing response for batchId ${batches[1]!.batchId}`);
    const duplicate = parseNamingResponseZipV5(zipSync({ "one.json": strToU8(JSON.stringify(responses[0])), "copy.json": strToU8(JSON.stringify(responses[0])), "two.json": strToU8(JSON.stringify(responses[1])) }), batches);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.responses).toBeUndefined();
    expect(duplicate.errors.join(" ")).toContain("duplicate response");
  });
});
