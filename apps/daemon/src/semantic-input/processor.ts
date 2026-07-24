import {
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  type DeterministicEvidenceGraphV1,
  type DeterministicSemanticAnalysisInputV1,
  type DeterministicVerificationEvidenceV1,
  type SemanticAnalysisInputResultV1,
  SemanticAnalysisInputResultV1Schema,
  SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION,
  type SemanticAnalysisLimitation,
} from "@ownloop/contracts";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import { readValidatedRunEvidenceGraph } from "../evidence-graph/index.js";
import {
  type ArtifactMetadata,
  type OwnLoopPersistence,
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
  getRunVerificationEvidence,
  parseCanonicalVerificationEvidence,
} from "../verification-extraction/index.js";
import { parseCanonicalSemanticAnalysisInput } from "./artifact.js";
import {
  SEMANTIC_ANALYSIS_MAX_BATCH,
  REDUCED_SEMANTIC_ANALYSIS_INPUT_KIND,
  REDUCED_SEMANTIC_ANALYSIS_INPUT_MEDIA_TYPE,
  REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE,
  REDUCED_SEMANTIC_ANALYSIS_INPUT_SENSITIVITY,
  SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
  SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES,
  SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
  SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
} from "./constants.js";
import {
  prepareDeterministicSemanticAnalysisInput,
  type PreparedSemanticAnalysisInput,
} from "./reducer.js";
import { SemanticInputRedactionError } from "./redaction.js";

export type SemanticAnalysisInputDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}>;

export type SemanticAnalysisInputOptions = Readonly<{ enabled: boolean }>;

type AuthoritativeSource = Readonly<{
  outcome: "eligible";
  run: TaskRun;
  finalization: RunFinalization;
  evidenceGraphArtifactId: string;
  evidenceGraph: DeterministicEvidenceGraphV1;
  verificationArtifactId: string;
  verification: DeterministicVerificationEvidenceV1;
}>;

type UnavailableAuthoritativeSource = Readonly<{
  outcome: "unavailable";
  limitations: readonly SemanticAnalysisLimitation[];
}>;

type AuthoritativeSourceResult = AuthoritativeSource | UnavailableAuthoritativeSource | null;

const TERMINAL_STATUSES = new Set(["Completed", "Partial", "Abandoned", "Failed"]);

function baseResult(
  runId: string,
): Omit<SemanticAnalysisInputResultV1, "outcome" | "diagnosticCode"> {
  return {
    schemaVersion: SEMANTIC_ANALYSIS_INPUT_SCHEMA_VERSION,
    builderVersion: SEMANTIC_ANALYSIS_INPUT_BUILDER_VERSION,
    reductionPolicyVersion: SEMANTIC_ANALYSIS_REDUCTION_POLICY_VERSION,
    redactionPolicyVersion: SEMANTIC_ANALYSIS_REDACTION_POLICY_VERSION,
    tokenEstimatorVersion: SEMANTIC_ANALYSIS_TOKEN_ESTIMATOR_VERSION,
    targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    runId,
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
  };
}

function disabledResult(runId: string): SemanticAnalysisInputResultV1 {
  return SemanticAnalysisInputResultV1Schema.parse({
    ...baseResult(runId),
    outcome: "disabled",
    diagnosticCode: "disabled",
  });
}

function unavailableResult(
  runId: string,
  limitations: readonly SemanticAnalysisLimitation[] = [],
): SemanticAnalysisInputResultV1 {
  return SemanticAnalysisInputResultV1Schema.parse({
    ...baseResult(runId),
    outcome: "unavailable",
    diagnosticCode: "source_unavailable",
    limitations,
  });
}

function safeResult(
  artifactId: string,
  value: DeterministicSemanticAnalysisInputV1,
): SemanticAnalysisInputResultV1 {
  return SemanticAnalysisInputResultV1Schema.parse({
    schemaVersion: value.schemaVersion,
    builderVersion: value.builderVersion,
    reductionPolicyVersion: value.reductionPolicyVersion,
    redactionPolicyVersion: value.redactionPolicyVersion,
    tokenEstimatorVersion: value.tokenEstimatorVersion,
    targetCandidateMomentSchemaVersion: value.targetCandidateMomentSchemaVersion,
    runId: value.runId,
    outcome: value.outcome,
    diagnosticCode: value.diagnosticCode,
    limitations: value.limitations,
    artifactId,
    inputFingerprint: value.inputFingerprint,
    summaryCount: value.aggregates.summaryCount,
    relationCount: value.aggregates.relationCount,
    verificationExcerptCount: value.aggregates.verificationExcerptCount,
    utf8ByteCount: value.estimates.utf8ByteCount,
    modelVisibleTextCodePointCount: value.estimates.modelVisibleTextCodePointCount,
    inputTokenUpperBound: value.estimates.inputTokenUpperBound,
    monetaryEstimateStatus: value.estimates.monetaryEstimateStatus,
  });
}

