import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  DeterministicSemanticAnalysisInputV1Schema,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  SemanticAnalysisInputResultV1Schema,
  SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
  SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "../src/index.js";

const evidenceId = `ev_${"a".repeat(48)}`;
const finalizationEvidenceId = `ev_${"c".repeat(48)}`;
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
  classificationArtifactId: "classification-1",
  classificationInputFingerprint: fingerprint,
  evidenceGraphArtifactId: "graph-1",
  evidenceGraphInputFingerprint: fingerprint,
  verificationArtifactId: "verification-1",
  verificationInputFingerprint: fingerprint,
  sourceVersions: {
    changeClassification: {
      schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
      classifierVersion: CHANGE_CLASSIFIER_VERSION,
      taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
      ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    },
    verificationEvidence: {
      schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
      extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
      commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
      outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    },
    evidenceGraph: {
      schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
      builderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
      taxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    },
  },
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
    {
      evidenceId: finalizationEvidenceId,
      supportingEvidenceIds: [],
      kind: "finalization",
      terminalStatus: "Completed",
      diagnosticCode: null,
    },
  ],
  evidenceRelations: [],
  verificationExcerpts: [],
  aggregates: {
    summaryCount: 2,
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

  it("rejects unredacted sensitive text and accepts deterministic placeholder expansion", () => {
    for (const text of [
      "Visit https://example.com/path",
      "Contact owner@example.com",
      "Read /home/alice/private.txt",
      "Bearer abcdefghijklmnop",
      "api_key=sk-proj-abcdefghijklmnop123456",
      "bad\u0001control",
      String.fromCharCode(0xd800),
    ]) {
      expect(() =>
        DeterministicSemanticAnalysisInputV1Schema.parse({
          ...ready,
          goal: {
            ...goal,
            text,
            retainedCodePointCount: [...text].length,
            retainedByteCount: new TextEncoder().encode(text).byteLength,
          },
          estimates: {
            ...ready.estimates,
            modelVisibleTextCodePointCount: [...text].length,
          },
        }),
      ).toThrow(ZodError);
    }

    const text = "[REDACTED_URL]";
    expect(
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        goal: {
          ...goal,
          text,
          sourceCodePointCount: 1,
          sourceByteCount: 1,
          retainedCodePointCount: [...text].length,
          retainedByteCount: new TextEncoder().encode(text).byteLength,
          redactions: [{ kind: "url", count: 1 }],
        },
        aggregates: {
          ...ready.aggregates,
          redactions: [{ kind: "url", count: 1 }],
        },
        estimates: {
          ...ready.estimates,
          modelVisibleTextCodePointCount: [...text].length,
        },
      }).goal?.text,
    ).toBe(text);
  });

  it("rejects inconsistent source versions, truncation, redactions, budget, and summaries", () => {
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        sourceVersions: {
          ...ready.sourceVersions,
          evidenceGraph: { ...ready.sourceVersions.evidenceGraph, builderVersion: "9.9.9" },
        },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        goal: { ...goal, truncated: true },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        aggregates: { ...ready.aggregates, redactions: [{ kind: "url", count: 1 }] },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        aggregates: { ...ready.aggregates, droppedRelationCount: 1 },
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        evidenceSummaries: ready.evidenceSummaries.map((summary) =>
          summary.kind === "finalization" ? { ...summary, terminalStatus: "Failed" } : summary,
        ),
      }),
    ).toThrow(ZodError);
    expect(() =>
      DeterministicSemanticAnalysisInputV1Schema.parse({
        ...ready,
        estimates: { ...ready.estimates, inputTokenUpperBound: 101 },
      }),
    ).toThrow(ZodError);
  });
});
