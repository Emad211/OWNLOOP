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

const LIFECYCLE_RESOLUTION_SQL = `
ALTER TABLE workspaces
  ADD COLUMN identity_basis TEXT NOT NULL DEFAULT 'legacy'
  CHECK (identity_basis IN ('legacy', 'canonical_path_v1', 'git_resolved_v1'));

CREATE TRIGGER agent_conversations_validate_status_insert
BEFORE INSERT ON agent_conversations
WHEN NEW.status NOT IN ('Active', 'Ended')
BEGIN
  SELECT RAISE(ABORT, 'invalid Agent Conversation status');
END;

CREATE TRIGGER agent_conversations_validate_status_update
BEFORE UPDATE OF status ON agent_conversations
WHEN NEW.status NOT IN ('Active', 'Ended')
BEGIN
  SELECT RAISE(ABORT, 'invalid Agent Conversation status');
END;

CREATE TABLE receipt_lifecycle_resolutions (
  receipt_id TEXT PRIMARY KEY
    REFERENCES ingress_receipts (receipt_id) ON DELETE CASCADE,
  workspace_id TEXT
    REFERENCES workspaces (workspace_id) ON DELETE CASCADE,
  conversation_id TEXT,
  run_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'associated', 'failed')),
  action TEXT NOT NULL CHECK (action IN (
    'conversation_started',
    'conversation_resumed',
    'conversation_inferred',
    'run_started',
    'run_associated',
    'run_finalizing',
    'conversation_ended',
    'receipt_failed'
  )),
  diagnostic_code TEXT CHECK (
    diagnostic_code IS NULL
    OR diagnostic_code IN (
      'legacy_receipt_unsupported',
      'invalid_redacted_payload',
      'conversation_workspace_conflict',
      'conversation_ended',
      'no_active_run',
      'invalid_transition',
      'lifecycle_processing_failed'
    )
  ),
  resolved_at TEXT NOT NULL CHECK (length(trim(resolved_at)) > 0),
  CHECK (
    (outcome = 'failed' AND action = 'receipt_failed' AND diagnostic_code IS NOT NULL)
    OR
    (outcome IN ('applied', 'associated') AND action <> 'receipt_failed' AND diagnostic_code IS NULL)
  ),
  CHECK (conversation_id IS NULL OR workspace_id IS NOT NULL),
  CHECK (run_id IS NULL OR conversation_id IS NOT NULL),
  CHECK (outcome = 'failed' OR (workspace_id IS NOT NULL AND conversation_id IS NOT NULL)),
  CHECK (
    (action IN ('run_started', 'run_associated', 'run_finalizing') AND run_id IS NOT NULL)
    OR
    (action NOT IN ('run_started', 'run_associated', 'run_finalizing'))
  ),
  CHECK (
    (action IN (
      'conversation_started',
      'conversation_resumed',
      'conversation_inferred',
      'conversation_ended'
    ) AND run_id IS NULL)
    OR
    (action NOT IN (
      'conversation_started',
      'conversation_resumed',
      'conversation_inferred',
      'conversation_ended'
    ))
  ),
  FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES agent_conversations (conversation_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, conversation_id)
    REFERENCES task_runs (run_id, conversation_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX receipt_lifecycle_resolutions_workspace_idx
  ON receipt_lifecycle_resolutions (workspace_id, resolved_at, receipt_id);
CREATE INDEX receipt_lifecycle_resolutions_conversation_idx
  ON receipt_lifecycle_resolutions (conversation_id, resolved_at, receipt_id);
CREATE INDEX receipt_lifecycle_resolutions_run_idx
  ON receipt_lifecycle_resolutions (run_id, resolved_at, receipt_id);

CREATE TRIGGER receipt_lifecycle_resolutions_reject_update
BEFORE UPDATE ON receipt_lifecycle_resolutions
BEGIN
  SELECT RAISE(ABORT, 'receipt lifecycle resolutions are immutable');
END;
`;

const EVENT_NORMALIZATION_SQL = `
CREATE TABLE receipt_event_normalizations (
  receipt_id TEXT PRIMARY KEY
    REFERENCES receipt_lifecycle_resolutions (receipt_id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('normalized', 'skipped', 'failed')),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  diagnostic_code TEXT CHECK (
    diagnostic_code IS NULL
    OR diagnostic_code IN (
      'lifecycle_failed',
      'legacy_receipt_unsupported',
      'invalid_redacted_payload',
      'missing_lifecycle_resolution',
      'invalid_event_mapping',
      'normalization_processing_failed'
    )
  ),
  normalized_at TEXT NOT NULL CHECK (length(trim(normalized_at)) > 0),
  CHECK (
    (outcome = 'normalized' AND event_count >= 1 AND diagnostic_code IS NULL)
    OR
    (outcome IN ('skipped', 'failed') AND event_count = 0 AND diagnostic_code IS NOT NULL)
  )
) STRICT;

CREATE TABLE receipt_normalized_events (
  receipt_id TEXT NOT NULL
    REFERENCES receipt_event_normalizations (receipt_id) ON DELETE CASCADE,
  event_index INTEGER NOT NULL CHECK (event_index >= 0),
  event_id TEXT NOT NULL UNIQUE
    REFERENCES events (event_id) ON DELETE CASCADE,
  PRIMARY KEY (receipt_id, event_index)
) STRICT;

CREATE INDEX receipt_event_normalizations_time_idx
  ON receipt_event_normalizations (normalized_at, receipt_id);

CREATE TRIGGER receipt_event_normalizations_reject_update
BEFORE UPDATE ON receipt_event_normalizations
BEGIN
  SELECT RAISE(ABORT, 'receipt event normalizations are immutable');
END;

CREATE TRIGGER receipt_normalized_events_reject_update
BEFORE UPDATE ON receipt_normalized_events
BEGIN
  SELECT RAISE(ABORT, 'receipt normalized event links are immutable');
END;
`;

const GIT_BASELINE_SQL = `
CREATE TABLE git_baselines (
  baseline_id TEXT PRIMARY KEY CHECK (length(trim(baseline_id)) > 0),
  run_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  baseline_event_id TEXT NOT NULL UNIQUE
    REFERENCES events (event_id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('captured', 'partial')),
  diagnostic_code TEXT CHECK (
    diagnostic_code IS NULL
    OR diagnostic_code IN (
      'not_a_git_repository',
      'git_executable_unavailable',
      'git_command_failed',
      'git_command_timeout',
      'git_output_limit_exceeded',
      'repository_changed_during_capture',
      'untracked_inventory_limit_exceeded',
      'untracked_entry_changed',
      'untracked_entry_unreadable',
      'late_capture',
      'baseline_processing_failed'
    )
  ),
  repository_root TEXT NOT NULL CHECK (length(trim(repository_root)) > 0),
  head_commit TEXT CHECK (
    head_commit IS NULL
    OR (
      length(head_commit) IN (40, 64)
      AND head_commit = lower(head_commit)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    )
  ),
  staged_diff_sha256 TEXT CHECK (
    staged_diff_sha256 IS NULL
    OR (
      length(staged_diff_sha256) = 64
      AND staged_diff_sha256 = lower(staged_diff_sha256)
      AND staged_diff_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  unstaged_diff_sha256 TEXT CHECK (
    unstaged_diff_sha256 IS NULL
    OR (
      length(unstaged_diff_sha256) = 64
      AND unstaged_diff_sha256 = lower(unstaged_diff_sha256)
      AND unstaged_diff_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  status_before_sha256 TEXT CHECK (
    status_before_sha256 IS NULL
    OR (
      length(status_before_sha256) = 64
      AND status_before_sha256 = lower(status_before_sha256)
      AND status_before_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  status_after_sha256 TEXT CHECK (
    status_after_sha256 IS NULL
    OR (
      length(status_after_sha256) = 64
      AND status_after_sha256 = lower(status_after_sha256)
      AND status_after_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  working_tree_fingerprint TEXT CHECK (
    working_tree_fingerprint IS NULL
    OR (
      length(working_tree_fingerprint) = 64
      AND working_tree_fingerprint = lower(working_tree_fingerprint)
      AND working_tree_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  staged_dirty INTEGER NOT NULL CHECK (staged_dirty IN (0, 1)),
  unstaged_dirty INTEGER NOT NULL CHECK (unstaged_dirty IN (0, 1)),
  untracked_count INTEGER NOT NULL CHECK (untracked_count >= 0),
  untracked_hashed_count INTEGER NOT NULL CHECK (untracked_hashed_count >= 0),
  untracked_omitted_count INTEGER NOT NULL CHECK (untracked_omitted_count >= 0),
  captured_at TEXT NOT NULL CHECK (length(trim(captured_at)) > 0),
  capture_delay_ms INTEGER NOT NULL CHECK (capture_delay_ms >= 0),
  CHECK (
    (outcome = 'captured' AND diagnostic_code IS NULL)
    OR (outcome = 'partial' AND diagnostic_code IS NOT NULL)
  ),
  CHECK (
    outcome = 'partial'
    OR (
      staged_diff_sha256 IS NOT NULL
      AND unstaged_diff_sha256 IS NOT NULL
      AND status_before_sha256 IS NOT NULL
      AND status_after_sha256 IS NOT NULL
      AND working_tree_fingerprint IS NOT NULL
    )
  ),
  CHECK (untracked_hashed_count <= untracked_count),
  CHECK (untracked_omitted_count <= untracked_count),
  CHECK (untracked_hashed_count + untracked_omitted_count = untracked_count),
  FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES agent_conversations (conversation_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, conversation_id)
    REFERENCES task_runs (run_id, conversation_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE git_baseline_untracked_entries (
  baseline_id TEXT NOT NULL
    REFERENCES git_baselines (baseline_id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
  path_identity_sha256 TEXT NOT NULL CHECK (
    length(path_identity_sha256) = 64
    AND path_identity_sha256 = lower(path_identity_sha256)
    AND path_identity_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  relative_path TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'symlink', 'directory', 'other')),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  content_sha256 TEXT CHECK (
    content_sha256 IS NULL
    OR (
      length(content_sha256) = 64
      AND content_sha256 = lower(content_sha256)
      AND content_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'secret')),
  hash_status TEXT NOT NULL CHECK (hash_status IN (
    'hashed',
    'too_large',
    'sensitive_path',
    'unreadable',
    'non_regular',
    'changed_during_capture'
  )),
  CHECK (sensitivity <> 'secret' OR relative_path IS NULL),
  CHECK (hash_status <> 'sensitive_path' OR (sensitivity = 'secret' AND content_sha256 IS NULL)),
  CHECK (hash_status <> 'hashed' OR content_sha256 IS NOT NULL),
  PRIMARY KEY (baseline_id, entry_index)
) STRICT;

CREATE INDEX git_baselines_workspace_time_idx
  ON git_baselines (workspace_id, captured_at, baseline_id);
CREATE INDEX git_baselines_conversation_idx
  ON git_baselines (conversation_id, captured_at, baseline_id);
CREATE INDEX git_baseline_untracked_path_identity_idx
  ON git_baseline_untracked_entries (path_identity_sha256, baseline_id);

CREATE TRIGGER git_baselines_reject_update
BEFORE UPDATE ON git_baselines
BEGIN
  SELECT RAISE(ABORT, 'Git baselines are immutable');
END;

CREATE TRIGGER git_baseline_untracked_entries_reject_update
BEFORE UPDATE ON git_baseline_untracked_entries
BEGIN
  SELECT RAISE(ABORT, 'Git baseline untracked entries are immutable');
END;
`;

