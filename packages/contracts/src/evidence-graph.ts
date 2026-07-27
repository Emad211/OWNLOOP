import {
  CHANGE_CLASSIFICATION_EVIDENCE_KINDS,
  CHANGE_CLASSIFICATION_LABELS,
} from "./change-classification.js";
import { VERIFICATION_KINDS, VERIFICATION_OBSERVED_STATUSES } from "./verification-evidence.js";
import { z } from "zod";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const safeRuleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const EVIDENCE_GRAPH_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_GRAPH_BUILDER_VERSION = "0.1.0" as const;
export const EVIDENCE_GRAPH_TAXONOMY_VERSION = "ownloop-evidence-graph-v1" as const;
export const EVIDENCE_GRAPH_MAX_NODES = 25_000;
export const EVIDENCE_GRAPH_MAX_EDGES = 50_000;
export const EVIDENCE_GRAPH_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export const EVIDENCE_GRAPH_OUTCOMES = ["complete", "partial", "unavailable"] as const;
export const EvidenceGraphOutcomeSchema = z.enum(EVIDENCE_GRAPH_OUTCOMES);
export type EvidenceGraphOutcome = z.infer<typeof EvidenceGraphOutcomeSchema>;

export const EVIDENCE_GRAPH_LIMITATIONS = [
  "diff_hunks_not_retained",
  "final_manifest_unavailable",
  "classification_partial",
  "classification_unavailable",
  "verification_partial",
  "verification_unavailable",
  "evidence_gaps_present",
] as const;
export const EvidenceGraphLimitationSchema = z.enum(EVIDENCE_GRAPH_LIMITATIONS);
export type EvidenceGraphLimitation = z.infer<typeof EvidenceGraphLimitationSchema>;

export const EVIDENCE_GRAPH_DIAGNOSTIC_CODES = ["source_partial", "source_unavailable"] as const;
export const EvidenceGraphDiagnosticCodeSchema = z.enum(EVIDENCE_GRAPH_DIAGNOSTIC_CODES);
export type EvidenceGraphDiagnosticCode = z.infer<typeof EvidenceGraphDiagnosticCodeSchema>;

export const EVIDENCE_NODE_KINDS = [
  "run",
  "event",
  "baseline",
  "reconciliation",
  "changed_file",
  "evidence_gap",
  "finalization",
  "artifact",
  "classification_entry",
  "classification_label",
  "classification_rule",
  "command_observation",
  "verification_observation",
  "test_file_change",
] as const;
export const EvidenceNodeKindSchema = z.enum(EVIDENCE_NODE_KINDS);
export type EvidenceNodeKind = z.infer<typeof EvidenceNodeKindSchema>;

export const EVIDENCE_EDGE_TYPES = [
  "run_contains",
  "normalized_with",
  "baseline_recorded_by",
  "reconciliation_triggered_by",
  "reconciliation_summarized_by",
  "reconciliation_observed_file",
  "changed_file_emitted_event",
  "finalization_triggered_by",
  "finalization_uses_reconciliation",
  "finalization_emitted_event",
  "finalization_materialized_artifact",
  "run_has_gap",
  "changed_file_classified_by",
  "classification_assigned_label",
  "classification_supported_by_rule",
  "command_observed_from_event",
  "command_emitted_event",
  "command_has_verification",
  "verification_emitted_event",
  "test_file_change_supported_by_classification",
  "run_materialized_artifact",
] as const;
export const EvidenceEdgeTypeSchema = z.enum(EVIDENCE_EDGE_TYPES);
export type EvidenceEdgeType = z.infer<typeof EvidenceEdgeTypeSchema>;

export const EvidenceIdSchema = z.string().regex(/^ev_[0-9a-f]{48}$/u);
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export const EvidenceEdgeIdSchema = z.string().regex(/^ed_[0-9a-f]{48}$/u);
export type EvidenceEdgeId = z.infer<typeof EvidenceEdgeIdSchema>;

