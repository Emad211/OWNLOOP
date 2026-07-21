import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { requiredNumber } from "../row-mapping.js";

export type EvidenceGapRecord = Readonly<{
  gapId: string;
  runId: string;
  code: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
}>;

export type AnalysisJobRecord = Readonly<{
  jobId: string;
  runId: string;
  kind: string;
  status: string;
  inputJson: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}>;

export class RunSupportRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insertEvidenceGap(gap: EvidenceGapRecord): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO evidence_gaps (
             gap_id,
             run_id,
             code,
             message,
             details_json,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(gap.gapId, gap.runId, gap.code, gap.message, gap.detailsJson, gap.createdAt);
    } catch (error) {
      mapPersistenceWriteError(error, "insert evidence gap");
    }
  }

  insertAnalysisJob(job: AnalysisJobRecord): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO analysis_jobs (
             job_id,
             run_id,
             kind,
             status,
             input_json,
             attempt_count,
             created_at,
             updated_at,
             last_error
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          job.jobId,
          job.runId,
          job.kind,
          job.status,
          job.inputJson,
          job.attemptCount,
          job.createdAt,
          job.updatedAt,
          job.lastError,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert analysis job");
    }
  }

  countEvidenceGaps(runId: string): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM evidence_gaps WHERE run_id = ?")
      .get(runId);
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  countAnalysisJobs(runId: string): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM analysis_jobs WHERE run_id = ?")
      .get(runId);
    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
