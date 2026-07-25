import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  type CandidateValidationCountsV1,
  CandidateValidationRecordV1Schema,
  type CandidateValidationRecordV1,
  CandidateValidationResultV1Schema,
  type CandidateValidationResultV1,
} from "@ownloop/contracts";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  type CandidateGenerationDependencies,
  readValidatedCandidateGeneration,
} from "../candidate-generation/index.js";
import {
  type EvidenceGraphReadDependencies,
  readValidatedRunEvidenceGraph,
} from "../evidence-graph/index.js";
import { type OwnLoopPersistence, PersistenceError } from "../persistence/index.js";
import {
  parseCanonicalCandidateValidationReport,
  type PreparedCandidateValidationReport,
} from "./artifact.js";
import {
  CANDIDATE_VALIDATION_REPORT_KIND,
  CANDIDATE_VALIDATION_REPORT_MEDIA_TYPE,
  CANDIDATE_VALIDATION_REPORT_ROLE,
  CANDIDATE_VALIDATION_REPORT_SENSITIVITY,
  MAX_CANDIDATE_VALIDATION_BATCH,
} from "./constants.js";
import {
  buildCandidateValidationReport,
  type CandidateValidationBuilderInput,
  validationIdentity,
} from "./validator.js";

const ZERO_COUNTS: CandidateValidationCountsV1 = Object.freeze({
  source: 0,
  rejected: 0,
  valid: 0,
  selected: 0,
  duplicate: 0,
  unselected: 0,
});

export type CandidateValidationDependencies = CandidateGenerationDependencies &
  EvidenceGraphReadDependencies &
  Readonly<{
    persistence: OwnLoopPersistence;
    artifactStore: LocalArtifactStore;
  }>;

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError("operation_failed", "The Candidate validation clock is invalid.");
  }
  return value.toISOString();
}

function safeResult(
  record: CandidateValidationRecordV1,
  report: PreparedCandidateValidationReport,
): CandidateValidationResultV1 {
  return CandidateValidationResultV1Schema.parse({
    schemaVersion: record.schemaVersion,
    validatorVersion: record.validatorVersion,
    supportPolicyVersion: record.supportPolicyVersion,
    contradictionPolicyVersion: record.contradictionPolicyVersion,
    absencePolicyVersion: record.absencePolicyVersion,
    duplicatePolicyVersion: record.duplicatePolicyVersion,
    rankingPolicyVersion: record.rankingPolicyVersion,
    selectionPolicyVersion: record.selectionPolicyVersion,
    outcome: report.value.outcome,
    diagnosticCode: report.value.diagnosticCode,
    limitations: report.value.limitations,
    validationId: record.validationId,
    validationKey: record.validationKey,
    runId: record.runId,
    generationId: record.generationId,
    sourceCandidateArtifactId: record.sourceCandidateArtifactId,
    sourceCandidateFingerprint: record.sourceCandidateFingerprint,
    evidenceGraphArtifactId: record.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: record.evidenceGraphInputFingerprint,
    reportArtifactId: record.reportArtifactId,
    reportFingerprint: record.reportFingerprint,
    counts: record.counts,
    selectedSourceIndexes: report.value.selectedSourceIndexes,
    sourceVersions: record.sourceVersions,
  });
}

function unavailable(runId: string, generationId: string): CandidateValidationResultV1 {
  return CandidateValidationResultV1Schema.parse({
    schemaVersion: CANDIDATE_VALIDATION_SCHEMA_VERSION,
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    outcome: "unavailable",
    diagnosticCode: "source_unavailable",
    limitations: [],
    validationId: null,
    validationKey: null,
    runId,
    generationId,
    sourceCandidateArtifactId: null,
    sourceCandidateFingerprint: null,
    evidenceGraphArtifactId: null,
    evidenceGraphInputFingerprint: null,
    reportArtifactId: null,
    reportFingerprint: null,
    counts: ZERO_COUNTS,
    selectedSourceIndexes: [],
    sourceVersions: null,
  });
}

