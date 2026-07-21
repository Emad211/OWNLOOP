import type {
  IngestionAcceptedResponse,
  IngestionErrorCode,
  IngestionRejectedResponse,
  ValidationIssueSummary,
} from "@ownloop/contracts";

const SAFE_PATH_SEGMENTS = new Set([
  "adapterVersion",
  "agent_id",
  "agent_type",
  "contractVersion",
  "cwd",
  "duration_ms",
  "effort",
  "error",
  "error_details",
  "hook_event_name",
  "is_interrupt",
  "last_assistant_message",
  "level",
  "model",
  "payload",
  "permission_mode",
  "prompt",
  "prompt_id",
  "reason",
  "receivedAt",
  "session_crons",
  "session_id",
  "session_title",
  "source",
  "stop_hook_active",
  "tool_calls",
  "tool_input",
  "tool_name",
  "tool_response",
  "tool_use_id",
  "transcript_path",
]);

const ERROR_MESSAGES: Readonly<Record<IngestionErrorCode, string>> = Object.freeze({
  unauthorized: "The request is not authorized.",
  invalid_payload: "The request payload is invalid.",
  unsupported_hook: "The source Hook is not supported.",
  payload_too_large: "The request body exceeds the supported size limit.",
  unsupported_media_type: "The request must use application/json.",
  deduplication_conflict: "The ingress identity conflicts with previously committed content.",
  persistence_failed: "The prepared receipt could not be durably committed.",
  internal_error: "The ingestion request could not be completed.",
});

function sanitizePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.slice(0, 32).map((segment) => {
    if (typeof segment === "number") {
      return Number.isInteger(segment) && segment >= 0 ? segment : 0;
    }
    return typeof segment === "string" && SAFE_PATH_SEGMENTS.has(segment) ? segment : "$field";
  });
}

type RuntimeValidationIssue = Readonly<{
  code: string;
  path: readonly PropertyKey[];
}>;

type RuntimeValidationError = Readonly<{
  issues: readonly RuntimeValidationIssue[];
}>;

function stableIssueCode(issue: RuntimeValidationIssue): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(issue.code) ? issue.code : "invalid";
}

function stableIssueMessage(issue: RuntimeValidationIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return "A field has an invalid type.";
    case "too_small":
      return "A required value is empty or below its minimum.";
    case "too_big":
      return "A value exceeds its supported maximum.";
    case "invalid_format":
      return "A field has an invalid format.";
    case "invalid_union":
      return "A field does not match a supported variant.";
    case "unrecognized_keys":
      return "The request contains an unsupported field.";
    default:
      return "A request field is invalid.";
  }
}

export function summarizeZodError(error: RuntimeValidationError): ValidationIssueSummary[] {
  return error.issues.slice(0, 16).map((issue) => ({
    path: sanitizePath(issue.path),
    code: stableIssueCode(issue),
    message: stableIssueMessage(issue),
  }));
}

export function acceptedResponse(receiptId: string, duplicate: boolean): IngestionAcceptedResponse {
  return { ok: true, status: "accepted", receiptId, duplicate };
}

export function rejectedResponse(
  code: IngestionErrorCode,
  issues?: ValidationIssueSummary[],
): IngestionRejectedResponse {
  return {
    ok: false,
    status: "rejected",
    error: {
      code,
      message: ERROR_MESSAGES[code],
      ...(issues === undefined || issues.length === 0 ? {} : { issues }),
    },
  };
}
