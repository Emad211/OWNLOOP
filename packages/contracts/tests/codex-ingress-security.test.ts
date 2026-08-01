import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { PreparedCodexIngressReceiptV1Schema } from "../src/codex.js";

const fingerprint = `hmac-sha256:${"a".repeat(64)}` as const;
const redactedPayloadJson = '{"source_surface":"cli","source_version":"1.2.3","tool_name":"shell"}';
const summary = {
  policyVersion: 1,
  redactedFieldCount: 0,
  redactedValueCount: 0,
  pathReplacementCount: 0,
  droppedUnknownFieldCount: 0,
  truncatedValueCount: 0,
  rulesApplied: [],
  outputUtf8Bytes: Buffer.byteLength(redactedPayloadJson, "utf8"),
} as const;

function preToolReceipt() {
  return {
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceSessionId: "session-codex-contract",
    sourceEventName: "PreToolUse",
    sourceEventId: "tool-1",
    canonicalWorkspacePath: "/workspace/codex",
    receivedAt: "2026-07-27T08:30:00.000Z",
    payloadFingerprint: fingerprint,
    deduplicationKey: "v1:PreToolUse:id:dG9vbC0x",
    redactedPayloadJson,
    redactionSummary: summary,
  } as const;
}

function permissionReceipt() {
  return {
    ...preToolReceipt(),
    sourceEventName: "PermissionRequest",
    sourceEventId: null,
    deduplicationKey: `v1:PermissionRequest:hmac:${"a".repeat(64)}`,
  } as const;
}

describe("prepared Codex ingress receipt", () => {
  it("accepts an ID-correlated tool event", () => {
    expect(PreparedCodexIngressReceiptV1Schema.parse(preToolReceipt())).toEqual(preToolReceipt());
  });

  it("accepts current PermissionRequest only through payload HMAC", () => {
    expect(PreparedCodexIngressReceiptV1Schema.parse(permissionReceipt())).toEqual(
      permissionReceipt(),
    );
  });

  it("requires a source ID for Codex event classes that expose one", () => {
    expect(
      PreparedCodexIngressReceiptV1Schema.safeParse({
        ...preToolReceipt(),
        sourceEventId: null,
        deduplicationKey: `v1:PreToolUse:hmac:${"a".repeat(64)}`,
      }).success,
    ).toBe(false);
  });

  it("rejects invented IDs for PermissionRequest", () => {
    expect(
      PreparedCodexIngressReceiptV1Schema.safeParse({
        ...permissionReceipt(),
        sourceEventId: "invented-tool-id",
        deduplicationKey: "v1:PermissionRequest:id:aW52ZW50ZWQtdG9vbC1pZA",
      }).success,
    ).toBe(false);
  });

  it("rejects deduplication keys that disagree with source identity", () => {
    expect(
      PreparedCodexIngressReceiptV1Schema.safeParse({
        ...preToolReceipt(),
        deduplicationKey: "v1:PostToolUse:id:dG9vbC0x",
      }).success,
    ).toBe(false);
  });

  it("rejects noncanonical redacted payload bytes", () => {
    const noncanonical = '{"tool_name":"shell", "source_surface":"cli"}';
    expect(
      PreparedCodexIngressReceiptV1Schema.safeParse({
        ...preToolReceipt(),
        redactedPayloadJson: noncanonical,
        redactionSummary: {
          ...summary,
          outputUtf8Bytes: Buffer.byteLength(noncanonical, "utf8"),
        },
      }).success,
    ).toBe(false);
  });
});
