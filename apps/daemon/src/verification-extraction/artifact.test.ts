import {
  CHANGE_CLASSIFICATION_RULE_SET_VERSION,
  CHANGE_CLASSIFICATION_SCHEMA_VERSION,
  CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
  CHANGE_CLASSIFIER_VERSION,
  DeterministicChangeClassificationV1Schema,
} from "@ownloop/contracts";
import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { describe, expect, it } from "vitest";

import type { RunFinalization } from "../persistence/index.js";
import {
  parseCanonicalVerificationEvidence,
  prepareDeterministicVerificationEvidence,
} from "./artifact.js";

const sha = "a".repeat(64);

function finalization(): RunFinalization {
  return {
    finalizationId: "finalization-1",
    runId: "run-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    terminalStatus: "Completed",
    mode: "normal",
    triggerEventId: "stop-event",
    reconciliationId: "reconciliation-1",
    manifestArtifactId: "manifest-1",
    finalFingerprint: "fingerprint-1",
    finalSnapshotEventId: "snapshot-event",
    terminalEventId: "terminal-event",
    diagnosticCode: null,
    finalizedAt: "2026-07-23T08:00:00.000Z",
    generatorVersion: "0.1.0",
  };
}

function classification(outcome: "classified" | "partial" | "unavailable" = "classified") {
  const unavailable = outcome === "unavailable";
  return DeterministicChangeClassificationV1Schema.parse({
    schemaVersion: CHANGE_CLASSIFICATION_SCHEMA_VERSION,
    classifierVersion: CHANGE_CLASSIFIER_VERSION,
    taxonomyVersion: CHANGE_CLASSIFICATION_TAXONOMY_VERSION,
    ruleSetVersion: CHANGE_CLASSIFICATION_RULE_SET_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    reconciliationId: unavailable ? null : "reconciliation-1",
    outcome,
    diagnosticCode:
      outcome === "partial"
        ? "reconciliation_partial"
        : unavailable
          ? "reconciliation_unavailable"
          : null,
    inputFingerprint: sha,
    entries: unavailable
      ? []
      : [
          {
            entryIndex: 0,
            fileEventId: "file-event-1",
            changeKind: "modified",
            attribution: "run_relative",
            sensitivity: "normal",
            labels: [
              {
                label: "tests",
                confidenceBasisPoints: 9500,
                evidence: [{ ruleId: "segment.tests", kind: "path_segment" }],
              },
            ],
          },
        ],
    aggregateLabels: unavailable
      ? []
      : [{ label: "tests", entryCount: 1, maximumConfidenceBasisPoints: 9500 }],
  });
}

function event(
  type: "tool.succeeded" | "tool.failed",
  payload: Record<string, unknown>,
): NormalizedEventEnvelope {
  return {
    eventId: "source-event-1",
    schemaVersion: 1,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: 1,
    type,
    source: "claude_code",
    sourceEventName: type === "tool.succeeded" ? "PostToolUse" : "PostToolUseFailure",
    sourceEventId: "tool-use-1",
    occurredAt: "2026-07-23T07:59:00.000Z",
    ingestedAt: "2026-07-23T07:59:01.000Z",
    sensitivity: "sensitive",
    payload,
    metadata: { collectorVersion: "0.1.0", sourceVersion: "1" },
  } as NormalizedEventEnvelope;
}

describe("verification evidence artifact", () => {
  it("produces byte-identical canonical output", () => {
    const input = {
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-1",
      classification: classification(),
      events: [
        event("tool.succeeded", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { exitCode: 0, stdout: "PASS" },
        }),
      ],
    };
    const first = prepareDeterministicVerificationEvidence(input);
    const second = prepareDeterministicVerificationEvidence(input);
    expect(first.bytes).toEqual(second.bytes);
    expect(parseCanonicalVerificationEvidence(first.bytes)).toEqual(first.value);
    expect(first.value.commandObservations[0]).toMatchObject({
      kind: "test",
      sourceToolOutcome: "succeeded",
      exitCode: 0,
      status: "passed",
    });
  });

  it("keeps test-file changes separate from test execution", () => {
    const prepared = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-1",
      classification: classification(),
      events: [],
    });
    expect(prepared.value.commandObservations).toEqual([]);
    expect(prepared.value.testFileChanges).toEqual([
      {
        entryIndex: 0,
        fileEventId: "file-event-1",
        classificationRuleIds: ["segment.tests"],
      },
    ]);
    expect(prepared.value.aggregates.recognizedCommandCount).toBe(0);
  });

  it("propagates partial and unavailable classification evidence", () => {
    const partial = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-partial",
      classification: classification("partial"),
      events: [],
    });
    expect(partial.value).toMatchObject({
      outcome: "partial",
      diagnosticCode: "classification_partial",
      commandObservations: [],
      testFileChanges: [{ entryIndex: 0 }],
    });

    const unavailable = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-unavailable",
      classification: classification("unavailable"),
      events: [],
    });
    expect(unavailable.value).toMatchObject({
      outcome: "unavailable",
      diagnosticCode: "classification_unavailable",
      commandObservations: [],
      testFileChanges: [],
    });

    const commandOnlyPartial = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-unavailable",
      classification: classification("unavailable"),
      events: [
        event("tool.succeeded", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { exitCode: 0 },
        }),
      ],
    });
    expect(commandOnlyPartial.value).toMatchObject({
      outcome: "partial",
      diagnosticCode: "classification_unavailable",
      commandObservations: [{ kind: "test", status: "passed" }],
      testFileChanges: [],
    });
  });

  it("does not let output text override a failed source Event", () => {
    const prepared = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-1",
      classification: classification(),
      events: [
        event("tool.failed", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          error: "all tests passed",
        }),
      ],
    });
    expect(prepared.value.commandObservations[0]).toMatchObject({
      kind: "test",
      sourceToolOutcome: "failed",
      exitCode: null,
      status: "failed",
    });
  });

  it("rejects more than 500 accepted command observations", () => {
    const events = Array.from({ length: 501 }, (_, index) => ({
      ...event("tool.succeeded", {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { exitCode: 0 },
      }),
      eventId: `source-event-${index}`,
      sequence: index + 1,
    }));
    expect(() =>
      prepareDeterministicVerificationEvidence({
        runId: "run-1",
        finalization: finalization(),
        classificationArtifactId: "classification-1",
        classification: classification(),
        events,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_persisted_row" }));
  });

  it("maps an oversized canonical artifact to a controlled operation failure", () => {
    const events = Array.from({ length: 500 }, (_, index) => ({
      ...event("tool.succeeded", {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { exitCode: 0, stdout: "x".repeat(4096) },
      }),
      eventId: `source-event-${index}`,
      sequence: index + 1,
    }));
    expect(() =>
      prepareDeterministicVerificationEvidence({
        runId: "run-1",
        finalization: finalization(),
        classificationArtifactId: "classification-1",
        classification: classification(),
        events,
      }),
    ).toThrowError(expect.objectContaining({ code: "operation_failed" }));
  });

  it("marks missing command evidence partial and unknown", () => {
    const prepared = prepareDeterministicVerificationEvidence({
      runId: "run-1",
      finalization: finalization(),
      classificationArtifactId: "classification-1",
      classification: classification(),
      events: [
        event("tool.succeeded", {
          tool_name: "Bash",
          tool_input: {},
          tool_response: { stdout: "output" },
        }),
      ],
    });
    expect(prepared.value.outcome).toBe("partial");
    expect(prepared.value.commandObservations[0]).toMatchObject({
      commandFingerprint: null,
      kind: "unknown",
      status: "unknown",
      verificationEventId: null,
    });
  });
});
