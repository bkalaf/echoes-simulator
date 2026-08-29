import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { deflateRawSync, gzipSync, gunzipSync, inflateRawSync } from "node:zlib";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import type { NamingJob } from "../core/naming/naming.js";
import type { CheckpointEnvelope } from "../core/contracts/domain.js";
import type { Cohort } from "../core/engine/cohort-engine.js";
import type { AcceptedLabelLedgerEntryV5, CausalEventV5, NamingRequestV5, WorldStateV5 } from "../core/v5/types.js";
import type { NamingBatchAuthorityStatusV5, PersistedNamingBatchV5 } from "../core/v5/naming.js";
import { buildPersistedNamingBatchesV5, namingRequestSetDigestV5, parseExportedV2BatchIdV5, validateAcceptedLabelProvenanceV5 } from "../core/v5/naming.js";
import type { V5RunManifest } from "../core/v5/persistence.js";
import { V5_EMPTY_EVENT_HISTORY_HASH, extendV5EventHistoryHashFromCanonicalJson, projectWorldStateV54ReadOnly, restoreWorldStateV5, v5CheckpointHash } from "../core/v5/persistence.js";
import type { EditableV5Configuration } from "../core/v5/configuration.js";
import { defaultEditableV5Configuration, restoreDiagnosticConfigV1, restoreMechanicsVariablesV1, restoreOperationalConfigV1 } from "../core/v5/configuration.js";
import { inspectLegacyV5NamingTrust } from "./v5-legacy-trust.js";
import { mergeBoundedDiagnosticObservations, type BoundedDiagnosticObservationV5 } from "../core/v5/diagnostics.js";
import type { DivergenceTraceV5 } from "../core/v5/divergence-diagnostics.js";
import type { CausalPolicyBlockerV5 } from "../core/v5/historical-policies.js";
import type { AcceptedDerogatoryDecisionBatchV5, DerogatoryDecisionBatchV5, DerogatoryDecisionResponseV5 } from "../core/v5/derogatory-decisions.js";
import type { V5PerformanceTimingObserver } from "../core/v5/performance.js";

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

function encodeV5CausalEventJson(eventJson: string): Uint8Array {
  return deflateRawSync(Buffer.from(eventJson, "utf8"), { level: 1 });
}

function canonicalV5CausalEventJson(encoded: string | Uint8Array): string {
  return typeof encoded === "string" ? encoded : inflateRawSync(encoded).toString("utf8");
}

