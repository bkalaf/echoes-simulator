import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { buildExportZip, verifyExportZip } from "../../src/core/export/exporter.js";
import { verifyForConsumer } from "../../src/core/export/consumer-verifier.js";

describe("deterministic export", () => {
  const run = {
    runId: "RUN_EXPORT_TEST", mode: "DIAGNOSTIC" as const, seed: "seed", policyVersion: "owner-policy-v1", finalYear: 2000,
    readiness: [{ issueCode: "BREED_DIMENSION_COVERAGE", severity: "BLOCKER" as const, blocksCanonical: true, message: "blocked" }],
    inputHashes: { fixture: "a".repeat(64) }, sharedEvents: [{ eventKey: "FOUNDING", resolvedYear: 0 }],
    worlds: {
      CONCORD: { totalPopulation: 9_007_199_254_740_993n, events: [{ eventId: "E1", year: 1, phase: "GROWTH", sequence: 0 }], settlements: [] },
      SCHISM: { totalPopulation: 10n, events: [{ eventId: "E2", year: 1, phase: "GROWTH", sequence: 0 }], settlements: [] },
      RUIN: { totalPopulation: 11n, events: [{ eventId: "E3", year: 1, phase: "GROWTH", sequence: 0 }], settlements: [] },
    },
  };

  it("writes byte-stable BigInt-safe ZIPs and verifies checksums", () => {
    const first = buildExportZip(run);
    const second = buildExportZip(run);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    const verified = verifyExportZip(first.bytes);
    expect(verified.valid).toBe(true);
    expect(verified.manifest.populationEncoding).toBe("decimal-string-bigint");
    expect(verified.files.some((file) => file.path.startsWith("schemas/"))).toBe(true);
    expect(verified.files.some((file) => file.path.endsWith("population/deltas.jsonl"))).toBe(true);
    expect(new TextDecoder().decode(verified.files.find((file) => file.path.endsWith("world_manifest.json"))!.bytes)).toContain("9007199254740993");
    expect(verifyForConsumer(first.bytes).worldTotals.CONCORD).toBe(9_007_199_254_740_993n);
    const corrupt = first.bytes.slice(); corrupt[corrupt.length - 22] = 0;
    expect(() => verifyExportZip(corrupt)).toThrow();
  });

  it("rejects unknown export schemas and duplicate consumer event identities", () => {
    const generated = buildExportZip(run);
    const archive = unzipSync(generated.bytes);
    const manifestName = Object.keys(archive).find((name) => name.endsWith("/manifest.json"))!;
    const manifest = JSON.parse(new TextDecoder().decode(archive[manifestName]!));
    manifest.schemaVersion = "unknown-export-v99";
    archive[manifestName] = new TextEncoder().encode(JSON.stringify(manifest));
    expect(() => verifyExportZip(zipSync(archive))).toThrow("Unknown export schema");

    const duplicateRun = structuredClone(run);
    duplicateRun.worlds.SCHISM.events = [{ eventId: "E1", year: 1, phase: "GROWTH", sequence: 0 }];
    expect(() => verifyForConsumer(buildExportZip(duplicateRun).bytes)).toThrow("Duplicate event id E1");
  });
});
