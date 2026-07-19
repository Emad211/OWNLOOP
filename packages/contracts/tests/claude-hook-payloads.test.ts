import {
  forwardCompatibleClaudeHookFixtures,
  invalidClaudeHookPayloadFixtures,
  validClaudeHookFixtures,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES, SupportedClaudeHookPayloadSchema } from "../src/index.js";

describe("supported Claude hook payloads", () => {
  it.each(validClaudeHookFixtures)("parses $name", ({ input }) => {
    expect(SupportedClaudeHookPayloadSchema.safeParse(input).success).toBe(true);
  });

  it("covers every supported hook exactly once", () => {
    expect(validClaudeHookFixtures.map(({ name }) => name)).toEqual(SUPPORTED_CLAUDE_HOOK_NAMES);
  });

  it.each(forwardCompatibleClaudeHookFixtures)("accepts $name", ({ input }) => {
    expect(SupportedClaudeHookPayloadSchema.safeParse(input).success).toBe(true);
  });

  it("preserves unknown common and event-specific fields", () => {
    const commonResult = SupportedClaudeHookPayloadSchema.parse(
      forwardCompatibleClaudeHookFixtures[0].input,
    );
    const eventResult = SupportedClaudeHookPayloadSchema.parse(
      forwardCompatibleClaudeHookFixtures[1].input,
    );

    expect(commonResult.future_common_field).toEqual({ enabled: true });
    expect(eventResult.future_result_metadata).toEqual({ version: 2 });
  });

  it("preserves unknown fields on nested PostToolBatch calls", () => {
    const result = SupportedClaudeHookPayloadSchema.parse(
      forwardCompatibleClaudeHookFixtures[2].input,
    );

    expect(result.hook_event_name).toBe("PostToolBatch");
    if (result.hook_event_name === "PostToolBatch") {
      expect(result.tool_calls[0]?.future_call_field).toEqual({ retained: true });
    }
  });

  it.each(invalidClaudeHookPayloadFixtures)("rejects $name", ({ input }) => {
    expect(SupportedClaudeHookPayloadSchema.safeParse(input).success).toBe(false);
  });

  it("reports an inspectable issue path for a missing common field", () => {
    const result = SupportedClaudeHookPayloadSchema.safeParse(
      invalidClaudeHookPayloadFixtures[0].input,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({ path }) => path.includes("session_id"))).toBe(true);
    }
  });
});
