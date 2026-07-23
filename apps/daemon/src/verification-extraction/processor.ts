import type {
  DeterministicChangeClassificationV1,
  DeterministicVerificationEvidenceV1,
  VerificationEvidenceDiagnosticCode,
  VerificationEvidenceOutcome,
  VerificationKindAggregateV1,
} from "@ownloop/contracts";
import type {
  JsonObject,
  NormalizedEventEnvelope,
  NormalizedEventType,
} from "@ownloop/event-model";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  classifyFinalizedRunChanges,
  DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
  getRunChangeClassification,
  parseCanonicalChangeClassification,
} from "../change-classification/index.js";
import {
  type ArtifactMetadata,
  type OwnLoopPersistence,
  type PersistenceRepositories,
  PersistenceError,
  type RunArtifactRecord,
  type RunFinalization,
  type TaskRun,
} from "../persistence/index.js";
import {
  DETERMINISTIC_VERIFICATION_EVIDENCE_KIND,
  DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE,
  DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
  DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY,
  MAX_VERIFICATION_EXTRACTION_BATCH,
  VERIFICATION_EXTRACTOR_VERSION,
  VERIFICATION_EXTRACTION_EVENT_DEDUPLICATION_VERSION,
  VERIFICATION_MAX_ARTIFACT_BYTES,
  VERIFICATION_MAX_RUN_EVENTS,
} from "./constants.js";
import {
  parseCanonicalVerificationEvidence,
  prepareDeterministicVerificationEvidence,
  type PreparedVerificationEvidence,
} from "./artifact.js";

export type VerificationExtractionDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  clock?: () => Date;
}>;

export type VerificationExtractionResult = Readonly<{
  artifactId: string;
  schemaVersion: number;
  extractorVersion: string;
  commandRuleSetVersion: string;
  outputReductionPolicyVersion: string;
  runId: string;
  finalizationId: string;
  classificationArtifactId: string;
  outcome: VerificationEvidenceOutcome;
  diagnosticCode: VerificationEvidenceDiagnosticCode | null;
  inputFingerprint: string;
  commandObservationCount: number;
  recognizedCommandCount: number;
  unknownCommandCount: number;
  testFileChangeCount: number;
  aggregateKinds: readonly VerificationKindAggregateV1[];
  derivedEventIds: readonly string[];
}>;

type SourceFacts = Readonly<{
  run: TaskRun;
  finalization: RunFinalization;
  events: readonly NormalizedEventEnvelope[];
}>;

type ClassificationSource = Readonly<{
  artifactId: string;
  value: DeterministicChangeClassificationV1;
}>;

type PreparedVerificationBundle = Readonly<{
  prepared: PreparedVerificationEvidence;
  classification: ClassificationSource;
}>;

const TERMINAL_STATUSES = new Set(["Completed", "Partial", "Abandoned", "Failed"]);
const DERIVED_EVENT_METADATA = Object.freeze({
  collectorVersion: "0.1.0",
  sourceVersion: VERIFICATION_EXTRACTOR_VERSION,
});

function safeResult(
  artifactId: string,
  value: DeterministicVerificationEvidenceV1,
): VerificationExtractionResult {
  return {
    artifactId,
    schemaVersion: value.schemaVersion,
    extractorVersion: value.extractorVersion,
    commandRuleSetVersion: value.commandRuleSetVersion,
    outputReductionPolicyVersion: value.outputReductionPolicyVersion,
    runId: value.runId,
    finalizationId: value.finalizationId,
    classificationArtifactId: value.classificationArtifactId,
    outcome: value.outcome,
    diagnosticCode: value.diagnosticCode,
    inputFingerprint: value.inputFingerprint,
    commandObservationCount: value.aggregates.commandObservationCount,
    recognizedCommandCount: value.aggregates.recognizedCommandCount,
    unknownCommandCount: value.aggregates.unknownCommandCount,
    testFileChangeCount: value.aggregates.testFileChangeCount,
    aggregateKinds: value.aggregates.kinds,
    derivedEventIds: value.commandObservations.flatMap((observation) =>
      observation.verificationEventId === null
        ? [observation.commandEventId]
        : [observation.commandEventId, observation.verificationEventId],
    ),
  };
}

function terminalRun(run: TaskRun | null): TaskRun | null {
  return run !== null && TERMINAL_STATUSES.has(run.status) ? run : null;
}

