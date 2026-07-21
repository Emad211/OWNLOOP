import { describe, expect, it } from "vitest";

import type { NewPreparedIngressReceipt } from "./index.js";
import { openPersistence, PersistenceDeduplicationConflictError } from "./index.js";

const TIMESTAMP = "2026-07-21T12:00:00.000Z";

function preparedReceipt(
  receiptId: string,
  payloadFingerprint: `hmac-sha256:${string}` = `hmac-sha256:${"a".repeat(64)}`,
): NewPreparedIngressReceipt {
  const redactedPayloadJson = '{"prompt":"fixture"}';
  return {
    receiptId,
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "claude_code",
    adapterVersion: "1.2.3",
    sourceSessionId: "source-session-dedup",
    sourceEventName: "UserPromptSubmit",
    sourceEventId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
    canonicalWorkspacePath: "/workspace/fixture",
    receivedAt: TIMESTAMP,
    payloadFingerprint,
    deduplicationKey: "v1:UserPromptSubmit:id:ZDk0Mjg4ODgtMTIyYi0xMWUxLWI4NWMtNjFjZDNjYmIzMjEw",
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
  };
}

describe("prepared ingress deduplication", () => {
  it("inserts a first delivery and returns its receipt ID", () => {
    const persistence = openPersistence(":memory:");
    const receipt = preparedReceipt("receipt-dedup-first");
    try {
      expect(persistence.ingressReceipts.insertPreparedOrGetExisting(receipt)).toEqual({
        receiptId: receipt.receiptId,
        duplicate: false,
      });
      expect(persistence.ingressReceipts.get(receipt.receiptId)).toMatchObject({
        receiptId: receipt.receiptId,
        preparationStatus: "prepared",
      });
    } finally {
      persistence.close();
    }
  });

  it("returns the original receipt for an exact retry without inserting a second row", () => {
    const persistence = openPersistence(":memory:");
    const first = preparedReceipt("receipt-dedup-original");
    const retry = preparedReceipt("receipt-dedup-retry");
    try {
      persistence.ingressReceipts.insertPreparedOrGetExisting(first);
      expect(persistence.ingressReceipts.insertPreparedOrGetExisting(retry)).toEqual({
        receiptId: first.receiptId,
        duplicate: true,
      });
      expect(persistence.ingressReceipts.get(retry.receiptId)).toBeNull();
    } finally {
      persistence.close();
    }
  });

  it("rejects the same deduplication identity with a different fingerprint", () => {
    const persistence = openPersistence(":memory:");
    const first = preparedReceipt("receipt-dedup-conflict-first");
    const conflict = preparedReceipt(
      "receipt-dedup-conflict-second",
      `hmac-sha256:${"b".repeat(64)}`,
    );
    try {
      persistence.ingressReceipts.insertPreparedOrGetExisting(first);
      expect(() => persistence.ingressReceipts.insertPreparedOrGetExisting(conflict)).toThrowError(
        PersistenceDeduplicationConflictError,
      );
      expect(persistence.ingressReceipts.get(conflict.receiptId)).toBeNull();
      expect(persistence.ingressReceipts.get(first.receiptId)).toMatchObject({
        payloadFingerprint: first.payloadFingerprint,
      });
    } finally {
      persistence.close();
    }
  });
});
