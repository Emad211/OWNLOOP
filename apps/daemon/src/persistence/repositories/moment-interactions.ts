import type { DatabaseSync } from "node:sqlite";

import {
  type MomentInteractionActionV1,
  type MomentInteractionRecordV1,
  MomentInteractionRecordV1Schema,
  type MomentInteractionStateV1,
  MomentInteractionStateV1Schema,
  type OwnershipRecordV1,
  OwnershipRecordV1Schema,
} from "@ownloop/contracts";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

function actionColumns(action: MomentInteractionActionV1): readonly [string | null, string | null] {
  switch (action.kind) {
    case "moment_viewed":
      return [null, null];
    case "evidence_viewed":
      return [action.evidenceId, null];
    case "acknowledgement_set":
      return [null, action.value ? "true" : "false"];
    case "decision_response_set":
    case "risk_response_set":
    case "usefulness_set":
      return [null, action.value];
    case "check_answer_set":
      return [null, action.choiceId];
  }
}

function rowAction(row: SqliteRow): MomentInteractionActionV1 {
  const kind = requiredString(row, "action_kind");
  const evidenceId = nullableString(row, "evidence_id");
  const valueCode = nullableString(row, "value_code");
  switch (kind) {
    case "moment_viewed":
      return { kind };
    case "evidence_viewed":
      if (evidenceId === null) throw invalidRow();
      return { kind, evidenceId };
    case "acknowledgement_set":
      if (valueCode !== "true" && valueCode !== "false") throw invalidRow();
      return { kind, value: valueCode === "true" };
    case "decision_response_set":
      if (valueCode !== "confirm" && valueCode !== "revise" && valueCode !== "uncertain") {
        throw invalidRow();
      }
      return { kind, value: valueCode };
    case "risk_response_set":
      if (valueCode !== "acknowledge" && valueCode !== "mitigate" && valueCode !== "dismiss") {
        throw invalidRow();
      }
      return { kind, value: valueCode };
    case "check_answer_set":
      if (valueCode === null) throw invalidRow();
      return { kind, choiceId: valueCode };
    case "usefulness_set":
      if (valueCode !== "useful" && valueCode !== "not_useful" && valueCode !== "unset") {
        throw invalidRow();
      }
      return { kind, value: valueCode };
    default:
      throw invalidRow();
  }
}

function invalidRow(): PersistenceError {
  return new PersistenceError(
    "invalid_persisted_row",
    "The persisted Moment interaction row is invalid.",
  );
}

const INTERACTION_SELECT = `SELECT
  interaction_id, actor, run_id, validation_id, moment_id, source_index,
  source_candidate_fingerprint, moment_type, action_kind, evidence_id, value_code,
  request_fingerprint, schema_version, created_at
FROM moment_interactions`;

function parseInteraction(row: SqliteRow): MomentInteractionRecordV1 {
  return MomentInteractionRecordV1Schema.parse({
    schemaVersion: requiredNumber(row, "schema_version"),
    interactionId: requiredString(row, "interaction_id"),
    actor: requiredString(row, "actor"),
    runId: requiredString(row, "run_id"),
    validationId: requiredString(row, "validation_id"),
    momentId: requiredString(row, "moment_id"),
    sourceIndex: requiredNumber(row, "source_index"),
    sourceCandidateFingerprint: requiredString(row, "source_candidate_fingerprint"),
    momentType: requiredString(row, "moment_type"),
    action: rowAction(row),
    requestFingerprint: requiredString(row, "request_fingerprint"),
    createdAt: requiredString(row, "created_at"),
  });
}

const OWNERSHIP_SELECT = `SELECT
  record_id, interaction_id, actor, run_id, validation_id, moment_id, source_index,
  source_candidate_fingerprint, moment_type, record_kind, value_code, assertion_code,
  no_comprehension_claim, schema_version, created_at
FROM ownership_records`;

function parseOwnership(row: SqliteRow): OwnershipRecordV1 {
  return OwnershipRecordV1Schema.parse({
    schemaVersion: requiredNumber(row, "schema_version"),
    recordId: requiredString(row, "record_id"),
    interactionId: requiredString(row, "interaction_id"),
    actor: requiredString(row, "actor"),
    runId: requiredString(row, "run_id"),
    validationId: requiredString(row, "validation_id"),
    momentId: requiredString(row, "moment_id"),
    sourceIndex: requiredNumber(row, "source_index"),
    sourceCandidateFingerprint: requiredString(row, "source_candidate_fingerprint"),
    momentType: requiredString(row, "moment_type"),
    recordKind: requiredString(row, "record_kind"),
    valueCode: requiredString(row, "value_code"),
    assertionCode: requiredString(row, "assertion_code"),
    noComprehensionClaim: requiredNumber(row, "no_comprehension_claim") === 1,
    createdAt: requiredString(row, "created_at"),
  });
}

