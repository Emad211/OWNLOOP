import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const RUN_FINALIZATION_MODES = ["normal", "recovery"] as const;
export type RunFinalizationMode = (typeof RUN_FINALIZATION_MODES)[number];

export const RUN_FINALIZATION_TERMINAL_STATUSES = [
  "Completed",
  "Partial",
  "Abandoned",
  "Failed",
] as const;
export type RunFinalizationTerminalStatus = (typeof RUN_FINALIZATION_TERMINAL_STATUSES)[number];

export const RUN_FINALIZATION_DIAGNOSTIC_CODES = [
  "baseline_missing",
  "baseline_partial",
  "final_reconciliation_missing",
  "final_reconciliation_partial",
  "final_fingerprint_missing",
  "manifest_unavailable",
  "existing_evidence_gaps",
  "source_stop_failure",
  "stale_capturing_recovered",
  "stale_finalizing_recovered",
  "finalization_processing_failed",
] as const;
export type RunFinalizationDiagnosticCode = (typeof RUN_FINALIZATION_DIAGNOSTIC_CODES)[number];

export type RunFinalization = Readonly<{
  finalizationId: string;
  runId: string;
  conversationId: string;
  workspaceId: string;
  terminalStatus: RunFinalizationTerminalStatus;
  mode: RunFinalizationMode;
  triggerEventId: string | null;
  reconciliationId: string | null;
  manifestArtifactId: string | null;
  finalFingerprint: string | null;
  finalSnapshotEventId: string | null;
  terminalEventId: string;
  diagnosticCode: RunFinalizationDiagnosticCode | null;
  finalizedAt: string;
  generatorVersion: string;
}>;

export type NewRunFinalization = RunFinalization;

const FINALIZATION_SELECT = `SELECT
  finalization_id,
  run_id,
  conversation_id,
  workspace_id,
  terminal_status,
  mode,
  trigger_event_id,
  reconciliation_id,
  manifest_artifact_id,
  final_fingerprint,
  final_snapshot_event_id,
  terminal_event_id,
  diagnostic_code,
  finalized_at,
  generator_version
FROM run_finalizations`;

function mapFinalization(row: SqliteRow): RunFinalization {
  return {
    finalizationId: requiredString(row, "finalization_id"),
    runId: requiredString(row, "run_id"),
    conversationId: requiredString(row, "conversation_id"),
    workspaceId: requiredString(row, "workspace_id"),
    terminalStatus: requiredString(row, "terminal_status") as RunFinalizationTerminalStatus,
    mode: requiredString(row, "mode") as RunFinalizationMode,
    triggerEventId: nullableString(row, "trigger_event_id"),
    reconciliationId: nullableString(row, "reconciliation_id"),
    manifestArtifactId: nullableString(row, "manifest_artifact_id"),
    finalFingerprint: nullableString(row, "final_fingerprint"),
    finalSnapshotEventId: nullableString(row, "final_snapshot_event_id"),
    terminalEventId: requiredString(row, "terminal_event_id"),
    diagnosticCode: nullableString(row, "diagnostic_code") as RunFinalizationDiagnosticCode | null,
    finalizedAt: requiredString(row, "finalized_at"),
    generatorVersion: requiredString(row, "generator_version"),
  };
}

