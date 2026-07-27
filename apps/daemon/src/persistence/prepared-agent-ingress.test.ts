import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { parsePreparedAgentIngressReceipt } from "./prepared-agent-ingress.js";

const FINGERPRINT = `hmac-sha256:${"a".repeat(64)}` as const;
const HMAC_DEDUPLICATION = `v1:SessionStart:hmac:${"a".repeat(64)}` as const;

function summary(redactedPayloadJson: string) {
  return {
    policyVersion: 1 as const,
    redactedFieldCount: 0,
    redactedValueCount: 0,
    pathReplacementCount: 0,
    droppedUnknownFieldCount: 0,
    truncatedValueCount: 0,
    rulesApplied: [],
    outputUtf8Bytes: Buffer.byteLength(redactedPayloadJson, "utf8"),
  };
}

function claudeReceipt() {
  const redactedPayloadJson = '{"source":"startup"}';
  return {
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "claude_code",
    adapterVersion: "0.1.0",
    sourceSessionId: "session-claude-fixture",
    sourceEventName: "SessionStart",
    sourceEventId: null,
    canonicalWorkspacePath: "/workspace/project",
    receivedAt: "2026-07-27T12:00:00.000Z",
    payloadFingerprint: FINGERPRINT,
    deduplicationKey: HMAC_DEDUPLICATION,
    redactedPayloadJson,
    redactionSummary: summary(redactedPayloadJson),
  } as const;
}

function codexReceipt() {
  const redactedPayloadJson =
    '{"model":"gpt-5.6-codex","permission_mode":"default","source":"startup","source_surface":"cli","source_version":null}';
  return {
    canonicalizationVersion: 1,
    redactionPolicyVersion: 1,
    ingressContractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceSessionId: "session-codex-fixture",
    sourceEventName: "SessionStart",
    sourceEventId: null,
    canonicalWorkspacePath: "/workspace/project",
    receivedAt: "2026-07-27T12:00:00.000Z",
    payloadFingerprint: FINGERPRINT,
    deduplicationKey: HMAC_DEDUPLICATION,
    redactedPayloadJson,
    redactionSummary: summary(redactedPayloadJson),
  } as const;
}

describe("parsePreparedAgentIngressReceipt", () => {
  it("dispatches strict Claude and Codex prepared receipts by source", () => {
    expect(parsePreparedAgentIngressReceipt(claudeReceipt())).toMatchObject({
      source: "claude_code",
      sourceEventName: "SessionStart",
    });
    expect(parsePreparedAgentIngressReceipt(codexReceipt())).toMatchObject({
      source: "codex",
      sourceEventName: "SessionStart",
    });
  });

  it("rejects unknown sources without falling back to another schema", () => {
    expect(
      parsePreparedAgentIngressReceipt({
        ...codexReceipt(),
        source: "future_agent",
      }),
    ).toBeNull();
  });

  it("rejects malformed source-specific receipts", () => {
    expect(
      parsePreparedAgentIngressReceipt({
        ...codexReceipt(),
        sourceEventName: "PostToolBatch",
      }),
    ).toBeNull();
    expect(
      parsePreparedAgentIngressReceipt({
        ...codexReceipt(),
        source: "claude_code",
        sourceEventName: "PermissionRequest",
      }),
    ).toBeNull();
  });
});
