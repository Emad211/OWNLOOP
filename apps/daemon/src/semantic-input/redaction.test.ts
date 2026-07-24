import { describe, expect, it } from "vitest";

import {
  redactSemanticGoal,
  redactSemanticVerificationExcerpt,
  SemanticInputRedactionError,
} from "./redaction.js";

describe("semantic-input second-pass redaction", () => {
  it("replaces external-sensitive material with controlled placeholders", () => {
    const source = [
      "Goal for /home/alice/project and C:\\Users\\Alice\\repo.",
      "Contact alice@example.com or https://example.com/path.",
      "Server 192.168.1.20 and bearer Bearer abcdefghijklmnop.",
      "api_key=sk-proj-abcdefghijklmnop123456",
      "<script>alert(1)</script>",
      "-----BEGIN PRIVATE KEY-----",
      "secret-body",
      "-----END PRIVATE KEY-----",
    ].join("\r\n");

    const result = redactSemanticGoal(source);
    expect(result.text).toContain("[REDACTED_PATH]");
    expect(result.text).toContain("[REDACTED_EMAIL]");
    expect(result.text).toContain("[REDACTED_URL]");
    expect(result.text).toContain("[REDACTED_IP]");
    expect(result.text).toContain("[REDACTED_BEARER]");
    expect(result.text).toContain("[REDACTED_PRIVATE_KEY]");
    expect(result.text).not.toContain("alice@example.com");
    expect(result.text).not.toContain("sk-proj-");
    expect(result.text).not.toContain("<");
    expect(result.text).not.toContain(">");
    expect(result.text).not.toContain("\r");
    expect(result.redactions.map((entry) => entry.kind)).toEqual(
      result.redactions
        .map((entry) => entry.kind)
        .toSorted(
          (left, right) =>
            [
              "private_key",
              "bearer_credential",
              "provider_token",
              "secret_assignment",
              "absolute_path",
              "url",
              "email",
              "ip_address",
              "markup",
              "control_character",
            ].indexOf(left) -
            [
              "private_key",
              "bearer_credential",
              "provider_token",
              "secret_assignment",
              "absolute_path",
              "url",
              "email",
              "ip_address",
              "markup",
              "control_character",
            ].indexOf(right),
        ),
    );
  });

  it("preserves useful safe text and deterministic truncation", () => {
    const safe = "Add evidence-backed replay navigation and preserve package.json behavior.";
    expect(redactSemanticGoal(safe)).toMatchObject({
      text: safe,
      truncated: false,
      redactions: [],
    });

    const long = "😀".repeat(5_000);
    const first = redactSemanticGoal(long);
    const second = redactSemanticGoal(long);
    expect(first).toEqual(second);
    expect(first.truncated).toBe(true);
    expect(first.text.endsWith("[TRUNCATED]")).toBe(true);
    expect(first.retainedCodePointCount).toBeLessThanOrEqual(4_000);
    expect(first.retainedByteCount).toBeLessThanOrEqual(16 * 1024);
  });

  it("keeps verification status-independent text reduction bounded", () => {
    const result = redactSemanticVerificationExcerpt(
      "Tests passed at https://ci.example.com for /private/repo and owner@example.com",
    );
    expect(result.text).toContain("Tests passed");
    expect(result.text).toContain("[REDACTED_URL]");
    expect(result.text).toContain("[REDACTED_PATH]");
    expect(result.retainedCodePointCount).toBeLessThanOrEqual(1_000);
    expect(result.retainedByteCount).toBeLessThanOrEqual(4 * 1024);
  });

  it("fails closed for invalid Unicode", () => {
    expect(() => redactSemanticGoal(String.fromCharCode(0xd800))).toThrow(
      SemanticInputRedactionError,
    );
  });
});
