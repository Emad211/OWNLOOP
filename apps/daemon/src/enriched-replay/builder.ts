import { createHash } from "node:crypto";

import {
  ENRICHED_BUILD_REPLAY_LIMITATIONS,
  ENRICHED_BUILD_REPLAY_MAX_BYTES,
  ENRICHED_BUILD_REPLAY_MAX_FILES,
  ENRICHED_BUILD_REPLAY_MAX_GAPS,
  ENRICHED_BUILD_REPLAY_MAX_VERIFICATION,
  ENRICHED_BUILD_REPLAY_PROJECTOR_VERSION,
  ENRICHED_BUILD_REPLAY_SCHEMA_VERSION,
  type EnrichedBuildReplayChangedFileV1,
  type EnrichedBuildReplayLimitation,
  type EnrichedBuildReplayMomentReferenceV1,
  type EnrichedBuildReplayMomentV1,
  type EnrichedBuildReplayReviewActivity,
  type EnrichedBuildReplayV1,
  EnrichedBuildReplayV1Schema,
  MOMENT_INTERACTION_SCHEMA_VERSION,
  type MomentInteractionStateResponseV1,
  type MomentInteractionStateV1,
  OWNERSHIP_MOMENTS_PROJECTION_VERSION,
  OWNERSHIP_MOMENTS_SCHEMA_VERSION,
  type OwnershipMomentsProjectionV1,
  RAW_REPLAY_SCHEMA_VERSION,
  type RawRunReplayV1,
  type ReplayEvidenceGapV1,
  type ReplayReconciliationV1,
} from "@ownloop/contracts";
import { canonicalizeJson } from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";

const ZERO_FINGERPRINT = `sha256:${"0".repeat(64)}`;
const CANONICAL_LIMITS = Object.freeze({
  maxUtf8Bytes: ENRICHED_BUILD_REPLAY_MAX_BYTES,
  maxDepth: 64,
  maxObjectProperties: 512,
  maxArrayItems: 10_000,
});
const TERMINAL_STATUSES = new Set(["Completed", "Partial", "Failed", "Abandoned"]);

export type EnrichedBuildReplayBuilderInput = Readonly<{
  rawReplay: RawRunReplayV1;
  momentProjection: OwnershipMomentsProjectionV1 | null;
  interactionState: MomentInteractionStateResponseV1 | null;
  graphEvidenceIds: ReadonlySet<string>;
}>;

function fail(message: string): never {
  throw new PersistenceError("invalid_persisted_row", message);
}

