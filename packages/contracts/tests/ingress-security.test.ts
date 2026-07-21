import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  IngressDeduplicationKeySchema,
  IngressSecurityErrorDetailsSchema,
  PreparedIngressReceiptV1Schema,
  RedactionSummaryV1Schema,
} from "../src/index.js";

const redactedPayloadJson = '{"status":"fixture"}';
const fingerprint = `hmac-sha256:${"a".repeat(64)}` as const;
const summary = {
  policyVersion: 1,
  redactedFieldCount: 1,
  redactedValueCount: 1,
  pathReplacementCount: 1,
  droppedUnknownFieldCount: 1,
  truncatedValueCount: 0,
  rulesApplied: ["field.secret", "path.workspace"],
  outputUtf8Bytes: Buffer.byteLength(redactedPayloadJson, "utf8"),
} as const;

const validReceipt = {
  canonicalizationVersion: 1,
  redactionPolicyVersion: 1,
  ingressContractVersion: 1,
  source: "claude_code",
  adapterVersion: "1.2.3",
  sourceSessionId: "session-fixture",
  sourceEventName: "Stop",
  sourceEventId: null,
  canonicalWorkspacePath: "/workspace/fixture",
  receivedAt: "2026-07-21T09:00:00Z",
  payloadFingerprint: fingerprint,
  deduplicationKey: `v1:Stop:hmac:${"a".repeat(64)}`,
  redactedPayloadJson,
  redactionSummary: summary,
} as const;

describe("ingress-security contracts", () => {
  it("accepts a strict prepared receipt", () => {
    expect(PreparedIngressReceiptV1Schema.safeParse(validReceipt).success).toBe(true);
  });

  it("rejects unknown fields and invalid fingerprint/dedup formats", () => {
    expect(
      PreparedIngressReceiptV1Schema.safeParse({ ...validReceipt, future: true }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        payloadFingerprint: "sha256:fixture",
      }).success,
    ).toBe(false);
    expect(IngressDeduplicationKeySchema.safeParse("v1:Stop:id:raw:value").success).toBe(false);
  });

  it("validates payload JSON and exact UTF-8 byte accounting", () => {
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        redactedPayloadJson: "{",
        redactionSummary: { ...summary, outputUtf8Bytes: 1 },
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        redactionSummary: { ...summary, outputUtf8Bytes: summary.outputUtf8Bytes + 1 },
      }).success,
    ).toBe(false);

    const nonCanonicalPayload = '{"z":1,"a":2}';
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        redactedPayloadJson: nonCanonicalPayload,
        redactionSummary: {
          ...summary,
          outputUtf8Bytes: Buffer.byteLength(nonCanonicalPayload, "utf8"),
        },
      }).success,
    ).toBe(false);

    const negativeZeroPayload = '{"value":-0}';
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        redactedPayloadJson: negativeZeroPayload,
        redactionSummary: {
          ...summary,
          outputUtf8Bytes: Buffer.byteLength(negativeZeroPayload, "utf8"),
        },
      }).success,
    ).toBe(false);

    const multibytePayload = JSON.stringify({ value: "é".repeat(132_000) });
    expect(multibytePayload.length).toBeLessThan(256 * 1024);
    expect(Buffer.byteLength(multibytePayload, "utf8")).toBeGreaterThan(256 * 1024);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        redactedPayloadJson: multibytePayload,
        redactionSummary: { ...summary, outputUtf8Bytes: 256 * 1024 },
      }).success,
    ).toBe(false);
  });

  it("enforces source-ID and deduplication cross-field invariants", () => {
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceEventName: "PreToolUse",
        deduplicationKey: `v1:PreToolUse:hmac:${"a".repeat(64)}`,
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceEventId: "unexpected-id",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceEventName: "PreToolUse",
        sourceEventId: "tool-id",
        deduplicationKey: "v1:PostToolUse:id:dG9vbC1pZA",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceEventName: "PreToolUse",
        sourceEventId: "tool-id",
        deduplicationKey: "v1:PreToolUse:id:b3RoZXItaWQ",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceEventName: "PreToolUse",
        sourceEventId: "tool-id",
        deduplicationKey: "v1:PreToolUse:id:dG9vbC1pZA",
      }).success,
    ).toBe(true);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        deduplicationKey: `v1:Stop:hmac:${"b".repeat(64)}`,
      }).success,
    ).toBe(false);
  });

  it("rejects absolute paths and controls in identifier fields", () => {
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "/private/session",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "session\nfixture",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "ghp_fixtureSecretIdentifier123456",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "token=fixture-secret-value",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "https://fixture-user:fixture-password@example.invalid",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        sourceSessionId: "file:///private/session",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        canonicalWorkspacePath: "/workspace/fixture\nprivate",
      }).success,
    ).toBe(false);
    expect(
      PreparedIngressReceiptV1Schema.safeParse({
        ...validReceipt,
        canonicalWorkspacePath: `/workspace/fixture${String.fromCharCode(0xd800)}`,
      }).success,
    ).toBe(false);
  });

  it("requires rulesApplied to be sorted and unique", () => {
    expect(RedactionSummaryV1Schema.safeParse(summary).success).toBe(true);
    expect(
      RedactionSummaryV1Schema.safeParse({
        ...summary,
        rulesApplied: ["path.workspace", "field.secret"],
      }).success,
    ).toBe(false);
    expect(
      RedactionSummaryV1Schema.safeParse({
        ...summary,
        rulesApplied: ["field.secret", "field.secret"],
      }).success,
    ).toBe(false);
  });

  it("accepts only safe structured error details", () => {
    expect(
      IngressSecurityErrorDetailsSchema.safeParse({
        code: "invalid_json_value",
        message: "The input contains an unsupported JSON value.",
        path: ["tool_input", 0, "password"],
        ruleId: "field.secret",
      }).success,
    ).toBe(true);
    expect(
      IngressSecurityErrorDetailsSchema.safeParse({
        code: "invalid_json_value",
        message: "The input contains an unsupported JSON value.",
        path: ["/private/path"],
      }).success,
    ).toBe(false);
  });
});
