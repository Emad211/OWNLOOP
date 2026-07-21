import type {
  IngressRedactionRuleId,
  IngressSecurityErrorCode,
  IngressSecurityErrorDetails,
} from "@ownloop/contracts";

export type IngressSecurityPath = readonly (string | number)[];

const SAFE_MESSAGES: Readonly<Record<IngressSecurityErrorCode, string>> = Object.freeze({
  array_item_limit: "An array exceeds the supported item limit.",
  canonicalization_failed: "The JSON-compatible value could not be canonicalized.",
  input_too_deep: "The input exceeds the supported nesting depth.",
  input_too_large: "The input exceeds the supported canonical byte limit.",
  invalid_hmac_key: "The supplied HMAC key is not an eligible secret key.",
  invalid_json_value: "The input contains an unsupported JSON value.",
  invalid_workspace_path: "The supplied workspace path is not a supported absolute path.",
  object_property_limit: "An object exceeds the supported property limit.",
  output_too_large: "The reduced payload exceeds the supported canonical byte limit.",
  policy_invariant: "An ingress-security policy invariant was violated.",
  unsupported_hook: "The source Hook is not supported by the active policy.",
});

const SAFE_STRUCTURAL_PATH_SEGMENTS = new Set([
  "$field",
  "adapterVersion",
  "agent_id",
  "agent_type",
  "background_tasks",
  "canonicalWorkspacePath",
  "cwd",
  "deduplicationKey",
  "duration_ms",
  "effort",
  "error",
  "error_details",
  "hook_event_name",
  "is_interrupt",
  "last_assistant_message",
  "level",
  "metadata",
  "model",
  "password",
  "payload",
  "payloadFingerprint",
  "permission_mode",
  "prompt",
  "prompt_id",
  "reason",
  "redactedPayloadJson",
  "redactionSummary",
  "rulesApplied",
  "session_crons",
  "session_id",
  "session_title",
  "source",
  "sourceEventId",
  "sourceEventName",
  "stop_hook_active",
  "tool_calls",
  "tool_input",
  "tool_name",
  "tool_response",
  "tool_use_id",
  "transcript_path",
]);

function sanitizePath(path: IngressSecurityPath | undefined): IngressSecurityPath | undefined {
  if (path === undefined) {
    return undefined;
  }

  return Object.freeze(
    path.slice(0, 64).map((segment) => {
      if (typeof segment === "number") {
        return Number.isInteger(segment) && segment >= 0 ? segment : 0;
      }
      return SAFE_STRUCTURAL_PATH_SEGMENTS.has(segment) ? segment : "$field";
    }),
  );
}

export class IngressSecurityError extends Error {
  readonly code: IngressSecurityErrorCode;
  readonly path: IngressSecurityPath | undefined;
  readonly ruleId: IngressRedactionRuleId | undefined;

  constructor(
    code: IngressSecurityErrorCode,
    options: Readonly<{
      path?: IngressSecurityPath;
      ruleId?: IngressRedactionRuleId;
    }> = {},
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "IngressSecurityError";
    this.code = code;
    this.path = sanitizePath(options.path);
    this.ruleId = options.ruleId;
  }

  toJSON(): IngressSecurityErrorDetails {
    return {
      code: this.code,
      message: this.message,
      ...(this.path === undefined ? {} : { path: [...this.path] }),
      ...(this.ruleId === undefined ? {} : { ruleId: this.ruleId }),
    };
  }
}

export function ingressSecurityError(
  code: IngressSecurityErrorCode,
  path?: IngressSecurityPath,
): IngressSecurityError {
  return new IngressSecurityError(code, path === undefined ? {} : { path });
}
