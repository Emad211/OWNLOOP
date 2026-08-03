import type { CandidateValidationFactV1 } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { attentionRevealFeedback } from "./attention-reveal.js";

const evidenceId = `ev_${"a".repeat(48)}`;

function changeFact(): CandidateValidationFactV1 {
  return { kind: "change_kind", value: "modified", evidenceIds: [evidenceId] };
}

function verificationFact(
  observedStatus: "passed" | "failed" | "observed_without_exit_code" | "unknown",
): CandidateValidationFactV1 {
  return {
    kind: "verification_status",
    verificationKind: "test",
    observedStatus,
    evidenceIds: [evidenceId],
  };
}

describe("Attention reveal feedback", () => {
  it("uses unknown when no deterministic facts exist", () => {
    expect(attentionRevealFeedback([]).tone).toBe("unknown");
  });

  it("uses confirmed only when facts have no caution or unknown marker", () => {
    const feedback = attentionRevealFeedback([changeFact(), verificationFact("passed")]);

    expect(feedback.tone).toBe("confirmed");
    expect(feedback.message).not.toContain("انتخاب تو درست");
    expect(feedback.message).not.toContain("کاملاً امن");
  });

  it("prioritizes failed verification over passed evidence", () => {
    expect(
      attentionRevealFeedback([verificationFact("passed"), verificationFact("failed")]).tone,
    ).toBe("caution");
  });

  it("treats evidence gaps and partial sources as caution", () => {
    const gap: CandidateValidationFactV1 = {
      kind: "evidence_gap",
      gapCode: "verification.missing",
      evidenceIds: [evidenceId],
    };
    const partial: CandidateValidationFactV1 = {
      kind: "source_partial",
      value: true,
      evidenceIds: [],
    };

    expect(attentionRevealFeedback([gap]).tone).toBe("caution");
    expect(attentionRevealFeedback([partial]).tone).toBe("caution");
  });

  it("treats observations without exit code and observed-only attribution as unknown", () => {
    const observedOnly: CandidateValidationFactV1 = {
      kind: "attribution",
      value: "observed_only",
      evidenceIds: [evidenceId],
    };

    expect(attentionRevealFeedback([verificationFact("observed_without_exit_code")]).tone).toBe(
      "unknown",
    );
    expect(attentionRevealFeedback([observedOnly]).tone).toBe("unknown");
  });

  it("keeps caution above unknown when both are present", () => {
    expect(
      attentionRevealFeedback([
        verificationFact("unknown"),
        { kind: "terminal_status", value: "Failed", evidenceIds: [evidenceId] },
      ]).tone,
    ).toBe("caution");
  });
});
