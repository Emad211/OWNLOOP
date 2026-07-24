import { createHash } from "node:crypto";

import {
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  type DeterministicEvidenceGraphV1,
  type DeterministicSemanticAnalysisInputV1,
  DeterministicSemanticAnalysisInputV1Schema,
  type DeterministicVerificationEvidenceV1,
  EVIDENCE_GRAPH_LIMITATIONS,
  type EvidenceGraphLimitation,
  type EvidenceNodeV1,
  type SemanticAnalysisEvidenceRelationV1,
  type SemanticAnalysisEvidenceSummaryV1,
  type SemanticAnalysisInputDiagnosticCode,
  type SemanticAnalysisLimitation,
  type SemanticAnalysisRedactionCountV1,
  type SemanticAnalysisRedactionKind,
  type SemanticAnalysisVerificationExcerptV1,
  SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION,
  SEMANTIC_ANALYSIS_LIMITATIONS,
  SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
  SEMANTIC_ANALYSIS_MAX_RELATIONS,
  SEMANTIC_ANALYSIS_MAX_SUMMARIES,
  SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS,
  SEMANTIC_ANALYSIS_REDACTION_KINDS,
  SEMANTIC_ANALYSIS_RELATION_TYPES,
  SEMANTIC_ANALYSIS_SUMMARY_KINDS,
  VERIFICATION_OUTPUT_FIELDS,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import type { RunFinalization, TaskRun } from "../persistence/index.js";
import { PersistenceError } from "../persistence/index.js";
import {
  SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
  SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
} from "./constants.js";
import { redactSemanticGoal, redactSemanticVerificationExcerpt } from "./redaction.js";

const encoder = new TextEncoder();
const PRE_BUDGET_CANONICAL_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: 8 * 1024 * 1024,
  maxArrayItems: 100_000,
  maxObjectProperties: 100_000,
});
const ARTIFACT_CANONICAL_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
  maxArrayItems: 100_000,
  maxObjectProperties: 100_000,
});

export type SemanticAnalysisBuilderInput = Readonly<{
  run: TaskRun;
  finalization: RunFinalization;
  evidenceGraphArtifactId: string;
  evidenceGraph: DeterministicEvidenceGraphV1;
  verificationArtifactId: string;
  verification: DeterministicVerificationEvidenceV1;
}>;

export type PreparedSemanticAnalysisInput = Readonly<{
  value: DeterministicSemanticAnalysisInputV1;
  canonicalJson: string;
  bytes: Uint8Array;
}>;

export type UnavailableSemanticAnalysisInput = Readonly<{
  outcome: "unavailable";
  diagnosticCode: "source_unavailable";
  limitations: readonly SemanticAnalysisLimitation[];
}>;

function summaryKey(value: SemanticAnalysisEvidenceSummaryV1): string {
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

function relationKey(value: SemanticAnalysisEvidenceRelationV1): string {
  return `${String(SEMANTIC_ANALYSIS_RELATION_TYPES.indexOf(value.type)).padStart(2, "0")}:${value.sourceEvidenceId}:${value.targetEvidenceId}`;
}

function excerptKey(value: SemanticAnalysisVerificationExcerptV1): string {
  return `${value.evidenceId}:${String(VERIFICATION_OUTPUT_FIELDS.indexOf(value.field)).padStart(2, "0")}`;
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function supportingIds(evidenceId: string, graph: DeterministicEvidenceGraphV1): string[] {
  const values = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.sourceEvidenceId === evidenceId) values.add(edge.targetEvidenceId);
    if (edge.targetEvidenceId === evidenceId) values.add(edge.sourceEvidenceId);
  }
  return [...values].toSorted().slice(0, 32);
}

function requiredMetadata<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new PersistenceError("invalid_persisted_row", message);
  return value;
}

