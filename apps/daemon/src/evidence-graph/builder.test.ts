import {
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  DeterministicEvidenceGraphV1Schema,
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "@ownloop/contracts";
import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { describe, expect, it } from "vitest";

import type {
  GitBaseline,
  GitReconciliation,
  RunArtifactRecord,
  RunFinalization,
  TaskRun,
} from "../persistence/index.js";
import { buildDeterministicEvidenceGraph } from "./builder.js";

const at = "2026-07-23T00:00:00.000Z";
const fingerprint = "a".repeat(64);

function event(
  eventId: string,
  sequence: number,
  type: NormalizedEventEnvelope["type"],
  source: NormalizedEventEnvelope["source"] = "ownloop",
): NormalizedEventEnvelope {
  return {
    eventId,
    schemaVersion: 1,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence,
    type,
    source,
    sourceEventName: source === "claude_code" ? "PostToolUse" : null,
    sourceEventId: source === "claude_code" ? `source-${eventId}` : null,
    occurredAt: at,
    ingestedAt: at,
    sensitivity: "normal",
    payload: {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  };
}

function artifactRecord(artifactId: string, role: string, kind = role): RunArtifactRecord {
  return {
    reference: { runId: "run-1", artifactId, role, createdAt: at },
    artifact: {
      artifactId,
      digest: `sha256:${"b".repeat(64)}`,
      storagePath: `objects/sha256/bb/${"b".repeat(62)}`,
      sizeBytes: 100,
      kind,
      sensitivity: "sensitive",
      storageVersion: 1,
      mediaType: "application/json",
      createdAt: at,
    },
  };
}

function fixture() {
  const events = [
    event("event-run", 1, "run.started"),
    event("event-baseline", 2, "snapshot.baseline_captured"),
    event("event-source-command", 3, "tool.succeeded", "claude_code"),
    event("event-stop", 4, "run.stop_observed", "claude_code"),
    event("event-reconciliation", 5, "git.diff_computed"),
    event("event-file", 6, "file.modified"),
    event("event-final-snapshot", 7, "snapshot.final_captured"),
    event("event-terminal", 8, "run.completed"),
    event("event-command", 9, "command.completed"),
    event("event-test", 10, "test.observed"),
  ];
  const run: TaskRun = {
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt: "redacted",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: at,
    endedAt: at,
    status: "Completed",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  };
  const finalization: RunFinalization = {
    finalizationId: "finalization-1",
    runId: "run-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    terminalStatus: "Completed",
    mode: "normal",
    triggerEventId: "event-stop",
    reconciliationId: "reconciliation-1",
    manifestArtifactId: "manifest-1",
    finalFingerprint: fingerprint,
    finalSnapshotEventId: "event-final-snapshot",
    terminalEventId: "event-terminal",
    diagnosticCode: null,
    finalizedAt: at,
    generatorVersion: "0.1.0",
  };
  const baseline: GitBaseline = {
    baselineId: "baseline-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineEventId: "event-baseline",
    outcome: "captured",
    diagnosticCode: null,
    repositoryRoot: "/private/repository",
    headCommit: null,
    stagedDiffSha256: null,
    unstagedDiffSha256: null,
    statusBeforeSha256: null,
    statusAfterSha256: null,
    workingTreeFingerprint: null,
    stagedDirty: false,
    unstagedDirty: false,
    untrackedCount: 0,
    untrackedHashedCount: 0,
    untrackedOmittedCount: 0,
    capturedAt: at,
    captureDelayMs: 0,
    entries: [],
  };
  const reconciliation: GitReconciliation = {
    reconciliationId: "reconciliation-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineId: "baseline-1",
    triggerEventId: "event-stop",
    summaryEventId: "event-reconciliation",
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot: "/private/repository",
    headCommit: null,
    stagedDiffSha256: null,
    unstagedDiffSha256: null,
    statusBeforeSha256: null,
    statusAfterSha256: null,
    workingTreeFingerprint: null,
    stagedDirty: false,
    unstagedDirty: true,
    entryCount: 1,
    createdCount: 0,
    modifiedCount: 1,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: at,
    entries: [
      {
        reconciliationId: "reconciliation-1",
        entryIndex: 0,
        fileEventId: "event-file",
        pathIdentitySha256: "c".repeat(64),
        relativePath: "src/private.test.ts",
        changeKind: "modified",
        staged: false,
        unstaged: true,
        sensitivity: "normal",
        attribution: "run_relative",
      },
    ],
  };
  const classification = {
    schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CHANGE_CLASSIFIER_VERSION,
    taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
    ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    reconciliationId: "reconciliation-1",
    outcome: "classified" as const,
    diagnosticCode: null,
    inputFingerprint: fingerprint,
    entries: [
      {
        entryIndex: 0,
        fileEventId: "event-file",
        changeKind: "modified" as const,
        attribution: "run_relative" as const,
        sensitivity: "normal" as const,
        labels: [
          {
            label: "tests" as const,
            confidenceBasisPoints: 9500,
            evidence: [{ ruleId: "tests.suffix", kind: "path_pattern" as const }],
          },
        ],
      },
    ],
    aggregateLabels: [
      { label: "tests" as const, entryCount: 1, maximumConfidenceBasisPoints: 9500 },
    ],
  };
  const verification = {
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
    commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
    outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    classificationArtifactId: "classification-1",
    classificationInputFingerprint: fingerprint,
    sourceEventCount: 8,
    outcome: "extracted" as const,
    diagnosticCode: null,
    inputFingerprint: "d".repeat(64),
    commandObservations: [
      {
        observationIndex: 0,
        sourceEventId: "event-source-command",
        commandFingerprint: "e".repeat(64),
        kind: "test" as const,
        ruleId: "test.vitest",
        toolFamily: "vitest" as const,
        sourceToolOutcome: "succeeded" as const,
        exitCode: 0,
        status: "passed" as const,
        reducedOutputs: [],
        commandEventId: "event-command",
        verificationEventId: "event-test",
      },
    ],
    testFileChanges: [
      {
        entryIndex: 0,
        fileEventId: "event-file",
        classificationRuleIds: ["tests.suffix"],
      },
    ],
    aggregates: {
      commandObservationCount: 1,
      recognizedCommandCount: 1,
      unknownCommandCount: 0,
      testFileChangeCount: 1,
      kinds: [
        {
          kind: "test" as const,
          observationCount: 1,
          passedCount: 1,
          failedCount: 0,
          observedWithoutExitCodeCount: 0,
        },
      ],
    },
  };
  return {
    run,
    finalization,
    events,
    receiptGroups: [{ receiptId: "receipt-1", eventIds: ["event-stop"] }],
    baseline,
    reconciliations: [reconciliation],
    evidenceGaps: [],
    artifactRecords: [
      artifactRecord("manifest-1", "final-diff-manifest-v1"),
      artifactRecord("classification-1", "deterministic-change-classification-v1"),
      artifactRecord("verification-1", "deterministic-verification-evidence-v1"),
    ],
    classificationArtifactId: "classification-1",
    classification,
    verificationArtifactId: "verification-1",
    verification,
  };
}

describe("deterministic Evidence Graph builder", () => {
  it("builds byte-stable source-backed nodes and edges without sensitive source values", () => {
    const first = buildDeterministicEvidenceGraph(fixture());
    const second = buildDeterministicEvidenceGraph(fixture());
    expect(first).toEqual(second);
    expect(DeterministicEvidenceGraphV1Schema.safeParse(first).success).toBe(true);
    expect(first.limitations).toEqual(["diff_hunks_not_retained"]);
    expect(first.outcome).toBe("partial");
    expect(first.nodes.some((node) => node.kind === "classification_rule")).toBe(true);
    expect(first.edges.some((edge) => edge.type === "classification_supported_by_rule")).toBe(true);
    expect(first.edges.some((edge) => edge.type === "changed_file_emitted_event")).toBe(true);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("/private/repository");
    expect(serialized).not.toContain("src/private.test.ts");
    expect(serialized).not.toContain("pathIdentitySha256");
    expect(serialized).not.toContain("commandFingerprint");
  });

  it("rejects missing persisted endpoints instead of inferring relationships", () => {
    const input = fixture();
    input.events.splice(5, 1);
    input.events.forEach((item, index) => {
      Object.assign(item, { sequence: index + 1 });
    });
    expect(() => buildDeterministicEvidenceGraph(input)).toThrowError();
  });
});
