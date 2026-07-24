import { z } from "zod";

import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "./candidate-moment.js";
import {
  CHANGE_CLASSIFICATION_EVIDENCE_KINDS,
  CHANGE_CLASSIFICATION_LABELS,
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
} from "./change-classification.js";
import {
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_LIMITATIONS,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  EvidenceGraphLimitationSchema,
  EvidenceGraphOutcomeSchema,
  EvidenceIdSchema,
} from "./evidence-graph.js";
import {
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_OBSERVED_STATUSES,
  VERIFICATION_OUTPUT_FIELDS,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "./verification-evidence.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const safeControlledValueSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION = "0.1.0" as const;
export const SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION =
  "ownloop-semantic-input-reduction-v1" as const;
export const SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION =
  "ownloop-semantic-input-redaction-v1" as const;
export const SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION =
  "ownloop-byte-token-upper-bound-v1" as const;

export const SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES = 512 * 1024;
export const SEMANTIC_ANALYSIS_MAX_SUMMARIES = 2_000;
export const SEMANTIC_ANALYSIS_MAX_RELATIONS = 4_000;
export const SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS = 100;
export const SEMANTIC_ANALYSIS_MAX_BATCH = 25;
export const SEMANTIC_ANALYSIS_GOAL_MAX_CODE_POINTS = 4_000;
export const SEMANTIC_ANALYSIS_GOAL_MAX_BYTES = 16 * 1024;
export const SEMANTIC_ANALYSIS_EXCERPT_MAX_CODE_POINTS = 1_000;
export const SEMANTIC_ANALYSIS_EXCERPT_MAX_BYTES = 4 * 1024;

export const SEMANTIC_ANALYSIS_INPUT_OUTCOMES = ["ready", "partial", "unavailable"] as const;
export const SemanticAnalysisInputOutcomeSchema = z.enum(SEMANTIC_ANALYSIS_INPUT_OUTCOMES);
export type SemanticAnalysisInputOutcome = z.infer<typeof SemanticAnalysisInputOutcomeSchema>;

export const SEMANTIC_ANALYSIS_INPUT_DIAGNOSTIC_CODES = [
  "source_partial",
  "source_unavailable",
  "budget_truncated",
  "source_partial_and_budget_truncated",
] as const;
export const SemanticAnalysisInputDiagnosticCodeSchema = z.enum(
  SEMANTIC_ANALYSIS_INPUT_DIAGNOSTIC_CODES,
);
export type SemanticAnalysisInputDiagnosticCode = z.infer<
  typeof SemanticAnalysisInputDiagnosticCodeSchema
>;

export const SEMANTIC_ANALYSIS_LIMITATIONS = [
  ...EVIDENCE_GRAPH_LIMITATIONS,
  "budget_truncated",
] as const;
export const SemanticAnalysisLimitationSchema = z.union([
  EvidenceGraphLimitationSchema,
  z.literal("budget_truncated"),
]);
export type SemanticAnalysisLimitation = z.infer<typeof SemanticAnalysisLimitationSchema>;

export const SEMANTIC_ANALYSIS_REDACTION_KINDS = [
  "private_key",
  "bearer_credential",
  "provider_token",
  "secret_assignment",
  "absolute_path",
  "url",
  "email",
  "ip_address",
  "markup",
  "control_character",
] as const;
export const SemanticAnalysisRedactionKindSchema = z.enum(SEMANTIC_ANALYSIS_REDACTION_KINDS);
export type SemanticAnalysisRedactionKind = z.infer<typeof SemanticAnalysisRedactionKindSchema>;

export const SemanticAnalysisRedactionCountV1Schema = z.strictObject({
  kind: SemanticAnalysisRedactionKindSchema,
  count: z.number().int().positive().max(1_000_000),
});
export type SemanticAnalysisRedactionCountV1 = z.infer<
  typeof SemanticAnalysisRedactionCountV1Schema
>;

export const SemanticAnalysisSourceVersionsV1Schema = z.strictObject({
  changeClassification: z.strictObject({
    schemaVersion: z.literal(CHANGE_CLASSIFICATION_SCHEMA_VERSION),
    classifierVersion: z.literal(CHANGE_CLASSIFIER_VERSION),
    taxonomyVersion: z.literal(CHANGE_CLASSIFICATION_TAXONOMY_VERSION),
    ruleSetVersion: z.literal(CHANGE_CLASSIFICATION_RULE_SET_VERSION),
  }),
  verificationEvidence: z.strictObject({
    schemaVersion: z.literal(VERIFICATION_EVIDENCE_SCHEMA_VERSION),
    extractorVersion: z.literal(VERIFICATION_EXTRACTOR_VERSION),
    commandRuleSetVersion: z.literal(VERIFICATION_COMMAND_RULE_SET_VERSION),
    outputReductionPolicyVersion: z.literal(VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION),
  }),
  evidenceGraph: z.strictObject({
    schemaVersion: z.literal(EVIDENCE_GRAPH_SCHEMA_VERSION),
    builderVersion: z.literal(EVIDENCE_GRAPH_BUILDER_VERSION),
    taxonomyVersion: z.literal(EVIDENCE_GRAPH_TAXONOMY_VERSION),
  }),
});
export type SemanticAnalysisSourceVersionsV1 = z.infer<
  typeof SemanticAnalysisSourceVersionsV1Schema
>;

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }
  return length;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function containsDisallowedControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

