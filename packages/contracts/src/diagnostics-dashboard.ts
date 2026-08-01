import { z } from "zod";

import {
  AgentIngressHookIdentitySchema,
  type IngressAgentSource,
  IngressAgentSourceSchema,
  MAX_INGRESS_AGENT_HOOK_IDENTITIES,
  type SupportedAgentHookName,
  SupportedAgentHookNameSchema,
} from "./agent-ingress.js";
import {
  CANDIDATE_VALIDATION_OUTCOMES,
  CANDIDATE_VALIDATION_REASONS,
  CandidateValidationOutcomeSchema,
  CandidateValidationReasonSchema,
} from "./candidate-validation.js";
import { INGESTION_ERROR_CODES, IngestionErrorCodeSchema } from "./ingestion-response.js";
import { INGRESS_REDACTION_RULE_IDS, IngressRedactionRuleIdSchema } from "./ingress-security.js";
import { LocalDiagnosticModeSchema } from "./local-settings.js";
import { REPLAY_RUN_STATUSES, ReplayRunStatusSchema } from "./replay.js";

export const DIAGNOSTICS_DASHBOARD_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTICS_DASHBOARD_PROJECTOR_VERSION = "0.1.0" as const;
export const DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = 1 as const;
export const DIAGNOSTICS_DASHBOARD_MAX_RECENT_RUNS = 100;
export const DIAGNOSTICS_DASHBOARD_MAX_BYTES = 1024 * 1024;
export const DIAGNOSTICS_BUNDLE_MAX_BYTES = 2 * 1024 * 1024;

export const DIAGNOSTICS_DASHBOARD_LIMITATIONS = [
  "diagnostics_off",
  "process_counters_reset_on_restart",
] as const;
export const DiagnosticsDashboardLimitationSchema = z.enum(DIAGNOSTICS_DASHBOARD_LIMITATIONS);
export type DiagnosticsDashboardLimitation = z.infer<typeof DiagnosticsDashboardLimitationSchema>;

const safeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,127}$/u);
const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const canonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid canonical UTC timestamp.");

function isSortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function sumCounts(values: readonly Readonly<{ count: number }>[]): number {
  return values.reduce((total, item) => total + item.count, 0);
}

function sortedUniqueCountArray<CodeSchema extends z.ZodType<string>>(
  codeSchema: CodeSchema,
  maximum: number,
) {
  return z
    .array(z.strictObject({ code: codeSchema, count: safeCountSchema }))
    .max(maximum)
    .superRefine((value, context) => {
      const rows = value as unknown as readonly Readonly<{ code: string; count: number }>[];
      if (!isSortedUnique(rows.map((item) => item.code))) {
        context.addIssue({ code: "custom", message: "Counts must be sorted and unique." });
      }
    });
}

export const DiagnosticsHookCountV1Schema = z
  .strictObject({
    source: IngressAgentSourceSchema.optional(),
    hookName: SupportedAgentHookNameSchema,
    count: safeCountSchema,
  })
  .superRefine((value, context) => {
    const parsed = AgentIngressHookIdentitySchema.safeParse({
      source: value.source ?? "claude_code",
      hookName: value.hookName,
    });
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        path: ["hookName"],
        message: "The diagnostic Hook does not belong to its ingress source.",
      });
    }
  });
export type DiagnosticsHookCountV1 = z.infer<typeof DiagnosticsHookCountV1Schema>;

function diagnosticHookIdentityKey(
  value: Readonly<{
    source?: IngressAgentSource | undefined;
    hookName: SupportedAgentHookName;
  }>,
): string {
  return `${value.source ?? "claude_code"}:${value.hookName}`;
}

const hookCountsSchema = z
  .array(DiagnosticsHookCountV1Schema)
  .max(MAX_INGRESS_AGENT_HOOK_IDENTITIES)
  .superRefine((value, context) => {
    if (!isSortedUnique(value.map(diagnosticHookIdentityKey))) {
      context.addIssue({ code: "custom", message: "Hook counts must be sorted and unique." });
    }
  });

export const DiagnosticsProcessSnapshotV1Schema = z
  .strictObject({
    serverStarted: safeCountSchema,
    serverStopped: safeCountSchema,
    acceptedReceipts: safeCountSchema,
    duplicateReceipts: safeCountSchema,
    rejectedRequests: safeCountSchema,
    acceptedByHook: hookCountsSchema,
    duplicateByHook: hookCountsSchema,
    rejectedByCode: sortedUniqueCountArray(IngestionErrorCodeSchema, INGESTION_ERROR_CODES.length),
  })
  .superRefine((value, context) => {
    if (sumCounts(value.acceptedByHook) !== value.acceptedReceipts) {
      context.addIssue({ code: "custom", message: "Accepted hook counts do not reconcile." });
    }
    if (sumCounts(value.duplicateByHook) !== value.duplicateReceipts) {
      context.addIssue({ code: "custom", message: "Duplicate hook counts do not reconcile." });
    }
    if (sumCounts(value.rejectedByCode) !== value.rejectedRequests) {
      context.addIssue({ code: "custom", message: "Rejected request counts do not reconcile." });
    }
  });
