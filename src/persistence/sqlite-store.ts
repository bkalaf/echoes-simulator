import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import type { NamingJob } from "../core/naming/naming.js";
import type { CheckpointEnvelope } from "../core/contracts/domain.js";
import type { Cohort } from "../core/engine/cohort-engine.js";
import type { CausalEventV5, NamingRequestV5, WorldStateV5 } from "../core/v5/types.js";
import type { V5RunManifest } from "../core/v5/persistence.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, extendV5EventHistoryHashFromCanonicalJson, restoreWorldStateV5, v5CheckpointHash } from "../core/v5/persistence.js";
import type { EditableV5Configuration } from "../core/v5/configuration.js";
import { defaultEditableV5Configuration, restoreDiagnosticConfigV1, restoreMechanicsVariablesV1, restoreOperationalConfigV1 } from "../core/v5/configuration.js";

export interface StoredRun {
  runId: string;
  mode: "CANONICAL" | "DIAGNOSTIC";
  status: string;
  seed: string;
  seedHash: string;
  policyVersion: string;
  currentYear?: number;
  createdAt?: string;
}

export interface StoredEvent {
  eventId: string;
  runId: string;
  worldKey: string | null;
  year: number;
  phaseOrder: number;
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
}

export interface StoredPreflight {
  preflightId: string;
  createdAt: string;
  inputDirectory: string;
  inputManifestIdentity: string;
  startingResearchHash: string;
  v3ResearchHash: string | null;
  semanticAuthorityVersion?: string | null;
  semanticAuthorityFilename?: string | null;
  semanticAuthoritySha256?: string | null;
  semanticAuthorityVerdict?: string | null;
  runId?: string | null;
  report: unknown;
}

type BreedPopulationPoint = { year: number; population: string };
type BreedCityPopulation = { settlementId: string; siteId: string; name: string; population: string };
export interface BreedPopulationView {
  runId: string;
  breedId: string;
  requestedYear: number;
  series: Record<"CONCORD" | "SCHISM" | "RUIN", BreedPopulationPoint[]>;
  cities: Record<"CONCORD" | "SCHISM" | "RUIN", { sampledYear: number | null; rows: BreedCityPopulation[] }>;
}

export class SimulatorStore {
  private readonly database: DatabaseSync;

