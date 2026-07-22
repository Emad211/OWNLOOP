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
]);
