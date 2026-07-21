import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const GIT_RECONCILIATION_BOUNDARIES = ["tool_batch", "stop", "stop_failure"] as const;
export type GitReconciliationBoundary = (typeof GIT_RECONCILIATION_BOUNDARIES)[number];

export const GIT_RECONCILIATION_OUTCOMES = ["captured", "partial"] as const;
export type GitReconciliationOutcome = (typeof GIT_RECONCILIATION_OUTCOMES)[number];

export const GIT_RECONCILIATION_DIAGNOSTIC_CODES = [
  "baseline_missing",
  "baseline_partial",
  "not_a_git_repository",
  "git_executable_unavailable",
  "git_command_failed",
  "git_command_timeout",
  "git_output_limit_exceeded",
  "repository_changed_during_capture",
  "untracked_inventory_limit_exceeded",
  "untracked_entry_changed",
  "untracked_entry_unreadable",
  "invalid_status_output",
  "status_entry_limit_exceeded",
  "invalid_trigger_event",
  "reconciliation_processing_failed",
] as const;
export type GitReconciliationDiagnosticCode = (typeof GIT_RECONCILIATION_DIAGNOSTIC_CODES)[number];

export const GIT_RECONCILIATION_ATTRIBUTIONS = [
  "run_relative",
  "observed_only",
  "unavailable",
] as const;
export type GitReconciliationAttribution = (typeof GIT_RECONCILIATION_ATTRIBUTIONS)[number];

export const GIT_BASELINE_COMPARISONS = ["unchanged", "changed", "unavailable"] as const;
export type GitBaselineComparison = (typeof GIT_BASELINE_COMPARISONS)[number];

export const GIT_RECONCILIATION_CHANGE_KINDS = [
  "created",
  "modified",
  "deleted",
  "type_changed",
  "unmerged",
] as const;
export type GitReconciliationChangeKind = (typeof GIT_RECONCILIATION_CHANGE_KINDS)[number];

export type GitReconciliationEntry = Readonly<{
  reconciliationId: string;
  entryIndex: number;
  fileEventId: string;
  pathIdentitySha256: string;
  relativePath: string | null;
  changeKind: GitReconciliationChangeKind;
  staged: boolean;
  unstaged: boolean;
  sensitivity: "normal" | "secret";
  attribution: GitReconciliationAttribution;
}>;

export type NewGitReconciliationEntry = GitReconciliationEntry;

export type GitReconciliation = Readonly<{
  reconciliationId: string;
  runId: string;
  workspaceId: string;
  conversationId: string;
  baselineId: string | null;
  triggerEventId: string;
  summaryEventId: string;
  boundary: GitReconciliationBoundary;
  outcome: GitReconciliationOutcome;
  diagnosticCode: GitReconciliationDiagnosticCode | null;
  attribution: GitReconciliationAttribution;
  baselineComparison: GitBaselineComparison;
  repositoryRoot: string;
  headCommit: string | null;
  stagedDiffSha256: string | null;
  unstagedDiffSha256: string | null;
  statusBeforeSha256: string | null;
  statusAfterSha256: string | null;
  workingTreeFingerprint: string | null;
  stagedDirty: boolean;
  unstagedDirty: boolean;
  entryCount: number;
  createdCount: number;
  modifiedCount: number;
  deletedCount: number;
  typeChangedCount: number;
  unmergedCount: number;
  capturedAt: string;
  entries: readonly GitReconciliationEntry[];
}>;

export type NewGitReconciliation = Omit<GitReconciliation, "entries">;

function mapBoolean(row: SqliteRow, column: string): boolean {
  const value = requiredNumber(row, column);
  if (value !== 0 && value !== 1) {
    throw new PersistenceError(
      "invalid_persisted_row",
      `The persisted Git reconciliation contains an invalid ${column} boolean.`,
    );
  }
  return value === 1;
}

