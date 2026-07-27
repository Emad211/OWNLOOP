import { describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "./database.js";
import { MIGRATIONS, type MigrationDefinition } from "./migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "./migrations.js";

const AT = "2026-07-27T00:30:00.000Z";

function seedVersion18Event(database: ReturnType<typeof openConfiguredDatabase>["database"]): void {
  database
    .prepare(
      `INSERT INTO workspaces (
         workspace_id, canonical_path, repository_root, git_remote,
         initial_repository_fingerprint, identity_basis, created_at, last_observed_at
       ) VALUES ('workspace-v19', '/workspace/v19', '/workspace/v19', NULL, ?,
                 'git_resolved_v1', ?, ?)`,
    )
    .run("a".repeat(64), AT, AT);
  database.exec(`
    INSERT INTO agent_conversations (
      conversation_id, workspace_id, source, source_session_id, start_mode,
      started_at, last_observed_at, ended_at, status
    ) VALUES (
      'conversation-v19', 'workspace-v19', 'claude_code', 'session-v19', 'startup',
      '${AT}', '${AT}', NULL, 'Active'
    );
    INSERT INTO task_runs (
      run_id, conversation_id, run_number, redacted_prompt,
      baseline_git_commit, baseline_working_tree_fingerprint,
      started_at, ended_at, status, final_git_fingerprint,
      source_stop_reason, evidence_gap_count
    ) VALUES (
      'run-v19', 'conversation-v19', 1, '[REDACTED]', NULL, NULL,
      '${AT}', NULL, 'Capturing', NULL, NULL, 0
    );
    INSERT INTO events (
      event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
      event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
      sensitivity, payload_json, metadata_json
    ) VALUES (
      'event-v18-existing', 1, 'workspace-v19', 'conversation-v19', 'run-v19', 1,
      'run.started', 'ownloop', NULL, NULL, '${AT}', '${AT}', 'normal', '{}',
      '{"collectorVersion":"0.1.0","sourceVersion":null}'
    );
    INSERT INTO event_deduplication (
      source, source_session_id, deduplication_key, event_id, created_at
    ) VALUES (
      'ownloop', 'conversation-v19', 'v1:migration-v19:existing', 'event-v18-existing', '${AT}'
    );
  `);
}

function eventReferencingTables(
  database: ReturnType<typeof openConfiguredDatabase>["database"],
): readonly string[] {
  const tableNames = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));

  return tableNames.filter((tableName) =>
    database
      .prepare(`PRAGMA foreign_key_list(${JSON.stringify(tableName)})`)
      .all()
      .some((row) => row.table === "events"),
  );
}

function eventSchemaObjectNames(
  database: ReturnType<typeof openConfiguredDatabase>["database"],
): readonly string[] {
  return database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE tbl_name = 'events' AND type IN ('index', 'trigger') AND sql IS NOT NULL
       ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
}

describe("multi-agent Event source migration v19", () => {
  it("preserves version-18 Events, dependencies, indexes, triggers, and pragma state", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 18));
      seedVersion18Event(opened.database);
      const referencingTables = eventReferencingTables(opened.database);
      const eventObjects = eventSchemaObjectNames(opened.database);

      expect(referencingTables.length).toBeGreaterThan(0);
      expect(eventObjects).toEqual([
        "events_conversation_ingested_idx",
        "events_identity_aggregate_idx",
        "events_reject_update",
        "events_run_sequence_idx",
      ]);

      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toHaveLength(19);
      expect(opened.database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(opened.database.prepare("PRAGMA legacy_alter_table").get()).toEqual({
        legacy_alter_table: 0,
      });
      expect(opened.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(eventReferencingTables(opened.database)).toEqual(referencingTables);
      expect(eventSchemaObjectNames(opened.database)).toEqual(eventObjects);
      expect(
        opened.database.prepare("SELECT event_id, source FROM events ORDER BY event_id").all(),
      ).toEqual([{ event_id: "event-v18-existing", source: "ownloop" }]);
      expect(
        opened.database
          .prepare("SELECT event_id FROM event_deduplication WHERE event_id = ?")
          .get("event-v18-existing"),
      ).toEqual({ event_id: "event-v18-existing" });
      expect(
        opened.database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get("events_v18_source_constraint"),
      ).toBeUndefined();

      opened.database.exec(`
        INSERT INTO events (
          event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
          event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
          sensitivity, payload_json, metadata_json
        ) VALUES (
          'event-codex-v19', 1, 'workspace-v19', 'conversation-v19', 'run-v19', 2,
          'tool.requested', 'codex', 'PreToolUse', 'tool-v19', '${AT}', '${AT}',
          'sensitive', '{}', '{"collectorVersion":"0.1.0","sourceVersion":"1.2.3"}'
        )
      `);
      expect(
        opened.database
          .prepare("SELECT source FROM events WHERE event_id = ?")
          .get("event-codex-v19"),
      ).toEqual({ source: "codex" });
      expect(() =>
        opened.database.exec(`
          INSERT INTO events (
            event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
            event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
            sensitivity, payload_json, metadata_json
          ) VALUES (
            'event-unknown-v19', 1, 'workspace-v19', 'conversation-v19', 'run-v19', 3,
            'tool.requested', 'future_agent', 'PreToolUse', NULL, '${AT}', '${AT}',
            'normal', '{}', '{"collectorVersion":"0.1.0","sourceVersion":null}'
          )
        `),
      ).toThrow();
      expect(() =>
        opened.database.exec(
          "UPDATE events SET sensitivity = 'public' WHERE event_id = 'event-codex-v19'",
        ),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rolls back a failed foreign-key-disabled rebuild and restores both pragma flags", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 18));
      seedVersion18Event(opened.database);
      const failingMigration: MigrationDefinition = {
        version: 19,
        name: "failing_multi_agent_event_source",
        foreignKeyPolicy: "disable_during_table_rebuild",
        sql: `
          ALTER TABLE events RENAME TO events_failed_rebuild;
          SELECT * FROM table_that_does_not_exist;
        `,
      };

      expect(() =>
        runMigrations(opened.database, [...MIGRATIONS.slice(0, 18), failingMigration]),
      ).toThrow();
      expect(readAppliedMigrations(opened.database)).toHaveLength(18);
      expect(opened.database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(opened.database.prepare("PRAGMA legacy_alter_table").get()).toEqual({
        legacy_alter_table: 0,
      });
      expect(opened.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(opened.database.prepare("SELECT event_id FROM events").all()).toEqual([
        { event_id: "event-v18-existing" },
      ]);
      expect(
        opened.database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get("events_failed_rebuild"),
      ).toBeUndefined();
      expect(() =>
        opened.database.exec(`
          INSERT INTO events (
            event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
            event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
            sensitivity, payload_json, metadata_json
          ) VALUES (
            'event-codex-rejected', 1, 'workspace-v19', 'conversation-v19', 'run-v19', 2,
            'tool.requested', 'codex', 'PreToolUse', NULL, '${AT}', '${AT}',
            'normal', '{}', '{"collectorVersion":"0.1.0","sourceVersion":null}'
          )
        `),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });
});
