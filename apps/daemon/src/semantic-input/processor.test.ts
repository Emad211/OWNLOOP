import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import type { SemanticAnalysisInputDependencies } from "./processor.js";
import {
  prepareEligibleFinalizedRunSemanticAnalysisInputs,
  prepareFinalizedRunSemanticAnalysisInput,
} from "./processor.js";

function unreadableDependencies(): SemanticAnalysisInputDependencies {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error("disabled semantic analysis performed a sensitive read");
      },
    },
  );
  return {
    persistence: forbidden,
    artifactStore: forbidden,
  } as SemanticAnalysisInputDependencies;
}

describe("semantic-analysis input processor", () => {
  it("returns disabled before any sensitive read or write", async () => {
    await expect(
      prepareFinalizedRunSemanticAnalysisInput(unreadableDependencies(), "run-1", {
        enabled: false,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      builderVersion: "0.1.0",
      reductionPolicyVersion: "ownloop-semantic-input-reduction-v1",
      redactionPolicyVersion: "ownloop-semantic-input-redaction-v1",
      tokenEstimatorVersion: "ownloop-byte-token-upper-bound-v1",
      targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
      runId: "run-1",
      outcome: "disabled",
      diagnosticCode: "disabled",
      limitations: [],
      artifactId: null,
      inputFingerprint: null,
      summaryCount: 0,
      relationCount: 0,
      verificationExcerptCount: 0,
      utf8ByteCount: 0,
      modelVisibleTextCodePointCount: 0,
      inputTokenUpperBound: 0,
      monetaryEstimateStatus: "provider_not_selected",
    });
    await expect(
      prepareEligibleFinalizedRunSemanticAnalysisInputs(unreadableDependencies(), {
        enabled: false,
      }),
    ).resolves.toEqual([]);
  });
});
