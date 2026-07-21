import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const GIT_BASELINE_OUTCOMES = ["captured", "partial"] as const;
export type GitBaselineOutcome = (typeof GIT_BASELINE_OUTCOMES)[number];

export const GIT_BASELINE_DIAGNOSTIC_CODES = [
  "not_a_git_repository",
  "git_executable_unavailable",
  "git_command_failed",
  "git_command_timeout",
  "git_output_limit_exceeded",
  "repository_changed_during_capture",
  "untracked_inventory_limit_exceeded",
  "untracked_entry_changed",
  "untracked_entry_unreadable",
  "late_capture",
  "baseline_processing_failed",
] as const;
export type GitBaselineDiagnosticCode = (typeof GIT_BASELINE_DIAGNOSTIC_CODES)[number];

export const GIT_BASELINE_ENTRY_KINDS = ["regular", "symlink", "directory", "other"] as const;
export type GitBaselineEntryKind = (typeof GIT_BASELINE_ENTRY_KINDS)[number];

export const GIT_BASELINE_ENTRY_SENSITIVITIES = ["normal", "secret"] as const;
export type GitBaselineEntrySensitivity = (typeof GIT_BASELINE_ENTRY_SENSITIVITIES)[number];

export const GIT_BASELINE_ENTRY_HASH_STATUSES = [
  "hashed",
  "too_large",
  "sensitive_path",
  "unreadable",
  "non_regular",
  "changed_during_capture",
] as const;
export type GitBaselineEntryHashStatus = (typeof GIT_BASELINE_ENTRY_HASH_STATUSES)[number];

export type GitBaselineUntrackedEntry = Readonly<{
  baselineId: string;
  entryIndex: number;
  pathIdentitySha256: string;
  relativePath: string | null;
  kind: GitBaselineEntryKind;
  sizeBytes: number | null;
  contentSha256: string | null;
  sensitivity: GitBaselineEntrySensitivity;
  hashStatus: GitBaselineEntryHashStatus;
}>;

export type NewGitBaselineUntrackedEntry = GitBaselineUntrackedEntry;

export type GitBaseline = Readonly<{
  baselineId: string;
  runId: string;
  workspaceId: string;
  conversationId: string;
  baselineEventId: string;
  outcome: GitBaselineOutcome;
  diagnosticCode: GitBaselineDiagnosticCode | null;
  repositoryRoot: string;
  headCommit: string | null;
  stagedDiffSha256: string | null;
  unstagedDiffSha256: string | null;
  statusBeforeSha256: string | null;
  statusAfterSha256: string | null;
  workingTreeFingerprint: string | null;
  stagedDirty: boolean;
  unstagedDirty: boolean;
  untrackedCount: number;
  untrackedHashedCount: number;
  untrackedOmittedCount: number;
  capturedAt: string;
  captureDelayMs: number;
  entries: readonly GitBaselineUntrackedEntry[];
}>;

export type NewGitBaseline = Omit<GitBaseline, "entries">;

function mapBoolean(row: SqliteRow, column: string): boolean {
  const value = requiredNumber(row, column);
  if (value !== 0 && value !== 1) {
    throw new PersistenceError(
      "invalid_persisted_row",
      `The persisted row contains an invalid ${column} boolean.`,
    );
  }
  return value === 1;
}

function mapEntry(row: SqliteRow): GitBaselineUntrackedEntry {
  return {
    baselineId: requiredString(row, "baseline_id"),
    entryIndex: requiredNumber(row, "entry_index"),
    pathIdentitySha256: requiredString(row, "path_identity_sha256"),
    relativePath: nullableString(row, "relative_path"),
    kind: requiredString(row, "kind") as GitBaselineEntryKind,
    sizeBytes: row.size_bytes === null ? null : requiredNumber(row, "size_bytes"),
    contentSha256: nullableString(row, "content_sha256"),
    sensitivity: requiredString(row, "sensitivity") as GitBaselineEntrySensitivity,
    hashStatus: requiredString(row, "hash_status") as GitBaselineEntryHashStatus,
  };
}

function mapBaseline(row: SqliteRow, entries: readonly GitBaselineUntrackedEntry[]): GitBaseline {
  return {
    baselineId: requiredString(row, "baseline_id"),
    runId: requiredString(row, "run_id"),
    workspaceId: requiredString(row, "workspace_id"),
    conversationId: requiredString(row, "conversation_id"),
    baselineEventId: requiredString(row, "baseline_event_id"),
    outcome: requiredString(row, "outcome") as GitBaselineOutcome,
    diagnosticCode: nullableString(row, "diagnostic_code") as GitBaselineDiagnosticCode | null,
    repositoryRoot: requiredString(row, "repository_root"),
    headCommit: nullableString(row, "head_commit"),
    stagedDiffSha256: nullableString(row, "staged_diff_sha256"),
    unstagedDiffSha256: nullableString(row, "unstaged_diff_sha256"),
    statusBeforeSha256: nullableString(row, "status_before_sha256"),
    statusAfterSha256: nullableString(row, "status_after_sha256"),
    workingTreeFingerprint: nullableString(row, "working_tree_fingerprint"),
    stagedDirty: mapBoolean(row, "staged_dirty"),
    unstagedDirty: mapBoolean(row, "unstaged_dirty"),
    untrackedCount: requiredNumber(row, "untracked_count"),
    untrackedHashedCount: requiredNumber(row, "untracked_hashed_count"),
    untrackedOmittedCount: requiredNumber(row, "untracked_omitted_count"),
    capturedAt: requiredString(row, "captured_at"),
    captureDelayMs: requiredNumber(row, "capture_delay_ms"),
    entries,
  };
}

