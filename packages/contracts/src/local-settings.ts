import { z } from "zod";

import {
  CANDIDATE_GENERATION_MAX_RESPONSE_BYTES,
  CANDIDATE_GENERATION_PROVIDER_FAMILIES,
  CandidateGenerationRetryPolicyV1Schema,
} from "./candidate-generation.js";
import { REPLAY_RUN_STATUSES, ReplayRunStatusSchema } from "./replay.js";

export const LOCAL_SETTINGS_SCHEMA_VERSION = 1 as const;
export const LOCAL_SETTINGS_ID = "local" as const;
export const LOCAL_SETTINGS_MAX_SECRET_PATTERNS = 32;
export const LOCAL_SETTINGS_RETENTION_PREVIEW_LIMIT = 100;
export const LOCAL_SETTINGS_RETENTION_APPLY_LIMIT = 25;

export const LOCAL_RETENTION_POLICIES = [
  "keep_until_deleted",
  "delete_terminal_after_7_days",
  "delete_terminal_after_30_days",
  "delete_terminal_after_90_days",
] as const;
export const LocalRetentionPolicySchema = z.enum(LOCAL_RETENTION_POLICIES);
export type LocalRetentionPolicy = z.infer<typeof LocalRetentionPolicySchema>;

export const LOCAL_DIAGNOSTIC_MODES = ["off", "counts_only"] as const;
export const LocalDiagnosticModeSchema = z.enum(LOCAL_DIAGNOSTIC_MODES);
export type LocalDiagnosticMode = z.infer<typeof LocalDiagnosticModeSchema>;

export const LOCAL_PROVIDER_SECRET_STATUSES = ["absent", "loaded"] as const;
export const LocalProviderSecretStatusSchema = z.enum(LOCAL_PROVIDER_SECRET_STATUSES);
export type LocalProviderSecretStatus = z.infer<typeof LocalProviderSecretStatusSchema>;

export const LocalRawSourcePayloadRetentionSchema = z.literal("off");
export type LocalRawSourcePayloadRetention = z.infer<typeof LocalRawSourcePayloadRetentionSchema>;

const canonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid canonical UTC timestamp.");

const safeModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
const runIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const safeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const LocalSecretFieldPatternSchema = z
  .string()
  .min(3)
  .max(65)
  .regex(/^(?:[a-z0-9]{3,64}|[a-z0-9]{3,64}\*|\*[a-z0-9]{3,64})$/u);
export type LocalSecretFieldPattern = z.infer<typeof LocalSecretFieldPatternSchema>;

function isSortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

export const LocalSecretFieldPatternsSchema = z
  .array(LocalSecretFieldPatternSchema)
  .max(LOCAL_SETTINGS_MAX_SECRET_PATTERNS)
  .superRefine((value, context) => {
    if (!isSortedUnique(value)) {
      context.addIssue({
        code: "custom",
        message: "Secret-field patterns must be unique and in canonical order.",
      });
    }
  });
export type LocalSecretFieldPatterns = z.infer<typeof LocalSecretFieldPatternsSchema>;

export const LocalProviderPublicSettingsV1Schema = z
  .strictObject({
    providerFamily: z.literal(CANDIDATE_GENERATION_PROVIDER_FAMILIES[0]),
    baseUrl: z
      .string()
      .min(1)
      .max(2048)
      .refine((value) => value.trim() === value, "Provider URL must be trimmed."),
    modelId: safeModelSchema,
    modelRevision: safeModelSchema.nullable(),
    timeoutMs: z.number().int().min(1_000).max(120_000),
    maxResponseBytes: z.number().int().min(1).max(CANDIDATE_GENERATION_MAX_RESPONSE_BYTES),
    retryPolicy: CandidateGenerationRetryPolicyV1Schema,
  })
  .superRefine((value, context) => {
    if (
      !/^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[1-9][0-9]{0,4})?\/v1$/u.test(
        value.baseUrl,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "Provider URL must be a canonical HTTPS /v1 base URL.",
      });
    }
  });
export type LocalProviderPublicSettingsV1 = z.infer<typeof LocalProviderPublicSettingsV1Schema>;

export const LocalSettingsDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
  id: z.literal(LOCAL_SETTINGS_ID),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  externalAiEnabled: z.boolean(),
  provider: LocalProviderPublicSettingsV1Schema.nullable(),
  retentionPolicy: LocalRetentionPolicySchema,
  diagnosticMode: LocalDiagnosticModeSchema,
  rawSourcePayloadRetention: LocalRawSourcePayloadRetentionSchema,
  customSecretFieldPatterns: LocalSecretFieldPatternsSchema,
  updatedAt: canonicalTimestampSchema,
});
export type LocalSettingsDocumentV1 = z.infer<typeof LocalSettingsDocumentV1Schema>;

