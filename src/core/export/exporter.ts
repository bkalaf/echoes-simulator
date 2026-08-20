import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { WorldKey } from "../contracts/domain.js";

interface ExportWorld {
  totalPopulation: bigint;
  events: unknown[];
  settlements: unknown[];
  annual?: unknown[];
  annualStates?: unknown[];
  states?: unknown[];
  stateMembershipEvents?: unknown[];
  governmentEpochs?: unknown[];
  economicEpochs?: unknown[];
  socialSummaries?: unknown[];
  wealthSummaries?: unknown[];
  populationCheckpoints?: unknown[];
  populationDeltas?: unknown[];
  cohorts?: unknown[];
  propertyProjections?: unknown[];
  migrations?: unknown[];
  founding?: unknown[];
  djt?: unknown[];
  conclaveSeats?: unknown[];
  conclaveSnapshots?: unknown[];
  senateSeats?: unknown[];
  names?: unknown[];
  renames?: unknown[];
  namingJobs?: unknown[];
  families?: unknown[];
}
export interface ExportRunData {
  runId: string; mode: "CANONICAL" | "DIAGNOSTIC"; seed: string; policyVersion: string; finalYear: number;
  readiness: { issueCode: string; severity: "PASS" | "WARNING" | "BLOCKER"; blocksCanonical: boolean; message: string }[];
  inputHashes: Record<string, string>;
  sourceVersions?: Record<string, string>;
  schemas?: Record<string, unknown>;
  sharedEvents: unknown[];
  worlds: Record<WorldKey, ExportWorld>;
}

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => strToU8(`${canonicalJson(value)}\n`);
const jsonl = (values: readonly unknown[]) => strToU8(values.map((value) => canonicalJson(value)).join("\n") + (values.length ? "\n" : ""));

function eventPhase(eventType: string): string {
  if (eventType.includes("INITIAL")) return "STRUCTURAL_START";
  if (eventType.includes("GROWTH")) return "GROWTH";
  if (eventType.includes("FOUNDED")) return "FOUNDER_TRANSFER";
  if (eventType.includes("DJT")) return "DJT_TRANSFER";
  if (eventType.includes("STATE") || eventType.includes("CAPITAL")) return "STATE_MEMBERSHIP";
  if (eventType.includes("MIGRATION")) return "MIGRATION";
  if (eventType.includes("WEALTH")) return "WEALTH";
  if (eventType.includes("SOCIAL")) return "SOCIAL";
  if (eventType.includes("CONCLAVE") || eventType.includes("SENATE")) return "INSTITUTION";
  if (eventType.includes("NAM")) return "NAMING";
  return "PROJECTION_CHANGE";
}

function exportEvent(event: unknown, runId: string, worldKey: WorldKey, sequence: number): Record<string, unknown> {
  const source = event && typeof event === "object" ? event as Record<string, unknown> : {};
  const eventType = typeof source.eventType === "string" ? source.eventType : "UNKNOWN";
  return {
    schemaVersion: "eidolon-simulator-event-v1",
    eventId: String(source.eventId ?? `${runId}_${worldKey}_${sequence}`),
    runId,
    worldKey,
    year: Number(source.year ?? 0),
    phase: typeof source.phase === "string" ? source.phase : eventPhase(eventType),
    sequence,
    eventType,
    entityRefs: { primary: source.entityId ?? null },
    payload: source.payload && typeof source.payload === "object" ? source.payload : {},
  };
}

function consumerPrompt(run: ExportRunData): string {
  return `# MAIN APP CONSUMER PROMPT — ${run.runId}\n\nYou are implementing ingestion of an Echoes of Eidolon simulator export into the current bkalaf/echoes-of-eidolon application.\n\nExport schema: eidolon-simulator-export-v1. Status: ${run.mode}. Final year: ${run.finalYear}. Worlds: CONCORD, SCHISM, RUIN.\n\nBefore coding, inspect current HEAD, AGENTS.md, and current owner Implementation, WorldBuilding, GameState, Atlas, Prisma, and domain authority. This ZIP is historical data input, not schema authority. Validate every manifest entry, SHA-256, schema, identity, reference, event order, checkpoint, and population conservation rule before staging. Fail closed on unknown versions.\n\nAudit BigInt-scale decimal-string populations; never truncate to JavaScript Number or Prisma Int. Preserve physical Site/Region identity, world-specific Settlement existence, temporal State membership, name/rename chronology, government/economic epochs, and exact institution ledgers. Design staging, idempotency, conflict detection, and replay before persistence. Do not mirror simulator SQLite tables blindly or force all simulator events into narrative TimelineEventType. Add year-aware UI only after import/replay tests pass. Use TDD. Do not deploy or migrate production without separate authorization.\n\n${run.mode === "DIAGNOSTIC" ? "This export is DIAGNOSTIC and MUST NOT be imported as canonical production history." : "Confirm all canonical gates again before activation."}\n`;
}