const semanticPrivateKeyPattern = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/iu;
const semanticBearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu;
const semanticProviderTokenPattern =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/u;
const semanticSecretAssignmentPattern =
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret|private[_-]?key|credential)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/iu;
const semanticEmailPattern =
  /\b[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9-]{0,62}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,62}[A-Z0-9])?)+\b/iu;
const semanticSchemePattern =
  /(?:^|[^a-z0-9+.-])(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a|h\s*t\s*t\s*p\s*s?|f\s*t\s*p|f\s*i\s*l\s*e|m\s*a\s*i\s*l\s*t\s*o)\s*:/iu;
const semanticBareDomainPattern =
  /(?:^|[^a-z0-9._-])(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:com|org|net|io|dev|app|ai|co|me|info|biz|edu|gov|cloud|tech|site|online|shop|store|xyz|fr|de|uk|ir)(?=$|[^a-z0-9_-])/iu;
const semanticNavigableDomainPattern =
  /(?:^|[^a-z0-9._-])(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?::\d{1,5}|[/?#])[^\s<>"']*(?=$|[^a-z0-9_-])/iu;
const semanticLocalhostPattern =
  /(?:^|[^a-z0-9_])localhost(?::\d{1,5}(?:[/?#][^\s<>"']*)?|[/?#][^\s<>"']*)(?=$|[^a-z0-9_-])/iu;
const semanticIpv4Pattern =
  /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/u;
const semanticIpv6Pattern = /\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b/u;
const semanticWindowsPathPattern = /\b[A-Za-z]:[\\/]/u;
const semanticUncPathPattern = /\\\\[^\s\/<>:"|?*]+[\\/][^\s<>:"|?*]+/u;
const semanticPosixPathPattern =
  /(?<![A-Za-z0-9._-])\/(?:[^\s/<>"']+\/)*[^\s/<>"']+(?=$|[\s)"',.;:!?])/u;
const semanticPunctuationWhitespacePattern = /\s*([.:/?#@])\s*/gu;

function containsUnredactedSensitiveText(value: string): boolean {
  const compacted = value.replace(semanticPunctuationWhitespacePattern, "$1");
  return [value, compacted].some(
    (candidate) =>
      semanticPrivateKeyPattern.test(candidate) ||
      semanticBearerPattern.test(candidate) ||
      semanticProviderTokenPattern.test(candidate) ||
      semanticSecretAssignmentPattern.test(candidate) ||
      semanticEmailPattern.test(candidate) ||
      semanticSchemePattern.test(candidate) ||
      semanticBareDomainPattern.test(candidate) ||
      semanticNavigableDomainPattern.test(candidate) ||
      semanticLocalhostPattern.test(candidate) ||
      semanticIpv4Pattern.test(candidate) ||
      semanticIpv6Pattern.test(candidate) ||
      semanticWindowsPathPattern.test(candidate) ||
      semanticUncPathPattern.test(candidate) ||
      semanticPosixPathPattern.test(candidate),
  );
}

function orderedUniqueRedactionCounts(
  values: readonly SemanticAnalysisRedactionCountV1[],
): boolean {
  const expected = values.toSorted(
    (left, right) =>
      SEMANTIC_ANALYSIS_REDACTION_KINDS.indexOf(left.kind) -
      SEMANTIC_ANALYSIS_REDACTION_KINDS.indexOf(right.kind),
  );
  return (
    new Set(values.map((entry) => entry.kind)).size === values.length &&
    expected.every((entry, index) => entry.kind === values[index]?.kind)
  );
}

const boundedRedactedTextSchema = (maxCodePoints: number, maxBytes: number): z.ZodString =>
  z
    .string()
    .min(1)
    .superRefine((value, context) => {
      if (containsLoneSurrogate(value)) {
        context.addIssue({ code: "custom", message: "Semantic text contains invalid Unicode." });
      }
      if (value.normalize("NFC") !== value) {
        context.addIssue({ code: "custom", message: "Semantic text must be NFC-normalized." });
      }
      if (containsDisallowedControl(value)) {
        context.addIssue({
          code: "custom",
          message: "Semantic text contains a control character.",
        });
      }
      if (value.includes("<") || value.includes(">")) {
        context.addIssue({ code: "custom", message: "Semantic text contains markup delimiters." });
      }
      if (containsUnredactedSensitiveText(value)) {
        context.addIssue({
          code: "custom",
          message: "Semantic text contains unredacted sensitive material.",
        });
      }
      if (codePointLength(value) > maxCodePoints || utf8ByteLength(value) > maxBytes) {
        context.addIssue({ code: "custom", message: "Semantic text exceeds its size limit." });
      }
    });

const semanticAnalysisRedactedTextShape = {
  text: boundedRedactedTextSchema(
    SEMANTIC_ANALYSIS_GOAL_MAX_CODE_POINTS,
    SEMANTIC_ANALYSIS_GOAL_MAX_BYTES,
  ),
  sourceCodePointCount: z.number().int().nonnegative().max(10_000_000),
  sourceByteCount: z
    .number()
    .int()
    .nonnegative()
    .max(64 * 1024 * 1024),
  retainedCodePointCount: z.number().int().positive().max(SEMANTIC_ANALYSIS_GOAL_MAX_CODE_POINTS),
  retainedByteCount: z.number().int().positive().max(SEMANTIC_ANALYSIS_GOAL_MAX_BYTES),
  truncated: z.boolean(),
  redactions: z
    .array(SemanticAnalysisRedactionCountV1Schema)
    .max(SEMANTIC_ANALYSIS_REDACTION_KINDS.length),
} as const;

export const SemanticAnalysisRedactedTextV1Schema = z
  .strictObject(semanticAnalysisRedactedTextShape)
  .superRefine((value, context) => {
    if (
      value.retainedCodePointCount !== codePointLength(value.text) ||
      value.retainedByteCount !== utf8ByteLength(value.text) ||
      (value.truncated && !value.text.endsWith("[TRUNCATED]")) ||
      !orderedUniqueRedactionCounts(value.redactions)
    ) {
      context.addIssue({ code: "custom", message: "Semantic redacted-text metadata is invalid." });
    }
  });
export type SemanticAnalysisRedactedTextV1 = z.infer<typeof SemanticAnalysisRedactedTextV1Schema>;

export const SemanticAnalysisGoalV1Schema = z
  .strictObject({
    evidenceId: EvidenceIdSchema,
    ...semanticAnalysisRedactedTextShape,
  })
  .superRefine((value, context) => {
    if (
      value.retainedCodePointCount !== codePointLength(value.text) ||
      value.retainedByteCount !== utf8ByteLength(value.text) ||
      (value.truncated && !value.text.endsWith("[TRUNCATED]")) ||
      !orderedUniqueRedactionCounts(value.redactions)
    ) {
      context.addIssue({ code: "custom", message: "Semantic goal metadata is invalid." });
    }
  });
export type SemanticAnalysisGoalV1 = z.infer<typeof SemanticAnalysisGoalV1Schema>;

const supportingEvidenceIdsSchema = z
  .array(EvidenceIdSchema)
  .max(32)
  .superRefine((value, context) => {
    if (
      new Set(value).size !== value.length ||
      value.toSorted().some((entry, index) => entry !== value[index])
    ) {
      context.addIssue({ code: "custom", message: "Supporting Evidence IDs are invalid." });
    }
  });

const summaryBase = {
  evidenceId: EvidenceIdSchema,
  supportingEvidenceIds: supportingEvidenceIdsSchema,
} as const;

const RunSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("run"),
  terminalStatus: z.enum(["Completed", "Partial", "Abandoned", "Failed"]),
});
const FinalizationSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("finalization"),
  terminalStatus: z.enum(["Completed", "Partial", "Abandoned", "Failed"]),
  diagnosticCode: safeControlledValueSchema.nullable(),
});
const GraphLimitationSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("graph_limitation"),
  limitation: EvidenceGraphLimitationSchema,
});
const EvidenceGapSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("evidence_gap"),
  gapCode: safeControlledValueSchema,
});
const ArtifactSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("artifact"),
  artifactKind: safeControlledValueSchema,
});
const ChangedFileSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("changed_file"),
  changeKind: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
});
const ClassificationEntrySummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("classification_entry"),
});
const ClassificationLabelSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("classification_label"),
  label: z.enum(CHANGE_CLASSIFICATION_LABELS),
  confidenceBasisPoints: z.number().int().min(0).max(10_000),
});
const ClassificationRuleSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("classification_rule"),
  ruleId: safeControlledValueSchema,
  evidenceKind: z.enum(CHANGE_CLASSIFICATION_EVIDENCE_KINDS),
});
const VerificationSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("verification_observation"),
  verificationKind: z.enum(["test", "lint", "typecheck", "build"]),
  observedStatus: z.enum(VERIFICATION_OBSERVED_STATUSES),
});
const TestFileChangeSummarySchema = z.strictObject({
  ...summaryBase,
  kind: z.literal("test_file_change"),
});