export const LocalSettingsReplacementV1Schema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
  externalAiEnabled: z.boolean(),
  provider: LocalProviderPublicSettingsV1Schema.nullable(),
  retentionPolicy: LocalRetentionPolicySchema,
  diagnosticMode: LocalDiagnosticModeSchema,
  rawSourcePayloadRetention: LocalRawSourcePayloadRetentionSchema,
  customSecretFieldPatterns: LocalSecretFieldPatternsSchema,
});
export type LocalSettingsReplacementV1 = z.infer<typeof LocalSettingsReplacementV1Schema>;

export const LocalSettingsUpdateRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  replacement: LocalSettingsReplacementV1Schema,
});
export type LocalSettingsUpdateRequestV1 = z.infer<typeof LocalSettingsUpdateRequestV1Schema>;

export const LocalSettingsResponseV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    settings: LocalSettingsDocumentV1Schema,
    providerSecretStatus: LocalProviderSecretStatusSchema,
    providerGenerationConfigured: z.boolean(),
  })
  .superRefine((value, context) => {
    const possible =
      value.settings.externalAiEnabled &&
      value.settings.provider !== null &&
      value.providerSecretStatus === "loaded";
    if (value.providerGenerationConfigured !== possible) {
      context.addIssue({ code: "custom", message: "Provider configured state is inconsistent." });
    }
  });
export type LocalSettingsResponseV1 = z.infer<typeof LocalSettingsResponseV1Schema>;

export const LocalProviderSecretRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
  apiKey: z
    .string()
    .min(1)
    .max(8 * 1024),
});
export type LocalProviderSecretRequestV1 = z.infer<typeof LocalProviderSecretRequestV1Schema>;

export const LocalProviderSecretResponseV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    providerSecretStatus: LocalProviderSecretStatusSchema,
    providerGenerationConfigured: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.providerGenerationConfigured !== (value.providerSecretStatus === "loaded")) {
      context.addIssue({ code: "custom", message: "Provider secret state is inconsistent." });
    }
  });
export type LocalProviderSecretResponseV1 = z.infer<typeof LocalProviderSecretResponseV1Schema>;

export const LOCAL_DIAGNOSTIC_EVENT_CODES = [
  "server_started",
  "server_stopped",
  "receipt_accepted",
  "receipt_duplicate",
  "request_rejected",
] as const;
export const LocalDiagnosticEventCodeSchema = z.enum(LOCAL_DIAGNOSTIC_EVENT_CODES);
export type LocalDiagnosticEventCode = z.infer<typeof LocalDiagnosticEventCodeSchema>;

export const LocalDiagnosticCountV1Schema = z.strictObject({
  code: LocalDiagnosticEventCodeSchema,
  count: safeCountSchema,
});
export type LocalDiagnosticCountV1 = z.infer<typeof LocalDiagnosticCountV1Schema>;

export const LocalDiagnosticErrorCountV1Schema = z.strictObject({
  errorCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  count: safeCountSchema,
});
export type LocalDiagnosticErrorCountV1 = z.infer<typeof LocalDiagnosticErrorCountV1Schema>;

export const LocalDiagnosticsResponseV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    mode: LocalDiagnosticModeSchema,
    counts: z.array(LocalDiagnosticCountV1Schema).max(LOCAL_DIAGNOSTIC_EVENT_CODES.length),
    rejectedByCode: z.array(LocalDiagnosticErrorCountV1Schema).max(100),
  })
  .superRefine((value, context) => {
    if (value.mode === "off" && (value.counts.length > 0 || value.rejectedByCode.length > 0)) {
      context.addIssue({ code: "custom", message: "Disabled diagnostics cannot contain counts." });
    }
    if (!isSortedUnique(value.counts.map((item) => item.code))) {
      context.addIssue({ code: "custom", path: ["counts"], message: "Counts are not canonical." });
    }
    if (!isSortedUnique(value.rejectedByCode.map((item) => item.errorCode))) {
      context.addIssue({
        code: "custom",
        path: ["rejectedByCode"],
        message: "Rejected counts are not canonical.",
      });
    }
  });
export type LocalDiagnosticsResponseV1 = z.infer<typeof LocalDiagnosticsResponseV1Schema>;

const terminalStatuses = new Set<string>(["Completed", "Partial", "Abandoned", "Failed"]);

export const LocalRetentionCandidateV1Schema = z
  .strictObject({
    runId: runIdSchema,
    conversationId: z.string().min(1).max(128),
    runNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    status: ReplayRunStatusSchema,
    endedAt: canonicalTimestampSchema,
  })
  .superRefine((value, context) => {
    if (!terminalStatuses.has(value.status)) {
      context.addIssue({ code: "custom", path: ["status"], message: "Run is not terminal." });
    }
  });
export type LocalRetentionCandidateV1 = z.infer<typeof LocalRetentionCandidateV1Schema>;

