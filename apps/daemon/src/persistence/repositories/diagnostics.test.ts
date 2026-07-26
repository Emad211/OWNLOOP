import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { MIGRATIONS } from "../migration-definitions.js";
import { runMigrations } from "../migrations.js";
import { PersistenceError } from "../errors.js";
import { DiagnosticsRepository } from "./diagnostics.js";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

function databaseWithLegacyReceipt(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, MIGRATIONS.slice(0, 1));
  db.prepare(
    `INSERT INTO ingress_receipts (
      receipt_id, ingress_contract_version, source, source_session_id,
      source_event_name, source_event_id, deduplication_key, received_at,
      payload_fingerprint, redacted_payload_json, processing_status,
      processed_at, failure_code, created_at
    ) VALUES (?, 1, 'claude-code', ?, ?, NULL, ?, ?, ?, '{}', 'processed', ?, NULL, ?)`,
  ).run(
    "receipt_legacy",
    "legacy-session",
    "UserPromptSubmit",
    "legacy-dedup",
    "2026-07-25T00:00:00.000Z",
    "legacy-fingerprint",
    "2026-07-25T00:00:00.000Z",
    "2026-07-25T00:00:00.000Z",
  );
  runMigrations(db);
  return db;
}

function insertWorkspaceConversation(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO workspaces (
      workspace_id, canonical_path, repository_root, git_remote,
      initial_repository_fingerprint, created_at, last_observed_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    "ws_1",
    "/redacted/ws",
    "/redacted/ws",
    "fp",
    "2026-07-25T00:00:00.000Z",
    "2026-07-25T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO agent_conversations (
      conversation_id, workspace_id, source, source_session_id, start_mode,
      started_at, last_observed_at, ended_at, status
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
  ).run(
    "conv_1",
    "ws_1",
    "claude-code",
    "source-session",
    "2026-07-25T00:00:00.000Z",
    "2026-07-25T00:00:00.000Z",
    "Active",
  );
}

function insertReceipt(
  db: DatabaseSync,
  input: Readonly<{
    id: string;
    hook: string;
    prepared: boolean;
    summary?: unknown;
    canonicalizationVersion?: number;
  }>,
): void {
  db.prepare(
    `INSERT INTO ingress_receipts (
      receipt_id, ingress_contract_version, source, source_session_id,
      source_event_name, source_event_id, deduplication_key, received_at,
      payload_fingerprint, redacted_payload_json, processing_status,
      processed_at, failure_code, created_at, canonicalization_version,
      redaction_policy_version, adapter_version, canonical_workspace_path,
      redaction_summary_json
    ) VALUES (?, 1, 'claude-code', ?, ?, NULL, ?, ?, ?, '{}', 'processed', ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    `session-${input.id}`,
    input.hook,
    `dedup-${input.id}`,
    "2026-07-25T00:00:00.000Z",
    `fingerprint-${input.id}`,
    "2026-07-25T00:00:00.000Z",
    "2026-07-25T00:00:00.000Z",
    input.prepared ? (input.canonicalizationVersion ?? 1) : null,
    input.prepared ? 1 : null,
    input.prepared ? "0.1.0" : null,
    input.prepared ? "/redacted/ws" : null,
    input.prepared ? JSON.stringify(input.summary) : null,
  );
}

const summary = {
  policyVersion: 1,
  redactedFieldCount: 2,
  redactedValueCount: 3,
  pathReplacementCount: 1,
  droppedUnknownFieldCount: 4,
  truncatedValueCount: 1,
  rulesApplied: ["field.secret", "path.workspace"],
  outputUtf8Bytes: 10,
};

describe("DiagnosticsRepository", () => {
  it("aggregates prepared and legacy receipts without selecting payload content", () => {
    const db = databaseWithLegacyReceipt();
    try {
      insertReceipt(db, { id: "receipt_1", hook: "SessionStart", prepared: true, summary });
      const value = new DiagnosticsRepository(db).readRedactionAggregates();
      expect(value).toEqual({
        preparedReceiptCount: 1,
        legacyReceiptCount: 1,
        redactedFieldCount: 2,
        redactedValueCount: 3,
        pathReplacementCount: 1,
        droppedUnknownFieldCount: 4,
        truncatedValueCount: 1,
        receiptsByHook: [
          { hookName: "SessionStart", count: 1 },
          { hookName: "UserPromptSubmit", count: 1 },
        ],
        receiptsByRule: [
          { code: "field.secret", count: 1 },
          { code: "path.workspace", count: 1 },
        ],
      });
    } finally {
      db.close();
    }
  });

  it("fails closed on an unsupported receipt canonicalization version", () => {
    const db = database();
    try {
      insertReceipt(db, {
        id: "receipt_version_tamper",
        hook: "SessionStart",
        prepared: true,
        summary,
        canonicalizationVersion: 2,
      });
      expect(() => new DiagnosticsRepository(db).readRedactionAggregates()).toThrow(
        PersistenceError,
      );
    } finally {
      db.close();
    }
  });

  it("fails closed on direct redaction-summary tamper", () => {
    const db = database();
    try {
      insertReceipt(db, {
        id: "receipt_1",
        hook: "SessionStart",
        prepared: true,
        summary: { ...summary, rulesApplied: ["not-a-rule"] },
      });
      expect(() => new DiagnosticsRepository(db).readRedactionAggregates()).toThrow(
        PersistenceError,
      );
    } finally {
      db.close();
    }
  });

  it("returns exact Run totals and deterministic recent ordering without prompt fields", () => {
    const db = database();
    try {
      insertWorkspaceConversation(db);
      const insert = db.prepare(
        `INSERT INTO task_runs (
          run_id, conversation_id, run_number, redacted_prompt,
          started_at, ended_at, status, evidence_gap_count
        ) VALUES (?, 'conv_1', ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        "run_1",
        1,
        "must-not-be-selected",
        "2026-07-25T01:00:00.000Z",
        "2026-07-25T02:00:00.000Z",
        "Completed",
        0,
      );
      insert.run(
        "run_2",
        2,
        "must-not-be-selected",
        "2026-07-25T03:00:00.000Z",
        null,
        "Capturing",
        0,
      );
      const repository = new DiagnosticsRepository(db);
      expect(repository.countRuns()).toBe(2);
      expect(repository.countRunsByStatus()).toEqual([
        { status: "Capturing", count: 1 },
        { status: "Completed", count: 1 },
      ]);
      expect(repository.listRecentRuns(100).map((row) => row.runId)).toEqual(["run_2", "run_1"]);
      expect(JSON.stringify(repository.listRecentRuns(100))).not.toContain("must-not-be-selected");
    } finally {
      db.close();
    }
  });
});
