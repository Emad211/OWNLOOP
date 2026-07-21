export const APP_NAME = "OwnLoop";
export const BOOTSTRAP_LABEL = "v0.1 bootstrap";

export function formatBootstrapName(name: string): string {
  return `${name} ${BOOTSTRAP_LABEL}`;
}

export type {
  ClaudeEffort,
  ClaudeHookCommonFields,
  ClaudeLooseSourceObject,
  SupportedClaudeHookName,
} from "./claude-hook-common.js";
export {
  ClaudeEffortSchema,
  ClaudeHookCommonFieldsSchema,
  ClaudeLooseSourceObjectSchema,
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";
export type {
  ClaudeKnownSessionEndReason,
  ClaudeKnownSessionStartSource,
  ClaudeKnownStopFailureError,
  ClaudePostToolBatchCall,
  ClaudePostToolBatchPayload,
  ClaudePostToolUseFailurePayload,
  ClaudePostToolUsePayload,
  ClaudePreToolUsePayload,
  ClaudeSessionEndPayload,
  ClaudeSessionStartPayload,
  ClaudeStopFailurePayload,
  ClaudeStopPayload,
  ClaudeUserPromptSubmitPayload,
  SupportedClaudeHookPayload,
} from "./claude-hook-payloads.js";
export {
  CLAUDE_SESSION_END_REASONS,
  CLAUDE_SESSION_START_SOURCES,
  CLAUDE_STOP_FAILURE_ERRORS,
  ClaudeKnownSessionEndReasonSchema,
  ClaudeKnownSessionStartSourceSchema,
  ClaudeKnownStopFailureErrorSchema,
  ClaudePostToolBatchCallSchema,
  ClaudePostToolBatchPayloadSchema,
  ClaudePostToolUseFailurePayloadSchema,
  ClaudePostToolUsePayloadSchema,
  ClaudePreToolUsePayloadSchema,
  ClaudeSessionEndPayloadSchema,
  ClaudeSessionStartPayloadSchema,
  ClaudeStopFailurePayloadSchema,
  ClaudeStopPayloadSchema,
  ClaudeUserPromptSubmitPayloadSchema,
  SupportedClaudeHookPayloadSchema,
} from "./claude-hook-payloads.js";
export type {
  IngestionAcceptedResponse,
  IngestionErrorCode,
  IngestionRejectedResponse,
  IngestionResponse,
  ValidationIssuePathSegment,
  ValidationIssueSummary,
} from "./ingestion-response.js";
export {
  INGESTION_ERROR_CODES,
  IngestionAcceptedResponseSchema,
  IngestionErrorCodeSchema,
  IngestionRejectedResponseSchema,
  IngestionResponseSchema,
  ValidationIssuePathSegmentSchema,
  ValidationIssueSummarySchema,
} from "./ingestion-response.js";
export type {
  HmacSha256Fingerprint,
  IngressDeduplicationKey,
  IngressRedactionRuleId,
  IngressSecurityErrorCode,
  IngressSecurityErrorDetails,
  PreparedIngressReceiptV1,
  RedactionSummaryV1,
} from "./ingress-security.js";
export {
  HmacSha256FingerprintSchema,
  INGRESS_CANONICALIZATION_VERSION,
  INGRESS_REDACTION_POLICY_VERSION,
  INGRESS_REDACTION_RULE_IDS,
  INGRESS_SECURITY_ERROR_CODES,
  IngressDeduplicationKeySchema,
  IngressRedactionRuleIdSchema,
  IngressSecurityErrorCodeSchema,
  IngressSecurityErrorDetailsSchema,
  IngressSecurityPathSegmentSchema,
  PreparedIngressReceiptV1Schema,
  RedactionSummaryV1Schema,
} from "./ingress-security.js";
export type { ClaudeAdapterIngress } from "./ingress-wrapper.js";
export {
  CLAUDE_INGRESS_CONTRACT_VERSION,
  ClaudeAdapterIngressSchema,
} from "./ingress-wrapper.js";
export type { ClaudeSourceMetadata } from "./source-metadata.js";
export { ClaudeSourceMetadataSchema } from "./source-metadata.js";
