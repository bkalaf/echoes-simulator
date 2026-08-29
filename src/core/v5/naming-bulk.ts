import { strFromU8, unzipSync } from "fflate";
import type { NamingBatchResponseV5, PersistedNamingBatchV5 } from "./naming.js";
import { validateNamingBatchResponseV5 } from "./naming.js";

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_000;

export interface NamingPromptExportManifestV1 {
  schemaVersion: "echoes-v5-naming-prompt-export-v1";
  runId: string;
  generatedAt: string;
  batchCount: number;
  requestCount: number;
  responseInstructions: string;
  batches: readonly {
    ordinal: number;
    batchId: string;
    behavior: "BLOCKING" | "BATCHED";
    year: number;
    requestCount: number;
    promptSha256: string;
    promptFilename: string;
  }[];
}

export interface NamingPromptExportV1 {
  manifestFilename: "naming-prompt-manifest.json";
  manifestText: string;
  promptFiles: readonly { filename: string; text: string }[];
  batchCount: number;
  requestCount: number;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 220) || "v5-naming-batch";
}

export function buildNamingPromptExportV5(runId: string, batches: readonly PersistedNamingBatchV5[], generatedAt = new Date().toISOString()): NamingPromptExportV1 {
  if (batches.length === 0) throw new Error("No pending V5 naming prompts are available to export");
  if (batches.some((batch) => batch.runId !== runId)) throw new Error("Naming prompt export cannot mix runs");
  const width = Math.max(3, String(batches.length).length);
  const promptFiles = batches.map((batch, index) => ({
    filename: `${String(index + 1).padStart(width, "0")}_${safeFilename(batch.batchId)}.prompt.txt`,
    text: batch.promptText,
  }));
  const requestCount = batches.reduce((sum, batch) => sum + batch.items.length, 0);
  const manifest: NamingPromptExportManifestV1 = {
    schemaVersion: "echoes-v5-naming-prompt-export-v1",
    runId,
    generatedAt,
    batchCount: batches.length,
    requestCount,
    responseInstructions: "Create one echoes-v5-naming-batch-response-v2 JSON file for every listed batch, then place the response JSON files in one ZIP for Upload All Responses.",
    batches: batches.map((batch, index) => ({
      ordinal: index + 1,
      batchId: batch.batchId,
      behavior: batch.behavior,
      year: batch.year,
      requestCount: batch.items.length,
      promptSha256: batch.promptSha256,
      promptFilename: promptFiles[index]!.filename,
    })),
  };
  return {
    manifestFilename: "naming-prompt-manifest.json",
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    promptFiles,
    batchCount: batches.length,
    requestCount,
  };
}

export function parseNamingResponseZipV5(bytes: Uint8Array, batches: readonly PersistedNamingBatchV5[]): { accepted: boolean; errors: string[]; responses?: NamingBatchResponseV5[] } {
  if (batches.length === 0) return { accepted: false, errors: ["No pending V5 naming batches exist for this run"] };
  if (bytes.byteLength === 0) return { accepted: false, errors: ["Naming response ZIP is empty"] };
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return { accepted: false, errors: [`Naming response ZIP exceeds ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB`] };

  let uncompressedBytes = 0;
  let entryCount = 0;
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, { filter: (file) => {
      entryCount += 1;
      uncompressedBytes += file.originalSize;
      if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error(`Naming response ZIP contains more than ${MAX_ARCHIVE_ENTRIES} entries`);
      if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error(`Naming response ZIP expands beyond ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MiB`);
      return true;
    } });
  } catch (error) {
    return { accepted: false, errors: [error instanceof Error ? `Naming response ZIP is invalid: ${error.message}` : "Naming response ZIP is invalid"] };
  }

  const errors: string[] = [];
  const responsesByBatch = new Map<string, NamingBatchResponseV5>();
  const expected = new Map(batches.map((batch) => [batch.batchId, batch]));
  const jsonEntries = Object.entries(archive)
    .filter(([filename]) => !filename.endsWith("/") && filename.toLowerCase().endsWith(".json") && filename.split("/").at(-1)?.toLowerCase() !== "naming-prompt-manifest.json")
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [filename, data] of jsonEntries) {
    let candidate: unknown;
    try { candidate = JSON.parse(strFromU8(data)); }
    catch { errors.push(`${filename}: response is not valid JSON`); continue; }
    if (!candidate || typeof candidate !== "object" || (candidate as { schemaVersion?: unknown }).schemaVersion !== "echoes-v5-naming-batch-response-v2") {
      errors.push(`${filename}: schemaVersion must be echoes-v5-naming-batch-response-v2`);
      continue;
    }
    const batchId = typeof (candidate as { batchId?: unknown }).batchId === "string" ? (candidate as { batchId: string }).batchId : "";
    if (!expected.has(batchId)) { errors.push(`${filename}: unknown or non-pending batchId ${batchId || "MISSING"}`); continue; }
    if (responsesByBatch.has(batchId)) { errors.push(`${filename}: duplicate response for batchId ${batchId}`); continue; }
    const validated = validateNamingBatchResponseV5(expected.get(batchId)!, candidate);
    if (!validated.accepted) { errors.push(...validated.errors.map((error) => `${filename}: ${error}`)); continue; }
    responsesByBatch.set(batchId, candidate as NamingBatchResponseV5);
  }

  if (jsonEntries.length === 0) errors.push("Naming response ZIP contains no response JSON files");
  for (const batch of batches) if (!responsesByBatch.has(batch.batchId)) errors.push(`Missing response for batchId ${batch.batchId}`);
  if (errors.length > 0) return { accepted: false, errors };
  return { accepted: true, errors: [], responses: batches.map((batch) => responsesByBatch.get(batch.batchId)!) };
}