async function source(
  dependencies: CandidateValidationDependencies,
  generationId: string,
): Promise<Readonly<{ input: CandidateValidationBuilderInput }> | null> {
  const generation = await readValidatedCandidateGeneration(dependencies, generationId);
  if (
    generation === null ||
    generation.record.status !== "succeeded" ||
    generation.candidate === null ||
    generation.record.candidateArtifactId === null ||
    generation.record.candidateFingerprint === null
  ) {
    return null;
  }
  const graph = await readValidatedRunEvidenceGraph(dependencies, generation.record.runId);
  if (
    graph === null ||
    graph.value.outcome === "unavailable" ||
    generation.semanticInput.evidenceGraphArtifactId !== graph.artifactId ||
    generation.semanticInput.evidenceGraphInputFingerprint !== graph.value.inputFingerprint ||
    graph.value.finalizationId !== generation.record.finalizationId
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation graph source differs from generation provenance.",
    );
  }
  return {
    input: {
      runId: generation.record.runId,
      finalizationId: generation.record.finalizationId,
      generationId: generation.record.generationId,
      sourceCandidateArtifactId: generation.record.candidateArtifactId,
      sourceCandidateFingerprint: generation.record.candidateFingerprint,
      candidateBatch: generation.candidate,
      evidenceGraphArtifactId: graph.artifactId,
      evidenceGraph: graph.value,
    },
  };
}

export async function readValidatedCandidateValidation(
  dependencies: CandidateValidationDependencies,
  validationId: string,
): Promise<Readonly<{
  record: CandidateValidationRecordV1;
  report: PreparedCandidateValidationReport;
  result: CandidateValidationResultV1;
}> | null> {
  const record = dependencies.persistence.candidateValidations.get(validationId);
  if (record === null) return null;
  const accepted = await source(dependencies, record.generationId);
  if (accepted === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation source generation is unavailable.",
    );
  }
  const expectedIdentity = validationIdentity(accepted.input);
  if (
    record.validationId !== expectedIdentity.validationId ||
    record.validationKey !== expectedIdentity.validationKey ||
    record.runId !== accepted.input.runId ||
    record.finalizationId !== accepted.input.finalizationId ||
    record.sourceCandidateArtifactId !== accepted.input.sourceCandidateArtifactId ||
    record.sourceCandidateFingerprint !== accepted.input.sourceCandidateFingerprint ||
    record.evidenceGraphArtifactId !== accepted.input.evidenceGraphArtifactId ||
    record.evidenceGraphInputFingerprint !== accepted.input.evidenceGraph.inputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation provenance differs from verified source artifacts.",
    );
  }
  if (
    !dependencies.persistence.artifacts.hasReference(
      record.runId,
      record.reportArtifactId,
      record.reportArtifactRole,
    )
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation report reference is missing.",
    );
  }
  const metadata = dependencies.persistence.artifacts.getMetadata(record.reportArtifactId);
  if (
    metadata === null ||
    metadata.storageVersion !== 1 ||
    metadata.kind !== CANDIDATE_VALIDATION_REPORT_KIND ||
    metadata.mediaType !== CANDIDATE_VALIDATION_REPORT_MEDIA_TYPE ||
    metadata.sensitivity !== CANDIDATE_VALIDATION_REPORT_SENSITIVITY
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation report metadata differs.",
    );
  }
  const content = await dependencies.artifactStore.readPreparedBytes(record.reportArtifactId);
  if (
    content.artifactId !== record.reportArtifactId ||
    content.kind !== CANDIDATE_VALIDATION_REPORT_KIND ||
    content.mediaType !== CANDIDATE_VALIDATION_REPORT_MEDIA_TYPE ||
    content.sensitivity !== CANDIDATE_VALIDATION_REPORT_SENSITIVITY ||
    content.sizeBytes !== metadata.sizeBytes
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation report read metadata differs.",
    );
  }
  const report = parseCanonicalCandidateValidationReport(content.bytes);
  const expected = buildCandidateValidationReport(accepted.input);
  if (
    report.canonicalJson !== expected.canonicalJson ||
    report.fingerprint !== record.reportFingerprint ||
    report.value.validationId !== record.validationId ||
    report.value.validationKey !== record.validationKey ||
    JSON.stringify(report.value.counts) !== JSON.stringify(record.counts) ||
    report.value.outcome !== record.outcome
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation report differs from deterministic regeneration.",
    );
  }
  return { record, report, result: safeResult(record, report) };
}

export async function getCandidateValidation(
  dependencies: CandidateValidationDependencies,
  validationId: string,
): Promise<CandidateValidationResultV1 | null> {
  return (await readValidatedCandidateValidation(dependencies, validationId))?.result ?? null;
}

