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