export const LocalRetentionPreviewV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    policy: LocalRetentionPolicySchema,
    cutoff: canonicalTimestampSchema.nullable(),
    totalEligible: safeCountSchema,
    truncated: z.boolean(),
    runs: z.array(LocalRetentionCandidateV1Schema).max(LOCAL_SETTINGS_RETENTION_PREVIEW_LIMIT),
  })
  .superRefine((value, context) => {
    if (value.policy === "keep_until_deleted") {
      if (
        value.cutoff !== null ||
        value.totalEligible !== 0 ||
        value.truncated ||
        value.runs.length > 0
      ) {
        context.addIssue({ code: "custom", message: "Keep policy preview is inconsistent." });
      }
      return;
    }
    if (value.cutoff === null || value.totalEligible < value.runs.length) {
      context.addIssue({ code: "custom", message: "Retention preview totals are inconsistent." });
    }
    if (value.truncated !== value.totalEligible > value.runs.length) {
      context.addIssue({ code: "custom", message: "Retention truncation is inconsistent." });
    }
  });
export type LocalRetentionPreviewV1 = z.infer<typeof LocalRetentionPreviewV1Schema>;

export const LOCAL_RUN_DELETION_OUTCOMES = ["deleted", "not_found", "active_conflict"] as const;
export const LocalRunDeletionOutcomeSchema = z.enum(LOCAL_RUN_DELETION_OUTCOMES);
export type LocalRunDeletionOutcome = z.infer<typeof LocalRunDeletionOutcomeSchema>;

export const LocalArtifactGcSummaryV1Schema = z
  .strictObject({
    scanned: safeCountSchema,
    deleted: safeCountSchema,
    retained: safeCountSchema,
    failures: safeCountSchema,
  })
  .superRefine((value, context) => {
    if (value.deleted + value.retained > value.scanned) {
      context.addIssue({ code: "custom", message: "Artifact GC aggregates are inconsistent." });
    }
  });
export type LocalArtifactGcSummaryV1 = z.infer<typeof LocalArtifactGcSummaryV1Schema>;

export const LocalRunDeletionResultV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    runId: runIdSchema,
    outcome: LocalRunDeletionOutcomeSchema,
    artifactGc: LocalArtifactGcSummaryV1Schema,
  })
  .superRefine((value, context) => {
    if (
      value.outcome !== "deleted" &&
      Object.values(value.artifactGc).some((count) => count !== 0)
    ) {
      context.addIssue({ code: "custom", message: "Non-deletion cannot report artifact GC work." });
    }
  });
export type LocalRunDeletionResultV1 = z.infer<typeof LocalRunDeletionResultV1Schema>;

export const LocalRetentionApplyResultV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(LOCAL_SETTINGS_SCHEMA_VERSION),
    policy: LocalRetentionPolicySchema,
    cutoff: canonicalTimestampSchema.nullable(),
    considered: safeCountSchema,
    deletedRunIds: z.array(runIdSchema).max(LOCAL_SETTINGS_RETENTION_APPLY_LIMIT),
    retainedRunIds: z.array(runIdSchema).max(LOCAL_SETTINGS_RETENTION_APPLY_LIMIT),
    artifactGc: LocalArtifactGcSummaryV1Schema,
  })
  .superRefine((value, context) => {
    const all = [...value.deletedRunIds, ...value.retainedRunIds];
    if (new Set(all).size !== all.length || value.considered !== all.length) {
      context.addIssue({ code: "custom", message: "Retention apply aggregates are inconsistent." });
    }
    if (value.policy === "keep_until_deleted") {
      if (
        value.cutoff !== null ||
        value.considered !== 0 ||
        all.length !== 0 ||
        Object.values(value.artifactGc).some((count) => count !== 0)
      ) {
        context.addIssue({ code: "custom", message: "Keep retention result is inconsistent." });
      }
    } else if (value.cutoff === null) {
      context.addIssue({ code: "custom", message: "Retention cleanup requires a cutoff." });
    }
    if (
      value.deletedRunIds.length === 0 &&
      Object.values(value.artifactGc).some((count) => count !== 0)
    ) {
      context.addIssue({ code: "custom", message: "Artifact GC requires a deleted Run." });
    }
  });
export type LocalRetentionApplyResultV1 = z.infer<typeof LocalRetentionApplyResultV1Schema>;

export const LOCAL_SETTINGS_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "settings_conflict",
  "provider_secret_invalid",
  "run_not_found",
  "run_active",
  "operation_failed",
] as const;
export const LocalSettingsErrorCodeSchema = z.enum(LOCAL_SETTINGS_ERROR_CODES);
export type LocalSettingsErrorCode = z.infer<typeof LocalSettingsErrorCodeSchema>;

export const LocalSettingsErrorResponseV1Schema = z.strictObject({
  ok: z.literal(false),
  error: LocalSettingsErrorCodeSchema,
});
export type LocalSettingsErrorResponseV1 = z.infer<typeof LocalSettingsErrorResponseV1Schema>;

export const LOCAL_TERMINAL_RUN_STATUSES = REPLAY_RUN_STATUSES.filter((status) =>
  terminalStatuses.has(status),
);