const GIT_RECONCILIATION_SQL = `
CREATE UNIQUE INDEX events_identity_aggregate_idx
  ON events (event_id, run_id, conversation_id, workspace_id);
CREATE UNIQUE INDEX git_baselines_identity_aggregate_idx
  ON git_baselines (baseline_id, run_id, conversation_id, workspace_id);

CREATE TABLE git_reconciliations (
  reconciliation_id TEXT PRIMARY KEY CHECK (length(trim(reconciliation_id)) > 0),
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  baseline_id TEXT,
  trigger_event_id TEXT NOT NULL UNIQUE,
  summary_event_id TEXT NOT NULL UNIQUE,
  boundary TEXT NOT NULL CHECK (boundary IN ('tool_batch', 'stop', 'stop_failure')),
  outcome TEXT NOT NULL CHECK (outcome IN ('captured', 'partial')),
  diagnostic_code TEXT CHECK (
    diagnostic_code IS NULL OR diagnostic_code IN (
      'baseline_missing',
      'baseline_partial',
      'not_a_git_repository',
      'git_executable_unavailable',
      'git_command_failed',
      'git_command_timeout',
      'git_output_limit_exceeded',
      'repository_changed_during_capture',
      'untracked_inventory_limit_exceeded',
      'untracked_entry_changed',
      'untracked_entry_unreadable',
      'invalid_status_output',
      'status_entry_limit_exceeded',
      'invalid_trigger_event',
      'reconciliation_processing_failed'
    )
  ),
  attribution TEXT NOT NULL CHECK (
    attribution IN ('run_relative', 'observed_only', 'unavailable')
  ),
  baseline_comparison TEXT NOT NULL CHECK (
    baseline_comparison IN ('unchanged', 'changed', 'unavailable')
  ),
  repository_root TEXT NOT NULL CHECK (length(trim(repository_root)) > 0),
  head_commit TEXT CHECK (
    head_commit IS NULL OR (
      length(head_commit) IN (40, 64)
      AND head_commit = lower(head_commit)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    )
  ),
  staged_diff_sha256 TEXT CHECK (
    staged_diff_sha256 IS NULL OR (
      length(staged_diff_sha256) = 64
      AND staged_diff_sha256 = lower(staged_diff_sha256)
      AND staged_diff_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  unstaged_diff_sha256 TEXT CHECK (
    unstaged_diff_sha256 IS NULL OR (
      length(unstaged_diff_sha256) = 64
      AND unstaged_diff_sha256 = lower(unstaged_diff_sha256)
      AND unstaged_diff_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  status_before_sha256 TEXT CHECK (
    status_before_sha256 IS NULL OR (
      length(status_before_sha256) = 64
      AND status_before_sha256 = lower(status_before_sha256)
      AND status_before_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  status_after_sha256 TEXT CHECK (
    status_after_sha256 IS NULL OR (
      length(status_after_sha256) = 64
      AND status_after_sha256 = lower(status_after_sha256)
      AND status_after_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  working_tree_fingerprint TEXT CHECK (
    working_tree_fingerprint IS NULL OR (
      length(working_tree_fingerprint) = 64
      AND working_tree_fingerprint = lower(working_tree_fingerprint)
      AND working_tree_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  staged_dirty INTEGER NOT NULL CHECK (staged_dirty IN (0, 1)),
  unstaged_dirty INTEGER NOT NULL CHECK (unstaged_dirty IN (0, 1)),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  created_count INTEGER NOT NULL CHECK (created_count >= 0),
  modified_count INTEGER NOT NULL CHECK (modified_count >= 0),
  deleted_count INTEGER NOT NULL CHECK (deleted_count >= 0),
  type_changed_count INTEGER NOT NULL CHECK (type_changed_count >= 0),
  unmerged_count INTEGER NOT NULL CHECK (unmerged_count >= 0),
  captured_at TEXT NOT NULL CHECK (length(trim(captured_at)) > 0),
  CHECK (
    (outcome = 'captured' AND diagnostic_code IS NULL)
    OR (outcome = 'partial' AND diagnostic_code IS NOT NULL)
  ),
  CHECK (
    (outcome = 'captured' AND attribution <> 'unavailable' AND baseline_comparison <> 'unavailable')
    OR (outcome = 'partial' AND attribution = 'unavailable' AND baseline_comparison = 'unavailable')
  ),
  CHECK (trigger_event_id <> summary_event_id),
  CHECK (entry_count <= 2000),
  CHECK (baseline_comparison <> 'unchanged' OR entry_count = 0),
  CHECK (
    entry_count = created_count + modified_count + deleted_count
      + type_changed_count + unmerged_count
  ),
  FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES agent_conversations (conversation_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, conversation_id)
    REFERENCES task_runs (run_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (baseline_id, run_id, conversation_id, workspace_id)
    REFERENCES git_baselines (baseline_id, run_id, conversation_id, workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (trigger_event_id, run_id, conversation_id, workspace_id)
    REFERENCES events (event_id, run_id, conversation_id, workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (summary_event_id, run_id, conversation_id, workspace_id)
    REFERENCES events (event_id, run_id, conversation_id, workspace_id)
    ON DELETE CASCADE
) STRICT;

CREATE TABLE git_reconciliation_entries (
  reconciliation_id TEXT NOT NULL
    REFERENCES git_reconciliations (reconciliation_id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
  file_event_id TEXT NOT NULL UNIQUE
    REFERENCES events (event_id) ON DELETE CASCADE,
  path_identity_sha256 TEXT NOT NULL CHECK (
    length(path_identity_sha256) = 64
    AND path_identity_sha256 = lower(path_identity_sha256)
    AND path_identity_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  relative_path TEXT CHECK (
    relative_path IS NULL OR (
      length(relative_path) > 0
      AND instr(relative_path, char(0)) = 0
    )
  ),
  change_kind TEXT NOT NULL CHECK (
    change_kind IN ('created', 'modified', 'deleted', 'type_changed', 'unmerged')
  ),
  staged INTEGER NOT NULL CHECK (staged IN (0, 1)),
  unstaged INTEGER NOT NULL CHECK (unstaged IN (0, 1)),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'secret')),
  attribution TEXT NOT NULL CHECK (
    attribution IN ('run_relative', 'observed_only', 'unavailable')
  ),
  CHECK (
    (sensitivity = 'secret' AND relative_path IS NULL)
    OR (sensitivity = 'normal' AND relative_path IS NOT NULL)
  ),
  PRIMARY KEY (reconciliation_id, entry_index)
) STRICT;

CREATE INDEX git_reconciliations_run_time_idx
  ON git_reconciliations (run_id, captured_at, reconciliation_id);
CREATE INDEX git_reconciliations_workspace_time_idx
  ON git_reconciliations (workspace_id, captured_at, reconciliation_id);
CREATE INDEX git_reconciliation_entries_path_idx
  ON git_reconciliation_entries (path_identity_sha256, reconciliation_id);

CREATE TRIGGER git_reconciliations_reject_update
BEFORE UPDATE ON git_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'Git reconciliations are immutable');
END;

CREATE TRIGGER git_reconciliation_entries_reject_update
BEFORE UPDATE ON git_reconciliation_entries
BEGIN
  SELECT RAISE(ABORT, 'Git reconciliation entries are immutable');
END;
`;

