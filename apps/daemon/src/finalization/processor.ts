import { randomUUID } from "node:crypto";

import {
  type JsonObject,
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";

import {
  isArtifactStoreError,
  type LocalArtifactStore,
  type PutPreparedArtifactResult,
} from "../artifact-store/index.js";
import {
  type GitReconciliationDependencies,
  reconcileGitAtTrigger,
} from "../git-reconciliation/index.js";
import {
  type GitBaseline,
  type GitReconciliation,
  type OwnLoopPersistence,
  PersistenceError,
  type RunFinalization,
  type RunFinalizationDiagnosticCode,
  type RunFinalizationMode,
  type RunFinalizationTerminalStatus,
  type TaskRun,
} from "../persistence/index.js";
import {
  FINAL_DIFF_MANIFEST_KIND,
  FINAL_DIFF_MANIFEST_MEDIA_TYPE,
  FINAL_DIFF_MANIFEST_ROLE,
  FINALIZATION_EVENT_DEDUPLICATION_VERSION,
  MAX_FINALIZATION_BATCH,
  MAX_RECOVERY_BATCH,
  RUN_FINALIZATION_GENERATOR_VERSION,
} from "./constants.js";
import { prepareFinalDiffManifest } from "./manifest.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const OFFSET_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

export type RunFinalizationDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  clock?: () => Date;
  finalizationIdGenerator?: () => string;
  eventIdGenerator?: () => string;
  evidenceGapIdGenerator?: () => string;
  reconciliationDependencies?: Omit<GitReconciliationDependencies, "persistence">;
}>;

export type RunFinalizationResult = Readonly<{
  finalizationId: string;
  runId: string;
  terminalStatus: RunFinalizationTerminalStatus;
  mode: RunFinalizationMode;
  diagnosticCode: RunFinalizationDiagnosticCode | null;
  triggerEventId: string | null;
  reconciliationId: string | null;
  manifestArtifactId: string | null;
  finalSnapshotEventId: string | null;
  terminalEventId: string;
  finalizedAt: string;
}>;

type Preflight = Readonly<{
  trigger: NormalizedEventEnvelope | null;
  reconciliation: GitReconciliation | null;
  artifact: PutPreparedArtifactResult | null;
}>;

type Classification = Readonly<{
  terminalStatus: RunFinalizationTerminalStatus;
  diagnosticCode: RunFinalizationDiagnosticCode | null;
  finalFingerprint: string | null;
  addEvidenceGap: boolean;
}>;

function safeGeneratedId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new PersistenceError(
      "operation_failed",
      "A Run finalization identifier generator returned an unsafe identifier.",
    );
  }
  return value;
}

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError("operation_failed", "Run finalization received an invalid time.");
  }
  return value.toISOString();
}

function canonicalRecoveryCutoff(value: string): string | null {
  if (!OFFSET_DATETIME_PATTERN.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return null;
  }
  return new Date(milliseconds).toISOString();
}

function safeResult(finalization: RunFinalization): RunFinalizationResult {
  return {
    finalizationId: finalization.finalizationId,
    runId: finalization.runId,
    terminalStatus: finalization.terminalStatus,
    mode: finalization.mode,
    diagnosticCode: finalization.diagnosticCode,
    triggerEventId: finalization.triggerEventId,
    reconciliationId: finalization.reconciliationId,
    manifestArtifactId: finalization.manifestArtifactId,
    finalSnapshotEventId: finalization.finalSnapshotEventId,
    terminalEventId: finalization.terminalEventId,
    finalizedAt: finalization.finalizedAt,
  };
}

function terminalEventType(status: RunFinalizationTerminalStatus) {
  return status === "Completed"
    ? "run.completed"
    : status === "Partial"
      ? "run.partial"
      : status === "Failed"
        ? "run.failed"
        : "run.abandoned";
}

