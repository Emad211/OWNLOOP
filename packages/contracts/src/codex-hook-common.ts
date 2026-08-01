import { z } from "zod";

export const CODEX_MAX_IDENTIFIER_CODE_POINTS = 512 as const;
export const CODEX_MAX_PATH_CODE_POINTS = 8192 as const;
export const CODEX_MAX_MODEL_CODE_POINTS = 512 as const;
export const CODEX_MAX_PROMPT_CODE_POINTS = 1_000_000 as const;

const nonEmptyIdentifierSchema = z.string().min(1).max(CODEX_MAX_IDENTIFIER_CODE_POINTS);
const pathSchema = z.string().min(1).max(CODEX_MAX_PATH_CODE_POINTS);
const nullablePathSchema = z.string().max(CODEX_MAX_PATH_CODE_POINTS).nullable();
const modelSchema = z.string().min(1).max(CODEX_MAX_MODEL_CODE_POINTS);

export const SUPPORTED_CODEX_HOOK_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
] as const;

export const SupportedCodexHookNameSchema = z.enum(SUPPORTED_CODEX_HOOK_NAMES);
export type SupportedCodexHookName = z.infer<typeof SupportedCodexHookNameSchema>;

export const CODEX_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions",
] as const;
export const CodexPermissionModeSchema = z.enum(CODEX_PERMISSION_MODES);
export type CodexPermissionMode = z.infer<typeof CodexPermissionModeSchema>;

export const CODEX_SOURCE_SURFACES = [
  "cli",
  "desktop",
  "ide",
  "exec",
  "app_server",
  "unknown",
] as const;
export const CodexSourceSurfaceSchema = z.enum(CODEX_SOURCE_SURFACES);
export type CodexSourceSurface = z.infer<typeof CodexSourceSurfaceSchema>;

export const CodexSessionCommonFieldsSchema = z.object({
  session_id: nonEmptyIdentifierSchema,
  transcript_path: nullablePathSchema,
  cwd: pathSchema,
});
export type CodexSessionCommonFields = z.infer<typeof CodexSessionCommonFieldsSchema>;

export const CodexTurnCommonFieldsSchema = CodexSessionCommonFieldsSchema.extend({
  turn_id: nonEmptyIdentifierSchema,
  model: modelSchema,
  permission_mode: CodexPermissionModeSchema,
  agent_id: nonEmptyIdentifierSchema.optional(),
  agent_type: nonEmptyIdentifierSchema.optional(),
});
export type CodexTurnCommonFields = z.infer<typeof CodexTurnCommonFieldsSchema>;

export const CodexCompactCommonFieldsSchema = CodexSessionCommonFieldsSchema.extend({
  turn_id: nonEmptyIdentifierSchema,
  model: modelSchema,
  agent_id: nonEmptyIdentifierSchema.optional(),
  agent_type: nonEmptyIdentifierSchema.optional(),
});
export type CodexCompactCommonFields = z.infer<typeof CodexCompactCommonFieldsSchema>;
