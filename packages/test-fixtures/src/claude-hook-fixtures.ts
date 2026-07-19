const commonFields = {
  session_id: "session-fixture-001",
  transcript_path: "/workspace/.claude/transcript.jsonl",
  cwd: "/workspace/project",
};

export const validClaudeHookFixtures = [
  {
    name: "SessionStart",
    input: {
      ...commonFields,
      hook_event_name: "SessionStart",
      source: "startup",
      model: "claude-fixture-model",
    },
  },
  {
    name: "UserPromptSubmit",
    input: {
      ...commonFields,
      hook_event_name: "UserPromptSubmit",
      prompt_id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
      prompt: "Create a neutral fixture.",
    },
  },
  {
    name: "PreToolUse",
    input: {
      ...commonFields,
      hook_event_name: "PreToolUse",
      permission_mode: "default",
      effort: { level: "high" },
      tool_name: "Read",
      tool_input: { file_path: "/workspace/project/src/index.ts" },
      tool_use_id: "tool-fixture-001",
    },
  },
  {
    name: "PostToolUse",
    input: {
      ...commonFields,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/workspace/project/output.txt", content: "fixture" },
      tool_response: { filePath: "/workspace/project/output.txt", success: true },
      tool_use_id: "tool-fixture-002",
      duration_ms: 12,
    },
  },
  {
    name: "PostToolUseFailure",
    input: {
      ...commonFields,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "fixture-command" },
      tool_use_id: "tool-fixture-003",
      error: "Fixture command failed.",
      is_interrupt: false,
      duration_ms: 18,
    },
  },
  {
    name: "PostToolBatch",
    input: {
      ...commonFields,
      hook_event_name: "PostToolBatch",
      tool_calls: [
        {
          tool_name: "Read",
          tool_input: { file_path: "/workspace/project/src/a.ts" },
          tool_use_id: "tool-fixture-004",
          tool_response: "fixture output",
        },
      ],
    },
  },
  {
    name: "Stop",
    input: {
      ...commonFields,
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Fixture task complete.",
      background_tasks: [{ id: "task-fixture-001", future_status: "waiting" }],
      session_crons: [{ id: "cron-fixture-001", future_schedule: "once" }],
    },
  },
  {
    name: "StopFailure",
    input: {
      ...commonFields,
      hook_event_name: "StopFailure",
      error: "rate_limit",
      error_details: { retryable: true },
      last_assistant_message: "Fixture API error.",
    },
  },
  {
    name: "SessionEnd",
    input: {
      ...commonFields,
      hook_event_name: "SessionEnd",
      reason: "other",
    },
  },
] as const;

export const forwardCompatibleClaudeHookFixtures = [
  {
    name: "unknown common source field",
    preservedPath: ["future_common_field"],
    input: {
      ...commonFields,
      hook_event_name: "SessionStart",
      source: "future_source",
      future_common_field: { enabled: true },
    },
  },
  {
    name: "unknown event-specific field",
    preservedPath: ["future_result_metadata"],
    input: {
      ...commonFields,
      hook_event_name: "PostToolUse",
      tool_name: "FutureTool",
      tool_input: { future_argument: true },
      tool_response: ["future", { content: true }],
      tool_use_id: "tool-fixture-future-001",
      future_result_metadata: { version: 2 },
    },
  },
  {
    name: "unknown nested tool-call field",
    preservedPath: ["tool_calls", 0, "future_call_field"],
    input: {
      ...commonFields,
      hook_event_name: "PostToolBatch",
      tool_calls: [
        {
          tool_name: "FutureTool",
          tool_input: {},
          tool_use_id: "tool-fixture-future-002",
          tool_response: null,
          future_call_field: { retained: true },
        },
      ],
    },
  },
  {
    name: "future StopFailure error value",
    preservedPath: ["error"],
    input: {
      ...commonFields,
      hook_event_name: "StopFailure",
      error: "future_api_error",
    },
  },
  {
    name: "future SessionEnd reason value",
    preservedPath: ["reason"],
    input: {
      ...commonFields,
      hook_event_name: "SessionEnd",
      reason: "future_exit_reason",
    },
  },
] as const;

export const invalidClaudeHookPayloadFixtures = [
  {
    name: "missing session_id",
    input: {
      transcript_path: commonFields.transcript_path,
      cwd: commonFields.cwd,
      hook_event_name: "SessionEnd",
      reason: "other",
    },
  },
  {
    name: "wrong hook_event_name primitive",
    input: { ...commonFields, hook_event_name: 42 },
  },
  {
    name: "unsupported hook name",
    input: { ...commonFields, hook_event_name: "PermissionRequest" },
  },
  {
    name: "missing UserPromptSubmit prompt",
    input: { ...commonFields, hook_event_name: "UserPromptSubmit" },
  },
  {
    name: "non-object tool_input",
    input: {
      ...commonFields,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: "not-an-object",
      tool_use_id: "tool-fixture-invalid-001",
    },
  },
  {
    name: "missing tool_use_id",
    input: {
      ...commonFields,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_response: "fixture",
    },
  },
  {
    name: "negative duration_ms",
    input: {
      ...commonFields,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: {},
      tool_use_id: "tool-fixture-invalid-002",
      error: "Fixture failure.",
      duration_ms: -1,
    },
  },
  {
    name: "invalid PostToolBatch entry",
    input: {
      ...commonFields,
      hook_event_name: "PostToolBatch",
      tool_calls: [{ tool_name: "Read", tool_input: {}, tool_response: "fixture" }],
    },
  },
  {
    name: "missing Stop fields",
    input: { ...commonFields, hook_event_name: "Stop" },
  },
] as const;

export const validClaudeAdapterIngressFixture = {
  contractVersion: 1,
  source: "claude_code",
  adapterVersion: "1.2.3-fixture.1+build.5",
  receivedAt: "2026-07-19T12:34:56+03:30",
  payload: validClaudeHookFixtures[0].input,
} as const;

export const invalidClaudeAdapterIngressFixtures = [
  {
    name: "invalid adapter SemVer",
    input: { ...validClaudeAdapterIngressFixture, adapterVersion: "1.2" },
  },
  {
    name: "SemVer prerelease numeric identifier with leading zero",
    input: { ...validClaudeAdapterIngressFixture, adapterVersion: "1.2.3-01" },
  },
  {
    name: "invalid receivedAt datetime",
    input: { ...validClaudeAdapterIngressFixture, receivedAt: "2026-07-19T12:34:56" },
  },
  {
    name: "wrong contract version",
    input: { ...validClaudeAdapterIngressFixture, contractVersion: 2 },
  },
] as const;

export const validClaudeSourceMetadataFixture = {
  source: "claude_code",
  sourceSessionId: "session-fixture-001",
  sourceEventName: "PostToolUse",
  sourceEventId: "tool-fixture-002",
  promptId: null,
  transcriptPath: "/workspace/.claude/transcript.jsonl",
  cwd: "/workspace/project",
  permissionMode: "default",
  effortLevel: "high",
  agentId: null,
  agentType: null,
  adapterVersion: "1.2.3",
  sourceVersion: null,
} as const;

export const invalidClaudeSourceMetadataFixtures = [
  {
    name: "unsupported source event name",
    input: { ...validClaudeSourceMetadataFixture, sourceEventName: "PermissionRequest" },
  },
  {
    name: "invalid prompt UUID",
    input: { ...validClaudeSourceMetadataFixture, promptId: "not-a-uuid" },
  },
  {
    name: "unknown controlled metadata field",
    input: { ...validClaudeSourceMetadataFixture, sourceEventNam: "PostToolUse" },
  },
] as const;