function latestStopEvent(
  events: readonly NormalizedEventEnvelope[],
): NormalizedEventEnvelope | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "run.stop_observed" || event?.type === "run.stop_failed") {
      return event;
    }
  }
  return null;
}

function assertContiguousRunEvents(events: readonly NormalizedEventEnvelope[]): void {
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.sequence !== index + 1) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Run Event sequence is not contiguous before finalization.",
      );
    }
  }
}

function makeEvent(
  input: Readonly<{
    eventId: string;
    workspaceId: string;
    conversationId: string;
    runId: string;
    sequence: number;
    type:
      | "snapshot.final_captured"
      | "run.completed"
      | "run.partial"
      | "run.failed"
      | "run.abandoned";
    at: string;
    payload: JsonObject;
  }>,
): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    runId: input.runId,
    sequence: input.sequence,
    type: input.type,
    source: "ownloop",
    sourceEventName: null,
    sourceEventId: null,
    occurredAt: input.at,
    ingestedAt: input.at,
    sensitivity: "normal",
    payload: input.payload,
    metadata: {
      collectorVersion: RUN_FINALIZATION_GENERATOR_VERSION,
      sourceVersion: null,
    },
  });
}

function evidenceMessage(code: RunFinalizationDiagnosticCode): string {
  switch (code) {
    case "baseline_missing":
      return "Run finalization lacked a captured Git baseline.";
    case "baseline_partial":
      return "Run finalization used an incomplete Git baseline.";
    case "final_reconciliation_missing":
      return "Run finalization lacked stop-boundary repository reconciliation.";
    case "final_reconciliation_partial":
      return "Run finalization used incomplete stop-boundary reconciliation.";
    case "final_fingerprint_missing":
      return "Run finalization lacked a reliable final repository fingerprint.";
    case "manifest_unavailable":
      return "Run finalization could not retain the prepared final evidence manifest.";
    case "source_stop_failure":
      return "The source agent reported a failed Stop boundary.";
    case "stale_capturing_recovered":
      return "A stale capturing Run was abandoned after daemon restart.";
    case "stale_finalizing_recovered":
      return "A stale finalizing Run was retained as partial after daemon restart.";
    default:
      return "Run finalization completed with incomplete evidence.";
  }
}

function classify(
  input: Readonly<{
    mode: RunFinalizationMode;
    trigger: NormalizedEventEnvelope | null;
    baseline: GitBaseline | null;
    reconciliation: GitReconciliation | null;
    artifact: PutPreparedArtifactResult | null;
    existingGapCount: number;
  }>,
): Classification {
  const reliableFingerprint =
    input.reconciliation?.outcome === "captured"
      ? input.reconciliation.workingTreeFingerprint
      : null;

  if (input.mode === "recovery") {
    return {
      terminalStatus: "Partial",
      diagnosticCode: "stale_finalizing_recovered",
      finalFingerprint: reliableFingerprint,
      addEvidenceGap: true,
    };
  }
  if (input.trigger?.type === "run.stop_failed") {
    return {
      terminalStatus: "Failed",
      diagnosticCode: "source_stop_failure",
      finalFingerprint: reliableFingerprint,
      addEvidenceGap: true,
    };
  }
  let diagnosticCode: RunFinalizationDiagnosticCode | null = null;
  if (input.baseline === null) {
    diagnosticCode = "baseline_missing";
  } else if (input.baseline.outcome !== "captured") {
    diagnosticCode = "baseline_partial";
  } else if (input.reconciliation === null) {
    diagnosticCode = "final_reconciliation_missing";
  } else if (input.reconciliation.outcome !== "captured") {
    diagnosticCode = "final_reconciliation_partial";
  } else if (reliableFingerprint === null) {
    diagnosticCode = "final_fingerprint_missing";
  } else if (input.artifact === null) {
    diagnosticCode = "manifest_unavailable";
  } else if (input.existingGapCount > 0) {
    diagnosticCode = "existing_evidence_gaps";
  }
  return {
    terminalStatus: diagnosticCode === null ? "Completed" : "Partial",
    diagnosticCode,
    finalFingerprint: reliableFingerprint,
    addEvidenceGap: diagnosticCode !== null && diagnosticCode !== "existing_evidence_gaps",
  };
}

