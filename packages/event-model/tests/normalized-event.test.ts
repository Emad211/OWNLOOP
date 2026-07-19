import {
  invalidNormalizedEventFixtures,
  validNormalizedEventFixtures,
} from "@ownloop/test-fixtures";
import { describe, expect, it } from "vitest";

import {
  NORMALIZED_EVENT_TYPES,
  NormalizedEventEnvelopeSchema,
  NormalizedEventTypeSchema,
} from "../src/index.js";

const adrEventTypes = [
  "conversation.started",
  "conversation.resumed",
  "conversation.ended",
  "run.started",
  "run.stop_observed",
  "run.stop_failed",
  "run.finalization_started",
  "run.completed",
  "run.partial",
  "run.abandoned",
  "run.failed",
  "user.prompt_submitted",
  "agent.plan_observed",
  "agent.summary_observed",
  "tool.requested",
  "tool.succeeded",
  "tool.failed",
  "tool.batch_completed",
  "file.read_observed",
  "file.write_requested",
  "file.created",
  "file.modified",
  "file.deleted",
  "file.change_observed",
  "command.started",
  "command.completed",
  "command.failed",
  "test.observed",
  "build.observed",
  "lint.observed",
  "typecheck.observed",
  "snapshot.baseline_captured",
  "snapshot.final_captured",
  "git.diff_computed",
  "git.commit_observed",
  "evidence.gap_detected",
  "event.duplicate_ignored",
  "event.source_unrecognized",
  "redaction.applied",
] as const;

describe("normalized event taxonomy", () => {
  it("matches the complete ADR-0003 taxonomy", () => {
    expect(NORMALIZED_EVENT_TYPES).toEqual(adrEventTypes);
    for (const eventType of adrEventTypes) {
      expect(NormalizedEventTypeSchema.safeParse(eventType).success).toBe(true);
    }
  });
});

describe("normalized event envelope", () => {
  it.each(validNormalizedEventFixtures)("parses $name", ({ input }) => {
    expect(NormalizedEventEnvelopeSchema.safeParse(input).success).toBe(true);
  });

  it.each(invalidNormalizedEventFixtures)("rejects $name", ({ input }) => {
    expect(NormalizedEventEnvelopeSchema.safeParse(input).success).toBe(false);
  });

  it("allows source clock skew without comparing timestamp order", () => {
    const result = NormalizedEventEnvelopeSchema.safeParse(validNormalizedEventFixtures[0].input);

    expect(result.success).toBe(true);
  });
});