function mapEntry(row: SqliteRow): GitReconciliationEntry {
  return {
    reconciliationId: requiredString(row, "reconciliation_id"),
    entryIndex: requiredNumber(row, "entry_index"),
    fileEventId: requiredString(row, "file_event_id"),
    pathIdentitySha256: requiredString(row, "path_identity_sha256"),
    relativePath: nullableString(row, "relative_path"),
    changeKind: requiredString(row, "change_kind") as GitReconciliationChangeKind,
    staged: mapBoolean(row, "staged"),
    unstaged: mapBoolean(row, "unstaged"),
    sensitivity: requiredString(row, "sensitivity") as "normal" | "secret",
    attribution: requiredString(row, "attribution") as GitReconciliationAttribution,
  };
}

function mapReconciliation(
  row: SqliteRow,
  entries: readonly GitReconciliationEntry[],
): GitReconciliation {
  return {
    reconciliationId: requiredString(row, "reconciliation_id"),
    runId: requiredString(row, "run_id"),
    workspaceId: requiredString(row, "workspace_id"),
    conversationId: requiredString(row, "conversation_id"),
    baselineId: nullableString(row, "baseline_id"),
    triggerEventId: requiredString(row, "trigger_event_id"),
    summaryEventId: requiredString(row, "summary_event_id"),
    boundary: requiredString(row, "boundary") as GitReconciliationBoundary,
    outcome: requiredString(row, "outcome") as GitReconciliationOutcome,
    diagnosticCode: nullableString(
      row,
      "diagnostic_code",
    ) as GitReconciliationDiagnosticCode | null,
    attribution: requiredString(row, "attribution") as GitReconciliationAttribution,
    baselineComparison: requiredString(row, "baseline_comparison") as GitBaselineComparison,
    repositoryRoot: requiredString(row, "repository_root"),
    headCommit: nullableString(row, "head_commit"),
    stagedDiffSha256: nullableString(row, "staged_diff_sha256"),
    unstagedDiffSha256: nullableString(row, "unstaged_diff_sha256"),
    statusBeforeSha256: nullableString(row, "status_before_sha256"),
    statusAfterSha256: nullableString(row, "status_after_sha256"),
    workingTreeFingerprint: nullableString(row, "working_tree_fingerprint"),
    stagedDirty: mapBoolean(row, "staged_dirty"),
    unstagedDirty: mapBoolean(row, "unstaged_dirty"),
    entryCount: requiredNumber(row, "entry_count"),
    createdCount: requiredNumber(row, "created_count"),
    modifiedCount: requiredNumber(row, "modified_count"),
    deletedCount: requiredNumber(row, "deleted_count"),
    typeChangedCount: requiredNumber(row, "type_changed_count"),
    unmergedCount: requiredNumber(row, "unmerged_count"),
    capturedAt: requiredString(row, "captured_at"),
    entries,
  };
}

const RECONCILIATION_SELECT = `SELECT
  reconciliation_id,
  run_id,
  workspace_id,
  conversation_id,
  baseline_id,
  trigger_event_id,
  summary_event_id,
  boundary,
  outcome,
  diagnostic_code,
  attribution,
  baseline_comparison,
  repository_root,
  head_commit,
  staged_diff_sha256,
  unstaged_diff_sha256,
  status_before_sha256,
  status_after_sha256,
  working_tree_fingerprint,
  staged_dirty,
  unstaged_dirty,
  entry_count,
  created_count,
  modified_count,
  deleted_count,
  type_changed_count,
  unmerged_count,
  captured_at
FROM git_reconciliations`;

const BOUNDARY_EVENT_TYPE: Readonly<Record<GitReconciliationBoundary, string>> = {
  tool_batch: "tool.batch_completed",
  stop: "run.stop_observed",
  stop_failure: "run.stop_failed",
};

