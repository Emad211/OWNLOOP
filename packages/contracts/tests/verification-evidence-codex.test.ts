import { describe, expect, it } from "vitest";

import { VerificationCommandObservationV1Schema } from "../src/index.js";

function observation(
  exitCode: number | null,
  status: "passed" | "failed" | "observed_without_exit_code",
) {
  return {
    observationIndex: 0,
    sourceEventId: "event-codex-command-1",
    commandFingerprint: "a".repeat(64),
    kind: "test" as const,
    ruleId: "test.package_manager_script",
    toolFamily: "pnpm" as const,
    sourceToolOutcome: "completed" as const,
    exitCode,
    status,
    reducedOutputs: [],
    commandEventId: "command-event-codex-1",
    verificationEventId: "verification-event-codex-1",
  };
}

describe("neutral Codex verification outcomes", () => {
  it.each([
    [0, "passed"],
    [2, "failed"],
    [null, "observed_without_exit_code"],
  ] as const)("maps structured exit code %s to %s", (exitCode, status) => {
    expect(
      VerificationCommandObservationV1Schema.parse(observation(exitCode, status)),
    ).toMatchObject({
      sourceToolOutcome: "completed",
      exitCode,
      status,
    });
  });

  it("rejects a success claim when neutral completion carries a non-zero exit code", () => {
    expect(VerificationCommandObservationV1Schema.safeParse(observation(2, "passed")).success).toBe(
      false,
    );
  });
});
