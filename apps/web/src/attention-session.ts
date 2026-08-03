import type { OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";

export const ATTENTION_SESSION_MAX_MOMENTS = 7;
export const ATTENTION_SECONDS_PER_MOMENT = 12;

export type AttentionSessionPlan = Readonly<{
  moments: readonly OwnershipMomentProjectionItemV1[];
  totalCount: number;
  estimatedSeconds: number;
  truncated: boolean;
}>;

export function buildAttentionSessionPlan(
  moments: readonly OwnershipMomentProjectionItemV1[],
  reviewedMomentIds: ReadonlySet<string> = new Set(),
): AttentionSessionPlan {
  const remaining = moments
    .filter((moment) => !reviewedMomentIds.has(moment.displayId))
    .toSorted(
      (left, right) =>
        left.selectedRank - right.selectedRank || left.sourceIndex - right.sourceIndex,
    );
  const planned = remaining.slice(0, ATTENTION_SESSION_MAX_MOMENTS);

  return {
    moments: planned,
    totalCount: planned.length,
    estimatedSeconds: planned.length * ATTENTION_SECONDS_PER_MOMENT,
    truncated: remaining.length > planned.length,
  };
}