const RunLocatorSchema = z.strictObject({ kind: z.literal("run"), runId: safeIdSchema });
const EventLocatorSchema = z.strictObject({ kind: z.literal("event"), eventId: safeIdSchema });
const BaselineLocatorSchema = z.strictObject({
  kind: z.literal("baseline"),
  baselineId: safeIdSchema,
});
const ReconciliationLocatorSchema = z.strictObject({
  kind: z.literal("reconciliation"),
  reconciliationId: safeIdSchema,
});
const ChangedFileLocatorSchema = z.strictObject({
  kind: z.literal("changed_file"),
  reconciliationId: safeIdSchema,
  entryIndex: z.number().int().nonnegative(),
  fileEventId: safeIdSchema,
});
const EvidenceGapLocatorSchema = z.strictObject({
  kind: z.literal("evidence_gap"),
  gapId: safeIdSchema,
});
const FinalizationLocatorSchema = z.strictObject({
  kind: z.literal("finalization"),
  finalizationId: safeIdSchema,
});
const ArtifactLocatorSchema = z.strictObject({
  kind: z.literal("artifact"),
  artifactId: safeIdSchema,
  role: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
});
const ClassificationEntryLocatorSchema = z.strictObject({
  kind: z.literal("classification_entry"),
  artifactId: safeIdSchema,
  entryIndex: z.number().int().nonnegative(),
  fileEventId: safeIdSchema,
});
const ClassificationLabelLocatorSchema = z.strictObject({
  kind: z.literal("classification_label"),
  artifactId: safeIdSchema,
  entryIndex: z.number().int().nonnegative(),
  label: z.enum(CHANGE_CLASSIFICATION_LABELS),
});
const ClassificationRuleLocatorSchema = z.strictObject({
  kind: z.literal("classification_rule"),
  artifactId: safeIdSchema,
  ruleId: safeRuleIdSchema,
});
const CommandObservationLocatorSchema = z.strictObject({
  kind: z.literal("command_observation"),
  artifactId: safeIdSchema,
  observationIndex: z.number().int().nonnegative(),
  sourceEventId: safeIdSchema,
});
const VerificationObservationLocatorSchema = z.strictObject({
  kind: z.literal("verification_observation"),
  artifactId: safeIdSchema,
  observationIndex: z.number().int().nonnegative(),
  verificationKind: z.enum(["test", "lint", "typecheck", "build"]),
});
const TestFileChangeLocatorSchema = z.strictObject({
  kind: z.literal("test_file_change"),
  artifactId: safeIdSchema,
  entryIndex: z.number().int().nonnegative(),
  fileEventId: safeIdSchema,
});

export const EvidenceNodeLocatorV1Schema = z.discriminatedUnion("kind", [
  RunLocatorSchema,
  EventLocatorSchema,
  BaselineLocatorSchema,
  ReconciliationLocatorSchema,
  ChangedFileLocatorSchema,
  EvidenceGapLocatorSchema,
  FinalizationLocatorSchema,
  ArtifactLocatorSchema,
  ClassificationEntryLocatorSchema,
  ClassificationLabelLocatorSchema,
  ClassificationRuleLocatorSchema,
  CommandObservationLocatorSchema,
  VerificationObservationLocatorSchema,
  TestFileChangeLocatorSchema,
]);
export type EvidenceNodeLocatorV1 = z.infer<typeof EvidenceNodeLocatorV1Schema>;

export const EvidenceNodeMetadataV1Schema = z.strictObject({
  eventType: z.string().min(1).max(128).optional(),
  eventSource: z.enum(["claude_code", "codex", "ownloop"]).optional(),
  sensitivity: z.enum(["public", "normal", "sensitive", "secret"]).optional(),
  outcome: z.string().min(1).max(128).optional(),
  diagnosticCode: z.string().min(1).max(128).nullable().optional(),
  terminalStatus: z.enum(["Completed", "Partial", "Abandoned", "Failed"]).optional(),
  changeKind: z.enum(["created", "modified", "deleted", "type_changed", "unmerged"]).optional(),
  attribution: z.enum(["run_relative", "observed_only", "unavailable"]).optional(),
  gapCode: z.string().min(1).max(128).optional(),
  artifactKind: z.string().min(1).max(128).optional(),
  label: z.enum(CHANGE_CLASSIFICATION_LABELS).optional(),
  confidenceBasisPoints: z.number().int().min(0).max(10_000).optional(),
  ruleId: safeRuleIdSchema.optional(),
  ruleEvidenceKind: z.enum(CHANGE_CLASSIFICATION_EVIDENCE_KINDS).optional(),
  verificationKind: z.enum(VERIFICATION_KINDS).optional(),
  observedStatus: z.enum(VERIFICATION_OBSERVED_STATUSES).optional(),
  sourceAnalyzerVersion: safeVersionSchema.optional(),
});
export type EvidenceNodeMetadataV1 = z.infer<typeof EvidenceNodeMetadataV1Schema>;

export const EvidenceNodeV1Schema = z
  .strictObject({
    evidenceId: EvidenceIdSchema,
    kind: EvidenceNodeKindSchema,
    locator: EvidenceNodeLocatorV1Schema,
    metadata: EvidenceNodeMetadataV1Schema,
  })
  .superRefine((value, context) => {
    if (value.kind !== value.locator.kind) {
      context.addIssue({ code: "custom", message: "Evidence node kind and locator differ." });
    }
  });
export type EvidenceNodeV1 = z.infer<typeof EvidenceNodeV1Schema>;

export const EvidenceEdgeV1Schema = z.strictObject({
  edgeId: EvidenceEdgeIdSchema,
  type: EvidenceEdgeTypeSchema,
  sourceEvidenceId: EvidenceIdSchema,
  targetEvidenceId: EvidenceIdSchema,
});
export type EvidenceEdgeV1 = z.infer<typeof EvidenceEdgeV1Schema>;

