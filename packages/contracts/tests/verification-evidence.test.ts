import { describe, expect, it } from "vitest";

import {
  DeterministicVerificationEvidenceV1Schema,
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "../src/index.js";

const sha = "a".repeat(64);

function validArtifact() {
  return {
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
    commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
    outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    runId: "run-1",
    finalizationId: "finalization-1",
    classificationArtifactId: "classification-1",
    classificationInputFingerprint: sha,
    sourceEventCount: 5,
    outcome: "extracted",
    diagnosticCode: null,
    inputFingerprint: sha,
    commandObservations: [
      {
        observationIndex: 0,
        sourceEventId: "source-event-1",
        commandFingerprint: sha,
        kind: "test",
        ruleId: "package_script.test",
        toolFamily: "pnpm",
        sourceToolOutcome: "succeeded",
        exitCode: 0,
        status: "passed",
        reducedOutputs: [
          {
            field: "stdout",
            acceptedByteCount: 4,
            acceptedSha256: sha,
            excerpt: "pass",
            excerptByteCount: 4,
            lineCount: 1,
            truncated: false,
          },
        ],
        commandEventId: "derived-command-1",
        verificationEventId: "derived-test-1",
      },
    ],
    testFileChanges: [
      {
        entryIndex: 0,
        fileEventId: "file-event-1",
        classificationRuleIds: ["segment.tests"],
      },
    ],
    aggregates: {
      commandObservationCount: 1,
      recognizedCommandCount: 1,
      unknownCommandCount: 0,
      testFileChangeCount: 1,
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
  } as const;
}

describe("deterministic verification evidence contract", () => {
  it("accepts a strict evidence-backed artifact", () => {
    expect(DeterministicVerificationEvidenceV1Schema.parse(validArtifact())).toEqual(
      validArtifact(),
    );
  });

  it.each([
    ["raw command", { command: "pnpm test" }],
    ["repository path", { repositoryRoot: "/private/repo" }],
    ["artifact storage path", { storagePath: "/private/artifacts/object" }],
    ["source session", { sourceSessionId: "session-secret" }],
  ])("rejects forbidden extra field %s", (_name, extra) => {
    expect(() =>
      DeterministicVerificationEvidenceV1Schema.parse({ ...validArtifact(), ...extra }),
    ).toThrow();
  });

  it.each([
    ["partial source", "partial", "source_observation_partial"],
    ["partial classification", "partial", "classification_partial"],
    ["combined partial", "partial", "source_and_classification_partial"],
    ["classification unavailable with retained commands", "partial", "classification_unavailable"],
  ])("accepts controlled diagnostic mapping for %s", (_name, outcome, diagnosticCode) => {
    expect(() =>
      DeterministicVerificationEvidenceV1Schema.parse({
        ...validArtifact(),
        outcome,
        diagnosticCode,
      }),
    ).not.toThrow();
  });

  it("accepts unavailable evidence only without retained observations", () => {
    const value = validArtifact();
    expect(() =>
      DeterministicVerificationEvidenceV1Schema.parse({
        ...value,
        outcome: "unavailable",
        diagnosticCode: "classification_unavailable",
        commandObservations: [],
        testFileChanges: [],
        aggregates: {
          commandObservationCount: 0,
          recognizedCommandCount: 0,
          unknownCommandCount: 0,
          testFileChangeCount: 0,
          kinds: [],
        },
      }),
    ).not.toThrow();
  });

  it("rejects source-outcome and exit-code disagreement", () => {
    const value = validArtifact();
    expect(() =>
      DeterministicVerificationEvidenceV1Schema.parse({
        ...value,
        commandObservations: [
          { ...value.commandObservations[0], sourceToolOutcome: "succeeded", exitCode: 2 },
        ],
      }),
    ).toThrow();
  });

  it("requires unknown observations to omit verification Events", () => {
    const value = validArtifact();
    expect(() =>
      DeterministicVerificationEvidenceV1Schema.parse({
        ...value,
        commandObservations: [
          {
            ...value.commandObservations[0],
            kind: "unknown",
            ruleId: "unknown.unsupported_command",
            toolFamily: "unknown",
            status: "unknown",
            verificationEventId: "not-allowed",
          },
        ],
      }),
    ).toThrow();
  });
});