const CONTENT_ADDRESSED_ARTIFACT_STORE_SQL = `
ALTER TABLE artifacts
  ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 0
  CHECK (storage_version IN (0, 1));

ALTER TABLE artifacts
  ADD COLUMN media_type TEXT
  CHECK (media_type IS NULL OR length(trim(media_type)) > 0);

CREATE INDEX artifacts_storage_version_created_idx
  ON artifacts (storage_version, created_at, artifact_id);

CREATE TRIGGER artifacts_v1_insert_guard
BEFORE INSERT ON artifacts
WHEN NEW.storage_version = 1
BEGIN
  SELECT CASE
    WHEN length(NEW.digest) <> 71
      OR substr(NEW.digest, 1, 7) <> 'sha256:'
      OR substr(NEW.digest, 8) <> lower(substr(NEW.digest, 8))
      OR substr(NEW.digest, 8) GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'invalid version-1 artifact digest')
  END;
  SELECT CASE
    WHEN NEW.storage_path <> (
      'objects/sha256/' || substr(NEW.digest, 8, 2) || '/' || substr(NEW.digest, 10, 62)
    )
    THEN RAISE(ABORT, 'invalid version-1 artifact path')
  END;
  SELECT CASE
    WHEN NEW.media_type IS NULL OR length(trim(NEW.media_type)) = 0
    THEN RAISE(ABORT, 'version-1 artifact media type is required')
  END;
END;

CREATE TRIGGER artifacts_v1_update_guard
BEFORE UPDATE ON artifacts
WHEN NEW.storage_version = 1
BEGIN
  SELECT CASE
    WHEN length(NEW.digest) <> 71
      OR substr(NEW.digest, 1, 7) <> 'sha256:'
      OR substr(NEW.digest, 8) <> lower(substr(NEW.digest, 8))
      OR substr(NEW.digest, 8) GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'invalid version-1 artifact digest')
  END;
  SELECT CASE
    WHEN NEW.storage_path <> (
      'objects/sha256/' || substr(NEW.digest, 8, 2) || '/' || substr(NEW.digest, 10, 62)
    )
    THEN RAISE(ABORT, 'invalid version-1 artifact path')
  END;
  SELECT CASE
    WHEN NEW.media_type IS NULL OR length(trim(NEW.media_type)) = 0
    THEN RAISE(ABORT, 'version-1 artifact media type is required')
  END;
END;

CREATE TRIGGER artifacts_v1_identity_reject_update
BEFORE UPDATE OF artifact_id, digest, storage_path, size_bytes, kind, storage_version, media_type, created_at
ON artifacts
WHEN OLD.storage_version = 1 OR NEW.storage_version = 1
BEGIN
  SELECT RAISE(ABORT, 'version-1 artifact identity is immutable');
END;

CREATE TRIGGER artifacts_sensitivity_reject_downgrade
BEFORE UPDATE OF sensitivity ON artifacts
WHEN (
  CASE NEW.sensitivity
    WHEN 'public' THEN 0
    WHEN 'normal' THEN 1
    WHEN 'sensitive' THEN 2
    WHEN 'secret' THEN 3
  END
) < (
  CASE OLD.sensitivity
    WHEN 'public' THEN 0
    WHEN 'normal' THEN 1
    WHEN 'sensitive' THEN 2
    WHEN 'secret' THEN 3
  END
)
BEGIN
  SELECT RAISE(ABORT, 'artifact sensitivity cannot be downgraded');
END;

CREATE TRIGGER run_artifacts_reject_update
BEFORE UPDATE ON run_artifacts
BEGIN
  SELECT RAISE(ABORT, 'Run artifact references are immutable');
END;
`;

const RUN_FINALIZATION_SQL = `
CREATE TABLE run_finalizations (
  finalization_id TEXT PRIMARY KEY CHECK (length(trim(finalization_id)) > 0),
  run_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  terminal_status TEXT NOT NULL CHECK (terminal_status IN ('Completed', 'Partial', 'Abandoned', 'Failed')),
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'recovery')),
  trigger_event_id TEXT REFERENCES events (event_id),
  reconciliation_id TEXT REFERENCES git_reconciliations (reconciliation_id),
  manifest_artifact_id TEXT REFERENCES artifacts (artifact_id),
  final_fingerprint TEXT CHECK (
    final_fingerprint IS NULL OR (
      length(final_fingerprint) = 64
      AND final_fingerprint = lower(final_fingerprint)
      AND final_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  final_snapshot_event_id TEXT UNIQUE REFERENCES events (event_id),
  terminal_event_id TEXT NOT NULL UNIQUE REFERENCES events (event_id),
  diagnostic_code TEXT CHECK (diagnostic_code IS NULL OR diagnostic_code IN (
    'baseline_missing',
    'baseline_partial',
    'final_reconciliation_missing',
    'final_reconciliation_partial',
    'final_fingerprint_missing',
    'manifest_unavailable',
    'existing_evidence_gaps',
    'source_stop_failure',
    'stale_capturing_recovered',
    'stale_finalizing_recovered',
    'finalization_processing_failed'
  )),
  finalized_at TEXT NOT NULL CHECK (length(trim(finalized_at)) > 0),
  generator_version TEXT NOT NULL CHECK (length(trim(generator_version)) > 0),
  CHECK ((reconciliation_id IS NULL) = (final_snapshot_event_id IS NULL)),
  CHECK (manifest_artifact_id IS NULL OR reconciliation_id IS NOT NULL),
  CHECK (final_fingerprint IS NULL OR reconciliation_id IS NOT NULL),
  CHECK (
    (terminal_status = 'Completed' AND mode = 'normal' AND diagnostic_code IS NULL
      AND trigger_event_id IS NOT NULL AND reconciliation_id IS NOT NULL
      AND manifest_artifact_id IS NOT NULL AND final_fingerprint IS NOT NULL
      AND final_snapshot_event_id IS NOT NULL)
    OR
    (terminal_status = 'Partial' AND diagnostic_code IS NOT NULL)
    OR
    (terminal_status = 'Failed' AND mode = 'normal'
      AND diagnostic_code = 'source_stop_failure' AND trigger_event_id IS NOT NULL)
    OR
    (terminal_status = 'Abandoned' AND mode = 'recovery'
      AND diagnostic_code = 'stale_capturing_recovered'
      AND trigger_event_id IS NULL AND reconciliation_id IS NULL
      AND manifest_artifact_id IS NULL AND final_fingerprint IS NULL
      AND final_snapshot_event_id IS NULL)
  ),
  FOREIGN KEY (run_id, conversation_id)
    REFERENCES task_runs (run_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES agent_conversations (conversation_id, workspace_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX run_finalizations_finalized_idx
  ON run_finalizations (finalized_at, run_id);

CREATE TRIGGER run_finalizations_validate_insert
BEFORE INSERT ON run_finalizations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = NEW.terminal_event_id
      AND e.source = 'ownloop'
      AND e.run_id = NEW.run_id
      AND e.conversation_id = NEW.conversation_id
      AND e.workspace_id = NEW.workspace_id
      AND e.event_type = CASE NEW.terminal_status
        WHEN 'Completed' THEN 'run.completed'
        WHEN 'Partial' THEN 'run.partial'
        WHEN 'Failed' THEN 'run.failed'
        WHEN 'Abandoned' THEN 'run.abandoned'
      END
  ) THEN RAISE(ABORT, 'invalid finalization terminal Event') END;

  SELECT CASE WHEN NEW.final_snapshot_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = NEW.final_snapshot_event_id
      AND e.event_type = 'snapshot.final_captured'
      AND e.source = 'ownloop'
      AND e.run_id = NEW.run_id
      AND e.conversation_id = NEW.conversation_id
      AND e.workspace_id = NEW.workspace_id
  ) THEN RAISE(ABORT, 'invalid finalization snapshot Event') END;

  SELECT CASE WHEN NEW.final_snapshot_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events snapshot, events terminal
    WHERE snapshot.event_id = NEW.final_snapshot_event_id
      AND terminal.event_id = NEW.terminal_event_id
      AND terminal.sequence = snapshot.sequence + 1
      AND (snapshot.sequence = 1 OR EXISTS (
        SELECT 1 FROM events previous
        WHERE previous.run_id = NEW.run_id AND previous.sequence = snapshot.sequence - 1
      ))
  ) THEN RAISE(ABORT, 'invalid finalization Event order') END;

  SELECT CASE WHEN NEW.final_snapshot_event_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM events terminal
    WHERE terminal.event_id = NEW.terminal_event_id
      AND (terminal.sequence = 1 OR EXISTS (
        SELECT 1 FROM events previous
        WHERE previous.run_id = NEW.run_id AND previous.sequence = terminal.sequence - 1
      ))
  ) THEN RAISE(ABORT, 'invalid finalization terminal sequence') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM event_deduplication ed
    WHERE ed.event_id = NEW.terminal_event_id
      AND ed.source = 'ownloop'
      AND ed.source_session_id = NEW.conversation_id
      AND ed.deduplication_key = ('v1:run-finalization:' || NEW.run_id || ':terminal')
  ) THEN RAISE(ABORT, 'missing finalization terminal deduplication') END;

  SELECT CASE WHEN NEW.final_snapshot_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_deduplication ed
    WHERE ed.event_id = NEW.final_snapshot_event_id
      AND ed.source = 'ownloop'
      AND ed.source_session_id = NEW.conversation_id
      AND ed.deduplication_key = ('v1:run-finalization:' || NEW.run_id || ':snapshot')
  ) THEN RAISE(ABORT, 'missing finalization snapshot deduplication') END;

  SELECT CASE WHEN NEW.trigger_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = NEW.trigger_event_id
      AND e.run_id = NEW.run_id
      AND e.event_type IN ('run.stop_observed', 'run.stop_failed')
  ) THEN RAISE(ABORT, 'invalid finalization trigger Event') END;

  SELECT CASE WHEN NEW.terminal_status = 'Completed' AND NOT EXISTS (
    SELECT 1 FROM git_baselines gb
    WHERE gb.run_id = NEW.run_id AND gb.outcome = 'captured'
  ) THEN RAISE(ABORT, 'Completed finalization requires captured baseline') END;

  SELECT CASE WHEN NEW.terminal_status = 'Completed' AND NOT EXISTS (
    SELECT 1 FROM task_runs tr
    WHERE tr.run_id = NEW.run_id AND tr.evidence_gap_count = 0
  ) THEN RAISE(ABORT, 'Completed finalization requires zero evidence gaps') END;

  SELECT CASE WHEN NEW.terminal_status = 'Completed' AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = NEW.trigger_event_id AND e.event_type = 'run.stop_observed'
  ) THEN RAISE(ABORT, 'Completed finalization requires normal Stop') END;

  SELECT CASE WHEN NEW.terminal_status = 'Failed' AND NOT EXISTS (
    SELECT 1 FROM events e
    WHERE e.event_id = NEW.trigger_event_id AND e.event_type = 'run.stop_failed'
  ) THEN RAISE(ABORT, 'Failed finalization requires StopFailure') END;

  SELECT CASE WHEN NEW.reconciliation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM git_reconciliations gr
    WHERE gr.reconciliation_id = NEW.reconciliation_id
      AND gr.run_id = NEW.run_id
      AND gr.trigger_event_id IS NEW.trigger_event_id
      AND (NEW.final_fingerprint IS NULL OR gr.working_tree_fingerprint = NEW.final_fingerprint)
      AND (NEW.terminal_status <> 'Completed' OR gr.outcome = 'captured')
  ) THEN RAISE(ABORT, 'invalid finalization reconciliation') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM task_runs tr
    WHERE tr.run_id = NEW.run_id
      AND tr.status = NEW.terminal_status
      AND tr.ended_at = NEW.finalized_at
      AND tr.final_git_fingerprint IS NEW.final_fingerprint
  ) THEN RAISE(ABORT, 'invalid finalization Run state') END;

  SELECT CASE WHEN NEW.manifest_artifact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM artifacts a
    JOIN run_artifacts ra ON ra.artifact_id = a.artifact_id
    WHERE a.artifact_id = NEW.manifest_artifact_id
      AND a.kind = 'final-diff-manifest-v1'
      AND a.storage_version = 1
      AND a.media_type = 'application/vnd.ownloop.final-diff+json'
      AND ra.run_id = NEW.run_id
      AND ra.role = 'final-diff-manifest-v1'
  ) THEN RAISE(ABORT, 'invalid finalization manifest artifact') END;
END;

CREATE TRIGGER run_finalizations_reject_update
BEFORE UPDATE ON run_finalizations
BEGIN
  SELECT RAISE(ABORT, 'Run finalizations are immutable');
END;
`;

