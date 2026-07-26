import {
  forwardCompatibleCodexHookFixtures,
  invalidCodexHookPayloadFixtures,
  validCodexHookFixtures,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import { SUPPORTED_CODEX_HOOK_NAMES, SupportedCodexHookPayloadSchema } from "../src/index.js";

describe("supported Codex hook payloads", () => {
  it.each(validCodexHookFixtures)("parses $name", ({ input }) => {
    expect(SupportedCodexHookPayloadSchema.safeParse(input).success).toBe(true);
  });

  it("covers every supported hook exactly once", () => {
    expect(validCodexHookFixtures.map(({ name }) => name)).toEqual(SUPPORTED_CODEX_HOOK_NAMES);
  });

  it.each(forwardCompatibleCodexHookFixtures)("accepts $name", ({ input }) => {
    expect(SupportedCodexHookPayloadSchema.safeParse(input).success).toBe(true);
  });

  it("drops unknown upstream fields rather than persisting them wholesale", () => {
    const parsed = SupportedCodexHookPayloadSchema.parse(
      forwardCompatibleCodexHookFixtures[0].input,
    );

    expect(parsed).not.toHaveProperty("future_common_field");
  });

  it("matches the current official PermissionRequest schema without inventing tool_use_id", () => {
    const parsed = SupportedCodexHookPayloadSchema.parse(validCodexHookFixtures[3].input);

    expect(parsed.hook_event_name).toBe("PermissionRequest");
    if (parsed.hook_event_name === "PermissionRequest") {
      expect(parsed).not.toHaveProperty("tool_use_id");
    }
  });

  it.each(invalidCodexHookPayloadFixtures)("rejects $name", ({ input }) => {
    expect(SupportedCodexHookPayloadSchema.safeParse(input).success).toBe(false);
  });
});
