import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "@ownloop/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readValidatedRunEvidenceGraph } from "../evidence-graph/index.js";
import type { SemanticAnalysisInputDependencies } from "./processor.js";
import {
  prepareEligibleFinalizedRunSemanticAnalysisInputs,
  prepareFinalizedRunSemanticAnalysisInput,
} from "./processor.js";

vi.mock("../evidence-graph/index.js", () => ({
  readValidatedRunEvidenceGraph: vi.fn(),
}));

const mockedReadValidatedRunEvidenceGraph = vi.mocked(readValidatedRunEvidenceGraph);

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

function unavailableGraphDependencies(): SemanticAnalysisInputDependencies {
  const forbiddenArtifactStore = new Proxy(
    {},
    {
      get() {
        throw new Error("unavailable Evidence Graph triggered an artifact read");
      },
    },
  );
  return {
    persistence: {
      taskRuns: {
        get: () => ({ status: "Partial" }),
      },
      runFinalizations: {
        getByRun: () => ({ finalizationId: "finalization-1" }),
      },
      artifacts: {
        getRecordForRunRole: () => null,
      },
    },
    artifactStore: forbiddenArtifactStore,
  } as unknown as SemanticAnalysisInputDependencies;
}

describe("semantic-analysis input processor", () => {
  beforeEach(() => {
    mockedReadValidatedRunEvidenceGraph.mockReset();
  });

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

  it("preserves controlled Evidence Graph limitations for unavailable input", async () => {
    mockedReadValidatedRunEvidenceGraph.mockResolvedValueOnce({
      artifactId: "graph-artifact",
      value: {
        outcome: "unavailable",
        limitations: ["verification_unavailable", "evidence_gaps_present"],
      },
    } as never);

    await expect(
      prepareFinalizedRunSemanticAnalysisInput(unavailableGraphDependencies(), "run-1", {
        enabled: true,
      }),
    ).resolves.toMatchObject({
      runId: "run-1",
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: ["verification_unavailable", "evidence_gaps_present"],
      artifactId: null,
    });
    expect(mockedReadValidatedRunEvidenceGraph).toHaveBeenCalledTimes(1);
  });
});
