import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { canonicalJson } from "../core/serialization/canonical-json.js";

type Level = 1 | 3 | 6 | 9;
const LEVELS: readonly Level[] = [1, 3, 6, 9];
const YEARS = [100, 285] as const;

function argument(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}
function elapsedMilliseconds(startedAt: bigint): number { return Number(process.hrtime.bigint() - startedAt) / 1_000_000; }
function median(values: readonly number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]!; }

const databasePath = resolve(argument("database", "/tmp/echoes-v54-prompt03-DfLPKF/acceptance.sqlite"));
const outputPath = resolve(argument("output", "artifacts/simulator/v5/remediation/v54-checkpoint-compression-benchmark.json"));
const repeats = Number.parseInt(argument("repeats", "3"), 10);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20) throw new Error("repeats must be in 1..20");
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const run = database.prepare("SELECT run_id, status, current_year FROM simulation_run ORDER BY created_at DESC LIMIT 1").get() as { run_id: string; status: string; current_year: number } | undefined;
  if (!run) throw new Error("No persisted V5 run found in source fixture");
  const checkpoints = database.prepare(`SELECT world_key, year, state_hash, state_gzip FROM v5_checkpoint WHERE run_id=? AND year IN (${YEARS.map(() => "?").join(",")}) ORDER BY year, world_key`).all(run.run_id, ...YEARS) as Array<{ world_key: string; year: number; state_hash: string; state_gzip: Uint8Array }>;
  if (checkpoints.length !== YEARS.length * 3) throw new Error(`Expected ${YEARS.length * 3} representative checkpoints; found ${checkpoints.length}`);
  const samples = checkpoints.flatMap((checkpoint) => {
    const canonicalBytes = gunzipSync(checkpoint.state_gzip);
    const canonicalSha256 = createHash("sha256").update(canonicalBytes).digest("hex");
    if (canonicalSha256 !== checkpoint.state_hash) throw new Error(`Stored state hash mismatch for ${checkpoint.world_key}/${checkpoint.year}`);
    return LEVELS.map((level) => {
      const compressionTimes: number[] = []; const decompressionTimes: number[] = []; let compressed = Buffer.alloc(0);
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        let startedAt = process.hrtime.bigint(); compressed = gzipSync(canonicalBytes, { level }); compressionTimes.push(elapsedMilliseconds(startedAt));
        startedAt = process.hrtime.bigint(); const restored = gunzipSync(compressed); decompressionTimes.push(elapsedMilliseconds(startedAt));
        if (!restored.equals(canonicalBytes)) throw new Error(`Gzip ${level} changed canonical bytes for ${checkpoint.world_key}/${checkpoint.year}`);
      }
      return { world: checkpoint.world_key, year: checkpoint.year, level, uncompressedBytes: canonicalBytes.byteLength, compressedBytes: compressed.byteLength, compressionTimeMilliseconds: median(compressionTimes), decompressionTimeMilliseconds: median(decompressionTimes), compressionTimesMilliseconds: compressionTimes, decompressionTimesMilliseconds: decompressionTimes, stateHash: checkpoint.state_hash, decompressedStateHash: canonicalSha256, byteIdenticalAfterDecompression: true };
    });
  });
  const aggregates = LEVELS.map((level) => {
    const rows = samples.filter((sample) => sample.level === level);
    return { level, uncompressedBytes: rows.reduce((sum, row) => sum + row.uncompressedBytes, 0), compressedBytes: rows.reduce((sum, row) => sum + row.compressedBytes, 0), compressionTimeMilliseconds: rows.reduce((sum, row) => sum + row.compressionTimeMilliseconds, 0), decompressionTimeMilliseconds: rows.reduce((sum, row) => sum + row.decompressionTimeMilliseconds, 0) };
  });
  const smallestBytes = Math.min(...aggregates.map((row) => row.compressedBytes));
  const sensible = aggregates.filter((row) => row.compressedBytes <= smallestBytes * 1.30);
  const selected = [...sensible].sort((left, right) => left.compressionTimeMilliseconds - right.compressionTimeMilliseconds || left.compressedBytes - right.compressedBytes)[0]!;
  const level9 = aggregates.find((row) => row.level === 9)!;
  const output = { schemaVersion: "echoes-v5.4-checkpoint-compression-benchmark-v1", sourceCommit: "db0d5448b9730aff6c3221508d27b68429f8774b", sourceFixture: { databasePath, databaseBytes: statSync(databasePath).size, runId: run.run_id, status: run.status, completedYear: run.current_year, readOnly: true, representativeYears: YEARS }, repeats, samples, aggregates, selection: { checkpointCompressionLevel: selected.level, policy: "Fastest aggregate compression time among levels within 30% of the smallest compressed size.", versusLevel9: { compressionTimeRatio: selected.compressionTimeMilliseconds / level9.compressionTimeMilliseconds, compressedSizeRatio: selected.compressedBytes / level9.compressedBytes }, checkpointStateHashContractChanged: false, decompressedCanonicalStateChanged: false } };
  mkdirSync(resolve(outputPath, ".."), { recursive: true }); writeFileSync(outputPath, `${canonicalJson(output)}\n`, "utf8");
  process.stdout.write(`${canonicalJson({ outputPath, aggregates, selectedLevel: selected.level })}\n`);
} finally { database.close(); }