function sourceFacts(
  persistence: PersistenceRepositories,
  runId: string,
  sourceEventCount?: number,
): SourceFacts | null {
  const run = terminalRun(persistence.taskRuns.get(runId));
  if (run === null) return null;
  const finalization = persistence.runFinalizations.getByRun(runId);
  if (finalization === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A terminal Run is missing its finalization for verification extraction.",
    );
  }
  const events =
    sourceEventCount === undefined
      ? persistence.events.listForRunBounded(runId, VERIFICATION_MAX_RUN_EVENTS)
      : persistence.events.listForRunPrefixExact(runId, sourceEventCount);
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
        "The verification extraction Event history is not contiguous.",
      );
    }
  }
  return { run, finalization, events };
}

async function classificationSource(
  dependencies: VerificationExtractionDependencies,
  runId: string,
  createIfMissing: boolean,
): Promise<ClassificationSource | null> {
  let result = await getRunChangeClassification(dependencies, runId);
  if (result === null && createIfMissing) {
    result = await classifyFinalizedRunChanges(dependencies, runId);
  }
  if (result === null) return null;
  const content = await dependencies.artifactStore.readPreparedBytes(result.artifactId);
  const value = parseCanonicalChangeClassification(content.bytes);
  if (
    value.runId !== runId ||
    value.inputFingerprint !== result.inputFingerprint ||
    value.finalizationId !== result.finalizationId
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification classification source is inconsistent.",
    );
  }
  return { artifactId: result.artifactId, value };
}

function recordForRun(
  persistence: PersistenceRepositories,
  runId: string,
): RunArtifactRecord | null {
  return persistence.artifacts.getRecordForRunRole(runId, DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE);
}

function assertMetadata(metadata: ArtifactMetadata, expectedSize?: number): void {
  if (
    metadata.storageVersion !== 1 ||
    metadata.kind !== DETERMINISTIC_VERIFICATION_EVIDENCE_KIND ||
    metadata.mediaType !== DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE ||
    metadata.sensitivity !== DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY ||
    metadata.sizeBytes > VERIFICATION_MAX_ARTIFACT_BYTES ||
    (expectedSize !== undefined && metadata.sizeBytes !== expectedSize)
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The deterministic verification artifact metadata is invalid.",
    );
  }
}

function expectedCommandEventType(
  sourceOutcome: "succeeded" | "failed",
): "command.completed" | "command.failed" {
  return sourceOutcome === "succeeded" ? "command.completed" : "command.failed";
}

function expectedVerificationEventType(
  kind: "test" | "lint" | "typecheck" | "build",
): "test.observed" | "lint.observed" | "typecheck.observed" | "build.observed" {
  return `${kind}.observed` as
    | "test.observed"
    | "lint.observed"
    | "typecheck.observed"
    | "build.observed";
}

function withOptionalExitCode(payload: JsonObject, exitCode: number | null): JsonObject {
  return exitCode === null ? payload : { ...payload, exitCode };
}

function commandPayload(
  observation: DeterministicVerificationEvidenceV1["commandObservations"][number],
): JsonObject {
  return withOptionalExitCode(
    {
      observationIndex: observation.observationIndex,
      verificationKind: observation.kind,
      status: observation.sourceToolOutcome,
      recognized: observation.kind !== "unknown",
      outputEvidencePresent: observation.reducedOutputs.length > 0,
      outputEvidenceCount: observation.reducedOutputs.length,
    },
    observation.exitCode,
  );
}

function verificationPayload(
  observation: DeterministicVerificationEvidenceV1["commandObservations"][number],
): JsonObject {
  return withOptionalExitCode(
    {
      observationIndex: observation.observationIndex,
      verificationKind: observation.kind,
      status: observation.status,
      outputEvidencePresent: observation.reducedOutputs.length > 0,
      outputEvidenceCount: observation.reducedOutputs.length,
    },
    observation.exitCode,
  );
}

function makeDerivedEvent(
  input: Readonly<{
    eventId: string;
    finalization: RunFinalization;
    sequence: number;
    type: NormalizedEventType;
    occurredAt: string;
    ingestedAt: string;
    payload: JsonObject;
  }>,
): NormalizedEventEnvelope {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    workspaceId: input.finalization.workspaceId,
    conversationId: input.finalization.conversationId,
    runId: input.finalization.runId,
    sequence: input.sequence,
    type: input.type,
    source: "ownloop",
    sourceEventName: null,
    sourceEventId: null,
    occurredAt: input.occurredAt,
    ingestedAt: input.ingestedAt,
    sensitivity: "normal",
    payload: input.payload,
    metadata: DERIVED_EVENT_METADATA,
  };
}

