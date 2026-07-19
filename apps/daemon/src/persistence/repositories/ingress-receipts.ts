import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredNumber, requiredString } from "../row-mapping.js";

export const INGRESS_RECEIPT_STATUSES = ["pending", "processed", "failed"] as const;
export type IngressReceiptStatus = (typeof INGRESS_RECEIPT_STATUSES)[number];

export type IngressReceipt = Readonly<{
  receiptId: string;
  ingressContractVersion: number;
  source: string;
  sourceSessionId: string;
  sourceEventName: string;
  sourceEventId: string | null;
  deduplicationKey: string;
  receivedAt: string;
  payloadFingerprint: string;
  redactedPayloadJson: string;
  processingStatus: IngressReceiptStatus;
  processedAt: string | null;
  failureCode: string | null;
  createdAt: string;
}>;

export type NewIngressReceipt = IngressReceipt;

export class IngressReceiptRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(receipt: NewIngressReceipt): void {
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
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert ingress receipt");
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
           created_at
         FROM ingress_receipts
         WHERE receipt_id = ?`,
      )
      .get(receiptId);

    if (row === undefined) {
      return null;
    }

    return {
      receiptId: requiredString(row, "receipt_id"),
      ingressContractVersion: requiredNumber(row, "ingress_contract_version"),
      source: requiredString(row, "source"),
      sourceSessionId: requiredString(row, "source_session_id"),
      sourceEventName: requiredString(row, "source_event_name"),
      sourceEventId: nullableString(row, "source_event_id"),
      deduplicationKey: requiredString(row, "deduplication_key"),
      receivedAt: requiredString(row, "received_at"),
      payloadFingerprint: requiredString(row, "payload_fingerprint"),
      redactedPayloadJson: requiredString(row, "redacted_payload_json"),
      processingStatus: requiredString(row, "processing_status") as IngressReceiptStatus,
      processedAt: nullableString(row, "processed_at"),
      failureCode: nullableString(row, "failure_code"),
      createdAt: requiredString(row, "created_at"),
    };
  }
}
