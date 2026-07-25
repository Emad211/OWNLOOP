import {
  CandidateMomentBatchV1Schema,
  type CandidateMomentV1,
  DeterministicEvidenceGraphV1Schema,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
} from "@ownloop/contracts";

const sha = "a".repeat(64);
export const RUN_EVIDENCE = `ev_${"1".repeat(48)}`;
export const DECISION_EVIDENCE = `ev_${"2".repeat(48)}`;
export const CHANGE_EVIDENCE = `ev_${"3".repeat(48)}`;
export const GAP_EVIDENCE = `ev_${"4".repeat(48)}`;
export const FINALIZATION_EVIDENCE = `ev_${"5".repeat(48)}`;
export const CLASSIFICATION_ENTRY_EVIDENCE = `ev_${"6".repeat(48)}`;
export const LABEL_EVIDENCE = `ev_${"7".repeat(48)}`;
export const VERIFICATION_EVIDENCE = `ev_${"8".repeat(48)}`;

export function candidateValidationGraph(outcome: "complete" | "partial" = "complete") {
  return DeterministicEvidenceGraphV1Schema.parse({
    schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    builderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
    taxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    classificationArtifactId: "classification-1",
    classificationInputFingerprint: sha,
    verificationArtifactId: "verification-1",
    verificationInputFingerprint: sha,
    sourceEventCount: 2,
    outcome,
    diagnosticCode: outcome === "partial" ? "source_partial" : null,
    limitations: outcome === "partial" ? ["evidence_gaps_present"] : [],
    inputFingerprint: sha,
    nodes: [
      {
        evidenceId: RUN_EVIDENCE,
        kind: "run",
        locator: { kind: "run", runId: "run-1" },
        metadata: { outcome: "Completed", terminalStatus: "Completed" },
      },
      {
        evidenceId: DECISION_EVIDENCE,
        kind: "event",
        locator: { kind: "event", eventId: "event-plan" },
        metadata: { eventType: "agent.plan_observed", eventSource: "claude_code" },
      },
      {
        evidenceId: CHANGE_EVIDENCE,
        kind: "changed_file",
        locator: {
          kind: "changed_file",
          reconciliationId: "reconciliation-1",
          entryIndex: 0,
          fileEventId: "event-file",
        },
        metadata: { changeKind: "modified", attribution: "run_relative" },
      },
      {
        evidenceId: GAP_EVIDENCE,
        kind: "evidence_gap",
        locator: { kind: "evidence_gap", gapId: "gap-1" },
        metadata: { gapCode: "verification_missing" },
      },
      {
        evidenceId: FINALIZATION_EVIDENCE,
        kind: "finalization",
        locator: { kind: "finalization", finalizationId: "finalization-1" },
        metadata: { terminalStatus: "Completed", diagnosticCode: null },
      },
      {
        evidenceId: CLASSIFICATION_ENTRY_EVIDENCE,
        kind: "classification_entry",
        locator: {
          kind: "classification_entry",
          artifactId: "classification-1",
          entryIndex: 0,
          fileEventId: "event-file",
        },
        metadata: { outcome: "classified", attribution: "run_relative" },
      },
      {
        evidenceId: LABEL_EVIDENCE,
        kind: "classification_label",
        locator: {
          kind: "classification_label",
          artifactId: "classification-1",
          entryIndex: 0,
          label: "behavior",
        },
        metadata: { label: "behavior", confidenceBasisPoints: 9000 },
      },
      {
        evidenceId: VERIFICATION_EVIDENCE,
        kind: "verification_observation",
        locator: {
          kind: "verification_observation",
          artifactId: "verification-1",
          observationIndex: 0,
          verificationKind: "test",
        },
        metadata: { verificationKind: "test", observedStatus: "failed" },
      },
    ],
    edges: [
      {
        edgeId: `ed_${"1".repeat(48)}`,
        type: "run_contains",
        sourceEvidenceId: RUN_EVIDENCE,
        targetEvidenceId: DECISION_EVIDENCE,
      },
      {
        edgeId: `ed_${"2".repeat(48)}`,
        type: "run_has_gap",
        sourceEvidenceId: RUN_EVIDENCE,
        targetEvidenceId: GAP_EVIDENCE,
      },
      {
        edgeId: `ed_${"3".repeat(48)}`,
        type: "run_contains",
        sourceEvidenceId: RUN_EVIDENCE,
        targetEvidenceId: FINALIZATION_EVIDENCE,
      },
      {
        edgeId: `ed_${"4".repeat(48)}`,
        type: "changed_file_classified_by",
        sourceEvidenceId: CHANGE_EVIDENCE,
        targetEvidenceId: CLASSIFICATION_ENTRY_EVIDENCE,
      },
      {
        edgeId: `ed_${"5".repeat(48)}`,
        type: "classification_assigned_label",
        sourceEvidenceId: CLASSIFICATION_ENTRY_EVIDENCE,
        targetEvidenceId: LABEL_EVIDENCE,
      },
    ],
    nodeKindCounts: [
      { kind: "run", count: 1 },
      { kind: "event", count: 1 },
      { kind: "changed_file", count: 1 },
      { kind: "evidence_gap", count: 1 },
      { kind: "finalization", count: 1 },
      { kind: "classification_entry", count: 1 },
      { kind: "classification_label", count: 1 },
      { kind: "verification_observation", count: 1 },
    ],
    edgeTypeCounts: [
      { kind: "run_contains", count: 2 },
      { kind: "run_has_gap", count: 1 },
      { kind: "changed_file_classified_by", count: 1 },
      { kind: "classification_assigned_label", count: 1 },
    ],
  });
}

