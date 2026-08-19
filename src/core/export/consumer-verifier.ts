import { strFromU8 } from "fflate";
import { verifyExportZip } from "./exporter.js";

interface ConsumerVerification {
  runId: string;
  mode: string;
  populationEncoding: "decimal-string-bigint";
  worldTotals: Record<string, bigint>;
  idempotencyKeys: string[];
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(strFromU8(bytes)) as Record<string, unknown>;
}

function parseJsonl(bytes: Uint8Array): Record<string, unknown>[] {
  return strFromU8(bytes).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function verifyForConsumer(bytes: Uint8Array): ConsumerVerification {
  const verified = verifyExportZip(bytes);
  const manifest = verified.manifest;
  if (manifest.populationEncoding !== "decimal-string-bigint") throw new Error("Unsupported population encoding");
  const schemaFiles = verified.files.filter((file) => file.path.startsWith("schemas/") && file.path.endsWith(".json"));
  if (schemaFiles.length === 0) throw new Error("Export has no schemas");
  for (const file of schemaFiles) parseJson(file.bytes);

  const worldTotals: Record<string, bigint> = {};
  const idempotencyKeys: string[] = [];
  const seenIds = new Set<string>();
  const seenOrder = new Set<string>();
  for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
    const worldManifest = verified.files.find((file) => file.path === `worlds/${world}/world_manifest.json`);
    const eventFile = verified.files.find((file) => file.path === `worlds/${world}/events.jsonl`);
    if (!worldManifest || !eventFile) throw new Error(`Missing consumer data for ${world}`);
    const total = parseJson(worldManifest.bytes).totalPopulation;
    if (typeof total !== "string" || !/^\d+$/.test(total)) throw new Error(`Invalid BigInt population for ${world}`);
    worldTotals[world] = BigInt(total);
    for (const event of parseJsonl(eventFile.bytes)) {
      if (typeof event.eventId !== "string" || event.eventId.length === 0) throw new Error(`Event without idempotency key in ${world}`);
      if (seenIds.has(event.eventId)) throw new Error(`Duplicate event id ${event.eventId}`);
      seenIds.add(event.eventId);
      idempotencyKeys.push(event.eventId);
      if (typeof event.year === "number" && typeof event.phase === "string" && typeof event.sequence === "number") {
        const order = `${world}:${event.year}:${event.phase}:${event.sequence}`;
        if (seenOrder.has(order)) throw new Error(`Duplicate event order ${order}`);
        seenOrder.add(order);
      }
    }
  }
  return { runId: String(manifest.runId), mode: String(manifest.mode), populationEncoding: "decimal-string-bigint", worldTotals, idempotencyKeys };
}
