import { type EnrichedBuildReplayV1, EnrichedBuildReplayV1Schema } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

const evidenceId = `ev_${"1".repeat(48)}`;
const validationId = `val_${"2".repeat(48)}`;
const validationKey = `vkey_${"3".repeat(48)}`;
const momentId = `mom_${"4".repeat(48)}`;
const fingerprint = `sha256:${"5".repeat(64)}`;
const timestamp = "2026-07-25T19:00:00.000Z";

const state = {
  momentId,
  sourceIndex: 0,
  sourceCandidateFingerprint: fingerprint,
  momentType: "change",
  viewCount: 1,
  evidenceViewCount: 0,
  acknowledgement: null,
  decisionResponse: null,
  riskResponse: null,
  checkChoiceId: null,
  usefulness: "unset",
  latestInteractionAt: timestamp,
  interactionCount: 1,
  ownershipRecordCount: 0,
} as const;

const ready = {
  ok: true,
  schemaVersion: 1,
  projectorVersion: "0.1.0",
  projectionFingerprint: fingerprint,
  runId: "run-1",
  outcome: "ready",
  diagnosticCode: "completed",
  limitations: [],
  source: {
    rawReplaySchemaVersion: 1,
    ownershipMomentsSchemaVersion: 1,
    ownershipMomentsProjectionVersion: "0.1.0",
    momentInteractionSchemaVersion: 1,
    finalizationId: "finalization-1",
    generationId: `gen_${"1".repeat(48)}`,
    validationId,
    validationKey,
    sourceCandidateArtifactId: "candidate-artifact-1",
    sourceCandidateFingerprint: fingerprint,
    reportArtifactId: "report-artifact-1",
    reportFingerprint: fingerprint,
    evidenceGraphArtifactId: "graph-1",
    evidenceGraphInputFingerprint: "6".repeat(64),
    sourceVersions: {
      evidenceGraphSchemaVersion: 1,
      evidenceGraphBuilderVersion: "0.1.0",
      evidenceGraphTaxonomyVersion: "ownloop-evidence-graph-v1",
      candidateMomentSchemaVersion: 1,
      candidateGenerationSchemaVersion: 1,
    },
    policyVersions: {
      validatorVersion: "0.1.0",
      supportPolicyVersion: "ownloop-candidate-support-v1",
      contradictionPolicyVersion: "ownloop-candidate-contradiction-v1",
      absencePolicyVersion: "ownloop-candidate-absence-v1",
      duplicatePolicyVersion: "ownloop-candidate-duplicate-v1",
      rankingPolicyVersion: "ownloop-candidate-ranking-v1",
      selectionPolicyVersion: "ownloop-candidate-selection-v1",
    },
  },
  goal: "Implement the replay.",
  completion: {
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    status: "Completed",
    completeness: "complete",
    startedAt: timestamp,
    endedAt: timestamp,
    finalizationDiagnostic: null,
    finalizedAt: timestamp,
  },
  files: {
    counts: { total: 1, returned: 1, truncated: false },
    items: [
      {
        reconciliationId: "reconciliation-1",
        reconciliationCapturedAt: timestamp,
        file: {
          entryId: "reconciliation:one:entry:0",
          entryIndex: 0,
          relativePath: "src/app.ts",
          changeKind: "modified",
          staged: false,
          unstaged: true,
          sensitivity: "normal",
          attribution: "run_relative",
          fileEventId: "event-1",
          evidenceId,
        },
        linkedMoments: [{ displayId: momentId, selectedRank: 1 }],
      },
    ],
  },
  moments: [
    {
      displayId: momentId,
      selectedRank: 1,
      sourceIndex: 0,
      sourceCandidateFingerprint: fingerprint,
      proposal: {
        type: "change",
        title: "Application changed",
        claim: "The application file was modified.",
        importance: "high",
        confidenceBasisPoints: 8000,
        evidenceIds: [evidenceId],
        suggestedInteraction: { kind: "acknowledge" },
      },
      support: {
        citedEvidenceIds: [evidenceId],
        expandedEvidenceIds: [],
        facts: [{ kind: "change_kind", value: "modified", evidenceIds: [evidenceId] }],
        score: {
          evidenceStrength: 10,
          urgency: 0,
          completenessAdjustment: 0,
          providerImportanceSignal: 1,
          providerConfidenceSignal: 1,
          attentionPenalty: 1,
          total: 11,
        },
        evidenceIds: [evidenceId],
      },
      review: { activity: "viewed", state },
    },
  ],
  verification: {
    counts: { total: 1, returned: 1, truncated: false },
    items: [
      {
        eventId: "event-2",
        sequence: 2,
        type: "test.observed",
        occurredAt: timestamp,
        payload: { recognized: true, status: "passed" },
        evidenceId,
      },
    ],
  },
  gaps: {
    counts: { total: 0, returned: 0, truncated: false },
    items: [],
  },
  reviewSummary: {
    selected: 1,
    none: 0,
    viewed: 1,
    evidenceOpened: 0,
    responded: 0,
    totalMomentViews: 1,
    totalEvidenceViews: 0,
    totalInteractions: 1,
    totalOwnershipRecords: 0,
  },
} as const;

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mutableReady(): DeepMutable<EnrichedBuildReplayV1> {
  return clone(ready) as unknown as DeepMutable<EnrichedBuildReplayV1>;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing test fixture value: ${label}`);
  }
  return value;
}

describe("Enriched Build Replay contracts", () => {
  it("accepts one strict ready replay", () => {
    expect(EnrichedBuildReplayV1Schema.parse(ready)).toEqual(ready);
  });

  it("accepts an honest partial factual replay without Moment sources", () => {
    const partial = mutableReady();
    partial.outcome = "partial";
    partial.diagnosticCode = "source_partial";
    partial.limitations = ["moments_unavailable"];
    const partialSource = requireValue(partial.source, "partial.source");
    partialSource.generationId = null;
    partialSource.validationId = null;
    partialSource.validationKey = null;
    partialSource.sourceCandidateArtifactId = null;
    partialSource.sourceCandidateFingerprint = null;
    partialSource.reportArtifactId = null;
    partialSource.reportFingerprint = null;
    partialSource.evidenceGraphInputFingerprint = null;
    partialSource.sourceVersions = null;
    partialSource.policyVersions = null;
    partial.files = { counts: { total: 0, returned: 0, truncated: false }, items: [] };
    partial.moments = [];
    partial.reviewSummary = {
      selected: 0,
      none: 0,
      viewed: 0,
      evidenceOpened: 0,
      responded: 0,
      totalMomentViews: 0,
      totalEvidenceViews: 0,
      totalInteractions: 0,
      totalOwnershipRecords: 0,
    };
    expect(EnrichedBuildReplayV1Schema.parse(partial).outcome).toBe("partial");
  });

  it("accepts a content-free non-terminal outcome", () => {
    const unavailable = {
      ok: true,
      schemaVersion: 1,
      projectorVersion: "0.1.0",
      projectionFingerprint: fingerprint,
      runId: "run-1",
      outcome: "not_available",
      diagnosticCode: "run_not_terminal",
      limitations: [],
      source: null,
      goal: null,
      completion: null,
      files: { counts: { total: 0, returned: 0, truncated: false }, items: [] },
      moments: [],
      verification: { counts: { total: 0, returned: 0, truncated: false }, items: [] },
      gaps: { counts: { total: 0, returned: 0, truncated: false }, items: [] },
      reviewSummary: {
        selected: 0,
        none: 0,
        viewed: 0,
        evidenceOpened: 0,
        responded: 0,
        totalMomentViews: 0,
        totalEvidenceViews: 0,
        totalInteractions: 0,
        totalOwnershipRecords: 0,
      },
    } as const;
    expect(EnrichedBuildReplayV1Schema.parse(unavailable)).toEqual(unavailable);
    expect(() => EnrichedBuildReplayV1Schema.parse({ ...unavailable, goal: "leak" })).toThrow();
  });

  it("rejects foreign review state and activity inflation", () => {
    const foreign = mutableReady();
    requireValue(foreign.moments[0], "foreign.moment").review.state.momentId =
      `mom_${"f".repeat(48)}`;
    expect(() => EnrichedBuildReplayV1Schema.parse(foreign)).toThrow();

    const inflated = mutableReady();
    requireValue(inflated.moments[0], "inflated.moment").review.activity = "responded";
    expect(() => EnrichedBuildReplayV1Schema.parse(inflated)).toThrow();
  });

  it("rejects Evidence, count, outcome, and extra-field disagreement", () => {
    const evidence = mutableReady();
    requireValue(evidence.moments[0], "evidence.moment").support.evidenceIds = [
      `ev_${"9".repeat(48)}`,
    ];
    expect(() => EnrichedBuildReplayV1Schema.parse(evidence)).toThrow();

    const counts = mutableReady();
    counts.files.counts.returned = 0;
    expect(() => EnrichedBuildReplayV1Schema.parse(counts)).toThrow();

    const outcome = mutableReady();
    outcome.limitations = ["moments_partial"];
    expect(() => EnrichedBuildReplayV1Schema.parse(outcome)).toThrow();

    expect(() =>
      EnrichedBuildReplayV1Schema.parse({ ...ready, providerResponse: "hidden" }),
    ).toThrow();

    const duplicateEvidence = mutableReady();
    const duplicateMoment = requireValue(duplicateEvidence.moments[0], "duplicate moment");
    duplicateMoment.support.citedEvidenceIds.push(
      requireValue(duplicateMoment.support.citedEvidenceIds[0], "cited Evidence"),
    );
    expect(() => EnrichedBuildReplayV1Schema.parse(duplicateEvidence)).toThrow();

    const incompleteSource = mutableReady();
    requireValue(incompleteSource.source, "incompleteSource.source").reportArtifactId = null;
    expect(() => EnrichedBuildReplayV1Schema.parse(incompleteSource)).toThrow();

    const foreignReference = mutableReady();
    const foreignFile = requireValue(foreignReference.files.items[0], "foreign file");
    requireValue(foreignFile.linkedMoments[0], "foreign file Moment").displayId =
      `mom_${"9".repeat(48)}`;
    expect(() => EnrichedBuildReplayV1Schema.parse(foreignReference)).toThrow();

    const totalMismatch = mutableReady();
    totalMismatch.reviewSummary.totalInteractions += 1;
    expect(() => EnrichedBuildReplayV1Schema.parse(totalMismatch)).toThrow();

    const rankMismatch = mutableReady();
    requireValue(rankMismatch.moments[0], "rank moment").selectedRank = 2;
    expect(() => EnrichedBuildReplayV1Schema.parse(rankMismatch)).toThrow();

    const duplicatedGapReference = mutableReady();
    duplicatedGapReference.gaps = {
      counts: { total: 1, returned: 1, truncated: false },
      items: [
        {
          gap: {
            gapId: "gap-1",
            code: "source_partial",
            message: "Source evidence is partial.",
            createdAt: timestamp,
            evidenceId,
          },
          linkedMoments: [
            { displayId: momentId, selectedRank: 1 },
            { displayId: momentId, selectedRank: 1 },
          ],
        },
      ],
    };
    expect(() => EnrichedBuildReplayV1Schema.parse(duplicatedGapReference)).toThrow();
  });
});
