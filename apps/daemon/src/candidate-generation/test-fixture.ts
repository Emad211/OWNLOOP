import { CANDIDATE_DECISION_OPTIONS } from "@ownloop/contracts";

import { prepareDeterministicSemanticAnalysisInput } from "../semantic-input/reducer.js";
import { runEvidenceId, semanticInputFixture } from "../semantic-input/test-fixture.js";
import type { CandidateGenerationProviderOptions } from "./request.js";

export const TEST_API_KEY = "test-secret-api-key";
export const TEST_PROVIDER: CandidateGenerationProviderOptions = {
  baseUrl: "https://api.provider.example.org/v1",
  apiKey: TEST_API_KEY,
  modelId: "model-1",
  modelRevision: "2026-07-01",
  timeoutMs: 10_000,
  maxResponseBytes: 64 * 1024,
  retryPolicy: { maxAttempts: 2, baseDelayMs: 10, maxRetryAfterMs: 100 },
};

export function preparedSemanticInput() {
  const prepared = prepareDeterministicSemanticAnalysisInput(semanticInputFixture());
  if (!("bytes" in prepared)) throw new Error("Expected ready semantic input fixture.");
  return prepared;
}

export function decisionCandidate() {
  return {
    type: "decision" as const,
    title: "Confirm the evidence-backed change",
    claim: "The verification evidence records a passing test.",
    importance: "high" as const,
    confidenceBasisPoints: 8_000,
    evidenceIds: [runEvidenceId],
    suggestedInteraction: {
      kind: "decision_response" as const,
      prompt: "Should this decision be confirmed?",
      options: CANDIDATE_DECISION_OPTIONS,
    },
  };
}