export const SEMANTIC_ANALYSIS_SUMMARY_KINDS = [
  "run",
  "finalization",
  "graph_limitation",
  "evidence_gap",
  "artifact",
  "verification_observation",
  "changed_file",
  "classification_entry",
  "classification_label",
  "classification_rule",
  "test_file_change",
] as const;

export const SemanticAnalysisEvidenceSummaryV1Schema = z.discriminatedUnion("kind", [
  RunSummarySchema,
  FinalizationSummarySchema,
  GraphLimitationSummarySchema,
  EvidenceGapSummarySchema,
  ArtifactSummarySchema,
  ChangedFileSummarySchema,
  ClassificationEntrySummarySchema,
  ClassificationLabelSummarySchema,
  ClassificationRuleSummarySchema,
  VerificationSummarySchema,
  TestFileChangeSummarySchema,
]);
export type SemanticAnalysisEvidenceSummaryV1 = z.infer<
  typeof SemanticAnalysisEvidenceSummaryV1Schema
>;

export const SEMANTIC_ANALYSIS_RELATION_TYPES = [
  "run_has_gap",
  "run_contains",
  "run_materialized_artifact",
  "finalization_uses_reconciliation",
  "finalization_materialized_artifact",
  "changed_file_classified_by",
  "classification_assigned_label",
  "classification_supported_by_rule",
  "command_has_verification",
  "test_file_change_supported_by_classification",
] as const;
export const SemanticAnalysisRelationTypeSchema = z.enum(SEMANTIC_ANALYSIS_RELATION_TYPES);
export type SemanticAnalysisRelationType = z.infer<typeof SemanticAnalysisRelationTypeSchema>;