const RUN_FINALIZATION_INVARIANTS_SQL = `
CREATE TABLE run_finalization_v9_validation (
  finalization_id TEXT PRIMARY KEY,
  terminal_status TEXT NOT NULL,
  mode TEXT NOT NULL,
  diagnostic_code TEXT,
  CHECK (COALESCE(
    (terminal_status = 'Completed' AND mode = 'normal' AND diagnostic_code IS NULL)
    OR
    (terminal_status = 'Partial' AND mode = 'normal' AND diagnostic_code IN (
      'baseline_missing',
      'baseline_partial',
      'final_reconciliation_missing',
      'final_reconciliation_partial',
      'final_fingerprint_missing',
      'manifest_unavailable',
      'existing_evidence_gaps',
      'finalization_processing_failed'
    ))
    OR
    (terminal_status = 'Partial' AND mode = 'recovery'
      AND diagnostic_code = 'stale_finalizing_recovered')
    OR
    (terminal_status = 'Failed' AND mode = 'normal'
      AND diagnostic_code = 'source_stop_failure')
    OR
    (terminal_status = 'Abandoned' AND mode = 'recovery'
      AND diagnostic_code = 'stale_capturing_recovered'),
    0
  ) = 1)
) STRICT;

INSERT INTO run_finalization_v9_validation (
  finalization_id, terminal_status, mode, diagnostic_code
)
SELECT finalization_id, terminal_status, mode, diagnostic_code
FROM run_finalizations;

DROP TABLE run_finalization_v9_validation;

CREATE TRIGGER run_finalizations_validate_mode_diagnostic_v9
BEFORE INSERT ON run_finalizations
WHEN COALESCE(
  (NEW.terminal_status = 'Completed' AND NEW.mode = 'normal' AND NEW.diagnostic_code IS NULL)
  OR
  (NEW.terminal_status = 'Partial' AND NEW.mode = 'normal' AND NEW.diagnostic_code IN (
    'baseline_missing',
    'baseline_partial',
    'final_reconciliation_missing',
    'final_reconciliation_partial',
    'final_fingerprint_missing',
    'manifest_unavailable',
    'existing_evidence_gaps',
    'finalization_processing_failed'
  ))
  OR
  (NEW.terminal_status = 'Partial' AND NEW.mode = 'recovery'
    AND NEW.diagnostic_code = 'stale_finalizing_recovered')
  OR
  (NEW.terminal_status = 'Failed' AND NEW.mode = 'normal'
    AND NEW.diagnostic_code = 'source_stop_failure')
  OR
  (NEW.terminal_status = 'Abandoned' AND NEW.mode = 'recovery'
    AND NEW.diagnostic_code = 'stale_capturing_recovered'),
  0
) = 0
BEGIN
  SELECT RAISE(ABORT, 'invalid Run finalization mode/diagnostic combination');
END;
`;

const RUN_FINALIZATION_EVIDENCE_CONTINUITY_SQL = `
CREATE TABLE run_finalization_v10_validation (
  finalization_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO run_finalization_v10_validation (finalization_id, valid)
SELECT rf.finalization_id,
       CASE WHEN
         EXISTS (
           SELECT 1 FROM events terminal
           WHERE terminal.event_id = rf.terminal_event_id
             AND terminal.sequence > 0
             AND (
               SELECT count(*) FROM events existing
               WHERE existing.run_id = rf.run_id
                 AND existing.sequence <= terminal.sequence
             ) = terminal.sequence
             AND (
               SELECT min(existing.sequence) FROM events existing
               WHERE existing.run_id = rf.run_id
                 AND existing.sequence <= terminal.sequence
             ) = 1
             AND (
               SELECT max(existing.sequence) FROM events existing
               WHERE existing.run_id = rf.run_id
                 AND existing.sequence <= terminal.sequence
             ) = terminal.sequence
         )
         AND EXISTS (
           SELECT 1 FROM task_runs tr
           WHERE tr.run_id = rf.run_id
             AND tr.evidence_gap_count = (
               SELECT count(*) FROM evidence_gaps eg WHERE eg.run_id = rf.run_id
             )
             AND (
               (rf.terminal_status = 'Completed' AND tr.evidence_gap_count = 0)
               OR
               (rf.terminal_status <> 'Completed' AND tr.evidence_gap_count > 0)
             )
         )
         AND (
           (rf.trigger_event_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM events stop
             WHERE stop.run_id = rf.run_id
               AND stop.event_type IN ('run.stop_observed', 'run.stop_failed')
           ))
           OR
           (rf.trigger_event_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM events trigger
             WHERE trigger.event_id = rf.trigger_event_id
               AND trigger.run_id = rf.run_id
               AND trigger.event_type IN ('run.stop_observed', 'run.stop_failed')
               AND NOT EXISTS (
                 SELECT 1 FROM events later
                 WHERE later.run_id = rf.run_id
                   AND later.event_type IN ('run.stop_observed', 'run.stop_failed')
                   AND later.sequence > trigger.sequence
               )
           ))
         )
       THEN 1 ELSE 0 END
FROM run_finalizations rf;

DROP TABLE run_finalization_v10_validation;

CREATE TRIGGER run_finalizations_validate_evidence_continuity_v10
BEFORE INSERT ON run_finalizations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM events terminal
    WHERE terminal.event_id = NEW.terminal_event_id
      AND terminal.sequence > 0
      AND (
        SELECT count(*) FROM events existing
        WHERE existing.run_id = NEW.run_id
          AND existing.sequence <= terminal.sequence
      ) = terminal.sequence
      AND (
        SELECT min(existing.sequence) FROM events existing
        WHERE existing.run_id = NEW.run_id
          AND existing.sequence <= terminal.sequence
      ) = 1
      AND (
        SELECT max(existing.sequence) FROM events existing
        WHERE existing.run_id = NEW.run_id
          AND existing.sequence <= terminal.sequence
      ) = terminal.sequence
  ) THEN RAISE(ABORT, 'non-contiguous Run finalization Event history') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM task_runs tr
    WHERE tr.run_id = NEW.run_id
      AND tr.evidence_gap_count = (
        SELECT count(*) FROM evidence_gaps eg WHERE eg.run_id = NEW.run_id
      )
      AND (
        (NEW.terminal_status = 'Completed' AND tr.evidence_gap_count = 0)
        OR
        (NEW.terminal_status <> 'Completed' AND tr.evidence_gap_count > 0)
      )
  ) THEN RAISE(ABORT, 'invalid Run finalization evidence state') END;

  SELECT CASE WHEN NEW.trigger_event_id IS NULL AND EXISTS (
    SELECT 1 FROM events stop
    WHERE stop.run_id = NEW.run_id
      AND stop.event_type IN ('run.stop_observed', 'run.stop_failed')
  ) THEN RAISE(ABORT, 'Run finalization omitted an available Stop boundary') END;

  SELECT CASE WHEN NEW.trigger_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events trigger
    WHERE trigger.event_id = NEW.trigger_event_id
      AND trigger.run_id = NEW.run_id
      AND trigger.event_type IN ('run.stop_observed', 'run.stop_failed')
      AND NOT EXISTS (
        SELECT 1 FROM events later
        WHERE later.run_id = NEW.run_id
          AND later.event_type IN ('run.stop_observed', 'run.stop_failed')
          AND later.sequence > trigger.sequence
      )
  ) THEN RAISE(ABORT, 'Run finalization trigger is not the latest Stop boundary') END;
END;
`;

