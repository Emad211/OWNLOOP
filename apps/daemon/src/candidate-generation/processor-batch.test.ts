import { beforeEach, describe, expect, it, vi } from "vitest";

import { readValidatedRunSemanticAnalysisInput } from "../semantic-input/index.js";
import { generateCandidateBatchWithResponsesAdapter } from "./adapter.js";
import { generateEligibleFinalizedRunCandidateBatches } from "./processor.js";
import { preparedSemanticInput, TEST_PROVIDER } from "./test-fixture.js";

vi.mock("../semantic-input/index.js", () => ({
  readValidatedRunSemanticAnalysisInput: vi.fn(),
}));
vi.mock("./adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapter.js")>();
  return { ...actual, generateCandidateBatchWithResponsesAdapter: vi.fn() };
});

const mockedSemanticInput = vi.mocked(readValidatedRunSemanticAnalysisInput);
const mockedAdapter = vi.mocked(generateCandidateBatchWithResponsesAdapter);

describe("Candidate generation batch processor", () => {
  beforeEach(() => {
    mockedSemanticInput.mockReset();
    mockedAdapter.mockReset();
  });

  it("stops the explicit batch immediately after abort", async () => {
    const prepared = preparedSemanticInput();
    mockedSemanticInput.mockResolvedValue({
      artifactId: "semantic-artifact-1",
      value: prepared.value,
    });
    mockedAdapter.mockResolvedValue({
      status: "aborted",
      diagnosticCode: "aborted",
      providerRequestId: null,
      attempts: [],
      usage: null,
    });
    const insert = vi.fn();
    const dependencies = {
      persistence: {
        artifacts: {},
        candidateGenerations: {
          listSemanticInputRunIds: () => ["run-1", "run-2"],
          getSucceededByKey: () => null,
          insert,
        },
        runFinalizations: {
          getByRun: () => ({ finalizationId: "finalization-1" }),
        },
        withTransaction: (operation: (transaction: unknown) => unknown) =>
          operation({ candidateGenerations: { insert } }),
      },
      artifactStore: {},
      transport: vi.fn(),
      generationIdGenerator: () => `gen_${"1".repeat(48)}`,
      clock: () => new Date("2026-07-24T12:00:00.000Z"),
    } as never;

    const results = await generateEligibleFinalizedRunCandidateBatches(
      dependencies,
      { enabled: true, provider: TEST_PROVIDER },
      2,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: "failed", diagnosticCode: "aborted" });
    expect(mockedSemanticInput).toHaveBeenCalledTimes(1);
    expect(mockedAdapter).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
