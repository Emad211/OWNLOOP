import { createSecretKey } from "node:crypto";

import type { ClaudeAdapterIngress } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { prepareIngressReceipt } from "./prepare.js";
import { isSecretFieldName, matchesCustomSecretFieldPattern } from "./redaction.js";

const ingress: ClaudeAdapterIngress = {
  contractVersion: 1,
  source: "claude_code",
  adapterVersion: "0.1.0",
  receivedAt: "2026-07-25T22:30:00.000Z",
  payload: {
    session_id: "session-1",
    transcript_path: "/workspace/transcript.jsonl",
    cwd: "/workspace/project",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_use_id: "tool-use-1",
    tool_input: {
      ordinary: "visible",
      tenant_key: "must-redact",
      private_note: "also-redact",
      my_token_suffix: "suffix-redact",
      password: "built-in-redact",
    },
  },
};

describe("custom secret field patterns", () => {
  it("matches only normalized exact, prefix, and suffix field names", () => {
    expect(isSecretFieldName("tenant_key", ["tenantkey"])).toBe(true);
    expect(isSecretFieldName("private_note", ["private*"])).toBe(true);
    expect(isSecretFieldName("my_token_suffix", ["*suffix"])).toBe(true);
    expect(isSecretFieldName("ordinary", ["tenantkey"])).toBe(false);
    expect(matchesCustomSecretFieldPattern("apikey", "api*")).toBe(true);
    expect(matchesCustomSecretFieldPattern("apikey", "*key")).toBe(true);
  });

  it("redacts only future configured fields while preserving built-in rules", () => {
    const hmacKey = createSecretKey(Buffer.alloc(32, 7));
    const before = prepareIngressReceipt(ingress, { hmacKey });
    expect(before.redactedPayloadJson).toContain("must-redact");
    expect(before.redactedPayloadJson).not.toContain("built-in-redact");
    expect(before.redactionSummary.rulesApplied).toContain("field.secret");
    expect(before.redactionSummary.rulesApplied).not.toContain("field.secret.custom");

    const after = prepareIngressReceipt(ingress, {
      hmacKey,
      customSecretFieldPatterns: ["*suffix", "private*", "tenantkey"],
    });
    expect(after.redactedPayloadJson).not.toContain("must-redact");
    expect(after.redactedPayloadJson).not.toContain("also-redact");
    expect(after.redactedPayloadJson).not.toContain("suffix-redact");
    expect(after.redactedPayloadJson).toContain("visible");
    expect(after.redactionSummary.rulesApplied).toContain("field.secret");
    expect(after.redactionSummary.rulesApplied).toContain("field.secret.custom");
  });

  it("rejects non-canonical pattern configuration before traversal", () => {
    expect(() =>
      prepareIngressReceipt(ingress, {
        hmacKey: createSecretKey(Buffer.alloc(32, 7)),
        customSecretFieldPatterns: ["tenant_key"],
      }),
    ).toThrow();
  });
});
