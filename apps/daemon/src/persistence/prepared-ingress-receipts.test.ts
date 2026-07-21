import { describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "./database.js";
import type { PersistenceError } from "./errors.js";
import { type NewPreparedIngressReceipt, openPersistence } from "./index.js";
import { MIGRATIONS } from "./migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "./migrations.js";
import { IngressReceiptRepository } from "./repositories/ingress-receipts.js";

const TIMESTAMP = "2026-07-21T09:00:00.000Z";

function preparedReceipt(
  overrides: Partial<NewPreparedIngressReceipt> = {},
): NewPreparedIngressReceipt {
  const redactedPayloadJson = '{"prompt":"fixture"}';
  return {
    receiptId: "receipt-prepared-1",
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "claude_code",
    adapterVersion: "1.2.3",
    sourceSessionId: "source-session-prepared",
    sourceEventName: "UserPromptSubmit",
    sourceEventId: null,
    canonicalWorkspacePath: "/workspace/fixture",
    receivedAt: TIMESTAMP,
    payloadFingerprint: `hmac-sha256:${"a".repeat(64)}`,
    deduplicationKey: `v1:UserPromptSubmit:hmac:${"a".repeat(64)}`,
    redactedPayloadJson,
    redactionSummary: {
      policyVersion: 1,
      redactedFieldCount: 0,
      redactedValueCount: 0,
      pathReplacementCount: 0,
      droppedUnknownFieldCount: 0,
      truncatedValueCount: 0,
      rulesApplied: [],
      outputUtf8Bytes: Buffer.byteLength(redactedPayloadJson, "utf8"),
    },
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: TIMESTAMP,
    ...overrides,
  };
}

describe("prepared ingress receipt migration", () => {
  it("upgrades a version-1 database without falsely labeling legacy rows", () => {
    const opened = openConfiguredDatabase(":memory:");
    const firstMigration = MIGRATIONS[0];
    if (firstMigration === undefined) {
      throw new Error("Fixture migration is missing.");
    }

    try {
      runMigrations(opened.database, [firstMigration]);
      opened.database
        .prepare(
          `INSERT INTO ingress_receipts (
             receipt_id,
             ingress_contract_version,
             source,
             source_session_id,
             source_event_name,
             source_event_id,
             deduplication_key,
             received_at,
             payload_fingerprint,
             redacted_payload_json,
             processing_status,
             processed_at,
             failure_code,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-receipt",
          1,
          "claude_code",
          "legacy-session",
          "Stop",
          null,
          "legacy-dedup",
          TIMESTAMP,
          "legacy-fingerprint",
          "{}",
          "pending",
          null,
          null,
          TIMESTAMP,
        );

      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      const legacy = repository.get("legacy-receipt");

      expect(legacy).toMatchObject({
        receiptId: "legacy-receipt",
        preparationStatus: "legacy",
      });
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("applies both migrations on a fresh database and inserts prepared records", () => {
    const persistence = openPersistence(":memory:");
    const receipt = preparedReceipt();
    try {
      persistence.ingressReceipts.insertPrepared(receipt);
      expect(persistence.ingressReceipts.get(receipt.receiptId)).toEqual({
        ...receipt,
        preparationStatus: "prepared",
      });
    } finally {
      persistence.close();
    }
  });

  it("rejects new rows without complete preparation metadata", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      expect(() =>
        opened.database
          .prepare(
            `INSERT INTO ingress_receipts (
               receipt_id,
               ingress_contract_version,
               source,
               source_session_id,
               source_event_name,
               deduplication_key,
               received_at,
               payload_fingerprint,
               redacted_payload_json,
               processing_status,
               created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "invalid-new-receipt",
            1,
            "claude_code",
            "invalid-session",
            "Stop",
            "invalid-dedup",
            TIMESTAMP,
            "invalid-fingerprint",
            "{}",
            "pending",
            TIMESTAMP,
          ),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects prepared inserts that violate the runtime contract before SQL", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(() =>
        persistence.ingressReceipts.insertPrepared(
          preparedReceipt({
            payloadFingerprint: "invalid-fingerprint" as `hmac-sha256:${string}`,
          }),
        ),
      ).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "operation_failed" }),
      );
      expect(persistence.ingressReceipts.get("receipt-prepared-1")).toBeNull();
    } finally {
      persistence.close();
    }
  });

  it.each([
    { name: "malformed JSON", summaryJson: "{" },
    { name: "a non-object JSON value", summaryJson: "[]" },
  ])("rejects $name for redaction summaries through the database constraint", ({ summaryJson }) => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      expect(() =>
        opened.database
          .prepare(
            `INSERT INTO ingress_receipts (
               receipt_id,
               ingress_contract_version,
               source,
               source_session_id,
               source_event_name,
               source_event_id,
               deduplication_key,
               received_at,
               payload_fingerprint,
               redacted_payload_json,
               processing_status,
               processed_at,
               failure_code,
               created_at,
               canonicalization_version,
               redaction_policy_version,
               adapter_version,
               canonical_workspace_path,
               redaction_summary_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            receipt.receiptId,
            receipt.ingressContractVersion,
            receipt.source,
            receipt.sourceSessionId,
            receipt.sourceEventName,
            receipt.sourceEventId,
            receipt.deduplicationKey,
            receipt.receivedAt,
            receipt.payloadFingerprint,
            receipt.redactedPayloadJson,
            receipt.processingStatus,
            receipt.processedAt,
            receipt.failureCode,
            receipt.createdAt,
            receipt.canonicalizationVersion,
            receipt.redactionPolicyVersion,
            receipt.adapterVersion,
            receipt.canonicalWorkspacePath,
            summaryJson,
          ),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects valid JSON that violates the persisted summary schema on read", () => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      repository.insertPrepared(receipt);
      opened.database.exec("DROP TRIGGER ingress_receipts_prepared_metadata_consistency_update");
      opened.database
        .prepare(
          `UPDATE ingress_receipts
           SET redaction_summary_json = ?
           WHERE receipt_id = ?`,
        )
        .run("{}", receipt.receiptId);

      expect(() => repository.get(receipt.receiptId)).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      opened.database.close();
    }
  });

  it("prevents prepared metadata from being rewritten after insertion", () => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      repository.insertPrepared(receipt);

      expect(() =>
        opened.database
          .prepare(
            `UPDATE ingress_receipts
             SET adapter_version = ?
             WHERE receipt_id = ?`,
          )
          .run("9.9.9", receipt.receiptId),
      ).toThrow();
      expect(repository.get(receipt.receiptId)).toMatchObject({
        adapterVersion: receipt.adapterVersion,
        preparationStatus: "prepared",
      });
    } finally {
      opened.database.close();
    }
  });

  it("prevents prepared receipt content from being rewritten after insertion", () => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      repository.insertPrepared(receipt);

      expect(() =>
        opened.database
          .prepare(
            `UPDATE ingress_receipts
             SET redacted_payload_json = ?
             WHERE receipt_id = ?`,
          )
          .run('{"changed":true}', receipt.receiptId),
      ).toThrow();
      expect(repository.get(receipt.receiptId)).toMatchObject({
        redactedPayloadJson: receipt.redactedPayloadJson,
        payloadFingerprint: receipt.payloadFingerprint,
        deduplicationKey: receipt.deduplicationKey,
      });
    } finally {
      opened.database.close();
    }
  });

  it("allows processing-state updates without changing prepared content", () => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      repository.insertPrepared(receipt);

      opened.database
        .prepare(
          `UPDATE ingress_receipts
           SET processing_status = ?, processed_at = ?
           WHERE receipt_id = ?`,
        )
        .run("processed", TIMESTAMP, receipt.receiptId);

      expect(repository.get(receipt.receiptId)).toMatchObject({
        processingStatus: "processed",
        processedAt: TIMESTAMP,
        redactedPayloadJson: receipt.redactedPayloadJson,
      });
    } finally {
      opened.database.close();
    }
  });

  it("prevents prepared rows from being downgraded to legacy metadata", () => {
    const opened = openConfiguredDatabase(":memory:");
    const receipt = preparedReceipt();
    try {
      runMigrations(opened.database);
      const repository = new IngressReceiptRepository(opened.database);
      repository.insertPrepared(receipt);

      expect(() =>
        opened.database
          .prepare(
            `UPDATE ingress_receipts
             SET canonicalization_version = NULL,
                 redaction_policy_version = NULL,
                 adapter_version = NULL,
                 canonical_workspace_path = NULL,
                 redaction_summary_json = NULL
             WHERE receipt_id = ?`,
          )
          .run(receipt.receiptId),
      ).toThrow();
      expect(repository.get(receipt.receiptId)).toMatchObject({
        preparationStatus: "prepared",
      });
    } finally {
      opened.database.close();
    }
  });

  it("rejects partially populated legacy preparation metadata on read", () => {
    const opened = openConfiguredDatabase(":memory:");
    const firstMigration = MIGRATIONS[0];
    if (firstMigration === undefined) {
      throw new Error("Fixture migration is missing.");
    }

    try {
      runMigrations(opened.database, [firstMigration]);
      opened.database
        .prepare(
          `INSERT INTO ingress_receipts (
             receipt_id,
             ingress_contract_version,
             source,
             source_session_id,
             source_event_name,
             deduplication_key,
             received_at,
             payload_fingerprint,
             redacted_payload_json,
             processing_status,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-partial",
          1,
          "claude_code",
          "legacy-partial-session",
          "Stop",
          "legacy-partial-dedup",
          TIMESTAMP,
          "legacy-partial-fingerprint",
          "{}",
          "pending",
          TIMESTAMP,
        );
      runMigrations(opened.database);
      opened.database.exec("DROP TRIGGER ingress_receipts_prepared_metadata_consistency_update");
      opened.database
        .prepare("UPDATE ingress_receipts SET adapter_version = ? WHERE receipt_id = ?")
        .run("1.2.3", "legacy-partial");

      const repository = new IngressReceiptRepository(opened.database);
      expect(() => repository.get("legacy-partial")).toThrowError(
        expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
      );
    } finally {
      opened.database.close();
    }
  });

  it("adds no generic raw or unredacted ingress payload column", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      const columns = opened.database
        .prepare("PRAGMA table_info(ingress_receipts)")
        .all()
        .map((row) => String(row.name));
      expect(columns).not.toEqual(
        expect.arrayContaining([
          "payload",
          "raw_payload",
          "original_payload",
          "unredacted_payload",
        ]),
      );
      expect(columns).toEqual(
        expect.arrayContaining([
          "canonicalization_version",
          "redaction_policy_version",
          "adapter_version",
          "canonical_workspace_path",
          "redaction_summary_json",
        ]),
      );
    } finally {
      opened.database.close();
    }
  });
});
