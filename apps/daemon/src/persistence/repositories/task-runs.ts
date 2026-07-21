import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const TASK_RUN_STATUSES = [
  "Capturing",
  "Finalizing",
  "Completed",
  "Partial",
  "Abandoned",
  "Failed",
] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export type TaskRun = Readonly<{
  runId: string;
  conversationId: string;
  runNumber: number;
  redactedPrompt: string;
  baselineGitCommit: string | null;
  baselineWorkingTreeFingerprint: string | null;
  startedAt: string;
  endedAt: string | null;
  status: TaskRunStatus;
  finalGitFingerprint: string | null;
  sourceStopReason: string | null;
  evidenceGapCount: number;
}>;

export type NewTaskRun = TaskRun;

export type StaleTaskRun = Readonly<{
  run: TaskRun;
  conversationLastObservedAt: string;
}>;

function mapTaskRun(row: SqliteRow): TaskRun {
  return {
    runId: requiredString(row, "run_id"),
    conversationId: requiredString(row, "conversation_id"),
    runNumber: requiredNumber(row, "run_number"),
    redactedPrompt: requiredString(row, "redacted_prompt"),
    baselineGitCommit: nullableString(row, "baseline_git_commit"),
    baselineWorkingTreeFingerprint: nullableString(row, "baseline_working_tree_fingerprint"),
    startedAt: requiredString(row, "started_at"),
    endedAt: nullableString(row, "ended_at"),
    status: requiredString(row, "status") as TaskRunStatus,
    finalGitFingerprint: nullableString(row, "final_git_fingerprint"),
    sourceStopReason: nullableString(row, "source_stop_reason"),
    evidenceGapCount: requiredNumber(row, "evidence_gap_count"),
  };
}

const TASK_RUN_SELECT = `SELECT
  run_id,
  conversation_id,
  run_number,
  redacted_prompt,
  baseline_git_commit,
  baseline_working_tree_fingerprint,
  started_at,
  ended_at,
  status,
  final_git_fingerprint,
  source_stop_reason,
  evidence_gap_count
FROM task_runs`;

export class TaskRunRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(run: NewTaskRun): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO task_runs (
             run_id,
             conversation_id,
             run_number,
             redacted_prompt,
             baseline_git_commit,
             baseline_working_tree_fingerprint,
             started_at,
             ended_at,
             status,
             final_git_fingerprint,
             source_stop_reason,
             evidence_gap_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.runId,
          run.conversationId,
          run.runNumber,
          run.redactedPrompt,
          run.baselineGitCommit,
          run.baselineWorkingTreeFingerprint,
          run.startedAt,
          run.endedAt,
          run.status,
          run.finalGitFingerprint,
          run.sourceStopReason,
          run.evidenceGapCount,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Task Run");
    }
  }

  get(runId: string): TaskRun | null {
    const row = this.#database.prepare(`${TASK_RUN_SELECT} WHERE run_id = ?`).get(runId);
    return row === undefined ? null : mapTaskRun(row);
  }

  listForConversation(conversationId: string): TaskRun[] {
    return this.#database
      .prepare(`${TASK_RUN_SELECT} WHERE conversation_id = ? ORDER BY run_number ASC`)
      .all(conversationId)
      .map(mapTaskRun);
  }

  getLatestActive(conversationId: string): TaskRun | null {
    const row = this.#database
      .prepare(
        `${TASK_RUN_SELECT}
         WHERE conversation_id = ? AND status IN ('Capturing', 'Finalizing')
         ORDER BY run_number DESC
         LIMIT 1`,
      )
      .get(conversationId);
    return row === undefined ? null : mapTaskRun(row);
  }

  nextRunNumber(conversationId: string): number {
    const row = this.#database
      .prepare(
        `SELECT coalesce(max(run_number), 0) + 1 AS next_run_number
         FROM task_runs
         WHERE conversation_id = ?`,
      )
      .get(conversationId);
    return row === undefined ? 1 : requiredNumber(row, "next_run_number");
  }

  abandonCapturing(conversationId: string, endedAt: string, reason: string): number {
    return Number(
      this.#database
        .prepare(
          `UPDATE task_runs
           SET ended_at = ?, status = 'Abandoned', source_stop_reason = ?
           WHERE conversation_id = ? AND status = 'Capturing'`,
        )
        .run(endedAt, reason, conversationId).changes,
    );
  }

  transitionToFinalizing(runId: string, sourceStopReason: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE task_runs
           SET status = 'Finalizing',
               source_stop_reason = CASE
                 WHEN ? <> 'stop' THEN ?
                 WHEN source_stop_reason IS NULL THEN 'stop'
                 ELSE source_stop_reason
               END
           WHERE run_id = ? AND status IN ('Capturing', 'Finalizing')`,
        )
        .run(sourceStopReason, sourceStopReason, runId).changes === 1
    );
  }

  applyBaseline(
    runId: string,
    baselineGitCommit: string | null,
    baselineWorkingTreeFingerprint: string,
  ): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE task_runs
           SET baseline_git_commit = ?, baseline_working_tree_fingerprint = ?
           WHERE run_id = ?
             AND baseline_git_commit IS NULL
             AND baseline_working_tree_fingerprint IS NULL`,
        )
        .run(baselineGitCommit, baselineWorkingTreeFingerprint, runId).changes === 1
    );
  }

  incrementEvidenceGapCount(runId: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE task_runs
           SET evidence_gap_count = evidence_gap_count + 1
           WHERE run_id = ?`,
        )
        .run(runId).changes === 1
    );
  }

  listStaleActive(cutoff: string, limit: number): StaleTaskRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      return [];
    }
    const rows = this.#database
      .prepare(
        `SELECT
           tr.run_id,
           tr.conversation_id,
           tr.run_number,
           tr.redacted_prompt,
           tr.baseline_git_commit,
           tr.baseline_working_tree_fingerprint,
           tr.started_at,
           tr.ended_at,
           tr.status,
           tr.final_git_fingerprint,
           tr.source_stop_reason,
           tr.evidence_gap_count,
           ac.last_observed_at AS conversation_last_observed_at
         FROM task_runs tr
         JOIN agent_conversations ac ON ac.conversation_id = tr.conversation_id
         WHERE tr.status IN ('Capturing', 'Finalizing')
           AND ac.last_observed_at < ?
         ORDER BY ac.last_observed_at ASC, tr.conversation_id ASC, tr.run_number ASC
         LIMIT ?`,
      )
      .all(cutoff, limit);
    return rows.map((row) => ({
      run: mapTaskRun(row),
      conversationLastObservedAt: requiredString(row, "conversation_last_observed_at"),
    }));
  }

  delete(runId: string): boolean {
    return (
      this.#database.prepare("DELETE FROM task_runs WHERE run_id = ?").run(runId).changes === 1
    );
  }
}
