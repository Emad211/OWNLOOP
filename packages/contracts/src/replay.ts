import {
  EVENT_SENSITIVITIES,
  NORMALIZED_EVENT_SOURCES,
  NORMALIZED_EVENT_TYPES,
} from "@ownloop/event-model";
import { z } from "zod";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const boundedStringSchema = z.string().max(512);
const nullableTimestampSchema = timestampSchema.nullable();

export const RAW_REPLAY_SCHEMA_VERSION = 1 as const;
export const REPLAY_PROMPT_PREVIEW_CODE_POINTS = 240;
export const REPLAY_TIMELINE_DETAIL_CODE_POINTS = 512;
export const REPLAY_MAX_LIST_LIMIT = 100;
export const REPLAY_DEFAULT_LIST_LIMIT = 25;
export const REPLAY_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export const REPLAY_RUN_STATUSES = [
  "Capturing",
  "Finalizing",
  "Completed",
  "Partial",
  "Abandoned",
  "Failed",
] as const;
export const ReplayRunStatusSchema = z.enum(REPLAY_RUN_STATUSES);
export type ReplayRunStatus = z.infer<typeof ReplayRunStatusSchema>;

export const REPLAY_COMPLETENESS_STATES = [
  "complete",
  "partial",
  "failed",
  "abandoned",
  "in_progress",
] as const;
export const ReplayCompletenessSchema = z.enum(REPLAY_COMPLETENESS_STATES);
export type ReplayCompleteness = z.infer<typeof ReplayCompletenessSchema>;

export const ReplayPresenceSchema = z.strictObject({
  baseline: z.boolean(),
  reconciliation: z.boolean(),
  finalization: z.boolean(),
  finalManifest: z.boolean(),
  terminalEvent: z.boolean(),
});
export type ReplayPresence = z.infer<typeof ReplayPresenceSchema>;

export const ReplayRunSummaryV1Schema = z.strictObject({
  runId: safeIdSchema,
  conversationId: safeIdSchema,
  workspaceId: safeIdSchema,
  runNumber: z.number().int().positive(),
  status: ReplayRunStatusSchema,
  completeness: ReplayCompletenessSchema,
  promptPreview: z.string().max(REPLAY_PROMPT_PREVIEW_CODE_POINTS * 2),
  promptTruncated: z.boolean(),
  startedAt: timestampSchema,
  endedAt: nullableTimestampSchema,
  evidenceGapCount: z.number().int().nonnegative(),
  presence: ReplayPresenceSchema,
});
export type ReplayRunSummaryV1 = z.infer<typeof ReplayRunSummaryV1Schema>;

export const ReplayRunListResponseV1Schema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(RAW_REPLAY_SCHEMA_VERSION),
  runs: z.array(ReplayRunSummaryV1Schema).max(REPLAY_MAX_LIST_LIMIT),
  nextCursor: z.string().min(1).max(1024).nullable(),
});
export type ReplayRunListResponseV1 = z.infer<typeof ReplayRunListResponseV1Schema>;

export const ReplayTimelineMetadataV1Schema = z.strictObject({
  collectorVersion: z.string().min(1).max(128),
  sourceVersion: z.string().min(1).max(128).nullable(),
});

export const ReplayTimelinePayloadV1Schema = z.strictObject({
  action: boundedStringSchema.optional(),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]).optional(),
  baselineComparison: z.enum(["unchanged", "changed", "unavailable"]).optional(),
  boundary: z.enum(["tool_batch", "stop", "stop_failure"]).optional(),
  diagnosticCode: boundedStringSchema.nullable().optional(),
  duplicate: z.boolean().optional(),
  entryCount: z.number().int().nonnegative().optional(),
  exitCode: z.number().int().optional(),
  finalFingerprintPresent: z.boolean().optional(),
  finalSnapshotPresent: z.boolean().optional(),
  manifestPresent: z.boolean().optional(),
  mode: z.enum(["normal", "recovery"]).optional(),
  outcome: z.enum(["captured", "partial"]).optional(),
  reconciliationPresent: z.boolean().optional(),
  staged: z.boolean().optional(),
  stagedDirty: z.boolean().optional(),
  status: boundedStringSchema.optional(),
  terminalStatus: z.enum(["Completed", "Partial", "Abandoned", "Failed"]).optional(),
  toolName: boundedStringSchema.optional(),
  tool_name: boundedStringSchema.optional(),
  triggerPresent: z.boolean().optional(),
  unstaged: z.boolean().optional(),
  unstagedDirty: z.boolean().optional(),
});
export type ReplayTimelinePayloadV1 = z.infer<typeof ReplayTimelinePayloadV1Schema>;

