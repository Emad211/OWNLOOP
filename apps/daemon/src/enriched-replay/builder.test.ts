import {
  type CandidateGenerationRecordV1,
  type CandidateValidationRecordV1,
  MomentInteractionStateResponseV1Schema,
  OwnershipMomentsProjectionV1Schema,
  RawRunReplayV1Schema,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import {
  CHANGE_CANDIDATE,
  CHANGE_EVIDENCE,
  LABEL_EVIDENCE,
  VERIFICATION_EVIDENCE,
  candidateBatch,
  candidateValidationGraph,
  validatorInput,
} from "../candidate-validation/test-fixture.js";
import { buildCandidateValidationReport } from "../candidate-validation/validator.js";
import { prepareOwnershipMomentsProjection } from "../ownership-moments/projection.js";
import { prepareEnrichedBuildReplay } from "./builder.js";

const timestamp = "2026-07-25T19:00:00.000Z";

function momentProjection() {
  const input = validatorInput([CHANGE_CANDIDATE]);
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
    createdAt: timestamp,
  } as CandidateValidationRecordV1;
  const generationRecord = {
    runId: input.runId,
    finalizationId: input.finalizationId,
    generationId: input.generationId,
    status: "succeeded",
    candidateArtifactId: input.sourceCandidateArtifactId,
    candidateFingerprint: input.sourceCandidateFingerprint,
  } as CandidateGenerationRecordV1;
  return prepareOwnershipMomentsProjection({
    runId: input.runId,
    validationRecord,
    validationReport: prepared.value,
    generationRecord,
    candidateBatch: candidateBatch([CHANGE_CANDIDATE]),
    evidenceGraphArtifactId: input.evidenceGraphArtifactId,
    evidenceGraph: candidateValidationGraph(),
  });
}

function rawReplay(status: "Completed" | "Capturing" = "Completed") {
  const graph = candidateValidationGraph();
  const terminal = status === "Completed";
  return RawRunReplayV1Schema.parse({
    ok: true,
    schemaVersion: 1,
    run: {
      runId: "run-1",
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      runNumber: 1,
      status,
      completeness: terminal ? "complete" : "in_progress",
      promptPreview: "Implement enriched replay",
      promptTruncated: false,
      startedAt: timestamp,
      endedAt: terminal ? timestamp : null,
      evidenceGapCount: 0,
      presence: {
        baseline: false,
        reconciliation: terminal,
        finalization: terminal,
        finalManifest: false,
        terminalEvent: terminal,
      },
      redactedPrompt: "Implement enriched replay",
      sourceStopReason: terminal ? "stop" : null,
    },
    timeline: [],
    causalLinks: [],
    baseline: null,
    reconciliations: terminal
      ? [
          {
            reconciliationId: "reconciliation-1",
            boundary: "stop",
            outcome: "captured",
            diagnosticCode: null,
            attribution: "run_relative",
            baselineComparison: "changed",
            triggerEventId: "event-stop",
            summaryEventId: "event-summary",
            stagedDirty: false,
            unstagedDirty: true,
            capturedAt: timestamp,
            counts: {
              entries: 2,
              created: 0,
              modified: 2,
              deleted: 0,
              typeChanged: 0,
              unmerged: 0,
            },
            changedFiles: [
              {
                entryId: "reconciliation:one:entry:0",
                entryIndex: 0,
                relativePath: "src/behavior.ts",
                changeKind: "modified",
                staged: false,
                unstaged: true,
                sensitivity: "normal",
                attribution: "run_relative",
                fileEventId: "event-file",
                evidenceId: CHANGE_EVIDENCE,
              },
              {
                entryId: "reconciliation:one:entry:1",
                entryIndex: 1,
                relativePath: "src/unlinked.ts",
                changeKind: "modified",
                staged: false,
                unstaged: true,
                sensitivity: "normal",
                attribution: "run_relative",
                fileEventId: "event-unlinked",
              },
            ],
          },
        ]
      : [],
    verification: terminal
      ? [
          {
            eventId: "event-test",
            sequence: 2,
            type: "test.observed",
            occurredAt: timestamp,
            payload: { recognized: true, verificationKind: "test", status: "failed" },
            evidenceId: VERIFICATION_EVIDENCE,
          },
        ]
      : [],
    evidenceGaps: [],
    finalization: terminal
      ? {
          finalizationId: "finalization-1",
          terminalStatus: "Completed",
          mode: "normal",
          diagnosticCode: null,
          triggerEventId: "event-stop",
          reconciliationId: "reconciliation-1",
          finalSnapshotEventId: "event-snapshot",
          terminalEventId: "event-terminal",
          manifestArtifactId: null,
          finalizedAt: timestamp,
        }
      : null,
    artifacts: [],
    evidenceGraph: terminal
      ? {
          artifactId: "graph-artifact-1",
          outcome: "complete",
          limitations: [],
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        }
      : null,
  });
}

