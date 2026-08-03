import type {
  MomentInteractionStateResponseV1,
  MomentInteractionStateV1,
  OwnershipMomentProjectionItemV1,
  OwnershipMomentsProjectionV1,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { buildAttentionResumePlan, nextUnreviewedMomentIndex } from "./attention-resume.js";

const VALIDATION_ID = `val_${"a".repeat(48)}`;
const FINGERPRINT = `sha256:${"b".repeat(64)}`;

function moment(
  displayId: string,
  type: "change" | "decision" | "risk" | "check",
  sourceIndex: number,
): OwnershipMomentProjectionItemV1 {
  return {
    displayId,
    selectedRank: sourceIndex + 1,
    sourceIndex,
    sourceCandidateFingerprint: FINGERPRINT,
    candidate: { type },
  } as OwnershipMomentProjectionItemV1;
}

function interactionState(
  item: OwnershipMomentProjectionItemV1,
  response: Partial<
    Pick<
      MomentInteractionStateV1,
      "acknowledgement" | "decisionResponse" | "riskResponse" | "checkChoiceId"
    >
  > = {},
): MomentInteractionStateV1 {
  return {
    momentId: item.displayId,
    sourceIndex: item.sourceIndex,
    sourceCandidateFingerprint: item.sourceCandidateFingerprint,
    momentType: item.candidate.type,
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
    ...response,
  } as MomentInteractionStateV1;
}

function projection(
  moments: readonly OwnershipMomentProjectionItemV1[],
): OwnershipMomentsProjectionV1 {
  return {
    runId: "run-1",
    validationId: VALIDATION_ID,
    moments,
  } as OwnershipMomentsProjectionV1;
}

function stateResponse(
  states: readonly MomentInteractionStateV1[],
  overrides: Partial<Pick<MomentInteractionStateResponseV1, "runId" | "validationId">> = {},
): MomentInteractionStateResponseV1 {
  return {
    runId: "run-1",
    validationId: VALIDATION_ID,
    states,
    ...overrides,
  } as MomentInteractionStateResponseV1;
}

describe("Attention resume planning", () => {
  const moments = [
    moment(`mom_${"1".repeat(48)}`, "change", 0),
    moment(`mom_${"2".repeat(48)}`, "decision", 1),
    moment(`mom_${"3".repeat(48)}`, "risk", 2),
  ] as const;

  it("treats views without a type-specific response as fresh", () => {
    const viewed = {
      ...interactionState(moments[0]),
      viewCount: 1,
      interactionCount: 1,
      latestInteractionAt: "2026-08-03T00:00:00.000Z",
    } as MomentInteractionStateV1;

    expect(buildAttentionResumePlan(projection(moments), stateResponse([viewed]))).toEqual({
      outcome: "fresh",
      firstUnreviewedIndex: 0,
      reviewedMomentIds: [],
      completedCount: 0,
      followUpCount: 0,
    });
  });

  it("resumes at the first unreviewed Moment and skips non-contiguous reviewed Moments", () => {
    const acknowledged = interactionState(moments[0], { acknowledgement: true });
    const mitigated = interactionState(moments[2], { riskResponse: "mitigate" });

    expect(
      buildAttentionResumePlan(projection(moments), stateResponse([acknowledged, mitigated])),
    ).toEqual({
      outcome: "resumed",
      firstUnreviewedIndex: 1,
      reviewedMomentIds: [moments[0].displayId, moments[2].displayId],
      completedCount: 2,
      followUpCount: 1,
    });
    expect(
      nextUnreviewedMomentIndex(moments, new Set([moments[0].displayId, moments[2].displayId])),
    ).toBe(1);
  });

  it("returns complete when every Moment already has a recorded response", () => {
    const states = [
      interactionState(moments[0], { acknowledgement: false }),
      interactionState(moments[1], { decisionResponse: "confirm" }),
      interactionState(moments[2], { riskResponse: "dismiss" }),
    ];

    expect(buildAttentionResumePlan(projection(moments), stateResponse(states))).toEqual({
      outcome: "complete",
      firstUnreviewedIndex: null,
      reviewedMomentIds: moments.map((item) => item.displayId),
      completedCount: 3,
      followUpCount: 1,
    });
  });

  it("fails closed on validation or Moment identity mismatch", () => {
    const acknowledged = interactionState(moments[0], { acknowledgement: true });
    const staleValidation = stateResponse([acknowledged], {
      validationId: `val_${"c".repeat(48)}`,
    });
    expect(buildAttentionResumePlan(projection(moments), staleValidation).outcome).toBe("stale");

    const staleFingerprint = {
      ...acknowledged,
      sourceCandidateFingerprint: `sha256:${"d".repeat(64)}`,
    } as MomentInteractionStateV1;
    expect(
      buildAttentionResumePlan(projection(moments), stateResponse([staleFingerprint])).outcome,
    ).toBe("stale");
  });

  it("finds the next unreviewed Moment only after the current index", () => {
    expect(nextUnreviewedMomentIndex(moments, new Set([moments[1].displayId]), 0)).toBe(2);
    expect(
      nextUnreviewedMomentIndex(moments, new Set(moments.map((item) => item.displayId))),
    ).toBeNull();
  });
});
