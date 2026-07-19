import { JsonObjectSchema, JsonValueSchema } from "@ownloop/event-model";
import { z } from "zod";

import {
  ClaudeHookCommonFieldsSchema,
  ClaudeLooseSourceObjectSchema,
} from "./claude-hook-common.js";

const nonEmptyStringSchema = z.string().min(1);
const durationSchema = z.number().finite().nonnegative();

export const CLAUDE_SESSION_START_SOURCES = ["startup", "resume", "clear", "compact"] as const;
export const ClaudeKnownSessionStartSourceSchema = z.enum(CLAUDE_SESSION_START_SOURCES);
export type ClaudeKnownSessionStartSource = z.infer<typeof ClaudeKnownSessionStartSourceSchema>;

export const ClaudeSessionStartPayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("SessionStart"),
  source: nonEmptyStringSchema,
  model: z.string().optional(),
  session_title: z.string().optional(),
});
export type ClaudeSessionStartPayload = z.infer<typeof ClaudeSessionStartPayloadSchema>;

export const ClaudeUserPromptSubmitPayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string(),
});
export type ClaudeUserPromptSubmitPayload = z.infer<typeof ClaudeUserPromptSubmitPayloadSchema>;

export const ClaudePreToolUsePayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("PreToolUse"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonObjectSchema,
  tool_use_id: nonEmptyStringSchema,
});
export type ClaudePreToolUsePayload = z.infer<typeof ClaudePreToolUsePayloadSchema>;

export const ClaudePostToolUsePayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("PostToolUse"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonObjectSchema,
  tool_response: JsonValueSchema,
  tool_use_id: nonEmptyStringSchema,
  duration_ms: durationSchema.optional(),
});
export type ClaudePostToolUsePayload = z.infer<typeof ClaudePostToolUsePayloadSchema>;

export const ClaudePostToolUseFailurePayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("PostToolUseFailure"),
  tool_name: nonEmptyStringSchema,
  tool_input: JsonObjectSchema,
  tool_use_id: nonEmptyStringSchema,
  error: nonEmptyStringSchema,
  is_interrupt: z.boolean().optional(),
  duration_ms: durationSchema.optional(),
});
export type ClaudePostToolUseFailurePayload = z.infer<typeof ClaudePostToolUseFailurePayloadSchema>;

export const ClaudePostToolBatchCallSchema = z.looseObject({
  tool_name: nonEmptyStringSchema,
  tool_input: JsonObjectSchema,
  tool_use_id: nonEmptyStringSchema,
  tool_response: JsonValueSchema,
});
export type ClaudePostToolBatchCall = z.infer<typeof ClaudePostToolBatchCallSchema>;

export const ClaudePostToolBatchPayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("PostToolBatch"),
  tool_calls: z.array(ClaudePostToolBatchCallSchema),
});
export type ClaudePostToolBatchPayload = z.infer<typeof ClaudePostToolBatchPayloadSchema>;

export const ClaudeStopPayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("Stop"),
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string(),
  background_tasks: z.array(ClaudeLooseSourceObjectSchema).optional(),
  session_crons: z.array(ClaudeLooseSourceObjectSchema).optional(),
});
export type ClaudeStopPayload = z.infer<typeof ClaudeStopPayloadSchema>;

export const CLAUDE_STOP_FAILURE_ERRORS = [
  "rate_limit",
  "overloaded",
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "invalid_request",
  "model_not_found",
  "server_error",
  "max_output_tokens",
  "unknown",
] as const;
export const ClaudeKnownStopFailureErrorSchema = z.enum(CLAUDE_STOP_FAILURE_ERRORS);
export type ClaudeKnownStopFailureError = z.infer<typeof ClaudeKnownStopFailureErrorSchema>;

export const ClaudeStopFailurePayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("StopFailure"),
  error: nonEmptyStringSchema,
  error_details: JsonValueSchema.optional(),
  last_assistant_message: z.string().optional(),
});
export type ClaudeStopFailurePayload = z.infer<typeof ClaudeStopFailurePayloadSchema>;

export const CLAUDE_SESSION_END_REASONS = [
  "clear",
  "resume",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled",
  "other",
] as const;
export const ClaudeKnownSessionEndReasonSchema = z.enum(CLAUDE_SESSION_END_REASONS);
export type ClaudeKnownSessionEndReason = z.infer<typeof ClaudeKnownSessionEndReasonSchema>;

export const ClaudeSessionEndPayloadSchema = z.looseObject({
  ...ClaudeHookCommonFieldsSchema.shape,
  hook_event_name: z.literal("SessionEnd"),
  reason: nonEmptyStringSchema,
});
export type ClaudeSessionEndPayload = z.infer<typeof ClaudeSessionEndPayloadSchema>;

export const SupportedClaudeHookPayloadSchema = z.discriminatedUnion("hook_event_name", [
  ClaudeSessionStartPayloadSchema,
  ClaudeUserPromptSubmitPayloadSchema,
  ClaudePreToolUsePayloadSchema,
  ClaudePostToolUsePayloadSchema,
  ClaudePostToolUseFailurePayloadSchema,
  ClaudePostToolBatchPayloadSchema,
  ClaudeStopPayloadSchema,
  ClaudeStopFailurePayloadSchema,
  ClaudeSessionEndPayloadSchema,
]);
export type SupportedClaudeHookPayload = z.infer<typeof SupportedClaudeHookPayloadSchema>;
