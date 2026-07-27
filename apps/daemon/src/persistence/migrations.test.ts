import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openConfiguredDatabase, PERSISTENCE_BUSY_TIMEOUT_MS } from "./database.js";
import type { MigrationError } from "./errors.js";
import { MIGRATIONS, type MigrationDefinition } from "./migration-definitions.js";
import { migrationChecksum, readAppliedMigrations, runMigrations } from "./migrations.js";

const REQUIRED_TABLES = [
  "agent_conversations",
  "analysis_jobs",
  "artifacts",
  "candidate_generations",
  "candidate_validations",
  "event_deduplication",
  "events",
  "evidence_gaps",
  "git_baseline_untracked_entries",
  "git_baselines",
  "git_reconciliation_entries",
  "git_reconciliations",
  "ingress_receipts",
  "local_settings",
  "moment_interactions",
  "ownership_records",
  "receipt_event_normalizations",
  "receipt_lifecycle_resolutions",
  "receipt_normalized_events",
  "run_artifacts",
  "run_finalizations",
  "schema_migrations",
  "task_runs",
  "workspaces",
] as const;

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

function seedVersion8PartialFinalization(
  database: ReturnType<typeof openConfiguredDatabase>["database"],
  suffix: string,
  mode: "normal" | "recovery",
  diagnosticCode: string,
): void {
  const workspaceId = `workspace-${suffix}`;
  const conversationId = `conversation-${suffix}`;
  const runId = `run-${suffix}`;
  const eventId = `terminal-${suffix}`;
  const finalizationId = `finalization-${suffix}`;
  const at = "2026-07-22T12:00:00.000Z";

  database
    .prepare(
      `INSERT INTO workspaces (
         workspace_id, canonical_path, repository_root, git_remote,
         initial_repository_fingerprint, identity_basis, created_at, last_observed_at
       ) VALUES (?, ?, ?, NULL, ?, 'git_resolved_v1', ?, ?)`,
    )
    .run(workspaceId, `/workspace/${suffix}`, `/workspace/${suffix}`, "a".repeat(64), at, at);
  database
    .prepare(
      `INSERT INTO agent_conversations (
         conversation_id, workspace_id, source, source_session_id, start_mode,
         started_at, last_observed_at, ended_at, status
       ) VALUES (?, ?, 'claude_code', ?, 'startup', ?, ?, NULL, 'Active')`,
    )
    .run(conversationId, workspaceId, `session-${suffix}`, at, at);
  database
    .prepare(
      `INSERT INTO task_runs (
         run_id, conversation_id, run_number, redacted_prompt,
         baseline_git_commit, baseline_working_tree_fingerprint,
         started_at, ended_at, status, final_git_fingerprint,
         source_stop_reason, evidence_gap_count
       ) VALUES (?, ?, 1, '[REDACTED]', NULL, NULL, ?, ?, 'Partial', NULL, 'stop', 1)`,
    )
    .run(runId, conversationId, at, at);
  database
    .prepare(
      `INSERT INTO evidence_gaps (
         gap_id, run_id, code, message, details_json, created_at
       ) VALUES (?, ?, 'existing_gap', 'Existing controlled evidence gap.', NULL, ?)`,
    )
    .run(`gap-${suffix}`, runId, at);
  database
    .prepare(
      `INSERT INTO events (
         event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
         event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
         sensitivity, payload_json, metadata_json
       ) VALUES (?, 1, ?, ?, ?, 1, 'run.partial', 'ownloop', NULL, NULL, ?, ?,
                 'normal', '{}', '{"collectorVersion":"0.1.0","sourceVersion":null}')`,
    )
    .run(eventId, workspaceId, conversationId, runId, at, at);
  database
    .prepare(
      `INSERT INTO event_deduplication (
         source, source_session_id, deduplication_key, event_id, created_at
       ) VALUES ('ownloop', ?, ?, ?, ?)`,
    )
    .run(conversationId, `v1:run-finalization:${runId}:terminal`, eventId, at);
  database
    .prepare(
      `INSERT INTO run_finalizations (
         finalization_id, run_id, conversation_id, workspace_id, terminal_status, mode,
         trigger_event_id, reconciliation_id, manifest_artifact_id, final_fingerprint,
         final_snapshot_event_id, terminal_event_id, diagnostic_code, finalized_at,
         generator_version
       ) VALUES (?, ?, ?, ?, 'Partial', ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, '0.1.0')`,
    )
    .run(finalizationId, runId, conversationId, workspaceId, mode, eventId, diagnosticCode, at);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("SQLite migrations", () => {
  it("migrates a new in-memory database and creates every required table", () => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      runMigrations(opened.database);

      const tables = opened.database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name);

      expect(tables).toEqual(REQUIRED_TABLES);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
    } finally {
      opened.database.close();
    }
  });

  it("migrates a new file-backed database with durable connection settings", () => {
    const databasePath = temporaryDatabasePath();
    const opened = openConfiguredDatabase(databasePath);

    try {
      runMigrations(opened.database);

      expect(opened.connectionInfo).toMatchObject({
        databasePath,
        fileBacked: true,
        foreignKeysEnabled: true,
        busyTimeoutMs: PERSISTENCE_BUSY_TIMEOUT_MS,
        journalMode: "wal",
        synchronousMode: "FULL",
        defensiveModeEnabled: true,
      });
      expect(opened.database.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
    } finally {
      opened.database.close();
    }
  });

  it("upgrades a version-5 database to reconciliation migration version 6", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 5));
      expect(readAppliedMigrations(opened.database)).toHaveLength(5);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'git_reconciliations'",
          )
          .get(),
      ).toBeUndefined();

      runMigrations(opened.database, MIGRATIONS.slice(0, 6));
      expect(readAppliedMigrations(opened.database)).toHaveLength(6);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'git_reconciliations'",
          )
          .get(),
      ).toBeDefined();
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'git_reconciliation_entries'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("upgrades a version-6 database to artifact-store migration version 7", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 6));
      opened.database
        .prepare(
          `INSERT INTO artifacts (
             artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-artifact",
          "sha256:legacy",
          "legacy/path",
          1,
          "legacy",
          "normal",
          "2026-07-22T00:00:00.000Z",
        );

      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(
        opened.database
          .prepare(
            `SELECT storage_version, media_type
             FROM artifacts
             WHERE artifact_id = ?`,
          )
          .get("legacy-artifact"),
      ).toEqual({ storage_version: 0, media_type: null });
      expect(
        opened.database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get("run_artifacts_reject_update"),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("upgrades a version-7 database to immutable Run finalization migration version 8", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 7));
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_finalizations'",
          )
          .get(),
      ).toBeUndefined();

      runMigrations(opened.database, MIGRATIONS.slice(0, 8));
      expect(readAppliedMigrations(opened.database)).toHaveLength(8);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_finalizations'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("upgrades valid version-8 finalizations and installs strict version-9 validation", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 8));
      seedVersion8PartialFinalization(
        opened.database,
        "normal",
        "normal",
        "existing_evidence_gaps",
      );
      seedVersion8PartialFinalization(
        opened.database,
        "recovery",
        "recovery",
        "stale_finalizing_recovered",
      );

      runMigrations(opened.database, MIGRATIONS.slice(0, 9));

      expect(readAppliedMigrations(opened.database)).toHaveLength(9);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_validate_insert'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("rejects invalid existing version-8 mode and diagnostic combinations during migration 9", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 8));
      seedVersion8PartialFinalization(
        opened.database,
        "invalid",
        "normal",
        "stale_finalizing_recovered",
      );

      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 9))).toThrow();
      expect(readAppliedMigrations(opened.database)).toHaveLength(8);
    } finally {
      opened.database.close();
    }
  });

  it("upgrades valid version-9 finalizations and installs version-10 evidence continuity", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 8));
      seedVersion8PartialFinalization(
        opened.database,
        "continuity",
        "normal",
        "existing_evidence_gaps",
      );
      runMigrations(opened.database, MIGRATIONS.slice(0, 10));

      expect(readAppliedMigrations(opened.database)).toHaveLength(10);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_validate_insert'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("upgrades version 10 and installs deterministic classification artifact invariants", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 10));
      runMigrations(opened.database, MIGRATIONS.slice(0, 11));

      expect(readAppliedMigrations(opened.database)).toHaveLength(11);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_artifacts_classification_v11_guard'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("rejects a pre-existing v1 classification role without a finalized Run during migration 11", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 10));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 11))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects pre-existing v1 classification metadata that is not fixed sensitive", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 10));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 11))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects duplicate pre-existing v1 classification roles during migration 11", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 10));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 11))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects version-9 finalizations without retained evidence during migration 10", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 9));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 10))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces version-1 artifact identity, sensitivity, and reference immutability", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 7));
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("reruns applied migrations idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      const first = readAppliedMigrations(opened.database);
      runMigrations(opened.database);
      expect(readAppliedMigrations(opened.database)).toEqual(first);
    } finally {
      opened.database.close();
    }
  });

  it("rejects a checksum mismatch for an applied migration", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      const modified = MIGRATIONS.map((migration) =>
        migration.version === 1 ? { ...migration, sql: `${migration.sql}\nSELECT 1;` } : migration,
      );
      expect(() => runMigrations(opened.database, modified)).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("records the SHA-256 checksum of the immutable SQL", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      const applied = readAppliedMigrations(opened.database);
      expect(applied[0]?.checksum).toBe(migrationChecksum(MIGRATIONS[0]?.sql ?? ""));
    } finally {
      opened.database.close();
    }
  });

  it("upgrades migration 11 to verification artifact migration 12", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 11));
      runMigrations(opened.database, MIGRATIONS.slice(0, 12));
      expect(readAppliedMigrations(opened.database)).toHaveLength(12);
    } finally {
      opened.database.close();
    }
  });

  it("rejects pre-existing verification evidence with invalid metadata during migration 12", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 11));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 12))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects duplicate pre-existing verification evidence roles during migration 12", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 11));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 12))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces verification role metadata and finalized Run ownership after migration 12", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 12));
      expect(readAppliedMigrations(opened.database)).toHaveLength(12);
    } finally {
      opened.database.close();
    }
  });

  it("upgrades migration 12 to Evidence Graph migration 13", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 12));
      runMigrations(opened.database, MIGRATIONS.slice(0, 13));
      expect(readAppliedMigrations(opened.database)).toHaveLength(13);
    } finally {
      opened.database.close();
    }
  });

  it("rejects invalid or duplicate pre-existing Evidence Graph roles during migration 13", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 12));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 13))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces Evidence Graph metadata, size, finalization, uniqueness, and sensitivity", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 13));
      expect(readAppliedMigrations(opened.database)).toHaveLength(13);
    } finally {
      opened.database.close();
    }
  });

  it("upgrades migration 13 to semantic-input migration 14", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 13));
      runMigrations(opened.database, MIGRATIONS.slice(0, 14));
      expect(readAppliedMigrations(opened.database)).toHaveLength(14);
    } finally {
      opened.database.close();
    }
  });

  it("rejects duplicate pre-existing semantic-input roles during migration 14", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 13));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 14))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces semantic-input metadata, size, finalization, uniqueness, and sensitivity", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 14));
      expect(readAppliedMigrations(opened.database)).toHaveLength(14);
    } finally {
      opened.database.close();
    }
  });

  it.each([
    {
      name: "duplicate versions",
      definitions: [MIGRATIONS[0], MIGRATIONS[0]],
      code: "duplicate_version",
    },
    {
      name: "unordered versions",
      definitions: [MIGRATIONS[1], MIGRATIONS[0]],
      code: "unordered_versions",
    },
  ])("rejects '$name'", ({ definitions, code }) => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      expect(() => runMigrations(opened.database, definitions.filter(Boolean) as MigrationDefinition[])).toThrowError(
        expect.objectContaining({ code } satisfies Partial<MigrationError>),
      );
    } finally {
      opened.database.close();
    }
  });

  it("upgrades migration 14 to Candidate generation migration 15", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 14));
      runMigrations(opened.database, MIGRATIONS.slice(0, 15));
      expect(readAppliedMigrations(opened.database)).toHaveLength(15);
    } finally {
      opened.database.close();
    }
  });

  it("rejects pre-existing Candidate artifact roles during migration 15", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 14));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 15))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces Candidate generation source, artifact, uniqueness, and immutability", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 15));
      expect(readAppliedMigrations(opened.database)).toHaveLength(15);
    } finally {
      opened.database.close();
    }
  });

  it("upgrades migration 15 to Candidate validation migration 16", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 15));
      runMigrations(opened.database, MIGRATIONS.slice(0, 16));
      expect(readAppliedMigrations(opened.database)).toHaveLength(16);
    } finally {
      opened.database.close();
    }
  });

  it("rejects pre-existing validation report roles during migration 16", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 15));
      expect(() => runMigrations(opened.database, MIGRATIONS.slice(0, 16))).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces Candidate validation source, report, record, and immutability invariants", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 16));
      expect(readAppliedMigrations(opened.database)).toHaveLength(16);
    } finally {
      opened.database.close();
    }
  });
});

describe("migration v17 Moment interactions", () => {
  it("upgrades 16 to 17 with strict append-only interaction tables", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 16));
      const before = readAppliedMigrations(opened.database);
      runMigrations(opened.database, MIGRATIONS.slice(0, 17));
      const after = readAppliedMigrations(opened.database);
      expect(after.slice(0, 16)).toEqual(before);
      expect(after).toHaveLength(17);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='moment_interactions'",
          )
          .get(),
      ).toBeDefined();
      expect(
        opened.database
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ownership_records'")
          .get(),
      ).toBeDefined();
      const triggers = opened.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%v17' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(triggers).toContain("moment_interactions_reject_update_v17");
      expect(triggers).toContain("ownership_records_reject_update_v17");
    } finally {
      opened.database.close();
    }
  });
});

describe("local settings migration v18", () => {
  it("upgrades an exact version-17 database and installs one default singleton", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 17));
      const before = readAppliedMigrations(opened.database);
      runMigrations(opened.database);
      const after = readAppliedMigrations(opened.database);
      expect(after.slice(0, 17)).toEqual(before);
      expect(after).toHaveLength(MIGRATIONS.length);
      expect(
        opened.database
          .prepare(
            `SELECT settings_id, schema_version, revision, external_ai_enabled,
                    retention_policy, diagnostic_mode, raw_source_payload_retention,
                    custom_secret_field_patterns_json
             FROM local_settings`,
          )
          .all(),
      ).toEqual([
        {
          settings_id: "local",
          schema_version: 1,
          revision: 1,
          external_ai_enabled: 0,
          retention_policy: "keep_until_deleted",
          diagnostic_mode: "off",
          raw_source_payload_retention: "off",
          custom_secret_field_patterns_json: "[]",
        },
      ]);
    } finally {
      opened.database.close();
    }
  });

  it("rejects singleton deletion, revision jumps, raw retention changes, and incomplete provider tuples", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      expect(() => opened.database.exec("DELETE FROM local_settings")).toThrow();
      expect(() =>
        opened.database.exec("UPDATE local_settings SET revision = revision + 2"),
      ).toThrow();
      expect(() =>
        opened.database.exec(
          "UPDATE local_settings SET raw_source_payload_retention = 'persistent'",
        ),
      ).toThrow();
      expect(() =>
        opened.database.exec(
          "UPDATE local_settings SET provider_base_url = 'https://example.invalid'",
        ),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });
});