export class GitReconciliationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(reconciliation: NewGitReconciliation): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO git_reconciliations (
             reconciliation_id, run_id, workspace_id, conversation_id, baseline_id,
             trigger_event_id, summary_event_id, boundary, outcome, diagnostic_code,
             attribution, baseline_comparison, repository_root, head_commit,
             staged_diff_sha256, unstaged_diff_sha256, status_before_sha256,
             status_after_sha256, working_tree_fingerprint, staged_dirty, unstaged_dirty,
             entry_count, created_count, modified_count, deleted_count,
             type_changed_count, unmerged_count, captured_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reconciliation.reconciliationId,
          reconciliation.runId,
          reconciliation.workspaceId,
          reconciliation.conversationId,
          reconciliation.baselineId,
          reconciliation.triggerEventId,
          reconciliation.summaryEventId,
          reconciliation.boundary,
          reconciliation.outcome,
          reconciliation.diagnosticCode,
          reconciliation.attribution,
          reconciliation.baselineComparison,
          reconciliation.repositoryRoot,
          reconciliation.headCommit,
          reconciliation.stagedDiffSha256,
          reconciliation.unstagedDiffSha256,
          reconciliation.statusBeforeSha256,
          reconciliation.statusAfterSha256,
          reconciliation.workingTreeFingerprint,
          reconciliation.stagedDirty ? 1 : 0,
          reconciliation.unstagedDirty ? 1 : 0,
          reconciliation.entryCount,
          reconciliation.createdCount,
          reconciliation.modifiedCount,
          reconciliation.deletedCount,
          reconciliation.typeChangedCount,
          reconciliation.unmergedCount,
          reconciliation.capturedAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Git reconciliation");
    }
  }

  insertEntry(entry: NewGitReconciliationEntry): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO git_reconciliation_entries (
             reconciliation_id, entry_index, file_event_id, path_identity_sha256,
             relative_path, change_kind, staged, unstaged, sensitivity, attribution
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.reconciliationId,
          entry.entryIndex,
          entry.fileEventId,
          entry.pathIdentitySha256,
          entry.relativePath,
          entry.changeKind,
          entry.staged ? 1 : 0,
          entry.unstaged ? 1 : 0,
          entry.sensitivity,
          entry.attribution,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Git reconciliation entry");
    }
  }

  get(reconciliationId: string): GitReconciliation | null {
    const row = this.#database
      .prepare(`${RECONCILIATION_SELECT} WHERE reconciliation_id = ?`)
      .get(reconciliationId);
    return row === undefined ? null : this.#mapWithEntries(row);
  }

  getByTriggerEvent(triggerEventId: string): GitReconciliation | null {
    const row = this.#database
      .prepare(`${RECONCILIATION_SELECT} WHERE trigger_event_id = ?`)
      .get(triggerEventId);
    return row === undefined ? null : this.#mapWithEntries(row);
  }

  #mapWithEntries(row: SqliteRow): GitReconciliation {
    const reconciliationId = requiredString(row, "reconciliation_id");
    const entries = this.#database
      .prepare(
        `SELECT
           gre.reconciliation_id,
           gre.entry_index,
           gre.file_event_id,
           gre.path_identity_sha256,
           gre.relative_path,
           gre.change_kind,
           gre.staged,
           gre.unstaged,
           gre.sensitivity,
           gre.attribution,
           e.event_type AS file_event_type,
           e.source AS file_event_source,
           e.run_id AS file_event_run_id,
           e.conversation_id AS file_event_conversation_id,
           e.workspace_id AS file_event_workspace_id
         FROM git_reconciliation_entries gre
         JOIN events e ON e.event_id = gre.file_event_id
         WHERE gre.reconciliation_id = ?
         ORDER BY gre.entry_index ASC`,
      )
      .all(reconciliationId)
      .map((entryRow, index) => {
        const entry = mapEntry(entryRow);
        if (entry.entryIndex !== index) {
          throw new PersistenceError(
            "invalid_persisted_row",
            "The persisted Git reconciliation entry indices are not contiguous.",
          );
        }
        return { entry, row: entryRow };
      });
    const mappedEntries = entries.map(({ entry }) => entry);
    const reconciliation = mapReconciliation(row, mappedEntries);
    const countSum =
      reconciliation.createdCount +
      reconciliation.modifiedCount +
      reconciliation.deletedCount +
      reconciliation.typeChangedCount +
      reconciliation.unmergedCount;
    if (reconciliation.entryCount !== mappedEntries.length || countSum !== mappedEntries.length) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Git reconciliation counts are inconsistent.",
      );
    }
    if (mappedEntries.some((entry) => entry.attribution !== reconciliation.attribution)) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Git reconciliation entry attribution is inconsistent.",
      );
    }

    const expectedTriggerType = BOUNDARY_EVENT_TYPE[reconciliation.boundary];
    const linkedEvents = this.#database
      .prepare(
        `SELECT event_id, event_type, source, run_id, conversation_id, workspace_id
         FROM events
         WHERE event_id = ? OR event_id = ?`,
      )
      .all(reconciliation.triggerEventId, reconciliation.summaryEventId);
    const byId = new Map(linkedEvents.map((event) => [requiredString(event, "event_id"), event]));
    const trigger = byId.get(reconciliation.triggerEventId);
    const summary = byId.get(reconciliation.summaryEventId);
    if (
      trigger === undefined ||
      summary === undefined ||
      requiredString(trigger, "event_type") !== expectedTriggerType ||
      requiredString(summary, "event_type") !== "git.diff_computed" ||
      requiredString(summary, "source") !== "ownloop"
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Git reconciliation Event linkage is invalid.",
      );
    }
    for (const event of [trigger, summary]) {
      if (
        nullableString(event, "run_id") !== reconciliation.runId ||
        requiredString(event, "conversation_id") !== reconciliation.conversationId ||
        requiredString(event, "workspace_id") !== reconciliation.workspaceId
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Git reconciliation Event ownership is inconsistent.",
        );
      }
    }

    for (const { row: entryRow } of entries) {
      if (
        requiredString(entryRow, "file_event_type") !== "file.change_observed" ||
        requiredString(entryRow, "file_event_source") !== "ownloop" ||
        nullableString(entryRow, "file_event_run_id") !== reconciliation.runId ||
        requiredString(entryRow, "file_event_conversation_id") !== reconciliation.conversationId ||
        requiredString(entryRow, "file_event_workspace_id") !== reconciliation.workspaceId
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Git reconciliation file Event linkage is invalid.",
        );
      }
    }

    if (reconciliation.baselineId !== null) {
      const baseline = this.#database
        .prepare(
          `SELECT run_id, conversation_id, workspace_id
           FROM git_baselines WHERE baseline_id = ?`,
        )
        .get(reconciliation.baselineId);
      if (
        baseline === undefined ||
        requiredString(baseline, "run_id") !== reconciliation.runId ||
        requiredString(baseline, "conversation_id") !== reconciliation.conversationId ||
        requiredString(baseline, "workspace_id") !== reconciliation.workspaceId
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Git reconciliation baseline ownership is inconsistent.",
        );
      }
    }
    return reconciliation;
  }

  listEligibleUnreconciledTriggerEventIds(limit: number): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      return [];
    }
    return this.#database
      .prepare(
        `SELECT e.event_id
         FROM events e
         LEFT JOIN git_reconciliations gr ON gr.trigger_event_id = e.event_id
         WHERE e.run_id IS NOT NULL
           AND e.event_type IN ('tool.batch_completed', 'run.stop_observed', 'run.stop_failed')
           AND gr.trigger_event_id IS NULL
         ORDER BY e.ingested_at ASC, e.run_id ASC, e.sequence ASC, e.event_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((event) => requiredString(event, "event_id"));
  }

  countAll(): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM git_reconciliations").get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
