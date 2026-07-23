import type { ReplayErrorCode, ReplayErrorResponse } from "@ownloop/contracts";

const MESSAGES: Readonly<Record<ReplayErrorCode, string>> = Object.freeze({
  unauthorized: "The request is not authorized.",
  invalid_query: "The replay request is invalid.",
  run_not_found: "The requested replay Run was not found.",
  artifact_not_found: "The requested replay artifact was not found.",
  artifact_unavailable: "The requested replay artifact is not available.",
  evidence_not_found: "The requested replay evidence was not found.",
  evidence_unavailable: "The requested replay evidence is not available.",
  projection_failed: "Replay projection failed safely.",
  internal_error: "The replay request could not be completed.",
});

export function replayError(code: ReplayErrorCode): ReplayErrorResponse {
  return { ok: false, error: { code, message: MESSAGES[code] } };
}