function summaryForNode(
  node: EvidenceNodeV1,
  graph: DeterministicEvidenceGraphV1,
): SemanticAnalysisEvidenceSummaryV1 | null {
  const base = {
    evidenceId: node.evidenceId,
    supportingEvidenceIds: supportingIds(node.evidenceId, graph),
  } as const;
  switch (node.kind) {
    case "run":
      return {
        ...base,
        kind: "run",
        terminalStatus: requiredMetadata(
          node.metadata.terminalStatus,
          "Run Evidence metadata is incomplete for semantic reduction.",
        ),
      };
    case "finalization":
      return {
        ...base,
        kind: "finalization",
        terminalStatus: requiredMetadata(
          node.metadata.terminalStatus,
          "Finalization Evidence metadata is incomplete for semantic reduction.",
        ),
        diagnosticCode: node.metadata.diagnosticCode ?? null,
      };
    case "evidence_gap":
      return {
        ...base,
        kind: "evidence_gap",
        gapCode: requiredMetadata(
          node.metadata.gapCode,
          "Evidence-gap metadata is incomplete for semantic reduction.",
        ),
      };
    case "artifact":
      return {
        ...base,
        kind: "artifact",
        artifactKind: requiredMetadata(
          node.metadata.artifactKind,
          "Artifact Evidence metadata is incomplete for semantic reduction.",
        ),
      };
    case "changed_file":
      return {
        ...base,
        kind: "changed_file",
        changeKind: requiredMetadata(
          node.metadata.changeKind,
          "Changed-file Evidence metadata is incomplete for semantic reduction.",
        ),
        attribution: requiredMetadata(
          node.metadata.attribution,
          "Changed-file attribution is incomplete for semantic reduction.",
        ),
      };
    case "classification_entry":
      return { ...base, kind: "classification_entry" };
    case "classification_label":
      return {
        ...base,
        kind: "classification_label",
        label: requiredMetadata(
          node.metadata.label,
          "Classification-label Evidence metadata is incomplete.",
        ),
        confidenceBasisPoints: requiredMetadata(
          node.metadata.confidenceBasisPoints,
          "Classification confidence Evidence metadata is incomplete.",
        ),
      };
    case "classification_rule":
      return {
        ...base,
        kind: "classification_rule",
        ruleId: requiredMetadata(
          node.metadata.ruleId,
          "Classification-rule Evidence metadata is incomplete.",
        ),
        evidenceKind: requiredMetadata(
          node.metadata.ruleEvidenceKind,
          "Classification-rule Evidence kind is incomplete.",
        ),
      };
    case "verification_observation": {
      const verificationKind = requiredMetadata(
        node.metadata.verificationKind,
        "Verification Evidence kind is incomplete.",
      );
      if (verificationKind === "unknown") {
        throw new PersistenceError(
          "invalid_persisted_row",
          "Unknown verification kind cannot be model-visible.",
        );
      }
      return {
        ...base,
        kind: "verification_observation",
        verificationKind,
        observedStatus: requiredMetadata(
          node.metadata.observedStatus,
          "Verification Evidence status is incomplete.",
        ),
      };
    }
    case "test_file_change":
      return { ...base, kind: "test_file_change" };
    default:
      return null;
  }
}

function graphLimitationSummaries(
  graph: DeterministicEvidenceGraphV1,
  runEvidenceId: string,
): SemanticAnalysisEvidenceSummaryV1[] {
  return graph.limitations.map((limitation) => ({
    evidenceId: runEvidenceId,
    supportingEvidenceIds: [],
    kind: "graph_limitation" as const,
    limitation,
  }));
}

function reducedRelations(
  graph: DeterministicEvidenceGraphV1,
): SemanticAnalysisEvidenceRelationV1[] {
  const allowed = new Set<string>(SEMANTIC_ANALYSIS_RELATION_TYPES);
  return graph.edges
    .filter((edge) => allowed.has(edge.type))
    .map((edge) => ({
      type: edge.type as SemanticAnalysisEvidenceRelationV1["type"],
      sourceEvidenceId: edge.sourceEvidenceId,
      targetEvidenceId: edge.targetEvidenceId,
    }))
    .toSorted((left, right) => compareCanonical(relationKey(left), relationKey(right)));
}

function verificationEvidenceId(
  graph: DeterministicEvidenceGraphV1,
  artifactId: string,
  observationIndex: number,
  verificationKind: "test" | "lint" | "typecheck" | "build",
): string {
  const node = graph.nodes.find(
    (candidate) =>
      candidate.locator.kind === "verification_observation" &&
      candidate.locator.artifactId === artifactId &&
      candidate.locator.observationIndex === observationIndex &&
      candidate.locator.verificationKind === verificationKind,
  );
  if (node === undefined) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "Verification excerpt has no graph-owned Evidence ID.",
    );
  }
  return node.evidenceId;
}