function semanticRecord(
  persistence: OwnLoopPersistence,
  runId: string,
): RunArtifactRecord | null {
  return persistence.artifacts.getRecordForRunRole(runId, REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE);
}

function assertSemanticMetadata(metadata: ArtifactMetadata, expectedSize?: number): void {
  if (
    metadata.storageVersion !== 1 ||
    metadata.kind !== REDUCED_SEMANTIC_ANALYSIS_INPUT_KIND ||
    metadata.mediaType !== REDUCED_SEMANTIC_ANALYSIS_INPUT_MEDIA_TYPE ||
    metadata.sensitivity !== REDUCED_SEMANTIC_ANALYSIS_INPUT_SENSITIVITY ||
    metadata.sizeBytes > SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES ||
    (expectedSize !== undefined && metadata.sizeBytes !== expectedSize)
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The reduced semantic-analysis input artifact metadata is invalid.",
    );
  }
}

function assertVerificationMetadata(metadata: ArtifactMetadata, expectedSize?: number): void {
  if (
    metadata.storageVersion !== 1 ||
    metadata.kind !== DETERMINISTIC_VERIFICATION_EVIDENCE_KIND ||
    metadata.mediaType !== DETERMINISTIC_VERIFICATION_EVIDENCE_MEDIA_TYPE ||
    metadata.sensitivity !== DETERMINISTIC_VERIFICATION_EVIDENCE_SENSITIVITY ||
    (expectedSize !== undefined && metadata.sizeBytes !== expectedSize)
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-input verification source metadata is invalid.",
    );
  }
}

async function authoritativeSource(
  dependencies: SemanticAnalysisInputDependencies,
  runId: string,
): Promise<AuthoritativeSourceResult> {
  const run = dependencies.persistence.taskRuns.get(runId);
  if (run === null || !TERMINAL_STATUSES.has(run.status)) return null;
  const finalization = dependencies.persistence.runFinalizations.getByRun(runId);
  if (finalization === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A terminal Run is missing finalization for semantic-input preparation.",
    );
  }
  const graph = await readValidatedRunEvidenceGraph(dependencies, runId);
  if (graph === null) return null;
  if (graph.value.outcome === "unavailable") {
    return { outcome: "unavailable", limitations: graph.value.limitations };
  }
  const verificationResult = await getRunVerificationEvidence(dependencies, runId);
  if (
    verificationResult === null ||
    verificationResult.artifactId !== graph.value.verificationArtifactId ||
    verificationResult.inputFingerprint !== graph.value.verificationInputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-input verification source differs from its Evidence Graph.",
    );
  }
  const verificationRecord = dependencies.persistence.artifacts.getRecordForRunRole(
    runId,
    DETERMINISTIC_VERIFICATION_EVIDENCE_ROLE,
  );
  if (
    verificationRecord === null ||
    verificationRecord.artifact.artifactId !== verificationResult.artifactId
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-input verification source reference is missing.",
    );
  }
  assertVerificationMetadata(verificationRecord.artifact);
  const verificationContent = await dependencies.artifactStore.readPreparedBytes(
    verificationResult.artifactId,
  );
  assertVerificationMetadata(verificationRecord.artifact, verificationContent.sizeBytes);
  const verification = parseCanonicalVerificationEvidence(verificationContent.bytes);
  if (
    verification.runId !== runId ||
    verification.finalizationId !== finalization.finalizationId ||
    verification.inputFingerprint !== verificationResult.inputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-input verification source content is inconsistent.",
    );
  }
  return {
    outcome: "eligible",
    run,
    finalization,
    evidenceGraphArtifactId: graph.artifactId,
    evidenceGraph: graph.value,
    verificationArtifactId: verificationResult.artifactId,
    verification,
  };
}

function prepareSource(source: AuthoritativeSource): PreparedSemanticAnalysisInput | null {
  try {
    const prepared = prepareDeterministicSemanticAnalysisInput(source);
    return "bytes" in prepared ? prepared : null;
  } catch (error) {
    if (error instanceof SemanticInputRedactionError) return null;
    throw error;
  }
}

