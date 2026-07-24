import { describe, expect, it } from "vitest";

import type { CandidateGenerationDependencies } from "./processor.js";
import {
  generateEligibleFinalizedRunCandidateBatches,
  generateFinalizedRunCandidateBatch,
} from "./processor.js";

function unreadableDependencies(): CandidateGenerationDependencies {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error("disabled Candidate generation performed a sensitive read");
      },
    },
  );
  return {
    persistence: forbidden,
    artifactStore: forbidden,
    transport: forbidden,
  } as CandidateGenerationDependencies;
}

describe("Candidate generation processor", () => {
  it("returns disabled before semantic input, secret, network, or persistence access", async () => {
    await expect(
      generateFinalizedRunCandidateBatch(unreadableDependencies(), "run-1", { enabled: false }),
    ).resolves.toMatchObject({
      runId: "run-1",
      outcome: "disabled",
      diagnosticCode: "disabled",
      generationId: null,
      semanticInputArtifactId: null,
      candidateArtifactId: null,
      attemptCount: 0,
    });
    await expect(
      generateEligibleFinalizedRunCandidateBatches(unreadableDependencies(), { enabled: false }),
    ).resolves.toEqual([]);
  });
});