const DETERMINISTIC_CHANGE_CLASSIFICATION_ARTIFACT_SQL = `
CREATE TABLE deterministic_change_classification_v11_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO deterministic_change_classification_v11_validation (valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    LEFT JOIN artifacts a ON a.artifact_id = ra.artifact_id
    LEFT JOIN run_finalizations rf ON rf.run_id = ra.run_id
    LEFT JOIN task_runs tr ON tr.run_id = ra.run_id
    WHERE ra.role = 'deterministic-change-classification-v1'
      AND (
        a.artifact_id IS NULL
        OR a.storage_version <> 1
        OR a.kind <> 'deterministic-change-classification-v1'
        OR a.media_type <> 'application/vnd.ownloop.change-classification+json'
        OR a.sensitivity <> 'sensitive'
        OR a.size_bytes > 2097152
        OR rf.run_id IS NULL
        OR tr.status NOT IN ('Completed', 'Partial', 'Abandoned', 'Failed')
      )
  )
  AND NOT EXISTS (
    SELECT ra.run_id
    FROM run_artifacts ra
    WHERE ra.role = 'deterministic-change-classification-v1'
    GROUP BY ra.run_id
    HAVING count(*) > 1
  )
THEN 1 ELSE 0 END;

DROP TABLE deterministic_change_classification_v11_validation;

CREATE UNIQUE INDEX run_artifacts_deterministic_change_classification_v1_unique
ON run_artifacts (run_id)
WHERE role = 'deterministic-change-classification-v1';

CREATE TRIGGER run_artifacts_validate_deterministic_change_classification_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role = 'deterministic-change-classification-v1'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.artifact_id
      AND a.storage_version = 1
      AND a.kind = 'deterministic-change-classification-v1'
      AND a.media_type = 'application/vnd.ownloop.change-classification+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes <= 2097152
  ) THEN RAISE(ABORT, 'invalid deterministic change classification artifact metadata') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.run_id = NEW.run_id
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'deterministic change classification requires a finalized Run') END;
END;

CREATE TRIGGER artifacts_preserve_deterministic_change_classification_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'deterministic-change-classification-v1'
  AND OLD.media_type = 'application/vnd.ownloop.change-classification+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'deterministic change classification sensitivity is immutable');
END;
`;

const DETERMINISTIC_VERIFICATION_EVIDENCE_ARTIFACT_SQL = `
CREATE TABLE deterministic_verification_evidence_v12_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO deterministic_verification_evidence_v12_validation (valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    LEFT JOIN artifacts a ON a.artifact_id = ra.artifact_id
    LEFT JOIN run_finalizations rf ON rf.run_id = ra.run_id
    LEFT JOIN task_runs tr ON tr.run_id = ra.run_id
    WHERE ra.role = 'deterministic-verification-evidence-v1'
      AND (
        a.artifact_id IS NULL
        OR a.storage_version <> 1
        OR a.kind <> 'deterministic-verification-evidence-v1'
        OR a.media_type <> 'application/vnd.ownloop.verification-evidence+json'
        OR a.sensitivity <> 'sensitive'
        OR a.size_bytes > 2097152
        OR rf.run_id IS NULL
        OR tr.status NOT IN ('Completed', 'Partial', 'Abandoned', 'Failed')
      )
  )
  AND NOT EXISTS (
    SELECT ra.run_id
    FROM run_artifacts ra
    WHERE ra.role = 'deterministic-verification-evidence-v1'
    GROUP BY ra.run_id
    HAVING count(*) > 1
  )
THEN 1 ELSE 0 END;

DROP TABLE deterministic_verification_evidence_v12_validation;

CREATE UNIQUE INDEX run_artifacts_deterministic_verification_evidence_v1_unique
ON run_artifacts (run_id)
WHERE role = 'deterministic-verification-evidence-v1';

CREATE TRIGGER run_artifacts_validate_deterministic_verification_evidence_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role = 'deterministic-verification-evidence-v1'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.artifact_id
      AND a.storage_version = 1
      AND a.kind = 'deterministic-verification-evidence-v1'
      AND a.media_type = 'application/vnd.ownloop.verification-evidence+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes <= 2097152
  ) THEN RAISE(ABORT, 'invalid deterministic verification evidence artifact metadata') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.run_id = NEW.run_id
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'deterministic verification evidence requires a finalized Run') END;
END;

CREATE TRIGGER artifacts_preserve_deterministic_verification_evidence_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'deterministic-verification-evidence-v1'
  AND OLD.media_type = 'application/vnd.ownloop.verification-evidence+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'deterministic verification evidence sensitivity is immutable');
END;
`;

const DETERMINISTIC_EVIDENCE_GRAPH_ARTIFACT_SQL = `
CREATE TABLE deterministic_evidence_graph_v13_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO deterministic_evidence_graph_v13_validation (valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    LEFT JOIN artifacts a ON a.artifact_id = ra.artifact_id
    LEFT JOIN run_finalizations rf ON rf.run_id = ra.run_id
    LEFT JOIN task_runs tr ON tr.run_id = ra.run_id
    WHERE ra.role = 'deterministic-evidence-graph-v1'
      AND (
        a.artifact_id IS NULL
        OR a.storage_version <> 1
        OR a.kind <> 'deterministic-evidence-graph-v1'
        OR a.media_type <> 'application/vnd.ownloop.evidence-graph+json'
        OR a.sensitivity <> 'sensitive'
        OR a.size_bytes > 8388608
        OR rf.run_id IS NULL
        OR tr.status NOT IN ('Completed', 'Partial', 'Abandoned', 'Failed')
      )
  )
  AND NOT EXISTS (
    SELECT ra.run_id
    FROM run_artifacts ra
    WHERE ra.role = 'deterministic-evidence-graph-v1'
    GROUP BY ra.run_id
    HAVING count(*) > 1
  )
THEN 1 ELSE 0 END;

DROP TABLE deterministic_evidence_graph_v13_validation;

CREATE UNIQUE INDEX run_artifacts_deterministic_evidence_graph_v1_unique
ON run_artifacts (run_id)
WHERE role = 'deterministic-evidence-graph-v1';

CREATE TRIGGER run_artifacts_validate_deterministic_evidence_graph_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role = 'deterministic-evidence-graph-v1'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.artifact_id
      AND a.storage_version = 1
      AND a.kind = 'deterministic-evidence-graph-v1'
      AND a.media_type = 'application/vnd.ownloop.evidence-graph+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes <= 8388608
  ) THEN RAISE(ABORT, 'invalid deterministic evidence graph artifact metadata') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.run_id = NEW.run_id
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'deterministic evidence graph requires a finalized Run') END;
END;

CREATE TRIGGER artifacts_preserve_deterministic_evidence_graph_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'deterministic-evidence-graph-v1'
  AND OLD.media_type = 'application/vnd.ownloop.evidence-graph+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'deterministic evidence graph sensitivity is immutable');
END;
`;

const REDUCED_SEMANTIC_ANALYSIS_INPUT_ARTIFACT_SQL = `
CREATE TABLE reduced_semantic_analysis_input_v14_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO reduced_semantic_analysis_input_v14_validation (valid)
SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    LEFT JOIN artifacts a ON a.artifact_id = ra.artifact_id
    LEFT JOIN run_finalizations rf ON rf.run_id = ra.run_id
    LEFT JOIN task_runs tr ON tr.run_id = ra.run_id
    WHERE ra.role = 'reduced-semantic-analysis-input-v1'
      AND (
        a.artifact_id IS NULL
        OR a.storage_version <> 1
        OR a.kind <> 'reduced-semantic-analysis-input-v1'
        OR a.media_type <> 'application/vnd.ownloop.semantic-analysis-input+json'
        OR a.sensitivity <> 'sensitive'
        OR a.size_bytes <= 0
        OR a.size_bytes > 524288
        OR rf.run_id IS NULL
        OR tr.status NOT IN ('Completed', 'Partial', 'Abandoned', 'Failed')
      )
  )
  AND NOT EXISTS (
    SELECT ra.run_id
    FROM run_artifacts ra
    WHERE ra.role = 'reduced-semantic-analysis-input-v1'
    GROUP BY ra.run_id
    HAVING count(*) > 1
  )
THEN 1 ELSE 0 END;

DROP TABLE reduced_semantic_analysis_input_v14_validation;

CREATE UNIQUE INDEX run_artifacts_reduced_semantic_analysis_input_v1_unique
ON run_artifacts (run_id)
WHERE role = 'reduced-semantic-analysis-input-v1';

CREATE TRIGGER run_artifacts_validate_reduced_semantic_analysis_input_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role = 'reduced-semantic-analysis-input-v1'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.artifact_id
      AND a.storage_version = 1
      AND a.kind = 'reduced-semantic-analysis-input-v1'
      AND a.media_type = 'application/vnd.ownloop.semantic-analysis-input+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes > 0
      AND a.size_bytes <= 524288
  ) THEN RAISE(ABORT, 'invalid reduced semantic analysis input artifact metadata') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.run_id = NEW.run_id
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'reduced semantic analysis input requires a finalized Run') END;
END;

CREATE TRIGGER artifacts_preserve_reduced_semantic_analysis_input_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'reduced-semantic-analysis-input-v1'
  AND OLD.media_type = 'application/vnd.ownloop.semantic-analysis-input+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'reduced semantic analysis input sensitivity is immutable');
END;
`;