export const EvidenceGraphKindCountV1Schema = z.strictObject({
  kind: z.union([EvidenceNodeKindSchema, EvidenceEdgeTypeSchema]),
  count: z.number().int().positive(),
});
export type EvidenceGraphKindCountV1 = z.infer<typeof EvidenceGraphKindCountV1Schema>;

export const DeterministicEvidenceGraphV1Schema = z
  .strictObject({
    schemaVersion: z.literal(EVIDENCE_GRAPH_SCHEMA_VERSION),
    builderVersion: safeVersionSchema,
    taxonomyVersion: safeVersionSchema,
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    classificationArtifactId: safeIdSchema,
    classificationInputFingerprint: sha256HexSchema,
    verificationArtifactId: safeIdSchema,
    verificationInputFingerprint: sha256HexSchema,
    sourceEventCount: z.number().int().nonnegative().max(EVIDENCE_GRAPH_MAX_NODES),
    outcome: EvidenceGraphOutcomeSchema,
    diagnosticCode: EvidenceGraphDiagnosticCodeSchema.nullable(),
    limitations: z.array(EvidenceGraphLimitationSchema).max(EVIDENCE_GRAPH_LIMITATIONS.length),
    inputFingerprint: sha256HexSchema,
    nodes: z.array(EvidenceNodeV1Schema).max(EVIDENCE_GRAPH_MAX_NODES),
    edges: z.array(EvidenceEdgeV1Schema).max(EVIDENCE_GRAPH_MAX_EDGES),
    nodeKindCounts: z.array(EvidenceGraphKindCountV1Schema).max(EVIDENCE_NODE_KINDS.length),
    edgeTypeCounts: z.array(EvidenceGraphKindCountV1Schema).max(EVIDENCE_EDGE_TYPES.length),
  })
  .superRefine((value, context) => {
    if (
      value.builderVersion !== EVIDENCE_GRAPH_BUILDER_VERSION ||
      value.taxonomyVersion !== EVIDENCE_GRAPH_TAXONOMY_VERSION
    ) {
      context.addIssue({ code: "custom", message: "Unsupported Evidence Graph version." });
    }
    const sortedLimitations = value.limitations.toSorted(
      (left, right) =>
        EVIDENCE_GRAPH_LIMITATIONS.indexOf(left) - EVIDENCE_GRAPH_LIMITATIONS.indexOf(right),
    );
    if (sortedLimitations.some((item, index) => item !== value.limitations[index])) {
      context.addIssue({ code: "custom", message: "Graph limitations must be sorted." });
    }
    if (new Set(value.limitations).size !== value.limitations.length) {
      context.addIssue({ code: "custom", message: "Graph limitations must be unique." });
    }
    const outcomeValid =
      (value.outcome === "complete" &&
        value.diagnosticCode === null &&
        value.limitations.length === 0) ||
      (value.outcome === "partial" &&
        value.diagnosticCode === "source_partial" &&
        value.limitations.length > 0) ||
      (value.outcome === "unavailable" &&
        value.diagnosticCode === "source_unavailable" &&
        value.limitations.length > 0);
    if (!outcomeValid) {
      context.addIssue({ code: "custom", message: "Graph outcome tuple is invalid." });
    }
    if (value.sourceEventCount > value.nodes.length) {
      context.addIssue({ code: "custom", message: "Source Event count exceeds node count." });
    }
  });
export type DeterministicEvidenceGraphV1 = z.infer<typeof DeterministicEvidenceGraphV1Schema>;

export const EVIDENCE_RESOLUTION_ANCHOR_KINDS = [
  "changed_file",
  "event",
  "command_observation",
  "verification_observation",
  "test_file_change",
  "classification_label",
  "evidence_gap",
] as const;
export const EvidenceResolutionAnchorKindSchema = z.enum(EVIDENCE_RESOLUTION_ANCHOR_KINDS);
export type EvidenceResolutionAnchorKind = z.infer<typeof EvidenceResolutionAnchorKindSchema>;

export const EvidenceResolutionV1Schema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  anchorKind: EvidenceResolutionAnchorKindSchema,
  runId: safeIdSchema,
  eventId: safeIdSchema.nullable(),
  reconciliationId: safeIdSchema.nullable(),
  artifactId: safeIdSchema.nullable(),
  fileEventId: safeIdSchema.nullable(),
  entryIndex: z.number().int().nonnegative().nullable(),
  observationIndex: z.number().int().nonnegative().nullable(),
  pathIdentitySha256: sha256HexSchema.nullable(),
  relativePath: z.string().min(1).max(4096).nullable(),
  verificationKind: z.enum(["test", "lint", "typecheck", "build"]).nullable(),
});
export type EvidenceResolutionV1 = z.infer<typeof EvidenceResolutionV1Schema>;
