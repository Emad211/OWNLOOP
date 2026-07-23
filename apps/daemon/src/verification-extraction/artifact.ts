import { createHash } from "node:crypto";

import {
  type DeterministicChangeClassificationV1,
  type DeterministicVerificationEvidenceV1,
  DeterministicVerificationEvidenceV1Schema,
  type VerificationCommandObservationV1,
  type VerificationEvidenceAggregatesV1,
  type VerificationTestFileChangeV1,
} from "@ownloop/contracts";
import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import { type RunFinalization, PersistenceError } from "../persistence/index.js";
import {
  VERIFICATION_COMMAND_RULE_SET_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_MAX_ARTIFACT_BYTES,
  VERIFICATION_MAX_COMMAND_OBSERVATIONS,
  VERIFICATION_MAX_RUN_EVENTS,
  VERIFICATION_MAX_TEST_FILE_REFERENCES,
  VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
} from "./constants.js";
import { acceptedBashObservation } from "./source.js";

const ARTIFACT_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: VERIFICATION_MAX_ARTIFACT_BYTES,
});
const INPUT_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: 32 * 1024 * 1024,
});
const encoder = new TextEncoder();

export type PreparedVerificationEvidence = Readonly<{
  value: DeterministicVerificationEvidenceV1;
  canonicalJson: string;
  bytes: Uint8Array;
}>;

function deterministicEventId(runId: string, sourceEventId: string, suffix: string): string {
  const digest = createHash("sha256")
    .update(`ownloop-verification-event-v1\0${runId}\0${sourceEventId}\0${suffix}`)
    .digest("hex");
  return `verification-${digest.slice(0, 48)}`;
}

function validateEvents(runId: string, events: readonly NormalizedEventEnvelope[]): void {
  if (events.length > VERIFICATION_MAX_RUN_EVENTS) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification source exceeds the supported Run Event limit.",
    );
  }
  for (const [index, event] of events.entries()) {
    if (event.runId !== runId || event.sequence !== index + 1) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The verification source Event sequence is not contiguous.",
      );
    }
  }
}

function testFileChanges(
  classification: DeterministicChangeClassificationV1,
): VerificationTestFileChangeV1[] {
  const changes = classification.entries.flatMap((entry) => {
    const tests = entry.labels.find((assigned) => assigned.label === "tests");
    if (tests === undefined) return [];
    return [
      {
        entryIndex: entry.entryIndex,
        fileEventId: entry.fileEventId,
        classificationRuleIds: tests.evidence.map((evidence) => evidence.ruleId).toSorted(),
      },
    ];
  });
  if (changes.length > VERIFICATION_MAX_TEST_FILE_REFERENCES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification source exceeds the supported test-file reference limit.",
    );
  }
  return changes;
}

function aggregates(
  observations: readonly VerificationCommandObservationV1[],
  testChanges: readonly VerificationTestFileChangeV1[],
): VerificationEvidenceAggregatesV1 {
  const kinds = (["test", "lint", "typecheck", "build"] as const).flatMap((kind) => {
    const matching = observations.filter((entry) => entry.kind === kind);
    if (matching.length === 0) return [];
    return [
      {
        kind,
        observationCount: matching.length,
        passedCount: matching.filter((entry) => entry.status === "passed").length,
        failedCount: matching.filter((entry) => entry.status === "failed").length,
        observedWithoutExitCodeCount: matching.filter(
          (entry) => entry.status === "observed_without_exit_code",
        ).length,
      },
    ];
  });
  const recognized = observations.filter((entry) => entry.kind !== "unknown").length;
  return {
    commandObservationCount: observations.length,
    recognizedCommandCount: recognized,
    unknownCommandCount: observations.length - recognized,
    testFileChangeCount: testChanges.length,
    kinds,
  };
}

function canonicalizePrepared(
  value: unknown,
  limits: CanonicalJsonLimits,
  message: string,
): string {
  try {
    return canonicalizeJson(value, limits);
  } catch {
    throw new PersistenceError("operation_failed", message);
  }
}

function inputFingerprint(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(
      canonicalizePrepared(
        value,
        INPUT_LIMITS,
        "The verification input exceeds its canonical limits.",
      ),
    )
    .digest("hex");
}

