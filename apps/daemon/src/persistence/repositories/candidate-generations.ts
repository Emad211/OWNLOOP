import type { DatabaseSync } from "node:sqlite";

import {
  type CandidateGenerationRecordV1,
  CandidateGenerationRecordV1Schema,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

function parseRecordJson(row: SqliteRow): CandidateGenerationRecordV1 {
  const raw = requiredString(row, "record_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate generation record JSON is invalid.",
    );
  }
  const record = CandidateGenerationRecordV1Schema.parse(parsed);
  if (canonicalizeJson(record, DEFAULT_CANONICAL_INPUT_LIMITS) !== raw) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate generation record is not canonical.",
    );
  }
  if (
    record.generationId !== requiredString(row, "generation_id") ||
    record.generationKey !== requiredString(row, "generation_key") ||
    record.runId !== requiredString(row, "run_id") ||
    record.finalizationId !== requiredString(row, "finalization_id") ||
    record.semanticInputArtifactId !== requiredString(row, "semantic_input_artifact_id") ||
    record.requestFingerprint !== requiredString(row, "request_fingerprint") ||
    record.providerConfigFingerprint !== requiredString(row, "provider_config_fingerprint") ||
    record.status !== requiredString(row, "status") ||
    record.startedAt !== requiredString(row, "started_at") ||
    record.completedAt !== requiredString(row, "completed_at") ||
    record.attempts.length !== requiredNumber(row, "attempt_count")
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate generation index columns differ from its canonical record.",
    );
  }
  return record;
}

const SELECT_RECORD = `SELECT
  generation_id,
  generation_key,
  run_id,
  finalization_id,
  semantic_input_artifact_id,
  request_fingerprint,
  provider_config_fingerprint,
  status,
  started_at,
  completed_at,
  attempt_count,
  record_json
FROM candidate_generations`;

export class CandidateGenerationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(input: CandidateGenerationRecordV1): void {
    const record = CandidateGenerationRecordV1Schema.parse(input);
    try {
      this.#database
        .prepare(
          `INSERT INTO candidate_generations (
             generation_id,
             generation_key,
             run_id,
             finalization_id,
             semantic_input_artifact_id,
             candidate_artifact_id,
             candidate_artifact_role,
             request_fingerprint,
             provider_config_fingerprint,
             status,
             started_at,
             completed_at,
             attempt_count,
             record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.generationId,
          record.generationKey,
          record.runId,
          record.finalizationId,
          record.semanticInputArtifactId,
          record.candidateArtifactId,
          record.candidateArtifactRole,
          record.requestFingerprint,
          record.providerConfigFingerprint,
          record.status,
          record.startedAt,
          record.completedAt,
          record.attempts.length,
          canonicalizeJson(record, DEFAULT_CANONICAL_INPUT_LIMITS),
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Candidate generation");
    }
  }

  get(generationId: string): CandidateGenerationRecordV1 | null {
    const row = this.#database
      .prepare(`${SELECT_RECORD} WHERE generation_id = ?`)
      .get(generationId);
    return row === undefined ? null : parseRecordJson(row);
  }

  getSucceededByKey(generationKey: string): CandidateGenerationRecordV1 | null {
    const row = this.#database
      .prepare(`${SELECT_RECORD} WHERE generation_key = ? AND status = 'succeeded'`)
      .get(generationKey);
    return row === undefined ? null : parseRecordJson(row);
  }

  listForRun(runId: string, limit = 100): readonly CandidateGenerationRecordV1[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return [];
    return this.#database
      .prepare(
        `${SELECT_RECORD}
         WHERE run_id = ?
         ORDER BY completed_at ASC, generation_id ASC
         LIMIT ?`,
      )
      .all(runId, limit)
      .map(parseRecordJson);
  }

  listSemanticInputRunIds(limit: number): readonly string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) return [];
    return this.#database
      .prepare(
        `SELECT ra.run_id
         FROM run_artifacts ra
         JOIN run_finalizations rf ON rf.run_id = ra.run_id
         JOIN task_runs tr ON tr.run_id = ra.run_id
         WHERE ra.role = 'reduced-semantic-analysis-input-v1'
           AND tr.status IN ('Completed', 'Partial', 'Abandoned', 'Failed')
         ORDER BY rf.finalized_at ASC, ra.run_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => requiredString(row, "run_id"));
  }
}
