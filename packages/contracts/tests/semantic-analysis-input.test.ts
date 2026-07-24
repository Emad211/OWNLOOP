import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  DeterministicSemanticAnalysisInputV1Schema,
  SemanticAnalysisInputResultV1Schema,
  SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
  SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
} from "../src/semantic-analysis-input.js";

const evidenceId = `ev_${"a".repeat(48)}`;
const fingerprint = "b".repeat(64);

const goal = {
  evidenceId,
  text: "Review the evidence-backed change.",
  sourceCodePointCount: 34,
  sourceByteCount: 34,
  retainedCodePointCount: 34,
  retainedByteCount: 34,
  truncated: false,
  redactions: [],
} as const;

const ready = {
  schemaVersion: 1,
  builderVersion: SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
  reductionPolicyVersion: SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
  redactionPolicyVersion: SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
  tokenEstimatorVersion: SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
  targetCandidateMomentSchemaVersion: 1,
  runId: "run-1",
  finalizationId: "finalization-1",
  evidenceGraphArtifactId: "graph-1",
  evidenceGraphInputFingerprint: fingerprint,
  verificationArtifactId: "verification-1",
  verificationInputFingerprint: fingerprint,
  graphContext: { outcome: "complete", limitations: [], runEvidenceId: evidenceId },
  outcome: "ready",
  diagnosticCode: null,
  limitations: [],
  inputFingerprint: fingerprint,
  goal,
  evidenceSummaries: [
    {
      evidenceId,
      supportingEvidenceIds: [],
      kind: "run",
      terminalStatus: "Completed",
    },
  ],
  evidenceRelations: [],
  verificationExcerpts: [],
  aggregates: {
    summaryCount: 1,
    relationCount: 0,
    verificationExcerptCount: 0,
    droppedSummaryCount: 0,
    droppedRelationCount: 0,
    droppedVerificationExcerptCount: 0,
    redactions: [],
  },
  estimates: {
    utf8ByteCount: 100,
    modelVisibleTextCodePointCount: 34,
    inputTokenUpperBound: 100,
    monetaryEstimateStatus: "provider_not_selected",
  },
} as const;

describe("semantic-analysis input contracts", () => {
  it("accepts strict ready input and rejects extra provider metadata", () => {
    expect(DeterministicSemanticAnalysisInputV1Schema.parse(ready)).toEqual(ready);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({ ...ready, provider: "example" }),
    ).toThrow(ZodError);
  });

  it("enforces evidence-addressing, canonical order, and outcome consistency", () => {
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        goal: { ...goal, evidenceId: `ev_${"c".repeat(48)}` },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        evidenceSummaries: [
          {
            evidenceId,
            supportingEvidenceIds: [`ev_${"f".repeat(48)}`, `ev_${"e".repeat(48)}`],
            kind: "run",
            terminalStatus: "Completed",
          },
        ],
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        outcome: "partial",
        diagnosticCode: null,
      }),
    ).toThrow(ZodError);
  });

  it("accepts controlled disabled and unavailable safe results", () => {
    const base = {
      schemaVersion: 1,
      builderVersion: SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
      reductionPolicyVersion: SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
      redactionPolicyVersion: SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
      tokenEstimatorVersion: SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
      targetCandidateMomentSchemaVersion: 1,
      runId: "run-1",
      limitations: [],
      artifactId: null,
      inputFingerprint: null,
      summaryCount: 0,
      relationCount: 0,
      verificationExcerptCount: 0,
      utf8ByteCount: 0,
      modelVisibleTextCodePointCount: 0,
      inputTokenUpperBound: 0,
      monetaryEstimateStatus: "provider_not_selected",
    } as const;
    expect(
      SemanticAnalysisInputResultV1Schema.parse({
        ...base,
        outcome: "disabled",
        diagnosticCode: "disabled",
      }).outcome,
    ).toBe("disabled");
    expect(
      SemanticAnalysisInputResultV1Schema.parse({
        ...base,
        outcome: "unavailable",
        diagnosticCode: "source_unavailable",
      }).outcome,
    ).toBe("unavailable");
  });

  it("rejects raw markup and inconsistent estimates", () => {
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        goal: { ...goal, text: "<script>", retainedCodePointCount: 8, retainedByteCount: 8 },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        estimates: { ...ready.estimates, modelVisibleTextCodePointCount: 1 },
      }),
    ).toThrow(ZodError);
  });
});