async function preparePreflight(
  dependencies: RunFinalizationDependencies,
  run: TaskRun,
): Promise<Preflight> {
  const events = dependencies.persistence.events.listForRun(run.runId);
  assertContiguousRunEvents(events);
  const trigger = latestStopEvent(events);
  let reconciliation: GitReconciliation | null = null;
  if (trigger !== null) {
    reconciliation = dependencies.persistence.gitReconciliations.getByTriggerEvent(trigger.eventId);
    if (reconciliation === null) {
      await reconcileGitAtTrigger(
        {
          persistence: dependencies.persistence,
          ...(dependencies.reconciliationDependencies ?? {}),
        },
        trigger.eventId,
      );
      reconciliation = dependencies.persistence.gitReconciliations.getByTriggerEvent(
        trigger.eventId,
      );
    }
  }

  let artifact: PutPreparedArtifactResult | null = null;
  if (reconciliation !== null) {
    try {
      const prepared = prepareFinalDiffManifest(run.runId, reconciliation);
      artifact = await dependencies.artifactStore.putPreparedBytes({
        preparedBytes: prepared.bytes,
        kind: FINAL_DIFF_MANIFEST_KIND,
        mediaType: FINAL_DIFF_MANIFEST_MEDIA_TYPE,
        sensitivity: "sensitive",
      });
    } catch (error) {
      if (
        isArtifactStoreError(error) &&
        (error.code === "artifact_write_failed" || error.code === "size_limit_exceeded")
      ) {
        artifact = null;
      } else {
        throw error;
      }
    }
  }
  return { trigger, reconciliation, artifact };
}

