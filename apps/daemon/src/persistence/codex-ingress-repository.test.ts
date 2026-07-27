import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";

import { CodexAdapterIngressSchema } from "@ownloop/contracts/codex";
import { prepareCodexIngressReceipt } from "@ownloop/ingress-security";
import { describe, expect, it } from "vitest";

import { openPersistence, PersistenceDeduplicationConflictError } from "./index.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 31));
const CREATED_AT = "2026-07-27T12:30:00.000Z";

function preToolIngress(command: string) {
  return CodexAdapterIngressSchema.parse({
    contractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceVersion: "codex-cli 0.133.0",
    sourceSurface: "cli",
    receivedAt: "2026-07-27T12:29:59.000Z",
    payload: {
      session_id: "session-codex-persistence",
      transcript_path: null,
      cwd: "/workspace/project",
      turn_id: "turn-codex-persistence",
      model: "gpt-5.6-codex",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "shell_command",
      tool_input: { command },
      tool_use_id: "tool-codex-persistence",
    },
  });
}

function newReceipt(receiptId: string, command = "git status --short") {
  return {
    ...prepareCodexIngressReceipt(preToolIngress(command), {
      hmacKey: HMAC_KEY,
      homePath: "/home/fixture",
    }),
    receiptId,
    processingStatus: "pending" as const,
    processedAt: null,
    failureCode: null,
    createdAt: CREATED_AT,
  };
}

describe("Codex prepared ingress persistence", () => {
  it("persists and reads a strict Codex prepared receipt", () => {
    const persistence = openPersistence(":memory:");
    try {
      const receipt = newReceipt("receipt-codex-001");
      expect(persistence.ingressReceipts.insertPreparedOrGetExisting(receipt)).toEqual({
        receiptId: receipt.receiptId,
        duplicate: false,
      });
      expect(persistence.ingressReceipts.get(receipt.receiptId)).toMatchObject({
        preparationStatus: "prepared",
        source: "codex",
        sourceSessionId: "session-codex-persistence",
        sourceEventName: "PreToolUse",
        sourceEventId: "tool-codex-persistence",
        processingStatus: "pending",
      });
    } finally {
      persistence.close();
    }
  });

  it("returns the original receipt for an exact Codex duplicate", () => {
    const persistence = openPersistence(":memory:");
    try {
      persistence.ingressReceipts.insertPreparedOrGetExisting(newReceipt("receipt-codex-001"));
      expect(
        persistence.ingressReceipts.insertPreparedOrGetExisting(newReceipt("receipt-codex-002")),
      ).toEqual({
        receiptId: "receipt-codex-001",
        duplicate: true,
      });
      expect(persistence.ingressReceipts.countAll()).toBe(1);
    } finally {
      persistence.close();
    }
  });

  it("rejects the same Codex source identity with a different payload fingerprint", () => {
    const persistence = openPersistence(":memory:");
    try {
      persistence.ingressReceipts.insertPreparedOrGetExisting(newReceipt("receipt-codex-001"));
      expect(() =>
        persistence.ingressReceipts.insertPreparedOrGetExisting(
          newReceipt("receipt-codex-002", "git diff --stat"),
        ),
      ).toThrow(PersistenceDeduplicationConflictError);
      expect(persistence.ingressReceipts.countAll()).toBe(1);
    } finally {
      persistence.close();
    }
  });
});
