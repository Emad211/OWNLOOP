import type {
  ChangeClassificationAggregateLabelV1,
  ChangeClassificationDiagnosticCode,
  ChangeClassificationOutcome,
  DeterministicChangeClassificationV1,
} from "@ownloop/contracts";

import { type LocalArtifactStore, isArtifactStoreError } from "../artifact-store/index.js";
import {
  type ArtifactMetadata,
  type GitReconciliation,
  type OwnLoopPersistence,
  PersistenceError,
  type RunArtifactRecord,
  type RunFinalization,
  type TaskRun,
} from "../persistence/index.js";
import {
  DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
  DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
  DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
  DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY,
  MAX_CHANGE_CLASSIFICATION_BATCH,
} from "./constants.js";
import {
  parseCanonicalChangeClassification,
  prepareDeterministicChangeClassification,
} from "./artifact.js";

export type ChangeClassificationDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}>;

export type ChangeClassificationResult = Readonly<{
  artifactId: string;
  schemaVersion: number;
  classifierVersion: string;
  taxonomyVersion: string;
  ruleSetVersion: string;
  runId: string;
  finalizationId: string;
  reconciliationId: string | null;
  outcome: ChangeClassificationOutcome;
  diagnosticCode: ChangeClassificationDiagnosticCode | null;
  inputFingerprint: string;
  entryCount: number;
  aggregateLabels: readonly ChangeClassificationAggregateLabelV1[];
}>;

function safeResult(
  artifactId: string,
  value: DeterministicChangeClassificationV1,
): ChangeClassificationResult {
  return {
    artifactId,
    schemaVersion: value.schemaVersion,
    classifierVersion: value.classifierVersion,
    taxonomyVersion: value.taxonomyVersion,
    ruleSetVersion: value.ruleSetVersion,
    runId: value.runId,
    finalizationId: value.finalizationId,
    reconciliationId: value.reconciliationId,
    outcome: value.outcome,
    diagnosticCode: value.diagnosticCode,
    inputFingerprint: value.inputFingerprint,
    entryCount: value.entries.length,
    aggregateLabels: value.aggregateLabels,
  };
}

function terminalRun(run: TaskRun | null): TaskRun | null {
  if (run === null) {
    return null;
  }
  return ["Completed", "Partial", "Abandoned", "Failed"].includes(run.status) ? run : null;
}

function authoritativeSource(
  persistence: OwnLoopPersistence,
  runId: string,
): Readonly<{
  run: TaskRun;
  finalization: RunFinalization;
  reconciliation: GitReconciliation | null;
}> | null {
  const run = terminalRun(persistence.taskRuns.get(runId));
  if (run === null) {
    return null;
  }
  const finalization = persistence.runFinalizations.getByRun(runId);
  if (finalization === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A terminal Run is missing its finalization for classification.",
    );
  }
  const reconciliation =
    finalization.reconciliationId === null
      ? null
      : persistence.gitReconciliations.get(finalization.reconciliationId);
  if (finalization.reconciliationId !== null && reconciliation === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The final classification reconciliation is missing.",
    );
  }
  return { run, finalization, reconciliation };
}

function classificationRecord(
  persistence: OwnLoopPersistence,
  runId: string,
): RunArtifactRecord | null {
  return persistence.artifacts.getRecordForRunRole(runId, DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE);
}

function assertClassificationMetadata(metadata: ArtifactMetadata): void {
  if (
    metadata.storageVersion !== 1 ||
    metadata.kind !== DETERMINISTIC_CHANGE_CLASSIFICATION_KIND ||
    metadata.mediaType !== DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE ||
    metadata.sensitivity !== DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The deterministic classification artifact metadata is invalid.",
    );
  }
}

async function readAndValidate(
  dependencies: ChangeClassificationDependencies,
  record: RunArtifactRecord,
): Promise<ChangeClassificationResult> {
  assertClassificationMetadata(record.artifact);
  const content = await dependencies.artifactStore.readPreparedBytes(record.artifact.artifactId);
  if (
    content.kind !== DETERMINISTIC_CHANGE_CLASSIFICATION_KIND ||
    content.mediaType !== DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE ||
    content.sensitivity !== DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY ||
    content.sizeBytes !== record.artifact.sizeBytes
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The deterministic classification artifact read metadata is inconsistent.",
    );
  }
  const value = parseCanonicalChangeClassification(content.bytes);
  const source = authoritativeSource(dependencies.persistence, record.reference.runId);
  if (source === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The classification artifact is linked to a non-terminal Run.",
    );
  }
  const expected = prepareDeterministicChangeClassification(
    source.run.runId,
    source.finalization,
    source.reconciliation,
  );
  if (expected.canonicalJson !== new TextDecoder().decode(content.bytes)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The deterministic classification no longer matches its accepted source facts.",
    );
  }
  if (value.runId !== record.reference.runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The classification artifact Run ownership is inconsistent.",
    );
  }
  return safeResult(record.artifact.artifactId, value);
}

export async function getRunChangeClassification(
  dependencies: ChangeClassificationDependencies,
  runId: string,
): Promise<ChangeClassificationResult | null> {
  const record = classificationRecord(dependencies.persistence, runId);
  return record === null ? null : readAndValidate(dependencies, record);
}

export async function classifyFinalizedRunChanges(
  dependencies: ChangeClassificationDependencies,
  runId: string,
): Promise<ChangeClassificationResult | null> {
  const existing = await getRunChangeClassification(dependencies, runId);
  if (existing !== null) {
    return existing;
  }
  const source = authoritativeSource(dependencies.persistence, runId);
  if (source === null) {
    return null;
  }
  const prepared = prepareDeterministicChangeClassification(
    runId,
    source.finalization,
    source.reconciliation,
  );
  try {
    await dependencies.artifactStore.putPreparedArtifactForRun({
      preparedContent: [prepared.bytes],
      runId,
      role: DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
      kind: DETERMINISTIC_CHANGE_CLASSIFICATION_KIND,
      mediaType: DETERMINISTIC_CHANGE_CLASSIFICATION_MEDIA_TYPE,
      sensitivity: DETERMINISTIC_CHANGE_CLASSIFICATION_SENSITIVITY,
    });
  } catch (error) {
    if (!(isArtifactStoreError(error) && error.code === "artifact_reference_failed")) {
      throw error;
    }
  }
  const persisted = await getRunChangeClassification(dependencies, runId);
  if (persisted === null) {
    throw new PersistenceError(
      "operation_failed",
      "The deterministic classification could not be read after persistence.",
    );
  }
  if (persisted.inputFingerprint !== prepared.value.inputFingerprint) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The persisted classification input fingerprint is inconsistent.",
    );
  }
  return persisted;
}

export async function classifyEligibleFinalizedRuns(
  dependencies: ChangeClassificationDependencies,
  limit = MAX_CHANGE_CLASSIFICATION_BATCH,
): Promise<readonly ChangeClassificationResult[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANGE_CLASSIFICATION_BATCH) {
    return [];
  }
  const runIds = dependencies.persistence.artifacts.listFinalizedRunIdsWithoutRole(
    DETERMINISTIC_CHANGE_CLASSIFICATION_ROLE,
    limit,
  );
  const results: ChangeClassificationResult[] = [];
  for (const runId of runIds) {
    const result = await classifyFinalizedRunChanges(dependencies, runId);
    if (result !== null) {
      results.push(result);
    }
  }
  return results;
}
