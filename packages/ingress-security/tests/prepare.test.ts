import { createSecretKey } from "node:crypto";
import { type ClaudeAdapterIngress, PreparedIngressReceiptV1Schema } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import {
  ARRAY_TRUNCATION_MARKER,
  IngressSecurityError,
  MAX_ARRAY_ITEMS,
  MAX_RETAINED_STRING_UTF8_BYTES,
  PERSISTED_HOOK_FIELD_ALLOWLISTS,
  prepareIngressReceipt,
  REDACTION_MARKER,
  STRING_TRUNCATION_MARKER,
} from "../src/index.js";
import { ingressFixture, SUPPORTED_HOOKS } from "./fixtures.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 9));

function prepare(ingress: ClaudeAdapterIngress, homePath = "/home/fixture") {
  return prepareIngressReceipt(ingress, { hmacKey: HMAC_KEY, homePath });
}

function parsedPayload(ingress: ClaudeAdapterIngress): Record<string, unknown> {
  return JSON.parse(prepare(ingress).redactedPayloadJson) as Record<string, unknown>;
}

function recursivelySerialize(value: unknown): string {
  return JSON.stringify(value);
}

describe("prepareIngressReceipt", () => {
  it("produces a strict prepared receipt for every supported Hook", () => {
    for (const hook of SUPPORTED_HOOKS) {
      const prepared = prepare(ingressFixture(hook));
      expect(PreparedIngressReceiptV1Schema.safeParse(prepared).success).toBe(true);
      expect(JSON.stringify(JSON.parse(prepared.redactedPayloadJson))).toBeDefined();
      expect(prepared.redactionSummary.outputUtf8Bytes).toBe(
        Buffer.byteLength(prepared.redactedPayloadJson, "utf8"),
      );
      expect(PERSISTED_HOOK_FIELD_ALLOWLISTS[hook]).toBeDefined();
    }
  });

  it("drops unknown schema-extension fields for every supported Hook", () => {
    for (const hook of SUPPORTED_HOOKS) {
      const prepared = prepare(
        ingressFixture(hook, {
          future_top_level_fixture: "must-be-dropped",
          effort: { level: "high", future_effort_fixture: "must-be-dropped" },
        }),
      );
      const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;
      expect(payload).not.toHaveProperty("future_top_level_fixture");
      expect(payload).not.toHaveProperty("effort.future_effort_fixture");
      expect(prepared.redactionSummary.droppedUnknownFieldCount).toBeGreaterThanOrEqual(2);
    }

    const batch = prepare(
      ingressFixture("PostToolBatch", {
        tool_calls: [
          {
            tool_name: "Read",
            tool_input: {},
            tool_use_id: "tool-fixture-batch-unknown",
            tool_response: null,
            future_call_wrapper: "must-be-dropped",
          },
        ],
      }),
    );
    expect(JSON.parse(batch.redactedPayloadJson)).not.toHaveProperty(
      "tool_calls.0.future_call_wrapper",
    );
  });

  it("drops unknown Hook-schema fields but retains arbitrary tool data", () => {
    const ingress = ingressFixture("PostToolUse", {
      future_top_level: { unsafe: true },
      tool_input: {
        future_arbitrary_field: true,
        nested: { future_data: "retained" },
      },
      tool_response: {
        future_response_data: "retained",
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("future_top_level");
    expect(payload).toHaveProperty("tool_input.future_arbitrary_field", true);
    expect(payload).toHaveProperty("tool_input.nested.future_data", "retained");
    expect(payload).toHaveProperty("tool_response.future_response_data", "retained");
    expect(prepared.redactionSummary.droppedUnknownFieldCount).toBeGreaterThanOrEqual(1);
    expect(prepared.redactionSummary.rulesApplied).toContain("field.unknown-dropped");
  });

  it("removes routing fields from redacted payload", () => {
    const payload = parsedPayload(ingressFixture("UserPromptSubmit"));
    expect(payload).not.toHaveProperty("session_id");
    expect(payload).not.toHaveProperty("hook_event_name");
    expect(payload).not.toHaveProperty("cwd");
    expect(payload).not.toHaveProperty("transcript_path");
    expect(payload).not.toHaveProperty("prompt_id");
  });

  it("redacts every exact secret-bearing field name in policy v1", () => {
    const secretFieldNames = [
      "authorization",
      "proxy_authorization",
      "cookie",
      "set-cookie",
      "password",
      "passwd",
      "secret",
      "client.secret",
      "api-key",
      "access_token",
      "refresh token",
      "id-token",
      "token",
      "private_key",
      "ssh-private-key",
      "credential",
      "credentials",
    ];
    const toolInput = Object.fromEntries(
      secretFieldNames.map((name, index) => [name, `fixture-secret-${index}`]),
    );
    const prepared = prepare(ingressFixture("PreToolUse", { tool_input: toolInput }));
    const payload = JSON.parse(prepared.redactedPayloadJson) as {
      tool_input: Record<string, unknown>;
    };

    for (const name of secretFieldNames) {
      expect(payload.tool_input[name]).toBe(REDACTION_MARKER);
    }
    expect(prepared.redactionSummary.redactedFieldCount).toBe(secretFieldNames.length);
    expect(prepared.redactionSummary.redactedValueCount).toBe(secretFieldNames.length);
  });

  it("redacts exact secret-bearing fields without overmatching token metadata", () => {
    const ingress = ingressFixture("PreToolUse", {
      tool_input: {
        password: "fixture-password-value",
        api_key: "fixture-api-key-value",
        nested: { access_token: "fixture-access-token-value" },
        max_tokens: 2048,
        token_count: 12,
        token_limit: 4096,
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;

    expect(payload).toHaveProperty("tool_input.password", REDACTION_MARKER);
    expect(payload).toHaveProperty("tool_input.api_key", REDACTION_MARKER);
    expect(payload).toHaveProperty("tool_input.nested.access_token", REDACTION_MARKER);
    expect(payload).toHaveProperty("tool_input.max_tokens", 2048);
    expect(payload).toHaveProperty("tool_input.token_count", 12);
    expect(payload).toHaveProperty("tool_input.token_limit", 4096);
    expect(prepared.redactionSummary.redactedFieldCount).toBe(3);
  });

  it("redacts strong secret patterns and leaves no fixture secret", () => {
    const secretFragments = [
      "fixtureBearerValue123456",
      "fixtureBasicValue123456",
      "fixtureAssignmentValue123456",
      "fixtureUriPassword123456",
      "fixture-provider-token_fixtureValue123456",
      "fixturePrivateKeyBody123456",
    ];
    const ingress = ingressFixture("PreToolUse", {
      tool_input: {
        authorization_line: `Bearer ${secretFragments[0]}`,
        basic_line: `Basic ${secretFragments[1]}`,
        assignment_line: `client_secret=${secretFragments[2]}`,
        uri_line: `https://fixture-user:${secretFragments[3]}@example.invalid/path`,
        provider_line: secretFragments[4],
        pem_line: `-----BEGIN PRIVATE KEY-----\n${secretFragments[5]}\n-----END PRIVATE KEY-----`,
      },
    });
    const prepared = prepare(ingress);
    const serialized = recursivelySerialize(prepared);

    for (const secret of secretFragments) {
      expect(serialized).not.toContain(secret);
    }
    expect(prepared.redactionSummary.rulesApplied).toEqual(
      expect.arrayContaining([
        "string.authorization",
        "string.assignment",
        "string.uri-password",
        "string.provider-token",
        "string.private-key",
      ]),
    );
  });

  it("redacts an unterminated private-key block through the end of the string", () => {
    const privateBody = "fixtureUnterminatedPrivateKeyBody123456";
    const trailingSecret = "fixtureTrailingPrivateKeyContent123456";
    const prepared = prepare(
      ingressFixture("PreToolUse", {
        tool_input: {
          value: `before -----BEGIN PRIVATE KEY-----\n${privateBody}\n${trailingSecret}`,
        },
      }),
    );
    const serialized = JSON.stringify(prepared);

    expect(serialized).not.toContain(privateBody);
    expect(serialized).not.toContain(trailingSecret);
    expect(serialized).toContain(REDACTION_MARKER);
    expect(prepared.redactionSummary.rulesApplied).toContain("string.private-key");
  });

  it("redacts each explicitly supported provider-token prefix", () => {
    const values = [
      `sk-proj-${"a".repeat(24)}`,
      `ghp_${"b".repeat(24)}`,
      `github_pat_${"c".repeat(24)}`,
      `xoxb-${"d".repeat(24)}`,
    ];
    const prepared = prepare(
      ingressFixture("PreToolUse", {
        tool_input: Object.fromEntries(values.map((value, index) => [`value_${index}`, value])),
      }),
    );
    const serialized = JSON.stringify(prepared);
    for (const value of values) {
      expect(serialized).not.toContain(value);
    }
    expect(prepared.redactionSummary.rulesApplied).toContain("string.provider-token");
  });

  it("reduces POSIX workspace, transcript, home, and unrelated paths", () => {
    const ingress = ingressFixture("PreToolUse", {
      tool_input: {
        file_path: "/home/fixture/workspace/project/src/index.ts",
        transcript: "/home/fixture/.claude/transcript.jsonl",
        home_file: "/home/fixture/notes.txt",
        external_path: "/opt/fixture/private/output.log",
        message:
          "Read /home/fixture/workspace/project/src/a.ts and /home/fixture/.claude/transcript.jsonl; visit https://example.invalid/docs/path",
        relative_file: "src\\relative.ts",
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(payload).toHaveProperty("tool_input.file_path", "$WORKSPACE/src/index.ts");
    expect(payload).toHaveProperty("tool_input.transcript", "$CLAUDE_TRANSCRIPT");
    expect(payload).toHaveProperty("tool_input.home_file", "$HOME/notes.txt");
    expect(payload).toHaveProperty("tool_input.external_path", "$ABSOLUTE/output.log");
    expect(serialized).toContain("$WORKSPACE/src/a.ts");
    expect(serialized).toContain("https://example.invalid/docs/path");
    expect(payload).toHaveProperty("tool_input.relative_file", "src/relative.ts");
    expect(serialized).not.toContain("/home/fixture");
    expect(serialized).not.toContain("/opt/fixture");
    expect(prepared.canonicalWorkspacePath).toBe("/home/fixture/workspace/project");
  });

  it("reduces POSIX, Windows, and UNC file URIs without changing ordinary URLs", () => {
    const ingress = ingressFixture("PreToolUse", {
      tool_input: {
        workspace_uri: "file:///home/fixture/workspace/project/src/file-uri.ts",
        windows_uri: "file:///C:/Users/Fixture/Private/result.txt",
        unc_uri: "file://FixtureServer/PrivateShare/secret.txt",
        message:
          "Read file:///home/fixture/workspace/project/src/embedded.ts and keep https://example.invalid/file:///docs",
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(payload).toHaveProperty("tool_input.workspace_uri", "$WORKSPACE/src/file-uri.ts");
    expect(payload).toHaveProperty("tool_input.windows_uri", "$ABSOLUTE/result.txt");
    expect(payload).toHaveProperty("tool_input.unc_uri", "$ABSOLUTE/secret.txt");
    expect(serialized).toContain("$WORKSPACE/src/embedded.ts");
    expect(serialized).toContain("https://example.invalid/file:///docs");
    expect(serialized).not.toContain("file:///home/fixture");
    expect(serialized).not.toContain("file:///C:/Users/Fixture");
    expect(serialized).not.toContain("file://FixtureServer");
  });

  it("reduces unrelated absolute paths embedded in text and object keys", () => {
    const pathKey = "/home/fixture/workspace/project/src/keyed.ts";
    const secretKey = "ghp_fixtureSecretKey123456";
    const ingress = ingressFixture("PreToolUse", {
      tool_input: {
        message:
          'Compare /opt/private/output.log with "C:\\Private Folder\\result.txt" and /home/fixture/workspace/project2/not-owned.ts',
        [pathKey]: "path-key-value",
        [secretKey]: "secret-key-value",
      },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as {
      tool_input: Record<string, unknown>;
    };
    const serialized = JSON.stringify(payload);

    expect(payload.tool_input.message).toBe(
      'Compare $ABSOLUTE/output.log with "$ABSOLUTE/result.txt" and $HOME/workspace/project2/not-owned.ts',
    );
    expect(payload.tool_input).toHaveProperty("$WORKSPACE/src/keyed.ts", "path-key-value");
    expect(Object.keys(payload.tool_input)).toContain(REDACTION_MARKER);
    expect(serialized).not.toContain("/opt/private");
    expect(serialized).not.toContain("C:\\Private Folder");
    expect(serialized).not.toContain(pathKey);
    expect(serialized).not.toContain(secretKey);
    expect(prepared.redactionSummary.pathReplacementCount).toBeGreaterThanOrEqual(3);
  });

  it("retains __proto__ as inert data without prototype pollution", () => {
    const toolInput = JSON.parse('{"__proto__":{"polluted":"yes"},"safe":"value"}') as Record<
      string,
      unknown
    >;
    const ingress = ingressFixture("PreToolUse") as ClaudeAdapterIngress;
    (ingress.payload as unknown as { tool_input: Record<string, unknown> }).tool_input = toolInput;
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as {
      tool_input: Record<string, unknown>;
    };

    expect(Object.hasOwn(payload.tool_input, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(payload.tool_input, "__proto__")?.value).toEqual({
      polluted: "yes",
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles Windows paths independently of host operating system", () => {
    const ingress = {
      ...ingressFixture("PreToolUse"),
      payload: {
        ...ingressFixture("PreToolUse").payload,
        cwd: "C:\\Users\\Fixture\\Project",
        transcript_path: "C:\\Users\\Fixture\\.claude\\transcript.jsonl",
        tool_input: {
          file_path: "c:\\users\\fixture\\project\\src\\index.ts",
          home_file: "C:\\Users\\Fixture\\notes.txt",
          external_path: "D:\\Private\\fixture.log",
          unc_path: "\\\\FixtureServer\\PrivateShare\\secret.txt",
        },
      },
    } as ClaudeAdapterIngress;
    const prepared = prepare(ingress, "C:\\Users\\Fixture");
    const payload = JSON.parse(prepared.redactedPayloadJson) as Record<string, unknown>;

    expect(payload).toHaveProperty("tool_input.file_path", "$WORKSPACE/src/index.ts");
    expect(payload).toHaveProperty("tool_input.home_file", "$HOME/notes.txt");
    expect(payload).toHaveProperty("tool_input.external_path", "$ABSOLUTE/fixture.log");
    expect(payload).toHaveProperty("tool_input.unc_path", "$ABSOLUTE/secret.txt");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("c:\\\\users\\\\fixture");
  });

  it("truncates arbitrary strings and arrays with explicit markers", () => {
    const longString = "é".repeat(MAX_RETAINED_STRING_UTF8_BYTES);
    const longArray = Array.from({ length: MAX_ARRAY_ITEMS + 25 }, (_, index) => index);
    const ingress = ingressFixture("PreToolUse", {
      tool_input: { long_string: longString, long_array: longArray },
    });
    const prepared = prepare(ingress);
    const payload = JSON.parse(prepared.redactedPayloadJson) as {
      tool_input: { long_string: string; long_array: unknown[] };
    };

    expect(payload.tool_input.long_string.endsWith(STRING_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(payload.tool_input.long_string, "utf8")).toBeLessThanOrEqual(
      MAX_RETAINED_STRING_UTF8_BYTES,
    );
    expect(payload.tool_input.long_array).toHaveLength(MAX_ARRAY_ITEMS);
    expect(payload.tool_input.long_array.at(-1)).toEqual(ARRAY_TRUNCATION_MARKER);
    expect(prepared.redactionSummary.truncatedValueCount).toBe(2);
    expect(prepared.redactionSummary.rulesApplied).toEqual(
      expect.arrayContaining(["truncate.string", "truncate.array"]),
    );
  });

  it("rejects structural array overflow rather than silently dropping events", () => {
    const toolCall = {
      tool_name: "Read",
      tool_input: {},
      tool_use_id: "tool-fixture-structural",
      tool_response: null,
    };
    const ingress = ingressFixture("PostToolBatch", {
      tool_calls: Array.from({ length: MAX_ARRAY_ITEMS + 1 }, () => toolCall),
    });
    expect(() => prepare(ingress)).toThrowError(
      expect.objectContaining({ code: "array_item_limit" }),
    );
  });

  it("rejects background-task and session-cron structural array overflow", () => {
    const backgroundOverflow = ingressFixture("Stop", {
      background_tasks: Array.from({ length: MAX_ARRAY_ITEMS + 1 }, (_, index) => ({ index })),
    });
    const cronOverflow = ingressFixture("Stop", {
      session_crons: Array.from({ length: MAX_ARRAY_ITEMS + 1 }, (_, index) => ({ index })),
    });

    expect(() => prepare(backgroundOverflow)).toThrowError(
      expect.objectContaining({ code: "array_item_limit" }),
    );
    expect(() => prepare(cronOverflow)).toThrowError(
      expect.objectContaining({ code: "array_item_limit" }),
    );
  });

  it("rejects reduced output that remains above 256 KiB", () => {
    const chunk = "x".repeat(60 * 1024);
    const ingress = ingressFixture("PreToolUse", {
      tool_input: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`chunk_${index}`, chunk]),
      ),
    });
    expect(() => prepare(ingress)).toThrowError(
      expect.objectContaining({ code: "input_too_large" }),
    );

    const underInputButOverOutput = ingressFixture("PreToolUse", {
      tool_input: {
        a: "x".repeat(55 * 1024),
        b: "y".repeat(55 * 1024),
        c: "z".repeat(55 * 1024),
        d: "q".repeat(55 * 1024),
        e: "r".repeat(55 * 1024),
      },
    });
    expect(() => prepare(underInputButOverOutput)).toThrowError(
      expect.objectContaining({ code: "output_too_large" }),
    );
  });

  it("rejects non-absolute or control-bearing workspace paths", () => {
    const relative = ingressFixture("PreToolUse") as ClaudeAdapterIngress;
    (relative.payload as unknown as { cwd: string }).cwd = "relative/workspace";
    expect(() => prepare(relative)).toThrowError(
      expect.objectContaining({ code: "invalid_workspace_path" }),
    );

    const controlBearing = ingressFixture("PreToolUse") as ClaudeAdapterIngress;
    (controlBearing.payload as unknown as { cwd: string }).cwd = "/workspace/fixture\nprivate";
    expect(() => prepare(controlBearing)).toThrowError(
      expect.objectContaining({ code: "invalid_workspace_path" }),
    );
  });

  it("does not mutate input or return input/key references", () => {
    const ingress = ingressFixture("PreToolUse", {
      tool_input: { nested: { value: "fixture" } },
    });
    const before = JSON.stringify(ingress);
    const prepared = prepare(ingress);

    expect(JSON.stringify(ingress)).toBe(before);
    expect(prepared).not.toBe(ingress);
    expect(prepared as unknown as Record<string, unknown>).not.toHaveProperty("hmacKey");
    expect(JSON.stringify(prepared)).not.toContain(HMAC_KEY.export().toString("hex"));
  });

  it("distinguishes raw payloads that reduce to the same redacted output", () => {
    const first = ingressFixture("PreToolUse", {
      tool_input: { password: "fixture-secret-one" },
    });
    const second = ingressFixture("PreToolUse", {
      tool_input: { password: "fixture-secret-two" },
    });
    const preparedFirst = prepare(first);
    const preparedSecond = prepare(second);

    expect(preparedFirst.redactedPayloadJson).toBe(preparedSecond.redactedPayloadJson);
    expect(preparedFirst.payloadFingerprint).not.toBe(preparedSecond.payloadFingerprint);
  });

  it("canonical redacted JSON re-canonicalizes identically", async () => {
    const prepared = prepare(ingressFixture("PostToolUse"));
    const { canonicalizeJson } = await import("../src/index.js");
    expect(canonicalizeJson(JSON.parse(prepared.redactedPayloadJson))).toBe(
      prepared.redactedPayloadJson,
    );
  });

  it("keeps errors free of secret and absolute-path fixture content", () => {
    const secret = "fixture-error-secret-value";
    const absolutePath = "/home/fixture/private/error.txt";
    const cyclic: Record<string, unknown> = { password: secret, file_path: absolutePath };
    cyclic.self = cyclic;
    const ingress = ingressFixture("PreToolUse") as ClaudeAdapterIngress;
    (ingress.payload as unknown as { tool_input: Record<string, unknown> }).tool_input = cyclic;

    let error: unknown;
    try {
      prepare(ingress);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IngressSecurityError);
    const surfaces = `${String(error)} ${JSON.stringify(error)}`;
    expect(surfaces).not.toContain(secret);
    expect(surfaces).not.toContain(absolutePath);
  });

  it("sanitizes user-controlled object keys from error paths", () => {
    const maliciousKey = "/home/fixture/private/ghp_fixtureSecretPath123456";
    const ingress = ingressFixture("PreToolUse") as ClaudeAdapterIngress;
    (ingress.payload as unknown as { tool_input: Record<string, unknown> }).tool_input = {
      [maliciousKey]: -0,
    };

    let error: unknown;
    try {
      prepare(ingress);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(IngressSecurityError);
    expect(JSON.stringify(error)).not.toContain(maliciousKey);
    expect(JSON.stringify(error)).toContain("$field");
  });

  it("handles adversarial long strings without pathological pattern behavior", () => {
    const adversarial = `${"a".repeat(60_000)} bearer ${"!".repeat(3_000)}`;
    const ingress = ingressFixture("PreToolUse", { tool_input: { value: adversarial } });
    const started = performance.now();
    prepare(ingress);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
