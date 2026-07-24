import {
  DeterministicEvidenceGraphV1Schema,
  DeterministicVerificationEvidenceV1Schema,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "@ownloop/contracts";

import type { RunFinalization, TaskRun } from "../persistence/index.js";

const at = "2026-07-24T00:00:00.000Z";
const sha = "a".repeat(64);
export const runEvidenceId = `ev_${"1".repeat(48)}`;
export const finalizationEvidenceId = `ev_${"2".repeat(48)}`;
export const verificationEvidenceId = `ev_${"3".repeat(48)}`;

function run(): TaskRun {
  return {
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt:
      "Review the verification result at https://example.com and keep package.json behavior.",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: at,
    endedAt: at,
    status: "Completed",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  };
}

function finalization(): RunFinalization {
  return {
    finalizationId: "finalization-1",
    runId: "run-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    terminalStatus: "Completed",
    mode: "normal",
    triggerEventId: "event-stop",
    reconciliationId: "reconciliation-1",
    manifestArtifactId: "manifest-1",
    finalFingerprint: sha,
    finalSnapshotEventId: "event-snapshot",
    terminalEventId: "event-terminal",
    diagnosticCode: null,
    finalizedAt: at,
    generatorVersion: "0.1.0",
  };
}

function verification() {
  return DeterministicVerificationEvidenceV1Schema.parse({
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
    commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
    outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    classificationArtifactId: "classification-1",
    classificationInputFingerprint: sha,
    sourceEventCount: 1,
    outcome: "extracted",
    diagnosticCode: null,
    inputFingerprint: sha,
    commandObservations: [
      {
        observationIndex: 0,
        sourceEventId: "event-source-command",
        commandFingerprint: sha,
        kind: "test",
        ruleId: "pnpm.test",
        toolFamily: "pnpm",
        sourceToolOutcome: "succeeded",
        exitCode: 0,
        status: "passed",
        reducedOutputs: [
          {
            field: "stdout",
            acceptedByteCount: 38,
            acceptedSha256: sha,
            excerpt: "PASS /home/alice/project secret=hidden",
            excerptByteCount: 38,
            lineCount: 1,
            truncated: false,
          },
        ],
        commandEventId: "event-command",
        verificationEventId: "event-test",
      },
    ],
    testFileChanges: [],
    aggregates: {
      commandObservationCount: 1,
      recognizedCommandCount: 1,
      unknownCommandCount: 0,
      testFileChangeCount: 0,
      kinds: [
        {
          kind: "test",
          observationCount: 1,
          passedCount: 1,
          failedCount: 0,
          observedWithoutExitCodeCount: 0,
        },
      ],
    },
  });
}

function graph() {
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
    sourceEventCount: 1,
    outcome: "complete",
    diagnosticCode: null,
    limitations: [],
    inputFingerprint: sha,
    nodes: [
      {
        evidenceId: runEvidenceId,
        kind: "run",
        locator: { kind: "run", runId: "run-1" },
        metadata: { outcome: "Completed", terminalStatus: "Completed" },
      },
      {
        evidenceId: finalizationEvidenceId,
        kind: "finalization",
        locator: { kind: "finalization", finalizationId: "finalization-1" },
        metadata: { terminalStatus: "Completed", diagnosticCode: null },
      },
      {
        evidenceId: verificationEvidenceId,
        kind: "verification_observation",
        locator: {
          kind: "verification_observation",
          artifactId: "verification-1",
          observationIndex: 0,
          verificationKind: "test",
        },
        metadata: { verificationKind: "test", observedStatus: "passed" },
      },
    ],
    edges: [
      {
        edgeId: `ed_${"1".repeat(48)}`,
        type: "run_contains",
        sourceEvidenceId: runEvidenceId,
        targetEvidenceId: finalizationEvidenceId,
      },
    ],
    nodeKindCounts: [
      { kind: "run", count: 1 },
      { kind: "finalization", count: 1 },
      { kind: "verification_observation", count: 1 },
    ],
    edgeTypeCounts: [{ kind: "run_contains", count: 1 }],
  });
}

export function semanticInputFixture() {
  return {
    run: run(),
    finalization: finalization(),
    evidenceGraphArtifactId: "graph-1",
    evidenceGraph: graph(),
    verificationArtifactId: "verification-1",
    verification: verification(),
  };
}

export function unavailableSemanticInputFixture() {
  const fixture = semanticInputFixture();
  return {
    ...fixture,
    evidenceGraph: DeterministicEvidenceGraphV1Schema.parse({
      ...fixture.evidenceGraph,
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      nodes: [],
      edges: [],
      nodeKindCounts: [],
      edgeTypeCounts: [],
    }),
  };
}
