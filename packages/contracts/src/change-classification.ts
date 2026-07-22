import { z } from "zod";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const safeRuleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const CHANGE_CLASSIFICATION_SCHEMA_VERSION = 1 as const;
export const CHANGE_CLASSIFIER_VERSION = "0.1.0" as const;
export const CHANGE_CLASSIFICATION_TAXONOMY_VERSION = "ownloop-change-taxonomy-v1" as const;
export const CHANGE_CLASSIFICATION_RULE_SET_VERSION = "ownloop-node-ts-path-rules-v1" as const;
export const CHANGE_CLASSIFICATION_MAX_ENTRIES = 2000;
export const CHANGE_CLASSIFICATION_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export const CHANGE_CLASSIFICATION_LABELS = [
  "ui",
  "behavior",
  "tests",
  "dependency",
  "authentication_authorization",
  "public_api",
  "database_migration",
  "configuration_infrastructure",
  "documentation",
  "unknown",
] as const;
export const ChangeClassificationLabelSchema = z.enum(CHANGE_CLASSIFICATION_LABELS);
export type ChangeClassificationLabel = z.infer<typeof ChangeClassificationLabelSchema>;

export const CHANGE_CLASSIFICATION_OUTCOMES = ["classified", "partial", "unavailable"] as const;
export const ChangeClassificationOutcomeSchema = z.enum(CHANGE_CLASSIFICATION_OUTCOMES);
export type ChangeClassificationOutcome = z.infer<typeof ChangeClassificationOutcomeSchema>;

export const CHANGE_CLASSIFICATION_DIAGNOSTIC_CODES = [
  "reconciliation_partial",
  "reconciliation_unavailable",
] as const;
export const ChangeClassificationDiagnosticCodeSchema = z.enum(
  CHANGE_CLASSIFICATION_DIAGNOSTIC_CODES,
);
export type ChangeClassificationDiagnosticCode = z.infer<
  typeof ChangeClassificationDiagnosticCodeSchema
>;

export const CHANGE_CLASSIFICATION_EVIDENCE_KINDS = [
  "exact_filename",
  "extension",
  "path_segment",
  "path_pattern",
  "fallback",
] as const;
export const ChangeClassificationEvidenceKindSchema = z.enum(CHANGE_CLASSIFICATION_EVIDENCE_KINDS);
export type ChangeClassificationEvidenceKind = z.infer<
  typeof ChangeClassificationEvidenceKindSchema
>;

export const ChangeClassificationRuleEvidenceV1Schema = z.strictObject({
  ruleId: safeRuleIdSchema,
  kind: ChangeClassificationEvidenceKindSchema,
});
export type ChangeClassificationRuleEvidenceV1 = z.infer<
  typeof ChangeClassificationRuleEvidenceV1Schema
>;

export const ChangeClassificationAssignedLabelV1Schema = z
  .strictObject({
    label: ChangeClassificationLabelSchema,
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    evidence: z.array(ChangeClassificationRuleEvidenceV1Schema).min(1).max(32),
  })
  .superRefine((value, context) => {
    const sortedRuleIds = value.evidence.map((entry) => entry.ruleId).toSorted();
    if (sortedRuleIds.some((ruleId, index) => ruleId !== value.evidence[index]?.ruleId)) {
      context.addIssue({ code: "custom", message: "Classification evidence must be sorted." });
    }
    if (new Set(sortedRuleIds).size !== sortedRuleIds.length) {
      context.addIssue({ code: "custom", message: "Classification evidence must be unique." });
    }
    if (value.label === "unknown") {
      if (
        value.confidenceBasisPoints !== 0 ||
        value.evidence.length !== 1 ||
        value.evidence[0]?.ruleId !== "fallback.no_supported_rule" ||
        value.evidence[0]?.kind !== "fallback"
      ) {
        context.addIssue({ code: "custom", message: "Unknown classification is invalid." });
      }
    } else {
      if (value.confidenceBasisPoints === 0) {
        context.addIssue({
          code: "custom",
          message: "Supported labels require positive confidence.",
        });
      }
      if (value.evidence.some((entry) => entry.kind === "fallback")) {
        context.addIssue({
          code: "custom",
          message: "Supported labels cannot use fallback evidence.",
        });
      }
    }
  });
export type ChangeClassificationAssignedLabelV1 = z.infer<
  typeof ChangeClassificationAssignedLabelV1Schema
>;

export const ChangeClassificationEntryV1Schema = z
  .strictObject({
    entryIndex: z.number().int().nonnegative(),
    fileEventId: safeIdSchema,
    changeKind: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]),
    attribution: z.enum(["run_relative", "observed_only", "unavailable"]),
    sensitivity: z.enum(["normal", "secret"]),
    labels: z.array(ChangeClassificationAssignedLabelV1Schema).min(1).max(10),
  })
  .superRefine((value, context) => {
    const labels = value.labels.map((entry) => entry.label);
    const sorted = labels.toSorted(
      (left, right) =>
        CHANGE_CLASSIFICATION_LABELS.indexOf(left) - CHANGE_CLASSIFICATION_LABELS.indexOf(right),
    );
    if (sorted.some((label, index) => label !== labels[index])) {
      context.addIssue({ code: "custom", message: "Classification labels must be sorted." });
    }
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Classification labels must be unique." });
    }
    if (labels.includes("unknown") && labels.length !== 1) {
      context.addIssue({ code: "custom", message: "Unknown cannot accompany supported labels." });
    }
  });
