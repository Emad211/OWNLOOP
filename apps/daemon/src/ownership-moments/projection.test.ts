import type {
  CandidateGenerationRecordV1,
  CandidateValidationRecordV1,
  OwnershipMomentsProjectionV1,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import {
  CHANGE_CANDIDATE,
  CHECK_CANDIDATE,
  RISK_CANDIDATE,
  candidateBatch,
  candidateValidationGraph,
  validatorInput,
} from "../candidate-validation/test-fixture.js";
import { buildCandidateValidationReport } from "../candidate-validation/validator.js";
import { prepareOwnershipMomentsProjection } from "./projection.js";

function fixture(): OwnershipMomentsProjectionV1 {
  const candidates = [
    CHANGE_CANDIDATE,
    {
      ...CHANGE_CANDIDATE,
      title: "Unsupported semantic claim",
      claim: "Performance improved substantially",
    },
    RISK_CANDIDATE,
    CHECK_CANDIDATE,
  ] as const;
  const input = validatorInput(candidates);
  const prepared = buildCandidateValidationReport(input);
  const validationRecord = {
    schemaVersion: prepared.value.schemaVersion,
    validationId: prepared.value.validationId,
    validationKey: prepared.value.validationKey,
    runId: prepared.value.runId,
    finalizationId: prepared.value.finalizationId,
    generationId: prepared.value.generationId,
    sourceCandidateArtifactId: prepared.value.sourceCandidateArtifactId,
    sourceCandidateFingerprint: prepared.value.sourceCandidateFingerprint,
    evidenceGraphArtifactId: prepared.value.evidenceGraphArtifactId,
    evidenceGraphInputFingerprint: prepared.value.evidenceGraphInputFingerprint,
    reportArtifactId: "validation-report-1",
    reportArtifactRole: "candidate-validation-report-v1",
    reportFingerprint: prepared.fingerprint,
    outcome: prepared.value.outcome,
    counts: prepared.value.counts,
    sourceVersions: prepared.value.sourceVersions,
    validatorVersion: prepared.value.validatorVersion,
    supportPolicyVersion: prepared.value.supportPolicyVersion,
    contradictionPolicyVersion: prepared.value.contradictionPolicyVersion,
    absencePolicyVersion: prepared.value.absencePolicyVersion,
    duplicatePolicyVersion: prepared.value.duplicatePolicyVersion,
    rankingPolicyVersion: prepared.value.rankingPolicyVersion,
    selectionPolicyVersion: prepared.value.selectionPolicyVersion,
    createdAt: "2026-07-25T10:00:00.000Z",
  } as CandidateValidationRecordV1;
  const generationRecord = {
    runId: prepared.value.runId,
    finalizationId: prepared.value.finalizationId,
    generationId: prepared.value.generationId,
    status: "succeeded",
    candidateArtifactId: prepared.value.sourceCandidateArtifactId,
    candidateFingerprint: prepared.value.sourceCandidateFingerprint,
  } as CandidateGenerationRecordV1;
  return prepareOwnershipMomentsProjection({
    runId: input.runId,
    validationRecord,
    validationReport: prepared.value,
    generationRecord,
    candidateBatch: candidateBatch(candidates),
    evidenceGraphArtifactId: input.evidenceGraphArtifactId,
    evidenceGraph: input.evidenceGraph,
  });
}

describe("Ownership Moment projection", () => {
  it("projects only selected Candidates in deterministic rank order", () => {
    const projection = fixture();
    expect(projection.outcome).toBe("ready");
    expect(projection.selectedCount).toBeGreaterThan(0);
    expect(projection.moments.map((item) => item.selectedRank)).toEqual(
      projection.moments.map((_item, index) => index + 1),
    );
    expect(JSON.stringify(projection)).not.toContain("Unsupported semantic claim");
    expect(JSON.stringify(projection)).not.toContain("Performance improved substantially");
    expect(projection.moments.every((item) => item.evidenceIds.length > 0)).toBe(true);
    expect(projection.moments.every((item) => item.displayId.startsWith("mom_"))).toBe(true);
  });

  it("returns not-available without reading or writing artifacts", async () => {
    let artifactReads = 0;
    const projection = await (await import("./projection.js")).projectRunOwnershipMoments(
      {
        persistence: {
          taskRuns: { get: () => ({ runId: "run-1" }) },
          candidateValidations: { getLatestForRun: () => null },
        },
        artifactStore: {
          async readPreparedBytes() {
            artifactReads += 1;
            throw new Error("not expected");
          },
        },
      } as never,
      "run-1",
    );
    expect(projection).toMatchObject({ outcome: "not_available", moments: [] });
    expect(artifactReads).toBe(0);
  });

  it("accepts a verified validation that selected zero Candidates", () => {
    const rejected = {
      ...CHANGE_CANDIDATE,
      title: "Performance improved",
      claim: "Performance improved",
    } as const;
    const input = validatorInput([rejected]);
    const prepared = buildCandidateValidationReport(input);
    const validationRecord = {
      ...prepared.value,
      reportArtifactId: "validation-report-1",
      reportArtifactRole: "candidate-validation-report-v1",
      reportFingerprint: prepared.fingerprint,
      createdAt: "2026-07-25T10:00:00.000Z",
    } as unknown as CandidateValidationRecordV1;
    const generationRecord = {
      runId: input.runId,
      finalizationId: input.finalizationId,
      generationId: input.generationId,
      status: "succeeded",
      candidateArtifactId: input.sourceCandidateArtifactId,
      candidateFingerprint: input.sourceCandidateFingerprint,
    } as CandidateGenerationRecordV1;
    const projection = prepareOwnershipMomentsProjection({
      runId: input.runId,
      validationRecord,
      validationReport: prepared.value,
      generationRecord,
      candidateBatch: candidateBatch([rejected]),
      evidenceGraphArtifactId: input.evidenceGraphArtifactId,
      evidenceGraph: candidateValidationGraph(),
    });
    expect(projection).toMatchObject({ outcome: "ready", selectedCount: 0, moments: [] });
  });

  it("is byte-stable for the same verified source state", () => {
    expect(JSON.stringify(fixture())).toBe(JSON.stringify(fixture()));
  });

  it("fails closed when source Candidate identity differs", () => {
    const candidates = [CHANGE_CANDIDATE];
    const input = validatorInput(candidates);
    const prepared = buildCandidateValidationReport(input);
    const validationRecord = {
      ...prepared.value,
      reportArtifactId: "validation-report-1",
      reportArtifactRole: "candidate-validation-report-v1",
      reportFingerprint: prepared.fingerprint,
      counts: prepared.value.counts,
      createdAt: "2026-07-25T10:00:00.000Z",
    } as unknown as CandidateValidationRecordV1;
    const generationRecord = {
      runId: input.runId,
      finalizationId: input.finalizationId,
      generationId: input.generationId,
      status: "succeeded",
      candidateArtifactId: input.sourceCandidateArtifactId,
      candidateFingerprint: input.sourceCandidateFingerprint,
    } as CandidateGenerationRecordV1;
    expect(() =>
      prepareOwnershipMomentsProjection({
        runId: input.runId,
        validationRecord,
        validationReport: prepared.value,
        generationRecord,
        candidateBatch: candidateBatch([{ ...CHANGE_CANDIDATE, claim: "File deleted" }]),
        evidenceGraphArtifactId: input.evidenceGraphArtifactId,
        evidenceGraph: candidateValidationGraph(),
      }),
    ).toThrow();
  });
});
