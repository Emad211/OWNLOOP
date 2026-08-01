import { describe, expect, it } from "vitest";

import {
  CODEX_HOOK_CONFIGURATION_MAX_BYTES,
  CODEX_HOOK_CONFIGURATION_MAX_DEPTH,
  CodexHookConfigurationError,
  parseCodexHookConfigurationJson,
  serializeCodexHookConfigurationJson,
} from "../src/codex.js";

function errorCode(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof CodexHookConfigurationError ? error.code : "unexpected";
  }
}

describe("strict Codex Hook configuration JSON", () => {
  it("parses a bounded object and preserves unknown semantic content", () => {
    expect(
      parseCodexHookConfigurationJson(
        '{"future":{"enabled":true},"hooks":{"SessionStart":[]},"description":"fixture"}',
      ),
    ).toEqual({
      future: { enabled: true },
      hooks: { SessionStart: [] },
      description: "fixture",
    });
  });

  it.each([
    ['{"hooks":{},"hooks":[]}', "duplicate_key"],
    ['{"hooks":{},"\\u0068ooks":[]}', "duplicate_key"],
    ['{"outer":{"value":1,"value":2}}', "duplicate_key"],
    ['{"hooks":', "invalid_json"],
    ['{"hooks":{}} trailing', "invalid_json"],
    ['["not-an-object"]', "invalid_document"],
    ['{"__proto__":{"polluted":true}}', "invalid_document"],
    ['{"constructor":{"prototype":{"polluted":true}}}', "invalid_document"],
    ['{"value":-0}', "invalid_document"],
  ] as const)("rejects unsafe JSON with %s", (input, code) => {
    expect(errorCode(() => parseCodexHookConfigurationJson(input))).toBe(code);
  });

  it("rejects excessive nesting before JSON materialization", () => {
    const nested = `${"[".repeat(CODEX_HOOK_CONFIGURATION_MAX_DEPTH + 2)}0${"]".repeat(
      CODEX_HOOK_CONFIGURATION_MAX_DEPTH + 2,
    )}`;
    expect(errorCode(() => parseCodexHookConfigurationJson(nested))).toBe("invalid_json");
  });

  it("rejects UTF-8 input beyond the exact byte bound", () => {
    const oversized = JSON.stringify({ value: "😀".repeat(CODEX_HOOK_CONFIGURATION_MAX_BYTES) });
    expect(errorCode(() => parseCodexHookConfigurationJson(oversized))).toBe(
      "configuration_too_large",
    );
  });

  it("serializes deterministic sorted JSON with one trailing newline", () => {
    const first = serializeCodexHookConfigurationJson({
      z: 1,
      hooks: { Stop: [], SessionStart: [] },
      a: { y: 2, x: 1 },
    });
    const second = serializeCodexHookConfigurationJson({
      a: { x: 1, y: 2 },
      hooks: { SessionStart: [], Stop: [] },
      z: 1,
    });
    expect(first).toBe(second);
    expect(first).toBe(
      '{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "hooks": {\n    "SessionStart": [],\n    "Stop": []\n  },\n  "z": 1\n}\n',
    );
    expect(parseCodexHookConfigurationJson(first)).toEqual({
      a: { x: 1, y: 2 },
      hooks: { SessionStart: [], Stop: [] },
      z: 1,
    });
  });

  it("does not mutate the source object while serializing", () => {
    const input = { hooks: { SessionStart: [] }, future: { order: [3, 2, 1] } };
    const before = structuredClone(input);
    serializeCodexHookConfigurationJson(input);
    expect(input).toEqual(before);
  });
});
