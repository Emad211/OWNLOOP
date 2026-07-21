import type { SupportedClaudeHookPayload } from "@ownloop/contracts";
import type { JsonObject, JsonValue } from "@ownloop/event-model";

import { REDACTION_RULES } from "./constants.js";
import { IngressSecurityError } from "./errors.js";
import {
  assertStructuralArrayLimit,
  type SanitizeContext,
  sanitizeArbitraryJson,
} from "./redaction.js";

const COMMON_CONTROLLED_FIELDS = new Set([
  "session_id",
  "transcript_path",
  "cwd",
  "hook_event_name",
  "prompt_id",
  "permission_mode",
  "effort",
  "agent_id",
  "agent_type",
]);

const EVENT_FIELDS: Readonly<
  Record<SupportedClaudeHookPayload["hook_event_name"], readonly string[]>
> = Object.freeze({
  SessionStart: ["source", "model", "session_title"],
  UserPromptSubmit: ["prompt"],
  PreToolUse: ["tool_name", "tool_input", "tool_use_id"],
  PostToolUse: ["tool_name", "tool_input", "tool_response", "tool_use_id", "duration_ms"],
  PostToolUseFailure: [
    "tool_name",
    "tool_input",
    "tool_use_id",
    "error",
    "is_interrupt",
    "duration_ms",
  ],
  PostToolBatch: ["tool_calls"],
  Stop: ["stop_hook_active", "last_assistant_message", "background_tasks", "session_crons"],
  StopFailure: ["error", "error_details", "last_assistant_message"],
  SessionEnd: ["reason"],
});

export const PERSISTED_HOOK_FIELD_ALLOWLISTS = Object.freeze(
  Object.fromEntries(
    Object.entries(EVENT_FIELDS).map(([hook, fields]) => [
      hook,
      Object.freeze([
        "permission_mode",
        "effort.level",
        "agent_id",
        "agent_type",
        ...fields.filter((field) => field !== "tool_use_id"),
      ]),
    ]),
  ),
) as Readonly<Record<SupportedClaudeHookPayload["hook_event_name"], readonly string[]>>;