function interactionState(projection = momentProjection()) {
  const moment = projection.moments[0];
  if (projection.validationId === null || moment === undefined) throw new Error("fixture failed");
  return MomentInteractionStateResponseV1Schema.parse({
    ok: true,
    schemaVersion: 1,
    runId: projection.runId,
    validationId: projection.validationId,
    states: [
      {
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        viewCount: 1,
        evidenceViewCount: 1,
        acknowledgement: null,
        decisionResponse: null,
        riskResponse: null,
        checkChoiceId: null,
        usefulness: "unset",
        latestInteractionAt: timestamp,
        interactionCount: 2,
        ownershipRecordCount: 0,
      },
    ],
    totalInteractionCount: 2,
    totalOwnershipRecordCount: 0,
    recentInteractions: [
      {
        schemaVersion: 1,
        interactionId: `ix_${"1".repeat(48)}`,
        actor: "local_user",
        runId: projection.runId,
        validationId: projection.validationId,
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        action: { kind: "moment_viewed" },
        requestFingerprint: `sha256:${"a".repeat(64)}`,
        createdAt: timestamp,
      },
      {
        schemaVersion: 1,
        interactionId: `ix_${"2".repeat(48)}`,
        actor: "local_user",
        runId: projection.runId,
        validationId: projection.validationId,
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        action: { kind: "evidence_viewed", evidenceId: CHANGE_EVIDENCE },
        requestFingerprint: `sha256:${"b".repeat(64)}`,
        createdAt: timestamp,
      },
    ],
    recentOwnershipRecords: [],
    interactionHistoryTruncated: false,
    ownershipRecordHistoryTruncated: false,
  });
}

function graphEvidence() {
  return new Set(candidateValidationGraph().nodes.map((node) => node.evidenceId));
}

describe("Enriched Build Replay builder", () => {
  it("joins verified facts, selected Moments, interactions, and linked files deterministically", () => {
    const projection = momentProjection();
    const input = {
      rawReplay: rawReplay(),
      momentProjection: projection,
      interactionState: interactionState(projection),
      graphEvidenceIds: graphEvidence(),
    };
    const first = prepareEnrichedBuildReplay(input);
    const second = prepareEnrichedBuildReplay(input);
    expect(first).toEqual(second);
    expect(first.projectionFingerprint).toBe(second.projectionFingerprint);
    expect(first.outcome).toBe("ready");
    expect(first.files.items.map((item) => item.file.relativePath)).toEqual(["src/behavior.ts"]);
    expect(first.moments[0]?.review.activity).toBe("evidence_opened");
    expect(first.verification.items).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("src/unlinked.ts");
  });

  it("returns a content-free projection for an active Run", () => {
    const projection = momentProjection();
    const result = prepareEnrichedBuildReplay({
      rawReplay: rawReplay("Capturing"),
      momentProjection: projection,
      interactionState: interactionState(projection),
      graphEvidenceIds: graphEvidence(),
    });
    expect(result).toMatchObject({ outcome: "not_available", goal: null, source: null });
  });

  it("renders an honest factual partial replay when no current validation exists", () => {
    const unavailable = OwnershipMomentsProjectionV1Schema.parse({
      ok: true,
      schemaVersion: 1,
      projectionVersion: "0.1.0",
      runId: "run-1",
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
    const result = prepareEnrichedBuildReplay({
      rawReplay: rawReplay(),
      momentProjection: unavailable,
      interactionState: null,
      graphEvidenceIds: graphEvidence(),
    });
    expect(result).toMatchObject({
      outcome: "partial",
      limitations: ["moments_unavailable"],
      goal: "Implement enriched replay",
      moments: [],
    });
    expect(result.files.items).toHaveLength(0);
  });

  it("fails closed on foreign state, Graph Evidence, or finalization identity", () => {
    const projection = momentProjection();
    const state = interactionState(projection);
    expect(() =>
      prepareEnrichedBuildReplay({
        rawReplay: rawReplay(),
        momentProjection: projection,
        interactionState: { ...state, runId: "other-run" },
        graphEvidenceIds: graphEvidence(),
      }),
    ).toThrow();

    const missingEvidence = graphEvidence();
    missingEvidence.delete(LABEL_EVIDENCE);
    expect(() =>
      prepareEnrichedBuildReplay({
        rawReplay: rawReplay(),
        momentProjection: projection,
        interactionState: state,
        graphEvidenceIds: missingEvidence,
      }),
    ).toThrow();

    const replayWithFinalization = rawReplay();
    const finalization = replayWithFinalization.finalization;
    if (finalization === null || finalization === undefined) throw new Error("fixture failed");
    expect(() =>
      prepareEnrichedBuildReplay({
        rawReplay: {
          ...replayWithFinalization,
          finalization: {
            ...finalization,
            finalizationId: "other-finalization",
          },
        },
        momentProjection: projection,
        interactionState: state,
        graphEvidenceIds: graphEvidence(),
      }),
    ).toThrow();
  });
});