export function buildExportZip(run: ExportRunData): { bytes: Uint8Array; sha256: string; contentDigest: string } {
  if (run.mode === "CANONICAL" && run.readiness.some((issue) => issue.blocksCanonical)) throw new Error("Canonical export blocked by readiness issues");
  const root = `EIDOLON_SIMULATION_${run.runId}`;
  const payload = new Map<string, Uint8Array>();
  payload.set(`${root}/README_IMPORT_CONTRACT.md`, strToU8(`# Echoes of Eidolon simulation import contract\n\nStatus: **${run.mode}**. Physical Region/Site IDs never change. Settlement existence, names, political State membership, government epochs, and history are world/year temporal. Population uses decimal-string BigInt. Events and checkpoints are authoritative; annual summaries are projections. R10 is absent at year 0. Initial city names have OWNER_INPUT provenance. Family records are seed identities only. Reject unknown schemas and invalid checksums.\n`));
  payload.set(`${root}/MAIN_APP_CONSUMER_PROMPT.md`, strToU8(consumerPrompt(run)));
  payload.set(`${root}/provenance/input_manifest.json`, json(run.inputHashes));
  payload.set(`${root}/provenance/readiness.json`, json(run.readiness));
  payload.set(`${root}/provenance/policy_manifest.json`, json({ policyVersion: run.policyVersion, mode: run.mode }));
  payload.set(`${root}/provenance/source_versions.json`, json(run.sourceVersions ?? {}));
  const schemas = run.schemas ?? {
    "export_manifest.schema.json": { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: ["schemaVersion", "runId", "mode", "files", "populationEncoding"], properties: { schemaVersion: { const: "eidolon-simulator-export-v1" }, populationEncoding: { const: "decimal-string-bigint" } } },
  };
  for (const [filename, schema] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))) payload.set(`${root}/schemas/${filename}`, json(schema));
  payload.set(`${root}/shared/resolved_event_calendar.json`, json(run.sharedEvents));
  for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) {
    const data = run.worlds[world];
    const base = `${root}/worlds/${world}`;
    payload.set(`${base}/world_manifest.json`, json({ worldKey: world, finalYear: run.finalYear, totalPopulation: data.totalPopulation }));
    payload.set(`${base}/events.jsonl`, jsonl(data.events.map((event, index) => exportEvent(event, run.runId, world, index))));
    payload.set(`${base}/settlements.jsonl`, jsonl(data.settlements));
    payload.set(`${base}/annual_settlement_summaries.jsonl`, jsonl(data.annual ?? []));
    payload.set(`${base}/annual_state_summaries.jsonl`, jsonl(data.annualStates ?? []));
    payload.set(`${base}/states.jsonl`, jsonl(data.states ?? []));
    payload.set(`${base}/state_membership_events.jsonl`, jsonl(data.stateMembershipEvents ?? []));
    payload.set(`${base}/government_epochs.jsonl`, jsonl(data.governmentEpochs ?? []));
    payload.set(`${base}/economic_epochs.jsonl`, jsonl(data.economicEpochs ?? []));
    payload.set(`${base}/social_summaries.jsonl`, jsonl(data.socialSummaries ?? []));
    payload.set(`${base}/wealth_summaries.jsonl`, jsonl(data.wealthSummaries ?? []));
    payload.set(`${base}/population/checkpoints/checkpoints.jsonl`, jsonl(data.populationCheckpoints ?? []));
    payload.set(`${base}/population/deltas.jsonl`, jsonl(data.populationDeltas ?? []));
    payload.set(`${base}/population/cohorts.jsonl`, jsonl(data.cohorts ?? []));
    payload.set(`${base}/property_projections.jsonl`, jsonl(data.propertyProjections ?? []));
    payload.set(`${base}/migration.jsonl`, jsonl(data.migrations ?? []));
    payload.set(`${base}/founding.jsonl`, jsonl(data.founding ?? []));
    payload.set(`${base}/djt_innerwood.jsonl`, jsonl(data.djt ?? []));
    payload.set(`${base}/institutions/conclave_seats.jsonl`, jsonl(data.conclaveSeats ?? []));
    payload.set(`${base}/institutions/conclave_snapshots.jsonl`, jsonl(data.conclaveSnapshots ?? []));
    payload.set(`${base}/institutions/senate_seats.jsonl`, jsonl(data.senateSeats ?? []));
    payload.set(`${base}/naming/names.jsonl`, jsonl(data.names ?? []));
    payload.set(`${base}/naming/renames.jsonl`, jsonl(data.renames ?? []));
    payload.set(`${base}/naming/jobs.jsonl`, jsonl(data.namingJobs ?? []));
    payload.set(`${base}/families.jsonl`, jsonl(data.families ?? []));
  }
  const fileHashes = [...payload].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path: path.slice(root.length + 1), sha256: hash(bytes) }));
  const contentDigest = hash(fileHashes.map((file) => `${file.path}\0${file.sha256}\n`).join(""));
  const manifest = {
    schemaVersion: "eidolon-simulator-export-v1", runId: run.runId, mode: run.mode, policyVersion: run.policyVersion, yearStart: 0, yearEnd: run.finalYear,
    worlds: ["CONCORD", "SCHISM", "RUIN"], seed: run.seed, inputHashes: run.inputHashes, readiness: run.readiness, populationEncoding: "decimal-string-bigint",
    prngVersion: "scoped-sha256-v1", simulatorVersion: "0.1.0", namingStatus: "COMPLETE", files: fileHashes, contentDigest, completionStatus: run.finalYear === 2000 ? "COMPLETE" : "PARTIAL",
  };
  payload.set(`${root}/manifest.json`, json(manifest));
  payload.set(`${root}/checksums.sha256`, strToU8(fileHashes.map((file) => `${file.sha256}  ${file.path}`).join("\n") + "\n"));
  const fixedDate = new Date("1980-01-02T00:00:00.000Z");
  const zippable: Zippable = {};
  for (const [path, bytes] of [...payload].sort(([a], [b]) => a.localeCompare(b))) zippable[path] = [bytes, { mtime: fixedDate }];
  const bytes = zipSync(zippable, { level: 6 });
  const verified = verifyExportZip(bytes);
  if (!verified.valid) throw new Error("Generated export failed verification");
  return { bytes, sha256: hash(bytes), contentDigest };
}