function fingerprint(value: Omit<EnrichedBuildReplayV1, "projectionFingerprint">): string {
  const canonical = canonicalizeJson(
    { ...value, projectionFingerprint: ZERO_FINGERPRINT },
    CANONICAL_LIMITS,
  );
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function finalize(
  value: Omit<EnrichedBuildReplayV1, "projectionFingerprint">,
): EnrichedBuildReplayV1 {
  const replay = EnrichedBuildReplayV1Schema.parse({
    ...value,
    projectionFingerprint: fingerprint(value),
  });
  canonicalizeJson(replay, CANONICAL_LIMITS);
  return replay;
}

function sectionCounts(total: number, returned: number) {
  return { total, returned, truncated: total > returned } as const;
}

function referencesFor(
  evidenceId: string,
  moments: readonly EnrichedBuildReplayMomentV1[],
): EnrichedBuildReplayMomentReferenceV1[] {
  return moments
    .filter((moment) => moment.support.evidenceIds.includes(evidenceId))
    .map((moment) => ({ displayId: moment.displayId, selectedRank: moment.selectedRank }));
}

function reviewActivity(state: MomentInteractionStateV1): EnrichedBuildReplayReviewActivity {
  if (state.ownershipRecordCount > 0) return "responded";
  if (state.evidenceViewCount > 0) return "evidence_opened";
  if (state.viewCount > 0) return "viewed";
  return "none";
}

function assertEvidence(
  evidenceIds: readonly (string | null | undefined)[],
  graphEvidenceIds: ReadonlySet<string>,
): void {
  if (
    evidenceIds.some(
      (evidenceId) =>
        evidenceId !== null && evidenceId !== undefined && !graphEvidenceIds.has(evidenceId),
    )
  ) {
    fail("Enriched Build Replay Evidence is outside the exact Run Graph.");
  }
}

function momentItems(
  projection: OwnershipMomentsProjectionV1,
  state: MomentInteractionStateResponseV1,
  graphEvidenceIds: ReadonlySet<string>,
): EnrichedBuildReplayMomentV1[] {
  if (
    state.runId !== projection.runId ||
    projection.validationId === null ||
    state.validationId !== projection.validationId ||
    projection.selectedCount !== projection.moments.length ||
    state.states.length !== projection.moments.length
  ) {
    fail("Enriched Build Replay Moment and interaction sources disagree.");
  }
  const states = new Map(state.states.map((item) => [item.momentId, item]));
  const moments = [...projection.moments]
    .toSorted((left, right) => left.selectedRank - right.selectedRank)
    .map((item, index): EnrichedBuildReplayMomentV1 => {
      if (item.selectedRank !== index + 1) {
        fail("Enriched Build Replay Moment ranks are not contiguous.");
      }
      const interaction = states.get(item.displayId);
      if (
        interaction === undefined ||
        interaction.sourceIndex !== item.sourceIndex ||
        interaction.sourceCandidateFingerprint !== item.sourceCandidateFingerprint ||
        interaction.momentType !== item.candidate.type
      ) {
        fail("Enriched Build Replay Moment interaction identity differs.");
      }
      assertEvidence(item.evidenceIds, graphEvidenceIds);
      return {
        displayId: item.displayId,
        selectedRank: item.selectedRank,
        sourceIndex: item.sourceIndex,
        sourceCandidateFingerprint: item.sourceCandidateFingerprint,
        proposal: item.candidate,
        support: {
          citedEvidenceIds: [...item.candidate.evidenceIds].toSorted(),
          expandedEvidenceIds: [...item.expandedEvidenceIds],
          facts: item.facts.map((fact) => ({ ...fact, evidenceIds: [...fact.evidenceIds] })),
          score: { ...item.score },
          evidenceIds: [...item.evidenceIds],
        },
        review: { activity: reviewActivity(interaction), state: { ...interaction } },
      };
    });
  if (new Set(moments.map((item) => item.displayId)).size !== moments.length) {
    fail("Enriched Build Replay Moment identities are duplicated.");
  }
  if (
    moments.reduce((sum, item) => sum + item.review.state.interactionCount, 0) !==
      state.totalInteractionCount ||
    moments.reduce((sum, item) => sum + item.review.state.ownershipRecordCount, 0) !==
      state.totalOwnershipRecordCount
  ) {
    fail("Enriched Build Replay interaction aggregates disagree.");
  }
  return moments;
}

function selectedReconciliation(rawReplay: RawRunReplayV1): ReplayReconciliationV1 | null {
  const finalizationId = rawReplay.finalization?.reconciliationId ?? null;
  if (finalizationId !== null) {
    const selected = rawReplay.reconciliations.find(
      (reconciliation) => reconciliation.reconciliationId === finalizationId,
    );
    if (selected === undefined) {
      fail("The final Build Replay reconciliation is unavailable.");
    }
    return selected;
  }
  return (
    [...rawReplay.reconciliations]
      .toSorted(
        (left, right) =>
          left.capturedAt.localeCompare(right.capturedAt) ||
          left.reconciliationId.localeCompare(right.reconciliationId),
      )
      .at(-1) ?? null
  );
}

function changedFiles(
  rawReplay: RawRunReplayV1,
  moments: readonly EnrichedBuildReplayMomentV1[],
  graphEvidenceIds: ReadonlySet<string>,
) {
  const reconciliation = selectedReconciliation(rawReplay);
  if (reconciliation === null) {
    return { counts: sectionCounts(0, 0), items: [] as EnrichedBuildReplayChangedFileV1[] };
  }
  const linked: EnrichedBuildReplayChangedFileV1[] = [];
  for (const file of reconciliation.changedFiles) {
    if (file.evidenceId === null || file.evidenceId === undefined) continue;
    assertEvidence([file.evidenceId], graphEvidenceIds);
    const references = referencesFor(file.evidenceId, moments);
    if (references.length === 0) continue;
    linked.push({
      reconciliationId: reconciliation.reconciliationId,
      reconciliationCapturedAt: reconciliation.capturedAt,
      file: { ...file },
      linkedMoments: references,
    });
  }
  linked.sort(
    (left, right) =>
      (left.linkedMoments[0]?.selectedRank ?? 0) - (right.linkedMoments[0]?.selectedRank ?? 0) ||
      left.reconciliationCapturedAt.localeCompare(right.reconciliationCapturedAt) ||
      left.file.entryIndex - right.file.entryIndex ||
      left.file.entryId.localeCompare(right.file.entryId),
  );
  const items = linked.slice(0, ENRICHED_BUILD_REPLAY_MAX_FILES);
  return { counts: sectionCounts(linked.length, items.length), items } as const;
}

function verification(rawReplay: RawRunReplayV1, graphEvidenceIds: ReadonlySet<string>) {
  const ordered = [...rawReplay.verification].toSorted(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  for (const item of ordered) assertEvidence([item.evidenceId], graphEvidenceIds);
  const items = ordered.slice(-ENRICHED_BUILD_REPLAY_MAX_VERIFICATION).map((item) => ({
    ...item,
    payload: { ...item.payload },
  }));
  return { counts: sectionCounts(ordered.length, items.length), items } as const;
}

function gaps(
  rawReplay: RawRunReplayV1,
  moments: readonly EnrichedBuildReplayMomentV1[],
  graphEvidenceIds: ReadonlySet<string>,
) {
  const ordered = [...rawReplay.evidenceGaps].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.gapId.localeCompare(right.gapId),
  );
  for (const gap of ordered) assertEvidence([gap.evidenceId], graphEvidenceIds);
  const items = ordered.slice(-ENRICHED_BUILD_REPLAY_MAX_GAPS).map((gap: ReplayEvidenceGapV1) => ({
    gap: { ...gap },
    linkedMoments:
      gap.evidenceId === null || gap.evidenceId === undefined
        ? []
        : referencesFor(gap.evidenceId, moments),
  }));
  return { counts: sectionCounts(ordered.length, items.length), items } as const;
}

function limitations(
  rawReplay: RawRunReplayV1,
  projection: OwnershipMomentsProjectionV1,
  filesTruncated: boolean,
  verificationTruncated: boolean,
  gapsTruncated: boolean,
): EnrichedBuildReplayLimitation[] {
  const values = new Set<EnrichedBuildReplayLimitation>();
  if (rawReplay.run.status === "Partial") values.add("run_partial");
  if (rawReplay.run.status === "Failed") values.add("run_failed");
  if (rawReplay.run.status === "Abandoned") values.add("run_abandoned");
  if (rawReplay.run.completeness !== "complete") values.add("raw_replay_partial");
  if (rawReplay.finalization?.diagnosticCode !== null) values.add("finalization_limited");
  if (rawReplay.evidenceGraph === null || rawReplay.evidenceGraph?.outcome !== "complete") {
    values.add("evidence_graph_partial");
  }
  if (rawReplay.evidenceGaps.length > 0) values.add("evidence_gaps_present");
  if (projection.outcome === "partial") values.add("moments_partial");
  if (projection.outcome === "not_available") values.add("moments_unavailable");
  if (filesTruncated) values.add("files_truncated");
  if (verificationTruncated) values.add("verification_truncated");
  if (gapsTruncated) values.add("gaps_truncated");
  return ENRICHED_BUILD_REPLAY_LIMITATIONS.filter((item) => values.has(item));
}

function reviewSummary(moments: readonly EnrichedBuildReplayMomentV1[]) {
  return {
    selected: moments.length,
    none: moments.filter((item) => item.review.activity === "none").length,
    viewed: moments.filter((item) => item.review.activity === "viewed").length,
    evidenceOpened: moments.filter((item) => item.review.activity === "evidence_opened").length,
    responded: moments.filter((item) => item.review.activity === "responded").length,
    totalMomentViews: moments.reduce((sum, item) => sum + item.review.state.viewCount, 0),
    totalEvidenceViews: moments.reduce((sum, item) => sum + item.review.state.evidenceViewCount, 0),
    totalInteractions: moments.reduce((sum, item) => sum + item.review.state.interactionCount, 0),
    totalOwnershipRecords: moments.reduce(
      (sum, item) => sum + item.review.state.ownershipRecordCount,
      0,
    ),
  } as const;
}

function unavailable(runId: string): EnrichedBuildReplayV1 {
  return finalize({
    ok: true,
    schemaVersion: ENRICHED_BUILD_REPLAY_SCHEMA_VERSION,
    projectorVersion: ENRICHED_BUILD_REPLAY_PROJECTOR_VERSION,
    runId,
    outcome: "not_available",
    diagnosticCode: "run_not_terminal",
    limitations: [],
    source: null,
    goal: null,
    completion: null,
    files: { counts: sectionCounts(0, 0), items: [] },
    moments: [],
    verification: { counts: sectionCounts(0, 0), items: [] },
    gaps: { counts: sectionCounts(0, 0), items: [] },
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
  });
}

export function prepareEnrichedBuildReplay(
  input: EnrichedBuildReplayBuilderInput,
): EnrichedBuildReplayV1 {
  const { rawReplay, momentProjection, interactionState, graphEvidenceIds } = input;
  if (!TERMINAL_STATUSES.has(rawReplay.run.status)) return unavailable(rawReplay.run.runId);
  if (momentProjection === null || rawReplay.run.runId !== momentProjection.runId) {
    fail("Enriched Build Replay Run identities differ.");
  }
  if (
    rawReplay.run.endedAt === null ||
    rawReplay.finalization === null ||
    rawReplay.finalization.terminalStatus !== rawReplay.run.status
  ) {
    fail("The terminal Build Replay finalization is inconsistent.");
  }
  if (rawReplay.evidenceGraph === undefined) {
    fail("The enriched Build Replay requires a verified Evidence Graph summary.");
  }

  let moments: EnrichedBuildReplayMomentV1[] = [];
  if (momentProjection.outcome === "not_available") {
    if (interactionState !== null) {
      fail("Unavailable Moments cannot have interaction state.");
    }
  } else {
    if (
      momentProjection.finalizationId !== rawReplay.finalization.finalizationId ||
      momentProjection.evidenceGraphArtifactId !== rawReplay.evidenceGraph?.artifactId ||
      interactionState === null
    ) {
      fail("Enriched Build Replay source identities differ.");
    }
    moments = momentItems(momentProjection, interactionState, graphEvidenceIds);
  }

  const fileSection = changedFiles(rawReplay, moments, graphEvidenceIds);
  const verificationSection = verification(rawReplay, graphEvidenceIds);
  const gapSection = gaps(rawReplay, moments, graphEvidenceIds);
  const replayLimitations = limitations(
    rawReplay,
    momentProjection,
    fileSection.counts.truncated,
    verificationSection.counts.truncated,
    gapSection.counts.truncated,
  );

  const source = {
    rawReplaySchemaVersion: RAW_REPLAY_SCHEMA_VERSION,
    ownershipMomentsSchemaVersion: OWNERSHIP_MOMENTS_SCHEMA_VERSION,
    ownershipMomentsProjectionVersion: OWNERSHIP_MOMENTS_PROJECTION_VERSION,
    momentInteractionSchemaVersion: MOMENT_INTERACTION_SCHEMA_VERSION,
    finalizationId: rawReplay.finalization.finalizationId,
    generationId: momentProjection.generationId,
    validationId: momentProjection.validationId,
    validationKey: momentProjection.validationKey,
    sourceCandidateArtifactId: momentProjection.sourceCandidateArtifactId,
    sourceCandidateFingerprint: momentProjection.sourceCandidateFingerprint,
    reportArtifactId: momentProjection.reportArtifactId,
    reportFingerprint: momentProjection.reportFingerprint,
    evidenceGraphArtifactId:
      momentProjection.evidenceGraphArtifactId ?? rawReplay.evidenceGraph?.artifactId ?? null,
    evidenceGraphInputFingerprint: momentProjection.evidenceGraphInputFingerprint,
    sourceVersions: momentProjection.sourceVersions,
    policyVersions: momentProjection.policyVersions,
  } as const;

  return finalize({
    ok: true,
    schemaVersion: ENRICHED_BUILD_REPLAY_SCHEMA_VERSION,
    projectorVersion: ENRICHED_BUILD_REPLAY_PROJECTOR_VERSION,
    runId: rawReplay.run.runId,
    outcome: replayLimitations.length === 0 ? "ready" : "partial",
    diagnosticCode: replayLimitations.length === 0 ? "completed" : "source_partial",
    limitations: replayLimitations,
    source,
    goal: rawReplay.run.redactedPrompt,
    completion: {
      conversationId: rawReplay.run.conversationId,
      workspaceId: rawReplay.run.workspaceId,
      status: rawReplay.run.status,
      completeness: rawReplay.run.completeness,
      startedAt: rawReplay.run.startedAt,
      endedAt: rawReplay.run.endedAt,
      finalizationDiagnostic: rawReplay.finalization.diagnosticCode,
      finalizedAt: rawReplay.finalization.finalizedAt,
    },
    files: fileSection,
    moments,
    verification: verificationSection,
    gaps: gapSection,
    reviewSummary: reviewSummary(moments),
  });
}