export const CHANGE_CANDIDATE: CandidateMomentV1 = {
  type: "change",
  title: "Behavior file modified",
  claim: "Behavior file modified",
  importance: "high",
  confidenceBasisPoints: 9000,
  evidenceIds: [CHANGE_EVIDENCE, LABEL_EVIDENCE],
  suggestedInteraction: { kind: "acknowledge" },
};

export const DECISION_CANDIDATE: CandidateMomentV1 = {
  type: "decision",
  title: "Decision observed",
  claim: "Decision observed",
  importance: "medium",
  confidenceBasisPoints: 7000,
  evidenceIds: [DECISION_EVIDENCE],
  suggestedInteraction: {
    kind: "decision_response",
    prompt: "Confirm decision observed",
    options: ["confirm", "revise", "uncertain"],
  },
};

export const RISK_CANDIDATE: CandidateMomentV1 = {
  type: "risk",
  title: "Test failed",
  claim: "Test failed",
  importance: "critical",
  confidenceBasisPoints: 9500,
  evidenceIds: [VERIFICATION_EVIDENCE],
  suggestedInteraction: {
    kind: "risk_response",
    prompt: "Confirm test failed",
    options: ["acknowledge", "mitigate", "dismiss"],
  },
};

export const CHECK_CANDIDATE: CandidateMomentV1 = {
  type: "check",
  title: "Behavior file modified",
  claim: "Behavior file modified",
  importance: "low",
  confidenceBasisPoints: 6000,
  evidenceIds: [CHANGE_EVIDENCE, LABEL_EVIDENCE],
  suggestedInteraction: {
    kind: "check_answer",
    question: "Confirm behavior file modified",
    choices: [
      { id: "confirm", label: "Confirm" },
      { id: "revise", label: "Revise" },
    ],
  },
};

export function candidateBatch(candidates: readonly CandidateMomentV1[]) {
  return CandidateMomentBatchV1Schema.parse({ schemaVersion: 1, candidates });
}

export function validatorInput(
  candidates: readonly CandidateMomentV1[],
  outcome: "complete" | "partial" = "complete",
) {
  return {
    runId: "run-1",
    finalizationId: "finalization-1",
    generationId: `gen_${"a".repeat(48)}`,
    sourceCandidateArtifactId: "candidate-artifact-1",
    sourceCandidateFingerprint: `sha256:${"b".repeat(64)}`,
    candidateBatch: candidateBatch(candidates),
    evidenceGraphArtifactId: "graph-artifact-1",
    evidenceGraph: candidateValidationGraph(outcome),
  };
}