export function prepareDeterministicVerificationEvidence(
  input: Readonly<{
    runId: string;
    finalization: RunFinalization;
    classificationArtifactId: string;
    classification: DeterministicChangeClassificationV1;
    events: readonly NormalizedEventEnvelope[];
  }>,
): PreparedVerificationEvidence {
  if (
    input.finalization.runId !== input.runId ||
    input.classification.runId !== input.runId ||
    input.classification.finalizationId !== input.finalization.finalizationId
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification source ownership is inconsistent.",
    );
  }
  validateEvents(input.runId, input.events);
  const accepted = input.events.flatMap((event) => {
    const observation = acceptedBashObservation(event);
    return observation === null ? [] : [observation];
  });
  if (accepted.length > VERIFICATION_MAX_COMMAND_OBSERVATIONS) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification source exceeds the supported command observation limit.",
    );
  }
  const observations: VerificationCommandObservationV1[] = accepted.map((source, index) => {
    const status =
      source.recognition.kind === "unknown"
        ? "unknown"
        : source.sourceToolOutcome === "failed"
          ? "failed"
          : source.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";
    return {
      observationIndex: index,
      sourceEventId: source.sourceEventId,
      commandFingerprint: source.commandFingerprint,
      kind: source.recognition.kind,
      ruleId: source.recognition.ruleId,
      toolFamily: source.recognition.toolFamily,
      sourceToolOutcome: source.sourceToolOutcome,
      exitCode: source.exitCode,
      status,
      reducedOutputs: [...source.reducedOutputs],
      commandEventId: deterministicEventId(input.runId, source.sourceEventId, "command"),
      verificationEventId:
        source.recognition.kind === "unknown"
          ? null
          : deterministicEventId(input.runId, source.sourceEventId, source.recognition.kind),
    };
  });
  const testChanges = testFileChanges(input.classification);
  const sourcePartial = accepted.some((entry) => entry.partial);
  const classificationPartial = input.classification.outcome === "partial";
  const classificationUnavailable = input.classification.outcome === "unavailable";
  const outcome =
    classificationUnavailable && accepted.length === 0
      ? "unavailable"
      : sourcePartial || classificationPartial || classificationUnavailable
        ? "partial"
        : "extracted";
  const diagnosticCode = classificationUnavailable
    ? "classification_unavailable"
    : sourcePartial && classificationPartial
      ? "source_and_classification_partial"
      : sourcePartial
        ? "source_observation_partial"
        : classificationPartial
          ? "classification_partial"
          : null;
  const fingerprintInput = {
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
    commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
    outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    runId: input.runId,
    finalizationId: input.finalization.finalizationId,
    classificationArtifactId: input.classificationArtifactId,
    classificationInputFingerprint: input.classification.inputFingerprint,
    sourceEventCount: input.events.length,
    sourceObservations: accepted.map((source) => ({
      sourceEventId: source.sourceEventId,
      occurredAt: source.occurredAt,
      sourceToolOutcome: source.sourceToolOutcome,
      commandFingerprint: source.commandFingerprint,
      recognition: source.recognition,
      exitCode: source.exitCode,
      reducedOutputs: source.reducedOutputs.map((output) => ({
        field: output.field,
        acceptedByteCount: output.acceptedByteCount,
        acceptedSha256: output.acceptedSha256,
      })),
      partial: source.partial,
    })),
    testFileChanges: testChanges,
  };
  const value = DeterministicVerificationEvidenceV1Schema.parse({
    schemaVersion: VERIFICATION_EVIDENCE_SCHEMA_VERSION,
    extractorVersion: VERIFICATION_EXTRACTOR_VERSION,
    commandRuleSetVersion: VERIFICATION_COMMAND_RULE_SET_VERSION,
    outputReductionPolicyVersion: VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION,
    runId: input.runId,
    finalizationId: input.finalization.finalizationId,
    classificationArtifactId: input.classificationArtifactId,
    classificationInputFingerprint: input.classification.inputFingerprint,
    sourceEventCount: input.events.length,
    outcome,
    diagnosticCode,
    inputFingerprint: inputFingerprint(fingerprintInput),
    commandObservations: observations,
    testFileChanges: testChanges,
    aggregates: aggregates(observations, testChanges),
  });
  const canonicalJson = canonicalizePrepared(
    value,
    ARTIFACT_LIMITS,
    "The deterministic verification artifact exceeds its canonical limits.",
  );
  const bytes = encoder.encode(canonicalJson);
  if (bytes.byteLength > VERIFICATION_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "operation_failed",
      "The deterministic verification artifact exceeds the size limit.",
    );
  }
  return { value, canonicalJson, bytes };
}

export function parseCanonicalVerificationEvidence(
  bytes: Uint8Array,
): DeterministicVerificationEvidenceV1 {
  if (bytes.byteLength > VERIFICATION_MAX_ARTIFACT_BYTES) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted verification evidence exceeds the artifact size limit.",
    );
  }
  let canonical: string;
  try {
    canonical = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted verification evidence is not valid UTF-8.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical) as unknown;
    if (canonicalizeJson(parsed, ARTIFACT_LIMITS) !== canonical) {
      throw new Error("non-canonical verification evidence");
    }
  } catch {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted verification evidence is not canonical JSON.",
    );
  }
  const result = DeterministicVerificationEvidenceV1Schema.safeParse(parsed);
  if (!result.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted verification evidence contract is invalid.",
    );
  }
  return result.data;
}
