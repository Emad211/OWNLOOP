import { createSecretKey } from "node:crypto";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
  PreparedCodexIngressReceiptV1Schema,
} from "@ownloop/contracts/codex";
import { describe, expect, it } from "vitest";
import {
  extractCodexSourceEventId,
  prepareCodexIngressReceipt,
  REDACTION_MARKER,
} from "../src/index.js";
import { validCodexHookFixtures } from "./codex-fixtures.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 17));

function ingressFor(
  input: CodexAdapterIngress["payload"],
  overrides: Partial<CodexAdapterIngress> = {},
): CodexAdapterIngress {
  return CodexAdapterIngressSchema.parse({
    contractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceVersion: "codex-cli 0.133.0",
    sourceSurface: "cli",
    receivedAt: "2026-07-27T08:30:00.000Z",
    payload: input,
    ...overrides,
  });
}

function prepare(ingress: CodexAdapterIngress) {
  return prepareCodexIngressReceipt(ingress, {
    hmacKey: HMAC_KEY,
    homePath: "C:\\Users\\Fixture",
  });
}

function payloadOf(ingress: CodexAdapterIngress): Record<string, unknown> {
  return JSON.parse(prepare(ingress).redactedPayloadJson) as Record<string, unknown>;
}

describe("prepareCodexIngressReceipt", () => {
  it("prepares every official Codex lifecycle event through the strict receipt contract", () => {
    for (const fixture of validCodexHookFixtures) {
      const ingress = ingressFor(fixture.input);
      const prepared = prepare(ingress);
      expect(PreparedCodexIngressReceiptV1Schema.safeParse(prepared).success).toBe(true);
      expect(prepared.source).toBe("codex");
      expect(prepared.sourceEventName).toBe(fixture.name);
      expect(prepared.sourceEventId).toBe(extractCodexSourceEventId(ingress.payload));
      expect(prepared.redactionSummary.outputUtf8Bytes).toBe(
        Buffer.byteLength(prepared.redactedPayloadJson, "utf8"),
      );
    }
  });

  it("derives deterministic event identities without inventing PermissionRequest IDs", () => {
    const expectedIds = new Map([
      ["SessionStart", null],
      ["UserPromptSubmit", "turn-fixture-001"],
      ["PreToolUse", "tool-fixture-001"],
      ["PermissionRequest", null],
      ["PostToolUse", "tool-fixture-001"],
      ["PreCompact", "turn-fixture-001"],
      ["PostCompact", "turn-fixture-001"],
      ["SubagentStart", "agent-fixture-001"],
      ["SubagentStop", "agent-fixture-001"],
      ["Stop", "turn-fixture-001"],
      ["SessionEnd", null],
    ]);

    for (const fixture of validCodexHookFixtures) {
      expect(prepare(ingressFor(fixture.input)).sourceEventId).toBe(expectedIds.get(fixture.name));
    }
  });

  it("uses HMAC deduplication for PermissionRequest and changes it when controlled input changes", () => {
    const permission = validCodexHookFixtures[3].input;
    const first = prepare(ingressFor(permission));
    const duplicate = prepare(ingressFor(permission));
    const changed = prepare(
      ingressFor({
        ...permission,
        tool_input: { command: "git diff --stat" },
      }),
    );

    expect(first.sourceEventId).toBeNull();
    expect(first.deduplicationKey).toMatch(/^v1:PermissionRequest:hmac:[0-9a-f]{64}$/u);
    expect(duplicate.deduplicationKey).toBe(first.deduplicationKey);
    expect(changed.deduplicationKey).not.toBe(first.deduplicationKey);
  });

  it("removes all routing and transcript fields from stable redacted payloads", () => {
    for (const fixture of validCodexHookFixtures) {
      const payload = payloadOf(ingressFor(fixture.input));
      expect(payload).not.toHaveProperty("session_id");
      expect(payload).not.toHaveProperty("hook_event_name");
      expect(payload).not.toHaveProperty("cwd");
      expect(payload).not.toHaveProperty("transcript_path");
      expect(payload).not.toHaveProperty("tool_use_id");
      expect(payload).not.toHaveProperty("agent_transcript_path");
    }
  });

  it("retains only controlled adapter capability metadata", () => {
    const payload = payloadOf(ingressFor(validCodexHookFixtures[2].input));
    expect(payload).toMatchObject({
      source_surface: "cli",
      source_version: "codex-cli 0.133.0",
      turn_id: "turn-fixture-001",
      model: "gpt-5.6-codex",
      permission_mode: "default",
    });
  });

  it("redacts secret fields and absolute paths inside Codex tool data", () => {
    const preTool = validCodexHookFixtures[2].input;
    const ingress = ingressFor({
      ...preTool,
      tool_input: {
        password: "fixture-password",
        authorization: `Bearer fixtureBearerValue123456`,
        file_path: "C:\\workspace\\project\\src\\secret.ts",
        home_file: "C:\\Users\\Fixture\\notes.txt",
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(payload).toHaveProperty("tool_input.password", REDACTION_MARKER);
    expect(serialized).not.toContain("fixture-password");
    expect(serialized).not.toContain("fixtureBearerValue123456");
    expect(payload).toHaveProperty("tool_input.file_path", "$WORKSPACE/src/secret.ts");
    expect(payload).toHaveProperty("tool_input.home_file", "$HOME/notes.txt");
    expect(prepared.redactionSummary.rulesApplied).toEqual(
      expect.arrayContaining(["field.secret", "path.workspace", "path.home"]),
    );
  });

  it("rejects unknown wrapper fields and strips unknown payload fields", () => {
    expect(() =>
      CodexAdapterIngressSchema.parse({
        ...ingressFor(validCodexHookFixtures[0].input),
        future_wrapper: "reject",
      }),
    ).toThrow();

    const parsed = CodexAdapterIngressSchema.parse({
      ...ingressFor(validCodexHookFixtures[0].input),
      payload: {
        ...validCodexHookFixtures[0].input,
        future_payload: "drop",
      },
    });
    const payload = payloadOf(parsed);
    expect(payload).not.toHaveProperty("future_payload");
  });

  it("applies configured custom secret fields to arbitrary Codex tool data", () => {
    const preTool = validCodexHookFixtures[2].input;
    const ingress = ingressFor({
      ...preTool,
      tool_input: { organization_private_value: "fixture-private" },
    });
    const prepared = prepareCodexIngressReceipt(ingress, {
      hmacKey: HMAC_KEY,
      homePath: "C:\\Users\\Fixture",
      customSecretFieldPatterns: ["organizationprivate*"],
    });
    expect(JSON.parse(prepared.redactedPayloadJson)).toHaveProperty(
      "tool_input.organization_private_value",
      REDACTION_MARKER,
    );
    expect(prepared.redactionSummary.rulesApplied).toContain("field.secret.custom");
  });
});
