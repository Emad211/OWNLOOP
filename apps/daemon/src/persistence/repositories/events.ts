import type { DatabaseSync } from "node:sqlite";
import { type NormalizedEventEnvelope, NormalizedEventEnvelopeSchema } from "@ownloop/event-model";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import {
  nullableNumber,
  nullableString,
  requiredNumber,
  requiredString,
  type SqliteRow,
} from "../row-mapping.js";

export type EventDeduplicationRecord = Readonly<{
  source: string;
  sourceSessionId: string;
  deduplicationKey: string;
  eventId: string;
  createdAt: string;
}>;

function mapEvent(row: SqliteRow): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId: requiredString(row, "event_id"),
    schemaVersion: requiredNumber(row, "schema_version"),
    workspaceId: requiredString(row, "workspace_id"),
    conversationId: requiredString(row, "conversation_id"),
    runId: nullableString(row, "run_id"),
    sequence: nullableNumber(row, "sequence"),
    type: requiredString(row, "event_type"),
    source: requiredString(row, "source"),
    sourceEventName: nullableString(row, "source_event_name"),
    sourceEventId: nullableString(row, "source_event_id"),
    occurredAt: requiredString(row, "occurred_at"),
    ingestedAt: requiredString(row, "ingested_at"),
    sensitivity: requiredString(row, "sensitivity"),
    payload: JSON.parse(requiredString(row, "payload_json")),
    metadata: JSON.parse(requiredString(row, "metadata_json")),
  });
}

const EVENT_SELECT = `
SELECT
  event_id,
  schema_version,
  workspace_id,
  conversation_id,
  run_id,
  sequence,
  event_type,
  source,
  source_event_name,
  source_event_id,
  occurred_at,
  ingested_at,
  sensitivity,
  payload_json,
  metadata_json
FROM events`;

export class EventRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  append(event: NormalizedEventEnvelope): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO events (
             event_id,
             schema_version,
             workspace_id,
             conversation_id,
             run_id,
             sequence,
             event_type,
             source,
             source_event_name,
             source_event_id,
             occurred_at,
             ingested_at,
             sensitivity,
             payload_json,
             metadata_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.eventId,
          event.schemaVersion,
          event.workspaceId,
          event.conversationId,
          event.runId,
          event.sequence,
          event.type,
          event.source,
          event.sourceEventName,
          event.sourceEventId,
          event.occurredAt,
          event.ingestedAt,
          event.sensitivity,
          JSON.stringify(event.payload),
          JSON.stringify(event.metadata),
        );
    } catch (error) {
      mapPersistenceWriteError(error, "append event");
    }
  }

  get(eventId: string): NormalizedEventEnvelope | null {
    const row = this.#database.prepare(`${EVENT_SELECT} WHERE event_id = ?`).get(eventId);
    return row === undefined ? null : mapEvent(row);
  }

  listForRun(runId: string): readonly NormalizedEventEnvelope[] {
    return this.#database
      .prepare(`${EVENT_SELECT} WHERE run_id = ? ORDER BY sequence ASC`)
      .all(runId)
      .map(mapEvent);
  }

  listForRunBounded(runId: string, limit: number): readonly NormalizedEventEnvelope[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) {
      return [];
    }
    const events = this.#database
      .prepare(`${EVENT_SELECT} WHERE run_id = ? ORDER BY sequence ASC LIMIT ?`)
      .all(runId, limit + 1)
      .map(mapEvent);
    if (events.length > limit) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run exceeds the replay Event limit.",
      );
    }
    return events;
  }

  recordDeduplicationKey(record: EventDeduplicationRecord): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO event_deduplication (
             source,
             source_session_id,
             deduplication_key,
             event_id,
             created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          record.source,
          record.sourceSessionId,
          record.deduplicationKey,
          record.eventId,
          record.createdAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "record event deduplication key");
    }
  }

  nextSequence(runId: string): number {
    const row = this.#database
      .prepare(
        `SELECT coalesce(max(sequence), 0) + 1 AS next_sequence
         FROM events
         WHERE run_id = ?`,
      )
      .get(runId);
    return row === undefined ? 1 : requiredNumber(row, "next_sequence");
  }

  listDeduplicationRecordsForEvent(eventId: string): EventDeduplicationRecord[] {
    return this.#database
      .prepare(
        `SELECT source, source_session_id, deduplication_key, event_id, created_at
         FROM event_deduplication
         WHERE event_id = ?
         ORDER BY source, source_session_id, deduplication_key`,
      )
      .all(eventId)
      .map((row) => ({
        source: requiredString(row, "source"),
        sourceSessionId: requiredString(row, "source_session_id"),
        deduplicationKey: requiredString(row, "deduplication_key"),
        eventId: requiredString(row, "event_id"),
        createdAt: requiredString(row, "created_at"),
      }));
  }

  countDeduplicationRows(): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM event_deduplication").get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  countAll(): number {
    const row = this.#database.prepare("SELECT count(*) AS count FROM events").get();
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  countDeduplicationKeysForEvent(eventId: string): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM event_deduplication WHERE event_id = ?")
      .get(eventId);

    return row === undefined ? 0 : requiredNumber(row, "count");
  }
}