const CANDIDATE_GENERATION_PROVENANCE_SQL = `
CREATE TABLE candidate_generation_v15_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO candidate_generation_v15_validation (valid)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM run_artifacts
  WHERE role GLOB 'candidate-moment-batch-v1.*'
) THEN 1 ELSE 0 END;

DROP TABLE candidate_generation_v15_validation;

CREATE TABLE candidate_generations (
  generation_id TEXT PRIMARY KEY CHECK (generation_id GLOB 'gen_*' AND length(generation_id) = 52 AND substr(generation_id, 5) NOT GLOB '*[^0-9a-f]*'),
  generation_key TEXT NOT NULL CHECK (generation_key GLOB 'gkey_*' AND length(generation_key) = 53 AND substr(generation_key, 6) NOT GLOB '*[^0-9a-f]*'),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  finalization_id TEXT NOT NULL REFERENCES run_finalizations (finalization_id) ON DELETE CASCADE,
  semantic_input_artifact_id TEXT NOT NULL REFERENCES artifacts (artifact_id) ON DELETE RESTRICT,
  candidate_artifact_id TEXT REFERENCES artifacts (artifact_id) ON DELETE RESTRICT,
  candidate_artifact_role TEXT,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint GLOB 'sha256:*' AND length(request_fingerprint) = 71 AND substr(request_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_config_fingerprint TEXT NOT NULL CHECK (provider_config_fingerprint GLOB 'sha256:*' AND length(provider_config_fingerprint) = 71 AND substr(provider_config_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'aborted', 'transport_failed', 'provider_rejected', 'invalid_response')),
  started_at TEXT NOT NULL CHECK (length(trim(started_at)) > 0),
  completed_at TEXT NOT NULL CHECK (length(trim(completed_at)) > 0 AND completed_at >= started_at),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0 AND attempt_count <= 3),
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  CHECK (json_extract(record_json, '$.generationId') = generation_id),
  CHECK (json_extract(record_json, '$.generationKey') = generation_key),
  CHECK (json_extract(record_json, '$.runId') = run_id),
  CHECK (json_extract(record_json, '$.finalizationId') = finalization_id),
  CHECK (json_extract(record_json, '$.semanticInputArtifactId') = semantic_input_artifact_id),
  CHECK (json_extract(record_json, '$.candidateArtifactId') IS candidate_artifact_id),
  CHECK (json_extract(record_json, '$.candidateArtifactRole') IS candidate_artifact_role),
  CHECK (json_extract(record_json, '$.requestFingerprint') = request_fingerprint),
  CHECK (json_extract(record_json, '$.providerConfigFingerprint') = provider_config_fingerprint),
  CHECK (json_extract(record_json, '$.status') = status),
  CHECK (json_extract(record_json, '$.startedAt') = started_at),
  CHECK (json_extract(record_json, '$.completedAt') = completed_at),
  CHECK (json_array_length(record_json, '$.attempts') = attempt_count),
  CHECK (
    (status = 'succeeded'
      AND candidate_artifact_id IS NOT NULL
      AND candidate_artifact_role = 'candidate-moment-batch-v1.' || generation_id)
    OR
    (status <> 'succeeded'
      AND candidate_artifact_id IS NULL
      AND candidate_artifact_role IS NULL)
  ),
  FOREIGN KEY (run_id, candidate_artifact_id, candidate_artifact_role)
    REFERENCES run_artifacts (run_id, artifact_id, role)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX candidate_generations_run_idx
ON candidate_generations (run_id, completed_at, generation_id);

CREATE UNIQUE INDEX candidate_generations_success_key_unique
ON candidate_generations (generation_key)
WHERE status = 'succeeded';

CREATE TRIGGER candidate_generations_validate_insert
BEFORE INSERT ON candidate_generations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.finalization_id = NEW.finalization_id
      AND rf.run_id = NEW.run_id
      AND tr.status = rf.terminal_status
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'Candidate generation requires the immutable Run finalization') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    JOIN artifacts a ON a.artifact_id = ra.artifact_id
    WHERE ra.run_id = NEW.run_id
      AND ra.artifact_id = NEW.semantic_input_artifact_id
      AND ra.role = 'reduced-semantic-analysis-input-v1'
      AND a.storage_version = 1
      AND a.kind = 'reduced-semantic-analysis-input-v1'
      AND a.media_type = 'application/vnd.ownloop.semantic-analysis-input+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes > 0
      AND a.size_bytes <= 524288
  ) THEN RAISE(ABORT, 'Candidate generation requires verified semantic input metadata') END;

  SELECT CASE WHEN NEW.status = 'succeeded' AND NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.candidate_artifact_id
      AND a.storage_version = 1
      AND a.kind = 'candidate-moment-batch-v1'
      AND a.media_type = 'application/vnd.ownloop.candidate-moment-batch+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes > 0
      AND a.size_bytes <= 524288
  ) THEN RAISE(ABORT, 'Candidate generation output artifact metadata is invalid') END;
END;

CREATE TRIGGER candidate_generations_reject_update
BEFORE UPDATE ON candidate_generations
BEGIN
  SELECT RAISE(ABORT, 'Candidate generation provenance is immutable');
END;

CREATE TRIGGER run_artifacts_validate_candidate_generation_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role GLOB 'candidate-moment-batch-v1.*'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM candidate_generations cg
    WHERE cg.run_id = NEW.run_id
      AND cg.candidate_artifact_id = NEW.artifact_id
      AND cg.candidate_artifact_role = NEW.role
      AND cg.status = 'succeeded'
  ) THEN RAISE(ABORT, 'Candidate artifact reference requires successful generation provenance') END;
END;

CREATE TRIGGER artifacts_preserve_candidate_generation_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'candidate-moment-batch-v1'
  AND OLD.media_type = 'application/vnd.ownloop.candidate-moment-batch+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'Candidate generation artifact sensitivity is immutable');
END;
`;

const CANDIDATE_VALIDATION_PROVENANCE_SQL = `
CREATE TABLE candidate_validation_v16_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;

INSERT INTO candidate_validation_v16_validation (valid)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM run_artifacts
  WHERE role = 'candidate-validation-report-v1'
) THEN 1 ELSE 0 END;

DROP TABLE candidate_validation_v16_validation;

CREATE TABLE candidate_validations (
  validation_id TEXT PRIMARY KEY CHECK (
    validation_id GLOB 'val_*'
    AND length(validation_id) = 52
    AND substr(validation_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  validation_key TEXT NOT NULL UNIQUE CHECK (
    validation_key GLOB 'vkey_*'
    AND length(validation_key) = 53
    AND substr(validation_key, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  finalization_id TEXT NOT NULL REFERENCES run_finalizations (finalization_id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES candidate_generations (generation_id) ON DELETE CASCADE,
  source_candidate_artifact_id TEXT NOT NULL REFERENCES artifacts (artifact_id) ON DELETE RESTRICT,
  source_candidate_fingerprint TEXT NOT NULL CHECK (
    source_candidate_fingerprint GLOB 'sha256:*'
    AND length(source_candidate_fingerprint) = 71
    AND substr(source_candidate_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_graph_artifact_id TEXT NOT NULL REFERENCES artifacts (artifact_id) ON DELETE RESTRICT,
  evidence_graph_input_fingerprint TEXT NOT NULL CHECK (
    length(evidence_graph_input_fingerprint) = 64
    AND evidence_graph_input_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  report_artifact_id TEXT NOT NULL REFERENCES artifacts (artifact_id) ON DELETE RESTRICT,
  report_artifact_role TEXT NOT NULL CHECK (report_artifact_role = 'candidate-validation-report-v1'),
  report_fingerprint TEXT NOT NULL CHECK (
    report_fingerprint GLOB 'sha256:*'
    AND length(report_fingerprint) = 71
    AND substr(report_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('ready', 'partial')),
  selected_count INTEGER NOT NULL CHECK (selected_count >= 0 AND selected_count <= 7),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
  record_json TEXT NOT NULL CHECK (json_valid(record_json) AND json_type(record_json) = 'object'),
  CHECK (json_extract(record_json, '$.validationId') = validation_id),
  CHECK (json_extract(record_json, '$.validationKey') = validation_key),
  CHECK (json_extract(record_json, '$.runId') = run_id),
  CHECK (json_extract(record_json, '$.finalizationId') = finalization_id),
  CHECK (json_extract(record_json, '$.generationId') = generation_id),
  CHECK (json_extract(record_json, '$.sourceCandidateArtifactId') = source_candidate_artifact_id),
  CHECK (json_extract(record_json, '$.sourceCandidateFingerprint') = source_candidate_fingerprint),
  CHECK (json_extract(record_json, '$.evidenceGraphArtifactId') = evidence_graph_artifact_id),
  CHECK (json_extract(record_json, '$.evidenceGraphInputFingerprint') = evidence_graph_input_fingerprint),
  CHECK (json_extract(record_json, '$.reportArtifactId') = report_artifact_id),
  CHECK (json_extract(record_json, '$.reportArtifactRole') = report_artifact_role),
  CHECK (json_extract(record_json, '$.reportFingerprint') = report_fingerprint),
  CHECK (json_extract(record_json, '$.outcome') = outcome),
  CHECK (json_extract(record_json, '$.counts.selected') = selected_count),
  CHECK (json_extract(record_json, '$.createdAt') = created_at),
  FOREIGN KEY (run_id, report_artifact_id, report_artifact_role)
    REFERENCES run_artifacts (run_id, artifact_id, role)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE INDEX candidate_validations_run_idx
ON candidate_validations (run_id, created_at, validation_id);

CREATE TRIGGER candidate_validations_validate_insert
BEFORE INSERT ON candidate_validations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM candidate_generations cg
    WHERE cg.generation_id = NEW.generation_id
      AND cg.status = 'succeeded'
      AND cg.run_id = NEW.run_id
      AND cg.finalization_id = NEW.finalization_id
      AND cg.candidate_artifact_id = NEW.source_candidate_artifact_id
      AND json_extract(cg.record_json, '$.candidateFingerprint') = NEW.source_candidate_fingerprint
  ) THEN RAISE(ABORT, 'Candidate validation requires exact successful generation provenance') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_finalizations rf
    JOIN task_runs tr ON tr.run_id = rf.run_id
    WHERE rf.finalization_id = NEW.finalization_id
      AND rf.run_id = NEW.run_id
      AND tr.status = rf.terminal_status
      AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
  ) THEN RAISE(ABORT, 'Candidate validation requires immutable Run finalization') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM run_artifacts ra
    JOIN artifacts a ON a.artifact_id = ra.artifact_id
    WHERE ra.run_id = NEW.run_id
      AND ra.artifact_id = NEW.evidence_graph_artifact_id
      AND ra.role = 'deterministic-evidence-graph-v1'
      AND a.storage_version = 1
      AND a.kind = 'deterministic-evidence-graph-v1'
      AND a.media_type = 'application/vnd.ownloop.evidence-graph+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes > 0
      AND a.size_bytes <= 8388608
  ) THEN RAISE(ABORT, 'Candidate validation requires exact Evidence Graph metadata') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.artifact_id = NEW.report_artifact_id
      AND a.storage_version = 1
      AND a.kind = 'candidate-validation-report-v1'
      AND a.media_type = 'application/vnd.ownloop.candidate-validation-report+json'
      AND a.sensitivity = 'sensitive'
      AND a.size_bytes > 0
      AND a.size_bytes <= 524288
  ) THEN RAISE(ABORT, 'Candidate validation report artifact metadata is invalid') END;
END;

CREATE TRIGGER candidate_validations_reject_update
BEFORE UPDATE ON candidate_validations
BEGIN
  SELECT RAISE(ABORT, 'Candidate validation provenance is immutable');
END;

CREATE TRIGGER run_artifacts_validate_candidate_validation_v1
BEFORE INSERT ON run_artifacts
WHEN NEW.role = 'candidate-validation-report-v1'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM candidate_validations cv
    WHERE cv.run_id = NEW.run_id
      AND cv.report_artifact_id = NEW.artifact_id
      AND cv.report_artifact_role = NEW.role
  ) THEN RAISE(ABORT, 'Validation report reference requires validation provenance') END;
END;

CREATE TRIGGER artifacts_preserve_candidate_validation_sensitivity_v1
BEFORE UPDATE OF sensitivity ON artifacts
WHEN OLD.storage_version = 1
  AND OLD.kind = 'candidate-validation-report-v1'
  AND OLD.media_type = 'application/vnd.ownloop.candidate-validation-report+json'
  AND NEW.sensitivity <> 'sensitive'
BEGIN
  SELECT RAISE(ABORT, 'Candidate validation report sensitivity is immutable');
END;
`;

