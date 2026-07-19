import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);

export const SUPPORTED_CLAUDE_HOOK_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Stop",
  "StopFailure",
  "SessionEnd",
] as const;

export const SupportedClaudeHookNameSchema = z.enum(SUPPORTED_CLAUDE_HOOK_NAMES);
export type SupportedClaudeHookName = z.infer<typeof SupportedClaudeHookNameSchema>;

export const ClaudeEffortSchema = z.looseObject({
  level: nonEmptyStringSchema,
});
export type ClaudeEffort = z.infer<typeof ClaudeEffortSchema>;

export const ClaudeLooseSourceObjectSchema = z.looseObject({});
export type ClaudeLooseSourceObject = z.infer<typeof ClaudeLooseSourceObjectSchema>;

export const ClaudeHookCommonFieldsSchema = z.looseObject({
  session_id: nonEmptyStringSchema,
  transcript_path: nonEmptyStringSchema,
  cwd: nonEmptyStringSchema,
  hook_event_name: SupportedClaudeHookNameSchema,
  prompt_id: z.uuid().optional(),
  permission_mode: nonEmptyStringSchema.optional(),
  effort: ClaudeEffortSchema.optional(),
  agent_id: nonEmptyStringSchema.optional(),
  agent_type: nonEmptyStringSchema.optional(),
});
export type ClaudeHookCommonFields = z.infer<typeof ClaudeHookCommonFieldsSchema>;
