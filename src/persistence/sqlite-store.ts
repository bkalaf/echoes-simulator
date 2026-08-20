import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import type { NamingJob } from "../core/naming/naming.js";
import type { CheckpointEnvelope } from "../core/contracts/domain.js";
import type { Cohort } from "../core/engine/cohort-engine.js";

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
    `);
    const preflightColumns = new Set((this.database.prepare("PRAGMA table_info(preflight)").all() as { name: string }[]).map((column) => column.name));
    for (const column of ["semantic_authority_version", "semantic_authority_filename", "semantic_authority_sha256", "semantic_authority_verdict"]) {
      if (!preflightColumns.has(column)) this.database.exec(`ALTER TABLE preflight ADD COLUMN ${column} TEXT`);
    }
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
      for (const worldKey of new Set(cohorts.map((cohort) => cohort.worldKey))) this.database.prepare("DELETE FROM cohort_state WHERE run_id=? AND world_key=? AND year=?").run(runId, worldKey, year);
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
    const insert = this.database.prepare(`INSERT INTO history_ledger(run_id, world_key, year, history_type, entry_id, data_json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, world_key, year, history_type, entry_id) DO UPDATE SET data_json=excluded.data_json`);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) insert.run(runId, row.worldKey, row.year, row.historyType, row.entryId, canonicalJson(row.data));
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
    return rows.map((row) => ({ worldKey: row.world_key, year: row.year, historyType: row.history_type, entryId: row.entry_id, data: JSON.parse(row.data_json) }));
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

  eventCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM simulation_event WHERE run_id = ?").get(runId) as { count: number }).count);
  }

  listEvents(runId: string, worldKey?: string): StoredEvent[] {
    const rows = (worldKey
      ? this.database.prepare("SELECT event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json FROM simulation_event WHERE run_id=? AND world_key=? ORDER BY year, phase_order, sequence").all(runId, worldKey)
      : this.database.prepare("SELECT event_id, run_id, world_key, year, phase_order, sequence, event_type, entity_type, entity_id, payload_json FROM simulation_event WHERE run_id=? ORDER BY world_key, year, phase_order, sequence").all(runId)) as { event_id: string; run_id: string; world_key: string; year: number; phase_order: number; sequence: number; event_type: string; entity_type: string; entity_id: string; payload_json: string }[];
    return rows.map((row) => ({ eventId: row.event_id, runId: row.run_id, worldKey: row.world_key, year: row.year, phaseOrder: row.phase_order, sequence: row.sequence, eventType: row.event_type, entityType: row.entity_type, entityId: row.entity_id, payload: JSON.parse(row.payload_json) }));
  }

  checkpointCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?").get(runId) as { count: number }).count);
  }

  listCheckpoints(runId: string, worldKey?: string): CheckpointEnvelope[] {
    const rows = (worldKey
      ? this.database.prepare("SELECT year FROM checkpoint WHERE run_id=? AND world_key=? ORDER BY year").all(runId, worldKey)
      : this.database.prepare("SELECT world_key, year FROM checkpoint WHERE run_id=? ORDER BY world_key, year").all(runId)) as { world_key?: string; year: number }[];
    return rows.map((row) => this.loadCheckpoint(runId, (worldKey ?? row.world_key) as CheckpointEnvelope["worldKey"], row.year)!).filter(Boolean);
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

  pendingNamingJobCount(runId: string): number {
    return Number((this.database.prepare("SELECT COUNT(*) AS count FROM naming_job WHERE run_id=? AND status='PENDING'").get(runId) as { count: number }).count);
  }

  listNamingJobs(runId: string): { job: NamingJob; status: string }[] {
    const rows = this.database.prepare("SELECT context_json, status FROM naming_job WHERE run_id=? ORDER BY year, naming_job_id").all(runId) as { context_json: string; status: string }[];
    return rows.map((row) => ({ job: JSON.parse(row.context_json) as NamingJob, status: row.status }));
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
      const pending = Number((this.database.prepare("SELECT COUNT(*) AS count FROM naming_job WHERE run_id=? AND status='PENDING'").get(row.run_id) as { count: number }).count);
      this.database.prepare("UPDATE simulation_run SET status=?, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='WAITING_FOR_NAMING'").run(pending === 0 ? "RUNNING" : "WAITING_FOR_NAMING", row.run_id);
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