const MOMENT_INTERACTIONS_SQL = `
CREATE UNIQUE INDEX candidate_validations_identity_run_v17
ON candidate_validations (validation_id, run_id);

CREATE TABLE moment_interactions (
  interaction_id TEXT PRIMARY KEY CHECK (
    interaction_id GLOB 'ix_*'
    AND length(interaction_id) = 51
    AND substr(interaction_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  actor TEXT NOT NULL CHECK (actor = 'local_user'),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  validation_id TEXT NOT NULL,
  moment_id TEXT NOT NULL CHECK (
    moment_id GLOB 'mom_*'
    AND length(moment_id) = 52
    AND substr(moment_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  source_index INTEGER NOT NULL CHECK (source_index >= 0 AND source_index <= 6),
  source_candidate_fingerprint TEXT NOT NULL CHECK (
    source_candidate_fingerprint GLOB 'sha256:*'
    AND length(source_candidate_fingerprint) = 71
    AND substr(source_candidate_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  moment_type TEXT NOT NULL CHECK (moment_type IN ('change', 'decision', 'risk', 'check')),
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'moment_viewed',
    'evidence_viewed',
    'acknowledgement_set',
    'decision_response_set',
    'risk_response_set',
    'check_answer_set',
    'usefulness_set'
  )),
  evidence_id TEXT CHECK (
    evidence_id IS NULL OR (
      evidence_id GLOB 'ev_*'
      AND length(evidence_id) = 51
      AND substr(evidence_id, 4) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  value_code TEXT CHECK (
    value_code IS NULL OR (
      length(value_code) BETWEEN 1 AND 64
      AND value_code GLOB '[a-z]*'
      AND value_code NOT GLOB '*[^a-z0-9_]*'
    )
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint GLOB 'sha256:*'
    AND length(request_fingerprint) = 71
    AND substr(request_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at TEXT NOT NULL CHECK (
    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
  ),
  CHECK (
    (action_kind = 'moment_viewed' AND evidence_id IS NULL AND value_code IS NULL)
    OR (action_kind = 'evidence_viewed' AND evidence_id IS NOT NULL AND value_code IS NULL)
    OR (action_kind = 'acknowledgement_set' AND moment_type = 'change'
      AND evidence_id IS NULL AND value_code IN ('true', 'false'))
    OR (action_kind = 'decision_response_set' AND moment_type = 'decision'
      AND evidence_id IS NULL AND value_code IN ('confirm', 'revise', 'uncertain'))
    OR (action_kind = 'risk_response_set' AND moment_type = 'risk'
      AND evidence_id IS NULL AND value_code IN ('acknowledge', 'mitigate', 'dismiss'))
    OR (action_kind = 'check_answer_set' AND moment_type = 'check'
      AND evidence_id IS NULL AND value_code IS NOT NULL)
    OR (action_kind = 'usefulness_set' AND evidence_id IS NULL
      AND value_code IN ('useful', 'not_useful', 'unset'))
  ),
  FOREIGN KEY (validation_id, run_id)
    REFERENCES candidate_validations (validation_id, run_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX moment_interactions_validation_moment_idx
ON moment_interactions (run_id, validation_id, moment_id, created_at, interaction_id);

CREATE INDEX moment_interactions_validation_recent_idx
ON moment_interactions (run_id, validation_id, created_at DESC, interaction_id DESC);

CREATE TABLE ownership_records (
  record_id TEXT PRIMARY KEY CHECK (
    record_id GLOB 'or_*'
    AND length(record_id) = 51
    AND substr(record_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  interaction_id TEXT NOT NULL UNIQUE
    REFERENCES moment_interactions (interaction_id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor = 'local_user'),
  run_id TEXT NOT NULL REFERENCES task_runs (run_id) ON DELETE CASCADE,
  validation_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  source_index INTEGER NOT NULL CHECK (source_index >= 0 AND source_index <= 6),
  source_candidate_fingerprint TEXT NOT NULL,
  moment_type TEXT NOT NULL CHECK (moment_type IN ('change', 'decision', 'risk', 'check')),
  record_kind TEXT NOT NULL CHECK (record_kind IN (
    'acknowledgement_recorded',
    'response_recorded',
    'answer_recorded',
    'feedback_recorded'
  )),
  value_code TEXT NOT NULL CHECK (
    length(value_code) BETWEEN 1 AND 64
    AND value_code GLOB '[a-z]*'
    AND value_code NOT GLOB '*[^a-z0-9_]*'
  ),
  assertion_code TEXT NOT NULL CHECK (assertion_code = 'interaction_recorded'),
  no_comprehension_claim INTEGER NOT NULL CHECK (no_comprehension_claim = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at TEXT NOT NULL CHECK (
    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
  ),
  FOREIGN KEY (validation_id, run_id)
    REFERENCES candidate_validations (validation_id, run_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX ownership_records_validation_moment_idx
ON ownership_records (run_id, validation_id, moment_id, created_at, record_id);

CREATE TRIGGER moment_interactions_validate_insert_v17
BEFORE INSERT ON moment_interactions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM candidate_validations cv
    WHERE cv.validation_id = NEW.validation_id
      AND cv.run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'Moment interaction requires exact Run validation') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM moment_interactions existing
    WHERE existing.run_id = NEW.run_id
      AND existing.validation_id = NEW.validation_id
      AND existing.moment_id = NEW.moment_id
      AND (
        existing.source_index <> NEW.source_index
        OR existing.source_candidate_fingerprint <> NEW.source_candidate_fingerprint
        OR existing.moment_type <> NEW.moment_type
      )
  ) THEN RAISE(ABORT, 'Moment interaction identity must remain exact') END;
END;

CREATE TRIGGER ownership_records_validate_insert_v17
BEFORE INSERT ON ownership_records
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM moment_interactions mi
    WHERE mi.interaction_id = NEW.interaction_id
      AND mi.actor = NEW.actor
      AND mi.run_id = NEW.run_id
      AND mi.validation_id = NEW.validation_id
      AND mi.moment_id = NEW.moment_id
      AND mi.source_index = NEW.source_index
      AND mi.source_candidate_fingerprint = NEW.source_candidate_fingerprint
      AND mi.moment_type = NEW.moment_type
      AND mi.created_at = NEW.created_at
      AND (
        (mi.action_kind = 'acknowledgement_set'
          AND NEW.record_kind = 'acknowledgement_recorded'
          AND NEW.value_code = CASE mi.value_code WHEN 'true' THEN 'acknowledged' ELSE 'unacknowledged' END)
        OR (mi.action_kind IN ('decision_response_set', 'risk_response_set')
          AND NEW.record_kind = 'response_recorded'
          AND NEW.value_code = mi.value_code)
        OR (mi.action_kind = 'check_answer_set'
          AND NEW.record_kind = 'answer_recorded'
          AND NEW.value_code = mi.value_code)
        OR (mi.action_kind = 'usefulness_set'
          AND NEW.record_kind = 'feedback_recorded'
          AND NEW.value_code = mi.value_code)
      )
  ) THEN RAISE(ABORT, 'Ownership Record requires exact qualifying interaction') END;
END;

CREATE TRIGGER moment_interactions_reject_update_v17
BEFORE UPDATE ON moment_interactions
BEGIN
  SELECT RAISE(ABORT, 'Moment interactions are append-only');
END;

CREATE TRIGGER ownership_records_reject_update_v17
BEFORE UPDATE ON ownership_records
BEGIN
  SELECT RAISE(ABORT, 'Ownership Records are append-only');
END;

CREATE TRIGGER moment_interactions_reject_direct_delete_v17
BEFORE DELETE ON moment_interactions
WHEN EXISTS (SELECT 1 FROM task_runs tr WHERE tr.run_id = OLD.run_id)
BEGIN
  SELECT RAISE(ABORT, 'Moment interactions can be deleted only with their Task Run');
END;

CREATE TRIGGER ownership_records_reject_direct_delete_v17
BEFORE DELETE ON ownership_records
WHEN EXISTS (SELECT 1 FROM task_runs tr WHERE tr.run_id = OLD.run_id)
BEGIN
  SELECT RAISE(ABORT, 'Ownership Records can be deleted only with their Task Run');
END;

CREATE TRIGGER candidate_validations_preserve_moment_interactions_v17
BEFORE DELETE ON candidate_validations
WHEN EXISTS (SELECT 1 FROM task_runs tr WHERE tr.run_id = OLD.run_id)
  AND EXISTS (
    SELECT 1 FROM moment_interactions mi WHERE mi.validation_id = OLD.validation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'Candidate validation with Moment interactions is retained with its Task Run');
END;
`;