  constructor(readonly filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS simulation_run (
        run_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('CANONICAL','DIAGNOSTIC')),
        status TEXT NOT NULL,
        seed TEXT NOT NULL,
        seed_hash TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        current_year INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS run_input (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        logical_key TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        parse_status TEXT NOT NULL,
        PRIMARY KEY(run_id, logical_key)
      );
      CREATE TABLE IF NOT EXISTS readiness_issue (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        issue_code TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT NOT NULL,
        PRIMARY KEY(run_id, issue_code)
      );
      CREATE TABLE IF NOT EXISTS preflight (
        preflight_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        input_directory TEXT NOT NULL,
        input_manifest_identity TEXT NOT NULL,
        starting_research_hash TEXT NOT NULL,
        v3_research_hash TEXT,
        semantic_authority_version TEXT,
        semantic_authority_filename TEXT,
        semantic_authority_sha256 TEXT,
        semantic_authority_verdict TEXT,
        run_id TEXT REFERENCES simulation_run(run_id),
        report_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS preflight_latest ON preflight(created_at DESC, preflight_id DESC);
      CREATE TABLE IF NOT EXISTS simulation_event (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        phase_order INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(run_id, world_key, year, phase_order, sequence)
      );
      CREATE INDEX IF NOT EXISTS simulation_event_replay ON simulation_event(run_id, world_key, year, phase_order, sequence);
      CREATE TABLE IF NOT EXISTS checkpoint (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        state_json TEXT NOT NULL,
        state_gzip BLOB,
        state_encoding TEXT NOT NULL DEFAULT 'JSON',
        engine_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        UNIQUE(run_id, world_key, year)
      );
      CREATE TABLE IF NOT EXISTS naming_job (
        naming_job_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        year INTEGER NOT NULL,
        status TEXT NOT NULL,
        prompt_sha256 TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        context_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS naming_attempt (
        attempt_id TEXT PRIMARY KEY,
        naming_job_id TEXT NOT NULL REFERENCES naming_job(naming_job_id),
        accepted INTEGER NOT NULL,
        response_text TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS accepted_name (
        naming_job_id TEXT NOT NULL REFERENCES naming_job(naming_job_id),
        request_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY(naming_job_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS cohort_state (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        cohort_id TEXT NOT NULL,
        settlement_id TEXT NOT NULL,
        breed_id TEXT NOT NULL,
        population TEXT NOT NULL,
        wealth_score INTEGER NOT NULL,
        provenance_json TEXT NOT NULL,
        PRIMARY KEY(run_id, world_key, year, cohort_id)
      );
      CREATE INDEX IF NOT EXISTS cohort_by_settlement ON cohort_state(run_id, world_key, year, settlement_id);
      CREATE TABLE IF NOT EXISTS breed_population_summary (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        totals_gzip BLOB NOT NULL,
        PRIMARY KEY(run_id, world_key, year)
      );
      CREATE TABLE IF NOT EXISTS run_projection (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        projection_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(run_id, world_key, year, projection_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS state_membership (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        state_id TEXT NOT NULL,
        settlement_id TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY(run_id, world_key, year, state_id, settlement_id)
      );
      CREATE TABLE IF NOT EXISTS institution_ledger (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        institution_type TEXT NOT NULL,
        ledger_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(run_id, world_key, year, institution_type, ledger_id)
      );
      CREATE TABLE IF NOT EXISTS history_ledger (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        history_type TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY(run_id, world_key, year, history_type, entry_id)
      );
      CREATE INDEX IF NOT EXISTS history_ledger_replay ON history_ledger(run_id, world_key, year, history_type);
      CREATE TABLE IF NOT EXISTS history_chunk (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        history_type TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        payload_sha256 TEXT NOT NULL,
        data_gzip BLOB NOT NULL,
        PRIMARY KEY(run_id, world_key, year, history_type, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS history_chunk_replay ON history_chunk(run_id, world_key, year, history_type);
      CREATE TABLE IF NOT EXISTS export_metadata (
        export_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        created_at TEXT NOT NULL,
        filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_selection (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        selected_run_id TEXT REFERENCES simulation_run(run_id)
      );
      CREATE TABLE IF NOT EXISTS v5_run_manifest (
        run_id TEXT PRIMARY KEY REFERENCES simulation_run(run_id),
        causal_run_hash TEXT NOT NULL,
        operational_config_hash TEXT NOT NULL,
        diagnostic_config_hash TEXT NOT NULL,
        label_input_hash TEXT NOT NULL,
        run_manifest_hash TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v5_causal_event (
        event_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY(run_id, event_id),
        UNIQUE(run_id, world_key, year, sequence)
      );
      CREATE INDEX IF NOT EXISTS v5_causal_event_replay ON v5_causal_event(run_id, world_key, year, sequence);
      CREATE TABLE IF NOT EXISTS v5_checkpoint (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        event_history_hash TEXT NOT NULL,
        state_gzip BLOB NOT NULL,
        UNIQUE(run_id, world_key, year)
      );
      CREATE TABLE IF NOT EXISTS v5_label_input (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        entity_id TEXT NOT NULL,
        label TEXT NOT NULL,
        accepted_year INTEGER NOT NULL,
        PRIMARY KEY(run_id, entity_id)
      );
      CREATE TABLE IF NOT EXISTS v5_naming_request (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        PRIMARY KEY(run_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS v5_configuration (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        mechanics_json TEXT NOT NULL,
        operational_json TEXT NOT NULL,
        diagnostic_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const preflightColumns = new Set((this.database.prepare("PRAGMA table_info(preflight)").all() as { name: string }[]).map((column) => column.name));
    for (const column of ["semantic_authority_version", "semantic_authority_filename", "semantic_authority_sha256", "semantic_authority_verdict"]) {
      if (!preflightColumns.has(column)) this.database.exec(`ALTER TABLE preflight ADD COLUMN ${column} TEXT`);
    }
    const checkpointColumns = new Set((this.database.prepare("PRAGMA table_info(checkpoint)").all() as { name: string }[]).map((column) => column.name));
    if (!checkpointColumns.has("state_gzip")) this.database.exec("ALTER TABLE checkpoint ADD COLUMN state_gzip BLOB");
    if (!checkpointColumns.has("state_encoding")) this.database.exec("ALTER TABLE checkpoint ADD COLUMN state_encoding TEXT NOT NULL DEFAULT 'JSON'");
    const v5EventColumns = this.database.prepare("PRAGMA table_info(v5_causal_event)").all() as { name: string; pk: number }[];
    const v5EventPrimaryKey = v5EventColumns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name).join(",");
    if (v5EventPrimaryKey === "event_id") {
      this.database.exec(`
        ALTER TABLE v5_causal_event RENAME TO v5_causal_event_legacy;
        CREATE TABLE v5_causal_event (
          event_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
          world_key TEXT NOT NULL,
          year INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_json TEXT NOT NULL,
          PRIMARY KEY(run_id, event_id),
          UNIQUE(run_id, world_key, year, sequence)
        );
        INSERT INTO v5_causal_event(event_id, run_id, world_key, year, sequence, event_type, event_json)
          SELECT event_id, run_id, world_key, year, sequence, json_extract(event_json, '$.eventType'), event_json FROM v5_causal_event_legacy;
        DROP TABLE v5_causal_event_legacy;
        CREATE INDEX IF NOT EXISTS v5_causal_event_replay ON v5_causal_event(run_id, world_key, year, sequence);
      `);
    }
    const currentV5EventColumns = new Set((this.database.prepare("PRAGMA table_info(v5_causal_event)").all() as { name: string }[]).map((column) => column.name));
    if (!currentV5EventColumns.has("event_type")) {
      this.database.exec("ALTER TABLE v5_causal_event ADD COLUMN event_type TEXT");
      this.database.exec("UPDATE v5_causal_event SET event_type=json_extract(event_json, '$.eventType') WHERE event_type IS NULL");
    }
    this.database.exec("CREATE INDEX IF NOT EXISTS v5_causal_event_type ON v5_causal_event(run_id, world_key, event_type, year, sequence)");
  }

  saveV5RunManifest(manifest: V5RunManifest): void {
    if (!this.getRun(manifest.runId)) throw new Error(`Unknown run ${manifest.runId}`);
    this.database.prepare(`INSERT INTO v5_run_manifest(run_id, causal_run_hash, operational_config_hash, diagnostic_config_hash, label_input_hash, run_manifest_hash, manifest_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET causal_run_hash=excluded.causal_run_hash, operational_config_hash=excluded.operational_config_hash,
      diagnostic_config_hash=excluded.diagnostic_config_hash, label_input_hash=excluded.label_input_hash, run_manifest_hash=excluded.run_manifest_hash, manifest_json=excluded.manifest_json`)
      .run(manifest.runId, manifest.causalRunHash, manifest.operationalConfigHash, manifest.diagnosticConfigHash, manifest.labelInputHash, manifest.runManifestHash, canonicalJson(manifest));
  }

  loadV5RunManifest(runId: string): V5RunManifest | null {
    const row = this.database.prepare("SELECT manifest_json FROM v5_run_manifest WHERE run_id=?").get(runId) as { manifest_json: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.manifest_json) as V5RunManifest & { mechanicsVariables: V5RunManifest["mechanicsVariables"] & { initialPopulation: string; initialTierWeights: string[]; foundingMinimumPopulation: string; secessionMinimumPopulation: string; conflictStatePopulationReference: string }; diagnosticConfig: V5RunManifest["diagnosticConfig"] & { endingPopulationGoal: string; foundingNotabilityThreshold: string } };
    return { ...parsed, mechanicsVariables: { ...parsed.mechanicsVariables, initialPopulation: BigInt(parsed.mechanicsVariables.initialPopulation), initialTierWeights: parsed.mechanicsVariables.initialTierWeights.map(BigInt) as unknown as readonly [bigint, bigint, bigint], foundingMinimumPopulation: BigInt(parsed.mechanicsVariables.foundingMinimumPopulation), secessionMinimumPopulation: BigInt(parsed.mechanicsVariables.secessionMinimumPopulation), conflictStatePopulationReference: BigInt(parsed.mechanicsVariables.conflictStatePopulationReference) }, diagnosticConfig: { ...parsed.diagnosticConfig, endingPopulationGoal: BigInt(parsed.diagnosticConfig.endingPopulationGoal), foundingNotabilityThreshold: BigInt(parsed.diagnosticConfig.foundingNotabilityThreshold) } };
  }

  appendV5CausalEvents(runId: string, events: readonly CausalEventV5[]): void {
    if (events.length === 0) return;
    const insert = this.database.prepare(`INSERT INTO v5_causal_event(event_id, run_id, world_key, year, sequence, event_type, event_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const event of [...events].sort((a, b) => a.year - b.year || a.sequence - b.sequence || a.eventId.localeCompare(b.eventId))) insert.run(event.eventId, runId, event.worldKey, event.year, event.sequence, event.eventType, canonicalJson(event));
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listV5CausalEvents(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): CausalEventV5[] {
    const rows = this.database.prepare("SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? ORDER BY year, sequence").all(runId, worldKey, throughYear) as { event_json: string }[];
    return rows.map((row) => JSON.parse(row.event_json) as CausalEventV5);
  }

  listV5CausalEventsByTypes(runId: string, worldKey: string, eventTypes: readonly string[], throughYear = Number.MAX_SAFE_INTEGER): CausalEventV5[] {
    if (eventTypes.length === 0) return [];
    const placeholders = eventTypes.map(() => "?").join(",");
    const rows = this.database.prepare(`SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? AND event_type IN (${placeholders}) ORDER BY year, sequence`).all(runId, worldKey, throughYear, ...eventTypes) as { event_json: string }[];
    return rows.map((row) => JSON.parse(row.event_json) as CausalEventV5);
  }

  summarizeV5CausalEventHistory(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): { eventHistoryHash: string; eventCount: number } {
    const rows = this.database.prepare("SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? ORDER BY year, sequence").iterate(runId, worldKey, throughYear) as Iterable<{ event_json: string }>;
    let eventHistoryHash = V5_EMPTY_EVENT_HISTORY_HASH;
    let eventCount = 0;
    eventHistoryHash = extendV5EventHistoryHashFromCanonicalJson(eventHistoryHash, (function* (): Iterable<string> {
      for (const row of rows) { eventCount += 1; yield row.event_json; }
    })());
    return { eventHistoryHash, eventCount };
  }

  v5EventCount(runId: string): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM v5_causal_event WHERE run_id=?").get(runId) as { count: number }).count;
  }

  saveV5Checkpoint(runId: string, state: WorldStateV5, eventHistoryHash: string): { checkpointId: string; stateHash: string; eventHistoryHash: string } {
    if (!/^[0-9a-f]{64}$/.test(eventHistoryHash)) throw new Error(`Invalid V5 event-history hash ${eventHistoryHash}`);
    const stateHash = v5CheckpointHash(state); const checkpointId = `V5_CHECKPOINT_${runId}_${state.worldKey}_${state.year}_${stateHash.slice(0, 16)}`;
    const stateGzip = gzipSync(canonicalJson(state), { level: 9 });
    this.database.prepare(`INSERT INTO v5_checkpoint(checkpoint_id, run_id, world_key, year, state_hash, event_history_hash, state_gzip) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, world_key, year) DO UPDATE SET checkpoint_id=excluded.checkpoint_id, state_hash=excluded.state_hash, event_history_hash=excluded.event_history_hash, state_gzip=excluded.state_gzip`)
      .run(checkpointId, runId, state.worldKey, state.year, stateHash, eventHistoryHash, stateGzip);
    return { checkpointId, stateHash, eventHistoryHash };
  }

  loadLatestV5Checkpoint(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): { state: WorldStateV5; stateHash: string; eventHistoryHash: string } | null {
    const row = this.database.prepare("SELECT state_hash, event_history_hash, state_gzip FROM v5_checkpoint WHERE run_id=? AND world_key=? AND year<=? ORDER BY year DESC LIMIT 1").get(runId, worldKey, throughYear) as { state_hash: string; event_history_hash: string; state_gzip: Uint8Array } | undefined;
    if (!row) return null;
    const state = restoreWorldStateV5(JSON.parse(gunzipSync(row.state_gzip).toString("utf8")));
    if (v5CheckpointHash(state) !== row.state_hash) throw new Error(`V5 checkpoint state hash mismatch for ${runId}/${worldKey}`);
    return { state, stateHash: row.state_hash, eventHistoryHash: row.event_history_hash };
  }

  listV5CheckpointYears(runId: string, worldKey: string): number[] {
    return (this.database.prepare("SELECT year FROM v5_checkpoint WHERE run_id=? AND world_key=? ORDER BY year").all(runId, worldKey) as { year: number }[]).map((row) => row.year);
  }

  listV5CheckpointMetadata(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): { year: number; stateHash: string }[] {
    return (this.database.prepare("SELECT year, state_hash FROM v5_checkpoint WHERE run_id=? AND world_key=? AND year<=? ORDER BY year").all(runId, worldKey, throughYear) as { year: number; state_hash: string }[]).map((row) => ({ year: row.year, stateHash: row.state_hash }));
  }

  v5CheckpointCount(runId: string): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM v5_checkpoint WHERE run_id=?").get(runId) as { count: number }).count;
  }

  saveV5Labels(runId: string, acceptedYear: number, labels: Readonly<Record<string, string>>): void {
    const insert = this.database.prepare(`INSERT INTO v5_label_input(run_id, entity_id, label, accepted_year) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, entity_id) DO UPDATE SET label=excluded.label, accepted_year=excluded.accepted_year`);
    this.database.exec("BEGIN IMMEDIATE");
    try { for (const [entityId, label] of Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))) { if (!label.trim()) throw new Error(`Empty V5 label for ${entityId}`); insert.run(runId, entityId, label.trim(), acceptedYear); } this.database.exec("COMMIT"); }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  saveV5NamingRequests(runId: string, requests: readonly NamingRequestV5[]): void {
    if (requests.length === 0) return;
    const insert = this.database.prepare(`INSERT INTO v5_naming_request(run_id, request_id, request_json) VALUES (?, ?, ?)
      ON CONFLICT(run_id, request_id) DO UPDATE SET request_json=excluded.request_json`);
    this.database.exec("BEGIN IMMEDIATE");
    try { for (const request of [...requests].sort((a, b) => a.requestId.localeCompare(b.requestId))) insert.run(runId, request.requestId, canonicalJson(request)); this.database.exec("COMMIT"); }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listV5NamingRequests(runId: string): NamingRequestV5[] {
    return (this.database.prepare("SELECT request_json FROM v5_naming_request WHERE run_id=? ORDER BY request_id").all(runId) as { request_json: string }[]).map((row) => JSON.parse(row.request_json) as NamingRequestV5);
  }

  loadV5Labels(runId: string): Record<string, string> {
    const rows = this.database.prepare("SELECT entity_id, label FROM v5_label_input WHERE run_id=? ORDER BY entity_id").all(runId) as { entity_id: string; label: string }[];
    return Object.fromEntries(rows.map((row) => [row.entity_id, row.label]));
  }

  acceptV5NamingRequests(runId: string, decisions: readonly { requestId: string; entityId: string; label: string }[], acceptedYear: number, behavior: "BLOCKING" | "BATCHED" = "BLOCKING"): void {
    if (decisions.length === 0) throw new Error("V5 naming response is empty");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const pendingRows = this.database.prepare("SELECT request_id, request_json FROM v5_naming_request WHERE run_id=?").all(runId) as { request_id: string; request_json: string }[];
      const pending = new Map(pendingRows.map((row) => [row.request_id, JSON.parse(row.request_json) as NamingRequestV5]));
      const requiredIds = new Set(decisions.map((decision) => decision.requestId));
      if (decisions.length !== requiredIds.size) throw new Error("V5 naming response contains duplicate request IDs");
      if (behavior === "BLOCKING") {
        const required = [...pending.values()].filter((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null);
        if (decisions.length !== required.length || required.some((request) => !requiredIds.has(request.requestId))) throw new Error("V5 naming response must exactly cover the current blocking batch");
      }
      const updateRequest = this.database.prepare("UPDATE v5_naming_request SET request_json=? WHERE run_id=? AND request_id=?");
      const upsertLabel = this.database.prepare(`INSERT INTO v5_label_input(run_id, entity_id, label, accepted_year) VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, entity_id) DO UPDATE SET label=excluded.label, accepted_year=excluded.accepted_year`);
      for (const decision of [...decisions].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
        const request = pending.get(decision.requestId);
        if (!request || request.behavior !== behavior || request.acceptedLabel !== null || request.entityId !== decision.entityId || !decision.label.trim()) throw new Error(`Invalid V5 naming decision ${decision.requestId}`);
        const accepted = { ...request, acceptedLabel: decision.label.trim() };
        updateRequest.run(canonicalJson(accepted), runId, request.requestId);
        upsertLabel.run(runId, request.entityId, accepted.acceptedLabel, acceptedYear);
      }
      if (behavior === "BLOCKING") this.database.prepare("UPDATE simulation_run SET status='RUNNING', updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='WAITING_FOR_NAMING'").run(runId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  loadV5Configuration(): EditableV5Configuration {
    const row = this.database.prepare("SELECT mechanics_json, operational_json, diagnostic_json FROM v5_configuration WHERE singleton=1").get() as { mechanics_json: string; operational_json: string; diagnostic_json: string } | undefined;
    if (!row) return defaultEditableV5Configuration();
    return {
      mechanics: restoreMechanicsVariablesV1(JSON.parse(row.mechanics_json)),
      operational: restoreOperationalConfigV1(JSON.parse(row.operational_json)),
      diagnostic: restoreDiagnosticConfigV1(JSON.parse(row.diagnostic_json)),
    };
  }

  saveV5Configuration(configuration: EditableV5Configuration): void {
    // Restore performs schema, integer, range, and exact weight validation before
    // any persisted configuration can become a future run snapshot.
    const validated = {
      mechanics: restoreMechanicsVariablesV1(JSON.parse(canonicalJson(configuration.mechanics))),
      operational: restoreOperationalConfigV1(JSON.parse(canonicalJson(configuration.operational))),
      diagnostic: restoreDiagnosticConfigV1(JSON.parse(canonicalJson(configuration.diagnostic))),
    };
    this.database.prepare(`INSERT INTO v5_configuration(singleton, mechanics_json, operational_json, diagnostic_json)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET mechanics_json=excluded.mechanics_json, operational_json=excluded.operational_json,
      diagnostic_json=excluded.diagnostic_json, updated_at=CURRENT_TIMESTAMP`)
      .run(canonicalJson(validated.mechanics), canonicalJson(validated.operational), canonicalJson(validated.diagnostic));
  }

  createRun(run: StoredRun): void {
    this.database.prepare("INSERT INTO simulation_run(run_id, mode, status, seed, seed_hash, policy_version) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.runId, run.mode, run.status, run.seed, run.seedHash, run.policyVersion);
  }

  getRun(runId: string): StoredRun | null {
    const row = this.database.prepare("SELECT run_id, mode, status, seed, seed_hash, policy_version, current_year, created_at FROM simulation_run WHERE run_id = ?").get(runId) as {
      run_id: string; mode: StoredRun["mode"]; status: string; seed: string; seed_hash: string; policy_version: string; current_year: number; created_at: string;
    } | undefined;
    return row ? { runId: row.run_id, mode: row.mode, status: row.status, seed: row.seed, seedHash: row.seed_hash, policyVersion: row.policy_version, currentYear: row.current_year, createdAt: row.created_at } : null;
  }

  listRuns(): StoredRun[] {
    const rows = this.database.prepare("SELECT run_id FROM simulation_run ORDER BY created_at, run_id").all() as { run_id: string }[];
    return rows.map((row) => this.getRun(row.run_id)!);
  }

  latestRun(): StoredRun | null {
    const row = this.database.prepare("SELECT run_id FROM simulation_run ORDER BY updated_at DESC, created_at DESC, run_id DESC LIMIT 1").get() as { run_id: string } | undefined;
    return row ? this.getRun(row.run_id) : null;
  }

  selectRun(runId: string): void {
    if (!this.getRun(runId)) throw new Error(`Unknown run ${runId}`);
    this.database.prepare("INSERT INTO operator_selection(singleton, selected_run_id) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET selected_run_id=excluded.selected_run_id").run(runId);
  }

  selectedRun(): StoredRun | null {
    const row = this.database.prepare("SELECT selected_run_id FROM operator_selection WHERE singleton=1").get() as { selected_run_id: string | null } | undefined;
    return row?.selected_run_id ? this.getRun(row.selected_run_id) : this.latestRun();
  }

  setRunStatus(runId: string, status: string, currentYear: number): void {
    this.database.prepare("UPDATE simulation_run SET status=?, current_year=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=?").run(status, currentYear, runId);
  }

  retireCanonicalRunsExcept(policyVersion: string): number {
    const retired = this.database.prepare("UPDATE simulation_run SET status='RETIRED_DATA_AUTHORITY', updated_at=CURRENT_TIMESTAMP WHERE mode='CANONICAL' AND policy_version<>? AND status<>'RETIRED_DATA_AUTHORITY'").run(policyVersion);
    this.database.prepare("UPDATE naming_job SET status='RETIRED' WHERE status='PENDING' AND run_id IN (SELECT run_id FROM simulation_run WHERE status='RETIRED_DATA_AUTHORITY')").run();
    return Number(retired.changes);
  }

  saveCohorts(runId: string, year: number, cohorts: readonly Cohort[]): void {
    const insert = this.database.prepare(`INSERT INTO cohort_state(
      run_id, world_key, year, cohort_id, settlement_id, breed_id, population, wealth_score, provenance_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const worldKey of new Set(cohorts.map((cohort) => cohort.worldKey))) this.database.prepare("DELETE FROM cohort_state WHERE run_id=? AND world_key=?").run(runId, worldKey);
      for (const cohort of cohorts) insert.run(runId, cohort.worldKey, year, cohort.cohortId, cohort.settlementId, cohort.breedId, cohort.population.toString(), cohort.wealthScore, canonicalJson({ createdYear: cohort.createdYear, originCohortId: cohort.originCohortId, createdByEventId: cohort.createdByEventId, outboundMigrationNotBeforeYear: cohort.outboundMigrationNotBeforeYear }));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadCohorts(runId: string, worldKey: string, year: number): Cohort[] {
    const rows = this.database.prepare(`SELECT cohort_id, settlement_id, breed_id, population, wealth_score, provenance_json
      FROM cohort_state WHERE run_id=? AND world_key=? AND year=? ORDER BY cohort_id`).all(runId, worldKey, year) as {
        cohort_id: string; settlement_id: string; breed_id: string; population: string; wealth_score: number; provenance_json: string;
      }[];
    return rows.map((row) => {
      const provenance = JSON.parse(row.provenance_json) as Pick<Cohort, "createdYear" | "originCohortId" | "createdByEventId" | "outboundMigrationNotBeforeYear">;
      return { cohortId: row.cohort_id, worldKey: worldKey as Cohort["worldKey"], settlementId: row.settlement_id, breedId: row.breed_id, population: BigInt(row.population), wealthScore: row.wealth_score, ...provenance };
    });
  }

  countCohorts(runId: string, worldKey?: string, year = 0): number {
    const row = worldKey
      ? this.database.prepare("SELECT COUNT(*) AS count FROM cohort_state WHERE run_id=? AND world_key=? AND year=?").get(runId, worldKey, year)
      : this.database.prepare("SELECT COUNT(*) AS count FROM cohort_state WHERE run_id=? AND year=?").get(runId, year);
    return Number((row as { count: number }).count);
  }

  cohortPopulation(runId: string, worldKey: string, year: number): bigint {
    const rows = this.database.prepare("SELECT population FROM cohort_state WHERE run_id=? AND world_key=? AND year=?").all(runId, worldKey, year) as { population: string }[];
    return rows.reduce((sum, row) => sum + BigInt(row.population), 0n);
  }

  saveProjection(runId: string, worldKey: string, year: number, projectionType: string, entityId: string, data: unknown): void {
    this.database.prepare(`INSERT INTO run_projection(run_id, world_key, year, projection_type, entity_id, data_json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, world_key, year, projection_type, entity_id) DO UPDATE SET data_json=excluded.data_json`)
      .run(runId, worldKey, year, projectionType, entityId, canonicalJson(data));
  }

  getProjection(runId: string, worldKey: string, year: number, projectionType: string, entityId: string): unknown | null {
    const row = this.database.prepare("SELECT data_json FROM run_projection WHERE run_id=? AND world_key=? AND year<=? AND projection_type=? AND entity_id=? ORDER BY year DESC LIMIT 1")
      .get(runId, worldKey, year, projectionType, entityId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) : null;
  }

  listProjections(runId: string, worldKey: string, year: number, projectionType: string): unknown[] {
    const rows = this.database.prepare(`SELECT p.data_json FROM run_projection p JOIN (
      SELECT entity_id, MAX(year) AS max_year FROM run_projection WHERE run_id=? AND world_key=? AND year<=? AND projection_type=? GROUP BY entity_id
    ) latest ON p.entity_id=latest.entity_id AND p.year=latest.max_year WHERE p.run_id=? AND p.world_key=? AND p.projection_type=? ORDER BY p.entity_id`)
      .all(runId, worldKey, year, projectionType, runId, worldKey, projectionType) as { data_json: string }[];
    return rows.map((row) => JSON.parse(row.data_json));
  }

  saveHistoryRows(runId: string, rows: readonly { worldKey: string; year: number; historyType: string; entryId: string; data: unknown }[]): void {
    if (rows.length === 0) return;
    const chunkedTypes = new Set(["SOCIAL"]);
    const regularRows = rows.filter((row) => !chunkedTypes.has(row.historyType));
    const grouped = new Map<string, typeof rows[number][]>();
    for (const row of rows.filter((candidate) => chunkedTypes.has(candidate.historyType))) {
      const key = `${row.worldKey}\0${row.year}\0${row.historyType}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const compressedGroups = [...grouped.entries()].map(([key, groupRows]) => {
      const [worldKey, yearText, historyType] = key.split("\0") as [string, string, string];
      const chunks = [] as { chunkIndex: number; rowCount: number; sha256: string; bytes: Uint8Array }[];
      const sorted = [...groupRows].sort((left, right) => left.entryId.localeCompare(right.entryId));
      for (let offset = 0; offset < sorted.length; offset += 5_000) {
        const payload = canonicalJson(sorted.slice(offset, offset + 5_000).map((row) => ({ entryId: row.entryId, data: row.data })));
        chunks.push({ chunkIndex: chunks.length, rowCount: Math.min(5_000, sorted.length - offset), sha256: createHash("sha256").update(payload).digest("hex"), bytes: gzipSync(payload, { level: 9 }) });
      }
      return { worldKey, year: Number(yearText), historyType, chunks };
    });
    const insert = this.database.prepare(`INSERT INTO history_ledger(run_id, world_key, year, history_type, entry_id, data_json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, world_key, year, history_type, entry_id) DO UPDATE SET data_json=excluded.data_json`);
    const insertChunk = this.database.prepare(`INSERT INTO history_chunk(run_id, world_key, year, history_type, chunk_index, row_count, payload_sha256, data_gzip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, world_key, year, history_type, chunk_index) DO UPDATE SET row_count=excluded.row_count, payload_sha256=excluded.payload_sha256, data_gzip=excluded.data_gzip`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of regularRows) insert.run(runId, row.worldKey, row.year, row.historyType, row.entryId, canonicalJson(row.data));
      for (const group of compressedGroups) {
        this.database.prepare("DELETE FROM history_chunk WHERE run_id=? AND world_key=? AND year=? AND history_type=?").run(runId, group.worldKey, group.year, group.historyType);
        for (const chunk of group.chunks) insertChunk.run(runId, group.worldKey, group.year, group.historyType, chunk.chunkIndex, chunk.rowCount, chunk.sha256, chunk.bytes);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listHistoryRows(runId: string, historyType?: string): { worldKey: string; year: number; historyType: string; entryId: string; data: unknown }[] {
    const rows = (historyType
      ? this.database.prepare("SELECT world_key, year, history_type, entry_id, data_json FROM history_ledger WHERE run_id=? AND history_type=? ORDER BY year, world_key, entry_id").all(runId, historyType)
      : this.database.prepare("SELECT world_key, year, history_type, entry_id, data_json FROM history_ledger WHERE run_id=? ORDER BY year, world_key, history_type, entry_id").all(runId)) as { world_key: string; year: number; history_type: string; entry_id: string; data_json: string }[];
    const result = rows.map((row) => ({ worldKey: row.world_key, year: row.year, historyType: row.history_type, entryId: row.entry_id, data: JSON.parse(row.data_json) }));
    const chunkRows = (historyType
      ? this.database.prepare("SELECT world_key, year, history_type, payload_sha256, data_gzip FROM history_chunk WHERE run_id=? AND history_type=? ORDER BY year, world_key, chunk_index").all(runId, historyType)
      : this.database.prepare("SELECT world_key, year, history_type, payload_sha256, data_gzip FROM history_chunk WHERE run_id=? AND history_type<>'MIGRATION_EXACT_ARCHIVE' ORDER BY year, world_key, history_type, chunk_index").all(runId)) as { world_key: string; year: number; history_type: string; payload_sha256: string; data_gzip: Uint8Array }[];
    for (const chunk of chunkRows) {
      const payload = gunzipSync(chunk.data_gzip).toString("utf8");
      if (createHash("sha256").update(payload).digest("hex") !== chunk.payload_sha256) throw new Error(`History chunk checksum mismatch for ${runId}/${chunk.world_key}/${chunk.year}/${chunk.history_type}`);
      const decoded = JSON.parse(payload) as { entryId: string; data: unknown }[];
      result.push(...decoded.map((row) => ({ worldKey: chunk.world_key, year: chunk.year, historyType: chunk.history_type, entryId: row.entryId, data: row.data })));
    }
    return result.sort((left, right) => left.year - right.year || left.worldKey.localeCompare(right.worldKey) || left.historyType.localeCompare(right.historyType) || left.entryId.localeCompare(right.entryId));
  }

  listHistoryRowsForView(runId: string, worldKey: string, throughYear: number): { worldKey: string; year: number; historyType: string; entryId: string; data: unknown }[] {
    const rows = this.database.prepare(`SELECT world_key, year, history_type, entry_id, data_json
      FROM history_ledger
      WHERE run_id=? AND world_key=? AND year<=?
        AND history_type NOT IN ('MIGRATION', 'SOCIAL')
      ORDER BY year, history_type, entry_id`).all(runId, worldKey, throughYear) as { world_key: string; year: number; history_type: string; entry_id: string; data_json: string }[];
    return rows.map((row) => ({ worldKey: row.world_key, year: row.year, historyType: row.history_type, entryId: row.entry_id, data: JSON.parse(row.data_json) }));
  }

  compactCanonicalStorage(runId: string, onProgress: (message: string) => void = () => undefined): { archivedMigrationRows: number; migrationSummaries: number; compressedCheckpoints: number; removedCohortRows: number } {
    const run = this.getRun(runId);
    if (!run || run.mode !== "CANONICAL") throw new Error(`Unknown canonical run ${runId}`);
    if (!['WAITING_FOR_NAMING', 'COMPLETE'].includes(run.status)) throw new Error(`Canonical storage compaction requires a paused or complete run, not ${run.status}`);
    const groups = this.database.prepare(`SELECT world_key, year, COUNT(*) AS row_count
      FROM history_ledger WHERE run_id=? AND history_type='MIGRATION' AND entry_id NOT LIKE 'MIGRATION_SUMMARY_%'
      GROUP BY world_key, year ORDER BY year, world_key`).all(runId) as { world_key: string; year: number; row_count: number }[];
    const selectRows = this.database.prepare(`SELECT entry_id, data_json FROM history_ledger
      WHERE run_id=? AND world_key=? AND year=? AND history_type='MIGRATION' AND entry_id NOT LIKE 'MIGRATION_SUMMARY_%'
      ORDER BY entry_id`);
    const insertChunk = this.database.prepare(`INSERT INTO history_chunk(run_id, world_key, year, history_type, chunk_index, row_count, payload_sha256, data_gzip)
      VALUES (?, ?, ?, 'MIGRATION_EXACT_ARCHIVE', ?, ?, ?, ?)`);
    const insertSummary = this.database.prepare(`INSERT INTO history_ledger(run_id, world_key, year, history_type, entry_id, data_json)
      VALUES (?, ?, ?, 'MIGRATION', ?, ?)
      ON CONFLICT(run_id, world_key, year, history_type, entry_id) DO UPDATE SET data_json=excluded.data_json`);
    let archivedMigrationRows = 0;
    let migrationSummaries = 0;
    for (const [groupIndex, group] of groups.entries()) {
      this.database.prepare("DELETE FROM history_chunk WHERE run_id=? AND world_key=? AND year=? AND history_type='MIGRATION_EXACT_ARCHIVE'").run(runId, group.world_key, group.year);
      const exactDigest = createHash("sha256");
      const routes = new Map<string, { fromSettlementId: string; toSettlementId: string; population: bigint; transferCount: number }>();
      let population = 0n;
      let rowCount = 0;
      let chunkIndex = 0;
      let archiveRows: { entryId: string; data: unknown }[] = [];
      const flushArchive = (): void => {
        if (archiveRows.length === 0) return;
        const payload = canonicalJson(archiveRows);
        const sha256 = createHash("sha256").update(payload).digest("hex");
        const bytes = gzipSync(payload, { level: 1 });
        if (gunzipSync(bytes).toString("utf8") !== payload) throw new Error(`Migration archive verification failed for ${group.world_key} year ${group.year}`);
        insertChunk.run(runId, group.world_key, group.year, chunkIndex, archiveRows.length, sha256, bytes);
        chunkIndex += 1;
        archiveRows = [];
      };
      for (const row of selectRows.iterate(runId, group.world_key, group.year) as Iterable<{ entry_id: string; data_json: string }>) {
        const data = JSON.parse(row.data_json) as { fromSettlementId: string; toSettlementId: string; population: string };
        exactDigest.update(row.entry_id).update("\0").update(row.data_json).update("\n");
        const amount = BigInt(data.population); population += amount; rowCount += 1;
        const key = `${data.fromSettlementId}\0${data.toSettlementId}`;
        const route = routes.get(key) ?? { fromSettlementId: data.fromSettlementId, toSettlementId: data.toSettlementId, population: 0n, transferCount: 0 };
        route.population += amount; route.transferCount += 1; routes.set(key, route);
        archiveRows.push({ entryId: row.entry_id, data });
        if (archiveRows.length === 5_000) flushArchive();
      }
      flushArchive();
      if (rowCount !== group.row_count) throw new Error(`Migration archive row mismatch for ${group.world_key} year ${group.year}: ${rowCount} != ${group.row_count}`);
      const archived = this.database.prepare(`SELECT COALESCE(SUM(row_count), 0) AS row_count FROM history_chunk
        WHERE run_id=? AND world_key=? AND year=? AND history_type='MIGRATION_EXACT_ARCHIVE'`).get(runId, group.world_key, group.year) as { row_count: number };
      if (Number(archived.row_count) !== rowCount) throw new Error(`Migration archive verification count failed for ${group.world_key} year ${group.year}`);
      const summary = {
        schemaVersion: "eidolon-simulator-migration-year-summary-v1", world: group.world_key, year: group.year, transferCount: rowCount, population: population.toString(), migrantWealth: 0,
        routes: [...routes.values()].sort((left, right) => left.fromSettlementId.localeCompare(right.fromSettlementId) || left.toSettlementId.localeCompare(right.toSettlementId)).map((route) => ({ ...route, population: route.population.toString() })),
        exactRowsSha256: exactDigest.digest("hex"), exactRowsDigestEncoding: "ENTRY_ID_NUL_STORED_JSON_LF_V1", exactRowsRetention: "CHECKSUMMED_GZIP_ARCHIVE", archiveHistoryType: "MIGRATION_EXACT_ARCHIVE", archiveChunkCount: chunkIndex,
      };
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.prepare("DELETE FROM history_ledger WHERE run_id=? AND world_key=? AND year=? AND history_type='MIGRATION' AND entry_id NOT LIKE 'MIGRATION_SUMMARY_%'").run(runId, group.world_key, group.year);
        insertSummary.run(runId, group.world_key, group.year, `MIGRATION_SUMMARY_${group.world_key}_${group.year}`, canonicalJson(summary));
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
      archivedMigrationRows += rowCount;
      migrationSummaries += 1;
      onProgress(`migration ${groupIndex + 1}/${groups.length} · ${group.world_key} year ${group.year} · ${rowCount} exact rows archived`);
    }

    const legacyCheckpoints = this.database.prepare("SELECT run_id, world_key, year, state_json FROM checkpoint WHERE run_id=? AND state_encoding<>'GZIP_JSON_V1' ORDER BY year, world_key").all(runId) as { run_id: string; world_key: string; year: number; state_json: string }[];
    let compressedCheckpoints = 0;
    for (const [index, checkpoint] of legacyCheckpoints.entries()) {
      const bytes = gzipSync(checkpoint.state_json, { level: 1 });
      if (gunzipSync(bytes).toString("utf8") !== checkpoint.state_json) throw new Error(`Checkpoint compression verification failed for ${checkpoint.world_key} year ${checkpoint.year}`);
      this.database.prepare("UPDATE checkpoint SET state_json='', state_gzip=?, state_encoding='GZIP_JSON_V1' WHERE run_id=? AND world_key=? AND year=?").run(bytes, runId, checkpoint.world_key, checkpoint.year);
      compressedCheckpoints += 1;
      onProgress(`checkpoint ${index + 1}/${legacyCheckpoints.length} · ${checkpoint.world_key} year ${checkpoint.year}`);
    }
    const removedCohortRows = Number(this.database.prepare("DELETE FROM cohort_state WHERE run_id=? AND year<>?").run(runId, run.currentYear ?? 0).changes);
    onProgress(`cohort snapshots · removed ${removedCohortRows} redundant intermediate rows; retained year ${run.currentYear ?? 0}`);
    return { archivedMigrationRows, migrationSummaries, compressedCheckpoints, removedCohortRows };
  }

  reclaimFreePages(): void {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize;");
  }

  savePreflight(preflight: StoredPreflight): void {
    this.database.prepare(`INSERT INTO preflight(
      preflight_id, created_at, input_directory, input_manifest_identity,
      starting_research_hash, v3_research_hash, semantic_authority_version,
      semantic_authority_filename, semantic_authority_sha256, semantic_authority_verdict,
      run_id, report_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        preflight.preflightId,
        preflight.createdAt,
        preflight.inputDirectory,
        preflight.inputManifestIdentity,
        preflight.startingResearchHash,
        preflight.v3ResearchHash,
        preflight.semanticAuthorityVersion ?? null,
        preflight.semanticAuthorityFilename ?? null,
        preflight.semanticAuthoritySha256 ?? null,
        preflight.semanticAuthorityVerdict ?? null,
        preflight.runId ?? null,
        canonicalJson(preflight.report),
      );
  }

  getLatestPreflight(): StoredPreflight | null {
    const row = this.database.prepare(`SELECT preflight_id, created_at, input_directory,
      input_manifest_identity, starting_research_hash, v3_research_hash,
      semantic_authority_version, semantic_authority_filename, semantic_authority_sha256, semantic_authority_verdict,
      run_id, report_json
      FROM preflight ORDER BY created_at DESC, preflight_id DESC LIMIT 1`).get() as {
        preflight_id: string;
        created_at: string;
        input_directory: string;
        input_manifest_identity: string;
        starting_research_hash: string;
        v3_research_hash: string | null;
        semantic_authority_version: string | null;
        semantic_authority_filename: string | null;
        semantic_authority_sha256: string | null;
        semantic_authority_verdict: string | null;
        run_id: string | null;
        report_json: string;
      } | undefined;
    return row ? {
      preflightId: row.preflight_id,
      createdAt: row.created_at,
      inputDirectory: row.input_directory,
      inputManifestIdentity: row.input_manifest_identity,
      startingResearchHash: row.starting_research_hash,
      v3ResearchHash: row.v3_research_hash,
      semanticAuthorityVersion: row.semantic_authority_version,
      semanticAuthorityFilename: row.semantic_authority_filename,
      semanticAuthoritySha256: row.semantic_authority_sha256,
      semanticAuthorityVerdict: row.semantic_authority_verdict,
      runId: row.run_id,
      report: JSON.parse(row.report_json),
    } : null;
  }

  appendEvent(event: StoredEvent): void {
    this.database.prepare(`INSERT INTO simulation_event(event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.eventId, event.runId, event.worldKey ?? "SHARED", event.year, event.phaseOrder, event.sequence, event.eventType, event.entityType, event.entityId, canonicalJson(event.payload));
  }

  upsertEvent(event: StoredEvent): void {
    this.database.prepare(`INSERT INTO simulation_event(event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET payload_json=excluded.payload_json`)
      .run(event.eventId, event.runId, event.worldKey ?? "SHARED", event.year, event.phaseOrder, event.sequence, event.eventType, event.entityType, event.entityId, canonicalJson(event.payload));
  }

  eventCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM simulation_event WHERE run_id = ?").get(runId) as { count: number }).count);
  }

  listEvents(runId: string, worldKey?: string): StoredEvent[] {
    const rows = (worldKey
      ? this.database.prepare("SELECT event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json FROM simulation_event WHERE run_id=? AND world_key=? ORDER BY year, phase_order, sequence").all(runId, worldKey)
      : this.database.prepare("SELECT event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json FROM simulation_event WHERE run_id=? ORDER BY world_key, year, phase_order, sequence").all(runId)) as { event_id: string; run_id: string; world_key: string; year: number; phase_order: number; sequence: number; event_type: string; entity_type: string; entity_id: string; payload_json: string }[];
    return rows.map((row) => ({ eventId: row.event_id, runId: row.run_id, worldKey: row.world_key, year: row.year, phaseOrder: row.phase_order, sequence: row.sequence, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, payload: JSON.parse(row.payload_json) }));
  }

  listEventsThroughYear(runId: string, worldKey: string, throughYear: number): StoredEvent[] {
    const rows = this.database.prepare(`SELECT event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json
      FROM simulation_event WHERE run_id=? AND world_key=? AND year<=?
      ORDER BY year, phase_order, sequence`).all(runId, worldKey, throughYear) as { event_id: string; run_id: string; world_key: string; year: number; phase_order: number; sequence: number; event_type: string; entity_type: string; entity_id: string; payload_json: string }[];
    return rows.map((row) => ({ eventId: row.event_id, runId: row.run_id, worldKey: row.world_key, year: row.year, phaseOrder: row.phase_order, sequence: row.sequence, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, payload: JSON.parse(row.payload_json) }));
  }

  checkpointCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?").get(runId) as { count: number }).count);
  }

  latestCompleteCheckpointYear(runId: string, worldKeys: readonly string[]): number | null {
    if (worldKeys.length === 0) return null;
    const placeholders = worldKeys.map(() => "?").join(",");
    const row = this.database.prepare(`SELECT checkpoint.year FROM checkpoint
      WHERE checkpoint.run_id=? AND checkpoint.world_key IN (${placeholders})
      GROUP BY checkpoint.year HAVING COUNT(DISTINCT checkpoint.world_key)=?
      ORDER BY checkpoint.year DESC LIMIT 1`).get(runId, ...worldKeys, worldKeys.length) as { year: number } | undefined;
    return row?.year ?? null;
  }

  listCheckpoints(runId: string, worldKey?: string): CheckpointEnvelope[] {
    const rows = (worldKey
      ? this.database.prepare("SELECT year FROM checkpoint WHERE run_id=? AND world_key=? ORDER BY year").all(runId, worldKey)
      : this.database.prepare("SELECT world_key, year FROM checkpoint WHERE run_id=? ORDER BY world_key, year").all(runId)) as { world_key?: string; year: number }[];
    return rows.map((row) => this.loadCheckpoint(runId, (worldKey ?? row.world_key) as CheckpointEnvelope["worldKey"], row.year)!).filter(Boolean);
  }

  listCheckpointMetadata(runId: string, worldKey: string, throughYear: number): { year: number; stateHash: string }[] {
    const rows = this.database.prepare(`SELECT year, state_hash FROM checkpoint
      WHERE run_id=? AND world_key=? AND year<=? ORDER BY year`).all(runId, worldKey, throughYear) as { year: number; state_hash: string }[];
    return rows.map((row) => ({ year: row.year, stateHash: row.state_hash }));
  }

  saveCheckpoint(checkpoint: CheckpointEnvelope): void {
    const stateJson = canonicalJson(checkpoint.state);
    const stateGzip = gzipSync(stateJson, { level: 6 });
    this.database.prepare(`INSERT INTO checkpoint(checkpoint_id, run_id, world_key, year, state_hash, state_json, state_gzip, state_encoding, engine_version, policy_version)
      VALUES (?, ?, ?, ?, ?, '', ?, 'GZIP_JSON_V1', ?, ?)
      ON CONFLICT(run_id, world_key, year) DO UPDATE SET checkpoint_id=excluded.checkpoint_id, state_hash=excluded.state_hash, state_json=excluded.state_json, state_gzip=excluded.state_gzip, state_encoding=excluded.state_encoding, engine_version=excluded.engine_version, policy_version=excluded.policy_version`)
      .run(checkpoint.checkpointId, checkpoint.runId, checkpoint.worldKey, checkpoint.year, checkpoint.stateHash, stateGzip, checkpoint.engineVersion, checkpoint.policyVersion);
    this.saveBreedPopulationSummary(checkpoint.runId, checkpoint.worldKey, checkpoint.year, checkpoint.state);
  }

  private saveBreedPopulationSummary(runId: string, worldKey: string, year: number, candidate: unknown): void {
    const state = candidate as { cohorts?: { breedId?: unknown; population?: unknown }[] } | null;
    if (!state?.cohorts) return;
    const totals = new Map<string, bigint>();
    for (const cohort of state.cohorts) {
      if (typeof cohort.breedId !== "string" || cohort.population === undefined || cohort.population === null) continue;
      totals.set(cohort.breedId, (totals.get(cohort.breedId) ?? 0n) + BigInt(String(cohort.population)));
    }
    const payload = canonicalJson(Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([breedId, population]) => [breedId, population.toString()])));
    this.database.prepare(`INSERT INTO breed_population_summary(run_id, world_key, year, totals_gzip) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, world_key, year) DO UPDATE SET totals_gzip=excluded.totals_gzip`).run(runId, worldKey, year, gzipSync(payload, { level: 6 }));
  }

  private backfillBreedPopulationSummaries(runId: string): void {
    const rows = this.database.prepare(`SELECT c.run_id, c.world_key, c.year, c.state_json, c.state_gzip, c.state_encoding
      FROM checkpoint c LEFT JOIN breed_population_summary b ON b.run_id=c.run_id AND b.world_key=c.world_key AND b.year=c.year
      WHERE c.run_id=? AND b.run_id IS NULL ORDER BY c.year, c.world_key`).all(runId) as { run_id: string; world_key: string; year: number; state_json: string; state_gzip: Uint8Array | null; state_encoding: string }[];
    for (const row of rows) {
      const stateJson = row.state_encoding === "GZIP_JSON_V1" && row.state_gzip ? gunzipSync(row.state_gzip).toString("utf8") : row.state_json;
      this.saveBreedPopulationSummary(row.run_id, row.world_key, row.year, JSON.parse(stateJson));
    }
  }

  breedPopulationSummaryCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM breed_population_summary WHERE run_id=?").get(runId) as { count: number }).count);
  }

  getBreedPopulationView(runId: string, breedId: string, requestedYear: number): BreedPopulationView {
    if (!this.getRun(runId)) throw new Error(`Unknown run ${runId}`);
    this.backfillBreedPopulationSummaries(runId);
    const worlds = ["CONCORD", "SCHISM", "RUIN"] as const;
    const series = { CONCORD: [], SCHISM: [], RUIN: [] } as BreedPopulationView["series"];
    const summaryRows = this.database.prepare("SELECT world_key, year, totals_gzip FROM breed_population_summary WHERE run_id=? ORDER BY year, world_key").all(runId) as { world_key: typeof worlds[number]; year: number; totals_gzip: Uint8Array }[];
    for (const row of summaryRows) {
      if (!worlds.includes(row.world_key)) continue;
      const totals = JSON.parse(gunzipSync(row.totals_gzip).toString("utf8")) as Record<string, string>;
      series[row.world_key].push({ year: row.year, population: totals[breedId] ?? "0" });
    }
    const accepted = new Map(this.listAcceptedNamesForRun(runId).filter((row) => row.entityType === "SETTLEMENT").map((row) => [row.entityId, row.name]));
    const cities = { CONCORD: { sampledYear: null, rows: [] }, SCHISM: { sampledYear: null, rows: [] }, RUIN: { sampledYear: null, rows: [] } } as BreedPopulationView["cities"];
    for (const world of worlds) {
      const row = this.database.prepare(`SELECT year, state_json, state_gzip, state_encoding FROM checkpoint
        WHERE run_id=? AND world_key=? AND year<=? ORDER BY year DESC LIMIT 1`).get(runId, world, requestedYear) as { year: number; state_json: string; state_gzip: Uint8Array | null; state_encoding: string } | undefined;
      if (!row) continue;
      const stateJson = row.state_encoding === "GZIP_JSON_V1" && row.state_gzip ? gunzipSync(row.state_gzip).toString("utf8") : row.state_json;
      const state = JSON.parse(stateJson) as { settlements?: { settlementId: string; siteId?: string; name?: string | null }[]; cohorts?: { settlementId: string; breedId: string; population: string }[] };
      const totals = new Map<string, bigint>();
      for (const cohort of state.cohorts ?? []) if (cohort.breedId === breedId) totals.set(cohort.settlementId, (totals.get(cohort.settlementId) ?? 0n) + BigInt(cohort.population));
      const settlements = new Map((state.settlements ?? []).map((settlement) => [settlement.settlementId, settlement]));
      cities[world] = {
        sampledYear: row.year,
        rows: [...totals.entries()].filter(([, population]) => population > 0n).map(([settlementId, population]) => {
          const settlement = settlements.get(settlementId);
          return { settlementId, siteId: settlement?.siteId ?? "—", name: accepted.get(settlementId) ?? settlement?.name ?? settlementId, population: population.toString() };
        }).sort((left, right) => {
          const leftPopulation = BigInt(left.population); const rightPopulation = BigInt(right.population);
          return leftPopulation === rightPopulation ? left.name.localeCompare(right.name) : leftPopulation > rightPopulation ? -1 : 1;
        }),
      };
    }
    return { runId, breedId, requestedYear, series, cities };
  }

  loadCheckpoint(runId: string, worldKey: string, year: number): CheckpointEnvelope | null {
    const row = this.database.prepare(`SELECT checkpoint_id, run_id, world_key, year, state_hash, state_json, state_gzip, state_encoding, engine_version, policy_version
      FROM checkpoint WHERE run_id = ? AND world_key = ? AND year = ?`).get(runId, worldKey, year) as {
      checkpoint_id: string; run_id: string; world_key: CheckpointEnvelope["worldKey"]; year: number; state_hash: string; state_json: string; state_gzip: Uint8Array | null; state_encoding: string; engine_version: string; policy_version: string;
    } | undefined;
    if (!row) return null;
    const stateJson = row.state_encoding === "GZIP_JSON_V1" && row.state_gzip ? gunzipSync(row.state_gzip).toString("utf8") : row.state_json;
    return { schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: row.checkpoint_id, runId: row.run_id, worldKey: row.world_key, year: row.year, stateHash: row.state_hash, state: JSON.parse(stateJson), engineVersion: row.engine_version, policyVersion: row.policy_version };
  }

  persistNamingBarrier(job: NamingJob, checkpoint: CheckpointEnvelope): void {
    this.persistNamingBarriers([job], [checkpoint]);
  }

  persistNamingBarriers(jobs: readonly NamingJob[], checkpoints: readonly CheckpointEnvelope[]): void {
    if (jobs.length === 0) throw new Error("Naming barrier requires at least one job");
    const runId = jobs[0]!.context.runId;
    const year = jobs[0]!.context.year;
    if (jobs.some((job) => job.context.runId !== runId || job.context.year !== year)) throw new Error("Naming jobs do not share a run/year barrier");
    const checkpointByWorld = new Map(checkpoints.map((checkpoint) => [checkpoint.worldKey, checkpoint]));
    for (const job of jobs) {
      const checkpoint = checkpointByWorld.get(job.context.world);
      if (!checkpoint || checkpoint.runId !== runId || checkpoint.year !== year) throw new Error("Naming job and checkpoint identity mismatch");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.getRun(runId);
      if (!run || run.status !== "RUNNING") throw new Error(`Run ${runId} is not RUNNING`);
      for (const checkpoint of checkpoints) this.saveCheckpoint(checkpoint);
      const insert = this.database.prepare(`INSERT INTO naming_job(naming_job_id, run_id, year, status, prompt_sha256, prompt_text, context_json)
        VALUES (?, ?, ?, 'PENDING', ?, ?, ?)`);
      for (const job of [...jobs].sort((left, right) => left.namingJobId.localeCompare(right.namingJobId))) insert.run(job.namingJobId, runId, year, job.promptSha256, job.promptText, canonicalJson(job));
      this.database.prepare("UPDATE simulation_run SET status='WAITING_FOR_NAMING', current_year=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=?")
        .run(year, runId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getPendingNamingJob(runId: string): NamingJob | null {
    const row = this.database.prepare("SELECT context_json FROM naming_job WHERE run_id = ? AND status = 'PENDING' ORDER BY year, naming_job_id LIMIT 1").get(runId) as { context_json: string } | undefined;
    return row ? JSON.parse(row.context_json) as NamingJob : null;
  }

  getAnyPendingNamingJob(): NamingJob | null {
    const row = this.database.prepare("SELECT context_json FROM naming_job WHERE status = 'PENDING' ORDER BY year, naming_job_id LIMIT 1").get() as { context_json: string } | undefined;
    return row ? JSON.parse(row.context_json) as NamingJob : null;
  }

  listPendingNamingJobs(runId: string): NamingJob[] {
    const rows = this.database.prepare("SELECT context_json FROM naming_job WHERE run_id = ? AND status = 'PENDING' ORDER BY year, naming_job_id").all(runId) as { context_json: string }[];
    return rows.map((row) => JSON.parse(row.context_json) as NamingJob);
  }

  pendingNamingJobCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM naming_job WHERE run_id=? AND status='PENDING'").get(runId) as { count: number }).count);
  }

  listNamingJobs(runId: string): { job: NamingJob; status: string }[] {
    const rows = this.database.prepare("SELECT context_json, status FROM naming_job WHERE run_id=? ORDER BY year, naming_job_id").all(runId) as { context_json: string; status: string }[];
    return rows.map((row) => ({ job: JSON.parse(row.context_json) as NamingJob, status: row.status }));
  }

  supersedePendingNamingJobs(replacements: readonly { priorNamingJobId: string; job: NamingJob }[]): number {
    if (replacements.length === 0) return 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const lookup = this.database.prepare("SELECT run_id, year, status FROM naming_job WHERE naming_job_id=?");
      const insert = this.database.prepare(`INSERT INTO naming_job(naming_job_id, run_id, year, status, prompt_sha256, prompt_text, context_json)
        VALUES (?, ?, ?, 'PENDING', ?, ?, ?)`);
      const supersede = this.database.prepare("UPDATE naming_job SET status='SUPERSEDED' WHERE naming_job_id=? AND status='PENDING'");
      for (const replacement of replacements) {
        const prior = lookup.get(replacement.priorNamingJobId) as { run_id: string; year: number; status: string } | undefined;
        if (!prior || prior.status !== "PENDING") throw new Error(`Naming job ${replacement.priorNamingJobId} is not pending`);
        if (replacement.job.namingJobId === replacement.priorNamingJobId) throw new Error(`Replacement naming job identity did not change for ${replacement.priorNamingJobId}`);
        if (replacement.job.context.runId !== prior.run_id || replacement.job.context.year !== prior.year) throw new Error(`Replacement naming job barrier mismatch for ${replacement.priorNamingJobId}`);
        insert.run(replacement.job.namingJobId, prior.run_id, prior.year, replacement.job.promptSha256, replacement.job.promptText, canonicalJson(replacement.job));
        if (Number(supersede.run(replacement.priorNamingJobId).changes) !== 1) throw new Error(`Failed to supersede naming job ${replacement.priorNamingJobId}`);
      }
      this.database.exec("COMMIT");
      return replacements.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordRejectedNamingAttempt(namingJobId: string, attemptId: string, responseText: string, errors: readonly string[]): void {
    const job = this.database.prepare("SELECT status FROM naming_job WHERE naming_job_id = ?").get(namingJobId) as { status: string } | undefined;
    if (!job) throw new Error(`Unknown naming job ${namingJobId}`);
    if (job.status !== "PENDING") throw new Error(`Naming job ${namingJobId} is already accepted`);
    this.database.prepare("INSERT INTO naming_attempt(attempt_id, naming_job_id, accepted, response_text, errors_json) VALUES (?, ?, 0, ?, ?)")
      .run(attemptId, namingJobId, responseText, canonicalJson(errors));
  }

  acceptNamingResponse(namingJobId: string, attemptId: string, responseText: string, decisions: readonly { requestId: string; entityType: string; entityId: string; name: string }[]): void {
    this.acceptNamingResponses([{ namingJobId, attemptId, responseText, decisions }]);
  }

  acceptNamingResponses(responses: readonly { namingJobId: string; attemptId: string; responseText: string; decisions: readonly { requestId: string; entityType: string; entityId: string; name: string }[] }[]): void {
    if (responses.length === 0) throw new Error("Naming response batch is empty");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (new Set(responses.map((response) => response.namingJobId)).size !== responses.length) throw new Error("Naming response batch contains duplicate jobs");
      if (new Set(responses.map((response) => response.attemptId)).size !== responses.length) throw new Error("Naming response batch contains duplicate attempts");
      const verified: { runId: string; response: typeof responses[number] }[] = [];
      for (const response of responses) {
        const row = this.database.prepare("SELECT run_id, status, context_json FROM naming_job WHERE naming_job_id = ?").get(response.namingJobId) as { run_id: string; status: string; context_json: string } | undefined;
        if (!row) throw new Error(`Unknown naming job ${response.namingJobId}`);
        if (row.status !== "PENDING") throw new Error(`Naming job ${response.namingJobId} is already accepted`);
        const job = JSON.parse(row.context_json) as NamingJob;
        const expected = new Map(job.items.map((item) => [item.requestId, item]));
        if (response.decisions.length !== expected.size || new Set(response.decisions.map((decision) => decision.requestId)).size !== expected.size) throw new Error(`Naming decisions do not exactly cover pending requests for ${response.namingJobId}`);
        for (const decision of response.decisions) {
          const item = expected.get(decision.requestId);
          if (!item || item.entityType !== decision.entityType || item.entityId !== decision.entityId || !decision.name.trim()) throw new Error(`Invalid naming decision ${decision.requestId}`);
        }
        verified.push({ runId: row.run_id, response });
      }
      const runIds = new Set(verified.map((item) => item.runId));
      if (runIds.size !== 1) throw new Error("Naming response batch spans multiple runs");
      const insertAttempt = this.database.prepare("INSERT INTO naming_attempt(attempt_id, naming_job_id, accepted, response_text, errors_json) VALUES (?, ?, 1, ?, '[]')");
      const insertName = this.database.prepare("INSERT INTO accepted_name(naming_job_id, request_id, entity_type, entity_id, name) VALUES (?, ?, ?, ?, ?)");
      const acceptJob = this.database.prepare("UPDATE naming_job SET status='ACCEPTED' WHERE naming_job_id=?");
      for (const { response } of verified.sort((left, right) => left.response.namingJobId.localeCompare(right.response.namingJobId))) {
        insertAttempt.run(response.attemptId, response.namingJobId, response.responseText);
        for (const decision of [...response.decisions].sort((a, b) => a.requestId.localeCompare(b.requestId))) insertName.run(response.namingJobId, decision.requestId, decision.entityType, decision.entityId, decision.name.trim());
        acceptJob.run(response.namingJobId);
      }
      const runId = verified[0]!.runId;
      const pending = Number((this.database.prepare("SELECT COUNT(*) AS count FROM naming_job WHERE run_id=? AND status='PENDING'").get(runId) as { count: number }).count);
      this.database.prepare("UPDATE simulation_run SET status=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='WAITING_FOR_NAMING'").run(pending === 0 ? "RUNNING" : "WAITING_FOR_NAMING", runId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getAcceptedNames(namingJobId: string): { requestId: string; entityType: string; entityId: string; name: string }[] {
    const rows = this.database.prepare("SELECT request_id, entity_type, entity_id, name FROM accepted_name WHERE naming_job_id=? ORDER BY request_id").all(namingJobId) as { request_id: string; entity_type: string; entity_id: string; name: string }[];
    return rows.map((row) => ({ requestId: row.request_id, entityType: row.entity_type, entityId: row.entity_id, name: row.name }));
  }

  listAcceptedNamesForRun(runId: string): { requestId: string; entityType: string; entityId: string; name: string }[] {
    const rows = this.database.prepare(`SELECT n.request_id, n.entity_type, n.entity_id, n.name
      FROM accepted_name n JOIN naming_job j ON j.naming_job_id=n.naming_job_id
      WHERE j.run_id=? ORDER BY j.year, n.request_id`).all(runId) as { request_id: string; entity_type: string; entity_id: string; name: string }[];
    return rows.map((row) => ({ requestId: row.request_id, entityType: row.entity_type, entityId: row.entity_id, name: row.name }));
  }

  saveExportMetadata(metadata: { exportId: string; runId: string; createdAt: string; filename: string; sha256: string; manifest: unknown }): void {
    this.database.prepare("INSERT INTO export_metadata(export_id, run_id, created_at, filename, sha256, manifest_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(metadata.exportId, metadata.runId, metadata.createdAt, metadata.filename, metadata.sha256, canonicalJson(metadata.manifest));
  }

  close(): void { this.database.close(); }
}