const BASELINE_SELECT = `SELECT
  baseline_id,
  run_id,
  workspace_id,
  conversation_id,
  baseline_event_id,
  outcome,
  diagnostic_code,
  repository_root,
  head_commit,
  staged_diff_sha256,
  unstaged_diff_sha256,
  status_before_sha256,
  status_after_sha256,
  working_tree_fingerprint,
  staged_dirty,
  unstaged_dirty,
  untracked_count,
  untracked_hashed_count,
  untracked_omitted_count,
  captured_at,
  capture_delay_ms
FROM git_baselines`;

export class GitBaselineRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(baseline: NewGitBaseline): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO git_baselines (
             baseline_id,
             run_id,
             workspace_id,
             conversation_id,
             baseline_event_id,
             outcome,
             diagnostic_code,
             repository_root,
             head_commit,
             staged_diff_sha256,
             unstaged_diff_sha256,
             status_before_sha256,
             status_after_sha256,
             working_tree_fingerprint,
             staged_dirty,
             unstaged_dirty,
             untracked_count,
             untracked_hashed_count,
             untracked_omitted_count,
             captured_at,
             capture_delay_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          baseline.baselineId,
          baseline.runId,
          baseline.workspaceId,
          baseline.conversationId,
          baseline.baselineEventId,
          baseline.outcome,
          baseline.diagnosticCode,
          baseline.repositoryRoot,
          baseline.headCommit,
          baseline.stagedDiffSha256,
          baseline.unstagedDiffSha256,
          baseline.statusBeforeSha256,
          baseline.statusAfterSha256,
          baseline.workingTreeFingerprint,
          baseline.stagedDirty ? 1 : 0,
          baseline.unstagedDirty ? 1 : 0,
          baseline.untrackedCount,
          baseline.untrackedHashedCount,
          baseline.untrackedOmittedCount,
          baseline.capturedAt,
          baseline.captureDelayMs,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Git baseline");
    }
  }

  insertEntry(entry: NewGitBaselineUntrackedEntry): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO git_baseline_untracked_entries (
             baseline_id,
             entry_index,
             path_identity_sha256,
             relative_path,
             kind,
             size_bytes,
             content_sha256,
             sensitivity,
             hash_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.baselineId,
          entry.entryIndex,
          entry.pathIdentitySha256,
          entry.relativePath,
          entry.kind,
          entry.sizeBytes,
          entry.contentSha256,
          entry.sensitivity,
          entry.hashStatus,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Git baseline untracked entry");
    }
  }

  getByRun(runId: string): GitBaseline | null {
    const row = this.#database.prepare(`${BASELINE_SELECT} WHERE run_id = ?`).get(runId);
    return row === undefined ? null : this.#mapWithEntries(row);
  }

  get(baselineId: string): GitBaseline | null {
    const row = this.#database.prepare(`${BASELINE_SELECT} WHERE baseline_id = ?`).get(baselineId);
    return row === undefined ? null : this.#mapWithEntries(row);
  }

  #mapWithEntries(row: SqliteRow): GitBaseline {
    const baselineId = requiredString(row, "baseline_id");
    const entries = this.#database
      .prepare(
        `SELECT
           baseline_id,
           entry_index,
           path_identity_sha256,
           relative_path,
           kind,
           size_bytes,
           content_sha256,
           sensitivity,
           hash_status
         FROM git_baseline_untracked_entries
         WHERE baseline_id = ?
         ORDER BY entry_index ASC`,
      )
      .all(baselineId)
      .map((entryRow, index) => {
        const entry = mapEntry(entryRow);
        if (entry.entryIndex !== index) {
          throw new PersistenceError(
            "invalid_persisted_row",
            "The persisted Git baseline entry indices are not contiguous.",
          );
        }
        return entry;
      });
    const baseline = mapBaseline(row, entries);
    if (
      baseline.untrackedCount < entries.length ||
      baseline.untrackedHashedCount + baseline.untrackedOmittedCount !== baseline.untrackedCount
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Git baseline untracked counts are inconsistent.",
      );
    }
    return baseline;
  }

  listRunIdsMissingBaseline(limit: number): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      return [];
    }
    return this.#database
      .prepare(
        `SELECT tr.run_id
         FROM task_runs tr
         LEFT JOIN git_baselines gb ON gb.run_id = tr.run_id
         WHERE gb.run_id IS NULL
         ORDER BY tr.started_at ASC, tr.conversation_id ASC, tr.run_number ASC, tr.run_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => requiredString(row, "run_id"));
  }

  countAll(): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM git_baselines").get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
