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
export type {
  FinalDiffManifestV1,
  RawRunReplayV1,
  ReplayArtifactReferenceV1,
  ReplayCausalLinkV1,
  ReplayChangedFileV1,
  ReplayCompleteness,
  ReplayErrorCode,
  ReplayErrorResponse,
  ReplayEvidenceGapV1,
  ReplayFinalizationV1,
  ReplayGitBaselineV1,
  ReplayPresence,
  ReplayReconciliationV1,
  ReplayRunListResponseV1,
  ReplayRunStatus,
  ReplayRunSummaryV1,
  ReplayTimelineEventV1,
  ReplayTimelinePayloadV1,
  ReplayVerificationV1,
} from "./replay.js";
export {
  FinalDiffManifestV1Schema,
  RAW_REPLAY_SCHEMA_VERSION,
  RawRunReplayV1Schema,
  REPLAY_CAUSAL_LINK_TYPES,
  REPLAY_CAUSAL_NODE_KINDS,
  REPLAY_COMPLETENESS_STATES,
  REPLAY_DEFAULT_LIST_LIMIT,
  REPLAY_ERROR_CODES,
  REPLAY_MAX_ARTIFACT_BYTES,
  REPLAY_MAX_LIST_LIMIT,
  REPLAY_PROMPT_PREVIEW_CODE_POINTS,
  REPLAY_RUN_STATUSES,
  REPLAY_TIMELINE_DETAIL_CODE_POINTS,
  ReplayArtifactReferenceV1Schema,
  ReplayCausalLinkTypeSchema,
  ReplayCausalLinkV1Schema,
  ReplayCausalNodeKindSchema,
  ReplayChangedFileV1Schema,
  ReplayCompletenessSchema,
  ReplayErrorCodeSchema,
  ReplayErrorResponseSchema,
  ReplayEvidenceGapV1Schema,
  ReplayFinalizationV1Schema,
  ReplayGitBaselineV1Schema,
  ReplayPresenceSchema,
  ReplayReconciliationV1Schema,
  ReplayRunListResponseV1Schema,
  ReplayRunStatusSchema,
  ReplayRunSummaryV1Schema,
  ReplayTimelineEventV1Schema,
  ReplayTimelineMetadataV1Schema,
  ReplayTimelinePayloadV1Schema,
  ReplayVerificationV1Schema,
} from "./replay.js";
export type { ClaudeSourceMetadata } from "./source-metadata.js";
export { ClaudeSourceMetadataSchema } from "./source-metadata.js";