const LOCAL_SETTINGS_SQL = `
CREATE TABLE local_settings (
  settings_id TEXT PRIMARY KEY CHECK (settings_id = 'local'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  external_ai_enabled INTEGER NOT NULL CHECK (external_ai_enabled IN (0, 1)),
  provider_family TEXT CHECK (
    provider_family IS NULL OR provider_family = 'responses_json_v1'
  ),
  provider_base_url TEXT CHECK (
    provider_base_url IS NULL OR (
      length(provider_base_url) BETWEEN 1 AND 2048
      AND provider_base_url = trim(provider_base_url)
    )
  ),
  provider_model_id TEXT CHECK (
    provider_model_id IS NULL OR length(provider_model_id) BETWEEN 1 AND 256
  ),
  provider_model_revision TEXT CHECK (
    provider_model_revision IS NULL OR length(provider_model_revision) BETWEEN 1 AND 256
  ),
  provider_timeout_ms INTEGER CHECK (
    provider_timeout_ms IS NULL OR provider_timeout_ms BETWEEN 1000 AND 120000
  ),
  provider_max_response_bytes INTEGER CHECK (
    provider_max_response_bytes IS NULL
    OR provider_max_response_bytes BETWEEN 1 AND 262144
  ),
  provider_retry_max_attempts INTEGER CHECK (
    provider_retry_max_attempts IS NULL OR provider_retry_max_attempts BETWEEN 1 AND 3
  ),
  provider_retry_base_delay_ms INTEGER CHECK (
    provider_retry_base_delay_ms IS NULL OR provider_retry_base_delay_ms BETWEEN 0 AND 30000
  ),
  provider_retry_max_retry_after_ms INTEGER CHECK (
    provider_retry_max_retry_after_ms IS NULL
    OR provider_retry_max_retry_after_ms BETWEEN 0 AND 60000
  ),
  retention_policy TEXT NOT NULL CHECK (retention_policy IN (
    'keep_until_deleted',
    'delete_terminal_after_7_days',
    'delete_terminal_after_30_days',
    'delete_terminal_after_90_days'
  )),
  diagnostic_mode TEXT NOT NULL CHECK (diagnostic_mode IN ('off', 'counts_only')),
  raw_source_payload_retention TEXT NOT NULL CHECK (raw_source_payload_retention = 'off'),
  custom_secret_field_patterns_json TEXT NOT NULL CHECK (
    json_valid(custom_secret_field_patterns_json)
    AND json_type(custom_secret_field_patterns_json) = 'array'
    AND length(custom_secret_field_patterns_json) <= 4096
  ),
  updated_at TEXT NOT NULL CHECK (
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
  ),
  CHECK (
    (
      provider_family IS NULL
      AND provider_base_url IS NULL
      AND provider_model_id IS NULL
      AND provider_model_revision IS NULL
      AND provider_timeout_ms IS NULL
      AND provider_max_response_bytes IS NULL
      AND provider_retry_max_attempts IS NULL
      AND provider_retry_base_delay_ms IS NULL
      AND provider_retry_max_retry_after_ms IS NULL
    )
    OR (
      provider_family = 'responses_json_v1'
      AND provider_base_url IS NOT NULL
      AND provider_model_id IS NOT NULL
      AND provider_timeout_ms IS NOT NULL
      AND provider_max_response_bytes IS NOT NULL
      AND provider_retry_max_attempts IS NOT NULL
      AND provider_retry_base_delay_ms IS NOT NULL
      AND provider_retry_max_retry_after_ms IS NOT NULL
    )
  )
) STRICT;

INSERT INTO local_settings (
  settings_id,
  schema_version,
  revision,
  external_ai_enabled,
  provider_family,
  provider_base_url,
  provider_model_id,
  provider_model_revision,
  provider_timeout_ms,
  provider_max_response_bytes,
  provider_retry_max_attempts,
  provider_retry_base_delay_ms,
  provider_retry_max_retry_after_ms,
  retention_policy,
  diagnostic_mode,
  raw_source_payload_retention,
  custom_secret_field_patterns_json,
  updated_at
) VALUES (
  'local', 1, 1, 0,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  'keep_until_deleted', 'off', 'off', '[]',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TRIGGER local_settings_reject_insert_v18
BEFORE INSERT ON local_settings
WHEN EXISTS (SELECT 1 FROM local_settings)
BEGIN
  SELECT RAISE(ABORT, 'Only one local settings row is allowed');
END;

CREATE TRIGGER local_settings_validate_update_v18
BEFORE UPDATE ON local_settings
BEGIN
  SELECT CASE WHEN NEW.settings_id <> OLD.settings_id
    THEN RAISE(ABORT, 'Local settings identity is immutable') END;
  SELECT CASE WHEN NEW.schema_version <> OLD.schema_version
    THEN RAISE(ABORT, 'Local settings schema version is immutable') END;
  SELECT CASE WHEN NEW.revision <> OLD.revision + 1
    THEN RAISE(ABORT, 'Local settings revision must increment exactly once') END;
  SELECT CASE WHEN NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'Local settings time cannot move backwards') END;
END;

CREATE TRIGGER local_settings_reject_delete_v18
BEFORE DELETE ON local_settings
BEGIN
  SELECT RAISE(ABORT, 'Local settings cannot be deleted');
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
  Object.freeze({
    version: 3,
    name: "transactional_lifecycle_resolution",
    sql: LIFECYCLE_RESOLUTION_SQL,
  }),
  Object.freeze({
    version: 4,
    name: "transactional_event_normalization",
    sql: EVENT_NORMALIZATION_SQL,
  }),
  Object.freeze({
    version: 5,
    name: "privacy_bounded_git_baseline",
    sql: GIT_BASELINE_SQL,
  }),
  Object.freeze({
    version: 6,
    name: "evidence_bounded_git_reconciliation",
    sql: GIT_RECONCILIATION_SQL,
  }),
  Object.freeze({
    version: 7,
    name: "local_content_addressed_artifact_store",
    sql: CONTENT_ADDRESSED_ARTIFACT_STORE_SQL,
  }),
  Object.freeze({
    version: 8,
    name: "deterministic_run_finalization",
    sql: RUN_FINALIZATION_SQL,
  }),
  Object.freeze({
    version: 9,
    name: "strict_run_finalization_invariants",
    sql: RUN_FINALIZATION_INVARIANTS_SQL,
  }),
  Object.freeze({
    version: 10,
    name: "run_finalization_evidence_continuity",
    sql: RUN_FINALIZATION_EVIDENCE_CONTINUITY_SQL,
  }),
  Object.freeze({
    version: 11,
    name: "deterministic_change_classification_artifact",
    sql: DETERMINISTIC_CHANGE_CLASSIFICATION_ARTIFACT_SQL,
  }),
  Object.freeze({
    version: 12,
    name: "deterministic_verification_evidence_artifact",
    sql: DETERMINISTIC_VERIFICATION_EVIDENCE_ARTIFACT_SQL,
  }),
  Object.freeze({
    version: 13,
    name: "deterministic_evidence_graph_artifact",
    sql: DETERMINISTIC_EVIDENCE_GRAPH_ARTIFACT_SQL,
  }),
  Object.freeze({
    version: 14,
    name: "reduced_semantic_analysis_input_artifact",
    sql: REDUCED_SEMANTIC_ANALYSIS_INPUT_ARTIFACT_SQL,
  }),
  Object.freeze({
    version: 15,
    name: "candidate_generation_provenance",
    sql: CANDIDATE_GENERATION_PROVENANCE_SQL,
  }),
  Object.freeze({
    version: 16,
    name: "candidate_validation_provenance",
    sql: CANDIDATE_VALIDATION_PROVENANCE_SQL,
  }),
  Object.freeze({
    version: 17,
    name: "append_only_moment_interactions",
    sql: MOMENT_INTERACTIONS_SQL,
  }),
  Object.freeze({
    version: 18,
    name: "local_settings_and_privacy_controls",
    sql: LOCAL_SETTINGS_SQL,
  }),
]);
