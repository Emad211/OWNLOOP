import { describe, expect, it } from "vitest";

import {
  AgentIngressHookIdentitySchema,
  isSupportedAgentHook,
  SUPPORTED_AGENT_HOOK_NAMES,
} from "../src/agent-ingress.js";

describe("multi-agent ingress Hook identity", () => {
  it("accepts shared and source-specific Hook names", () => {
    for (const identity of [
      { source: "claude_code", hookName: "SessionStart" },
      { source: "codex", hookName: "SessionStart" },
      { source: "claude_code", hookName: "PostToolBatch" },
      { source: "codex", hookName: "PermissionRequest" },
      { source: "codex", hookName: "SubagentStop" },
    ] as const) {
      expect(AgentIngressHookIdentitySchema.safeParse(identity).success).toBe(true);
    }
  });

  it("rejects Hook names that belong to the other source", () => {
    expect(
      AgentIngressHookIdentitySchema.safeParse({
        source: "claude_code",
        hookName: "PermissionRequest",
      }).success,
    ).toBe(false);
    expect(
      AgentIngressHookIdentitySchema.safeParse({
        source: "codex",
        hookName: "PostToolBatch",
      }).success,
    ).toBe(false);
  });

  it("keeps the combined Hook taxonomy sorted-free but unique", () => {
    expect(new Set(SUPPORTED_AGENT_HOOK_NAMES).size).toBe(SUPPORTED_AGENT_HOOK_NAMES.length);
    expect(isSupportedAgentHook("claude_code", "StopFailure")).toBe(true);
    expect(isSupportedAgentHook("codex", "StopFailure")).toBe(false);
  });
});