function verificationExcerpts(
  graph: DeterministicEvidenceGraphV1,
  artifactId: string,
  verification: DeterministicVerificationEvidenceV1,
): SemanticAnalysisVerificationExcerptV1[] {
  const excerpts: SemanticAnalysisVerificationExcerptV1[] = [];
  for (const observation of verification.commandObservations) {
    if (observation.kind === "unknown") continue;
    const evidenceId = verificationEvidenceId(
      graph,
      artifactId,
      observation.observationIndex,
      observation.kind,
    );
    for (const output of observation.reducedOutputs) {
      if (output.excerpt.trim().length === 0) continue;
      const redacted = redactSemanticVerificationExcerpt(output.excerpt);
      excerpts.push({
        evidenceId,
        verificationKind: observation.kind,
        observedStatus: observation.status,
        field: output.field,
        text: redacted.text,
        sourceCodePointCount: redacted.sourceCodePointCount,
        sourceByteCount: redacted.sourceByteCount,
        retainedCodePointCount: redacted.retainedCodePointCount,
        retainedByteCount: redacted.retainedByteCount,
        sourceTruncated: output.truncated,
        truncated: redacted.truncated,
        redactions: redacted.redactions,
      });
    }
  }
  return excerpts.toSorted((left, right) => compareCanonical(excerptKey(left), excerptKey(right)));
}

function combineRedactions(
  goal: Readonly<{ redactions: readonly SemanticAnalysisRedactionCountV1[] }>,
  excerpts: readonly SemanticAnalysisVerificationExcerptV1[],
): SemanticAnalysisRedactionCountV1[] {
  const counts = new Map<SemanticAnalysisRedactionKind, number>();
  for (const entry of [goal, ...excerpts]) {
    for (const redaction of entry.redactions) {
      counts.set(redaction.kind, (counts.get(redaction.kind) ?? 0) + redaction.count);
    }
  }
  return SEMANTIC_ANALYSIS_REDACTION_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return count === 0 ? [] : [{ kind, count }];
  });
}

function inputFingerprint(input: SemanticAnalysisBuilderInput): string {
  return createHash("sha256")
    .update(
      canonicalizeJson(
        {
          schemaVersion: SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION,
          builderVersion: SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
          reductionPolicyVersion: SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
          redactionPolicyVersion: SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
          tokenEstimatorVersion: SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
          targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
          runId: input.run.runId,
          finalizationId: input.finalization.finalizationId,
          redactedPrompt: input.run.redactedPrompt,
          evidenceGraphArtifactId: input.evidenceGraphArtifactId,
          evidenceGraphInputFingerprint: input.evidenceGraph.inputFingerprint,
          verificationArtifactId: input.verificationArtifactId,
          verificationInputFingerprint: input.verification.inputFingerprint,
          maximumArtifactBytes: SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
          maximumSummaries: SEMANTIC_ANALYSIS_MAX_SUMMARIES,
          maximumRelations: SEMANTIC_ANALYSIS_MAX_RELATIONS,
          maximumVerificationExcerpts: SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS,
        },
        PRE_BUDGET_CANONICAL_LIMITS,
      ),
    )
    .digest("hex");
}

function limitations(
  graphLimitations: readonly EvidenceGraphLimitation[],
  budgetTruncated: boolean,
): SemanticAnalysisLimitation[] {
  const values = new Set<SemanticAnalysisLimitation>(graphLimitations);
  if (budgetTruncated) values.add("budget_truncated");
  return SEMANTIC_ANALYSIS_LIMITATIONS.filter((entry) => values.has(entry));
}

function diagnostic(
  graphOutcome: "complete" | "partial",
  budgetTruncated: boolean,
): SemanticAnalysisInputDiagnosticCode | null {
  if (graphOutcome === "complete") return budgetTruncated ? "budget_truncated" : null;
  return budgetTruncated ? "source_partial_and_budget_truncated" : "source_partial";
}