function assertEventEnvelope(
  event: NormalizedEventEnvelope | null,
  expected: Readonly<{
    eventId: string;
    finalization: RunFinalization;
    sequence: number;
    type: NormalizedEventType;
    occurredAt: string;
    payload: JsonObject;
  }>,
): asserts event is NormalizedEventEnvelope {
  if (
    event === null ||
    event.eventId !== expected.eventId ||
    event.workspaceId !== expected.finalization.workspaceId ||
    event.conversationId !== expected.finalization.conversationId ||
    event.runId !== expected.finalization.runId ||
    event.sequence !== expected.sequence ||
    event.type !== expected.type ||
    event.source !== "ownloop" ||
    event.sourceEventName !== null ||
    event.sourceEventId !== null ||
    event.occurredAt !== expected.occurredAt ||
    event.sensitivity !== "normal" ||
    JSON.stringify(event.payload) !== JSON.stringify(expected.payload) ||
    event.metadata.collectorVersion !== DERIVED_EVENT_METADATA.collectorVersion ||
    event.metadata.sourceVersion !== DERIVED_EVENT_METADATA.sourceVersion
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A persisted derived verification Event is inconsistent.",
    );
  }
}

function assertDeduplication(
  persistence: PersistenceRepositories,
  finalization: RunFinalization,
  eventId: string,
  deduplicationKey: string,
  createdAt: string,
): void {
  const records = persistence.events.listDeduplicationRecordsForEvent(eventId);
  const record = records[0];
  if (
    records.length !== 1 ||
    record?.source !== "ownloop" ||
    record.sourceSessionId !== finalization.conversationId ||
    record.deduplicationKey !== deduplicationKey ||
    record.eventId !== eventId ||
    record.createdAt !== createdAt
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A persisted derived verification Event deduplication record is inconsistent.",
    );
  }
}

function assertDerivedEvents(
  persistence: PersistenceRepositories,
  finalization: RunFinalization,
  sourceEvents: readonly NormalizedEventEnvelope[],
  value: DeterministicVerificationEvidenceV1,
): void {
  const sources = new Map(sourceEvents.map((event) => [event.eventId, event]));
  let sequence = value.sourceEventCount + 1;
  for (const observation of value.commandObservations) {
    const source = sources.get(observation.sourceEventId);
    if (source === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A verification observation source Event is missing.",
      );
    }
    const commandEvent = persistence.events.get(observation.commandEventId);
    assertEventEnvelope(commandEvent, {
      eventId: observation.commandEventId,
      finalization,
      sequence,
      type: expectedCommandEventType(observation.sourceToolOutcome),
      occurredAt: source.occurredAt,
      payload: commandPayload(observation),
    });
    assertDeduplication(
      persistence,
      finalization,
      observation.commandEventId,
      `${VERIFICATION_EXTRACTION_EVENT_DEDUPLICATION_VERSION}:${value.runId}:${observation.sourceEventId}:command`,
      commandEvent.ingestedAt,
    );
    sequence += 1;

    if (observation.verificationEventId === null) {
      if (observation.kind !== "unknown") {
        throw new PersistenceError(
          "invalid_persisted_row",
          "A recognized verification observation is missing its derived Event.",
        );
      }
      continue;
    }
    if (observation.kind === "unknown") {
      throw new PersistenceError(
        "invalid_persisted_row",
        "An unknown verification observation has a derived verification Event.",
      );
    }
    const verificationEvent = persistence.events.get(observation.verificationEventId);
    assertEventEnvelope(verificationEvent, {
      eventId: observation.verificationEventId,
      finalization,
      sequence,
      type: expectedVerificationEventType(observation.kind),
      occurredAt: source.occurredAt,
      payload: verificationPayload(observation),
    });
    if (verificationEvent.ingestedAt !== commandEvent.ingestedAt) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Derived command and verification Events have inconsistent extraction times.",
      );
    }
    assertDeduplication(
      persistence,
      finalization,
      observation.verificationEventId,
      `${VERIFICATION_EXTRACTION_EVENT_DEDUPLICATION_VERSION}:${value.runId}:${observation.sourceEventId}:${observation.kind}`,
      verificationEvent.ingestedAt,
    );
    sequence += 1;
  }
}

