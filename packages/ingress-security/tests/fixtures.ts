import {
  type ClaudeAdapterIngress,
  ClaudeAdapterIngressSchema,
  type SupportedClaudeHookName,
} from "@ownloop/contracts";

const COMMON = {
  session_id: "session-fixture-001",
  transcript_path: "/home/fixture/.claude/transcript.jsonl",
  cwd: "/home/fixture/workspace/project",
  permission_mode: "default",
  effort: { level: "high" },
  agent_id: "agent-fixture-001",
  agent_type: "general-purpose",
} as const;

const PAYLOADS = {
  SessionStart: {
    ...COMMON,
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-fixture-model",
    session_title: "Fixture session",
  },
  UserPromptSubmit: {
    ...COMMON,
    hook_event_name: "UserPromptSubmit",
    prompt_id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
    prompt: "Read /home/fixture/workspace/project/src/index.ts",
  },
  PreToolUse: {
    ...COMMON,
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/home/fixture/workspace/project/src/index.ts" },
    tool_use_id: "tool-fixture-001",
  },
  PostToolUse: {
    ...COMMON,
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: "/home/fixture/workspace/project/output.txt",
      content: "fixture",
    },
    tool_response: {
      filePath: "/home/fixture/workspace/project/output.txt",
      success: true,
    },
    tool_use_id: "tool-fixture-002",
    duration_ms: 12,
  },
  PostToolUseFailure: {
    ...COMMON,
    hook_event_name: "PostToolUseFailure",
    tool_name: "Bash",
    tool_input: { command: "fixture-command" },
    tool_use_id: "tool-fixture-003",
    error: "Fixture command failed.",
    is_interrupt: false,
    duration_ms: 18,
  },
  PostToolBatch: {
    ...COMMON,
    hook_event_name: "PostToolBatch",
    tool_calls: [
      {
        tool_name: "Read",
        tool_input: { file_path: "/home/fixture/workspace/project/src/a.ts" },
        tool_use_id: "tool-fixture-004",
        tool_response: "fixture output",
      },
    ],
  },
  Stop: {
    ...COMMON,
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: "Fixture task complete.",
    background_tasks: [{ id: "task-fixture-001", future_status: "waiting" }],
    session_crons: [{ id: "cron-fixture-001", future_schedule: "once" }],
  },
  StopFailure: {
    ...COMMON,
    hook_event_name: "StopFailure",
    error: "rate_limit",
    error_details: { retryable: true },
    last_assistant_message: "Fixture API error.",
  },
  SessionEnd: {
    ...COMMON,
    hook_event_name: "SessionEnd",
    reason: "other",
  },
} as const;

export const SUPPORTED_HOOKS = Object.keys(PAYLOADS) as SupportedClaudeHookName[];

export function ingressFixture(
  hook: SupportedClaudeHookName = "UserPromptSubmit",
  overrides: Readonly<Record<string, unknown>> = {},
): ClaudeAdapterIngress {
  return ClaudeAdapterIngressSchema.parse({
    contractVersion: 1,
    source: "claude_code",
    adapterVersion: "1.2.3-fixture.1+build.5",
    receivedAt: "2026-07-21T09:00:00+00:00",
    payload: { ...PAYLOADS[hook], ...overrides },
  });
}