function summaryDropPriority(value: SemanticAnalysisEvidenceSummaryV1): number {
  switch (value.kind) {
    case "run":
    case "finalization":
    case "graph_limitation":
    case "evidence_gap":
      return 0;
    case "artifact":
    case "verification_observation":
      return 1;
    default:
      return 2;
  }
}

function fixedPointValue(
  base: Omit<DeterministicSemanticAnalysisInputV1, "estimates">,
): Readonly<{ value: DeterministicSemanticAnalysisInputV1; canonicalJson: string }> {
  let byteCount = 0;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const value = {
      ...base,
      estimates: {
        utf8ByteCount: byteCount,
        modelVisibleTextCodePointCount:
          (base.goal === null ? 0 : [...base.goal.text].length) +
          base.verificationExcerpts.reduce((total, excerpt) => total + [...excerpt.text].length, 0),
        inputTokenUpperBound: byteCount,
        monetaryEstimateStatus: "provider_not_selected" as const,
      },
    };
    const canonicalJson = canonicalizeJson(value, PRE_BUDGET_CANONICAL_LIMITS);
    const nextByteCount = encoder.encode(canonicalJson).byteLength;
    if (nextByteCount === byteCount) return { value, canonicalJson };
    byteCount = nextByteCount;
  }
  throw new PersistenceError("operation_failed", "Semantic-input estimate did not converge.");
}

function buildCandidate(
  input: SemanticAnalysisBuilderInput,
  graphOutcome: "complete" | "partial",
  runEvidenceId: string,
  goal: ReturnType<typeof redactSemanticGoal>,
  summaries: readonly SemanticAnalysisEvidenceSummaryV1[],
  relations: readonly SemanticAnalysisEvidenceRelationV1[],
  excerpts: readonly SemanticAnalysisVerificationExcerptV1[],
  droppedSummaryCount: number,
  droppedRelationCount: number,
  droppedVerificationExcerptCount: number,
): Readonly<{ value: DeterministicSemanticAnalysisInputV1; canonicalJson: string }> {
  const budgetTruncated =
    droppedSummaryCount > 0 || droppedRelationCount > 0 || droppedVerificationExcerptCount > 0;
  const semanticLimitations = limitations(input.evidenceGraph.limitations, budgetTruncated);
  const base: Omit<DeterministicSemanticAnalysisInputV1, "estimates"> = {
    schemaVersion: SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION,
    builderVersion: SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
    reductionPolicyVersion: SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
    redactionPolicyVersion: SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
    tokenEstimatorVersion: SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
    targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    runId: input.run.runId,
    finalizationId: input.finalization.finalizationId,
    evidenceGraphArtifactId: input.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: input.evidenceGraph.inputFingerprint,
    verificationArtifactId: input.verificationArtifactId,
    verificationInputFingerprint: input.verification.inputFingerprint,
    graphContext: {
      outcome: graphOutcome,
      limitations: input.evidenceGraph.limitations,
      runEvidenceId,
    },
    outcome: graphOutcome === "complete" && !budgetTruncated ? "ready" : "partial",
    diagnosticCode: diagnostic(graphOutcome, budgetTruncated),
    limitations: semanticLimitations,
    inputFingerprint: inputFingerprint(input),
    goal: { evidenceId: runEvidenceId, ...goal },
    evidenceSummaries: [...summaries],
    evidenceRelations: [...relations],
    verificationExcerpts: [...excerpts],
    aggregates: {
      summaryCount: summaries.length,
      relationCount: relations.length,
      verificationExcerptCount: excerpts.length,
      droppedSummaryCount,
      droppedRelationCount,
      droppedVerificationExcerptCount,
      redactions: combineRedactions(goal, excerpts),
    },
  };
  return fixedPointValue(base);
}

function dropChunk<T>(values: T[], currentBytes: number): number {
  if (values.length === 0) return 0;
  const over = Math.max(1, currentBytes - SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES);
  const count = Math.max(1, Math.ceil((values.length * over) / Math.max(1, currentBytes)));
  values.splice(Math.max(0, values.length - count), count);
  return count;
}