function persistFinalization(
  dependencies: RunFinalizationDependencies,
  input: Readonly<{
    runId: string;
    mode: RunFinalizationMode;
    preflight: Preflight;
    finalizedAt: string;
    staleCutoff?: string;
  }>,
): RunFinalizationResult | null {
  return dependencies.persistence.withTransaction((repositories) => {
    const existing = repositories.runFinalizations.getByRun(input.runId);
    if (existing !== null) {
      return safeResult(existing);
    }
    const run = repositories.taskRuns.get(input.runId);
    if (run === null) {
      return null;
    }
    if (run.status !== "Finalizing") {
      if (["Completed", "Partial", "Abandoned", "Failed"].includes(run.status)) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "A terminal Task Run is missing its finalization record.",
        );
      }
      return null;
    }
    const conversation = repositories.conversations.get(run.conversationId);
    if (conversation === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The finalizing Run has no Conversation.",
      );
    }
    const workspace = repositories.workspaces.get(conversation.workspaceId);
    if (workspace === null) {
      throw new PersistenceError("invalid_persisted_row", "The finalizing Run has no Workspace.");
    }
    if (input.staleCutoff !== undefined && conversation.lastObservedAt >= input.staleCutoff) {
      return null;
    }

    const currentEvents = repositories.events.listForRun(run.runId);
    assertContiguousRunEvents(currentEvents);
    const currentTrigger = latestStopEvent(currentEvents);
    if (currentTrigger?.eventId !== input.preflight.trigger?.eventId) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Run Stop boundary changed during finalization.",
      );
    }
    const currentReconciliation =
      currentTrigger === null
        ? null
        : repositories.gitReconciliations.getByTriggerEvent(currentTrigger.eventId);
    if (
      currentReconciliation?.reconciliationId !== input.preflight.reconciliation?.reconciliationId
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Run reconciliation changed during finalization.",
      );
    }

    const baseline = repositories.gitBaselines.getByRun(run.runId);
    const existingGapCount = repositories.runSupport.countEvidenceGaps(run.runId);
    if (existingGapCount !== run.evidenceGapCount) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Task Run evidence-gap counter is inconsistent.",
      );
    }
    const classification = classify({
      mode: input.mode,
      trigger: currentTrigger,
      baseline,
      reconciliation: currentReconciliation,
      artifact: input.preflight.artifact,
      existingGapCount,
    });
    const finalizationId = safeGeneratedId(dependencies.finalizationIdGenerator ?? randomUUID);
    const firstSequence = repositories.events.nextSequence(run.runId);
    const hasSnapshot = currentReconciliation !== null;
    const snapshotEventId = hasSnapshot
      ? safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID)
      : null;
    const terminalEventId = safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID);
    let sequence = firstSequence;

    if (snapshotEventId !== null && currentReconciliation !== null) {
      const snapshotEvent = makeEvent({
        eventId: snapshotEventId,
        workspaceId: workspace.workspaceId,
        conversationId: conversation.conversationId,
        runId: run.runId,
        sequence,
        type: "snapshot.final_captured",
        at: input.finalizedAt,
        payload: {
          finalizationId,
          mode: input.mode,
          terminalStatus: classification.terminalStatus,
          reconciliationPresent: true,
          manifestPresent: input.preflight.artifact !== null,
          finalFingerprintPresent: classification.finalFingerprint !== null,
          entryCount: currentReconciliation.entryCount,
        },
      });
      repositories.events.append(snapshotEvent);
      repositories.events.recordDeduplicationKey({
        source: "ownloop",
        sourceSessionId: conversation.conversationId,
        deduplicationKey: `${FINALIZATION_EVENT_DEDUPLICATION_VERSION}:${run.runId}:snapshot`,
        eventId: snapshotEventId,
        createdAt: input.finalizedAt,
      });
      sequence += 1;
    }

    const terminalEvent = makeEvent({
      eventId: terminalEventId,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      runId: run.runId,
      sequence,
      type: terminalEventType(classification.terminalStatus),
      at: input.finalizedAt,
      payload: {
        finalizationId,
        mode: input.mode,
        terminalStatus: classification.terminalStatus,
        diagnosticCode: classification.diagnosticCode,
        triggerPresent: currentTrigger !== null,
        reconciliationPresent: currentReconciliation !== null,
        manifestPresent: input.preflight.artifact !== null,
        finalSnapshotPresent: snapshotEventId !== null,
        existingEvidenceGapCount: existingGapCount,
      },
    });
    repositories.events.append(terminalEvent);
    repositories.events.recordDeduplicationKey({
      source: "ownloop",
      sourceSessionId: conversation.conversationId,
      deduplicationKey: `${FINALIZATION_EVENT_DEDUPLICATION_VERSION}:${run.runId}:terminal`,
      eventId: terminalEventId,
      createdAt: input.finalizedAt,
    });

    let manifestArtifactId: string | null = null;
    if (input.preflight.artifact !== null) {
      const artifact = repositories.artifacts.getMetadata(input.preflight.artifact.artifactId);
      if (
        artifact === null ||
        artifact.kind !== FINAL_DIFF_MANIFEST_KIND ||
        artifact.storageVersion !== 1 ||
        artifact.mediaType !== FINAL_DIFF_MANIFEST_MEDIA_TYPE
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The prepared final manifest artifact is invalid.",
        );
      }
      repositories.artifacts.linkToRun({
        runId: run.runId,
        artifactId: artifact.artifactId,
        role: FINAL_DIFF_MANIFEST_ROLE,
        createdAt: input.finalizedAt,
      });
      manifestArtifactId = artifact.artifactId;
    }

    if (classification.addEvidenceGap && classification.diagnosticCode !== null) {
      repositories.runSupport.insertEvidenceGap({
        gapId: safeGeneratedId(dependencies.evidenceGapIdGenerator ?? randomUUID),
        runId: run.runId,
        code: classification.diagnosticCode,
        message: evidenceMessage(classification.diagnosticCode),
        detailsJson: null,
        createdAt: input.finalizedAt,
      });
      if (!repositories.taskRuns.incrementEvidenceGapCount(run.runId)) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "The finalizing Run evidence counter could not be updated.",
        );
      }
    }

    if (
      !repositories.taskRuns.transitionToTerminal(
        run.runId,
        "Finalizing",
        classification.terminalStatus,
        input.finalizedAt,
        classification.finalFingerprint,
      )
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Task Run could not transition to its final status.",
      );
    }

    repositories.runFinalizations.insert({
      finalizationId,
      runId: run.runId,
      conversationId: conversation.conversationId,
      workspaceId: workspace.workspaceId,
      terminalStatus: classification.terminalStatus,
      mode: input.mode,
      triggerEventId: currentTrigger?.eventId ?? null,
      reconciliationId: currentReconciliation?.reconciliationId ?? null,
      manifestArtifactId,
      finalFingerprint: classification.finalFingerprint,
      finalSnapshotEventId: snapshotEventId,
      terminalEventId,
      diagnosticCode: classification.diagnosticCode,
      finalizedAt: input.finalizedAt,
      generatorVersion: RUN_FINALIZATION_GENERATOR_VERSION,
    });
    const persisted = repositories.runFinalizations.getByRun(run.runId);
    if (persisted === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Run finalization could not be read after insertion.",
      );
    }
    return safeResult(persisted);
  });
}

