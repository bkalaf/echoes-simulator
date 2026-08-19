import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import type { NamingJob } from "../core/naming/naming.js";
import type { CheckpointEnvelope } from "../core/contracts/domain.js";

export interface StoredRun {
  runId: string;
  mode: "CANONICAL" | "DIAGNOSTIC";
  status: string;
  seed: string;
  seedHash: string;
  policyVersion: string;
  currentYear?: number;
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
  runId?: string | null;
  report: unknown;
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
    `);
  }

  createRun(run: StoredRun): void {
    this.database.prepare("INSERT INTO simulation_run(run_id, mode, status, seed, seed_hash, policy_version) VALUES (?, ?, ?, ?, ?, ?)")
      .run(run.runId, run.mode, run.status, run.seed, run.seedHash, run.policyVersion);
  }

  getRun(runId: string): StoredRun | null {
    const row = this.database.prepare("SELECT run_id, mode, status, seed, seed_hash, policy_version, current_year FROM simulation_run WHERE run_id = ?").get(runId) as {
      run_id: string; mode: StoredRun["mode"]; status: string; seed: string; seed_hash: string; policy_version: string; current_year: number;
    } | undefined;
    return row ? { runId: row.run_id, mode: row.mode, status: row.status, seed: row.seed, seedHash: row.seed_hash, policyVersion: row.policy_version, currentYear: row.current_year } : null;
  }

  listRuns(): StoredRun[] {
    const rows = this.database.prepare("SELECT run_id FROM simulation_run ORDER BY created_at, run_id").all() as { run_id: string }[];
    return rows.map((row) => this.getRun(row.run_id)!);
  }

  savePreflight(preflight: StoredPreflight): void {
    this.database.prepare(`INSERT INTO preflight(
      preflight_id, created_at, input_directory, input_manifest_identity,
      starting_research_hash, v3_research_hash, run_id, report_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        preflight.preflightId,
        preflight.createdAt,
        preflight.inputDirectory,
        preflight.inputManifestIdentity,
        preflight.startingResearchHash,
        preflight.v3ResearchHash,
        preflight.runId ?? null,
        canonicalJson(preflight.report),
      );
  }

  getLatestPreflight(): StoredPreflight | null {
    const row = this.database.prepare(`SELECT preflight_id, created_at, input_directory,
      input_manifest_identity, starting_research_hash, v3_research_hash, run_id, report_json
      FROM preflight ORDER BY created_at DESC, preflight_id DESC LIMIT 1`).get() as {
        preflight_id: string;
        created_at: string;
        input_directory: string;
        input_manifest_identity: string;
        starting_research_hash: string;
        v3_research_hash: string | null;
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
      runId: row.run_id,
      report: JSON.parse(row.report_json),
    } : null;
  }

  appendEvent(event: StoredEvent): void {
    this.database.prepare(`INSERT INTO simulation_event(event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.eventId, event.runId, event.worldKey ?? "SHARED", event.year, event.phaseOrder, event.sequence, event.eventType, event.entityType, event.entityId, canonicalJson(event.payload));
  }

  eventCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM simulation_event WHERE run_id = ?").get(runId) as { count: number }).count);
  }

  saveCheckpoint(checkpoint: CheckpointEnvelope): void {
    this.database.prepare(`INSERT INTO checkpoint(checkpoint_id, run_id, world_key, year, state_hash, state_json, engine_version, policy_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, world_key, year) DO UPDATE SET checkpoint_id=excluded.checkpoint_id, state_hash=excluded.state_hash, state_json=excluded.state_json, engine_version=excluded.engine_version, policy_version=excluded.policy_version`)
      .run(checkpoint.checkpointId, checkpoint.runId, checkpoint.worldKey, checkpoint.year, checkpoint.stateHash, canonicalJson(checkpoint.state), checkpoint.engineVersion, checkpoint.policyVersion);
  }

  loadCheckpoint(runId: string, worldKey: string, year: number): CheckpointEnvelope | null {
    const row = this.database.prepare(`SELECT checkpoint_id, run_id, world_key, year, state_hash, state_json, engine_version, policy_version
      FROM checkpoint WHERE run_id = ? AND world_key = ? AND year = ?`).get(runId, worldKey, year) as {
      checkpoint_id: string; run_id: string; world_key: CheckpointEnvelope["worldKey"]; year: number; state_hash: string; state_json: string; engine_version: string; policy_version: string;
    } | undefined;
    return row ? { schemaVersion: "eidolon-simulator-checkpoint-v1", checkpointId: row.checkpoint_id, runId: row.run_id, worldKey: row.world_key, year: row.year, stateHash: row.state_hash, state: JSON.parse(row.state_json), engineVersion: row.engine_version, policyVersion: row.policy_version } : null;
  }

  persistNamingBarrier(job: NamingJob, checkpoint: CheckpointEnvelope): void {
    if (job.context.runId !== checkpoint.runId || job.context.world !== checkpoint.worldKey || job.context.year !== checkpoint.year) throw new Error("Naming job and checkpoint identity mismatch");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.getRun(job.context.runId);
      if (!run || run.status !== "RUNNING") throw new Error(`Run ${job.context.runId} is not RUNNING`);
      this.saveCheckpoint(checkpoint);
      this.database.prepare(`INSERT INTO naming_job(naming_job_id, run_id, year, status, prompt_sha256, prompt_text, context_json)
        VALUES (?, ?, ?, 'PENDING', ?, ?, ?)`)
        .run(job.namingJobId, job.context.runId, job.context.year, job.promptSha256, job.promptText, canonicalJson(job));
      this.database.prepare("UPDATE simulation_run SET status='WAITING_FOR_NAMING', current_year=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=?")
        .run(job.context.year, job.context.runId);
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

  recordRejectedNamingAttempt(namingJobId: string, attemptId: string, responseText: string, errors: readonly string[]): void {
    const job = this.database.prepare("SELECT status FROM naming_job WHERE naming_job_id = ?").get(namingJobId) as { status: string } | undefined;
    if (!job) throw new Error(`Unknown naming job ${namingJobId}`);
    if (job.status !== "PENDING") throw new Error(`Naming job ${namingJobId} is already accepted`);
    this.database.prepare("INSERT INTO naming_attempt(attempt_id, naming_job_id, accepted, response_text, errors_json) VALUES (?, ?, 0, ?, ?)")
      .run(attemptId, namingJobId, responseText, canonicalJson(errors));
  }

  acceptNamingResponse(namingJobId: string, attemptId: string, responseText: string, decisions: readonly { requestId: string; entityType: string; entityId: string; name: string }[]): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT run_id, status, context_json FROM naming_job WHERE naming_job_id = ?").get(namingJobId) as { run_id: string; status: string; context_json: string } | undefined;
      if (!row) throw new Error(`Unknown naming job ${namingJobId}`);
      if (row.status !== "PENDING") throw new Error(`Naming job ${namingJobId} is already accepted`);
      const job = JSON.parse(row.context_json) as NamingJob;
      const expected = new Map(job.items.map((item) => [item.requestId, item]));
      if (decisions.length !== expected.size || new Set(decisions.map((decision) => decision.requestId)).size !== expected.size) throw new Error("Naming decisions do not exactly cover pending requests");
      for (const decision of decisions) {
        const item = expected.get(decision.requestId);
        if (!item || item.entityType !== decision.entityType || item.entityId !== decision.entityId || !decision.name.trim()) throw new Error(`Invalid naming decision ${decision.requestId}`);
      }
      this.database.prepare("INSERT INTO naming_attempt(attempt_id, naming_job_id, accepted, response_text, errors_json) VALUES (?, ?, 1, ?, '[]')")
        .run(attemptId, namingJobId, responseText);
      const insertName = this.database.prepare("INSERT INTO accepted_name(naming_job_id, request_id, entity_type, entity_id, name) VALUES (?, ?, ?, ?, ?)");
      for (const decision of [...decisions].sort((a, b) => a.requestId.localeCompare(b.requestId))) insertName.run(namingJobId, decision.requestId, decision.entityType, decision.entityId, decision.name.trim());
      this.database.prepare("UPDATE naming_job SET status='ACCEPTED' WHERE naming_job_id=?").run(namingJobId);
      this.database.prepare("UPDATE simulation_run SET status='READY', updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='WAITING_FOR_NAMING'").run(row.run_id);
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

  close(): void { this.database.close(); }
}