export const SemanticAnalysisEvidenceRelationV1Schema = z.strictObject({
  type: SemanticAnalysisRelationTypeSchema,
  sourceEvidenceId: EvidenceIdSchema,
  targetEvidenceId: EvidenceIdSchema,
});
export type SemanticAnalysisEvidenceRelationV1 = z.infer<
  typeof SemanticAnalysisEvidenceRelationV1Schema
>;

export const SemanticAnalysisVerificationExcerptV1Schema = z
  .strictObject({
    evidenceId: EvidenceIdSchema,
    verificationKind: z.enum(["test", "lint", "typecheck", "build"]),
    observedStatus: z.enum(VERIFICATION_OBSERVED_STATUSES),
    field: z.enum(VERIFICATION_OUTPUT_FIELDS),
    text: boundedRedactedTextSchema(
      SEMANTIC_ANALYSIS_EXCERPT_MAX_CODE_POINTS,
      SEMANTIC_ANALYSIS_EXCERPT_MAX_BYTES,
    ),
    sourceCodePointCount: z.number().int().nonnegative().max(10_000_000),
    sourceByteCount: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    retainedCodePointCount: z
      .number()
      .int()
      .positive()
      .max(SEMANTIC_ANALYSIS_EXCERPT_MAX_CODE_POINTS),
    retainedByteCount: z.number().int().positive().max(SEMANTIC_ANALYSIS_EXCERPT_MAX_BYTES),
    sourceTruncated: z.boolean(),
    truncated: z.boolean(),
    redactions: z
      .array(SemanticAnalysisRedactionCountV1Schema)
      .max(SEMANTIC_ANALYSIS_REDACTION_KINDS.length),
  })
  .superRefine((value, context) => {
    if (
      value.retainedCodePointCount !== codePointLength(value.text) ||
      value.retainedByteCount !== utf8ByteLength(value.text) ||
      (value.truncated && !value.text.endsWith("[TRUNCATED]")) ||
      !orderedUniqueRedactionCounts(value.redactions)
    ) {
      context.addIssue({ code: "custom", message: "Verification excerpt metadata is invalid." });
    }
  });
