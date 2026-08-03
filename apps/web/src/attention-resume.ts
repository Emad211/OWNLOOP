import type {
  MomentInteractionStateResponseV1,
  MomentInteractionStateV1,
  OwnershipMomentProjectionItemV1,
  OwnershipMomentsProjectionV1,
} from "@ownloop/contracts";

export type AttentionResumeOutcome = "fresh" | "resumed" | "complete" | "stale";

export type AttentionResumePlan = Readonly<{
  outcome: AttentionResumeOutcome;
  firstUnreviewedIndex: number | null;
  reviewedMomentIds: readonly string[];
  completedCount: number;
  followUpCount: number;
}>;

function hasRecordedResponse(state: MomentInteractionStateV1): boolean {
  switch (state.momentType) {
    case "change":
      return state.acknowledgement !== null;
    case "decision":
      return state.decisionResponse !== null;
    case "risk":
      return state.riskResponse !== null;
    case "check":
      return state.checkChoiceId !== null;
  }
}

function needsFollowUp(state: MomentInteractionStateV1): boolean {
  switch (state.momentType) {
    case "change":
      return state.acknowledgement === false;
    case "decision":
      return state.decisionResponse === "revise" || state.decisionResponse === "uncertain";
    case "risk":
      return state.riskResponse === "mitigate";
    case "check":
      return false;
  }
}

function stateMatchesMoment(
  state: MomentInteractionStateV1,
  moment: OwnershipMomentProjectionItemV1,
): boolean {
  return (
    state.momentId === moment.displayId &&
    state.sourceIndex === moment.sourceIndex &&
    state.sourceCandidateFingerprint === moment.sourceCandidateFingerprint &&
    state.momentType === moment.candidate.type
  );
}

export function nextUnreviewedMomentIndex(
  moments: readonly OwnershipMomentProjectionItemV1[],
  reviewedMomentIds: ReadonlySet<string>,
  afterIndex = -1,
): number | null {
  for (let index = Math.max(0, afterIndex + 1); index < moments.length; index += 1) {
    const moment = moments[index];
    if (moment !== undefined && !reviewedMomentIds.has(moment.displayId)) return index;
  }
  return null;
}

export function buildAttentionResumePlan(
  projection: OwnershipMomentsProjectionV1,
  response: MomentInteractionStateResponseV1,
): AttentionResumePlan {
  if (
    projection.validationId === null ||
    response.runId !== projection.runId ||
    response.validationId !== projection.validationId
  ) {
    return {
      outcome: "stale",
      firstUnreviewedIndex: null,
      reviewedMomentIds: [],
      completedCount: 0,
      followUpCount: 0,
    };
  }

  const momentsById = new Map(projection.moments.map((moment) => [moment.displayId, moment]));
  for (const state of response.states) {
    const moment = momentsById.get(state.momentId);
    if (moment === undefined || !stateMatchesMoment(state, moment)) {
      return {
        outcome: "stale",
        firstUnreviewedIndex: null,
        reviewedMomentIds: [],
        completedCount: 0,
        followUpCount: 0,
      };
    }
  }

  const statesById = new Map(response.states.map((state) => [state.momentId, state]));
  const reviewedMomentIds = projection.moments
    .filter((moment) => {
      const state = statesById.get(moment.displayId);
      return state !== undefined && hasRecordedResponse(state);
    })
    .map((moment) => moment.displayId);
  const reviewedSet = new Set(reviewedMomentIds);
  const firstUnreviewedIndex = nextUnreviewedMomentIndex(projection.moments, reviewedSet);
  const followUpCount = reviewedMomentIds.reduce((total, momentId) => {
    const state = statesById.get(momentId);
    return total + (state !== undefined && needsFollowUp(state) ? 1 : 0);
  }, 0);

  return {
    outcome:
      reviewedMomentIds.length === 0
        ? "fresh"
        : firstUnreviewedIndex === null
          ? "complete"
          : "resumed",
    firstUnreviewedIndex,
    reviewedMomentIds,
    completedCount: reviewedMomentIds.length,
    followUpCount,
  };
}
