import { z } from "zod";

import {
  CHANGE_CLASSIFICATION_LABELS,
  ChangeClassificationLabelSchema,
} from "./change-classification.js";
import {
  CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES,
  CANDIDATE_GENERATION_SCHEMA_VERSION,
} from "./candidate-generation.js";
import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "./candidate-moment.js";
import {
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  EvidenceIdSchema,
} from "./evidence-graph.js";
import {
  VerificationKindSchema,
  VerificationObservedStatusSchema,
} from "./verification-evidence.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true, precision: 3 });

export const CANDIDATE_VALIDATION_SCHEMA_VERSION = 1 as const;
export const CANDIDATE_VALIDATOR_VERSION = "0.1.0" as const;
export const CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION = "ownloop-candidate-support-v1" as const;
export const CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION =
  "ownloop-candidate-contradiction-v1" as const;
export const CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION = "ownloop-candidate-absence-v1" as const;
export const CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION =
  "ownloop-candidate-duplicate-v1" as const;
export const CANDIDATE_VALIDATION_RANKING_POLICY_VERSION = "ownloop-candidate-ranking-v1" as const;
export const CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION =
  "ownloop-candidate-selection-v1" as const;

export const CANDIDATE_VALIDATION_MAX_SELECTED = 7;
export const CANDIDATE_VALIDATION_MAX_EXPANDED_EVIDENCE_IDS = 64;
export const CANDIDATE_VALIDATION_MAX_FACTS = 64;
export const CANDIDATE_VALIDATION_MAX_ARTIFACT_BYTES = 512 * 1024;
export const CANDIDATE_VALIDATION_MAX_BATCH = 25;

export const CANDIDATE_VALIDATION_OUTCOMES = ["ready", "partial"] as const;
export const CandidateValidationOutcomeSchema = z.enum(CANDIDATE_VALIDATION_OUTCOMES);
export type CandidateValidationOutcome = z.infer<typeof CandidateValidationOutcomeSchema>;

export const CANDIDATE_VALIDATION_RESULT_OUTCOMES = ["ready", "partial", "unavailable"] as const;
export const CandidateValidationResultOutcomeSchema = z.enum(CANDIDATE_VALIDATION_RESULT_OUTCOMES);
export type CandidateValidationResultOutcome = z.infer<
  typeof CandidateValidationResultOutcomeSchema
>;

export const CANDIDATE_VALIDATION_DIAGNOSTIC_CODES = [
  "completed",
  "source_graph_partial",
  "source_unavailable",
] as const;
export const CandidateValidationDiagnosticCodeSchema = z.enum(
  CANDIDATE_VALIDATION_DIAGNOSTIC_CODES,
);
export type CandidateValidationDiagnosticCode = z.infer<
  typeof CandidateValidationDiagnosticCodeSchema
>;

export const CANDIDATE_VALIDATION_LIMITATIONS = ["source_graph_partial"] as const;
export const CandidateValidationLimitationSchema = z.enum(CANDIDATE_VALIDATION_LIMITATIONS);
export type CandidateValidationLimitation = z.infer<typeof CandidateValidationLimitationSchema>;

export const CANDIDATE_VALIDATION_DECISIONS = [
  "rejected",
  "valid_selected",
  "valid_unselected",
] as const;
export const CandidateValidationDecisionSchema = z.enum(CANDIDATE_VALIDATION_DECISIONS);
export type CandidateValidationDecision = z.infer<typeof CandidateValidationDecisionSchema>;

export const CANDIDATE_VALIDATION_REASONS = [
  "missing_evidence",
  "foreign_evidence",
  "disconnected_evidence",
  "unsupported_evidence_kind",
  "type_evidence_mismatch",
  "unsupported_claim_language",
  "deterministic_contradiction",
  "unsupported_absence_claim",
  "conflicting_evidence",
  "duplicate_candidate",
  "ranked_below_limit",
  "source_graph_partial",
  "evidence_limit_exceeded",
] as const;
export const CandidateValidationReasonSchema = z.enum(CANDIDATE_VALIDATION_REASONS);
export type CandidateValidationReason = z.infer<typeof CandidateValidationReasonSchema>;