async function readAndValidate(
  dependencies: SemanticAnalysisInputDependencies,
  record: RunArtifactRecord,
): Promise<SemanticAnalysisInputResultV1> {
  assertSemanticMetadata(record.artifact);
  const content = await dependencies.artifactStore.readPreparedBytes(record.artifact.artifactId);
  if (
    content.artifactId !== record.artifact.artifactId ||
    content.kind !== REDUCED_SEMANTIC_ANALYSIS_INPUT_KIND ||
    content.mediaType !== REDUCED_SEMANTIC_ANALYSIS_INPUT_MEDIA_TYPE ||
    content.sensitivity !== REDUCED_SEMANTIC_ANALYSIS_INPUT_SENSITIVITY ||
    content.sizeBytes !== record.artifact.sizeBytes
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-analysis input artifact read metadata differs.",
    );
  }
  const value = parseCanonicalSemanticAnalysisInput(content.bytes);
  if (value.runId !== record.reference.runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-analysis input Run ownership differs.",
    );
  }
  const source = await authoritativeSource(dependencies, value.runId);
  if (source === null || source.outcome === "unavailable") {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-analysis input no longer has an eligible source.",
    );
  }
  const expected = prepareSource(source);
  if (expected === null || expected.canonicalJson !== new TextDecoder().decode(content.bytes)) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The semantic-analysis input no longer matches accepted source facts.",
    );
  }
  return safeResult(record.artifact.artifactId, value);
}

export async function getRunSemanticAnalysisInput(
  dependencies: SemanticAnalysisInputDependencies,
  runId: string,
): Promise<SemanticAnalysisInputResultV1 | null> {
  const record = semanticRecord(dependencies.persistence, runId);
  return record === null ? null : readAndValidate(dependencies, record);
}

export async function prepareFinalizedRunSemanticAnalysisInput(
  dependencies: SemanticAnalysisInputDependencies,
  runId: string,
  options: SemanticAnalysisInputOptions,
): Promise<SemanticAnalysisInputResultV1> {
  if (!options.enabled) return disabledResult(runId);
  const existing = await getRunSemanticAnalysisInput(dependencies, runId);
  if (existing !== null) return existing;
  const source = await authoritativeSource(dependencies, runId);
  if (source === null) return unavailableResult(runId);
  if (source.outcome === "unavailable") {
    return unavailableResult(runId, source.limitations);
  }
  const prepared = prepareSource(source);
  if (prepared === null) return unavailableResult(runId, source.evidenceGraph.limitations);

  try {
    await dependencies.artifactStore.putPreparedArtifactForRun({
      preparedContent: [prepared.bytes],
      runId,
      role: REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE,
      kind: REDUCED_SEMANTIC_ANALYSIS_INPUT_KIND,
      mediaType: REDUCED_SEMANTIC_ANALYSIS_INPUT_MEDIA_TYPE,
      sensitivity: REDUCED_SEMANTIC_ANALYSIS_INPUT_SENSITIVITY,
    });
  } catch (error) {
    const raced = await getRunSemanticAnalysisInput(dependencies, runId);
    if (raced !== null) return raced;
    throw error;
  }
  const persisted = await getRunSemanticAnalysisInput(dependencies, runId);
  if (persisted === null || persisted.inputFingerprint !== prepared.value.inputFingerprint) {
    throw new PersistenceError(
      "operation_failed",
      "The semantic-analysis input was not persisted consistently.",
    );
  }
  return persisted;
}

export async function prepareEligibleFinalizedRunSemanticAnalysisInputs(
  dependencies: SemanticAnalysisInputDependencies,
  options: SemanticAnalysisInputOptions,
  limit = SEMANTIC_ANALYSIS_MAX_BATCH,
): Promise<readonly SemanticAnalysisInputResultV1[]> {
  if (!options.enabled) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > SEMANTIC_ANALYSIS_MAX_BATCH) return [];
  const runIds = dependencies.persistence.artifacts.listFinalizedRunIdsWithoutRole(
    REDUCED_SEMANTIC_ANALYSIS_INPUT_ROLE,
    limit,
  );
  const results: SemanticAnalysisInputResultV1[] = [];
  for (const runId of runIds) {
    results.push(
      await prepareFinalizedRunSemanticAnalysisInput(dependencies, runId, { enabled: true }),
    );
  }
  return results;
}
