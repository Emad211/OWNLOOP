import type { DatabaseSync } from "node:sqlite";
import {
  type PreparedIngressReceiptV1,
  PreparedIngressReceiptV1Schema,
  type RedactionSummaryV1,
} from "@ownloop/contracts";

import {
  mapPersistenceWriteError,
  PersistenceDeduplicationConflictError,
  PersistenceError,
} from "../errors.js";
import { runInTransaction } from "../transaction.js";
import { nullableString, requiredNumber, requiredString } from "../row-mapping.js";

export const INGRESS_RECEIPT_STATUSES = ["pending", "processed", "failed"] as const;
export type IngressReceiptStatus = (typeof INGRESS_RECEIPT_STATUSES)[number];

type OperationalReceiptFields = Readonly<{
  receiptId: string;
  processingStatus: IngressReceiptStatus;
  processedAt: string | null;
  failureCode: string | null;
  createdAt: string;
}>;

type LegacyReceiptPayload = Readonly<{
  ingressContractVersion: number;
  source: string;
  sourceSessionId: string;
  sourceEventName: string;
  sourceEventId: string | null;
  deduplicationKey: string;
  receivedAt: string;
  payloadFingerprint: string;
  redactedPayloadJson: string;
}>;

export type LegacyIngressReceipt = OperationalReceiptFields &
  LegacyReceiptPayload &
  Readonly<{ preparationStatus: "legacy" }>;

export type PreparedIngressReceiptRecord = OperationalReceiptFields &
  PreparedIngressReceiptV1 &
  Readonly<{ preparationStatus: "prepared" }>;

export type IngressReceipt = LegacyIngressReceipt | PreparedIngressReceiptRecord;

export type NewPreparedIngressReceipt = OperationalReceiptFields & PreparedIngressReceiptV1;

export type PreparedIngressInsertResult = Readonly<{
  receiptId: string;
  duplicate: boolean;
}>;

function parseSummary(value: string): RedactionSummaryV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted ingress receipt contains invalid redaction summary JSON.",
    );
  }

  const result = PreparedIngressReceiptV1Schema.shape.redactionSummary.safeParse(parsed);
  if (!result.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted ingress receipt contains an invalid redaction summary.",
    );
  }
  return result.data;
}

function validatePreparedContract(receipt: NewPreparedIngressReceipt): PreparedIngressReceiptV1 {
  const result = PreparedIngressReceiptV1Schema.safeParse({
    canonicalizationVersion: receipt.canonicalizationVersion,
    redactionPolicyVersion: receipt.redactionPolicyVersion,
    ingressContractVersion: receipt.ingressContractVersion,
    source: receipt.source,
    adapterVersion: receipt.adapterVersion,
    sourceSessionId: receipt.sourceSessionId,
    sourceEventName: receipt.sourceEventName,
    sourceEventId: receipt.sourceEventId,
    canonicalWorkspacePath: receipt.canonicalWorkspacePath,
    receivedAt: receipt.receivedAt,
    payloadFingerprint: receipt.payloadFingerprint,
    deduplicationKey: receipt.deduplicationKey,
    redactedPayloadJson: receipt.redactedPayloadJson,
    redactionSummary: receipt.redactionSummary,
  });
  if (!result.success) {
    throw new PersistenceError(
      "operation_failed",
      "The prepared ingress receipt violates its runtime contract.",
    );
  }
  return result.data;
}

export class IngressReceiptRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insertPrepared(receipt: NewPreparedIngressReceipt): void {
    const prepared = validatePreparedContract(receipt);