export function prepareDeterministicSemanticAnalysisInput(
  input: SemanticAnalysisBuilderInput,
): PreparedSemanticAnalysisInput | UnavailableSemanticAnalysisInput {
  if (
    input.finalization.runId !== input.run.runId ||
    input.evidenceGraph.runId !== input.run.runId ||
    input.verification.runId !== input.run.runId ||
    input.evidenceGraph.finalizationId !== input.finalization.finalizationId ||
    input.verification.finalizationId !== input.finalization.finalizationId ||
    input.evidenceGraph.verificationArtifactId !== input.verificationArtifactId ||
    input.evidenceGraph.verificationInputFingerprint !== input.verification.inputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "Semantic-input source ownership is inconsistent.",
    );
  }
  if (
    !(
      input.run.status === "Completed" ||
      input.run.status === "Partial" ||
      input.run.status === "Abandoned" ||
      input.run.status === "Failed"
    )
  ) {
    throw new PersistenceError("operation_failed", "Semantic-input Run is not terminal.");
  }
  const graphOutcome = input.evidenceGraph.outcome;
  if (graphOutcome === "unavailable") {
    return {
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: input.evidenceGraph.limitations,
    };
  }

  const runNode = input.evidenceGraph.nodes.find((node) => node.kind === "run");
  if (runNode === undefined) {
    return {
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: input.evidenceGraph.limitations,
    };
  }

  const goal = redactSemanticGoal(input.run.redactedPrompt);
  const allSummaries = [
    ...input.evidenceGraph.nodes.flatMap((node) => {
      const summary = summaryForNode(node, input.evidenceGraph);
      return summary === null ? [] : [summary];
    }),
    ...graphLimitationSummaries(input.evidenceGraph, runNode.evidenceId),
  ].toSorted((left, right) => compareCanonical(summaryKey(left), summaryKey(right)));
  const allRelations = reducedRelations(input.evidenceGraph);
  const allExcerpts = verificationExcerpts(
    input.evidenceGraph,
    input.verificationArtifactId,
    input.verification,
  );

  const summaries = allSummaries.slice(0, SEMANTIC_ANALYSIS_MAX_SUMMARIES);
  const relations = allRelations.slice(0, SEMANTIC_ANALYSIS_MAX_RELATIONS);
  const excerpts = allExcerpts.slice(0, SEMANTIC_ANALYSIS_MAX_VERIFICATION_EXCERPTS);
  let droppedSummaryCount = allSummaries.length - summaries.length;
  let droppedRelationCount = allRelations.length - relations.length;
  let droppedVerificationExcerptCount = allExcerpts.length - excerpts.length;

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const prepared = buildCandidate(
      input,
      graphOutcome,
      runNode.evidenceId,
      goal,
      summaries,
      relations,
      excerpts,
      droppedSummaryCount,
      droppedRelationCount,
      droppedVerificationExcerptCount,
    );
    const bytes = encoder.encode(prepared.canonicalJson);
    if (bytes.byteLength <= SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES) {
      const value = DeterministicSemanticAnalysisInputV1Schema.parse(prepared.value);
      const canonicalJson = canonicalizeJson(value, ARTIFACT_CANONICAL_LIMITS);
      return { value, canonicalJson, bytes: encoder.encode(canonicalJson) };
    }

    if (relations.length > 0) {
      droppedRelationCount += dropChunk(relations, bytes.byteLength);
      continue;
    }
    if (excerpts.length > 0) {
      droppedVerificationExcerptCount += dropChunk(excerpts, bytes.byteLength);
      continue;
    }
    const lowPriorityIndex = summaries.findLastIndex(
      (summary) => summaryDropPriority(summary) === 2,
    );
    if (lowPriorityIndex >= 0) {
      summaries.splice(lowPriorityIndex, 1);
      droppedSummaryCount += 1;
      continue;
    }
    const verificationIndex = summaries.findLastIndex(
      (summary) => summary.kind === "verification_observation" || summary.kind === "artifact",
    );
    if (verificationIndex >= 0) {
      summaries.splice(verificationIndex, 1);
      droppedSummaryCount += 1;
      continue;
    }
    return {
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: limitations(input.evidenceGraph.limitations, true),
    };
  }
  throw new PersistenceError(
    "operation_failed",
    "Semantic-input budget reduction did not converge.",
  );
}
