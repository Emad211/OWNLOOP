import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredNumber, requiredString } from "../row-mapping.js";

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
    const row = this.#database
      .prepare(
        `SELECT
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
         FROM task_runs
         WHERE run_id = ?`,
      )
      .get(runId);

    if (row === undefined) {
      return null;
    }

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

  delete(runId: string): boolean {
    return (
      this.#database.prepare("DELETE FROM task_runs WHERE run_id = ?").run(runId).changes === 1
    );
  }
}