export type SemanticAnalysisVerificationExcerptV1 = z.infer<
  typeof SemanticAnalysisVerificationExcerptV1Schema
>;

export const SemanticAnalysisAggregateV1Schema = z.strictObject({
  summaryCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_SUMMARIES),
  relationCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_RELATIONS),
  verificationExcerptCount: z
    .number()
    .int()
    .nonnegative()
    .max(SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS),
  droppedSummaryCount: z.number().int().nonnegative().max(100_000),
  droppedRelationCount: z.number().int().nonnegative().max(100_000),
  droppedVerificationExcerptCount: z.number().int().nonnegative().max(100_000),
  redactions: z
    .array(SemanticAnalysisRedactionCountV1Schema)
    .max(SEMANTIC_ANALYSIS_REDACTION_KINDS.length),
});
export type SemanticAnalysisAggregateV1 = z.infer<typeof SemanticAnalysisAggregateV1Schema>;

export const SemanticAnalysisEstimateV1Schema = z.strictObject({
  utf8ByteCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES),
  modelVisibleTextCodePointCount: z.number().int().nonnegative().max(10_000_000),
  inputTokenUpperBound: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES),
  monetaryEstimateStatus: z.literal("provider_not_selected"),
});
export type SemanticAnalysisEstimateV1 = z.infer<typeof SemanticAnalysisEstimateV1Schema>;

export const SemanticAnalysisGraphContextV1Schema = z.strictObject({
  outcome: EvidenceGraphOutcomeSchema,
  limitations: z.array(EvidenceGraphLimitationSchema).max(EVIDENCE_GRAPH_LIMITATIONS.length),
  runEvidenceId: EvidenceIdSchema.nullable(),
});
export type SemanticAnalysisGraphContextV1 = z.infer<typeof SemanticAnalysisGraphContextV1Schema>;

function summarySortKey(value: SemanticAnalysisEvidenceSummaryV1): string {
  const suffix =
    value.kind === "graph_limitation"
      ? value.limitation
      : value.kind === "classification_label"
        ? value.label
        : value.kind === "classification_rule"
          ? value.ruleId
          : "";
  return `${String(SEMANTIC_ANALYSIS_SUMMARY_KINDS.indexOf(value.kind)).padStart(2, "0")}:${value.evidenceId}:${suffix}`;
}

function relationSortKey(value: SemanticAnalysisEvidenceRelationV1): string {
  return `${String(SEMANTIC_ANALYSIS_RELATION_TYPES.indexOf(value.type)).padStart(2, "0")}:${value.sourceEvidenceId}:${value.targetEvidenceId}`;
}

function excerptSortKey(value: SemanticAnalysisVerificationExcerptV1): string {
  return `${value.evidenceId}:${String(VERIFICATION_OUTPUT_FIELDS.indexOf(value.field)).padStart(2, "0")}`;
}

function combinedRedactionCounts(
  goal: SemanticAnalysisGoalV1 | null,
  excerpts: readonly SemanticAnalysisVerificationExcerptV1[],
): SemanticAnalysisRedactionCountV1[] {
  const counts = new Map<SemanticAnalysisRedactionKind, number>();
  for (const entry of [
    ...(goal?.redactions ?? []),
    ...excerpts.flatMap((excerpt) => excerpt.redactions),
  ]) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + entry.count);
  }
  return SEMANTIC_ANALYSIS_REDACTION_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [{ kind, count }];
  });
}

