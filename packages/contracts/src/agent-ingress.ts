import { z } from "zod";

import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";
import {
  SUPPORTED_CODEX_HOOK_NAMES,
  SupportedCodexHookNameSchema,
} from "./codex-hook-common.js";

export const INGRESS_AGENT_SOURCES = ["claude_code", "codex"] as const;
export const IngressAgentSourceSchema = z.enum(INGRESS_AGENT_SOURCES);
export type IngressAgentSource = z.infer<typeof IngressAgentSourceSchema>;

export const SUPPORTED_AGENT_HOOK_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
  "PostToolUseFailure",
  "PostToolBatch",
  "StopFailure",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
] as const;
export const SupportedAgentHookNameSchema = z.enum(SUPPORTED_AGENT_HOOK_NAMES);
export type SupportedAgentHookName = z.infer<typeof SupportedAgentHookNameSchema>;

export const MAX_INGRESS_AGENT_HOOK_IDENTITIES =
  SUPPORTED_CLAUDE_HOOK_NAMES.length + SUPPORTED_CODEX_HOOK_NAMES.length;

const CLAUDE_HOOK_SET = new Set<string>(SUPPORTED_CLAUDE_HOOK_NAMES);
const CODEX_HOOK_SET = new Set<string>(SUPPORTED_CODEX_HOOK_NAMES);

export const AgentIngressHookIdentitySchema = z
  .strictObject({
    source: IngressAgentSourceSchema,
    hookName: SupportedAgentHookNameSchema,
  })
  .superRefine((value, context) => {
    const valid =
      value.source === "claude_code"
        ? CLAUDE_HOOK_SET.has(value.hookName)
        : CODEX_HOOK_SET.has(value.hookName);
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["hookName"],
        message: "The Hook name is not supported by the declared ingress source.",
      });
    }
  });
export type AgentIngressHookIdentity = z.infer<typeof AgentIngressHookIdentitySchema>;

export function isSupportedAgentHook(
  source: IngressAgentSource,
  hookName: string,
): hookName is SupportedAgentHookName {
  return source === "claude_code" ? CLAUDE_HOOK_SET.has(hookName) : CODEX_HOOK_SET.has(hookName);
}

export { SupportedClaudeHookNameSchema, SupportedCodexHookNameSchema };