    try {
      this.#database
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
          prepared.ingressContractVersion,
          prepared.source,
          prepared.sourceSessionId,
          prepared.sourceEventName,
          prepared.sourceEventId,
          prepared.deduplicationKey,
          prepared.receivedAt,
          prepared.payloadFingerprint,
          prepared.redactedPayloadJson,
          receipt.processingStatus,
          receipt.processedAt,
          receipt.failureCode,
          receipt.createdAt,
          prepared.canonicalizationVersion,
          prepared.redactionPolicyVersion,
          prepared.adapterVersion,
          prepared.canonicalWorkspacePath,
          JSON.stringify(prepared.redactionSummary),
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert prepared ingress receipt");
    }
  }

  insertPreparedOrGetExisting(receipt: NewPreparedIngressReceipt): PreparedIngressInsertResult {
    const prepared = validatePreparedContract(receipt);

    try {
      return runInTransaction(this.#database, () => {
        const inserted = this.#database
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
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source, source_session_id, deduplication_key) DO NOTHING`,
          )
          .run(
            receipt.receiptId,
            prepared.ingressContractVersion,
            prepared.source,
            prepared.sourceSessionId,
            prepared.sourceEventName,
            prepared.sourceEventId,
            prepared.deduplicationKey,
            prepared.receivedAt,
            prepared.payloadFingerprint,
            prepared.redactedPayloadJson,
            receipt.processingStatus,
            receipt.processedAt,
            receipt.failureCode,
            receipt.createdAt,
            prepared.canonicalizationVersion,
            prepared.redactionPolicyVersion,
            prepared.adapterVersion,
            prepared.canonicalWorkspacePath,
            JSON.stringify(prepared.redactionSummary),
          );

        if (inserted.changes === 1) {
          return { receiptId: receipt.receiptId, duplicate: false };
        }

        const identityRow = this.#database
          .prepare(
            `SELECT receipt_id
             FROM ingress_receipts
             WHERE source = ?
               AND source_session_id = ?
               AND deduplication_key = ?`,
          )
          .get(prepared.source, prepared.sourceSessionId, prepared.deduplicationKey);

        if (identityRow === undefined) {
          throw new PersistenceError(
            "operation_failed",
            "The existing ingress receipt could not be resolved after a deduplication collision.",
          );
        }

        const existingReceiptId = requiredString(identityRow, "receipt_id");
        const existing = this.get(existingReceiptId);
        if (existing === null || existing.preparationStatus !== "prepared") {
          throw new PersistenceError(
            "invalid_persisted_row",
            "The existing ingress deduplication identity is not a prepared receipt.",
          );
        }
        if (existing.payloadFingerprint !== prepared.payloadFingerprint) {
          throw new PersistenceDeduplicationConflictError();
        }

        return { receiptId: existing.receiptId, duplicate: true };
      });
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error;
      }
      mapPersistenceWriteError(error, "insert or resolve prepared ingress receipt");
    }
  }

  get(receiptId: string): IngressReceipt | null {
    const row = this.#database
      .prepare(
        `SELECT
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
         FROM ingress_receipts
         WHERE receipt_id = ?`,
      )
      .get(receiptId);

    if (row === undefined) {
      return null;
    }

    const operational: OperationalReceiptFields = {
      receiptId: requiredString(row, "receipt_id"),
      processingStatus: requiredString(row, "processing_status") as IngressReceiptStatus,
      processedAt: nullableString(row, "processed_at"),
      failureCode: nullableString(row, "failure_code"),
      createdAt: requiredString(row, "created_at"),
    };
    const legacyPayload: LegacyReceiptPayload = {
      ingressContractVersion: requiredNumber(row, "ingress_contract_version"),
      source: requiredString(row, "source"),
      sourceSessionId: requiredString(row, "source_session_id"),
      sourceEventName: requiredString(row, "source_event_name"),
      sourceEventId: nullableString(row, "source_event_id"),
      deduplicationKey: requiredString(row, "deduplication_key"),
      receivedAt: requiredString(row, "received_at"),
      payloadFingerprint: requiredString(row, "payload_fingerprint"),
      redactedPayloadJson: requiredString(row, "redacted_payload_json"),
    };

    const preparationMetadata = [
      row.canonicalization_version,
      row.redaction_policy_version,
      row.adapter_version,
      row.canonical_workspace_path,
      row.redaction_summary_json,
    ];
    const nullMetadataCount = preparationMetadata.filter((value) => value === null).length;
    if (nullMetadataCount === preparationMetadata.length) {
      return { ...operational, ...legacyPayload, preparationStatus: "legacy" };
    }
    if (nullMetadataCount > 0) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted ingress receipt contains incomplete preparation metadata.",
      );
    }

    const prepared = PreparedIngressReceiptV1Schema.safeParse({
      ...legacyPayload,
      canonicalizationVersion: requiredNumber(row, "canonicalization_version"),
      redactionPolicyVersion: requiredNumber(row, "redaction_policy_version"),
      adapterVersion: requiredString(row, "adapter_version"),
      canonicalWorkspacePath: requiredString(row, "canonical_workspace_path"),
      redactionSummary: parseSummary(requiredString(row, "redaction_summary_json")),
    });
    if (!prepared.success) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The persisted prepared ingress receipt violates its runtime contract.",
      );
    }

    return { ...operational, ...prepared.data, preparationStatus: "prepared" };
  }
}
