import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const EVENT_NORMALIZATION_OUTCOMES = ["normalized", "skipped", "failed"] as const;
export type EventNormalizationOutcome = (typeof EVENT_NORMALIZATION_OUTCOMES)[number];

export const EVENT_NORMALIZATION_DIAGNOSTIC_CODES = [
  "lifecycle_failed",
  "legacy_receipt_unsupported",
  "invalid_redacted_payload",
  "missing_lifecycle_resolution",
  "invalid_event_mapping",
  "normalization_processing_failed",
] as const;
export type EventNormalizationDiagnosticCode =
  (typeof EVENT_NORMALIZATION_DIAGNOSTIC_CODES)[number];

export type ReceiptEventNormalization = Readonly<{
  receiptId: string;
  outcome: EventNormalizationOutcome;
  eventCount: number;
  diagnosticCode: EventNormalizationDiagnosticCode | null;
  normalizedAt: string;
  eventIds: readonly string[];
}>;

export type NewReceiptEventNormalization = Omit<ReceiptEventNormalization, "eventIds">;

function mapNormalization(row: SqliteRow, eventIds: readonly string[]): ReceiptEventNormalization {
  return {
    receiptId: requiredString(row, "receipt_id"),
    outcome: requiredString(row, "outcome") as EventNormalizationOutcome,
    eventCount: requiredNumber(row, "event_count"),
    diagnosticCode: nullableString(
      row,
      "diagnostic_code",
    ) as EventNormalizationDiagnosticCode | null,
    normalizedAt: requiredString(row, "normalized_at"),
    eventIds,
  };
}

export class EventNormalizationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(normalization: NewReceiptEventNormalization): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO receipt_event_normalizations (
             receipt_id, outcome, event_count, diagnostic_code, normalized_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          normalization.receiptId,
          normalization.outcome,
          normalization.eventCount,
          normalization.diagnosticCode,
          normalization.normalizedAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert receipt event normalization");
    }
  }

  linkEvent(receiptId: string, eventIndex: number, eventId: string): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO receipt_normalized_events (receipt_id, event_index, event_id)
           VALUES (?, ?, ?)`,
        )
        .run(receiptId, eventIndex, eventId);
    } catch (error) {
      mapPersistenceWriteError(error, "link receipt normalized event");
    }
  }

  get(receiptId: string): ReceiptEventNormalization | null {
    const row = this.#database
      .prepare(
        `SELECT receipt_id, outcome, event_count, diagnostic_code, normalized_at
         FROM receipt_event_normalizations
         WHERE receipt_id = ?`,
      )
      .get(receiptId);
    if (row === undefined) {
      return null;
    }
    const links = this.#database
      .prepare(
        `SELECT event_index, event_id
         FROM receipt_normalized_events
         WHERE receipt_id = ?
         ORDER BY event_index ASC`,
      )
      .all(receiptId);
    const eventIds = links.map((link, index) => {
      if (requiredNumber(link, "event_index") !== index) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Event normalization indices are not contiguous.",
        );
      }
      return requiredString(link, "event_id");
    });
    const normalization = mapNormalization(row, eventIds);
    if (normalization.eventCount !== eventIds.length) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Event normalization linkage count is inconsistent.",
      );
    }
    return normalization;
  }

  listEligibleReceiptIds(limit: number): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return [];
    }
    return this.#database
      .prepare(
        `SELECT rlr.receipt_id
         FROM receipt_lifecycle_resolutions rlr
         LEFT JOIN receipt_event_normalizations ren ON ren.receipt_id = rlr.receipt_id
         WHERE ren.receipt_id IS NULL
         ORDER BY rlr.resolved_at ASC, rlr.receipt_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => requiredString(row, "receipt_id"));
  }

  countAll(): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM receipt_event_normalizations")
      .get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