function recoverCapturing(
  dependencies: RunFinalizationDependencies,
  runId: string,
  cutoff: string,
  finalizedAt: string,
): RunFinalizationResult | null {
  return dependencies.persistence.withTransaction((repositories) => {
    const existing = repositories.runFinalizations.getByRun(runId);
    if (existing !== null) {
      return safeResult(existing);
    }
    const run = repositories.taskRuns.get(runId);
    if (run === null || run.status !== "Capturing") {
      return null;
    }
    const conversation = repositories.conversations.get(run.conversationId);
    if (conversation === null || conversation.lastObservedAt >= cutoff) {
      return null;
    }
    const workspace = repositories.workspaces.get(conversation.workspaceId);
    if (workspace === null) {
      throw new PersistenceError("invalid_persisted_row", "The stale Run has no Workspace.");
    }
    const currentEvents = repositories.events.listForRun(run.runId);
    assertContiguousRunEvents(currentEvents);
    if (latestStopEvent(currentEvents) !== null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A capturing Run cannot be recovered after a persisted Stop boundary.",
      );
    }
    const finalizationId = safeGeneratedId(dependencies.finalizationIdGenerator ?? randomUUID);
    const terminalEventId = safeGeneratedId(dependencies.eventIdGenerator ?? randomUUID);
    const terminalEvent = makeEvent({
      eventId: terminalEventId,
      workspaceId: workspace.workspaceId,
      conversationId: conversation.conversationId,
      runId: run.runId,
      sequence: repositories.events.nextSequence(run.runId),
      type: "run.abandoned",
      at: finalizedAt,
      payload: {
        finalizationId,
        mode: "recovery",
        terminalStatus: "Abandoned",
        diagnosticCode: "stale_capturing_recovered",
        finalSnapshotPresent: false,
        manifestPresent: false,
      },
    });
    repositories.events.append(terminalEvent);
    repositories.events.recordDeduplicationKey({
      source: "ownloop",
      sourceSessionId: conversation.conversationId,
      deduplicationKey: `${FINALIZATION_EVENT_DEDUPLICATION_VERSION}:${run.runId}:terminal`,
      eventId: terminalEventId,
      createdAt: finalizedAt,
    });
    repositories.runSupport.insertEvidenceGap({
      gapId: safeGeneratedId(dependencies.evidenceGapIdGenerator ?? randomUUID),
      runId: run.runId,
      code: "stale_capturing_recovered",
      message: evidenceMessage("stale_capturing_recovered"),
      detailsJson: null,
      createdAt: finalizedAt,
    });
    if (
      !repositories.taskRuns.incrementEvidenceGapCount(run.runId) ||
      !repositories.taskRuns.transitionToTerminal(
        run.runId,
        "Capturing",
        "Abandoned",
        finalizedAt,
        null,
      )
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The stale capturing Run could not be abandoned atomically.",
      );
    }
    repositories.runFinalizations.insert({
      finalizationId,
      runId: run.runId,
      conversationId: conversation.conversationId,
      workspaceId: workspace.workspaceId,
      terminalStatus: "Abandoned",
      mode: "recovery",
      triggerEventId: null,
      reconciliationId: null,
      manifestArtifactId: null,
      finalFingerprint: null,
      finalSnapshotEventId: null,
      terminalEventId,
      diagnosticCode: "stale_capturing_recovered",
      finalizedAt,
      generatorVersion: RUN_FINALIZATION_GENERATOR_VERSION,
    });
    const persisted = repositories.runFinalizations.getByRun(run.runId);
    if (persisted === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The recovered Run finalization could not be read after insertion.",
      );
    }
    return safeResult(persisted);
  });
}