export const DeterministicSemanticAnalysisInputV1Schema = z
  .strictObject({
    schemaVersion: z.literal(SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION),
    builderVersion: safeVersionSchema,
    reductionPolicyVersion: safeVersionSchema,
    redactionPolicyVersion: safeVersionSchema,
    tokenEstimatorVersion: safeVersionSchema,
    targetCandidateMomentSchemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    classificationArtifactId: safeIdSchema,
    classificationInputFingerprint: sha256HexSchema,
    evidenceGraphArtifactId: safeIdSchema,
    evidenceGraphInputFingerprint: sha256HexSchema,
    verificationArtifactId: safeIdSchema,
    verificationInputFingerprint: sha256HexSchema,
    sourceVersions: SemanticAnalysisSourceVersionsV1Schema,
    graphContext: SemanticAnalysisGraphContextV1Schema,
    outcome: SemanticAnalysisInputOutcomeSchema,
    diagnosticCode: SemanticAnalysisInputDiagnosticCodeSchema.nullable(),
    limitations: z
      .array(SemanticAnalysisLimitationSchema)
      .max(SEMANTIC_ANALYSIS_LIMITATIONS.length),
    inputFingerprint: sha256HexSchema,
    goal: SemanticAnalysisGoalV1Schema.nullable(),
    evidenceSummaries: z
      .array(SemanticAnalysisEvidenceSummaryV1Schema)
      .max(SEMANTIC_ANALYSIS_MAX_SUMMARIES),
    evidenceRelations: z
      .array(SemanticAnalysisEvidenceRelationV1Schema)
      .max(SEMANTIC_ANALYSIS_MAX_RELATIONS),
    verificationExcerpts: z
      .array(SemanticAnalysisVerificationExcerptV1Schema)
      .max(SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS),
    aggregates: SemanticAnalysisAggregateV1Schema,
    estimates: SemanticAnalysisEstimateV1Schema,
  })
  .superRefine((value, context) => {
    if (
      value.builderVersion !== SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION ||
      value.reductionPolicyVersion !== SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION ||
      value.redactionPolicyVersion !== SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION ||
      value.tokenEstimatorVersion !== SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION
    ) {
      context.addIssue({ code: "custom", message: "Unsupported semantic-input version." });
    }

    const orderedLimitations = SEMANTIC_ANALYSIS_LIMITATIONS.filter((entry) =>
      value.limitations.includes(entry),
    );
    if (
      new Set(value.limitations).size !== value.limitations.length ||
      orderedLimitations.some((entry, index) => entry !== value.limitations[index])
    ) {
      context.addIssue({ code: "custom", message: "Semantic limitations are invalid." });
    }
    if (
      new Set(value.graphContext.limitations).size !== value.graphContext.limitations.length ||
      EVIDENCE_GRAPH_LIMITATIONS.filter((entry) =>
        value.graphContext.limitations.includes(entry),
      ).some((entry, index) => entry !== value.graphContext.limitations[index])
    ) {
      context.addIssue({ code: "custom", message: "Graph limitations are invalid." });
    }

    const budgetTruncated = value.limitations.includes("budget_truncated");
    const sourcePartial = value.graphContext.outcome === "partial";
    const outcomeValid =
      (value.outcome === "ready" &&
        value.diagnosticCode === null &&
        value.graphContext.outcome === "complete" &&
        value.limitations.length === 0 &&
        value.goal !== null &&
        value.graphContext.runEvidenceId !== null) ||
      (value.outcome === "partial" &&
        value.goal !== null &&
        value.graphContext.runEvidenceId !== null &&
        ((sourcePartial && !budgetTruncated && value.diagnosticCode === "source_partial") ||
          (!sourcePartial && budgetTruncated && value.diagnosticCode === "budget_truncated") ||
          (sourcePartial &&
            budgetTruncated &&
            value.diagnosticCode === "source_partial_and_budget_truncated"))) ||
      (value.outcome === "unavailable" &&
        value.diagnosticCode === "source_unavailable" &&
        value.graphContext.outcome === "unavailable" &&
        value.graphContext.runEvidenceId === null &&
        value.goal === null &&
        value.evidenceSummaries.length === 0 &&
        value.evidenceRelations.length === 0 &&
        value.verificationExcerpts.length === 0);
    if (!outcomeValid) {
      context.addIssue({ code: "custom", message: "Semantic-input outcome is inconsistent." });
    }
    if (
      value.goal !== null &&
      value.graphContext.runEvidenceId !== null &&
      value.goal.evidenceId !== value.graphContext.runEvidenceId
    ) {
      context.addIssue({ code: "custom", message: "Goal Evidence ID is inconsistent." });
    }

    const summaryKeys = value.evidenceSummaries.map(summarySortKey);
    const relationKeys = value.evidenceRelations.map(relationSortKey);
    const excerptKeys = value.verificationExcerpts.map(excerptSortKey);
    if (
      new Set(summaryKeys).size !== summaryKeys.length ||
      summaryKeys.toSorted().some((entry, index) => entry !== summaryKeys[index]) ||
      new Set(relationKeys).size !== relationKeys.length ||
      relationKeys.toSorted().some((entry, index) => entry !== relationKeys[index]) ||
      new Set(excerptKeys).size !== excerptKeys.length ||
      excerptKeys.toSorted().some((entry, index) => entry !== excerptKeys[index])
    ) {
      context.addIssue({ code: "custom", message: "Semantic items are not canonical." });
    }
    for (const relation of value.evidenceRelations) {
      if (relation.sourceEvidenceId === relation.targetEvidenceId) {
        context.addIssue({ code: "custom", message: "Semantic self-relations are invalid." });
      }
    }

    if (value.outcome !== "unavailable") {
      const runSummaries = value.evidenceSummaries.filter((summary) => summary.kind === "run");
      const finalizationSummaries = value.evidenceSummaries.filter(
        (summary) => summary.kind === "finalization",
      );
      if (
        runSummaries.length !== 1 ||
        finalizationSummaries.length !== 1 ||
        runSummaries[0]?.evidenceId !== value.graphContext.runEvidenceId ||
        runSummaries[0]?.terminalStatus !== finalizationSummaries[0]?.terminalStatus
      ) {
        context.addIssue({
          code: "custom",
          message: "Run and finalization summaries are invalid.",
        });
      }
      const verificationSummaries = value.evidenceSummaries.filter(
        (
          summary,
        ): summary is Extract<
          SemanticAnalysisEvidenceSummaryV1,
          { kind: "verification_observation" }
        > => summary.kind === "verification_observation",
      );
      for (const excerpt of value.verificationExcerpts) {
        const summary = verificationSummaries.find(
          (candidate) => candidate.evidenceId === excerpt.evidenceId,
        );
        if (
          summary === undefined ||
          summary.verificationKind !== excerpt.verificationKind ||
          summary.observedStatus !== excerpt.observedStatus
        ) {
          context.addIssue({ code: "custom", message: "Verification excerpt summary is invalid." });
        }
      }
    }

    const modelVisibleTextCodePointCount =
      (value.goal === null ? 0 : codePointLength(value.goal.text)) +
      value.verificationExcerpts.reduce(
        (total, excerpt) => total + codePointLength(excerpt.text),
        0,
      );
    const expectedRedactions = combinedRedactionCounts(value.goal, value.verificationExcerpts);
    const droppedAny =
      value.aggregates.droppedSummaryCount > 0 ||
      value.aggregates.droppedRelationCount > 0 ||
      value.aggregates.droppedVerificationExcerptCount > 0;
    const graphLimitations = value.limitations.filter((entry) => entry !== "budget_truncated");
    if (
      value.aggregates.summaryCount !== value.evidenceSummaries.length ||
      value.aggregates.relationCount !== value.evidenceRelations.length ||
      value.aggregates.verificationExcerptCount !== value.verificationExcerpts.length ||
      !orderedUniqueRedactionCounts(value.aggregates.redactions) ||
      JSON.stringify(value.aggregates.redactions) !== JSON.stringify(expectedRedactions) ||
      droppedAny !== budgetTruncated ||
      JSON.stringify(graphLimitations) !== JSON.stringify(value.graphContext.limitations) ||
      value.estimates.modelVisibleTextCodePointCount !== modelVisibleTextCodePointCount ||
      value.estimates.inputTokenUpperBound !== value.estimates.utf8ByteCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Semantic aggregates or estimates are invalid.",
      });
    }
    if (
      value.outcome === "unavailable" &&
      (value.aggregates.summaryCount !== 0 ||
        value.aggregates.relationCount !== 0 ||
        value.aggregates.verificationExcerptCount !== 0 ||
        value.estimates.utf8ByteCount !== 0 ||
        value.estimates.modelVisibleTextCodePointCount !== 0 ||
        value.estimates.inputTokenUpperBound !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable semantic input has retained data.",
      });
    }
  });
