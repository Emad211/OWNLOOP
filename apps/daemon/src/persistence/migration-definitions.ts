export type MigrationDefinition = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

const INITIAL_SCHEMA_SQL = `
CREATE TABLE ingress_receipts (
  receipt_id TEXT PRIMARY KEY CHECK (length(trim(receipt_id)) > 0),
  ingress_contract_version INTEGER NOT NULL CHECK (ingress_contract_version > 0),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_session_id TEXT NOT NULL CHECK (length(trim(source_session_id)) > 0),
  source_event_name TEXT NOT NULL CHECK (length(trim(source_event_name)) > 0),
  source_event_id TEXT CHECK (source_event_id IS NULL OR length(trim(source_event_id)) > 0),
  deduplication_key TEXT NOT NULL CHECK (length(trim(deduplication_key)) > 0),
  received_at TEXT NOT NULL CHECK (length(trim(received_at)) > 0),
  payload_fingerprint TEXT NOT NULL CHECK (length(trim(payload_fingerprint)) > 0),
  redacted_payload_json TEXT NOT NULL CHECK (json_valid(redacted_payload_json)),
  processing_status TEXT NOT NULL CHECK (processing_status IN ('pending', 'processed', 'failed')),
  processed_at TEXT CHECK (processed_at IS NULL OR length(trim(processed_at)) > 0),
  failure_code TEXT CHECK (failure_code IS NULL OR length(trim(failure_code)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0)
) STRICT;

CREATE UNIQUE INDEX ingress_receipts_source_session_deduplication_idx
  ON ingress_receipts (source, source_session_id, deduplication_key);

CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY CHECK (length(trim(workspace_id)) > 0),
  canonical_path TEXT NOT NULL CHECK (length(trim(canonical_path)) > 0),
  repository_root TEXT NOT NULL CHECK (length(trim(repository_root)) > 0),
  git_remote TEXT CHECK (git_remote IS NULL OR length(trim(git_remote)) > 0),
  initial_repository_fingerprint TEXT NOT NULL
    CHECK (length(trim(initial_repository_fingerprint)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  last_observed_at TEXT NOT NULL CHECK (length(trim(last_observed_at)) > 0)
) STRICT;

CREATE UNIQUE INDEX workspaces_canonical_path_idx ON workspaces (canonical_path);

CREATE TABLE agent_conversations (
  conversation_id TEXT PRIMARY KEY CHECK (length(trim(conversation_id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_session_id TEXT NOT NULL CHECK (length(trim(source_session_id)) > 0),
  start_mode TEXT CHECK (start_mode IS NULL OR length(trim(start_mode)) > 0),
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  last_observed_at TEXT NOT NULL CHECK (length(trim(last_observed_at)) > 0),
  ended_at TEXT CHECK (ended_at IS NULL OR length(trim(ended_at)) > 0),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  UNIQUE (conversation_id, workspace_id)
) STRICT;

CREATE UNIQUE INDEX agent_conversations_source_session_idx
  ON agent_conversations (source, source_session_id);
CREATE INDEX agent_conversations_workspace_idx ON agent_conversations (workspace_id);

CREATE TABLE task_runs (
  run_id TEXT PRIMARY KEY CHECK (length(trim(run_id)) > 0),
  conversation_id TEXT NOT NULL
    REFERENCES agent_conversations (conversation_id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL CHECK (run_number > 0),
  redacted_prompt TEXT NOT NULL,
  baseline_git_commit TEXT
    CHECK (baseline_git_commit IS NULL OR length(trim(baseline_git_commit)) > 0),
  baseline_working_tree_fingerprint TEXT
    CHECK (
      baseline_working_tree_fingerprint IS NULL
      OR length(trim(baseline_working_tree_fingerprint)) > 0
    ),
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  ended_at TEXT CHECK (ended_at IS NULL OR length(trim(ended_at)) > 0),
  status TEXT NOT NULL CHECK (
    status IN ('Capturing', 'Finalizing', 'Completed', 'Partial', 'Abandoned', 'Failed')
  ),
  final_git_fingerprint TEXT
    CHECK (final_git_fingerprint IS NULL OR length(trim(final_git_fingerprint)) > 0),
  source_stop_reason TEXT
    CHECK (source_stop_reason IS NULL OR length(trim(source_stop_reason)) > 0),
  evidence_gap_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_gap_count >= 0),
  UNIQUE (run_id, conversation_id)
) STRICT;

CREATE UNIQUE INDEX task_runs_conversation_number_idx
  ON task_runs (conversation_id, run_number);

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
    'tool.requested',
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
  source TEXT NOT NULL CHECK (source IN ('claude_code', 'ownloop')),
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

CREATE UNIQUE INDEX events_run_sequence_idx ON events (run_id, sequence);
CREATE INDEX events_conversation_ingested_idx
  ON events (conversation_id, ingested_at, event_id);

CREATE TRIGGER events_reject_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TABLE event_deduplication (
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_session_id TEXT NOT NULL CHECK (length(trim(source_session_id)) > 0),
  deduplication_key TEXT NOT NULL CHECK (length(trim(deduplication_key)) > 0),
  event_id TEXT NOT NULL REFERENCES events (event_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  PRIMARY KEY (source, source_session_id, deduplication_key)
) STRICT;

CREATE INDEX event_deduplication_event_idx ON event_deduplication (event_id);

CREATE TABLE evidence_gaps (
  gap_id TEXT PRIMARY KEY CHECK (length(trim(gap_id)) > 0),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0)
) STRICT;

CREATE INDEX evidence_gaps_run_idx ON evidence_gaps (run_id);

CREATE TABLE analysis_jobs (
  job_id TEXT PRIMARY KEY CHECK (length(trim(job_id)) > 0),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  status TEXT NOT NULL CHECK (length(trim(status)) > 0),
  input_json TEXT CHECK (input_json IS NULL OR json_valid(input_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
  last_error TEXT CHECK (last_error IS NULL OR length(trim(last_error)) > 0)
) STRICT;

CREATE INDEX analysis_jobs_run_idx ON analysis_jobs (run_id);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY CHECK (length(trim(artifact_id)) > 0),
  digest TEXT NOT NULL CHECK (length(trim(digest)) > 0),
  storage_path TEXT NOT NULL CHECK (length(trim(storage_path)) > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'normal', 'sensitive', 'secret')),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0)
) STRICT;

CREATE UNIQUE INDEX artifacts_digest_idx ON artifacts (digest);
CREATE UNIQUE INDEX artifacts_storage_path_idx ON artifacts (storage_path);

CREATE TABLE run_artifacts (
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts (artifact_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (length(trim(role)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  PRIMARY KEY (run_id, artifact_id, role)
) STRICT;

CREATE INDEX run_artifacts_artifact_idx ON run_artifacts (artifact_id);
`;

