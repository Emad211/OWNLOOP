import type { OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import {
  ATTENTION_SECONDS_PER_MOMENT,
  ATTENTION_SESSION_MAX_MOMENTS,
  buildAttentionSessionPlan,
} from "./attention-session.js";

function moment(rank: number, sourceIndex = rank - 1): OwnershipMomentProjectionItemV1 {
  return {
    displayId: `mom_${String(rank).padStart(48, "0")}`,
    selectedRank: rank,
    sourceIndex,
  } as OwnershipMomentProjectionItemV1;
}

describe("Attention session pacing", () => {
  it("returns an empty zero-duration plan without Moments", () => {
    expect(buildAttentionSessionPlan([])).toEqual({
      moments: [],
      totalCount: 0,
      estimatedSeconds: 0,
      truncated: false,
    });
  });

  it("preserves selected rank and estimates twelve seconds per Moment", () => {
    const plan = buildAttentionSessionPlan([moment(3), moment(1), moment(2)]);

    expect(plan.moments.map((item) => item.selectedRank)).toEqual([1, 2, 3]);
    expect(plan.totalCount).toBe(3);
    expect(plan.estimatedSeconds).toBe(3 * ATTENTION_SECONDS_PER_MOMENT);
    expect(plan.truncated).toBe(false);
  });

  it("excludes already reviewed Moments before planning", () => {
    const reviewed = moment(2);
    const moments = [moment(1), reviewed, moment(3)];
    const plan = buildAttentionSessionPlan(moments, new Set([reviewed.displayId]));

    expect(plan.moments.map((item) => item.selectedRank)).toEqual([1, 3]);
    expect(plan.totalCount).toBe(2);
    expect(plan.estimatedSeconds).toBe(24);
  });

  it("applies only the existing seven-Moment product boundary defensively", () => {
    const moments = Array.from({ length: 9 }, (_, index) => moment(index + 1));
    const plan = buildAttentionSessionPlan(moments);

    expect(plan.moments).toHaveLength(ATTENTION_SESSION_MAX_MOMENTS);
    expect(plan.moments.map((item) => item.selectedRank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(plan.estimatedSeconds).toBe(84);
    expect(plan.truncated).toBe(true);
  });

  it("uses source index only as a stable tie-breaker", () => {
    const plan = buildAttentionSessionPlan([moment(1, 4), moment(1, 2), moment(1, 3)]);

    expect(plan.moments.map((item) => item.sourceIndex)).toEqual([2, 3, 4]);
  });
});
