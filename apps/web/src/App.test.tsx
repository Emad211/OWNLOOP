import {
  CANDIDATE_GENERATION_SCHEMA_VERSION,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  MomentInteractionStateResponseV1Schema,
  OwnershipMomentsProjectionV1Schema,
  type RawRunReplayV1,
  type ReplayRunSummaryV1,
} from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  interactionStateMatchesProjection,
  preferNewerBuildReplay,
  ReplayViewer,
} from "./App.js";
import { createReplayApiClient } from "./api.js";

const summary: ReplayRunSummaryV1 = {
  runId: "run-1",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
  runNumber: 1,
  status: "Partial",
  completeness: "partial",
  promptPreview: "Review a changed file",
  promptTruncated: false,
  startedAt: "2026-07-22T10:00:00.000Z",
  endedAt: "2026-07-22T10:02:00.000Z",
  evidenceGapCount: 1,
  presence: {
    baseline: true,
    reconciliation: true,
    finalization: true,
    finalManifest: false,
    terminalEvent: true,
  },
};

const replay: RawRunReplayV1 = {
  ok: true,
  schemaVersion: 1,
  run: {
    ...summary,
    redactedPrompt: "Review a changed file [REDACTED]",
    sourceStopReason: "stop",
  },
  timeline: [
    {
      eventId: "event-1",
      sequence: 1,
      type: "run.started",
      source: "ownloop",
      sensitivity: "normal",
      occurredAt: "2026-07-22T10:00:00.000Z",
      ingestedAt: "2026-07-22T10:00:00.000Z",
      payload: {},
      metadata: { collectorVersion: "0.1.0", sourceVersion: null },
      evidenceId: "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ],
  causalLinks: [],
  baseline: null,
  reconciliations: [],
  verification: [],
  evidenceGaps: [
    {
      gapId: "gap-1",
      code: "baseline_partial",
      message: "The baseline was incomplete.",
      createdAt: "2026-07-22T10:02:00.000Z",
      evidenceId: "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ],
  finalization: {
    finalizationId: "finalization-1",
    terminalStatus: "Partial",
    mode: "normal",
    diagnosticCode: "baseline_partial",
    triggerEventId: "event-1",
    reconciliationId: null,
    finalSnapshotEventId: null,
    terminalEventId: "event-1",
    manifestArtifactId: null,
    finalizedAt: "2026-07-22T10:02:00.000Z",
    evidenceId: "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  artifacts: [],
  evidenceGraph: {
    artifactId: "graph-artifact",
    outcome: "partial",
    limitations: ["diff_hunks_not_retained"],
    nodeCount: 12,
    edgeCount: 16,
  },
};

const evidenceId = "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const score = {
  evidenceStrength: 1000,
  urgency: 100,
  completenessAdjustment: 0,
  providerImportanceSignal: 50,
  providerConfidenceSignal: 25,
  attentionPenalty: 10,
  total: 1165,
};
const momentsProjection = OwnershipMomentsProjectionV1Schema.parse({
  ok: true,
  schemaVersion: 1,
  projectionVersion: "0.1.0",
  runId: "run-1",
  outcome: "partial",
  diagnosticCode: "source_partial",
  limitations: ["source_graph_partial"],
  finalizationId: "finalization-1",
  generationId: `gen_${"a".repeat(48)}`,
  validationId: `val_${"b".repeat(48)}`,
  validationKey: `vkey_${"c".repeat(48)}`,
  sourceCandidateArtifactId: "candidate-artifact-1",
  sourceCandidateFingerprint: `sha256:${"d".repeat(64)}`,
  reportArtifactId: "validation-report-1",
  reportFingerprint: `sha256:${"e".repeat(64)}`,
  evidenceGraphArtifactId: "graph-artifact",
  evidenceGraphInputFingerprint: "f".repeat(64),
  sourceVersions: {
    evidenceGraphSchemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    evidenceGraphBuilderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
    evidenceGraphTaxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    candidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    candidateGenerationSchemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
  },
  policyVersions: {
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  },
  selectedCount: 4,
  moments: [
    {
      displayId: `mom_${"1".repeat(48)}`,
      selectedRank: 1,
      sourceIndex: 0,
      sourceCandidateFingerprint: `sha256:${"1".repeat(64)}`,
      candidate: {
        type: "change",
        title: "Behavior file modified",
        claim: "Behavior file modified",
        importance: "high",
        confidenceBasisPoints: 8000,
        evidenceIds: [evidenceId],
        suggestedInteraction: { kind: "acknowledge" },
      },
      expandedEvidenceIds: [],
      facts: [{ kind: "change_kind", value: "modified", evidenceIds: [evidenceId] }],
      score,
      evidenceIds: [evidenceId],
    },
    {
      displayId: `mom_${"2".repeat(48)}`,
      selectedRank: 2,
      sourceIndex: 1,
      sourceCandidateFingerprint: `sha256:${"2".repeat(64)}`,
      candidate: {
        type: "decision",
        title: "Decision observed",
        claim: "Decision observed",
        importance: "medium",
        confidenceBasisPoints: 7000,
        evidenceIds: [evidenceId],
        suggestedInteraction: {
          kind: "decision_response",
          prompt: "Confirm decision observed",
          options: ["confirm", "revise", "uncertain"],
        },
      },
      expandedEvidenceIds: [],
      facts: [
        { kind: "decision_observed", eventType: "agent.plan_observed", evidenceIds: [evidenceId] },
      ],
      score,
      evidenceIds: [evidenceId],
    },
    {
      displayId: `mom_${"3".repeat(48)}`,
      selectedRank: 3,
      sourceIndex: 2,
      sourceCandidateFingerprint: `sha256:${"3".repeat(64)}`,
      candidate: {
        type: "risk",
        title: "Test failed",
        claim: "Test failed",
        importance: "critical",
        confidenceBasisPoints: 9000,
        evidenceIds: [evidenceId],
        suggestedInteraction: {
          kind: "risk_response",
          prompt: "Respond to test failure",
          options: ["acknowledge", "mitigate", "dismiss"],
        },
      },
      expandedEvidenceIds: [],
      facts: [
        {
          kind: "verification_status",
          verificationKind: "test",
          observedStatus: "failed",
          evidenceIds: [evidenceId],
        },
      ],
      score,
      evidenceIds: [evidenceId],
    },
    {
      displayId: `mom_${"4".repeat(48)}`,
      selectedRank: 4,
      sourceIndex: 3,
      sourceCandidateFingerprint: `sha256:${"4".repeat(64)}`,
      candidate: {
        type: "check",
        title: "Confirm the changed behavior",
        claim: "Behavior file modified",
        importance: "low",
        confidenceBasisPoints: 6000,
        evidenceIds: [evidenceId],
        suggestedInteraction: {
          kind: "check_answer",
          question: "Was the behavior intended?",
          choices: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      },
      expandedEvidenceIds: [],
      facts: [{ kind: "classification_label", value: "behavior", evidenceIds: [evidenceId] }],
      score,
      evidenceIds: [evidenceId],
    },
  ],
});

describe("Raw Replay viewer", () => {
  it("renders semantic Run, timeline, uncertainty, and no-verification states", () => {
    const html = renderToStaticMarkup(
      <ReplayViewer
        state="ready"
        statusMessage=""
        runs={[summary]}
        replay={replay}
        manifest={null}
        moments={null}
        momentState="idle"
        momentStatusMessage=""
        interactionState={null}
        interactionLoadState="ready"
        interactionStatusMessage=""
        buildReplay={null}
        buildReplayState="idle"
        buildReplayStatusMessage=""
        selectedRunId="run-1"
        nextCursor={null}
        onSelectRun={() => undefined}
        onLoadMore={() => undefined}
        onLoadArtifact={() => undefined}
        onResolveEvidence={() => undefined}
        onResolveMomentEvidence={async () => undefined}
        onRecordMomentInteraction={async () => {
          throw new Error("not invoked during static rendering");
        }}
        onDisconnect={() => undefined}
      />,
    );
    expect(html).toContain("Raw Build Replay");
    expect(html).toContain("Replay completeness");
    expect(html).toContain("Evidence gaps");
    expect(html).toContain("No verification Event was observed");
    expect(html).toContain("run.started");
    expect(html).toContain("Evidence Graph");
    expect(html).toContain("diff hunks not retained");
    expect(html).toContain("View evidence");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders four finite Moment types with proposal/support separation and durable controls", () => {
    const html = renderToStaticMarkup(
      <ReplayViewer
        state="ready"
        statusMessage=""
        runs={[summary]}
        replay={replay}
        manifest={null}
        moments={momentsProjection}
        momentState="ready"
        momentStatusMessage=""
        interactionState={null}
        interactionLoadState="ready"
        interactionStatusMessage=""
        buildReplay={null}
        buildReplayState="idle"
        buildReplayStatusMessage=""
        selectedRunId="run-1"
        nextCursor={null}
        onSelectRun={() => undefined}
        onLoadMore={() => undefined}
        onLoadArtifact={() => undefined}
        onResolveEvidence={() => undefined}
        onResolveMomentEvidence={async () => undefined}
        onRecordMomentInteraction={async () => {
          throw new Error("not invoked during static rendering");
        }}
        onDisconnect={() => undefined}
      />,
    );
    for (const value of ["change", "decision", "risk", "check"]) {
      expect(html).toContain(`moment-${value}`);
    }
    expect(html).toContain("AI-proposed, deterministically validated statement");
    expect(html).toContain("Persisted supporting facts");
    expect(html).toContain("Proposal signals — not proof");
    expect(html).toContain("Durable local interaction");
    expect(html).toContain("Recorded interactions show what was selected or viewed");
    expect(html).toContain("Recorded state loaded");
    expect(html).toContain("No feedback");
    expect(html).toContain("View evidence");
    expect(html).not.toContain("localStorage");
  });

  it("hydrates durable exact-validation controls without claiming comprehension", () => {
    const interactionState = MomentInteractionStateResponseV1Schema.parse({
      ok: true,
      schemaVersion: 1,
      runId: "run-1",
      validationId: momentsProjection.validationId,
      states: momentsProjection.moments.map((moment, index) => ({
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        viewCount: 1,
        evidenceViewCount: 0,
        acknowledgement: moment.candidate.type === "change" ? true : null,
        decisionResponse: moment.candidate.type === "decision" ? "revise" : null,
        riskResponse: moment.candidate.type === "risk" ? "mitigate" : null,
        checkChoiceId: moment.candidate.type === "check" ? "yes" : null,
        usefulness: "useful",
        latestInteractionAt: "2026-07-25T15:00:00.000Z",
        interactionCount: 2,
        ownershipRecordCount: 1,
      })),
      totalInteractionCount: 8,
      totalOwnershipRecordCount: 4,
      recentInteractions: momentsProjection.moments.flatMap((moment, index) => [
        {
          schemaVersion: 1,
          interactionId: `ix_${(index * 2).toString(16).padStart(48, "0")}`,
          actor: "local_user",
          runId: "run-1",
          validationId: momentsProjection.validationId,
          momentId: moment.displayId,
          sourceIndex: moment.sourceIndex,
          sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
          momentType: moment.candidate.type,
          action: { kind: "moment_viewed" },
          requestFingerprint: `sha256:${"8".repeat(64)}`,
          createdAt: "2026-07-25T15:00:00.000Z",
        },
        {
          schemaVersion: 1,
          interactionId: `ix_${(index * 2 + 1).toString(16).padStart(48, "0")}`,
          actor: "local_user",
          runId: "run-1",
          validationId: momentsProjection.validationId,
          momentId: moment.displayId,
          sourceIndex: moment.sourceIndex,
          sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
          momentType: moment.candidate.type,
          action:
            moment.candidate.type === "change"
              ? { kind: "acknowledgement_set", value: true }
              : moment.candidate.type === "decision"
                ? { kind: "decision_response_set", value: "revise" }
                : moment.candidate.type === "risk"
                  ? { kind: "risk_response_set", value: "mitigate" }
                  : { kind: "check_answer_set", choiceId: "yes" },
          requestFingerprint: `sha256:${"9".repeat(64)}`,
          createdAt: "2026-07-25T15:00:00.000Z",
        },
      ]),
      recentOwnershipRecords: momentsProjection.moments.map((moment, index) => ({
        schemaVersion: 1,
        recordId: `or_${index.toString(16).padStart(48, "0")}`,
        interactionId: `ix_${(index * 2 + 1).toString(16).padStart(48, "0")}`,
        actor: "local_user",
        runId: "run-1",
        validationId: momentsProjection.validationId,
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        recordKind:
          moment.candidate.type === "change"
            ? "acknowledgement_recorded"
            : moment.candidate.type === "check"
              ? "answer_recorded"
              : "response_recorded",
        valueCode:
          moment.candidate.type === "change"
            ? "acknowledged"
            : moment.candidate.type === "decision"
              ? "revise"
              : moment.candidate.type === "risk"
                ? "mitigate"
                : "yes",
        assertionCode: "interaction_recorded",
        noComprehensionClaim: true,
        createdAt: "2026-07-25T15:00:00.000Z",
      })),
      interactionHistoryTruncated: false,
      ownershipRecordHistoryTruncated: false,
    });
    const html = renderToStaticMarkup(
      <ReplayViewer
        state="ready"
        statusMessage=""
        runs={[summary]}
        replay={replay}
        manifest={null}
        moments={momentsProjection}
        momentState="ready"
        momentStatusMessage=""
        interactionState={interactionState}
        interactionLoadState="ready"
        interactionStatusMessage="Interaction recorded locally."
        buildReplay={null}
        buildReplayState="idle"
        buildReplayStatusMessage=""
        selectedRunId="run-1"
        nextCursor={null}
        onSelectRun={() => undefined}
        onLoadMore={() => undefined}
        onLoadArtifact={() => undefined}
        onResolveEvidence={() => undefined}
        onResolveMomentEvidence={async () => undefined}
        onRecordMomentInteraction={async () => {
          throw new Error("not invoked during static rendering");
        }}
        onDisconnect={() => undefined}
      />,
    );
    expect(html).toContain("Set not acknowledged");
    expect(html).toContain("2 recorded actions");
    expect(html).toContain("1 bounded record");
    expect(html).toContain("They do not prove comprehension or ownership");
    expect(html).toMatch(/checked="" value="revise"/);
    expect(html).toMatch(/checked="" value="mitigate"/);
    expect(html).toMatch(/checked="" value="yes"/);
    expect(html).toMatch(/checked="" value="useful"/);
  });

  it("requires exact interaction state identity for every projected Moment", () => {
    const exact = MomentInteractionStateResponseV1Schema.parse({
      ok: true,
      schemaVersion: 1,
      runId: "run-1",
      validationId: momentsProjection.validationId,
      states: momentsProjection.moments.map((moment) => ({
        momentId: moment.displayId,
        sourceIndex: moment.sourceIndex,
        sourceCandidateFingerprint: moment.sourceCandidateFingerprint,
        momentType: moment.candidate.type,
        viewCount: 0,
        evidenceViewCount: 0,
        acknowledgement: null,
        decisionResponse: null,
        riskResponse: null,
        checkChoiceId: null,
        usefulness: "unset",
        latestInteractionAt: null,
        interactionCount: 0,
        ownershipRecordCount: 0,
      })),
      totalInteractionCount: 0,
      totalOwnershipRecordCount: 0,
      recentInteractions: [],
      recentOwnershipRecords: [],
      interactionHistoryTruncated: false,
      ownershipRecordHistoryTruncated: false,
    });
    expect(interactionStateMatchesProjection(exact, momentsProjection)).toBe(true);
    expect(
      interactionStateMatchesProjection(
        { ...exact, states: exact.states.slice(1) },
        momentsProjection,
      ),
    ).toBe(false);
    expect(
      interactionStateMatchesProjection(
        {
          ...exact,
          states: exact.states.map((state, index) =>
            index === 0
              ? { ...state, sourceCandidateFingerprint: `sha256:${"0".repeat(64)}` }
              : state,
          ),
        },
        momentsProjection,
      ),
    ).toBe(false);
  });

  it("renders a password connection control and exposes no browser-persistence API", () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { search: "", origin: "http://127.0.0.1:4021", pathname: "/" },
        history: { replaceState: () => undefined },
      },
    });
    try {
      const html = renderToStaticMarkup(<App />);
      expect(html).toContain('type="password"');
      const implementationText = `${App.toString()}\n${createReplayApiClient.toString()}`;
      for (const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "serviceWorker",
        "caches.open",
      ]) {
        expect(implementationText).not.toContain(forbidden);
      }
      expect(createReplayApiClient.toString()).not.toContain("apiHost");
      expect(App.toString()).toContain('error.code === "unauthorized"');
      expect(App.toString()).toContain("clearConnection(error.message)");
      expect(App.toString()).toContain(
        "clientRef.current === client && loadRequestRef.current === requestNumber",
      );
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    }
  });

  it("keeps the newest append-only Build Replay snapshot", () => {
    const older = {
      runId: "run-1",
      source: { validationId: `val_${"b".repeat(48)}` },
      reviewSummary: { totalInteractions: 2 },
    } as any;
    const stale = {
      runId: "run-1",
      source: { validationId: `val_${"b".repeat(48)}` },
      reviewSummary: { totalInteractions: 1 },
    } as any;
    const newer = {
      runId: "run-1",
      source: { validationId: `val_${"b".repeat(48)}` },
      reviewSummary: { totalInteractions: 3 },
    } as any;
    expect(preferNewerBuildReplay(older, stale)).toBe(older);
    expect(preferNewerBuildReplay(older, newer)).toBe(newer);
  });
});
