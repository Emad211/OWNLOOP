export const TOOL_COMPLETION_EVENT_TAXONOMY_SQL = `
ALTER TABLE events RENAME TO events_v20_type_constraint;

CREATE TABLE events (
  event_id TEXT PRIMARY KEY CHECK (length(trim(event_id)) > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  sequence INTEGER,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'conversation.started',
    'conversation.resumed',
    'conversation.ended',
    'run.started',
    'run.stop_observed',
    'run.stop_failed',
    'run.finalization_started',
    'run.completed',
    'run.partial',
    'run.abandoned',
    'run.failed',
    'user.prompt_submitted',
    'agent.plan_observed',
    'agent.summary_observed',
    'agent.subagent_started',
    'agent.subagent_stopped',
    'permission.requested',
    'context.compaction_started',
    'context.compaction_completed',
    'tool.requested',
    'tool.completed',
    'tool.succeeded',
    'tool.failed',
    'tool.batch_completed',
    'file.read_observed',
    'file.write_requested',
    'file.created',
    'file.modified',
    'file.deleted',
    'file.change_observed',
    'command.started',
    'command.completed',
    'command.failed',
    'test.observed',
    'build.observed',
    'lint.observed',
    'typecheck.observed',
    'snapshot.baseline_captured',
    'snapshot.final_captured',
    'git.diff_computed',
    'git.commit_observed',
    'evidence.gap_detected',
    'event.duplicate_ignored',
    'event.source_unrecognized',
    'redaction.applied'
  )),
  source TEXT NOT NULL CHECK (source IN ('claude_code', 'codex', 'ownloop')),
  source_event_name TEXT
    CHECK (source_event_name IS NULL OR length(trim(source_event_name)) > 0),
  source_event_id TEXT CHECK (source_event_id IS NULL OR length(trim(source_event_id)) > 0),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
  ingested_at TEXT NOT NULL CHECK (length(trim(ingested_at)) > 0),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'normal', 'sensitive', 'secret')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  CHECK (
    (run_id IS NULL AND sequence IS NULL)
    OR (run_id IS NOT NULL AND sequence IS NOT NULL AND sequence > 0)
  ),
  FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES agent_conversations (conversation_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, conversation_id)
    REFERENCES task_runs (run_id, conversation_id) ON DELETE CASCADE
) STRICT;

INSERT INTO events SELECT * FROM events_v20_type_constraint;
DROP TABLE events_v20_type_constraint;

CREATE UNIQUE INDEX events_run_sequence_idx ON events (run_id, sequence);
CREATE INDEX events_conversation_ingested_idx
  ON events (conversation_id, ingested_at, event_id);
CREATE UNIQUE INDEX events_identity_aggregate_idx
  ON events (event_id, run_id, conversation_id, workspace_id);

CREATE TRIGGER events_reject_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;
`;
