import { describe, expect, it } from "vitest";

import {
  CandidateValidationRecordV1Schema,
  CandidateValidationReportV1Schema,
  CandidateValidationResultV1Schema,
  type CandidateValidationReportV1,
} from "../src/candidate-validation.js";

const fingerprint = `sha256:${"a".repeat(64)}`;
const validationId = `val_${"1".repeat(48)}`;
const validationKey = `vkey_${"2".repeat(48)}`;

type WidenMutable<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer Item)[]
        ? WidenMutable<Item>[]
        : T extends object
          ? { -readonly [Key in keyof T]: WidenMutable<T[Key]> }
          : T;

type MutableReportFixture = WidenMutable<CandidateValidationReportV1>;

function report(): MutableReportFixture {
  return {
    schemaVersion: 1,
    validatorVersion: "0.1.0",
    supportPolicyVersion: "ownloop-candidate-support-v1",
    contradictionPolicyVersion: "ownloop-candidate-contradiction-v1",
    absencePolicyVersion: "ownloop-candidate-absence-v1",
    duplicatePolicyVersion: "ownloop-candidate-duplicate-v1",
    rankingPolicyVersion: "ownloop-candidate-ranking-v1",
    selectionPolicyVersion: "ownloop-candidate-selection-v1",
    validationId,
    validationKey,
    runId: "run-1",
    finalizationId: "finalization-1",
    generationId: `gen_${"3".repeat(48)}`,
    sourceCandidateArtifactId: "candidate-1",
    sourceCandidateFingerprint: fingerprint,
    evidenceGraphArtifactId: "graph-1",
    evidenceGraphInputFingerprint: "b".repeat(64),
    sourceVersions: {
      evidenceGraphSchemaVersion: 1,
      evidenceGraphBuilderVersion: "0.1.0",
      evidenceGraphTaxonomyVersion: "ownloop-evidence-graph-v1",
      candidateMomentSchemaVersion: 1,
      candidateGenerationSchemaVersion: 1,
    },
    outcome: "ready" as const,
    diagnosticCode: "completed" as const,
    limitations: [],
    items: [],
    counts: { source: 0, rejected: 0, valid: 0, selected: 0, duplicate: 0, unselected: 0 },
    selectedSourceIndexes: [],
    reportFingerprint: fingerprint,
  };
}