const PREPARED_INGRESS_RECEIPTS_SQL = `
ALTER TABLE ingress_receipts
  ADD COLUMN canonicalization_version INTEGER
  CHECK (canonicalization_version IS NULL OR canonicalization_version > 0);

ALTER TABLE ingress_receipts
  ADD COLUMN redaction_policy_version INTEGER
  CHECK (redaction_policy_version IS NULL OR redaction_policy_version > 0);

ALTER TABLE ingress_receipts
  ADD COLUMN adapter_version TEXT
  CHECK (adapter_version IS NULL OR length(trim(adapter_version)) > 0);

ALTER TABLE ingress_receipts
  ADD COLUMN canonical_workspace_path TEXT
  CHECK (canonical_workspace_path IS NULL OR length(trim(canonical_workspace_path)) > 0);

ALTER TABLE ingress_receipts
  ADD COLUMN redaction_summary_json TEXT
  CHECK (
    redaction_summary_json IS NULL
    OR (json_valid(redaction_summary_json) AND json_type(redaction_summary_json) = 'object')
  );

CREATE TRIGGER ingress_receipts_require_prepared_metadata_insert
BEFORE INSERT ON ingress_receipts
WHEN NEW.canonicalization_version IS NULL
  OR NEW.redaction_policy_version IS NULL
  OR NEW.adapter_version IS NULL
  OR NEW.canonical_workspace_path IS NULL
  OR NEW.redaction_summary_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'new ingress receipts require prepared metadata');
END;

CREATE TRIGGER ingress_receipts_reject_content_update
BEFORE UPDATE OF
  receipt_id,
  ingress_contract_version,
  source,
  source_session_id,
  source_event_name,
  source_event_id,
  deduplication_key,
  received_at,
  payload_fingerprint,
  redacted_payload_json,
  created_at
ON ingress_receipts
WHEN NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.ingress_contract_version IS NOT OLD.ingress_contract_version
  OR NEW.source IS NOT OLD.source
  OR NEW.source_session_id IS NOT OLD.source_session_id
  OR NEW.source_event_name IS NOT OLD.source_event_name
  OR NEW.source_event_id IS NOT OLD.source_event_id
  OR NEW.deduplication_key IS NOT OLD.deduplication_key
  OR NEW.received_at IS NOT OLD.received_at
  OR NEW.payload_fingerprint IS NOT OLD.payload_fingerprint
  OR NEW.redacted_payload_json IS NOT OLD.redacted_payload_json
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'ingress receipt content is immutable');
END;

CREATE TRIGGER ingress_receipts_prepared_metadata_consistency_update
BEFORE UPDATE OF
  canonicalization_version,
  redaction_policy_version,
  adapter_version,
  canonical_workspace_path,
  redaction_summary_json
ON ingress_receipts
WHEN NOT (
  (OLD.canonicalization_version IS NULL
    AND OLD.redaction_policy_version IS NULL
    AND OLD.adapter_version IS NULL
    AND OLD.canonical_workspace_path IS NULL
    AND OLD.redaction_summary_json IS NULL
    AND NEW.canonicalization_version IS NULL
    AND NEW.redaction_policy_version IS NULL
    AND NEW.adapter_version IS NULL
    AND NEW.canonical_workspace_path IS NULL
    AND NEW.redaction_summary_json IS NULL)
  OR
  (OLD.canonicalization_version IS NULL
    AND OLD.redaction_policy_version IS NULL
    AND OLD.adapter_version IS NULL
    AND OLD.canonical_workspace_path IS NULL
    AND OLD.redaction_summary_json IS NULL
    AND NEW.canonicalization_version IS NOT NULL
    AND NEW.redaction_policy_version IS NOT NULL
    AND NEW.adapter_version IS NOT NULL
    AND NEW.canonical_workspace_path IS NOT NULL
    AND NEW.redaction_summary_json IS NOT NULL)
  OR
  (OLD.canonicalization_version IS NOT NULL
    AND OLD.redaction_policy_version IS NOT NULL
    AND OLD.adapter_version IS NOT NULL
    AND OLD.canonical_workspace_path IS NOT NULL
    AND OLD.redaction_summary_json IS NOT NULL
    AND NEW.canonicalization_version IS OLD.canonicalization_version
    AND NEW.redaction_policy_version IS OLD.redaction_policy_version
    AND NEW.adapter_version IS OLD.adapter_version
    AND NEW.canonical_workspace_path IS OLD.canonical_workspace_path
    AND NEW.redaction_summary_json IS OLD.redaction_summary_json)
)
BEGIN
  SELECT RAISE(ABORT, 'ingress receipt preparation metadata is immutable once prepared');
END;
`;

export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  Object.freeze({
    version: 1,
    name: "initial_persistence_schema",
    sql: INITIAL_SCHEMA_SQL,
  }),
  Object.freeze({
    version: 2,
    name: "prepared_ingress_receipts",
    sql: PREPARED_INGRESS_RECEIPTS_SQL,
  }),
]);
