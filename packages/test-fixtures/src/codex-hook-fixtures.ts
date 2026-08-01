const commonFields = {
  session_id: "018f98ab-9d9a-7d62-9c42-6f94f31b8e00",
  transcript_path: null,
  cwd: "C:\\workspace\\project",
};

const turnFields = {
  ...commonFields,
  turn_id: "turn-fixture-001",
  model: "gpt-5.6-codex",
  permission_mode: "default",
};

export const validCodexHookFixtures = [
  {
    name: "SessionStart",
    input: {
      ...commonFields,
      hook_event_name: "SessionStart",
      model: "gpt-5.6-codex",
      permission_mode: "default",
      source: "startup",
    },
  },
  {
    name: "UserPromptSubmit",
    input: {
      ...turnFields,
      hook_event_name: "UserPromptSubmit",
      prompt: "Create a neutral Codex fixture.",
    },
  },
  {
    name: "PreToolUse",
    input: {
      ...turnFields,
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { patch: "*** Begin Patch\n*** End Patch" },
      tool_use_id: "tool-fixture-001",
    },
  },
  {
    name: "PermissionRequest",
    input: {
      ...turnFields,
      hook_event_name: "PermissionRequest",
      tool_name: "shell_command",
      tool_input: { command: "git status --short" },
    },
  },
  {
    name: "PostToolUse",
    input: {
      ...turnFields,
      hook_event_name: "PostToolUse",
      tool_name: "apply_patch",
      tool_input: { patch: "*** Begin Patch\n*** End Patch" },
      tool_response: { success: true },
      tool_use_id: "tool-fixture-001",
    },
  },
  {
    name: "PreCompact",
    input: {
      ...commonFields,
      turn_id: "turn-fixture-001",
      hook_event_name: "PreCompact",
      model: "gpt-5.6-codex",
      trigger: "auto",
    },
  },
  {
    name: "PostCompact",
    input: {
      ...commonFields,
      turn_id: "turn-fixture-001",
      hook_event_name: "PostCompact",
      model: "gpt-5.6-codex",
      trigger: "auto",
    },
  },
  {
    name: "SubagentStart",
    input: {
      ...turnFields,
      hook_event_name: "SubagentStart",
      agent_id: "agent-fixture-001",
      agent_type: "worker",
    },
  },
  {
    name: "SubagentStop",
    input: {
      ...turnFields,
      hook_event_name: "SubagentStop",
      agent_id: "agent-fixture-001",
      agent_type: "worker",
      agent_transcript_path: null,
      last_assistant_message: "Subagent fixture complete.",
      stop_hook_active: false,
    },
  },
  {
    name: "Stop",
    input: {
      ...turnFields,
      hook_event_name: "Stop",
      last_assistant_message: "Fixture turn complete.",
      stop_hook_active: false,
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

export const forwardCompatibleCodexHookFixtures = [
  {
    name: "unknown common source field is ignored",
    input: {
      ...validCodexHookFixtures[0].input,
      future_common_field: { enabled: true },
    },
  },
  {
    name: "unknown tool field is ignored",
    input: {
      ...validCodexHookFixtures[2].input,
      future_tool_metadata: { version: 2 },
    },
  },
  {
    name: "future SessionEnd reason is retained as controlled string",
    input: {
      ...validCodexHookFixtures[10].input,
      reason: "future_reason",
    },
  },
] as const;

export const invalidCodexHookPayloadFixtures = [
  {
    name: "missing session_id",
    input: {
      transcript_path: null,
      cwd: commonFields.cwd,
      hook_event_name: "SessionEnd",
      reason: "other",
    },
  },
  {
    name: "unsupported hook name",
    input: { ...commonFields, hook_event_name: "PostToolBatch" },
  },
  {
    name: "missing turn_id",
    input: {
      ...commonFields,
      hook_event_name: "UserPromptSubmit",
      model: "gpt-5.6-codex",
      permission_mode: "default",
      prompt: "fixture",
    },
  },
  {
    name: "invalid permission mode",
    input: {
      ...turnFields,
      hook_event_name: "PreToolUse",
      permission_mode: "future-mode",
      tool_name: "apply_patch",
      tool_input: {},
      tool_use_id: "tool-fixture-invalid-001",
    },
  },
  {
    name: "missing tool use id",
    input: {
      ...turnFields,
      hook_event_name: "PostToolUse",
      tool_name: "apply_patch",
      tool_input: {},
      tool_response: {},
    },
  },
  {
    name: "PermissionRequest does not invent tool_use_id requirement but requires tool input",
    input: {
      ...turnFields,
      hook_event_name: "PermissionRequest",
      tool_name: "shell_command",
    },
  },
  {
    name: "invalid compact trigger",
    input: {
      ...commonFields,
      turn_id: "turn-fixture-001",
      hook_event_name: "PreCompact",
      model: "gpt-5.6-codex",
      trigger: "future",
    },
  },
  {
    name: "SubagentStart requires explicit agent identity",
    input: {
      ...turnFields,
      hook_event_name: "SubagentStart",
    },
  },
  {
    name: "Stop requires nullable last message and active flag",
    input: {
      ...turnFields,
      hook_event_name: "Stop",
    },
  },
] as const;

export const validCodexAdapterIngressFixture = {
  contractVersion: 1,
  source: "codex",
  adapterVersion: "0.1.0",
  sourceVersion: "codex-cli 0.133.0",
  sourceSurface: "cli",
  receivedAt: "2026-07-27T00:00:00+04:00",
  payload: validCodexHookFixtures[0].input,
} as const;

export const invalidCodexAdapterIngressFixtures = [
  {
    name: "wrong source",
    input: { ...validCodexAdapterIngressFixture, source: "claude_code" },
  },
  {
    name: "invalid surface",
    input: { ...validCodexAdapterIngressFixture, sourceSurface: "browser" },
  },
  {
    name: "wrong contract version",
    input: { ...validCodexAdapterIngressFixture, contractVersion: 2 },
  },
  {
    name: "invalid receivedAt",
    input: { ...validCodexAdapterIngressFixture, receivedAt: "2026-07-27T00:00:00" },
  },
] as const;

export const validCodexSourceMetadataFixture = {
  source: "codex",
  sourceSessionId: "018f98ab-9d9a-7d62-9c42-6f94f31b8e00",
  sourceEventName: "PostToolUse",
  sourceEventId: "tool-fixture-001:post",
  turnId: "turn-fixture-001",
  toolUseId: "tool-fixture-001",
  agentId: null,
  agentType: null,
  transcriptPath: null,
  cwd: "C:\\workspace\\project",
  permissionMode: "default",
  adapterVersion: "0.1.0",
  sourceVersion: "codex-cli 0.133.0",
  sourceSurface: "cli",
} as const;

export const invalidCodexSourceMetadataFixtures = [
  {
    name: "unsupported event",
    input: { ...validCodexSourceMetadataFixture, sourceEventName: "PostToolBatch" },
  },
  {
    name: "unknown controlled metadata field",
    input: { ...validCodexSourceMetadataFixture, sourceClient: "cli" },
  },
  {
    name: "invalid permission mode",
    input: { ...validCodexSourceMetadataFixture, permissionMode: "future" },
  },
  {
    name: "oversized source session identifier",
    input: { ...validCodexSourceMetadataFixture, sourceSessionId: "x".repeat(513) },
  },
  {
    name: "oversized controlled path",
    input: { ...validCodexSourceMetadataFixture, cwd: `C:\\${"x".repeat(8192)}` },
  },
] as const;