function countDroppedFields(
  source: Record<string, unknown>,
  controlledFields: ReadonlySet<string>,
  context: SanitizeContext,
): void {
  let dropped = 0;
  for (const key of Object.keys(source)) {
    if (!controlledFields.has(key)) {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    context.state.droppedUnknownFieldCount += dropped;
    context.state.rulesApplied.add(REDACTION_RULES.unknownField);
  }
}

function assignOptional(
  target: JsonObject,
  key: string,
  value: unknown,
  context: SanitizeContext,
): void {
  if (value !== undefined) {
    target[key] = sanitizeArbitraryJson(value, context, [key], 0, key);
  }
}

function addCommonFields(
  payload: SupportedClaudeHookPayload,
  output: JsonObject,
  context: SanitizeContext,
): void {
  assignOptional(output, "permission_mode", payload.permission_mode, context);
  assignOptional(output, "agent_id", payload.agent_id, context);
  assignOptional(output, "agent_type", payload.agent_type, context);

  if (payload.effort !== undefined) {
    countDroppedFields(payload.effort, new Set(["level"]), context);
    output.effort = {
      level: sanitizeArbitraryJson(payload.effort.level, context, ["effort", "level"], 0, "level"),
    };
  }
}

function reduceBatchCalls(
  payload: Extract<SupportedClaudeHookPayload, { hook_event_name: "PostToolBatch" }>,
  context: SanitizeContext,
): JsonValue[] {
  assertStructuralArrayLimit(payload.tool_calls, ["tool_calls"]);
  return payload.tool_calls.map((call, index) => {
    const controlled = new Set(["tool_name", "tool_input", "tool_use_id", "tool_response"]);
    countDroppedFields(call, controlled, context);
    return {
      tool_name: sanitizeArbitraryJson(
        call.tool_name,
        context,
        ["tool_calls", index, "tool_name"],
        0,
        "tool_name",
      ),
      tool_input: sanitizeArbitraryJson(call.tool_input, context, [
        "tool_calls",
        index,
        "tool_input",
      ]),
      tool_use_id: sanitizeArbitraryJson(
        call.tool_use_id,
        context,
        ["tool_calls", index, "tool_use_id"],
        0,
        "tool_use_id",
      ),
      tool_response: sanitizeArbitraryJson(call.tool_response, context, [
        "tool_calls",
        index,
        "tool_response",
      ]),
    };
  });
}

export function reduceAndRedactHookPayload(
  payload: SupportedClaudeHookPayload,
  context: SanitizeContext,
): JsonObject {
  const eventFields = EVENT_FIELDS[payload.hook_event_name];
  if (eventFields === undefined) {
    throw new IngressSecurityError("unsupported_hook", { path: ["hook_event_name"] });
  }

  const controlled = new Set([...COMMON_CONTROLLED_FIELDS, ...eventFields]);
  countDroppedFields(payload, controlled, context);

  const output: JsonObject = {};
  addCommonFields(payload, output, context);

  switch (payload.hook_event_name) {
    case "SessionStart":
      output.source = sanitizeArbitraryJson(payload.source, context, ["source"], 0, "source");
      assignOptional(output, "model", payload.model, context);
      assignOptional(output, "session_title", payload.session_title, context);
      break;
    case "UserPromptSubmit":
      output.prompt = sanitizeArbitraryJson(payload.prompt, context, ["prompt"], 0, "prompt");
      break;
    case "PreToolUse":
      output.tool_name = sanitizeArbitraryJson(
        payload.tool_name,
        context,
        ["tool_name"],
        0,
        "tool_name",
      );
      output.tool_input = sanitizeArbitraryJson(payload.tool_input, context, ["tool_input"]);
      break;
    case "PostToolUse":
      output.tool_name = sanitizeArbitraryJson(
        payload.tool_name,
        context,
        ["tool_name"],
        0,
        "tool_name",
      );
      output.tool_input = sanitizeArbitraryJson(payload.tool_input, context, ["tool_input"]);
      output.tool_response = sanitizeArbitraryJson(payload.tool_response, context, [
        "tool_response",
      ]);
      assignOptional(output, "duration_ms", payload.duration_ms, context);
      break;
    case "PostToolUseFailure":
      output.tool_name = sanitizeArbitraryJson(
        payload.tool_name,
        context,
        ["tool_name"],
        0,
        "tool_name",
      );
      output.tool_input = sanitizeArbitraryJson(payload.tool_input, context, ["tool_input"]);
      output.error = sanitizeArbitraryJson(payload.error, context, ["error"], 0, "error");
      assignOptional(output, "is_interrupt", payload.is_interrupt, context);
      assignOptional(output, "duration_ms", payload.duration_ms, context);
      break;
    case "PostToolBatch":
      output.tool_calls = reduceBatchCalls(payload, context);
      break;
    case "Stop":
      output.stop_hook_active = payload.stop_hook_active;
      output.last_assistant_message = sanitizeArbitraryJson(
        payload.last_assistant_message,
        context,
        ["last_assistant_message"],
        0,
        "last_assistant_message",
      );
      assertStructuralArrayLimit(payload.background_tasks, ["background_tasks"]);
      assertStructuralArrayLimit(payload.session_crons, ["session_crons"]);
      assignOptional(output, "background_tasks", payload.background_tasks, context);
      assignOptional(output, "session_crons", payload.session_crons, context);
      break;
    case "StopFailure":
      output.error = sanitizeArbitraryJson(payload.error, context, ["error"], 0, "error");
      assignOptional(output, "error_details", payload.error_details, context);
      assignOptional(output, "last_assistant_message", payload.last_assistant_message, context);
      break;
    case "SessionEnd":
      output.reason = sanitizeArbitraryJson(payload.reason, context, ["reason"], 0, "reason");
      break;
    default: {
      const _unreachable: never = payload;
      throw new IngressSecurityError("unsupported_hook", { path: ["hook_event_name"] });
    }
  }

  return output;
}