export type DiagnosticsProcessSnapshotV1 = z.infer<typeof DiagnosticsProcessSnapshotV1Schema>;

export const DiagnosticsRedactionAggregatesV1Schema = z
  .strictObject({
    preparedReceiptCount: safeCountSchema,
    legacyReceiptCount: safeCountSchema,
    redactedFieldCount: safeCountSchema,
    redactedValueCount: safeCountSchema,
    pathReplacementCount: safeCountSchema,
    droppedUnknownFieldCount: safeCountSchema,
    truncatedValueCount: safeCountSchema,
    receiptsByHook: hookCountsSchema,
    receiptsByRule: sortedUniqueCountArray(
      IngressRedactionRuleIdSchema,
      INGRESS_REDACTION_RULE_IDS.length,
    ),
  })
  .superRefine((value, context) => {
    if (sumCounts(value.receiptsByHook) !== value.preparedReceiptCount + value.legacyReceiptCount) {
      context.addIssue({ code: "custom", message: "Receipt hook counts do not reconcile." });
    }
    if (value.receiptsByRule.some((item) => item.count > value.preparedReceiptCount)) {
      context.addIssue({
        code: "custom",
        message: "A redaction rule count exceeds prepared receipts.",
      });
    }
  });
export type DiagnosticsRedactionAggregatesV1 = z.infer<
  typeof DiagnosticsRedactionAggregatesV1Schema
>;

export const DiagnosticsRunStatusCountV1Schema = z.strictObject({
  status: ReplayRunStatusSchema,
  count: safeCountSchema,
});
export type DiagnosticsRunStatusCountV1 = z.infer<typeof DiagnosticsRunStatusCountV1Schema>;
const runStatusCountsSchema = z
  .array(DiagnosticsRunStatusCountV1Schema)
  .max(REPLAY_RUN_STATUSES.length)
  .superRefine((value, context) => {
    if (!isSortedUnique(value.map((item) => item.status))) {
      context.addIssue({ code: "custom", message: "Run status counts must be sorted and unique." });
    }
  });

export const DIAGNOSTICS_FINALIZATION_MODES = ["normal", "recovery"] as const;
export const DiagnosticsFinalizationModeSchema = z.enum(DIAGNOSTICS_FINALIZATION_MODES);
export const DIAGNOSTICS_FINALIZATION_STATUSES = [
  "Completed",
  "Partial",
  "Failed",
  "Abandoned",
] as const;
export const DiagnosticsFinalizationStatusSchema = z.enum(DIAGNOSTICS_FINALIZATION_STATUSES);

export const DiagnosticsFinalizationAggregateV1Schema = z
  .strictObject({
    total: safeCountSchema,
    byStatus: sortedUniqueCountArray(
      DiagnosticsFinalizationStatusSchema,
      DIAGNOSTICS_FINALIZATION_STATUSES.length,
    ),
    byMode: sortedUniqueCountArray(
      DiagnosticsFinalizationModeSchema,
      DIAGNOSTICS_FINALIZATION_MODES.length,
    ),
    byDiagnosticCode: sortedUniqueCountArray(safeCodeSchema, 100),
    withoutDiagnosticCode: safeCountSchema,
  })
  .superRefine((value, context) => {
    if (sumCounts(value.byStatus) !== value.total || sumCounts(value.byMode) !== value.total) {
      context.addIssue({ code: "custom", message: "Finalization counts do not reconcile." });
    }
    if (sumCounts(value.byDiagnosticCode) + value.withoutDiagnosticCode !== value.total) {
      context.addIssue({
        code: "custom",
        message: "Finalization diagnostic counts do not reconcile.",
      });
    }
  });
export type DiagnosticsFinalizationAggregateV1 = z.infer<
  typeof DiagnosticsFinalizationAggregateV1Schema
>;