async function readAndValidate(
  dependencies: VerificationExtractionDependencies,
  record: RunArtifactRecord,
): Promise<VerificationExtractionResult> {
  if (record.reference.role !== DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact reference role is invalid.",
    );
  }
  assertMetadata(record.artifact);
  const content = await dependencies.artifactStore.readPreparedBytes(record.artifact.artifactId);
  if (
    content.artifactId !== record.artifact.artifactId ||
    content.kind !== DETERMINISTIC_VERIFICATION_EVIDENCE_KIND ||
    content.mediaType !== DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE ||
    content.sensitivity !== DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY ||
    content.sizeBytes !== record.artifact.sizeBytes
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact read metadata is inconsistent.",
    );
  }
  const value = parseCanonicalVerificationEvidence(content.bytes);
  if (value.runId !== record.reference.runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact Run ownership is inconsistent.",
    );
  }
  const source = sourceFacts(dependencies.persistence, value.runId, value.sourceEventCount);
  if (source === null || source.finalization.finalizationId !== value.finalizationId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact finalization linkage is inconsistent.",
    );
  }
  const classification = await classificationSource(dependencies, value.runId, false);
  if (
    classification === null ||
    classification.artifactId !== value.classificationArtifactId ||
    classification.value.inputFingerprint !== value.classificationInputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact classification linkage is inconsistent.",
    );
  }
  const expected = prepareDeterministicVerificationEvidence({
    runId: source.run.runId,
    finalization: source.finalization,
    classificationArtifactId: classification.artifactId,
    classification: classification.value,
    events: source.events,
  });
  if (expected.canonicalJson !== new TextDecoder().decode(content.bytes)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The verification artifact no longer matches accepted source facts.",
    );
  }
  assertDerivedEvents(dependencies.persistence, source.finalization, source.events, value);
  return safeResult(record.artifact.artifactId, value);
}

export async function getRunVerificationEvidence(
  dependencies: VerificationExtractionDependencies,
  runId: string,
): Promise<VerificationExtractionResult | null> {
  const record = recordForRun(dependencies.persistence, runId);
  return record === null ? null : readAndValidate(dependencies, record);
}

