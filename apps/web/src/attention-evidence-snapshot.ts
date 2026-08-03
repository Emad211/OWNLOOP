import type { OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";

import { attentionRevealFeedback, type AttentionRevealTone } from "./attention-reveal.js";

export type AttentionEvidenceSnapshot = Readonly<{
  confirmed: number;
  caution: number;
  unknown: number;
  total: number;
}>;

export function buildAttentionEvidenceSnapshot(
  moments: readonly OwnershipMomentProjectionItemV1[],
  completedMomentIds: ReadonlySet<string>,
): AttentionEvidenceSnapshot {
  const counts: Record<AttentionRevealTone, number> = {
    confirmed: 0,
    caution: 0,
    unknown: 0,
  };

  for (const moment of moments) {
    if (!completedMomentIds.has(moment.displayId)) continue;
    counts[attentionRevealFeedback(moment.facts).tone] += 1;
  }

  return {
    ...counts,
    total: counts.confirmed + counts.caution + counts.unknown,
  };
}