export function verifyExportZip(bytes: Uint8Array): { valid: true; manifest: Record<string, unknown>; files: { path: string; bytes: Uint8Array }[] } {
  const archive = unzipSync(bytes);
  const names = Object.keys(archive);
  const manifestName = names.find((name) => name.endsWith("/manifest.json"));
  const checksumsName = names.find((name) => name.endsWith("/checksums.sha256"));
  if (!manifestName || !checksumsName) throw new Error("Export is missing manifest/checksums");
  const root = manifestName.slice(0, -"manifest.json".length);
  const manifest = JSON.parse(strFromU8(archive[manifestName]!)) as Record<string, unknown>;
  if (manifest.schemaVersion !== "eidolon-simulator-export-v1") throw new Error("Unknown export schema");
  if (!Array.isArray(manifest.worlds) || manifest.worlds.join(",") !== "CONCORD,SCHISM,RUIN" || !["CANONICAL", "DIAGNOSTIC"].includes(String(manifest.mode)) || manifest.populationEncoding !== "decimal-string-bigint") throw new Error("Invalid export manifest contract");
  const expected = strFromU8(archive[checksumsName]!).split(/\r?\n/).filter(Boolean);
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const line of expected) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error("Malformed export checksum line");
    const data = archive[`${root}${match[2]}`];
    if (!data || hash(data) !== match[1]) throw new Error(`Export checksum mismatch for ${match[2]}`);
    if (match[2].endsWith(".json")) JSON.parse(strFromU8(data));
    if (match[2].endsWith(".jsonl")) for (const record of strFromU8(data).split(/\r?\n/).filter(Boolean)) JSON.parse(record);
    files.push({ path: match[2], bytes: data });
  }
  const listed = manifest.files as { path: string; sha256: string }[];
  if (!Array.isArray(listed) || listed.length !== expected.length || listed.some((item, index) => item.path !== files[index]?.path || item.sha256 !== hash(files[index]!.bytes))) throw new Error("Manifest file list mismatch");
  if (!files.some((file) => file.path.startsWith("schemas/"))) throw new Error("Export schemas are missing");
  for (const world of ["CONCORD", "SCHISM", "RUIN"]) {
    const eventFile = files.find((file) => file.path === `worlds/${world}/events.jsonl`);
    const worldManifest = files.find((file) => file.path === `worlds/${world}/world_manifest.json`);
    if (!eventFile || !worldManifest) throw new Error(`Missing world contract files for ${world}`);
    const total = (JSON.parse(strFromU8(worldManifest.bytes)) as Record<string, unknown>).totalPopulation;
    if (typeof total !== "string" || !/^\d+$/.test(total)) throw new Error(`Invalid decimal population for ${world}`);
    const orders = new Set<string>();
    const ids = new Set<string>();
    for (const line of strFromU8(eventFile.bytes).split(/\r?\n/).filter(Boolean)) {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.schemaVersion !== "eidolon-simulator-event-v1" || event.runId !== manifest.runId || event.worldKey !== world || !Number.isInteger(event.year) || !Number.isInteger(event.sequence) || typeof event.phase !== "string" || typeof event.eventType !== "string" || typeof event.eventId !== "string") throw new Error(`Invalid event schema in ${world}`);
      const order = `${event.year}:${event.phase}:${event.sequence}`;
      if (orders.has(order) || ids.has(event.eventId)) throw new Error(`Duplicate event order or id in ${world}`);
      orders.add(order); ids.add(event.eventId);
    }
  }
  return { valid: true, manifest, files };
}