export const ReplayTimelineEventV1Schema = z.strictObject({
  eventId: safeIdSchema,
  sequence: z.number().int().positive(),
  type: z.enum(NORMALIZED_EVENT_TYPES),
  source: z.enum(NORMALIZED_EVENT_SOURCES),
  sensitivity: z.enum(EVENT_SENSITIVITIES),
  occurredAt: timestampSchema,
  ingestedAt: timestampSchema,
  payload: ReplayTimelinePayloadV1Schema,
  metadata: ReplayTimelineMetadataV1Schema,
});
export type ReplayTimelineEventV1 = z.infer<typeof ReplayTimelineEventV1Schema>;

export const REPLAY_CAUSAL_LINK_TYPES = [
  "receipt_sibling",
  "baseline_event",
  "reconciliation_trigger",
  "reconciliation_summary",
  "reconciliation_file_event",
  "finalization_trigger",
  "finalization_reconciliation",
  "finalization_snapshot",
  "finalization_terminal",
  "finalization_artifact",
] as const;
export const ReplayCausalLinkTypeSchema = z.enum(REPLAY_CAUSAL_LINK_TYPES);
export const REPLAY_CAUSAL_NODE_KINDS = [
  "event",
  "baseline",
  "reconciliation",
  "finalization",
  "artifact",
] as const;
export const ReplayCausalNodeKindSchema = z.enum(REPLAY_CAUSAL_NODE_KINDS);

export const ReplayCausalLinkV1Schema = z.strictObject({
  linkId: z.string().regex(/^[A-Za-z0-9:._-]{1,512}$/u),
  type: ReplayCausalLinkTypeSchema,
  sourceKind: ReplayCausalNodeKindSchema,
  sourceId: safeIdSchema,
  targetKind: ReplayCausalNodeKindSchema,
  targetId: safeIdSchema,
});
export type ReplayCausalLinkV1 = z.infer<typeof ReplayCausalLinkV1Schema>;

export const ReplayGitBaselineV1Schema = z.strictObject({
  baselineId: safeIdSchema,
  baselineEventId: safeIdSchema,
  outcome: z.enum(["captured", "partial"]),
  diagnosticCode: z.string().min(1).max(128).nullable(),
  headPresent: z.boolean(),
  stagedDirty: z.boolean(),
  unstagedDirty: z.boolean(),
  untrackedCount: z.number().int().nonnegative(),
  untrackedHashedCount: z.number().int().nonnegative(),
  untrackedOmittedCount: z.number().int().nonnegative(),
  capturedAt: timestampSchema,
  captureDelayMs: z.number().int().nonnegative(),
});
export type ReplayGitBaselineV1 = z.infer<typeof ReplayGitBaselineV1Schema>;

export const ReplayChangedFileV1Schema = z.strictObject({
  entryId: z.string().regex(/^reconciliation:[A-Za-z0-9_-]+:entry:\d+$/u),
  entryIndex: z.number().int().nonnegative(),
  relativePath: z.string().min(1).max(1024).nullable(),
  changeKind: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]),
  staged: z.boolean(),
  unstaged: z.boolean(),
  sensitivity: z.enum(["normal", "secret"]),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
  fileEventId: safeIdSchema,
});
export type ReplayChangedFileV1 = z.infer<typeof ReplayChangedFileV1Schema>;

export const ReplayReconciliationV1Schema = z.strictObject({
  reconciliationId: safeIdSchema,
  boundary: z.enum(["tool_batch", "stop", "stop_failure"]),
  outcome: z.enum(["captured", "partial"]),
  diagnosticCode: z.string().min(1).max(128).nullable(),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
  baselineComparison: z.enum(["unchanged", "changed", "unavailable"]),
  triggerEventId: safeIdSchema,
  summaryEventId: safeIdSchema,
  stagedDirty: z.boolean(),
  unstagedDirty: z.boolean(),
  capturedAt: timestampSchema,
  counts: z.strictObject({
    entries: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    typeChanged: z.number().int().nonnegative(),
    unmerged: z.number().int().nonnegative(),
  }),
  changedFiles: z.array(ReplayChangedFileV1Schema).max(2000),
});
export type ReplayReconciliationV1 = z.infer<typeof ReplayReconciliationV1Schema>;

export const ReplayEvidenceGapV1Schema = z.strictObject({
  gapId: safeIdSchema,
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(512),
  createdAt: timestampSchema,
});
export type ReplayEvidenceGapV1 = z.infer<typeof ReplayEvidenceGapV1Schema>;

