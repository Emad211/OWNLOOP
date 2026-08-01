import type { CodexAdapterIngress, SupportedCodexHookPayload } from "@ownloop/contracts/codex";
import type { JsonObject } from "@ownloop/event-model";

import { IngressSecurityError } from "./errors.js";
import { type SanitizeContext, sanitizeArbitraryJson } from "./redaction.js";

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

function addTurnMetadata(
  payload: SupportedCodexHookPayload,
  output: JsonObject,
  context: SanitizeContext,
): void {
  if ("turn_id" in payload) {
    output.turn_id = sanitizeArbitraryJson(payload.turn_id, context, ["turn_id"], 0, "turn_id");
  }
  if ("model" in payload) {
    output.model = sanitizeArbitraryJson(payload.model, context, ["model"], 0, "model");
  }
  if ("permission_mode" in payload) {
    output.permission_mode = sanitizeArbitraryJson(
      payload.permission_mode,
      context,
      ["permission_mode"],
      0,
      "permission_mode",
    );
  }
  if ("agent_id" in payload) assignOptional(output, "agent_id", payload.agent_id, context);
  if ("agent_type" in payload) assignOptional(output, "agent_type", payload.agent_type, context);
}

function toolFields(
  payload: Extract<
    SupportedCodexHookPayload,
    { hook_event_name: "PreToolUse" | "PermissionRequest" | "PostToolUse" }
  >,
  output: JsonObject,
  context: SanitizeContext,
): void {
  output.tool_name = sanitizeArbitraryJson(
    payload.tool_name,
    context,
    ["tool_name"],
    0,
    "tool_name",
  );
  output.tool_input = sanitizeArbitraryJson(payload.tool_input, context, ["tool_input"]);
}

export function reduceAndRedactCodexIngress(
  ingress: CodexAdapterIngress,
  context: SanitizeContext,
): JsonObject {
  const { payload } = ingress;
  const output: JsonObject = {
    source_surface: sanitizeArbitraryJson(
      ingress.sourceSurface,
      context,
      ["source_surface"],
      0,
      "source_surface",
    ),
    source_version: sanitizeArbitraryJson(
      ingress.sourceVersion ?? null,
      context,
      ["source_version"],
      0,
      "source_version",
    ),
  };
  addTurnMetadata(payload, output, context);

  switch (payload.hook_event_name) {
    case "SessionStart":
      output.source = sanitizeArbitraryJson(payload.source, context, ["source"], 0, "source");
      break;
    case "UserPromptSubmit":
      output.prompt = sanitizeArbitraryJson(payload.prompt, context, ["prompt"], 0, "prompt");
      break;
    case "PreToolUse":
    case "PermissionRequest":
      toolFields(payload, output, context);
      break;
    case "PostToolUse":
      toolFields(payload, output, context);
      output.tool_response = sanitizeArbitraryJson(payload.tool_response, context, [
        "tool_response",
      ]);
      break;
    case "PreCompact":
    case "PostCompact":
      output.trigger = sanitizeArbitraryJson(payload.trigger, context, ["trigger"], 0, "trigger");
      break;
    case "SubagentStart":
      break;
    case "SubagentStop":
      output.stop_hook_active = payload.stop_hook_active;
      output.last_assistant_message = sanitizeArbitraryJson(
        payload.last_assistant_message,
        context,
        ["last_assistant_message"],
        0,
        "last_assistant_message",
      );
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