function decodeV5CausalEvent(encoded: string | Uint8Array): CausalEventV5 {
  return JSON.parse(canonicalV5CausalEventJson(encoded)) as CausalEventV5;
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
  private v5AtomicWriteActive = false;

  constructor(readonly filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    if (existsSync(filename)) {
      const trust = inspectLegacyV5NamingTrust(filename);
      if (trust.requiresFreshTrustedDatabase) throw new Error(`LEGACY_UNTRUSTED_NAMING: open ${filename} read-only for diagnostics and create a fresh V5 database for trusted naming`);
    }
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  withV5AtomicYearTransaction<T>(operation: () => T): T {
    if (this.v5AtomicWriteActive) throw new Error("Nested V5 atomic-year transaction");
    this.database.exec("BEGIN IMMEDIATE");
    this.v5AtomicWriteActive = true;
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* preserve the original persistence failure */ }
      throw error;
    } finally {
      this.v5AtomicWriteActive = false;
    }
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
      CREATE TABLE IF NOT EXISTS v5_label_ledger (
        ledger_entry_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('CANONICAL_EXISTING','OWNER_INPUT','LLM_NAMING_RESPONSE','AUTOMATIC_REUSE','TEST_FIXTURE')),
        source_request_id TEXT,
        source_authority_ref TEXT,
        source_batch_id TEXT,
        source_response_attempt_id TEXT,
        name_effective_from_year INTEGER NOT NULL,
        acceptance_year INTEGER NOT NULL,
        reused_from_entity_id TEXT,
        reused_from_ledger_entry_id TEXT,
        naming_comparison_group_id TEXT,
        comparison_authority_ref TEXT,
        entry_json TEXT NOT NULL,
        UNIQUE(run_id, entity_id, name_effective_from_year)
      );
      CREATE INDEX IF NOT EXISTS v5_label_ledger_effective ON v5_label_ledger(run_id, entity_id, name_effective_from_year, acceptance_year);
      CREATE TABLE IF NOT EXISTS v5_naming_batch_audit (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        behavior TEXT NOT NULL CHECK(behavior IN ('BLOCKING','BATCHED')),
        year INTEGER NOT NULL,
        barrier_year INTEGER NOT NULL,
        ordered_request_ids_json TEXT NOT NULL,
        comparison_groups_json TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        prompt_sha256 TEXT NOT NULL,
        grouping_version TEXT NOT NULL,
        stable_request_set_digest TEXT NOT NULL,
        identity_version TEXT NOT NULL,
        display_ordinal INTEGER,
        authority_status TEXT NOT NULL,
        batch_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(run_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS v5_naming_response_attempt (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),
        response_text TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(run_id, attempt_id),
        FOREIGN KEY(run_id, batch_id) REFERENCES v5_naming_batch_audit(run_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS v5_diagnostic_summary (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        world_key TEXT NOT NULL,
        domain TEXT NOT NULL,
        through_year INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        PRIMARY KEY(run_id, world_key, domain)
      );
      CREATE TABLE IF NOT EXISTS v5_divergence_trace (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        comparison_id TEXT NOT NULL,
        category TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        PRIMARY KEY(run_id, comparison_id)
      );
      CREATE TABLE IF NOT EXISTS v5_policy_blocker (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        blocker_id TEXT NOT NULL,
        policy_key TEXT NOT NULL,
        year INTEGER NOT NULL,
        blocker_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(run_id, blocker_id)
      );
      CREATE TABLE IF NOT EXISTS v5_derogatory_decision_batch (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        review_year INTEGER NOT NULL,
        barrier_year INTEGER NOT NULL,
        context_sha256 TEXT NOT NULL,
        prompt_sha256 TEXT NOT NULL,
        batch_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(run_id, batch_id),
        UNIQUE(run_id, review_year)
      );
      CREATE TABLE IF NOT EXISTS v5_derogatory_decision_attempt (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),
        response_json TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(run_id, attempt_id),
        FOREIGN KEY(run_id, batch_id) REFERENCES v5_derogatory_decision_batch(run_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS v5_derogatory_accepted_decision (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        world_key TEXT NOT NULL,
        scope TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('SELECT','KEEP','REPLACE')),
        prior_group_id TEXT,
        selected_group_id TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        PRIMARY KEY(run_id, decision_id),
        FOREIGN KEY(run_id, batch_id) REFERENCES v5_derogatory_decision_batch(run_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS v5_derogatory_decision_stream (
        run_id TEXT NOT NULL REFERENCES simulation_run(run_id),
        batch_id TEXT NOT NULL,
        review_year INTEGER NOT NULL,
        prior_stream_hash TEXT NOT NULL,
        stream_hash TEXT NOT NULL,
        accepted_batch_json TEXT NOT NULL,
        PRIMARY KEY(run_id, batch_id),
        UNIQUE(run_id, review_year),
        FOREIGN KEY(run_id, batch_id) REFERENCES v5_derogatory_decision_batch(run_id, batch_id)
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
      `);
    }
    const currentV5EventColumns = new Set((this.database.prepare("PRAGMA table_info(v5_causal_event)").all() as { name: string }[]).map((column) => column.name));
    if (!currentV5EventColumns.has("event_type")) {
      this.database.exec("ALTER TABLE v5_causal_event ADD COLUMN event_type TEXT");
      this.database.exec("UPDATE v5_causal_event SET event_type=json_extract(event_json, '$.eventType') WHERE event_type IS NULL");
    }
    // The UNIQUE(run_id, world_key, year, sequence) auto-index already serves
    // replay order; retaining an identical explicit index doubles hot-ledger
    // index storage without changing query semantics.
    this.database.exec("DROP INDEX IF EXISTS v5_causal_event_replay");
    this.database.exec("CREATE INDEX IF NOT EXISTS v5_causal_event_type ON v5_causal_event(run_id, world_key, event_type, year, sequence)");
    const namingBatchColumns = new Set((this.database.prepare("PRAGMA table_info(v5_naming_batch_audit)").all() as { name: string }[]).map((column) => column.name));
    const namingBatchColumnDefinitions: Readonly<Record<string, string>> = {
      barrier_year: "INTEGER", ordered_request_ids_json: "TEXT", comparison_groups_json: "TEXT", prompt_text: "TEXT",
      grouping_version: "TEXT", stable_request_set_digest: "TEXT", identity_version: "TEXT", display_ordinal: "INTEGER", authority_status: "TEXT",
    };
    for (const [column, definition] of Object.entries(namingBatchColumnDefinitions)) {
      if (!namingBatchColumns.has(column)) this.database.exec(`ALTER TABLE v5_naming_batch_audit ADD COLUMN ${column} ${definition}`);
    }
    const incompleteNamingAudits = this.database.prepare(`SELECT run_id,batch_id,year,batch_json,created_at FROM v5_naming_batch_audit
      WHERE barrier_year IS NULL OR ordered_request_ids_json IS NULL OR comparison_groups_json IS NULL OR prompt_text IS NULL OR grouping_version IS NULL
        OR stable_request_set_digest IS NULL OR identity_version IS NULL OR authority_status IS NULL`).all() as { run_id: string; batch_id: string; year: number; batch_json: string; created_at: string }[];
    const backfillNamingAudit = this.database.prepare(`UPDATE v5_naming_batch_audit SET barrier_year=?,ordered_request_ids_json=?,comparison_groups_json=?,prompt_text=?,grouping_version=?,
      stable_request_set_digest=?,identity_version=?,display_ordinal=?,authority_status=? WHERE run_id=? AND batch_id=?`);
    for (const row of incompleteNamingAudits) {
      const batch = JSON.parse(row.batch_json) as Partial<PersistedNamingBatchV5> & Pick<PersistedNamingBatchV5, "items" | "promptText" | "comparisonGroups" | "comparisonGroupingVersion">;
      const legacy = parseExportedV2BatchIdV5(row.run_id, row.batch_id);
      backfillNamingAudit.run(
        batch.barrierYear ?? batch.year ?? row.year,
        canonicalJson(batch.items.map((item) => item.requestId)),
        canonicalJson(batch.comparisonGroups),
        batch.promptText,
        batch.comparisonGroupingVersion,
        batch.stableRequestSetDigest ?? namingRequestSetDigestV5(batch.items),
        batch.identityVersion ?? (legacy ? "echoes-v5-naming-indexed-v2" : "echoes-v5-naming-content-addressed-v3"),
        batch.displayOrdinal ?? legacy?.ordinal ?? null,
        batch.authorityStatus ?? "MIGRATED_V2_BATCH_AUDIT",
        row.run_id,
        row.batch_id,
      );
    }
    this.database.exec(`
      CREATE TRIGGER IF NOT EXISTS v5_naming_batch_audit_immutable_update BEFORE UPDATE ON v5_naming_batch_audit
      BEGIN SELECT RAISE(ABORT, 'V5 naming batch audit is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_naming_batch_audit_immutable_delete BEFORE DELETE ON v5_naming_batch_audit
      BEGIN SELECT RAISE(ABORT, 'V5 naming batch audit is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_policy_blocker_immutable_update BEFORE UPDATE ON v5_policy_blocker
      BEGIN SELECT RAISE(ABORT, 'V5 policy blocker is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_policy_blocker_immutable_delete BEFORE DELETE ON v5_policy_blocker
      BEGIN SELECT RAISE(ABORT, 'V5 policy blocker is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_batch_immutable_update BEFORE UPDATE ON v5_derogatory_decision_batch
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision batch is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_batch_immutable_delete BEFORE DELETE ON v5_derogatory_decision_batch
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision batch is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_attempt_immutable_update BEFORE UPDATE ON v5_derogatory_decision_attempt
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision attempt is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_attempt_immutable_delete BEFORE DELETE ON v5_derogatory_decision_attempt
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision attempt is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_decision_immutable_update BEFORE UPDATE ON v5_derogatory_accepted_decision
      BEGIN SELECT RAISE(ABORT, 'V5 accepted Derogatory decision is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_decision_immutable_delete BEFORE DELETE ON v5_derogatory_accepted_decision
      BEGIN SELECT RAISE(ABORT, 'V5 accepted Derogatory decision is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_stream_immutable_update BEFORE UPDATE ON v5_derogatory_decision_stream
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision stream is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS v5_derogatory_stream_immutable_delete BEFORE DELETE ON v5_derogatory_decision_stream
      BEGIN SELECT RAISE(ABORT, 'V5 Derogatory decision stream is immutable'); END;
    `);
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
    const historicalPolicies = parsed.causalOwnerInputs.historicalDynamismPolicies;
    const civicPolicy = historicalPolicies?.CIVIC_INSTITUTION_SECURITY;
    const causalOwnerInputs = civicPolicy ? {
      ...parsed.causalOwnerInputs,
      historicalDynamismPolicies: {
        ...historicalPolicies,
        CIVIC_INSTITUTION_SECURITY: {
          ...civicPolicy,
          institutionFormationMinimumPopulation: BigInt(civicPolicy.institutionFormationMinimumPopulation),
        },
      },
    } : parsed.causalOwnerInputs;
    return { ...parsed, causalOwnerInputs, mechanicsVariables: { ...parsed.mechanicsVariables, initialPopulation: BigInt(parsed.mechanicsVariables.initialPopulation), initialTierWeights: parsed.mechanicsVariables.initialTierWeights.map(BigInt) as unknown as readonly [bigint, bigint, bigint], foundingMinimumPopulation: BigInt(parsed.mechanicsVariables.foundingMinimumPopulation), secessionMinimumPopulation: BigInt(parsed.mechanicsVariables.secessionMinimumPopulation), conflictStatePopulationReference: BigInt(parsed.mechanicsVariables.conflictStatePopulationReference) }, operationalConfig: restoreOperationalConfigV1(parsed.operationalConfig), diagnosticConfig: { ...parsed.diagnosticConfig, endingPopulationGoal: BigInt(parsed.diagnosticConfig.endingPopulationGoal), foundingNotabilityThreshold: BigInt(parsed.diagnosticConfig.foundingNotabilityThreshold) } };
  }

  appendV5CausalEvents(runId: string, events: readonly CausalEventV5[], canonicalEventJson?: readonly string[]): void {
    if (events.length === 0) return;
    if (canonicalEventJson && canonicalEventJson.length !== events.length) throw new Error("Canonical V5 event serialization count mismatch");
    const insert = this.database.prepare(`INSERT INTO v5_causal_event(event_id, run_id, world_key, year, sequence, event_type, event_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const ownsTransaction = !this.v5AtomicWriteActive;
    if (ownsTransaction) this.database.exec("BEGIN IMMEDIATE");
    try {
      const ordered = events.map((event, index) => ({ event, eventJson: canonicalEventJson?.[index] ?? canonicalJson(event) })).sort((left, right) => left.event.year - right.event.year || left.event.sequence - right.event.sequence || left.event.eventId.localeCompare(right.event.eventId));
      for (const { event, eventJson } of ordered) insert.run(event.eventId, runId, event.worldKey, event.year, event.sequence, event.eventType, encodeV5CausalEventJson(eventJson));
      if (ownsTransaction) this.database.exec("COMMIT");
    } catch (error) {
      // SQLite can automatically end a transaction after errors such as
      // SQLITE_FULL. Preserve the original failure instead of masking it with
      // a secondary "no transaction is active" rollback error.
      if (ownsTransaction) try { this.database.exec("ROLLBACK"); } catch { /* original error is authoritative */ }
      throw error;
    }
  }

  listV5CausalEvents(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): CausalEventV5[] {
    const rows = this.database.prepare("SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? ORDER BY year, sequence").all(runId, worldKey, throughYear) as { event_json: string | Uint8Array }[];
    return rows.map((row) => decodeV5CausalEvent(row.event_json));
  }

  listV5CausalEventsByTypes(runId: string, worldKey: string, eventTypes: readonly string[], throughYear = Number.MAX_SAFE_INTEGER): CausalEventV5[] {
    if (eventTypes.length === 0) return [];
    const placeholders = eventTypes.map(() => "?").join(",");
    const rows = this.database.prepare(`SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? AND event_type IN (${placeholders}) ORDER BY year, sequence`).all(runId, worldKey, throughYear, ...eventTypes) as { event_json: string | Uint8Array }[];
    return rows.map((row) => decodeV5CausalEvent(row.event_json));
  }

  summarizeV5CausalEventHistory(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): { eventHistoryHash: string; eventCount: number } {
    const rows = this.database.prepare("SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=? ORDER BY year, sequence").iterate(runId, worldKey, throughYear) as Iterable<{ event_json: string | Uint8Array }>;
    let eventHistoryHash = V5_EMPTY_EVENT_HISTORY_HASH;
    let eventCount = 0;
    eventHistoryHash = extendV5EventHistoryHashFromCanonicalJson(eventHistoryHash, (function* (): Iterable<string> {
      for (const row of rows) { eventCount += 1; yield canonicalV5CausalEventJson(row.event_json); }
    })());
    return { eventHistoryHash, eventCount };
  }

  summarizeV5CausalEventHistoryRange(runId: string, worldKey: string, afterYear: number, throughYear = Number.MAX_SAFE_INTEGER): { eventHistoryHash: string; eventCount: number } {
    const rows = this.database.prepare("SELECT event_json FROM v5_causal_event WHERE run_id=? AND world_key=? AND year>? AND year<=? ORDER BY year, sequence")
      .iterate(runId, worldKey, afterYear, throughYear) as Iterable<{ event_json: string | Uint8Array }>;
    let eventHistoryHash = V5_EMPTY_EVENT_HISTORY_HASH;
    let eventCount = 0;
    eventHistoryHash = extendV5EventHistoryHashFromCanonicalJson(eventHistoryHash, (function* (): Iterable<string> {
      for (const row of rows) { eventCount += 1; yield canonicalV5CausalEventJson(row.event_json); }
    })());
    return { eventHistoryHash, eventCount };
  }

  v5EventCount(runId: string): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM v5_causal_event WHERE run_id=?").get(runId) as { count: number }).count;
  }

  v5CausalEventCount(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM v5_causal_event WHERE run_id=? AND world_key=? AND year<=?").get(runId, worldKey, throughYear) as { count: number }).count;
  }

  saveV5Checkpoint(runId: string, state: WorldStateV5, eventHistoryHash: string, onPerformanceTiming?: V5PerformanceTimingObserver, compressionLevel: 1 | 3 | 6 | 9 = 3): { checkpointId: string; stateHash: string; eventHistoryHash: string } {
    if (!/^[0-9a-f]{64}$/.test(eventHistoryHash)) throw new Error(`Invalid V5 event-history hash ${eventHistoryHash}`);
    let startedAt = performance.now();
    const canonicalState = Buffer.from(canonicalJson(state), "utf8");
    onPerformanceTiming?.({ scope: "PERSISTENCE", worldKey: state.worldKey, year: state.year, phase: "CHECKPOINT_CANONICAL_SERIALIZATION", milliseconds: performance.now() - startedAt, bytes: canonicalState.byteLength });
    const stateHash = v5CheckpointHash(state, canonicalState); const checkpointId = `V5_CHECKPOINT_${runId}_${state.worldKey}_${state.year}_${stateHash.slice(0, 16)}`;
    startedAt = performance.now();
    const stateGzip = gzipSync(canonicalState, { level: compressionLevel });
    onPerformanceTiming?.({ scope: "PERSISTENCE", worldKey: state.worldKey, year: state.year, phase: `CHECKPOINT_COMPRESSION_GZIP_${compressionLevel}`, milliseconds: performance.now() - startedAt, bytes: stateGzip.byteLength });
    startedAt = performance.now();
    this.database.prepare(`INSERT INTO v5_checkpoint(checkpoint_id, run_id, world_key, year, state_hash, event_history_hash, state_gzip) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, world_key, year) DO UPDATE SET checkpoint_id=excluded.checkpoint_id, state_hash=excluded.state_hash, event_history_hash=excluded.event_history_hash, state_gzip=excluded.state_gzip`)
      .run(checkpointId, runId, state.worldKey, state.year, stateHash, eventHistoryHash, stateGzip);
    onPerformanceTiming?.({ scope: "PERSISTENCE", worldKey: state.worldKey, year: state.year, phase: "CHECKPOINT_SQLITE_WRITE", milliseconds: performance.now() - startedAt, bytes: stateGzip.byteLength, rows: 1 });
    return { checkpointId, stateHash, eventHistoryHash };
  }

  loadLatestV5Checkpoint(runId: string, worldKey: string, throughYear = Number.MAX_SAFE_INTEGER): { state: WorldStateV5; stateHash: string; eventHistoryHash: string } | null {
    const row = this.database.prepare("SELECT state_hash, event_history_hash, state_gzip FROM v5_checkpoint WHERE run_id=? AND world_key=? AND year<=? ORDER BY year DESC LIMIT 1").get(runId, worldKey, throughYear) as { state_hash: string; event_history_hash: string; state_gzip: Uint8Array } | undefined;
    if (!row) return null;
    const state = restoreWorldStateV5(JSON.parse(gunzipSync(row.state_gzip).toString("utf8")));
    if (v5CheckpointHash(state) !== row.state_hash) throw new Error(`V5 checkpoint state hash mismatch for ${runId}/${worldKey}`);
    return { state: projectWorldStateV54ReadOnly(state), stateHash: row.state_hash, eventHistoryHash: row.event_history_hash };
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

  recordV5AcceptedLabel(entry: AcceptedLabelLedgerEntryV5, runMode: "PRODUCTION" | "REMEDIATION" | "TEST" = "PRODUCTION"): void {
    validateAcceptedLabelProvenanceV5(entry, runMode);
    const request = entry.sourceRequestId ? this.database.prepare("SELECT request_json FROM v5_naming_request WHERE run_id=? AND request_id=?").get(entry.runId, entry.sourceRequestId) as { request_json: string } | undefined : undefined;
    if (entry.source === "LLM_NAMING_RESPONSE" && !request) throw new Error(`LLM naming source request ${entry.sourceRequestId} is not persisted`);
    this.database.prepare(`INSERT INTO v5_label_ledger(ledger_entry_id,run_id,world_key,entity_type,entity_id,label,source,source_request_id,source_authority_ref,source_batch_id,source_response_attempt_id,name_effective_from_year,acceptance_year,reused_from_entity_id,reused_from_ledger_entry_id,naming_comparison_group_id,comparison_authority_ref,entry_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entry.ledgerEntryId, entry.runId, entry.worldKey, entry.entityType, entry.entityId, entry.label, entry.source, entry.sourceRequestId, entry.sourceAuthorityRef, entry.sourceBatchId, entry.sourceResponseAttemptId, entry.nameEffectiveFromYear, entry.acceptanceYear, entry.reusedFromEntityId, entry.reusedFromLedgerEntryId, entry.namingComparisonGroupId, entry.comparisonAuthorityRef, canonicalJson(entry));
  }

  saveV5NamingRequests(runId: string, requests: readonly NamingRequestV5[]): void {
    if (requests.length === 0) return;
    const insert = this.database.prepare(`INSERT INTO v5_naming_request(run_id, request_id, request_json) VALUES (?, ?, ?)
      ON CONFLICT(run_id, request_id) DO UPDATE SET request_json=excluded.request_json`);
    const ownsTransaction = !this.v5AtomicWriteActive;
    if (ownsTransaction) this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const request of [...requests].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
        insert.run(runId, request.requestId, canonicalJson(request));
        if (request.acceptedLabel) {
          const authority = typeof request.context?.canonicalNamingAuthorityRef === "string" ? request.context.canonicalNamingAuthorityRef : null;
          if (!authority) throw new Error(`Accepted request ${request.requestId} lacks explicit canonical naming authority`);
          const entry: AcceptedLabelLedgerEntryV5 = {
            ledgerEntryId: `V5_LABEL_${createHash("sha256").update(`${runId}\0${request.entityId}\0${request.nameEffectiveFromYear ?? request.createdYear}`).digest("hex")}`,
            runId, worldKey: request.worldKey ?? null, entityType: request.entityType, entityId: request.entityId, label: request.acceptedLabel,
            source: "CANONICAL_EXISTING", sourceRequestId: null, sourceAuthorityRef: authority, sourceBatchId: null, sourceResponseAttemptId: null,
            nameEffectiveFromYear: request.nameEffectiveFromYear ?? request.createdYear, acceptanceYear: request.createdYear,
            reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: request.namingComparisonGroupId ?? null, comparisonAuthorityRef: request.comparisonAuthorityRef ?? null,
          };
          validateAcceptedLabelProvenanceV5(entry, "PRODUCTION");
          this.database.prepare(`INSERT OR IGNORE INTO v5_label_ledger(ledger_entry_id,run_id,world_key,entity_type,entity_id,label,source,source_request_id,source_authority_ref,source_batch_id,source_response_attempt_id,name_effective_from_year,acceptance_year,reused_from_entity_id,reused_from_ledger_entry_id,naming_comparison_group_id,comparison_authority_ref,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(entry.ledgerEntryId, entry.runId, entry.worldKey, entry.entityType, entry.entityId, entry.label, entry.source, entry.sourceRequestId, entry.sourceAuthorityRef, entry.sourceBatchId, entry.sourceResponseAttemptId, entry.nameEffectiveFromYear, entry.acceptanceYear, entry.reusedFromEntityId, entry.reusedFromLedgerEntryId, entry.namingComparisonGroupId, entry.comparisonAuthorityRef, canonicalJson(entry));
        }
      }
      if (ownsTransaction) this.database.exec("COMMIT");
    }
    catch (error) { if (ownsTransaction) this.database.exec("ROLLBACK"); throw error; }
  }

  listV5NamingRequests(runId: string): NamingRequestV5[] {
    return (this.database.prepare("SELECT request_json FROM v5_naming_request WHERE run_id=? ORDER BY request_id").all(runId) as { request_json: string }[]).map((row) => JSON.parse(row.request_json) as NamingRequestV5);
  }

  loadV5Labels(runId: string, effectiveYear = Number.MAX_SAFE_INTEGER): Record<string, string> {
    const rows = this.database.prepare(`SELECT entity_id, label FROM v5_label_ledger WHERE run_id=? AND source!='TEST_FIXTURE'
      AND name_effective_from_year<=? AND (entity_id, name_effective_from_year) IN (SELECT entity_id, MAX(name_effective_from_year) FROM v5_label_ledger WHERE run_id=? AND source!='TEST_FIXTURE' AND name_effective_from_year<=? GROUP BY entity_id) ORDER BY entity_id`).all(runId, effectiveYear, runId, effectiveYear) as { entity_id: string; label: string }[];
    return Object.fromEntries(rows.map((row) => [row.entity_id, row.label]));
  }

  loadV5TrustedLabelLedger(runId: string, effectiveYear = Number.MAX_SAFE_INTEGER): AcceptedLabelLedgerEntryV5[] {
    return (this.database.prepare("SELECT entry_json FROM v5_label_ledger WHERE run_id=? AND source!='TEST_FIXTURE' AND name_effective_from_year<=? ORDER BY entity_type,entity_id,name_effective_from_year").all(runId, effectiveYear) as { entry_json: string }[]).map((row) => JSON.parse(row.entry_json) as AcceptedLabelLedgerEntryV5);
  }

  private insertV5NamingBatchAudit(batch: PersistedNamingBatchV5): void {
    if (batch.promptSha256 !== createHash("sha256").update(batch.promptText).digest("hex")) throw new Error(`Naming batch ${batch.batchId} prompt hash is invalid`);
    if (batch.stableRequestSetDigest !== namingRequestSetDigestV5(batch.items)) throw new Error(`Naming batch ${batch.batchId} request-set digest is invalid`);
    if (batch.year !== batch.barrierYear) throw new Error(`Naming batch ${batch.batchId} barrier year is inconsistent`);
    const existing = this.loadV5NamingBatchAudit(batch.runId, batch.batchId);
    if (existing) {
      const immutableExisting = { ...existing, createdAt: batch.createdAt };
      if (canonicalJson(immutableExisting) !== canonicalJson(batch)) throw new Error(`Naming batch ${batch.batchId} conflicts with immutable persisted authority`);
      return;
    }
    this.database.prepare(`INSERT INTO v5_naming_batch_audit(run_id,batch_id,behavior,year,barrier_year,ordered_request_ids_json,comparison_groups_json,prompt_text,prompt_sha256,
      grouping_version,stable_request_set_digest,identity_version,display_ordinal,authority_status,batch_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        batch.runId, batch.batchId, batch.behavior, batch.year, batch.barrierYear, canonicalJson(batch.items.map((item) => item.requestId)), canonicalJson(batch.comparisonGroups),
        batch.promptText, batch.promptSha256, batch.comparisonGroupingVersion, batch.stableRequestSetDigest, batch.identityVersion, batch.displayOrdinal, batch.authorityStatus,
        canonicalJson(batch), batch.createdAt,
      );
  }

  saveV5NamingBatchAudit(batch: PersistedNamingBatchV5): void {
    this.insertV5NamingBatchAudit(batch);
  }

  loadV5NamingBatchAudit(runId: string, batchId: string): PersistedNamingBatchV5 | null {
    const row = this.database.prepare(`SELECT batch_id,behavior,year,barrier_year,ordered_request_ids_json,comparison_groups_json,prompt_text,prompt_sha256,grouping_version,
      stable_request_set_digest,identity_version,display_ordinal,authority_status,batch_json,created_at FROM v5_naming_batch_audit WHERE run_id=? AND batch_id=?`).get(runId, batchId) as {
        batch_id: string; behavior: "BLOCKING" | "BATCHED"; year: number; barrier_year: number; ordered_request_ids_json: string; comparison_groups_json: string;
        prompt_text: string; prompt_sha256: string; grouping_version: PersistedNamingBatchV5["comparisonGroupingVersion"]; stable_request_set_digest: string;
        identity_version: PersistedNamingBatchV5["identityVersion"]; display_ordinal: number | null; authority_status: NamingBatchAuthorityStatusV5; batch_json: string; created_at: string;
      } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.batch_json) as PersistedNamingBatchV5;
    const orderedRequestIds = JSON.parse(row.ordered_request_ids_json) as string[];
    if (canonicalJson(parsed.items.map((item) => item.requestId)) !== canonicalJson(orderedRequestIds)) throw new Error(`Naming batch ${batchId} ordered request authority is corrupt`);
    return {
      ...parsed,
      batchId: row.batch_id,
      behavior: row.behavior,
      year: row.year,
      barrierYear: row.barrier_year,
      comparisonGroups: JSON.parse(row.comparison_groups_json) as PersistedNamingBatchV5["comparisonGroups"],
      promptText: row.prompt_text,
      promptSha256: row.prompt_sha256,
      comparisonGroupingVersion: row.grouping_version,
      stableRequestSetDigest: row.stable_request_set_digest,
      identityVersion: row.identity_version,
      displayOrdinal: row.display_ordinal,
      authorityStatus: row.authority_status,
      createdAt: row.created_at,
    };
  }

  listV5NamingBatchAudits(runId: string): PersistedNamingBatchV5[] {
    const ids = this.database.prepare("SELECT batch_id FROM v5_naming_batch_audit WHERE run_id=? ORDER BY created_at,batch_id").all(runId) as { batch_id: string }[];
    return ids.map((row) => this.loadV5NamingBatchAudit(runId, row.batch_id)!);
  }

  private unresolvedPersistedV5NamingBatches(runId: string, requests: readonly NamingRequestV5[]): PersistedNamingBatchV5[] {
    const requestsById = new Map(requests.map((request) => [request.requestId, request]));
    const pending: PersistedNamingBatchV5[] = [];
    for (const batch of this.listV5NamingBatchAudits(runId)) {
      const current = batch.items.map((item) => requestsById.get(item.requestId));
      if (current.some((request) => !request)) throw new Error(`Naming batch ${batch.batchId} references a missing persisted request`);
      const unresolved = current.filter((request) => request!.acceptedLabel === null).length;
      if (unresolved === 0) continue;
      if (unresolved !== batch.items.length) throw new Error(`Naming batch ${batch.batchId} has a forbidden partially resolved request set`);
      pending.push(batch);
    }
    return pending.sort((left, right) => {
      const behaviorOrder = left.behavior === right.behavior ? 0 : left.behavior === "BLOCKING" ? -1 : 1;
      if (behaviorOrder !== 0) return behaviorOrder;
      if (left.identityVersion === "echoes-v5-naming-indexed-v2" && right.identityVersion === "echoes-v5-naming-indexed-v2") {
        const ordinalOrder = (left.displayOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.displayOrdinal ?? Number.MAX_SAFE_INTEGER);
        if (ordinalOrder !== 0) return ordinalOrder;
      }
      return left.createdAt.localeCompare(right.createdAt) || (left.displayOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.displayOrdinal ?? Number.MAX_SAFE_INTEGER) || left.batchId.localeCompare(right.batchId);
    });
  }

  materializePendingV5NamingBatches(runId: string, maximumBatchSize = 50): PersistedNamingBatchV5[] {
    if (!Number.isSafeInteger(maximumBatchSize) || maximumBatchSize <= 0) throw new Error("Naming batch size must be positive");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const requests = this.listV5NamingRequests(runId);
      const existing = this.listV5NamingBatchAudits(runId);
      const assigned = new Set(existing.flatMap((batch) => batch.items.map((item) => item.requestId)));
      const persistedPending = this.unresolvedPersistedV5NamingBatches(runId, requests);
      const unassignedPending = requests.filter((request) => request.acceptedLabel === null && (request.behavior === "BLOCKING" || request.behavior === "BATCHED") && !assigned.has(request.requestId));
      const newlyMaterialized = persistedPending.some((batch) => batch.behavior === "BLOCKING")
        ? []
        : buildPersistedNamingBatchesV5(runId, unassignedPending, maximumBatchSize, requests);
      for (const batch of newlyMaterialized) this.insertV5NamingBatchAudit(batch);
      const result = this.unresolvedPersistedV5NamingBatches(runId, requests);
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  saveV5NamingResponseAttempt(input: { runId: string; batchId: string; attemptId: string; accepted: boolean; response: unknown; errors: readonly string[] }): void {
    this.database.prepare("INSERT INTO v5_naming_response_attempt(run_id,batch_id,attempt_id,accepted,response_text,errors_json) VALUES (?,?,?,?,?,?)")
      .run(input.runId, input.batchId, input.attemptId, input.accepted ? 1 : 0, canonicalJson(input.response), canonicalJson(input.errors));
  }

  saveV5PolicyBlocker(runId: string, blocker: CausalPolicyBlockerV5): string {
    const blockerJson = canonicalJson(blocker); const blockerId = `V5_POLICY_BLOCKER_${createHash("sha256").update(blockerJson).digest("hex")}`;
    const prior = this.database.prepare("SELECT blocker_json FROM v5_policy_blocker WHERE run_id=? AND blocker_id=?").get(runId, blockerId) as { blocker_json: string } | undefined;
    if (prior && prior.blocker_json !== blockerJson) throw new Error(`Policy blocker ${blockerId} conflicts with immutable persisted authority`);
    if (!prior) this.database.prepare("INSERT INTO v5_policy_blocker(run_id,blocker_id,policy_key,year,blocker_json) VALUES (?,?,?,?,?)").run(runId, blockerId, blocker.policyKey, blocker.year, blockerJson);
    return blockerId;
  }

  listV5PolicyBlockers(runId: string): CausalPolicyBlockerV5[] {
    return (this.database.prepare("SELECT blocker_json FROM v5_policy_blocker WHERE run_id=? ORDER BY year,blocker_id").all(runId) as { blocker_json: string }[]).map((row) => JSON.parse(row.blocker_json) as CausalPolicyBlockerV5);
  }

  saveV5DerogatoryDecisionBatch(runId: string, batch: DerogatoryDecisionBatchV5): void {
    const batchJson = canonicalJson(batch); const prior = this.loadV5DerogatoryDecisionBatch(runId, batch.batchId);
    if (prior) { if (canonicalJson(prior) !== batchJson) throw new Error(`Derogatory decision batch ${batch.batchId} conflicts with immutable persisted authority`); return; }
    this.database.prepare("INSERT INTO v5_derogatory_decision_batch(run_id,batch_id,review_year,barrier_year,context_sha256,prompt_sha256,batch_json) VALUES (?,?,?,?,?,?,?)").run(runId, batch.batchId, batch.reviewYear, batch.barrierYear, batch.contextSha256, batch.promptSha256, batchJson);
  }

  loadV5DerogatoryDecisionBatch(runId: string, batchId: string): DerogatoryDecisionBatchV5 | null {
    const row = this.database.prepare("SELECT batch_json FROM v5_derogatory_decision_batch WHERE run_id=? AND batch_id=?").get(runId, batchId) as { batch_json: string } | undefined;
    return row ? JSON.parse(row.batch_json) as DerogatoryDecisionBatchV5 : null;
  }

  listV5DerogatoryDecisionBatches(runId: string): DerogatoryDecisionBatchV5[] {
    return (this.database.prepare("SELECT batch_json FROM v5_derogatory_decision_batch WHERE run_id=? ORDER BY review_year").all(runId) as { batch_json: string }[]).map((row) => JSON.parse(row.batch_json) as DerogatoryDecisionBatchV5);
  }

  saveV5DerogatoryDecisionAttempt(input: { runId: string; batchId: string; attemptId: string; accepted: boolean; response: DerogatoryDecisionResponseV5 | unknown; errors: readonly string[] }): void {
    this.database.prepare("INSERT INTO v5_derogatory_decision_attempt(run_id,batch_id,attempt_id,accepted,response_json,errors_json) VALUES (?,?,?,?,?,?)").run(input.runId, input.batchId, input.attemptId, input.accepted ? 1 : 0, canonicalJson(input.response), canonicalJson(input.errors));
  }

  saveV5AcceptedDerogatoryDecisionBatch(runId: string, accepted: AcceptedDerogatoryDecisionBatchV5): void {
    this.saveV5DerogatoryDecisionBatch(runId, accepted.batch);
    const existing = this.database.prepare("SELECT accepted_batch_json FROM v5_derogatory_decision_stream WHERE run_id=? AND batch_id=?").get(runId, accepted.batch.batchId) as { accepted_batch_json: string } | undefined;
    const acceptedJson = canonicalJson(accepted); if (existing) { if (existing.accepted_batch_json !== acceptedJson) throw new Error("Accepted Derogatory decision batch conflicts with immutable stream"); return; }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.database.prepare("INSERT INTO v5_derogatory_accepted_decision(run_id,batch_id,decision_id,world_key,scope,action,prior_group_id,selected_group_id,decision_json) VALUES (?,?,?,?,?,?,?,?,?)");
      for (const decision of accepted.acceptedSelections) insert.run(runId, accepted.batch.batchId, decision.decisionId, decision.worldKey, decision.scope, decision.action, decision.priorGroupId, decision.selectedGroupId, canonicalJson(decision));
      this.database.prepare("INSERT INTO v5_derogatory_decision_stream(run_id,batch_id,review_year,prior_stream_hash,stream_hash,accepted_batch_json) VALUES (?,?,?,?,?,?)").run(runId, accepted.batch.batchId, accepted.batch.reviewYear, accepted.priorDecisionStreamHash, accepted.decisionStreamHash, acceptedJson);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listV5AcceptedDerogatoryDecisionBatches(runId: string): AcceptedDerogatoryDecisionBatchV5[] {
    return (this.database.prepare("SELECT accepted_batch_json FROM v5_derogatory_decision_stream WHERE run_id=? ORDER BY review_year").all(runId) as { accepted_batch_json: string }[]).map((row) => JSON.parse(row.accepted_batch_json) as AcceptedDerogatoryDecisionBatchV5);
  }

  mergeV5DiagnosticObservations(runId: string, observations: readonly BoundedDiagnosticObservationV5[]): void {
    if (observations.length === 0) return;
    const load = this.database.prepare("SELECT payload_json FROM v5_diagnostic_summary WHERE run_id=? AND world_key=? AND domain=?");
    const upsert = this.database.prepare(`INSERT INTO v5_diagnostic_summary(run_id,world_key,domain,through_year,payload_json,payload_bytes) VALUES (?,?,?,?,?,?)
      ON CONFLICT(run_id,world_key,domain) DO UPDATE SET through_year=excluded.through_year,payload_json=excluded.payload_json,payload_bytes=excluded.payload_bytes`);
    const ownsTransaction = !this.v5AtomicWriteActive;
    if (ownsTransaction) this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const observation of observations) {
        const row = load.get(runId, observation.worldKey, observation.domain) as { payload_json: string } | undefined;
        const merged = mergeBoundedDiagnosticObservations(row ? JSON.parse(row.payload_json) as BoundedDiagnosticObservationV5 : null, observation);
        const payload = canonicalJson(merged);
        upsert.run(runId, merged.worldKey, merged.domain, merged.year, payload, Buffer.byteLength(payload));
      }
      if (ownsTransaction) this.database.exec("COMMIT");
    } catch (error) { if (ownsTransaction) this.database.exec("ROLLBACK"); throw error; }
  }

  listV5DiagnosticSummaries(runId: string): BoundedDiagnosticObservationV5[] {
    return (this.database.prepare("SELECT payload_json FROM v5_diagnostic_summary WHERE run_id=? ORDER BY world_key,domain").all(runId) as { payload_json: string }[]).map((row) => JSON.parse(row.payload_json) as BoundedDiagnosticObservationV5);
  }

  saveV5DivergenceTraces(runId: string, traces: readonly DivergenceTraceV5[]): void {
    if (traces.length === 0) return;
    const upsert = this.database.prepare(`INSERT INTO v5_divergence_trace(run_id,comparison_id,category,trace_json,payload_bytes) VALUES (?,?,?,?,?)
      ON CONFLICT(run_id,comparison_id) DO UPDATE SET category=excluded.category,trace_json=excluded.trace_json,payload_bytes=excluded.payload_bytes`);
    const ownsTransaction = !this.v5AtomicWriteActive;
    if (ownsTransaction) this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const trace of traces) { const payload = canonicalJson(trace); upsert.run(runId, trace.comparisonId, trace.category, payload, Buffer.byteLength(payload)); }
      if (ownsTransaction) this.database.exec("COMMIT");
    } catch (error) { if (ownsTransaction) this.database.exec("ROLLBACK"); throw error; }
  }

  listV5DivergenceTraces(runId: string): DivergenceTraceV5[] {
    return (this.database.prepare("SELECT trace_json FROM v5_divergence_trace WHERE run_id=? ORDER BY comparison_id").all(runId) as { trace_json: string }[]).map((row) => JSON.parse(row.trace_json) as DivergenceTraceV5);
  }

  v5DiagnosticStorageStats(runId: string): { rowCount: number; payloadBytes: number; maximumPayloadBytes: number; summaryRows: number; divergenceTraceRows: number } {
    const row = this.database.prepare("SELECT COUNT(*) count,COALESCE(SUM(payload_bytes),0) payload_bytes,COALESCE(MAX(payload_bytes),0) maximum_payload_bytes FROM v5_diagnostic_summary WHERE run_id=?").get(runId) as { count: number; payload_bytes: number; maximum_payload_bytes: number };
    const traces = this.database.prepare("SELECT COUNT(*) count,COALESCE(SUM(payload_bytes),0) payload_bytes,COALESCE(MAX(payload_bytes),0) maximum_payload_bytes FROM v5_divergence_trace WHERE run_id=?").get(runId) as { count: number; payload_bytes: number; maximum_payload_bytes: number };
    return { rowCount: row.count + traces.count, payloadBytes: row.payload_bytes + traces.payload_bytes, maximumPayloadBytes: Math.max(row.maximum_payload_bytes, traces.maximum_payload_bytes), summaryRows: row.count, divergenceTraceRows: traces.count };
  }

  v5StoragePayloadAccounting(runId: string): { causalEventPayloadBytes: number; checkpointPayloadBytes: number; diagnosticPayloadBytes: number; diagnosticSummaryPayloadBytes: number; divergenceTracePayloadBytes: number; namingAuditPayloadBytes: number } {
    const events = this.database.prepare("SELECT COALESCE(SUM(LENGTH(event_json)),0) bytes FROM v5_causal_event WHERE run_id=?").get(runId) as { bytes: number };
    const checkpoints = this.database.prepare("SELECT COALESCE(SUM(LENGTH(state_gzip)),0) bytes FROM v5_checkpoint WHERE run_id=?").get(runId) as { bytes: number };
    const diagnostics = this.database.prepare("SELECT COALESCE(SUM(payload_bytes),0) bytes FROM v5_diagnostic_summary WHERE run_id=?").get(runId) as { bytes: number };
    const traces = this.database.prepare("SELECT COALESCE(SUM(payload_bytes),0) bytes FROM v5_divergence_trace WHERE run_id=?").get(runId) as { bytes: number };
    const naming = this.database.prepare("SELECT COALESCE(SUM(LENGTH(batch_json)),0) bytes FROM v5_naming_batch_audit WHERE run_id=?").get(runId) as { bytes: number };
    return { causalEventPayloadBytes: events.bytes, checkpointPayloadBytes: checkpoints.bytes, diagnosticPayloadBytes: diagnostics.bytes + traces.bytes, diagnosticSummaryPayloadBytes: diagnostics.bytes, divergenceTracePayloadBytes: traces.bytes, namingAuditPayloadBytes: naming.bytes };
  }

  v5StoragePageAccounting(): { causalTableBytes: number; causalIndexBytes: number; checkpointTableBytes: number; checkpointIndexBytes: number; diagnosticTableBytes: number; diagnosticIndexBytes: number; namingTableBytes: number; namingIndexBytes: number; otherAllocatedPageBytes: number; totalAllocatedPageBytes: number } {
    const rows = this.database.prepare("SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name").all() as { name: string; bytes: number }[];
    const result = { causalTableBytes: 0, causalIndexBytes: 0, checkpointTableBytes: 0, checkpointIndexBytes: 0, diagnosticTableBytes: 0, diagnosticIndexBytes: 0, namingTableBytes: 0, namingIndexBytes: 0, otherAllocatedPageBytes: 0, totalAllocatedPageBytes: 0 };
    for (const row of rows) {
      result.totalAllocatedPageBytes += row.bytes;
      const index = row.name.startsWith("sqlite_autoindex_") || row.name.endsWith("_replay") || row.name.endsWith("_year");
      if (row.name.includes("v5_causal_event")) result[index ? "causalIndexBytes" : "causalTableBytes"] += row.bytes;
      else if (row.name.includes("v5_checkpoint")) result[index ? "checkpointIndexBytes" : "checkpointTableBytes"] += row.bytes;
      else if (row.name.includes("v5_diagnostic_summary") || row.name.includes("v5_divergence_trace")) result[index ? "diagnosticIndexBytes" : "diagnosticTableBytes"] += row.bytes;
      else if (row.name.includes("v5_naming_") || row.name.includes("v5_label_ledger")) result[index ? "namingIndexBytes" : "namingTableBytes"] += row.bytes;
      else result.otherAllocatedPageBytes += row.bytes;
    }
    return result;
  }

  acceptV5NamingRequests(
    runId: string,
    decisions: readonly { requestId: string; entityId: string; label: string; nameEffectiveFromYear: number }[],
    acceptanceYear: number,
    behavior: "BLOCKING" | "BATCHED",
    provenance: { batchId: string; responseAttemptId: string },
    atomic?: { response: unknown; manifest: V5RunManifest },
  ): { pendingBlocking: number; pendingBatched: number } {
    if (decisions.length === 0) throw new Error("V5 naming response is empty");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const pendingRows = this.database.prepare("SELECT request_id, request_json FROM v5_naming_request WHERE run_id=?").all(runId) as { request_id: string; request_json: string }[];
      const pending = new Map(pendingRows.map((row) => [row.request_id, JSON.parse(row.request_json) as NamingRequestV5]));
      const requiredIds = new Set(decisions.map((decision) => decision.requestId));
      if (decisions.length !== requiredIds.size) throw new Error("V5 naming response contains duplicate request IDs");
      if (behavior === "BATCHED" && [...pending.values()].some((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null)) throw new Error("BATCHED naming cannot be accepted while any BLOCKING request remains");
      const auditedBatch = this.loadV5NamingBatchAudit(runId, provenance.batchId);
      if (!auditedBatch) throw new Error(`Naming batch ${provenance.batchId} lacks immutable audit`);
      const auditedIds = new Set(auditedBatch.items.map((item) => item.requestId));
      if (auditedBatch.behavior !== behavior || auditedIds.size !== decisions.length || [...auditedIds].some((requestId) => !requiredIds.has(requestId))) throw new Error("V5 naming response must exactly cover its immutable audited request set");
      for (const groupId of new Set(auditedBatch.items.map((item) => item.namingComparisonGroupId).filter((id): id is string => Boolean(id)))) {
        const unresolvedGroup = [...pending.values()].filter((request) => request.namingComparisonGroupId === groupId && request.acceptedLabel === null && request.behavior === behavior);
        if (unresolvedGroup.some((request) => !requiredIds.has(request.requestId))) throw new Error(`Comparison group ${groupId} must be accepted atomically`);
      }
      if (atomic) {
        const currentManifest = this.database.prepare("SELECT causal_run_hash FROM v5_run_manifest WHERE run_id=?").get(runId) as { causal_run_hash: string } | undefined;
        if (!currentManifest || atomic.manifest.runId !== runId || atomic.manifest.causalRunHash !== currentManifest.causal_run_hash) throw new Error("V5 naming acceptance cannot alter causal run identity");
        this.database.prepare("INSERT INTO v5_naming_response_attempt(run_id,batch_id,attempt_id,accepted,response_text,errors_json) VALUES (?,?,?,?,?,?)")
          .run(runId, provenance.batchId, provenance.responseAttemptId, 1, canonicalJson(atomic.response), "[]");
      }
      const updateRequest = this.database.prepare("UPDATE v5_naming_request SET request_json=? WHERE run_id=? AND request_id=?");
      const insertLabel = this.database.prepare(`INSERT INTO v5_label_ledger(ledger_entry_id,run_id,world_key,entity_type,entity_id,label,source,source_request_id,source_authority_ref,source_batch_id,source_response_attempt_id,name_effective_from_year,acceptance_year,reused_from_entity_id,reused_from_ledger_entry_id,naming_comparison_group_id,comparison_authority_ref,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const decision of [...decisions].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
        const request = pending.get(decision.requestId);
        if (!request || request.behavior !== behavior || request.acceptedLabel !== null || request.entityId !== decision.entityId || !decision.label.trim() || decision.nameEffectiveFromYear !== (request.nameEffectiveFromYear ?? request.createdYear)) throw new Error(`Invalid V5 naming decision ${decision.requestId}`);
        const accepted = { ...request, acceptedLabel: decision.label.trim() };
        updateRequest.run(canonicalJson(accepted), runId, request.requestId);
        const entry: AcceptedLabelLedgerEntryV5 = { ledgerEntryId: `V5_LABEL_${createHash("sha256").update(`${runId}\0${request.entityId}\0${decision.nameEffectiveFromYear}`).digest("hex")}`, runId, worldKey: request.worldKey ?? null, entityType: request.entityType, entityId: request.entityId, label: accepted.acceptedLabel, source: "LLM_NAMING_RESPONSE", sourceRequestId: request.requestId, sourceAuthorityRef: null, sourceBatchId: provenance.batchId, sourceResponseAttemptId: provenance.responseAttemptId, nameEffectiveFromYear: decision.nameEffectiveFromYear, acceptanceYear, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: request.namingComparisonGroupId ?? null, comparisonAuthorityRef: request.comparisonAuthorityRef ?? null };
        validateAcceptedLabelProvenanceV5(entry, "PRODUCTION");
        insertLabel.run(entry.ledgerEntryId, entry.runId, entry.worldKey, entry.entityType, entry.entityId, entry.label, entry.source, entry.sourceRequestId, entry.sourceAuthorityRef, entry.sourceBatchId, entry.sourceResponseAttemptId, entry.nameEffectiveFromYear, entry.acceptanceYear, entry.reusedFromEntityId, entry.reusedFromLedgerEntryId, entry.namingComparisonGroupId, entry.comparisonAuthorityRef, canonicalJson(entry));
      }
      const remainingRows = this.database.prepare("SELECT request_json FROM v5_naming_request WHERE run_id=?").all(runId) as { request_json: string }[];
      const remaining = remainingRows.map((row) => JSON.parse(row.request_json) as NamingRequestV5);
      const pendingBlocking = remaining.filter((request) => request.behavior === "BLOCKING" && request.acceptedLabel === null).length;
      const pendingBatched = remaining.filter((request) => request.behavior === "BATCHED" && request.acceptedLabel === null).length;
      if (atomic && (pendingBlocking > 0 || pendingBatched > 0)) this.database.prepare("UPDATE simulation_run SET status='WAITING_FOR_NAMING', updated_at=CURRENT_TIMESTAMP WHERE run_id=?").run(runId);
      else if (behavior === "BLOCKING" || (atomic && pendingBlocking === 0 && pendingBatched === 0)) this.database.prepare("UPDATE simulation_run SET status='RUNNING', updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='WAITING_FOR_NAMING'").run(runId);
      if (atomic) {
        this.database.prepare(`UPDATE v5_run_manifest SET causal_run_hash=?,operational_config_hash=?,diagnostic_config_hash=?,label_input_hash=?,run_manifest_hash=?,manifest_json=? WHERE run_id=?`)
          .run(atomic.manifest.causalRunHash, atomic.manifest.operationalConfigHash, atomic.manifest.diagnosticConfigHash, atomic.manifest.labelInputHash, atomic.manifest.runManifestHash, canonicalJson(atomic.manifest), runId);
      }
      this.database.exec("COMMIT");
      return { pendingBlocking, pendingBatched };
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
