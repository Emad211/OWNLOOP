import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredString, type SqliteRow } from "../row-mapping.js";

export const LIFECYCLE_RESOLUTION_OUTCOMES = ["applied", "associated", "failed"] as const;
export type LifecycleResolutionOutcome = (typeof LIFECYCLE_RESOLUTION_OUTCOMES)[number];

export const LIFECYCLE_RESOLUTION_ACTIONS = [
  "conversation_started",
  "conversation_resumed",
  "conversation_inferred",
  "run_started",
  "run_associated",
  "run_finalizing",
  "conversation_ended",
  "receipt_failed",
] as const;
export type LifecycleResolutionAction = (typeof LIFECYCLE_RESOLUTION_ACTIONS)[number];

export const LIFECYCLE_DIAGNOSTIC_CODES = [
  "legacy_receipt_unsupported",
  "invalid_redacted_payload",
  "conversation_workspace_conflict",
  "conversation_ended",
  "no_active_run",
  "invalid_transition",
  "lifecycle_processing_failed",
] as const;
export type LifecycleDiagnosticCode = (typeof LIFECYCLE_DIAGNOSTIC_CODES)[number];

export type ReceiptLifecycleResolution = Readonly<{
  receiptId: string;
  workspaceId: string | null;
  conversationId: string | null;
  runId: string | null;
  outcome: LifecycleResolutionOutcome;
  action: LifecycleResolutionAction;
  diagnosticCode: LifecycleDiagnosticCode | null;
  resolvedAt: string;
}>;

export type NewReceiptLifecycleResolution = ReceiptLifecycleResolution;

function mapResolutionRow(row: SqliteRow): ReceiptLifecycleResolution {
  return {
    receiptId: requiredString(row, "receipt_id"),
    workspaceId: nullableString(row, "workspace_id"),
    conversationId: nullableString(row, "conversation_id"),
    runId: nullableString(row, "run_id"),
    outcome: requiredString(row, "outcome") as LifecycleResolutionOutcome,
    action: requiredString(row, "action") as LifecycleResolutionAction,
    diagnosticCode: nullableString(row, "diagnostic_code") as LifecycleDiagnosticCode | null,
    resolvedAt: requiredString(row, "resolved_at"),
  };
}

export class LifecycleResolutionRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(resolution: NewReceiptLifecycleResolution): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO receipt_lifecycle_resolutions (
             receipt_id,
             workspace_id,
             conversation_id,
             run_id,
             outcome,
             action,
             diagnostic_code,
             resolved_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          resolution.receiptId,
          resolution.workspaceId,
          resolution.conversationId,
          resolution.runId,
          resolution.outcome,
          resolution.action,
          resolution.diagnosticCode,
          resolution.resolvedAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert receipt lifecycle resolution");
    }
  }

  get(receiptId: string): ReceiptLifecycleResolution | null {
    const row = this.#database
      .prepare(
        `SELECT
           receipt_id,
           workspace_id,
           conversation_id,
           run_id,
           outcome,
           action,
           diagnostic_code,
           resolved_at
         FROM receipt_lifecycle_resolutions
         WHERE receipt_id = ?`,
      )
      .get(receiptId);
    return row === undefined ? null : mapResolutionRow(row);
  }
}