export async function finalizeRun(
  dependencies: RunFinalizationDependencies,
  runId: string,
): Promise<RunFinalizationResult | null> {
  const existing = dependencies.persistence.runFinalizations.getByRun(runId);
  if (existing !== null) {
    return safeResult(existing);
  }
  const run = dependencies.persistence.taskRuns.get(runId);
  if (run === null) {
    return null;
  }
  if (run.status !== "Finalizing") {
    if (["Completed", "Partial", "Abandoned", "Failed"].includes(run.status)) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A terminal Task Run is missing its finalization record.",
      );
    }
    return null;
  }
  const preflight = await preparePreflight(dependencies, run);
  const finalizedAt = canonicalTimestamp(dependencies.clock ?? (() => new Date()));
  return persistFinalization(dependencies, {
    runId,
    mode: "normal",
    preflight,
    finalizedAt,
  });
}

export function getRunFinalization(
  persistence: OwnLoopPersistence,
  runId: string,
): RunFinalizationResult | null {
  const finalization = persistence.runFinalizations.getByRun(runId);
  return finalization === null ? null : safeResult(finalization);
}

export async function finalizeEligibleRuns(
  dependencies: RunFinalizationDependencies,
  limit = MAX_FINALIZATION_BATCH,
): Promise<RunFinalizationResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FINALIZATION_BATCH) {
    return [];
  }
  const runIds = dependencies.persistence.taskRuns.listFinalizingWithoutFinalization(limit);
  const results: RunFinalizationResult[] = [];
  for (const runId of runIds) {
    const result = await finalizeRun(dependencies, runId);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}

export async function recoverStaleRuns(
  dependencies: RunFinalizationDependencies,
  cutoff: string,
  limit = MAX_RECOVERY_BATCH,
): Promise<RunFinalizationResult[]> {
  const canonicalCutoff = canonicalRecoveryCutoff(cutoff);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RECOVERY_BATCH ||
    canonicalCutoff === null
  ) {
    return [];
  }
  const stale = dependencies.persistence.taskRuns.listStaleActive(canonicalCutoff, limit);
  const results: RunFinalizationResult[] = [];
  for (const candidate of stale) {
    const finalizedAt = canonicalTimestamp(dependencies.clock ?? (() => new Date()));
    if (candidate.run.status === "Capturing") {
      const result = recoverCapturing(
        dependencies,
        candidate.run.runId,
        canonicalCutoff,
        finalizedAt,
      );
      if (result !== null) {
        results.push(result);
      }
      continue;
    }
    const preflight = await preparePreflight(dependencies, candidate.run);
    const result = persistFinalization(dependencies, {
      runId: candidate.run.runId,
      mode: "recovery",
      preflight,
      finalizedAt,
      staleCutoff: canonicalCutoff,
    });
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