describe("Candidate validation contracts", () => {
  it("accepts a strict zero-Candidate report and record", () => {
    const value = CandidateValidationReportV1Schema.parse(report());
    expect(value.counts.selected).toBe(0);
    expect(
      CandidateValidationRecordV1Schema.parse({
        schemaVersion: 1,
        validationId,
        validationKey,
        runId: "run-1",
        finalizationId: "finalization-1",
        generationId: `gen_${"3".repeat(48)}`,
        sourceCandidateArtifactId: "candidate-1",
        sourceCandidateFingerprint: fingerprint,
        evidenceGraphArtifactId: "graph-1",
        evidenceGraphInputFingerprint: "b".repeat(64),
        reportArtifactId: "report-1",
        reportArtifactRole: "candidate-validation-report-v1",
        reportFingerprint: fingerprint,
        outcome: "ready",
        counts: value.counts,
        sourceVersions: value.sourceVersions,
        validatorVersion: "0.1.0",
        supportPolicyVersion: "ownloop-candidate-support-v1",
        contradictionPolicyVersion: "ownloop-candidate-contradiction-v1",
        absencePolicyVersion: "ownloop-candidate-absence-v1",
        duplicatePolicyVersion: "ownloop-candidate-duplicate-v1",
        rankingPolicyVersion: "ownloop-candidate-ranking-v1",
        selectionPolicyVersion: "ownloop-candidate-selection-v1",
        createdAt: "2026-07-24T00:00:00.000Z",
      }).reportArtifactRole,
    ).toBe("candidate-validation-report-v1");
  });

  it("rejects inconsistent selected ordering and duplicate fields", () => {
    const selected: MutableReportFixture = {
      ...report(),
      items: [
        {
          sourceIndex: 0,
          candidateFingerprint: fingerprint,
          citedEvidenceIds: [`ev_${"1".repeat(48)}`],
          expandedEvidenceIds: [],
          facts: [],
          decision: "valid_selected",
          reasons: [],
          duplicateGroupId: null,
          representativeSourceIndex: null,
          attentionCost: 10,
          score: {
            evidenceStrength: 1,
            urgency: 0,
            completenessAdjustment: 0,
            providerImportanceSignal: 0,
            providerConfidenceSignal: 0,
            attentionPenalty: 0,
            total: 1,
          },
          selectedRank: 1,
        },
      ],
      counts: { source: 1, rejected: 0, valid: 1, selected: 1, duplicate: 0, unselected: 0 },
      selectedSourceIndexes: [],
    };
    expect(() => CandidateValidationReportV1Schema.parse(selected)).toThrow();

    const duplicate = structuredClone(selected);
    duplicate.items[0]!.decision = "valid_unselected";
    duplicate.items[0]!.selectedRank = null;
    duplicate.items[0]!.reasons = ["duplicate_candidate"];
    duplicate.items[0]!.duplicateGroupId = `dup_${"4".repeat(48)}`;
    duplicate.items[0]!.representativeSourceIndex = 0;
    duplicate.counts.selected = 0;
    duplicate.counts.unselected = 1;
    duplicate.counts.duplicate = 1;
    expect(() => CandidateValidationReportV1Schema.parse(duplicate)).toThrow();
  });

  it("keeps unavailable public results text-free", () => {
    const value = CandidateValidationResultV1Schema.parse({
      schemaVersion: 1,
      validatorVersion: "0.1.0",
      supportPolicyVersion: "ownloop-candidate-support-v1",
      contradictionPolicyVersion: "ownloop-candidate-contradiction-v1",
      absencePolicyVersion: "ownloop-candidate-absence-v1",
      duplicatePolicyVersion: "ownloop-candidate-duplicate-v1",
      rankingPolicyVersion: "ownloop-candidate-ranking-v1",
      selectionPolicyVersion: "ownloop-candidate-selection-v1",
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: [],
      validationId: null,
      validationKey: null,
      runId: "run-1",
      generationId: `gen_${"3".repeat(48)}`,
      sourceCandidateArtifactId: null,
      sourceCandidateFingerprint: null,
      evidenceGraphArtifactId: null,
      evidenceGraphInputFingerprint: null,
      reportArtifactId: null,
      reportFingerprint: null,
      counts: { source: 0, rejected: 0, valid: 0, selected: 0, duplicate: 0, unselected: 0 },
      selectedSourceIndexes: [],
      sourceVersions: null,
    });
    expect(value).not.toHaveProperty("claim");
    expect(value).not.toHaveProperty("title");
  });

  it("rejects source-version drift and inconsistent score arithmetic", () => {
    const versionDrift = structuredClone(report());
    versionDrift.sourceVersions.evidenceGraphTaxonomyVersion = "old-taxonomy";
    expect(() => CandidateValidationReportV1Schema.parse(versionDrift)).toThrow();

    const scored = structuredClone(report());
    scored.items = [
      {
        sourceIndex: 0,
        candidateFingerprint: fingerprint,
        citedEvidenceIds: [`ev_${"1".repeat(48)}`],
        expandedEvidenceIds: [],
        facts: [],
        decision: "valid_selected",
        reasons: [],
        duplicateGroupId: null,
        representativeSourceIndex: null,
        attentionCost: 10,
        score: {
          evidenceStrength: 10,
          urgency: 2,
          completenessAdjustment: 0,
          providerImportanceSignal: 0,
          providerConfidenceSignal: 0,
          attentionPenalty: 1,
          total: 999,
        },
        selectedRank: 1,
      },
    ];
    scored.counts = {
      source: 1,
      rejected: 0,
      valid: 1,
      selected: 1,
      duplicate: 0,
      unselected: 0,
    };
    scored.selectedSourceIndexes = [0];
    expect(() => CandidateValidationReportV1Schema.parse(scored)).toThrow();
  });

  it("rejects illegal unselected reasons, half duplicate fields, and support drift", () => {
    const baseItem = {
      sourceIndex: 0,
      candidateFingerprint: fingerprint,
      citedEvidenceIds: [`ev_${"1".repeat(48)}`],
      expandedEvidenceIds: [],
      facts: [],
      decision: "valid_unselected",
      reasons: ["ranked_below_limit"],
      duplicateGroupId: null,
      representativeSourceIndex: null,
      attentionCost: 10,
      score: {
        evidenceStrength: 10,
        urgency: 0,
        completenessAdjustment: 0,
        providerImportanceSignal: 0,
        providerConfidenceSignal: 0,
        attentionPenalty: 1,
        total: 9,
      },
      selectedRank: null,
    };
    const value: MutableReportFixture = {
      ...report(),
      items: [baseItem],
      counts: { source: 1, rejected: 0, valid: 1, selected: 0, duplicate: 0, unselected: 1 },
    };
    expect(CandidateValidationReportV1Schema.parse(value).counts.valid).toBe(1);

    const illegalReason = structuredClone(value);
    illegalReason.items[0]!.reasons = ["missing_evidence"];
    expect(() => CandidateValidationReportV1Schema.parse(illegalReason)).toThrow();

    const halfDuplicate = structuredClone(value);
    halfDuplicate.items[0]!.reasons = ["duplicate_candidate"];
    halfDuplicate.items[0]!.duplicateGroupId = `dup_${"4".repeat(48)}`;
    halfDuplicate.counts.duplicate = 1;
    expect(() => CandidateValidationReportV1Schema.parse(halfDuplicate)).toThrow();

    const overlap = structuredClone(value);
    overlap.items[0]!.expandedEvidenceIds = overlap.items[0]!.citedEvidenceIds;
    expect(() => CandidateValidationReportV1Schema.parse(overlap)).toThrow();

    const outsideFact = structuredClone(value);
    outsideFact.items[0]!.facts = [
      {
        kind: "change_kind",
        value: "modified",
        evidenceIds: [`ev_${"9".repeat(48)}`],
      },
    ];
    expect(() => CandidateValidationReportV1Schema.parse(outsideFact)).toThrow();
  });
});
