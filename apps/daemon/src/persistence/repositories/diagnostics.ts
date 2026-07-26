import type { DatabaseSync } from "node:sqlite";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  INGRESS_CANONICALIZATION_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  type DiagnosticsRedactionAggregatesV1,
  DiagnosticsRedactionAggregatesV1Schema,
  RedactionSummaryV1Schema,
} from "@ownloop/contracts";

import { PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString } from "../row-mapping.js";

const MAX_DIAGNOSTIC_ROWS = 100_000;
const MAX_VALIDATION_ROWS = 10_000;

export type DiagnosticsRunIndexRow = Readonly<{
  runId: string;
  conversationId: string;
  runNumber: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  evidenceGapCount: number;
}>;

export type DiagnosticsFinalizationRow = Readonly<{
  runId: string;
  terminalStatus: string;
  mode: string;
  diagnosticCode: string | null;
  finalizedAt: string;
}>;

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedCounts(
  map: ReadonlyMap<string, number>,
): readonly Readonly<{ code: string; count: number }>[] {
  return [...map]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));
}

function parseSummary(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A persisted redaction summary contains invalid JSON.",
    );
  }
  const parsed = RedactionSummaryV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A persisted redaction summary violates its runtime contract.",
    );
  }
  return parsed.data;
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

export class DiagnosticsRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  readRedactionAggregates(): DiagnosticsRedactionAggregatesV1 {
    const totalRow = this.#database.prepare("SELECT count(*) AS count FROM ingress_receipts").get();
    const total = totalRow === undefined ? 0 : requiredNumber(totalRow, "count");
    if (total > MAX_DIAGNOSTIC_ROWS) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The ingress receipt population exceeds the diagnostics aggregate bound.",
      );
    }

    const rows = this.#database
      .prepare(
        `SELECT source_event_name, canonicalization_version, redaction_summary_json
         FROM ingress_receipts
         ORDER BY created_at ASC, receipt_id ASC`,
      )
      .all();

    let preparedReceiptCount = 0;
    let legacyReceiptCount = 0;
    let redactedFieldCount = 0;
    let redactedValueCount = 0;
    let pathReplacementCount = 0;
    let droppedUnknownFieldCount = 0;
    let truncatedValueCount = 0;
    const receiptsByHook = new Map<string, number>();
    const receiptsByRule = new Map<string, number>();

    for (const row of rows) {
      increment(receiptsByHook, requiredString(row, "source_event_name"));
      const canonicalizationVersion = row.canonicalization_version;
      const rawSummary = row.redaction_summary_json;
      if (canonicalizationVersion === null && rawSummary === null) {
        legacyReceiptCount += 1;
        continue;
      }
      if (typeof canonicalizationVersion !== "number" || typeof rawSummary !== "string") {
        throw new PersistenceError(
          "invalid_persisted_row",
          "Prepared ingress receipt diagnostics metadata is incomplete.",
        );
      }
      if (canonicalizationVersion !== INGRESS_CANONICALIZATION_VERSION) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "A prepared ingress receipt uses an unsupported canonicalization version.",
        );
      }
      const summary = parseSummary(rawSummary);
      preparedReceiptCount += 1;
      redactedFieldCount += summary.redactedFieldCount;
      redactedValueCount += summary.redactedValueCount;
      pathReplacementCount += summary.pathReplacementCount;
      droppedUnknownFieldCount += summary.droppedUnknownFieldCount;
      truncatedValueCount += summary.truncatedValueCount;
      for (const rule of summary.rulesApplied) increment(receiptsByRule, rule);
    }

    return DiagnosticsRedactionAggregatesV1Schema.parse({
      preparedReceiptCount,
      legacyReceiptCount,
      redactedFieldCount,
      redactedValueCount,
      pathReplacementCount,
      droppedUnknownFieldCount,
      truncatedValueCount,
      receiptsByHook: [...receiptsByHook]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([hookName, count]) => ({ hookName, count })),
      receiptsByRule: sortedCounts(receiptsByRule),
    });
  }

  countRuns(): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM task_runs").get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  countRunsByStatus(): readonly Readonly<{ status: string; count: number }>[] {
    return this.#database
      .prepare(
        `SELECT status, count(*) AS count
         FROM task_runs
         GROUP BY status
         ORDER BY status ASC`,
      )
      .all()
      .map((row) => ({
        status: requiredString(row, "status"),
        count: requiredNumber(row, "count"),
      }));
  }

  listRecentRuns(limit: number): readonly DiagnosticsRunIndexRow[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return [];
    return this.#database
      .prepare(
        `SELECT run_id, conversation_id, run_number, status, started_at, ended_at,
                evidence_gap_count
         FROM task_runs
         ORDER BY started_at DESC, conversation_id ASC, run_number DESC, run_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        runId: requiredString(row, "run_id"),
        conversationId: requiredString(row, "conversation_id"),
        runNumber: requiredNumber(row, "run_number"),
        status: requiredString(row, "status"),
        startedAt: requiredString(row, "started_at"),
        endedAt: nullableString(row, "ended_at"),
        evidenceGapCount: requiredNumber(row, "evidence_gap_count"),
      }));
  }

  listFinalizations(): readonly DiagnosticsFinalizationRow[] {
    const countRow = this.#database
      .prepare("SELECT count(*) AS count FROM run_finalizations")
      .get();
    const count = countRow === undefined ? 0 : requiredNumber(countRow, "count");
    if (count > MAX_DIAGNOSTIC_ROWS) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The finalization population exceeds the diagnostics aggregate bound.",
      );
    }
    return this.#database
      .prepare(
        `SELECT run_id, terminal_status, mode, diagnostic_code, finalized_at
         FROM run_finalizations
         ORDER BY finalized_at ASC, run_id ASC`,
      )
      .all()
      .map((row) => ({
        runId: requiredString(row, "run_id"),
        terminalStatus: requiredString(row, "terminal_status"),
        mode: requiredString(row, "mode"),
        diagnosticCode: nullableString(row, "diagnostic_code"),
        finalizedAt: requiredString(row, "finalized_at"),
      }));
  }

  listEvidenceGapCodes(): readonly string[] {
    const countRow = this.#database.prepare("SELECT count(*) AS count FROM evidence_gaps").get();
    const count = countRow === undefined ? 0 : requiredNumber(countRow, "count");
    if (count > MAX_DIAGNOSTIC_ROWS) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Evidence-gap population exceeds the diagnostics aggregate bound.",
      );
    }
    return this.#database
      .prepare("SELECT code FROM evidence_gaps ORDER BY created_at ASC, gap_id ASC")
      .all()
      .map((row) => requiredString(row, "code"));
  }

  listLatestCurrentValidationIds(): readonly string[] {
    const rows = this.#database
      .prepare(
        `WITH current_validations AS (
           SELECT validation_id, run_id, created_at,
                  row_number() OVER (
                    PARTITION BY run_id ORDER BY created_at DESC, validation_id DESC
                  ) AS rank_for_run
           FROM candidate_validations
           WHERE ${CURRENT_VALIDATION_VERSION_PREDICATE}
         )
         SELECT validation_id
         FROM current_validations
         WHERE rank_for_run = 1
         ORDER BY run_id ASC
         LIMIT ?`,
      )
      .all(...CURRENT_VALIDATION_VERSION_PARAMETERS, MAX_VALIDATION_ROWS + 1);
    if (rows.length > MAX_VALIDATION_ROWS) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The current validation population exceeds the diagnostics aggregate bound.",
      );
    }
    return rows.map((row) => requiredString(row, "validation_id"));
  }
}
