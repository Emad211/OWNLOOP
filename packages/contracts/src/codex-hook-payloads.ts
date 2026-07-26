import { JsonValueSchema } from "@ownloop/event-model";
import { z } from "zod";

import {
  CODEX_MAX_IDENTIFIER_CODE_POINTS,
  CODEX_MAX_PATH_CODE_POINTS,
  CODEX_MAX_PROMPT_CODE_POINTS,
  CodexCompactCommonFieldsSchema,
  CodexSessionCommonFieldsSchema,
  CodexTurnCommonFieldsSchema,
} from "./codex-hook-common.js";

const nonEmptyStringSchema = z.string().min(1).max(CODEX_MAX_IDENTIFIER_CODE_POINTS);
const nullableMessageSchema = z.string().max(CODEX_MAX_PROMPT_CODE_POINTS).nullable();
const nullablePathSchema = z.string().max(CODEX_MAX_PATH_CODE_POINTS).nullable();

export const CODEX_SESSION_START_SOURCES = ["startup", "resume", "clear", "compact"] as const;
export const CodexSessionStartSourceSchema = z.enum(CODEX_SESSION_START_SOURCES);
export type CodexSessionStartSource = z.infer<typeof CodexSessionStartSourceSchema>;

export const CODEX_COMPACT_TRIGGERS = ["manual", "auto"] as const;
export const CodexCompactTriggerSchema = z.enum(CODEX_COMPACT_TRIGGERS);
export type CodexCompactTrigger = z.infer<typeof CodexCompactTriggerSchema>;

export const CODEX_SESSION_END_REASONS = ["other"] as const;
export const CodexKnownSessionEndReasonSchema = z.enum(CODEX_SESSION_END_REASONS);
export type CodexKnownSessionEndReason = z.infer<typeof CodexKnownSessionEndReasonSchema>;

export const CodexSessionStartPayloadSchema = CodexSessionCommonFieldsSchema.extend({
  hook_event_name: z.literal("SessionStart"),
  model: nonEmptyStringSchema,
  permission_mode: CodexTurnCommonFieldsSchema.shape.permission_mode,
  source: CodexSessionStartSourceSchema,
});
export type CodexSessionStartPayload = z.infer<typeof CodexSessionStartPayloadSchema>;

export const CodexUserPromptSubmitPayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string().max(CODEX_MAX_PROMPT_CODE_POINTS),
});
export type CodexUserPromptSubmitPayload = z.infer<typeof CodexUserPromptSubmitPayloadSchema>;

export const CodexPreToolUsePayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonValueSchema,
  tool_use_id: nonEmptyStringSchema,
});
export type CodexPreToolUsePayload = z.infer<typeof CodexPreToolUsePayloadSchema>;

export const CodexPermissionRequestPayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("PermissionRequest"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonValueSchema,
});
export type CodexPermissionRequestPayload = z.infer<typeof CodexPermissionRequestPayloadSchema>;

export const CodexPostToolUsePayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonValueSchema,
  tool_response: JsonValueSchema,
  tool_use_id: nonEmptyStringSchema,
});
export type CodexPostToolUsePayload = z.infer<typeof CodexPostToolUsePayloadSchema>;

export const CodexPreCompactPayloadSchema = CodexCompactCommonFieldsSchema.extend({
  hook_event_name: z.literal("PreCompact"),
  trigger: CodexCompactTriggerSchema,
});
export type CodexPreCompactPayload = z.infer<typeof CodexPreCompactPayloadSchema>;

export const CodexPostCompactPayloadSchema = CodexCompactCommonFieldsSchema.extend({
  hook_event_name: z.literal("PostCompact"),
  trigger: CodexCompactTriggerSchema,
});
export type CodexPostCompactPayload = z.infer<typeof CodexPostCompactPayloadSchema>;

export const CodexSubagentStartPayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("SubagentStart"),
  agent_id: nonEmptyStringSchema,
  agent_type: nonEmptyStringSchema,
});
export type CodexSubagentStartPayload = z.infer<typeof CodexSubagentStartPayloadSchema>;

export const CodexSubagentStopPayloadSchema = CodexTurnCommonFieldsSchema.extend({
  hook_event_name: z.literal("SubagentStop"),
  agent_id: nonEmptyStringSchema,
  agent_type: nonEmptyStringSchema,
  agent_transcript_path: nullablePathSchema,
  last_assistant_message: nullableMessageSchema,
  stop_hook_active: z.boolean(),
});
export type CodexSubagentStopPayload = z.infer<typeof CodexSubagentStopPayloadSchema>;

export const CodexStopPayloadSchema = CodexTurnCommonFieldsSchema.omit({
  agent_id: true,
  agent_type: true,
}).extend({
  hook_event_name: z.literal("Stop"),
  last_assistant_message: nullableMessageSchema,
  stop_hook_active: z.boolean(),
});
export type CodexStopPayload = z.infer<typeof CodexStopPayloadSchema>;

export const CodexSessionEndPayloadSchema = CodexSessionCommonFieldsSchema.extend({
  hook_event_name: z.literal("SessionEnd"),
  reason: nonEmptyStringSchema,
});
export type CodexSessionEndPayload = z.infer<typeof CodexSessionEndPayloadSchema>;

export const SupportedCodexHookPayloadSchema = z.discriminatedUnion("hook_event_name", [
  CodexSessionStartPayloadSchema,
  CodexUserPromptSubmitPayloadSchema,
  CodexPreToolUsePayloadSchema,
  CodexPermissionRequestPayloadSchema,
  CodexPostToolUsePayloadSchema,
  CodexPreCompactPayloadSchema,
  CodexPostCompactPayloadSchema,
  CodexSubagentStartPayloadSchema,
  CodexSubagentStopPayloadSchema,
  CodexStopPayloadSchema,
  CodexSessionEndPayloadSchema,
]);
export type SupportedCodexHookPayload = z.infer<typeof SupportedCodexHookPayloadSchema>;