export const DiagnosticsValidationAggregatesV1Schema = z
  .strictObject({
    totalValidations: safeCountSchema,
    byOutcome: sortedUniqueCountArray(
      CandidateValidationOutcomeSchema,
      CANDIDATE_VALIDATION_OUTCOMES.length,
    ),
    sourceCandidates: safeCountSchema,
    rejectedCandidates: safeCountSchema,
    duplicateCandidates: safeCountSchema,
    unselectedCandidates: safeCountSchema,
    selectedCandidates: safeCountSchema,
    reasonCounts: sortedUniqueCountArray(
      CandidateValidationReasonSchema,
      CANDIDATE_VALIDATION_REASONS.length,
    ),
  })
  .superRefine((value, context) => {
    if (sumCounts(value.byOutcome) !== value.totalValidations) {
      context.addIssue({ code: "custom", message: "Validation outcome counts do not reconcile." });
    }
    if (
      value.rejectedCandidates +
        value.duplicateCandidates +
        value.unselectedCandidates +
        value.selectedCandidates !==
      value.sourceCandidates
    ) {
      context.addIssue({ code: "custom", message: "Candidate aggregate counts do not reconcile." });
    }
  });
export type DiagnosticsValidationAggregatesV1 = z.infer<
  typeof DiagnosticsValidationAggregatesV1Schema
>;

export const DIAGNOSTICS_RUN_LIMITATIONS = [
  "active_run",
  "no_finalization",
  "no_current_validation",
] as const;
export const DiagnosticsRunLimitationSchema = z.enum(DIAGNOSTICS_RUN_LIMITATIONS);

export const DiagnosticsRunQualityV1Schema = z
  .strictObject({
    runId: safeIdSchema,
    runNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    status: ReplayRunStatusSchema,
    endedAt: canonicalTimestampSchema.nullable(),
    evidenceGapCount: safeCountSchema,
    finalization: z
      .strictObject({
        terminalStatus: DiagnosticsFinalizationStatusSchema,
        mode: DiagnosticsFinalizationModeSchema,
        diagnosticCode: safeCodeSchema.nullable(),
        finalizedAt: canonicalTimestampSchema,
      })
      .nullable(),
    validation: z
      .strictObject({
        validationId: safeIdSchema,
        outcome: CandidateValidationOutcomeSchema,
        sourceCandidates: safeCountSchema,
        rejectedCandidates: safeCountSchema,
        duplicateCandidates: safeCountSchema,
        unselectedCandidates: safeCountSchema,
        selectedCandidates: safeCountSchema,
        reasonCounts: sortedUniqueCountArray(
          CandidateValidationReasonSchema,
          CANDIDATE_VALIDATION_REASONS.length,
        ),
      })
      .nullable(),
    limitations: z.array(DiagnosticsRunLimitationSchema).max(DIAGNOSTICS_RUN_LIMITATIONS.length),
  })
  .superRefine((value, context) => {
    const active = value.status === "Capturing" || value.status === "Finalizing";
    if (active !== value.limitations.includes("active_run")) {
      context.addIssue({ code: "custom", message: "Active Run limitation is inconsistent." });
    }
    if ((value.finalization === null) !== value.limitations.includes("no_finalization")) {
      context.addIssue({ code: "custom", message: "Finalization limitation is inconsistent." });
    }
    if ((value.validation === null) !== value.limitations.includes("no_current_validation")) {
      context.addIssue({ code: "custom", message: "Validation limitation is inconsistent." });
    }
    if (active && (value.endedAt !== null || value.finalization !== null)) {
      context.addIssue({ code: "custom", message: "Active Run terminal fields are inconsistent." });
    }
    if (!active && value.endedAt === null) {
      context.addIssue({ code: "custom", message: "Terminal Run must have endedAt." });
    }
    if (value.finalization !== null && value.finalization.terminalStatus !== value.status) {
      context.addIssue({ code: "custom", message: "Run/finalization status mismatch." });
    }
    if (value.validation !== null) {
      const counts = value.validation;
      if (
        counts.rejectedCandidates +
          counts.duplicateCandidates +
          counts.unselectedCandidates +
          counts.selectedCandidates !==
        counts.sourceCandidates
      ) {
        context.addIssue({ code: "custom", message: "Run validation counts do not reconcile." });
      }
    }
    const limitationIndexes = value.limitations.map((item) =>
      DIAGNOSTICS_RUN_LIMITATIONS.indexOf(item),
    );
    if (
      new Set(value.limitations).size !== value.limitations.length ||
      limitationIndexes
        .toSorted((a, b) => a - b)
        .some((item, index) => item !== limitationIndexes[index])
    ) {
      context.addIssue({ code: "custom", message: "Run limitations must be sorted and unique." });
    }
  });
export type DiagnosticsRunQualityV1 = z.infer<typeof DiagnosticsRunQualityV1Schema>;

