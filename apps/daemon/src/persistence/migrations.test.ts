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
  "event_deduplication",
  "events",
  "evidence_gaps",
  "git_baseline_untracked_entries",
  "git_baselines",
  "git_reconciliation_entries",
  "git_reconciliations",
  "ingress_receipts",
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
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_reject_update'",
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
        "valid-recovery",
        "recovery",
        "stale_finalizing_recovered",
      );

      runMigrations(opened.database, MIGRATIONS.slice(0, 9));

      expect(readAppliedMigrations(opened.database)).toHaveLength(9);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_validate_mode_diagnostic_v9'",
          )
          .get(),
      ).toBeDefined();
      expect(
        opened.database
          .prepare("SELECT mode, diagnostic_code FROM run_finalizations WHERE run_id = ?")
          .get("run-valid-recovery"),
      ).toEqual({ mode: "recovery", diagnostic_code: "stale_finalizing_recovered" });

      expect(() =>
        seedVersion8PartialFinalization(
          opened.database,
          "invalid-new",
          "normal",
          "stale_finalizing_recovered",
        ),
      ).toThrow();
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
        "invalid-existing",
        "normal",
        "stale_finalizing_recovered",
      );

      expect(() => runMigrations(opened.database)).toThrow();
      expect(readAppliedMigrations(opened.database)).toHaveLength(8);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_validate_mode_diagnostic_v9'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      opened.database.close();
    }
  });

  it("upgrades valid version-9 finalizations and installs version-10 evidence continuity", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 9));
      seedVersion8PartialFinalization(
        opened.database,
        "valid-v10",
        "recovery",
        "stale_finalizing_recovered",
      );

      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toHaveLength(10);
      expect(
        opened.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'run_finalizations_validate_evidence_continuity_v10'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it("rejects version-9 finalizations without retained evidence during migration 10", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 9));
      seedVersion8PartialFinalization(
        opened.database,
        "invalid-v10-evidence",
        "recovery",
        "stale_finalizing_recovered",
      );
      opened.database
        .prepare("DELETE FROM evidence_gaps WHERE run_id = ?")
        .run("run-invalid-v10-evidence");
      opened.database
        .prepare("UPDATE task_runs SET evidence_gap_count = 0 WHERE run_id = ?")
        .run("run-invalid-v10-evidence");

      expect(() => runMigrations(opened.database)).toThrow();
      expect(readAppliedMigrations(opened.database)).toHaveLength(9);
    } finally {
      opened.database.close();
    }
  });

  it("enforces version-1 artifact identity, sensitivity, and reference immutability", () => {
    const opened = openConfiguredDatabase(":memory:");
    const digest = `sha256:${"a".repeat(64)}`;
    const storagePath = `objects/sha256/aa/${"a".repeat(62)}`;
    try {
      runMigrations(opened.database);
      opened.database
        .prepare(
          `INSERT INTO artifacts (
             artifact_id, digest, storage_path, size_bytes, kind, sensitivity,
             storage_version, media_type, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "artifact-1",
          digest,
          storagePath,
          1,
          "prepared-evidence",
          "public",
          1,
          "application/octet-stream",
          "2026-07-22T00:00:00.000Z",
        );

      expect(() =>
        opened.database
          .prepare("UPDATE artifacts SET sensitivity = ? WHERE artifact_id = ?")
          .run("secret", "artifact-1"),
      ).not.toThrow();
      expect(() =>
        opened.database
          .prepare("UPDATE artifacts SET sensitivity = ? WHERE artifact_id = ?")
          .run("normal", "artifact-1"),
      ).toThrow();
      expect(() =>
        opened.database
          .prepare("UPDATE artifacts SET kind = ? WHERE artifact_id = ?")
          .run("changed-kind", "artifact-1"),
      ).toThrow();

      for (const invalid of [
        {
          artifactId: "invalid-digest",
          digest: `sha256:${"A".repeat(64)}`,
          storagePath,
          mediaType: "application/octet-stream",
        },
        {
          artifactId: "invalid-path",
          digest: `sha256:${"b".repeat(64)}`,
          storagePath: "objects/sha256/00/not-derived",
          mediaType: "application/octet-stream",
        },
        {
          artifactId: "invalid-media",
          digest: `sha256:${"c".repeat(64)}`,
          storagePath: `objects/sha256/cc/${"c".repeat(62)}`,
          mediaType: null,
        },
      ]) {
        expect(() =>
          opened.database
            .prepare(
              `INSERT INTO artifacts (
                 artifact_id, digest, storage_path, size_bytes, kind, sensitivity,
                 storage_version, media_type, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              invalid.artifactId,
              invalid.digest,
              invalid.storagePath,
              1,
              "prepared-evidence",
              "normal",
              1,
              invalid.mediaType,
              "2026-07-22T00:00:00.000Z",
            ),
        ).toThrow();
      }

      opened.database
        .prepare(
          `INSERT INTO workspaces (
             workspace_id, canonical_path, repository_root, git_remote,
             initial_repository_fingerprint, created_at, last_observed_at, identity_basis
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "workspace-1",
          "/workspace",
          "/workspace",
          null,
          "fingerprint",
          "2026-07-22T00:00:00.000Z",
          "2026-07-22T00:00:00.000Z",
          "legacy",
        );
      opened.database
        .prepare(
          `INSERT INTO agent_conversations (
             conversation_id, workspace_id, source, source_session_id, start_mode,
             started_at, last_observed_at, ended_at, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "conversation-1",
          "workspace-1",
          "claude_code",
          "session-1",
          null,
          "2026-07-22T00:00:00.000Z",
          "2026-07-22T00:00:00.000Z",
          null,
          "Active",
        );
      opened.database
        .prepare(
          `INSERT INTO task_runs (
             run_id, conversation_id, run_number, redacted_prompt, started_at, status
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("run-1", "conversation-1", 1, "prompt", "2026-07-22T00:00:00.000Z", "Capturing");
      opened.database
        .prepare(
          `INSERT INTO run_artifacts (run_id, artifact_id, role, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run("run-1", "artifact-1", "final-diff", "2026-07-22T00:00:00.000Z");

      expect(() =>
        opened.database
          .prepare(
            `UPDATE run_artifacts SET role = ?
             WHERE run_id = ? AND artifact_id = ? AND role = ?`,
          )
          .run("changed-role", "run-1", "artifact-1", "final-diff"),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("reruns applied migrations idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      runMigrations(opened.database);
      const before = readAppliedMigrations(opened.database);
      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toEqual(before);
    } finally {
      opened.database.close();
    }
  });

  it("rejects a checksum mismatch for an applied migration", () => {
    const opened = openConfiguredDatabase(":memory:");
    const initialMigration = MIGRATIONS[0];

    if (initialMigration === undefined) {
      throw new Error("The initial migration definition is missing.");
    }

    try {
      runMigrations(opened.database);
      const changedDefinition: MigrationDefinition = {
        ...initialMigration,
        sql: `${initialMigration.sql}\n-- immutable history changed`,
      };

      expect(() => runMigrations(opened.database, [changedDefinition])).toThrowError(
        expect.objectContaining<Partial<MigrationError>>({
          code: "history_mismatch",
        }),
      );
    } finally {
      opened.database.close();
    }
  });

  it("records the SHA-256 checksum of the immutable SQL", () => {
    const opened = openConfiguredDatabase(":memory:");
    const initialMigration = MIGRATIONS[0];

    if (initialMigration === undefined) {
      throw new Error("The initial migration definition is missing.");
    }

    try {
      runMigrations(opened.database);
      const applied = readAppliedMigrations(opened.database)[0];

      expect(applied?.checksum).toBe(migrationChecksum(initialMigration.sql));
      expect(applied?.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      opened.database.close();
    }
  });

  it.each([
    {
      name: "duplicate versions",
      definitions: [
        { version: 1, name: "one", sql: "SELECT 1;" },
        { version: 1, name: "duplicate", sql: "SELECT 2;" },
      ],
      code: "duplicate_version" as const,
    },
    {
      name: "unordered versions",
      definitions: [
        { version: 2, name: "two", sql: "SELECT 2;" },
        { version: 1, name: "one", sql: "SELECT 1;" },
      ],
      code: "unordered_versions" as const,
    },
  ])("rejects $name", ({ definitions, code }) => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      expect(() => runMigrations(opened.database, definitions)).toThrowError(
        expect.objectContaining<Partial<MigrationError>>({ code }),
      );
    } finally {
      opened.database.close();
    }
  });
});