function persistPrepared(
  dependencies: VerificationExtractionDependencies,
  bundle: PreparedVerificationBundle,
  artifactId: string,
  ingestedAt: string,
): "created" | "existing" {
  const { prepared, classification } = bundle;
  return dependencies.persistence.withTransaction((repositories) => {
    const existing = recordForRun(repositories, prepared.value.runId);
    if (existing !== null) return "existing";

    const source = sourceFacts(repositories, prepared.value.runId);
    if (source === null) {
      throw new PersistenceError("operation_failed", "The verification Run is no longer terminal.");
    }
    const classificationRecord = repositories.artifacts.getRecordForRunRole(
      prepared.value.runId,
      DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
    );
    if (
      classificationRecord === null ||
      classificationRecord.artifact.artifactId !== classification.artifactId
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The verification classification changed before persistence.",
      );
    }
    const current = prepareDeterministicVerificationEvidence({
      runId: source.run.runId,
      finalization: source.finalization,
      classificationArtifactId: classification.artifactId,
      classification: classification.value,
      events: source.events,
    });
    if (current.canonicalJson !== prepared.canonicalJson) {
      throw new PersistenceError(
        "operation_failed",
        "The verification source changed before persistence.",
      );
    }
    const metadata = repositories.artifacts.getMetadata(artifactId);
    if (metadata === null) {
      throw new PersistenceError(
        "operation_failed",
        "The materialized verification artifact metadata is missing.",
      );
    }
    assertMetadata(metadata, prepared.bytes.byteLength);
    const referenceCreated = repositories.artifacts.linkToRun({
      runId: prepared.value.runId,
      artifactId,
      role: DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
      createdAt: ingestedAt,
    });
    if (!referenceCreated) {
      throw new PersistenceError(
        "operation_failed",
        "The verification artifact reference could not be created.",
      );
    }

    const sourceEvents = new Map(source.events.map((event) => [event.eventId, event]));
    let sequence = repositories.events.nextSequence(prepared.value.runId);
    if (sequence !== prepared.value.sourceEventCount + 1) {
      throw new PersistenceError(
        "operation_failed",
        "The verification Event sequence changed before persistence.",
      );
    }
    for (const observation of prepared.value.commandObservations) {
      const sourceEvent = sourceEvents.get(observation.sourceEventId);
      if (sourceEvent === undefined) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "A verification source Event disappeared before persistence.",
        );
      }
      repositories.events.append(
        makeDerivedEvent({
          eventId: observation.commandEventId,
          finalization: source.finalization,
          sequence,
          type: expectedCommandEventType(observation.sourceToolOutcome),
          occurredAt: sourceEvent.occurredAt,
          ingestedAt,
          payload: commandPayload(observation),
        }),
      );
      repositories.events.recordDeduplicationKey({
        source: "ownloop",
        sourceSessionId: source.finalization.conversationId,
        deduplicationKey: `${VERIFICATION_EXTRACTION_EVENT_DEDUPLICATION_VERSION}:${prepared.value.runId}:${observation.sourceEventId}:command`,
        eventId: observation.commandEventId,
        createdAt: ingestedAt,
      });
      sequence += 1;

      if (observation.verificationEventId === null) continue;
      if (observation.kind === "unknown") {
        throw new PersistenceError(
          "invalid_persisted_row",
          "An unknown command cannot produce a verification Event.",
        );
      }
      repositories.events.append(
        makeDerivedEvent({
          eventId: observation.verificationEventId,
          finalization: source.finalization,
          sequence,
          type: expectedVerificationEventType(observation.kind),
          occurredAt: sourceEvent.occurredAt,
          ingestedAt,
          payload: verificationPayload(observation),
        }),
      );
      repositories.events.recordDeduplicationKey({
        source: "ownloop",
        sourceSessionId: source.finalization.conversationId,
        deduplicationKey: `${VERIFICATION_EXTRACTION_EVENT_DEDUPLICATION_VERSION}:${prepared.value.runId}:${observation.sourceEventId}:${observation.kind}`,
        eventId: observation.verificationEventId,
        createdAt: ingestedAt,
      });
      sequence += 1;
    }
    return "created";
  });
}

export async function extractFinalizedRunVerificationEvidence(
  dependencies: VerificationExtractionDependencies,
  runId: string,
): Promise<VerificationExtractionResult | null> {
  const existing = await getRunVerificationEvidence(dependencies, runId);
  if (existing !== null) return existing;
  const source = sourceFacts(dependencies.persistence, runId);
  if (source === null) return null;
  const classification = await classificationSource(dependencies, runId, true);
  if (classification === null) {
    throw new PersistenceError(
      "operation_failed",
      "The finalized Run classification could not be prepared for verification extraction.",
    );
  }
  const prepared = prepareDeterministicVerificationEvidence({
    runId,
    finalization: source.finalization,
    classificationArtifactId: classification.artifactId,
    classification: classification.value,
    events: source.events,
  });
  const stored = await dependencies.artifactStore.putPreparedBytes({
    preparedBytes: prepared.bytes,
    kind: DETERMINISTIC_VERIFICATION_EVIDENCE_KIND,
    mediaType: DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE,
    sensitivity: DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY,
  });
  const ingestedAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  persistPrepared(dependencies, { prepared, classification }, stored.artifactId, ingestedAt);

  const persisted = await getRunVerificationEvidence(dependencies, runId);
  if (persisted === null) {
    throw new PersistenceError(
      "operation_failed",
      "The deterministic verification evidence could not be read after persistence.",
    );
  }
  if (persisted.inputFingerprint !== prepared.value.inputFingerprint) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted verification input fingerprint is inconsistent.",
    );
  }
  return persisted;
}

export async function extractEligibleFinalizedRunVerificationEvidence(
  dependencies: VerificationExtractionDependencies,
  limit = MAX_VERIFICATION_EXTRACTION_BATCH,
): Promise<readonly VerificationExtractionResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_VERIFICATION_EXTRACTION_BATCH) {
    return [];
  }
  const runIds = dependencies.persistence.artifacts.listFinalizedRunIdsWithoutRole(
    DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
    limit,
  );
  const results: VerificationExtractionResult[] = [];
  for (const runId of runIds) {
    const result = await extractFinalizedRunVerificationEvidence(dependencies, runId);
    if (result !== null) results.push(result);
  }
  return results;
}