export type DeterministicSemanticAnalysisInputV1 = z.infer<
  typeof DeterministicSemanticAnalysisInputV1Schema
>;

export const SEMANTIC_ANALYSIS_RESULT_OUTCOMES = [
  "disabled",
  "ready",
  "partial",
  "unavailable",
] as const;
export const SemanticAnalysisInputResultOutcomeSchema = z.enum(SEMANTIC_ANALYSIS_RESULT_OUTCOMES);
export type SemanticAnalysisInputResultOutcome = z.infer<
  typeof SemanticAnalysisInputResultOutcomeSchema
>;

export const SemanticAnalysisInputResultV1Schema = z
  .strictObject({
    schemaVersion: z.literal(SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION),
    builderVersion: safeVersionSchema,
    reductionPolicyVersion: safeVersionSchema,
    redactionPolicyVersion: safeVersionSchema,
    tokenEstimatorVersion: safeVersionSchema,
    targetCandidateMomentSchemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
    runId: safeIdSchema,
    outcome: SemanticAnalysisInputResultOutcomeSchema,
    diagnosticCode: z
      .union([SemanticAnalysisInputDiagnosticCodeSchema, z.literal("disabled")])
      .nullable(),
    limitations: z
      .array(SemanticAnalysisLimitationSchema)
      .max(SEMANTIC_ANALYSIS_LIMITATIONS.length),
    artifactId: safeIdSchema.nullable(),
    inputFingerprint: sha256HexSchema.nullable(),
    summaryCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_SUMMARIES),
    relationCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_RELATIONS),
    verificationExcerptCount: z
      .number()
      .int()
      .nonnegative()
      .max(SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS),
    utf8ByteCount: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES),
    modelVisibleTextCodePointCount: z.number().int().nonnegative().max(10_000_000),
    inputTokenUpperBound: z.number().int().nonnegative().max(SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES),
    monetaryEstimateStatus: z.literal("provider_not_selected"),
  })
  .superRefine((value, context) => {
    if (
      value.builderVersion !== SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION ||
      value.reductionPolicyVersion !== SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION ||
      value.redactionPolicyVersion !== SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION ||
      value.tokenEstimatorVersion !== SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION
    ) {
      context.addIssue({ code: "custom", message: "Unsupported semantic result version." });
    }
    const hasArtifact = value.artifactId !== null && value.inputFingerprint !== null;
    const empty =
      value.summaryCount === 0 &&
      value.relationCount === 0 &&
      value.verificationExcerptCount === 0 &&
      value.utf8ByteCount === 0 &&
      value.modelVisibleTextCodePointCount === 0 &&
      value.inputTokenUpperBound === 0;
    const valid =
      (value.outcome === "disabled" &&
        value.diagnosticCode === "disabled" &&
        !hasArtifact &&
        value.limitations.length === 0 &&
        empty) ||
      (value.outcome === "unavailable" &&
        value.diagnosticCode === "source_unavailable" &&
        !hasArtifact &&
        empty) ||
      ((value.outcome === "ready" || value.outcome === "partial") &&
        hasArtifact &&
        !empty &&
        ((value.outcome === "ready" && value.diagnosticCode === null) ||
          (value.outcome === "partial" && value.diagnosticCode !== null)));
    if (!valid) {
      context.addIssue({ code: "custom", message: "Semantic result outcome is inconsistent." });
    }
  });
export type SemanticAnalysisInputResultV1 = z.infer<typeof SemanticAnalysisInputResultV1Schema>;

export function parseDeterministicSemanticAnalysisInputV1(
  input: unknown,
): DeterministicSemanticAnalysisInputV1 {
  return DeterministicSemanticAnalysisInputV1Schema.parse(input);
}

export function parseSemanticAnalysisInputResultV1(input: unknown): SemanticAnalysisInputResultV1 {
  return SemanticAnalysisInputResultV1Schema.parse(input);
}