export const DiagnosticsDashboardV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DIAGNOSTICS_DASHBOARD_SCHEMA_VERSION),
    projectorVersion: z.literal(DIAGNOSTICS_DASHBOARD_PROJECTOR_VERSION),
    diagnosticMode: LocalDiagnosticModeSchema,
    limitations: z
      .array(DiagnosticsDashboardLimitationSchema)
      .max(DIAGNOSTICS_DASHBOARD_LIMITATIONS.length),
    process: DiagnosticsProcessSnapshotV1Schema.nullable(),
    redaction: DiagnosticsRedactionAggregatesV1Schema,
    runs: z.strictObject({
      totalRuns: safeCountSchema,
      byStatus: runStatusCountsSchema,
    }),
    finalizations: DiagnosticsFinalizationAggregateV1Schema,
    evidenceGapCounts: sortedUniqueCountArray(safeCodeSchema, 1000),
    validations: DiagnosticsValidationAggregatesV1Schema,
    recentRuns: z.array(DiagnosticsRunQualityV1Schema).max(DIAGNOSTICS_DASHBOARD_MAX_RECENT_RUNS),
    recentRunsTotal: safeCountSchema,
    recentRunsTruncated: z.boolean(),
    fingerprint: sha256FingerprintSchema,
  })
  .superRefine((value, context) => {
    if (!isSortedUnique(value.limitations)) {
      context.addIssue({
        code: "custom",
        message: "Dashboard limitations must be sorted and unique.",
      });
    }
    const diagnosticsOff = value.diagnosticMode === "off";
    if (diagnosticsOff !== (value.process === null)) {
      context.addIssue({
        code: "custom",
        message: "Process diagnostics availability is inconsistent.",
      });
    }
    if (diagnosticsOff !== value.limitations.includes("diagnostics_off")) {
      context.addIssue({ code: "custom", message: "Diagnostics-off limitation is inconsistent." });
    }
    if (!diagnosticsOff && !value.limitations.includes("process_counters_reset_on_restart")) {
      context.addIssue({ code: "custom", message: "Process lifetime limitation is missing." });
    }
    if (sumCounts(value.runs.byStatus) !== value.runs.totalRuns) {
      context.addIssue({ code: "custom", message: "Run status totals do not reconcile." });
    }
    if (value.recentRunsTotal !== value.runs.totalRuns) {
      context.addIssue({ code: "custom", message: "Recent Run total must equal exact Run total." });
    }
    if (value.recentRunsTruncated !== value.recentRunsTotal > value.recentRuns.length) {
      context.addIssue({ code: "custom", message: "Recent Run truncation is inconsistent." });
    }
  });
export type DiagnosticsDashboardV1 = z.infer<typeof DiagnosticsDashboardV1Schema>;

export const DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES = [
  "artifact_metadata",
  "candidate_prose",
  "command_output",
  "evidence_ids_and_text",
  "exceptions_and_stacks",
  "free_form_text",
  "installation_credentials",
  "provider_data_and_secrets",
  "repository_and_source_content",
  "source_payload_json",
  "source_session_and_tool_ids",
] as const;
export const DiagnosticsBundleExcludedDataClassSchema = z.enum(
  DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES,
);

export const DiagnosticsBundleV1Schema = z
  .strictObject({
    schemaVersion: z.literal(DIAGNOSTICS_BUNDLE_SCHEMA_VERSION),
    applicationVersions: z.strictObject({
      app: z.string().min(1).max(64),
      contracts: z.string().min(1).max(64),
      daemon: z.string().min(1).max(64),
    }),
    exportedAt: canonicalTimestampSchema,
    dashboardFingerprint: sha256FingerprintSchema,
    dashboard: DiagnosticsDashboardV1Schema,
    excludedDataClasses: z
      .array(DiagnosticsBundleExcludedDataClassSchema)
      .length(DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES.length),
    fingerprint: sha256FingerprintSchema,
  })
  .superRefine((value, context) => {
    if (value.dashboardFingerprint !== value.dashboard.fingerprint) {
      context.addIssue({ code: "custom", message: "Bundle dashboard fingerprint mismatch." });
    }
    if (
      value.excludedDataClasses.some(
        (item, index) => item !== DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES[index],
      )
    ) {
      context.addIssue({ code: "custom", message: "Bundle exclusions are not canonical." });
    }
  });
export type DiagnosticsBundleV1 = z.infer<typeof DiagnosticsBundleV1Schema>;

export const DIAGNOSTICS_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "projection_failed",
  "bundle_too_large",
] as const;
export const DiagnosticsErrorCodeSchema = z.enum(DIAGNOSTICS_ERROR_CODES);
export type DiagnosticsErrorCode = z.infer<typeof DiagnosticsErrorCodeSchema>;
export const DiagnosticsErrorResponseV1Schema = z.strictObject({
  ok: z.literal(false),
  error: DiagnosticsErrorCodeSchema,
});
export type DiagnosticsErrorResponseV1 = z.infer<typeof DiagnosticsErrorResponseV1Schema>;
