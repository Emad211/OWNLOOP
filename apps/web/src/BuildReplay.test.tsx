import type { EnrichedBuildReplayV1 } from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BuildReplaySection } from "./BuildReplay.js";

const evidenceId = `ev_${"a".repeat(48)}`;
const momentId = `mom_${"1".repeat(48)}`;
const timestamp = "2026-07-25T19:00:00.000Z";

function replay(activity: "none" | "viewed" | "evidence_opened" | "responded" = "responded") {
  const counts =
    activity === "responded"
      ? { views: 1, evidence: 1, interactions: 3, records: 1 }
      : activity === "evidence_opened"
        ? { views: 1, evidence: 1, interactions: 2, records: 0 }
        : activity === "viewed"
          ? { views: 1, evidence: 0, interactions: 1, records: 0 }
          : { views: 0, evidence: 0, interactions: 0, records: 0 };
  return {
    ok: true,
    schemaVersion: 1,
    projectorVersion: "0.1.0",
    projectionFingerprint: `sha256:${"f".repeat(64)}`,
    runId: "run-1",
    outcome: "partial",
    diagnosticCode: "source_partial",
    limitations: ["evidence_gaps_present"],
    source: {},
    goal: "Implement the deterministic enriched replay.",
    completion: {
      conversationId: "conversation-1",
      workspaceId: "workspace-1",
      status: "Partial",
      completeness: "partial",
      startedAt: timestamp,
      endedAt: timestamp,
      finalizationDiagnostic: "existing_evidence_gaps",
      finalizedAt: timestamp,
    },
    files: {
      counts: { total: 1, returned: 1, truncated: false },
      items: [
        {
          reconciliationId: "reconciliation-1",
          reconciliationCapturedAt: timestamp,
          file: {
            entryId: "entry-1",
            entryIndex: 0,
            relativePath: "src/replay.ts",
            changeKind: "modified",
            staged: false,
            unstaged: true,
            sensitivity: "normal",
            attribution: "run_relative",
            fileEventId: "event-file",
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
        sourceCandidateFingerprint: `sha256:${"1".repeat(64)}`,
        proposal: {
          type: "change",
          title: "Replay behavior changed",
          claim: "Replay behavior changed",
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
            evidenceStrength: 1000,
            urgency: 0,
            completenessAdjustment: -50,
            providerImportanceSignal: 50,
            providerConfidenceSignal: 25,
            attentionPenalty: 5,
            total: 1020,
          },
          evidenceIds: [evidenceId],
        },
        review: {
          activity,
          state: {
            momentId,
            sourceIndex: 0,
            sourceCandidateFingerprint: `sha256:${"1".repeat(64)}`,
            momentType: "change",
            viewCount: counts.views,
            evidenceViewCount: counts.evidence,
            acknowledgement: activity === "responded" ? true : null,
            decisionResponse: null,
            riskResponse: null,
            checkChoiceId: null,
            usefulness: "unset",
            latestInteractionAt: activity === "none" ? null : timestamp,
            interactionCount: counts.interactions,
            ownershipRecordCount: counts.records,
          },
        },
      },
    ],
    verification: { counts: { total: 0, returned: 0, truncated: false }, items: [] },
    gaps: {
      counts: { total: 1, returned: 1, truncated: false },
      items: [
        {
          gap: {
            gapId: "gap-1",
            code: "existing_evidence_gaps",
            message: "Some evidence remains incomplete.",
            createdAt: timestamp,
            evidenceId,
          },
          linkedMoments: [{ displayId: momentId, selectedRank: 1 }],
        },
      ],
    },
    reviewSummary: {
      selected: 1,
      none: activity === "none" ? 1 : 0,
      viewed: activity === "viewed" ? 1 : 0,
      evidenceOpened: activity === "evidence_opened" ? 1 : 0,
      responded: activity === "responded" ? 1 : 0,
      totalMomentViews: counts.views,
      totalEvidenceViews: counts.evidence,
      totalInteractions: counts.interactions,
      totalOwnershipRecords: counts.records,
    },
  } as unknown as EnrichedBuildReplayV1;
}

describe("BuildReplaySection", () => {
  it("renders loading, error, and terminal-unavailable states honestly", () => {
    expect(
      renderToStaticMarkup(
        <BuildReplaySection
          state="loading"
          statusMessage=""
          projection={null}
          onResolveEvidence={() => {}}
        />,
      ),
    ).toContain("Loading deterministic Build Replay");
    expect(
      renderToStaticMarkup(
        <BuildReplaySection
          state="error"
          statusMessage="Replay failed"
          projection={null}
          onResolveEvidence={() => {}}
        />,
      ),
    ).toContain("Replay failed");
    const unavailable = {
      ...replay(),
      outcome: "not_available",
      completion: null,
      goal: null,
    } as EnrichedBuildReplayV1;
    expect(
      renderToStaticMarkup(
        <BuildReplaySection
          state="ready"
          statusMessage=""
          projection={unavailable}
          onResolveEvidence={() => {}}
        />,
      ),
    ).toContain("not available");
  });

  it("puts goal and limitations before proposal content and separates truth surfaces", () => {
    const html = renderToStaticMarkup(
      <BuildReplaySection
        state="ready"
        statusMessage=""
        projection={replay()}
        onResolveEvidence={() => {}}
      />,
    );
    expect(html.indexOf("Original redacted goal")).toBeLessThan(html.indexOf("Limitations first"));
    expect(html.indexOf("Limitations first")).toBeLessThan(html.indexOf("Provider proposal"));
    expect(html).toContain("Deterministic support");
    expect(html).toContain("change Moments");
    expect(html).toContain("Recorded review activity");
    expect(html).toContain("does not prove comprehension");
    expect(html).toContain("src/replay.ts");
    expect(html).toContain("View evidence");
  });

  it.each([
    ["none", "No recorded review activity"],
    ["viewed", "Viewed"],
    ["evidence_opened", "Evidence opened"],
    ["responded", "Responded"],
  ] as const)("renders %s activity as %s", (activity, label) => {
    const html = renderToStaticMarkup(
      <BuildReplaySection
        state="ready"
        statusMessage=""
        projection={replay(activity)}
        onResolveEvidence={vi.fn()}
      />,
    );
    expect(html).toContain(label);
  });
});
