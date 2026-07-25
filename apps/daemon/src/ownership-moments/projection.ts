import { createHash } from "node:crypto";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  type CandidateGenerationRecordV1,
  type CandidateMomentBatchV1,
  type CandidateMomentV1,
  type CandidateValidationRecordV1,
  type CandidateValidationReportV1,
  type DeterministicEvidenceGraphV1,
  CandidateMomentV1Schema,
  type CandidateValidationItemV1,
  type OwnershipMomentProjectionItemV1,
  OWNERSHIP_MOMENTS_PROJECTION_VERSION,
  OWNERSHIP_MOMENTS_SCHEMA_VERSION,
  OwnershipMomentsProjectionV1Schema,
  type OwnershipMomentsProjectionV1,
} from "@ownloop/contracts";
import { canonicalizeJson, DEFAULT_CANONICAL_INPUT_LIMITS } from "@ownloop/ingress-security";

import {
  type CandidateGenerationDependencies,
  readValidatedCandidateGeneration,
} from "../candidate-generation/index.js";
import {
  type CandidateValidationDependencies,
  readValidatedCandidateValidation,
} from "../candidate-validation/index.js";
import {
  type EvidenceGraphReadDependencies,
  readValidatedRunEvidenceGraph,
} from "../evidence-graph/index.js";
import { PersistenceError } from "../persistence/index.js";

export type OwnershipMomentsDependencies = EvidenceGraphReadDependencies;

export type OwnershipMomentsBuilderInput = Readonly<{
  runId: string;
  validationRecord: CandidateValidationRecordV1;
  validationReport: CandidateValidationReportV1;
  generationRecord: CandidateGenerationRecordV1;
  candidateBatch: CandidateMomentBatchV1;
  evidenceGraphArtifactId: string;
  evidenceGraph: DeterministicEvidenceGraphV1;
}>;

function hash48(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 48);
}

function candidateFingerprint(candidate: CandidateMomentV1): string {
  const canonical = canonicalizeJson(candidate, DEFAULT_CANONICAL_INPUT_LIMITS);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function displayId(validationId: string, sourceIndex: number, fingerprint: string): string {
  return `mom_${hash48(`moment\0${validationId}\0${sourceIndex}\0${fingerprint}`)}`;
}

function unavailable(runId: string): OwnershipMomentsProjectionV1 {
  return OwnershipMomentsProjectionV1Schema.parse({
    ok: true,
    schemaVersion: OWNERSHIP_MOMENTS_SCHEMA_VERSION,
    projectionVersion: OWNERSHIP_MOMENTS_PROJECTION_VERSION,
    runId,
    outcome: "not_available",
    diagnosticCode: "validation_not_available",
    limitations: [],
    finalizationId: null,
    generationId: null,
    validationId: null,
    validationKey: null,
    sourceCandidateArtifactId: null,
    sourceCandidateFingerprint: null,
    reportArtifactId: null,
    reportFingerprint: null,
    evidenceGraphArtifactId: null,
    evidenceGraphInputFingerprint: null,
    sourceVersions: null,
    policyVersions: null,
    selectedCount: 0,
    moments: [],
  });
}

function selectedItem(
  validationId: string,
  item: CandidateValidationItemV1,
  candidate: CandidateMomentV1,
  graphEvidence: ReadonlySet<string>,
): OwnershipMomentProjectionItemV1 {
  if (item.decision !== "valid_selected" || item.selectedRank === null || item.score === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A selected Moment source is not a selected Candidate validation item.",
    );
  }
  const fingerprint = candidateFingerprint(candidate);
  if (fingerprint !== item.candidateFingerprint) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The selected Moment source Candidate fingerprint differs.",
    );
  }
  const cited = [...candidate.evidenceIds].toSorted();
  if (
    cited.length !== item.citedEvidenceIds.length ||
    cited.some((evidenceId, index) => evidenceId !== item.citedEvidenceIds[index])
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The selected Moment cited Evidence differs from validation.",
    );
  }
  const evidenceIds = [
    ...new Set([
      ...candidate.evidenceIds,
      ...item.expandedEvidenceIds,
      ...item.facts.flatMap((fact) => fact.evidenceIds),
    ]),
  ].toSorted();
  if (evidenceIds.some((evidenceId) => !graphEvidence.has(evidenceId))) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The selected Moment Evidence is outside the validated graph.",
    );
  }
  return {
    displayId: displayId(validationId, item.sourceIndex, fingerprint),
    selectedRank: item.selectedRank,
    sourceIndex: item.sourceIndex,
    sourceCandidateFingerprint: fingerprint,
    candidate: CandidateMomentV1Schema.parse(candidate),
    expandedEvidenceIds: [...item.expandedEvidenceIds],
    facts: item.facts.map((fact) => ({ ...fact, evidenceIds: [...fact.evidenceIds] })),
    score: { ...item.score },
    evidenceIds,
  };
}

