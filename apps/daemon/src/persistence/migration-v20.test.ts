import { describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "./database.js";
import { MIGRATIONS } from "./migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "./migrations.js";

const AT = "2026-07-27T13:30:00.000Z";

function seedVersion19Event(database: ReturnType<typeof openConfiguredDatabase>["database"]): void {
  database
    .prepare(
      `INSERT INTO workspaces (
         workspace_id, canonical_path, repository_root, git_remote,
         initial_repository_fingerprint, identity_basis, created_at, last_observed_at
       ) VALUES ('workspace-v20', '/workspace/v20', '/workspace/v20', NULL, ?,
                 'git_resolved_v1', ?, ?)`,
    )
    .run("a".repeat(64), AT, AT);
  database.exec(`
    INSERT INTO agent_conversations (
      conversation_id, workspace_id, source, source_session_id, start_mode,
      started_at, last_observed_at, ended_at, status
    ) VALUES (
      'conversation-v20', 'workspace-v20', 'codex', 'session-v20', 'startup',
      '${AT}', '${AT}', NULL, 'Active'
    );
    INSERT INTO task_runs (
      run_id, conversation_id, run_number, redacted_prompt,
      baseline_git_commit, baseline_working_tree_fingerprint,
      started_at, ended_at, status, final_git_fingerprint,
      source_stop_reason, evidence_gap_count
    ) VALUES (
      'run-v20', 'conversation-v20', 1, '[REDACTED]', NULL, NULL,
      '${AT}', NULL, 'Capturing', NULL, NULL, 0
    );
    INSERT INTO events (
      event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
      event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
      sensitivity, payload_json, metadata_json
    ) VALUES (
      'event-v19-existing', 1, 'workspace-v20', 'conversation-v20', 'run-v20', 1,
      'tool.requested', 'codex', 'PreToolUse', 'tool-v20', '${AT}', '${AT}', 'sensitive', '{}',
      '{"collectorVersion":"0.1.0","sourceVersion":"0.133.0"}'
    );
    INSERT INTO event_deduplication (
      source, source_session_id, deduplication_key, event_id, created_at
    ) VALUES (
      'codex', 'session-v20', 'v1:migration-v20:existing', 'event-v19-existing', '${AT}'
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

function insertEvent(
  database: ReturnType<typeof openConfiguredDatabase>["database"],
  eventId: string,
  sequence: number,
  eventType: string,
): void {
  database
    .prepare(
      `INSERT INTO events (
         event_id, schema_version, workspace_id, conversation_id, run_id, sequence,
         event_type, source, source_event_name, source_event_id, occurred_at, ingested_at,
         sensitivity, payload_json, metadata_json
       ) VALUES (?, 1, 'workspace-v20', 'conversation-v20', 'run-v20', ?, ?, 'codex',
                 'Fixture', NULL, ?, ?, 'normal', '{}',
                 '{"collectorVersion":"0.1.0","sourceVersion":"0.133.0"}')`,
    )
    .run(eventId, sequence, eventType, AT, AT);
}

describe("provider-neutral Event taxonomy migration v20", () => {
  it("preserves exact version-19 Events, references, indexes, triggers, and pragma state", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 19));
      seedVersion19Event(opened.database);
      const referencingTables = eventReferencingTables(opened.database);
      const eventObjects = eventSchemaObjectNames(opened.database);

      expect(() =>
        insertEvent(opened.database, "event-pre-v20", 2, "permission.requested"),
      ).toThrow();
      runMigrations(opened.database, MIGRATIONS.slice(0, 20));

      expect(readAppliedMigrations(opened.database)).toHaveLength(20);
      expect(opened.database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(opened.database.prepare("PRAGMA legacy_alter_table").get()).toEqual({
        legacy_alter_table: 0,
      });
      expect(opened.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(eventReferencingTables(opened.database)).toEqual(referencingTables);
      expect(eventSchemaObjectNames(opened.database)).toEqual(eventObjects);
      expect(opened.database.prepare("SELECT event_id, event_type FROM events").all()).toEqual([
        { event_id: "event-v19-existing", event_type: "tool.requested" },
      ]);
      expect(
        opened.database
          .prepare("SELECT event_id FROM event_deduplication WHERE event_id = ?")
          .get("event-v19-existing"),
      ).toEqual({ event_id: "event-v19-existing" });
      expect(
        opened.database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
          .get("events_v19_type_constraint"),
      ).toBeUndefined();
    } finally {
      opened.database.close();
    }
  });

  it("accepts exactly the five new source-fact types and retains append-only behavior", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 19));
      seedVersion19Event(opened.database);
      runMigrations(opened.database, MIGRATIONS.slice(0, 20));

      const newTypes = [
        "permission.requested",
        "context.compaction_started",
        "context.compaction_completed",
        "agent.subagent_started",
        "agent.subagent_stopped",
      ] as const;
      newTypes.forEach((eventType, index) => {
        insertEvent(opened.database, `event-v20-${index}`, index + 2, eventType);
      });
      expect(
        opened.database
          .prepare(
            "SELECT event_type FROM events WHERE event_id LIKE 'event-v20-%' ORDER BY sequence",
          )
          .all(),
      ).toEqual(newTypes.map((event_type) => ({ event_type })));
      expect(() =>
        insertEvent(opened.database, "event-v20-unknown", 7, "permission.approved"),
      ).toThrow();
      expect(() =>
        opened.database.exec(
          "UPDATE events SET sensitivity = 'public' WHERE event_id = 'event-v20-0'",
        ),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });
});
