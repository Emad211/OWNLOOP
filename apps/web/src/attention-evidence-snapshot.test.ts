import type { CandidateValidationFactV1, OwnershipMomentProjectionItemV1 } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { buildAttentionEvidenceSnapshot } from "./attention-evidence-snapshot.js";

const evidenceId = `ev_${"a".repeat(48)}`;

function moment(
  id: string,
  facts: readonly CandidateValidationFactV1[],
): OwnershipMomentProjectionItemV1 {
  return { displayId: id, facts } as OwnershipMomentProjectionItemV1;
}

const directFact: CandidateValidationFactV1 = {
  kind: "change_kind",
  value: "modified",
  evidenceIds: [evidenceId],
};

const unknownFact: CandidateValidationFactV1 = {
  kind: "verification_status",
  verificationKind: "test",
  observedStatus: "unknown",
  evidenceIds: [evidenceId],
};

const cautionFact: CandidateValidationFactV1 = {
  kind: "evidence_gap",
  gapCode: "verification.missing",
  evidenceIds: [evidenceId],
};

describe("Attention session evidence snapshot", () => {
  it("returns zero counts for an empty session", () => {
    expect(buildAttentionEvidenceSnapshot([], new Set())).toEqual({
      confirmed: 0,
      caution: 0,
      unknown: 0,
      total: 0,
    });
  });

  it("counts mixed deterministic tones without creating a score", () => {
    const moments = [
      moment("moment-direct", [directFact]),
      moment("moment-caution", [cautionFact]),
      moment("moment-unknown", [unknownFact]),
    ];

    expect(
      buildAttentionEvidenceSnapshot(
        moments,
        new Set(["moment-direct", "moment-caution", "moment-unknown"]),
      ),
    ).toEqual({ confirmed: 1, caution: 1, unknown: 1, total: 3 });
  });

  it("inherits caution priority when a completed Moment also contains unknown evidence", () => {
    const snapshot = buildAttentionEvidenceSnapshot(
      [moment("moment-mixed", [unknownFact, cautionFact])],
      new Set(["moment-mixed"]),
    );

    expect(snapshot).toEqual({ confirmed: 0, caution: 1, unknown: 0, total: 1 });
  });

  it("does not count Moments that were not completed in this session", () => {
    const snapshot = buildAttentionEvidenceSnapshot(
      [moment("moment-completed", [directFact]), moment("moment-unreviewed", [cautionFact])],
      new Set(["moment-completed"]),
    );

    expect(snapshot).toEqual({ confirmed: 1, caution: 0, unknown: 0, total: 1 });
  });
});