export function prepareOwnershipMomentsProjection(
  input: OwnershipMomentsBuilderInput,
): OwnershipMomentsProjectionV1 {
  const { validationRecord, validationReport, generationRecord, candidateBatch, evidenceGraph } =
    input;
  if (
    validationRecord.runId !== input.runId ||
    validationReport.runId !== input.runId ||
    generationRecord.runId !== input.runId ||
    evidenceGraph.runId !== input.runId ||
    generationRecord.status !== "succeeded" ||
    generationRecord.finalizationId !== validationRecord.finalizationId ||
    validationReport.finalizationId !== validationRecord.finalizationId ||
    evidenceGraph.finalizationId !== validationRecord.finalizationId ||
    generationRecord.candidateArtifactId !== validationRecord.sourceCandidateArtifactId ||
    generationRecord.candidateFingerprint !== validationRecord.sourceCandidateFingerprint ||
    validationReport.sourceCandidateArtifactId !== validationRecord.sourceCandidateArtifactId ||
    validationReport.sourceCandidateFingerprint !== validationRecord.sourceCandidateFingerprint ||
    input.evidenceGraphArtifactId !== validationRecord.evidenceGraphArtifactId ||
    validationReport.evidenceGraphArtifactId !== validationRecord.evidenceGraphArtifactId ||
    evidenceGraph.inputFingerprint !== validationRecord.evidenceGraphInputFingerprint ||
    validationReport.evidenceGraphInputFingerprint !==
      validationRecord.evidenceGraphInputFingerprint ||
    evidenceGraph.outcome === "unavailable"
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Ownership Moment projection sources disagree.",
    );
  }
  const selectedItems = validationReport.items
    .filter((item) => item.decision === "valid_selected")
    .toSorted((left, right) => (left.selectedRank ?? 0) - (right.selectedRank ?? 0));
  if (
    selectedItems.length !== validationReport.counts.selected ||
    selectedItems.length !== validationReport.selectedSourceIndexes.length ||
    selectedItems.some(
      (item, index) =>
        item.selectedRank !== index + 1 ||
        item.sourceIndex !== validationReport.selectedSourceIndexes[index],
    )
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The selected Moment ranks differ from the validation report.",
    );
  }
  const graphEvidence = new Set(evidenceGraph.nodes.map((node) => node.evidenceId));
  const moments = selectedItems.map((item) => {
    const candidate = candidateBatch.candidates[item.sourceIndex];
    if (candidate === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "A selected Moment source Candidate index is unavailable.",
      );
    }
    return selectedItem(validationRecord.validationId, item, candidate, graphEvidence);
  });
  const partial = validationReport.outcome === "partial";
  return OwnershipMomentsProjectionV1Schema.parse({
    ok: true,
    schemaVersion: OWNERSHIP_MOMENTS_SCHEMA_VERSION,
    projectionVersion: OWNERSHIP_MOMENTS_PROJECTION_VERSION,
    runId: input.runId,
    outcome: partial ? "partial" : "ready",
    diagnosticCode: partial ? "source_partial" : "completed",
    limitations: partial ? ["source_graph_partial"] : [],
    finalizationId: validationRecord.finalizationId,
    generationId: validationRecord.generationId,
    validationId: validationRecord.validationId,
    validationKey: validationRecord.validationKey,
    sourceCandidateArtifactId: validationRecord.sourceCandidateArtifactId,
    sourceCandidateFingerprint: validationRecord.sourceCandidateFingerprint,
    reportArtifactId: validationRecord.reportArtifactId,
    reportFingerprint: validationRecord.reportFingerprint,
    evidenceGraphArtifactId: validationRecord.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: validationRecord.evidenceGraphInputFingerprint,
    sourceVersions: validationRecord.sourceVersions,
    policyVersions: {
      validatorVersion: CANDIDATE_VALIDATOR_VERSION,
      supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
      contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
      absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
      duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
      rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
      selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
    },
    selectedCount: moments.length,
    moments,
  });
}

export async function projectValidationOwnershipMoments(
  dependencies: OwnershipMomentsDependencies,
  runId: string,
  validationId: string,
): Promise<OwnershipMomentsProjectionV1 | null> {
  if (dependencies.persistence.taskRuns.get(runId) === null) return null;
  const current = dependencies.persistence.candidateValidations.get(validationId);
  if (current === null || current.runId !== runId) return null;
  const validation = await readValidatedCandidateValidation(
    dependencies as CandidateValidationDependencies,
    validationId,
  );
  if (validation === null || validation.record.runId !== runId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The requested Moment validation disappeared.",
    );
  }
  const generation = await readValidatedCandidateGeneration(
    dependencies as CandidateGenerationDependencies,
    validation.record.generationId,
  );
  if (generation === null || generation.candidate === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The requested Moment Candidate generation is unavailable.",
    );
  }
  const graph = await readValidatedRunEvidenceGraph(dependencies, runId);
  if (graph === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The requested Moment Evidence Graph is unavailable.",
    );
  }
  return prepareOwnershipMomentsProjection({
    runId,
    validationRecord: validation.record,
    validationReport: validation.report.value,
    generationRecord: generation.record,
    candidateBatch: generation.candidate,
    evidenceGraphArtifactId: graph.artifactId,
    evidenceGraph: graph.value,
  });
}

export async function projectRunOwnershipMoments(
  dependencies: OwnershipMomentsDependencies,
  runId: string,
): Promise<OwnershipMomentsProjectionV1 | null> {
  if (dependencies.persistence.taskRuns.get(runId) === null) return null;
  const current = dependencies.persistence.candidateValidations.getLatestForRun(runId);
  if (current === null) return unavailable(runId);
  return projectValidationOwnershipMoments(dependencies, runId, current.validationId);
}