export async function getRunCandidateValidations(
  dependencies: CandidateValidationDependencies,
  runId: string,
  limit = 100,
): Promise<readonly CandidateValidationResultV1[]> {
  const records = dependencies.persistence.candidateValidations.listForRun(runId, limit);
  const results: CandidateValidationResultV1[] = [];
  for (const record of records) {
    const validated = await readValidatedCandidateValidation(dependencies, record.validationId);
    if (validated !== null) results.push(validated.result);
  }
  return results;
}

export async function validateCandidateGeneration(
  dependencies: CandidateValidationDependencies,
  generationId: string,
): Promise<CandidateValidationResultV1 | null> {
  const generation = dependencies.persistence.candidateGenerations.get(generationId);
  if (generation === null) return null;
  const accepted = await source(dependencies, generationId);
  if (accepted === null) return unavailable(generation.runId, generationId);
  const identity = validationIdentity(accepted.input);
  const existing = dependencies.persistence.candidateValidations.getByKey(identity.validationKey);
  if (existing !== null) {
    const validated = await readValidatedCandidateValidation(dependencies, existing.validationId);
    if (validated === null) {
      throw new PersistenceError("invalid_persisted_row", "The Candidate validation disappeared.");
    }
    return validated.result;
  }
  const prepared = buildCandidateValidationReport(accepted.input);
  const materialized = await dependencies.artifactStore.putPreparedBytes({
    preparedBytes: prepared.bytes,
    kind: CANDIDATE_VALIDATION_REPORT_KIND,
    mediaType: CANDIDATE_VALIDATION_REPORT_MEDIA_TYPE,
    sensitivity: CANDIDATE_VALIDATION_REPORT_SENSITIVITY,
  });
  const clock = dependencies.clock ?? (() => new Date());
  const record = CandidateValidationRecordV1Schema.parse({
    schemaVersion: CANDIDATE_VALIDATION_SCHEMA_VERSION,
    validationId: prepared.value.validationId,
    validationKey: prepared.value.validationKey,
    runId: prepared.value.runId,
    finalizationId: prepared.value.finalizationId,
    generationId: prepared.value.generationId,
    sourceCandidateArtifactId: prepared.value.sourceCandidateArtifactId,
    sourceCandidateFingerprint: prepared.value.sourceCandidateFingerprint,
    evidenceGraphArtifactId: prepared.value.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: prepared.value.evidenceGraphInputFingerprint,
    reportArtifactId: materialized.artifactId,
    reportArtifactRole: CANDIDATE_VALIDATION_REPORT_ROLE,
    reportFingerprint: prepared.fingerprint,
    outcome: prepared.value.outcome,
    counts: prepared.value.counts,
    sourceVersions: prepared.value.sourceVersions,
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    createdAt: timestamp(clock),
  });
  try {
    dependencies.persistence.withTransaction((repositories) => {
      repositories.candidateValidations.insert(record);
      repositories.artifacts.linkToRun({
        runId: record.runId,
        artifactId: record.reportArtifactId,
        role: record.reportArtifactRole,
        createdAt: record.createdAt,
      });
    });
  } catch (error) {
    const raced = dependencies.persistence.candidateValidations.getByKey(record.validationKey);
    if (raced !== null) {
      const validated = await readValidatedCandidateValidation(dependencies, raced.validationId);
      if (validated !== null) return validated.result;
    }
    throw error;
  }
  const persisted = await readValidatedCandidateValidation(dependencies, record.validationId);
  if (persisted === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate validation was not persisted.",
    );
  }
  return persisted.result;
}

export async function validateEligibleCandidateGenerations(
  dependencies: CandidateValidationDependencies,
  limit = MAX_CANDIDATE_VALIDATION_BATCH,
): Promise<readonly CandidateValidationResultV1[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 0), MAX_CANDIDATE_VALIDATION_BATCH);
  if (bounded < 1) return [];
  const generationIds =
    dependencies.persistence.candidateValidations.listUnvalidatedGenerationIds(bounded);
  const results: CandidateValidationResultV1[] = [];
  for (const generationId of generationIds) {
    const result = await validateCandidateGeneration(dependencies, generationId);
    if (result !== null) results.push(result);
  }
  return results;
}