export type ChangeClassificationEntryV1 = z.infer<typeof ChangeClassificationEntryV1Schema>;

export const ChangeClassificationAggregateLabelV1Schema = z.strictObject({
  label: ChangeClassificationLabelSchema,
  entryCount: z.number().int().positive(),
  maximumConfidenceBasisPoints: z.number().int().min(0).max(10_000),
});
export type ChangeClassificationAggregateLabelV1 = z.infer<
  typeof ChangeClassificationAggregateLabelV1Schema
>;

export const DeterministicChangeClassificationV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CHANGE_CLASSIFICATION_SCHEMA_VERSION),
    classifierVersion: safeVersionSchema,
    taxonomyVersion: safeVersionSchema,
    ruleSetVersion: safeVersionSchema,
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    reconciliationId: safeIdSchema.nullable(),
    outcome: ChangeClassificationOutcomeSchema,
    diagnosticCode: ChangeClassificationDiagnosticCodeSchema.nullable(),
    inputFingerprint: sha256HexSchema,
    entries: z.array(ChangeClassificationEntryV1Schema).max(CHANGE_CLASSIFICATION_MAX_ENTRIES),
    aggregateLabels: z.array(ChangeClassificationAggregateLabelV1Schema).max(10),
  })
  .superRefine((value, context) => {
    if (value.classifierVersion !== CHANGE_CLASSIFIER_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported classifier version." });
    }
    if (value.taxonomyVersion !== CHANGE_CLASSIFICATION_TAXONOMY_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported taxonomy version." });
    }
    if (value.ruleSetVersion !== CHANGE_CLASSIFICATION_RULE_SET_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported rule-set version." });
    }
    const outcomeValid =
      (value.outcome === "classified" &&
        value.reconciliationId !== null &&
        value.diagnosticCode === null) ||
      (value.outcome === "partial" &&
        value.reconciliationId !== null &&
        value.diagnosticCode === "reconciliation_partial") ||
      (value.outcome === "unavailable" &&
        value.reconciliationId === null &&
        value.diagnosticCode === "reconciliation_unavailable" &&
        value.entries.length === 0);
    if (!outcomeValid) {
      context.addIssue({ code: "custom", message: "Classification outcome is inconsistent." });
    }
    if (value.entries.some((entry, index) => entry.entryIndex !== index)) {
      context.addIssue({
        code: "custom",
        message: "Classification entry indices must be contiguous.",
      });
    }
    const fileEventIds = value.entries.map((entry) => entry.fileEventId);
    if (new Set(fileEventIds).size !== fileEventIds.length) {
      context.addIssue({ code: "custom", message: "Classification file Events must be unique." });
    }
    const aggregateLabels = value.aggregateLabels.map((entry) => entry.label);
    const sortedAggregates = aggregateLabels.toSorted(
      (left, right) =>
        CHANGE_CLASSIFICATION_LABELS.indexOf(left) - CHANGE_CLASSIFICATION_LABELS.indexOf(right),
    );
    if (sortedAggregates.some((label, index) => label !== aggregateLabels[index])) {
      context.addIssue({ code: "custom", message: "Aggregate labels must be sorted." });
    }
    if (new Set(aggregateLabels).size !== aggregateLabels.length) {
      context.addIssue({ code: "custom", message: "Aggregate labels must be unique." });
    }
    const expectedAggregates = new Map<
      ChangeClassificationLabel,
      { entryCount: number; maximumConfidenceBasisPoints: number }
    >();
    for (const entry of value.entries) {
      for (const assigned of entry.labels) {
        const current = expectedAggregates.get(assigned.label);
        if (current === undefined) {
          expectedAggregates.set(assigned.label, {
            entryCount: 1,
            maximumConfidenceBasisPoints: assigned.confidenceBasisPoints,
          });
        } else {
          current.entryCount += 1;
          current.maximumConfidenceBasisPoints = Math.max(
            current.maximumConfidenceBasisPoints,
            assigned.confidenceBasisPoints,
          );
        }
      }
    }
    if (expectedAggregates.size !== value.aggregateLabels.length) {
      context.addIssue({ code: "custom", message: "Aggregate classification counts are invalid." });
    } else {
      for (const aggregate of value.aggregateLabels) {
        const expected = expectedAggregates.get(aggregate.label);
        if (
          expected === undefined ||
          expected.entryCount !== aggregate.entryCount ||
          expected.maximumConfidenceBasisPoints !== aggregate.maximumConfidenceBasisPoints
        ) {
          context.addIssue({
            code: "custom",
            message: "Aggregate classification values are inconsistent with entries.",
          });
          break;
        }
      }
    }
  });
export type DeterministicChangeClassificationV1 = z.infer<
  typeof DeterministicChangeClassificationV1Schema
>;