export class RunFinalizationRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(finalization: NewRunFinalization): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO run_finalizations (
             finalization_id,
             run_id,
             conversation_id,
             workspace_id,
             terminal_status,
             mode,
             trigger_event_id,
             reconciliation_id,
             manifest_artifact_id,
             final_fingerprint,
             final_snapshot_event_id,
             terminal_event_id,
             diagnostic_code,
             finalized_at,
             generator_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          finalization.finalizationId,
          finalization.runId,
          finalization.conversationId,
          finalization.workspaceId,
          finalization.terminalStatus,
          finalization.mode,
          finalization.triggerEventId,
          finalization.reconciliationId,
          finalization.manifestArtifactId,
          finalization.finalFingerprint,
          finalization.finalSnapshotEventId,
          finalization.terminalEventId,
          finalization.diagnosticCode,
          finalization.finalizedAt,
          finalization.generatorVersion,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert Run finalization");
    }
  }

  getByRun(runId: string): RunFinalization | null {
    const row = this.#database.prepare(`${FINALIZATION_SELECT} WHERE run_id = ?`).get(runId);
    if (row === undefined) {
      return null;
    }
    const finalization = mapFinalization(row);
    this.#validate(finalization);
    return finalization;
  }

  get(finalizationId: string): RunFinalization | null {
    const row = this.#database
      .prepare(`${FINALIZATION_SELECT} WHERE finalization_id = ?`)
      .get(finalizationId);
    if (row === undefined) {
      return null;
    }
    const finalization = mapFinalization(row);
    this.#validate(finalization);
    return finalization;
  }

  listEligibleFinalizingRunIds(limit: number): string[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      return [];
    }
    return this.#database
      .prepare(
        `SELECT tr.run_id
         FROM task_runs tr
         LEFT JOIN run_finalizations rf ON rf.run_id = tr.run_id
         WHERE tr.status = 'Finalizing' AND rf.run_id IS NULL
         ORDER BY tr.started_at ASC, tr.conversation_id ASC, tr.run_number ASC, tr.run_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => requiredString(row, "run_id"));
  }

  #validate(finalization: RunFinalization): void {
    const run = this.#database
      .prepare(
        `SELECT tr.status, tr.ended_at, tr.final_git_fingerprint, tr.evidence_gap_count,
                tr.conversation_id, ac.workspace_id
         FROM task_runs tr
         JOIN agent_conversations ac ON ac.conversation_id = tr.conversation_id
         WHERE tr.run_id = ?`,
      )
      .get(finalization.runId);
    if (
      run === undefined ||
      requiredString(run, "status") !== finalization.terminalStatus ||
      nullableString(run, "ended_at") !== finalization.finalizedAt ||
      nullableString(run, "final_git_fingerprint") !== finalization.finalFingerprint ||
      requiredString(run, "conversation_id") !== finalization.conversationId ||
      requiredString(run, "workspace_id") !== finalization.workspaceId
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization aggregate state is inconsistent.",
      );
    }

    const evidenceGapCount = requiredNumber(run, "evidence_gap_count");
    const actualEvidenceGapCount = requiredNumber(
      this.#database
        .prepare("SELECT count(*) AS count FROM evidence_gaps WHERE run_id = ?")
        .get(finalization.runId) ?? {},
      "count",
    );
    if (
      evidenceGapCount !== actualEvidenceGapCount ||
      (finalization.terminalStatus === "Completed" && evidenceGapCount !== 0)
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization evidence state is inconsistent.",
      );
    }

    const validCombination =
      (finalization.terminalStatus === "Completed" &&
        finalization.mode === "normal" &&
        finalization.diagnosticCode === null &&
        finalization.triggerEventId !== null &&
        finalization.reconciliationId !== null &&
        finalization.manifestArtifactId !== null &&
        finalization.finalFingerprint !== null &&
        finalization.finalSnapshotEventId !== null) ||
      (finalization.terminalStatus === "Partial" && finalization.diagnosticCode !== null) ||
      (finalization.terminalStatus === "Failed" &&
        finalization.mode === "normal" &&
        finalization.diagnosticCode === "source_stop_failure" &&
        finalization.triggerEventId !== null) ||
      (finalization.terminalStatus === "Abandoned" &&
        finalization.mode === "recovery" &&
        finalization.diagnosticCode === "stale_capturing_recovered" &&
        finalization.triggerEventId === null &&
        finalization.reconciliationId === null &&
        finalization.manifestArtifactId === null &&
        finalization.finalFingerprint === null &&
        finalization.finalSnapshotEventId === null);
    if (
      !validCombination ||
      (finalization.reconciliationId === null) !== (finalization.finalSnapshotEventId === null) ||
      ((finalization.manifestArtifactId !== null || finalization.finalFingerprint !== null) &&
        finalization.reconciliationId === null)
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization outcome is inconsistent.",
      );
    }

    const terminal = this.#database
      .prepare(
        `SELECT event_type, source, run_id, conversation_id, workspace_id, sequence
         FROM events WHERE event_id = ?`,
      )
      .get(finalization.terminalEventId);
    const expectedTerminalType =
      finalization.terminalStatus === "Completed"
        ? "run.completed"
        : finalization.terminalStatus === "Partial"
          ? "run.partial"
          : finalization.terminalStatus === "Failed"
            ? "run.failed"
            : "run.abandoned";
    if (
      terminal === undefined ||
      requiredString(terminal, "event_type") !== expectedTerminalType ||
      requiredString(terminal, "source") !== "ownloop" ||
      nullableString(terminal, "run_id") !== finalization.runId ||
      requiredString(terminal, "conversation_id") !== finalization.conversationId ||
      requiredString(terminal, "workspace_id") !== finalization.workspaceId
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization terminal Event is inconsistent.",
      );
    }

    const terminalSequence = requiredNumber(terminal, "sequence");
    const terminalDeduplication = this.#database
      .prepare(
        `SELECT count(*) AS count FROM event_deduplication
         WHERE event_id = ? AND source = 'ownloop' AND source_session_id = ?
           AND deduplication_key = ?`,
      )
      .get(
        finalization.terminalEventId,
        finalization.conversationId,
        `v1:run-finalization:${finalization.runId}:terminal`,
      );
    if (
      terminalDeduplication === undefined ||
      requiredNumber(terminalDeduplication, "count") !== 1
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization terminal deduplication is inconsistent.",
      );
    }

    let snapshotSequence: number | null = null;
    if (finalization.finalSnapshotEventId !== null) {
      const snapshot = this.#database
        .prepare(
          `SELECT event_type, source, run_id, conversation_id, workspace_id, sequence
           FROM events WHERE event_id = ?`,
        )
        .get(finalization.finalSnapshotEventId);
      if (
        snapshot === undefined ||
        requiredString(snapshot, "event_type") !== "snapshot.final_captured" ||
        requiredString(snapshot, "source") !== "ownloop" ||
        nullableString(snapshot, "run_id") !== finalization.runId ||
        requiredString(snapshot, "conversation_id") !== finalization.conversationId ||
        requiredString(snapshot, "workspace_id") !== finalization.workspaceId
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Run finalization snapshot Event is inconsistent.",
        );
      }
      snapshotSequence = requiredNumber(snapshot, "sequence");
      const snapshotDeduplication = this.#database
        .prepare(
          `SELECT count(*) AS count FROM event_deduplication
           WHERE event_id = ? AND source = 'ownloop' AND source_session_id = ?
             AND deduplication_key = ?`,
        )
        .get(
          finalization.finalSnapshotEventId,
          finalization.conversationId,
          `v1:run-finalization:${finalization.runId}:snapshot`,
        );
      if (
        snapshotDeduplication === undefined ||
        requiredNumber(snapshotDeduplication, "count") !== 1
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Run finalization snapshot deduplication is inconsistent.",
        );
      }
    }
    const firstFinalizationSequence = snapshotSequence ?? terminalSequence;
    const hasPredecessor =
      firstFinalizationSequence === 1 ||
      this.#database
        .prepare("SELECT 1 FROM events WHERE run_id = ? AND sequence = ?")
        .get(finalization.runId, firstFinalizationSequence - 1) !== undefined;
    if (
      (snapshotSequence !== null && terminalSequence !== snapshotSequence + 1) ||
      !hasPredecessor
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted Run finalization Event order is inconsistent.",
      );
    }

    if (finalization.triggerEventId !== null) {
      const trigger = this.#database
        .prepare("SELECT event_type, run_id FROM events WHERE event_id = ?")
        .get(finalization.triggerEventId);
      if (
        trigger === undefined ||
        !["run.stop_observed", "run.stop_failed"].includes(requiredString(trigger, "event_type")) ||
        nullableString(trigger, "run_id") !== finalization.runId
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Run finalization trigger Event is inconsistent.",
        );
      }
    }

    if (finalization.reconciliationId !== null) {
      const reconciliation = this.#database
        .prepare(
          `SELECT run_id, trigger_event_id, working_tree_fingerprint
           FROM git_reconciliations WHERE reconciliation_id = ?`,
        )
        .get(finalization.reconciliationId);
      if (
        reconciliation === undefined ||
        requiredString(reconciliation, "run_id") !== finalization.runId ||
        nullableString(reconciliation, "trigger_event_id") !== finalization.triggerEventId ||
        (finalization.finalFingerprint !== null &&
          nullableString(reconciliation, "working_tree_fingerprint") !==
            finalization.finalFingerprint)
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Run finalization reconciliation is inconsistent.",
        );
      }
    }

    if (finalization.manifestArtifactId !== null) {
      const artifact = this.#database
        .prepare(
          `SELECT a.kind, a.storage_version, a.media_type,
                  EXISTS(
                    SELECT 1 FROM run_artifacts ra
                    WHERE ra.run_id = ? AND ra.artifact_id = a.artifact_id
                      AND ra.role = 'final-diff-manifest-v1'
                  ) AS has_reference
           FROM artifacts a WHERE a.artifact_id = ?`,
        )
        .get(finalization.runId, finalization.manifestArtifactId);
      if (
        artifact === undefined ||
        requiredString(artifact, "kind") !== "final-diff-manifest-v1" ||
        Number(artifact.storage_version) !== 1 ||
        nullableString(artifact, "media_type") !== "application/vnd.ownloop.final-diff+json" ||
        Number(artifact.has_reference) !== 1
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The persisted Run finalization artifact linkage is inconsistent.",
        );
      }
    }
  }
}
