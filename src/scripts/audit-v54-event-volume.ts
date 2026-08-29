import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";

type Classification = "REQUIRED_CAUSAL_TRANSITION" | "DERIVABLE_OBSERVATION" | "REDUNDANT_UNCHANGED_STATE" | "DIAGNOSTIC_ONLY";
type Group = { count: number; eventJsonBytes: number; payloadBytes: number; entities: Set<string>; yearlyCounts: Map<number, number> };

function argument(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? fallback;
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

function classify(eventType: string): { classification: Classification; rationale: string } {
  if (eventType === "CausalInvariantAuditPassed") return { classification: "DIAGNOSTIC_ONLY", rationale: "Annual validation observation; it does not mutate causal state." };
  if (eventType.endsWith("Reviewed") || eventType.endsWith("Measured")) return { classification: "DERIVABLE_OBSERVATION", rationale: "Observation is reconstructable from state and the governing review cadence." };
  if (eventType.endsWith("Unchanged") || eventType.endsWith("Restated")) return { classification: "REDUNDANT_UNCHANGED_STATE", rationale: "The record restates an unchanged value." };
  return { classification: "REQUIRED_CAUSAL_TRANSITION", rationale: "The event records an identity, population, office, lifecycle, or other durable causal transition." };
}

const databasePath = resolve(argument("database", "/tmp/echoes-v54-prompt03-DfLPKF/acceptance.sqlite"));
const outputPath = resolve(argument("output", "artifacts/simulator/v5/remediation/v54-event-volume-audit.json"));
const database = new DatabaseSync(databasePath, { readOnly: true });
const startedAt = performance.now();
try {
  const run = database.prepare("SELECT run_id, status, current_year FROM simulation_run ORDER BY created_at DESC LIMIT 1").get() as { run_id: string; status: string; current_year: number } | undefined;
  if (!run) throw new Error("No persisted V5 run found in source fixture");
  const groups = new Map<string, Group>();
  const rows = database.prepare("SELECT event_type, year, event_json FROM v5_causal_event WHERE run_id=? ORDER BY world_key, year, sequence").iterate(run.run_id) as Iterable<{ event_type: string; year: number; event_json: string }>;
  let totalCount = 0; let totalEventJsonBytes = 0; let totalPayloadBytes = 0;
  for (const row of rows) {
    const parsed = JSON.parse(row.event_json) as { entityId: string; payload: unknown }; const payload = parsed.payload;
    const eventJsonBytes = Buffer.byteLength(row.event_json, "utf8");
    const payloadBytes = Buffer.byteLength(canonicalJson(payload), "utf8");
    const group = groups.get(row.event_type) ?? { count: 0, eventJsonBytes: 0, payloadBytes: 0, entities: new Set<string>(), yearlyCounts: new Map<number, number>() };
    group.count += 1; group.eventJsonBytes += eventJsonBytes; group.payloadBytes += payloadBytes; group.entities.add(parsed.entityId); group.yearlyCounts.set(row.year, (group.yearlyCounts.get(row.year) ?? 0) + 1); groups.set(row.event_type, group);
    totalCount += 1; totalEventJsonBytes += eventJsonBytes; totalPayloadBytes += payloadBytes;
  }
  const years = Math.max(1, run.current_year + 1);
  const rowsOutput = [...groups.entries()].map(([eventType, group]) => ({
    eventType, count: group.count, countPerYear: group.count / years, entityCount: group.entities.size,
    countPerEntity: group.entities.size === 0 ? 0 : group.count / group.entities.size,
    averagePayloadBytes: group.count === 0 ? 0 : group.payloadBytes / group.count, totalPayloadBytes: group.payloadBytes,
    averageEventJsonBytes: group.count === 0 ? 0 : group.eventJsonBytes / group.count, totalEventJsonBytes: group.eventJsonBytes,
    ...classify(eventType), yearlyCounts: Object.fromEntries([...group.yearlyCounts].sort(([left], [right]) => left - right)),
  })).sort((left, right) => right.totalEventJsonBytes - left.totalEventJsonBytes || left.eventType.localeCompare(right.eventType));
  const output = {
    schemaVersion: "echoes-v5.4-event-volume-audit-v1", sourceCommit: "db0d5448b9730aff6c3221508d27b68429f8774b",
    sourceFixture: { databasePath, databaseBytes: statSync(databasePath).size, runId: run.run_id, status: run.status, completedYear: run.current_year, readOnly: true },
    eventContractChangedByAudit: false, proposedEventContractChangesImplemented: false,
    totals: { eventCount: totalCount, eventJsonBytes: totalEventJsonBytes, payloadBytes: totalPayloadBytes, averageEventPayloadBytes: totalCount === 0 ? 0 : totalPayloadBytes / totalCount, bytesPerCausalEvent: totalCount === 0 ? 0 : totalEventJsonBytes / totalCount },
    classificationPolicy: "Audit only. No event was removed or reclassified in persistence by this remediation.", rows: rowsOutput,
    elapsedMilliseconds: performance.now() - startedAt,
  };
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${canonicalJson(output)}\n`, "utf8");
  process.stdout.write(`${canonicalJson({ outputPath, eventCount: totalCount, eventJsonBytes: totalEventJsonBytes, top: rowsOutput.slice(0, 10).map(({ eventType, count, totalEventJsonBytes: bytes, classification }) => ({ eventType, count, bytes, classification })) })}\n`);
} finally { database.close(); }
