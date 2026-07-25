import type { DatabaseSync } from "node:sqlite";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  type CandidateValidationRecordV1,
  CandidateValidationRecordV1Schema,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

function parseRecordJson(row: SqliteRow): CandidateValidationRecordV1 {
  const raw = requiredString(row, "record_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate validation record JSON is invalid.",
    );
  }
  const record = CandidateValidationRecordV1Schema.parse(parsed);
  if (canonicalizeJson(record, DEFAULT_CANONICAL_INPUT_LIMITS) !== raw) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate validation record is not canonical.",
    );
  }
  if (
    record.validationId !== requiredString(row, "validation_id") ||
    record.validationKey !== requiredString(row, "validation_key") ||
    record.runId !== requiredString(row, "run_id") ||
    record.finalizationId !== requiredString(row, "finalization_id") ||
    record.generationId !== requiredString(row, "generation_id") ||
    record.sourceCandidateArtifactId !== requiredString(row, "source_candidate_artifact_id") ||
    record.evidenceGraphArtifactId !== requiredString(row, "evidence_graph_artifact_id") ||
    record.reportArtifactId !== requiredString(row, "report_artifact_id") ||
    record.outcome !== requiredString(row, "outcome") ||
    record.counts.selected !== requiredNumber(row, "selected_count") ||
    record.createdAt !== requiredString(row, "created_at")
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted Candidate validation index columns differ from its canonical record.",
    );
  }
  return record;
}

const CURRENT_VALIDATION_VERSION_PREDICATE = `
  json_extract(record_json, '$.schemaVersion') = ?
  AND json_extract(record_json, '$.validatorVersion') = ?
  AND json_extract(record_json, '$.supportPolicyVersion') = ?
  AND json_extract(record_json, '$.contradictionPolicyVersion') = ?
  AND json_extract(record_json, '$.absencePolicyVersion') = ?
  AND json_extract(record_json, '$.duplicatePolicyVersion') = ?
  AND json_extract(record_json, '$.rankingPolicyVersion') = ?
  AND json_extract(record_json, '$.selectionPolicyVersion') = ?`;

const CURRENT_VALIDATION_VERSION_PARAMETERS = Object.freeze([
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
] as const);

const SELECT_RECORD = `SELECT
  validation_id,
  validation_key,
  run_id,
  finalization_id,
  generation_id,
  source_candidate_artifact_id,
  evidence_graph_artifact_id,
  report_artifact_id,
  outcome,
  selected_count,
  created_at,
  record_json
FROM candidate_validations`;

export class CandidateValidationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(input: CandidateValidationRecordV1): void {
    const record = CandidateValidationRecordV1Schema.parse(input);
    try {
      this.#database
        .prepare(
          `INSERT INTO candidate_validations (
             validation_id,
             validation_key,
             run_id,
             finalization_id,
             generation_id,
             source_candidate_artifact_id,
             source_candidate_fingerprint,
             evidence_graph_artifact_id,
             evidence_graph_input_fingerprint,
             report_artifact_id,
             report_artifact_role,
             report_fingerprint,
             outcome,
             selected_count,
             created_at,
             record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.validationId,
          record.validationKey,
          record.runId,
          record.finalizationId,
          record.generationId,
          record.sourceCandidateArtifactId,
          record.sourceCandidateFingerprint,
          record.evidenceGraphArtifactId,
          record.evidenceGraphInputFingerprint,
          record.reportArtifactId,
          record.reportArtifactRole,
          record.reportFingerprint,
          record.outcome,
          record.counts.selected,
          record.createdAt,
          canonicalizeJson(record, DEFAULT_CANONICAL_INPUT_LIMITS),
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Candidate validation");
    }
  }

  get(validationId: string): CandidateValidationRecordV1 | null {
    const row = this.#database
      .prepare(`${SELECT_RECORD} WHERE validation_id = ?`)
      .get(validationId);
    return row === undefined ? null : parseRecordJson(row);
  }

  getByKey(validationKey: string): CandidateValidationRecordV1 | null {
    const row = this.#database
      .prepare(`${SELECT_RECORD} WHERE validation_key = ?`)
      .get(validationKey);
    return row === undefined ? null : parseRecordJson(row);
  }

  listForRun(runId: string, limit = 100): readonly CandidateValidationRecordV1[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return [];
    return this.#database
      .prepare(
        `${SELECT_RECORD}
         WHERE run_id = ?
           AND ${CURRENT_VALIDATION_VERSION_PREDICATE}
         ORDER BY created_at ASC, validation_id ASC
         LIMIT ?`,
      )
      .all(runId, ...CURRENT_VALIDATION_VERSION_PARAMETERS, limit)
      .map(parseRecordJson);
  }

  listUnvalidatedGenerationIds(limit: number): readonly string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) return [];
    return this.#database
      .prepare(
        `SELECT cg.generation_id
         FROM candidate_generations cg
         WHERE cg.status = 'succeeded'
           AND NOT EXISTS (
             SELECT 1 FROM candidate_validations cv
             WHERE cv.generation_id = cg.generation_id
               AND ${CURRENT_VALIDATION_VERSION_PREDICATE.replaceAll("record_json", "cv.record_json")}
           )
         ORDER BY cg.completed_at ASC, cg.generation_id ASC
         LIMIT ?`,
      )
      .all(...CURRENT_VALIDATION_VERSION_PARAMETERS, limit)
      .map((row) => requiredString(row, "generation_id"));
  }
}