function parseState(row: SqliteRow): MomentInteractionStateV1 {
  const minSource = requiredNumber(row, "min_source_index");
  const maxSource = requiredNumber(row, "max_source_index");
  const minFingerprint = requiredString(row, "min_source_candidate_fingerprint");
  const maxFingerprint = requiredString(row, "max_source_candidate_fingerprint");
  const minType = requiredString(row, "min_moment_type");
  const maxType = requiredString(row, "max_moment_type");
  if (minSource !== maxSource || minFingerprint !== maxFingerprint || minType !== maxType) {
    throw invalidRow();
  }
  const acknowledgement = nullableString(row, "acknowledgement");
  if (acknowledgement !== null && acknowledgement !== "true" && acknowledgement !== "false") {
    throw invalidRow();
  }
  return MomentInteractionStateV1Schema.parse({
    momentId: requiredString(row, "moment_id"),
    sourceIndex: minSource,
    sourceCandidateFingerprint: minFingerprint,
    momentType: minType,
    viewCount: requiredNumber(row, "view_count"),
    evidenceViewCount: requiredNumber(row, "evidence_view_count"),
    acknowledgement: acknowledgement === null ? null : acknowledgement === "true",
    decisionResponse: nullableString(row, "decision_response"),
    riskResponse: nullableString(row, "risk_response"),
    checkChoiceId: nullableString(row, "check_choice_id"),
    usefulness: nullableString(row, "usefulness") ?? "unset",
    latestInteractionAt: nullableString(row, "latest_interaction_at"),
    interactionCount: requiredNumber(row, "interaction_count"),
    ownershipRecordCount: requiredNumber(row, "ownership_record_count"),
  });
}

export class MomentInteractionRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insertInteraction(input: MomentInteractionRecordV1): void {
    const record = MomentInteractionRecordV1Schema.parse(input);
    const [evidenceId, valueCode] = actionColumns(record.action);
    try {
      this.#database
        .prepare(
          `INSERT INTO moment_interactions (
             interaction_id, actor, run_id, validation_id, moment_id, source_index,
             source_candidate_fingerprint, moment_type, action_kind, evidence_id, value_code,
             request_fingerprint, schema_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.interactionId,
          record.actor,
          record.runId,
          record.validationId,
          record.momentId,
          record.sourceIndex,
          record.sourceCandidateFingerprint,
          record.momentType,
          record.action.kind,
          evidenceId,
          valueCode,
          record.requestFingerprint,
          record.schemaVersion,
          record.createdAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Moment interaction");
    }
  }

  insertOwnershipRecord(input: OwnershipRecordV1): void {
    const record = OwnershipRecordV1Schema.parse(input);
    try {
      this.#database
        .prepare(
          `INSERT INTO ownership_records (
             record_id, interaction_id, actor, run_id, validation_id, moment_id, source_index,
             source_candidate_fingerprint, moment_type, record_kind, value_code, assertion_code,
             no_comprehension_claim, schema_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.recordId,
          record.interactionId,
          record.actor,
          record.runId,
          record.validationId,
          record.momentId,
          record.sourceIndex,
          record.sourceCandidateFingerprint,
          record.momentType,
          record.recordKind,
          record.valueCode,
          record.assertionCode,
          record.noComprehensionClaim ? 1 : 0,
          record.schemaVersion,
          record.createdAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Ownership Record");
    }
  }

  getInteraction(interactionId: string): MomentInteractionRecordV1 | null {
    const row = this.#database
      .prepare(`${INTERACTION_SELECT} WHERE interaction_id = ?`)
      .get(interactionId);
    return row === undefined ? null : parseInteraction(row);
  }

  getOwnershipRecordForInteraction(interactionId: string): OwnershipRecordV1 | null {
    const row = this.#database
      .prepare(`${OWNERSHIP_SELECT} WHERE interaction_id = ?`)
      .get(interactionId);
    return row === undefined ? null : parseOwnership(row);
  }

  listStates(runId: string, validationId: string): readonly MomentInteractionStateV1[] {
    const rows = this.#database
      .prepare(
        `SELECT
           mi.moment_id,
           MIN(mi.source_index) AS min_source_index,
           MAX(mi.source_index) AS max_source_index,
           MIN(mi.source_candidate_fingerprint) AS min_source_candidate_fingerprint,
           MAX(mi.source_candidate_fingerprint) AS max_source_candidate_fingerprint,
           MIN(mi.moment_type) AS min_moment_type,
           MAX(mi.moment_type) AS max_moment_type,
           SUM(CASE WHEN mi.action_kind = 'moment_viewed' THEN 1 ELSE 0 END) AS view_count,
           SUM(CASE WHEN mi.action_kind = 'evidence_viewed' THEN 1 ELSE 0 END) AS evidence_view_count,
           (
             SELECT latest.value_code FROM moment_interactions latest
             WHERE latest.run_id = mi.run_id AND latest.validation_id = mi.validation_id
               AND latest.moment_id = mi.moment_id AND latest.action_kind = 'acknowledgement_set'
             ORDER BY latest.created_at DESC, latest.interaction_id DESC LIMIT 1
           ) AS acknowledgement,
           (
             SELECT latest.value_code FROM moment_interactions latest
             WHERE latest.run_id = mi.run_id AND latest.validation_id = mi.validation_id
               AND latest.moment_id = mi.moment_id AND latest.action_kind = 'decision_response_set'
             ORDER BY latest.created_at DESC, latest.interaction_id DESC LIMIT 1
           ) AS decision_response,
           (
             SELECT latest.value_code FROM moment_interactions latest
             WHERE latest.run_id = mi.run_id AND latest.validation_id = mi.validation_id
               AND latest.moment_id = mi.moment_id AND latest.action_kind = 'risk_response_set'
             ORDER BY latest.created_at DESC, latest.interaction_id DESC LIMIT 1
           ) AS risk_response,
           (
             SELECT latest.value_code FROM moment_interactions latest
             WHERE latest.run_id = mi.run_id AND latest.validation_id = mi.validation_id
               AND latest.moment_id = mi.moment_id AND latest.action_kind = 'check_answer_set'
             ORDER BY latest.created_at DESC, latest.interaction_id DESC LIMIT 1
           ) AS check_choice_id,
           (
             SELECT latest.value_code FROM moment_interactions latest
             WHERE latest.run_id = mi.run_id AND latest.validation_id = mi.validation_id
               AND latest.moment_id = mi.moment_id AND latest.action_kind = 'usefulness_set'
             ORDER BY latest.created_at DESC, latest.interaction_id DESC LIMIT 1
           ) AS usefulness,
           MAX(mi.created_at) AS latest_interaction_at,
           COUNT(*) AS interaction_count,
           (SELECT COUNT(*) FROM ownership_records o
             WHERE o.run_id = mi.run_id AND o.validation_id = mi.validation_id
               AND o.moment_id = mi.moment_id) AS ownership_record_count
         FROM moment_interactions mi
         WHERE mi.run_id = ? AND mi.validation_id = ?
         GROUP BY mi.run_id, mi.validation_id, mi.moment_id
         ORDER BY mi.moment_id ASC
         LIMIT 8`,
      )
      .all(runId, validationId);
    return rows.map(parseState);
  }

  listRecentInteractions(
    runId: string,
    validationId: string,
    limit: number,
  ): readonly MomentInteractionRecordV1[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) return [];
    return this.#database
      .prepare(
        `${INTERACTION_SELECT}
         WHERE run_id = ? AND validation_id = ?
         ORDER BY created_at DESC, interaction_id DESC
         LIMIT ?`,
      )
      .all(runId, validationId, limit)
      .map(parseInteraction)
      .reverse();
  }