export const ReplayFinalizationV1Schema = z.strictObject({
  finalizationId: safeIdSchema,
  terminalStatus: z.enum(["Completed", "Partial", "Abandoned", "Failed"]),
  mode: z.enum(["normal", "recovery"]),
  diagnosticCode: z.string().min(1).max(128).nullable(),
  triggerEventId: safeIdSchema.nullable(),
  reconciliationId: safeIdSchema.nullable(),
  finalSnapshotEventId: safeIdSchema.nullable(),
  terminalEventId: safeIdSchema,
  manifestArtifactId: safeIdSchema.nullable(),
  finalizedAt: timestampSchema,
});
export type ReplayFinalizationV1 = z.infer<typeof ReplayFinalizationV1Schema>;

export const ReplayArtifactReferenceV1Schema = z.strictObject({
  artifactId: safeIdSchema,
  role: z.string().min(1).max(128),
  kind: z.string().min(1).max(128),
  mediaType: z.string().min(1).max(256).nullable(),
  sensitivity: z.enum(EVENT_SENSITIVITIES),
  sizeBytes: z.number().int().nonnegative(),
  contentUrl: z.string().regex(/^\/v1\/replay\/artifacts\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
});
export type ReplayArtifactReferenceV1 = z.infer<typeof ReplayArtifactReferenceV1Schema>;

export const ReplayVerificationV1Schema = z.strictObject({
  eventId: safeIdSchema,
  sequence: z.number().int().positive(),
  type: z.enum([
    "test.observed",
    "build.observed",
    "lint.observed",
    "typecheck.observed",
    "command.completed",
    "command.failed",
  ]),
  occurredAt: timestampSchema,
  payload: ReplayTimelinePayloadV1Schema,
});
export type ReplayVerificationV1 = z.infer<typeof ReplayVerificationV1Schema>;

export const RawRunReplayV1Schema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(RAW_REPLAY_SCHEMA_VERSION),
  run: z.strictObject({
    ...ReplayRunSummaryV1Schema.shape,
    redactedPrompt: z.string().max(262_144),
    sourceStopReason: z.enum(["stop", "source_failure"]).nullable(),
  }),
  timeline: z.array(ReplayTimelineEventV1Schema).max(10_000),
  causalLinks: z.array(ReplayCausalLinkV1Schema).max(20_000),
  baseline: ReplayGitBaselineV1Schema.nullable(),
  reconciliations: z.array(ReplayReconciliationV1Schema).max(10_000),
  verification: z.array(ReplayVerificationV1Schema).max(10_000),
  evidenceGaps: z.array(ReplayEvidenceGapV1Schema).max(10_000),
  finalization: ReplayFinalizationV1Schema.nullable(),
  artifacts: z.array(ReplayArtifactReferenceV1Schema).max(1000),
});
export type RawRunReplayV1 = z.infer<typeof RawRunReplayV1Schema>;

export const REPLAY_ERROR_CODES = [
  "unauthorized",
  "invalid_query",
  "run_not_found",
  "artifact_not_found",
  "artifact_unavailable",
  "projection_failed",
  "internal_error",
] as const;
export const ReplayErrorCodeSchema = z.enum(REPLAY_ERROR_CODES);
export type ReplayErrorCode = z.infer<typeof ReplayErrorCodeSchema>;

export const ReplayErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: ReplayErrorCodeSchema,
    message: z.string().min(1).max(256),
  }),
});
export type ReplayErrorResponse = z.infer<typeof ReplayErrorResponseSchema>;

export const FinalDiffManifestV1Schema = z.strictObject({
  version: z.literal(1),
  runId: safeIdSchema,
  reconciliationId: safeIdSchema,
  outcome: z.enum(["captured", "partial"]),
  diagnosticCode: z.string().min(1).max(128).nullable(),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
  baselineComparison: z.enum(["unchanged", "changed", "unavailable"]),
  boundary: z.enum(["tool_batch", "stop", "stop_failure"]),
  finalFingerprintPresent: z.boolean(),
  stagedDirty: z.boolean(),
  unstagedDirty: z.boolean(),
  counts: z.strictObject({
    entryCount: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    typeChanged: z.number().int().nonnegative(),
    unmerged: z.number().int().nonnegative(),
  }),
  entries: z
    .array(
      z.strictObject({
        eventIndex: z.number().int().nonnegative(),
        pathIdentitySha256: z.string().regex(/^[0-9a-f]{64}$/u),
        relativePath: z.string().min(1).max(1024).nullable(),
        changeKind: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]),
        staged: z.boolean(),
        unstaged: z.boolean(),
        sensitivity: z.enum(["normal", "secret"]),
        attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
      }),
    )
    .max(2000),
});
export type FinalDiffManifestV1 = z.infer<typeof FinalDiffManifestV1Schema>;