const evidenceIdsSchema = z
  .array(EvidenceIdSchema)
  .max(CANDIDATE_VALIDATION_MAX_EXPANDED_EVIDENCE_IDS)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({ code: "custom", message: "Validation Evidence IDs must be unique." });
    }
    if (value.toSorted().some((item, index) => item !== value[index])) {
      context.addIssue({ code: "custom", message: "Validation Evidence IDs must be sorted." });
    }
  });

const factEvidenceIdsSchema = evidenceIdsSchema.min(1);

export const CandidateValidationTerminalStatusFactV1Schema = z.strictObject({
  kind: z.literal("terminal_status"),
  value: z.enum(["Completed", "Partial", "Abandoned", "Failed"]),
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationChangeKindFactV1Schema = z.strictObject({
  kind: z.literal("change_kind"),
  value: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]),
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationAttributionFactV1Schema = z.strictObject({
  kind: z.literal("attribution"),
  value: z.enum(["run_relative", "observed_only", "unavailable"]),
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationClassificationFactV1Schema = z.strictObject({
  kind: z.literal("classification_label"),
  value: ChangeClassificationLabelSchema,
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationVerificationFactV1Schema = z.strictObject({
  kind: z.literal("verification_status"),
  verificationKind: VerificationKindSchema,
  observedStatus: VerificationObservedStatusSchema,
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationEvidenceGapFactV1Schema = z.strictObject({
  kind: z.literal("evidence_gap"),
  gapCode: safeCodeSchema,
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationDecisionObservedFactV1Schema = z.strictObject({
  kind: z.literal("decision_observed"),
  eventType: z.enum(["agent.plan_observed", "agent.summary_observed"]),
  evidenceIds: factEvidenceIdsSchema,
});
export const CandidateValidationSourcePartialFactV1Schema = z.strictObject({
  kind: z.literal("source_partial"),
  value: z.literal(true),
  evidenceIds: z.array(EvidenceIdSchema).length(0),
});

export const CandidateValidationFactV1Schema = z.discriminatedUnion("kind", [
  CandidateValidationTerminalStatusFactV1Schema,
  CandidateValidationChangeKindFactV1Schema,
  CandidateValidationAttributionFactV1Schema,
  CandidateValidationClassificationFactV1Schema,
  CandidateValidationVerificationFactV1Schema,
  CandidateValidationEvidenceGapFactV1Schema,
  CandidateValidationDecisionObservedFactV1Schema,
  CandidateValidationSourcePartialFactV1Schema,
]);
export type CandidateValidationFactV1 = z.infer<typeof CandidateValidationFactV1Schema>;

export const CandidateValidationScoreV1Schema = z
  .strictObject({
    evidenceStrength: z.number().int().min(0).max(100_000),
    urgency: z.number().int().min(0).max(100_000),
    completenessAdjustment: z.number().int().min(-100_000).max(0),
    providerImportanceSignal: z.number().int().min(0).max(100_000),
    providerConfidenceSignal: z.number().int().min(0).max(100_000),
    attentionPenalty: z.number().int().min(0).max(100_000),
    total: z.number().int().min(-1_000_000).max(1_000_000),
  })
  .superRefine((value, context) => {
    const expected =
      value.evidenceStrength +
      value.urgency +
      value.completenessAdjustment +
      value.providerImportanceSignal +
      value.providerConfidenceSignal -
      value.attentionPenalty;
    if (value.total !== expected) {
      context.addIssue({ code: "custom", message: "Validation score total is inconsistent." });
    }
  });
export type CandidateValidationScoreV1 = z.infer<typeof CandidateValidationScoreV1Schema>;

const validationIdSchema = z.string().regex(/^val_[0-9a-f]{48}$/u);
const validationKeySchema = z.string().regex(/^vkey_[0-9a-f]{48}$/u);
const duplicateGroupIdSchema = z.string().regex(/^dup_[0-9a-f]{48}$/u);
const validationReportRoleSchema = z.literal("candidate-validation-report-v1");

function factSortKey(value: CandidateValidationFactV1): string {
  switch (value.kind) {
    case "verification_status":
      return `${value.kind}:${value.verificationKind}:${value.observedStatus}:${value.evidenceIds.join(",")}`;
    case "evidence_gap":
      return `${value.kind}:${value.gapCode}:${value.evidenceIds.join(",")}`;
    case "decision_observed":
      return `${value.kind}:${value.eventType}:${value.evidenceIds.join(",")}`;
    default:
      return `${value.kind}:${String(value.value)}:${value.evidenceIds.join(",")}`;
  }
}

export const CandidateValidationItemV1Schema = z
  .strictObject({
    sourceIndex: z
      .number()
      .int()
      .min(0)
      .max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES - 1),
    candidateFingerprint: sha256FingerprintSchema,
    citedEvidenceIds: z.array(EvidenceIdSchema).min(1).max(32),
    expandedEvidenceIds: evidenceIdsSchema,
    facts: z.array(CandidateValidationFactV1Schema).max(CANDIDATE_VALIDATION_MAX_FACTS),
    decision: CandidateValidationDecisionSchema,
    reasons: z.array(CandidateValidationReasonSchema).max(CANDIDATE_VALIDATION_REASONS.length),
    duplicateGroupId: duplicateGroupIdSchema.nullable(),
    representativeSourceIndex: z
      .number()
      .int()
      .min(0)
      .max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES - 1)
      .nullable(),
    attentionCost: z.number().int().min(0).max(100_000),
    score: CandidateValidationScoreV1Schema.nullable(),
    selectedRank: z.number().int().min(1).max(CANDIDATE_VALIDATION_MAX_SELECTED).nullable(),
  })
  .superRefine((value, context) => {
    if (new Set(value.citedEvidenceIds).size !== value.citedEvidenceIds.length) {
      context.addIssue({ code: "custom", message: "Cited Evidence IDs must be unique." });
    }
    if (
      value.citedEvidenceIds
        .toSorted()
        .some((item, index) => item !== value.citedEvidenceIds[index])
    ) {
      context.addIssue({ code: "custom", message: "Cited Evidence IDs must be sorted." });
    }
    const factKeys = value.facts.map(factSortKey);
    if (new Set(factKeys).size !== factKeys.length) {
      context.addIssue({ code: "custom", message: "Validation facts must be unique." });
    }
    if (factKeys.toSorted().some((item, index) => item !== factKeys[index])) {
      context.addIssue({ code: "custom", message: "Validation facts must be sorted." });
    }
    const reasonIndexes = value.reasons.map((reason) =>
      CANDIDATE_VALIDATION_REASONS.indexOf(reason),
    );
    if (new Set(value.reasons).size !== value.reasons.length) {
      context.addIssue({ code: "custom", message: "Validation reasons must be unique." });
    }
    if (
      reasonIndexes.toSorted((a, b) => a - b).some((item, index) => item !== reasonIndexes[index])
    ) {
      context.addIssue({ code: "custom", message: "Validation reasons must be sorted." });
    }
    const supportIds = new Set([...value.citedEvidenceIds, ...value.expandedEvidenceIds]);
    if (value.expandedEvidenceIds.some((id) => value.citedEvidenceIds.includes(id))) {
      context.addIssue({
        code: "custom",
        message: "Expanded Evidence IDs must exclude cited IDs.",
      });
    }
    if (
      value.facts.some(
        (fact) =>
          fact.kind !== "source_partial" &&
          fact.evidenceIds.some((evidenceId) => !supportIds.has(evidenceId)),
      )
    ) {
      context.addIssue({ code: "custom", message: "Validation fact Evidence is outside support." });
    }

    const duplicate = value.reasons.includes("duplicate_candidate");
    const rankedBelowLimit = value.reasons.includes("ranked_below_limit");
    const hasDuplicateFields =
      value.duplicateGroupId !== null || value.representativeSourceIndex !== null;
    const hasCompleteDuplicateFields =
      value.duplicateGroupId !== null && value.representativeSourceIndex !== null;

    if (value.decision === "rejected") {
      if (
        value.reasons.length === 0 ||
        duplicate ||
        rankedBelowLimit ||
        value.score !== null ||
        value.selectedRank !== null ||
        hasDuplicateFields
      ) {
        context.addIssue({
          code: "custom",
          message: "Rejected Candidate fields are inconsistent.",
        });
      }
    } else if (value.decision === "valid_selected") {
      if (
        value.reasons.length !== 0 ||
        value.score === null ||
        value.selectedRank === null ||
        hasDuplicateFields
      ) {
        context.addIssue({
          code: "custom",
          message: "Selected Candidate fields are inconsistent.",
        });
      }
    } else {
      const legalUnselectedReason = value.reasons.length === 1 && (duplicate || rankedBelowLimit);
      if (
        !legalUnselectedReason ||
        value.score === null ||
        value.selectedRank !== null ||
        duplicate !== hasCompleteDuplicateFields ||
        (!duplicate && hasDuplicateFields)
      ) {
        context.addIssue({
          code: "custom",
          message: "Unselected Candidate fields are inconsistent.",
        });
      }
    }
    if (
      value.representativeSourceIndex !== null &&
      value.representativeSourceIndex === value.sourceIndex
    ) {
      context.addIssue({ code: "custom", message: "A duplicate cannot represent itself." });
    }
  });
export type CandidateValidationItemV1 = z.infer<typeof CandidateValidationItemV1Schema>;

export const CandidateValidationCountsV1Schema = z
  .strictObject({
    source: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    rejected: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    valid: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    selected: z.number().int().min(0).max(CANDIDATE_VALIDATION_MAX_SELECTED),
    duplicate: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    unselected: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
  })
  .superRefine((value, context) => {
    if (
      value.source !== value.rejected + value.valid ||
      value.valid !== value.selected + value.unselected ||
      value.duplicate > value.unselected
    ) {
      context.addIssue({ code: "custom", message: "Validation counts are inconsistent." });
    }
  });
export type CandidateValidationCountsV1 = z.infer<typeof CandidateValidationCountsV1Schema>;

export const CandidateValidationSourceVersionsV1Schema = z.strictObject({
  evidenceGraphSchemaVersion: z.literal(EVIDENCE_GRAPH_SCHEMA_VERSION),
  evidenceGraphBuilderVersion: z.literal(EVIDENCE_GRAPH_BUILDER_VERSION),
  evidenceGraphTaxonomyVersion: z.literal(EVIDENCE_GRAPH_TAXONOMY_VERSION),
  candidateMomentSchemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
  candidateGenerationSchemaVersion: z.literal(CANDIDATE_GENERATION_SCHEMA_VERSION),
});
export type CandidateValidationSourceVersionsV1 = z.infer<
  typeof CandidateValidationSourceVersionsV1Schema
>;

export const CandidateValidationReportV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CANDIDATE_VALIDATION_SCHEMA_VERSION),
    validatorVersion: z.literal(CANDIDATE_VALIDATOR_VERSION),
    supportPolicyVersion: z.literal(CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION),
    contradictionPolicyVersion: z.literal(CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION),
    absencePolicyVersion: z.literal(CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION),
    duplicatePolicyVersion: z.literal(CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION),
    rankingPolicyVersion: z.literal(CANDIDATE_VALIDATION_RANKING_POLICY_VERSION),
    selectionPolicyVersion: z.literal(CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION),
    validationId: validationIdSchema,
    validationKey: validationKeySchema,
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    generationId: z.string().regex(/^gen_[0-9a-f]{48}$/u),
    sourceCandidateArtifactId: safeIdSchema,
    sourceCandidateFingerprint: sha256FingerprintSchema,
    evidenceGraphArtifactId: safeIdSchema,
    evidenceGraphInputFingerprint: sha256HexSchema,
    sourceVersions: CandidateValidationSourceVersionsV1Schema,
    outcome: CandidateValidationOutcomeSchema,
    diagnosticCode: CandidateValidationDiagnosticCodeSchema,
    limitations: z
      .array(CandidateValidationLimitationSchema)
      .max(CANDIDATE_VALIDATION_LIMITATIONS.length),
    items: z
      .array(CandidateValidationItemV1Schema)
      .max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    counts: CandidateValidationCountsV1Schema,
    selectedSourceIndexes: z.array(z.number().int().min(0).max(6)).max(7),
    reportFingerprint: sha256FingerprintSchema,
  })
  .superRefine((value, context) => {
    if (value.items.length !== value.counts.source) {
      context.addIssue({ code: "custom", message: "Validation item count differs." });
    }
    if (value.items.some((item, index) => item.sourceIndex !== index)) {
      context.addIssue({ code: "custom", message: "Validation items must follow source order." });
    }
    const rejected = value.items.filter((item) => item.decision === "rejected").length;
    const selected = value.items.filter((item) => item.decision === "valid_selected");
    const unselected = value.items.filter((item) => item.decision === "valid_unselected").length;
    const duplicate = value.items.filter((item) =>
      item.reasons.includes("duplicate_candidate"),
    ).length;
    if (
      rejected !== value.counts.rejected ||
      selected.length !== value.counts.selected ||
      unselected !== value.counts.unselected ||
      duplicate !== value.counts.duplicate
    ) {
      context.addIssue({ code: "custom", message: "Validation aggregates differ." });
    }
    const rankedSelected = selected.toSorted(
      (left, right) => (left.selectedRank ?? 0) - (right.selectedRank ?? 0),
    );
    const selectedByRank = rankedSelected.map((item) => item.sourceIndex);
    if (
      selectedByRank.some((item, index) => item !== value.selectedSourceIndexes[index]) ||
      value.selectedSourceIndexes.length !== selectedByRank.length ||
      rankedSelected.some((item, index) => item.selectedRank !== index + 1)
    ) {
      context.addIssue({ code: "custom", message: "Selected Candidate order differs." });
    }
    const expectedPartial = value.outcome === "partial";
    if (
      expectedPartial !== value.limitations.includes("source_graph_partial") ||
      (expectedPartial && value.diagnosticCode !== "source_graph_partial") ||
      (!expectedPartial && (value.diagnosticCode !== "completed" || value.limitations.length !== 0))
    ) {
      context.addIssue({ code: "custom", message: "Validation outcome is inconsistent." });
    }
  });
export type CandidateValidationReportV1 = z.infer<typeof CandidateValidationReportV1Schema>;

export const CandidateValidationRecordV1Schema = z.strictObject({
  schemaVersion: z.literal(CANDIDATE_VALIDATION_SCHEMA_VERSION),
  validationId: validationIdSchema,
  validationKey: validationKeySchema,
  runId: safeIdSchema,
  finalizationId: safeIdSchema,
  generationId: z.string().regex(/^gen_[0-9a-f]{48}$/u),
  sourceCandidateArtifactId: safeIdSchema,
  sourceCandidateFingerprint: sha256FingerprintSchema,
  evidenceGraphArtifactId: safeIdSchema,
  evidenceGraphInputFingerprint: sha256HexSchema,
  reportArtifactId: safeIdSchema,
  reportArtifactRole: validationReportRoleSchema,
  reportFingerprint: sha256FingerprintSchema,
  outcome: CandidateValidationOutcomeSchema,
  counts: CandidateValidationCountsV1Schema,
  sourceVersions: CandidateValidationSourceVersionsV1Schema,
  validatorVersion: z.literal(CANDIDATE_VALIDATOR_VERSION),
  supportPolicyVersion: z.literal(CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION),
  contradictionPolicyVersion: z.literal(CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION),
  absencePolicyVersion: z.literal(CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION),
  duplicatePolicyVersion: z.literal(CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION),
  rankingPolicyVersion: z.literal(CANDIDATE_VALIDATION_RANKING_POLICY_VERSION),
  selectionPolicyVersion: z.literal(CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION),
  createdAt: timestampSchema,
});
export type CandidateValidationRecordV1 = z.infer<typeof CandidateValidationRecordV1Schema>;

export const CandidateValidationResultV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CANDIDATE_VALIDATION_SCHEMA_VERSION),
    validatorVersion: z.literal(CANDIDATE_VALIDATOR_VERSION),
    supportPolicyVersion: z.literal(CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION),
    contradictionPolicyVersion: z.literal(CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION),
    absencePolicyVersion: z.literal(CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION),
    duplicatePolicyVersion: z.literal(CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION),
    rankingPolicyVersion: z.literal(CANDIDATE_VALIDATION_RANKING_POLICY_VERSION),
    selectionPolicyVersion: z.literal(CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION),
    outcome: CandidateValidationResultOutcomeSchema,
    diagnosticCode: CandidateValidationDiagnosticCodeSchema,
    limitations: z.array(CandidateValidationLimitationSchema),
    validationId: validationIdSchema.nullable(),
    validationKey: validationKeySchema.nullable(),
    runId: safeIdSchema,
    generationId: z.string().regex(/^gen_[0-9a-f]{48}$/u),
    sourceCandidateArtifactId: safeIdSchema.nullable(),
    sourceCandidateFingerprint: sha256FingerprintSchema.nullable(),
    evidenceGraphArtifactId: safeIdSchema.nullable(),
    evidenceGraphInputFingerprint: sha256HexSchema.nullable(),
    reportArtifactId: safeIdSchema.nullable(),
    reportFingerprint: sha256FingerprintSchema.nullable(),
    counts: CandidateValidationCountsV1Schema,
    selectedSourceIndexes: z.array(z.number().int().min(0).max(6)).max(7),
    sourceVersions: CandidateValidationSourceVersionsV1Schema.nullable(),
  })
  .superRefine((value, context) => {
    const hasReport =
      value.validationId !== null &&
      value.validationKey !== null &&
      value.sourceCandidateArtifactId !== null &&
      value.sourceCandidateFingerprint !== null &&
      value.evidenceGraphArtifactId !== null &&
      value.evidenceGraphInputFingerprint !== null &&
      value.reportArtifactId !== null &&
      value.reportFingerprint !== null &&
      value.sourceVersions !== null;
    if (value.outcome === "unavailable") {
      if (
        hasReport ||
        value.diagnosticCode !== "source_unavailable" ||
        value.limitations.length !== 0 ||
        value.counts.source !== 0 ||
        value.selectedSourceIndexes.length !== 0
      ) {
        context.addIssue({ code: "custom", message: "Unavailable validation contains output." });
      }
    } else {
      const partial = value.outcome === "partial";
      if (
        !hasReport ||
        value.selectedSourceIndexes.length !== value.counts.selected ||
        partial !== value.limitations.includes("source_graph_partial") ||
        (partial && value.diagnosticCode !== "source_graph_partial") ||
        (!partial && (value.diagnosticCode !== "completed" || value.limitations.length !== 0))
      ) {
        context.addIssue({ code: "custom", message: "Available validation is inconsistent." });
      }
    }
  });
export type CandidateValidationResultV1 = z.infer<typeof CandidateValidationResultV1Schema>;

export function parseCandidateValidationReportV1(input: unknown): CandidateValidationReportV1 {
  return CandidateValidationReportV1Schema.parse(input);
}

export function parseCandidateValidationResultV1(input: unknown): CandidateValidationResultV1 {
  return CandidateValidationResultV1Schema.parse(input);
}

export { CHANGE_CLASSIFICATION_LABELS };