  listRecentOwnershipRecords(
    runId: string,
    validationId: string,
    limit: number,
  ): readonly OwnershipRecordV1[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) return [];
    return this.#database
      .prepare(
        `${OWNERSHIP_SELECT}
         WHERE run_id = ? AND validation_id = ?
         ORDER BY created_at DESC, record_id DESC
         LIMIT ?`,
      )
      .all(runId, validationId, limit)
      .map(parseOwnership)
      .reverse();
  }

  listDistinctEvidenceIds(
    runId: string,
    validationId: string,
    momentId: string,
    limit = 97,
  ): readonly string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 97) return [];
    return this.#database
      .prepare(
        `SELECT DISTINCT evidence_id
         FROM moment_interactions
         WHERE run_id = ? AND validation_id = ? AND moment_id = ?
           AND action_kind = 'evidence_viewed'
         ORDER BY evidence_id ASC
         LIMIT ?`,
      )
      .all(runId, validationId, momentId, limit)
      .map((row) => requiredString(row, "evidence_id"));
  }

  listDistinctCheckChoiceIds(
    runId: string,
    validationId: string,
    momentId: string,
    limit = 6,
  ): readonly string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 6) return [];
    return this.#database
      .prepare(
        `SELECT DISTINCT value_code
         FROM moment_interactions
         WHERE run_id = ? AND validation_id = ? AND moment_id = ?
           AND action_kind = 'check_answer_set'
         ORDER BY value_code ASC
         LIMIT ?`,
      )
      .all(runId, validationId, momentId, limit)
      .map((row) => requiredString(row, "value_code"));
  }

  countInteractions(runId: string, validationId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM moment_interactions WHERE run_id = ? AND validation_id = ?",
      )
      .get(runId, validationId);
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  countOwnershipRecords(runId: string, validationId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM ownership_records WHERE run_id = ? AND validation_id = ?",
      )
      .get(runId, validationId);
    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
