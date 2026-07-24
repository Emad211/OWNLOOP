import { describe, expect, it } from "vitest";

import {
  CANDIDATE_GENERATION_PRICING_POLICY_VERSION,
  CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
  CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
  CANDIDATE_GENERATION_SCHEMA_VERSION,
  CANDIDATE_GENERATOR_VERSION,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  CandidateGenerationProviderPublicConfigV1Schema,
  CandidateGenerationRecordV1Schema,
  CandidateGenerationResultV1Schema,
} from "../src/index.js";

const at = "2026-07-24T12:00:00.000Z";
const sha = `sha256:${"a".repeat(64)}`;
const provider = {
  providerFamily: "responses_json_v1" as const,
  endpointOriginFingerprint: `sha256:${"b".repeat(64)}`,
  modelId: "model-1",
  modelRevision: null,
  timeoutMs: 30_000,
  maxResponseBytes: 1024,
  retryPolicy: { maxAttempts: 2, baseDelayMs: 10, maxRetryAfterMs: 1000 },
  pricingTableId: null,
  pricingTableVersion: null,
};
const pricing = {
  status: "unavailable" as const,
  amountMinorUnits: null,
  currency: null,
  pricingTableId: null,
  pricingTableVersion: null,
  calculationPolicyVersion: CANDIDATE_GENERATION_PRICING_POLICY_VERSION,
};
const zero = { total: 0, change: 0, decision: 0, risk: 0, check: 0 };
const attempt = {
  attemptNumber: 1,
  outcome: "completed" as const,
  httpStatus: 200,
  providerRequestId: "req-1",
  startedAt: at,
  completedAt: at,
  retryDelayMs: 0,
};
const base = {
  schemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
  requestSchemaVersion: 1 as const,
  generatorVersion: CANDIDATE_GENERATOR_VERSION,
  promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
  responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
  targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
  generationId: `gen_${"1".repeat(48)}`,
  generationKey: `gkey_${"2".repeat(48)}`,
  runId: "run-1",
  finalizationId: "finalization-1",
  semanticInputArtifactId: "semantic-artifact-1",
  semanticInputFingerprint: "3".repeat(64),
  requestFingerprint: sha,
  providerConfigFingerprint: `sha256:${"c".repeat(64)}`,
  providerConfig: provider,
  providerRequestId: "req-1",
  startedAt: at,
  completedAt: at,
  pricing,
};

describe("Candidate generation contracts", () => {
  it("keeps public provider configuration strict and secret-free", () => {
    expect(CandidateGenerationProviderPublicConfigV1Schema.parse(provider)).toEqual(provider);
    expect(() =>
      CandidateGenerationProviderPublicConfigV1Schema.parse({ ...provider, apiKey: "secret" }),
    ).toThrow();
  });

  it("accepts successful zero-Candidate provenance with a canonical artifact", () => {
    const record = CandidateGenerationRecordV1Schema.parse({
      ...base,
      candidateArtifactId: "candidate-artifact-1",
      candidateArtifactRole: `candidate-moment-batch-v1.gen_${"1".repeat(48)}`,
      candidateFingerprint: `sha256:${"d".repeat(64)}`,
      status: "succeeded",
      diagnosticCode: "completed",
      attempts: [attempt],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      candidateCounts: zero,
    });
    expect(record.candidateCounts.total).toBe(0);
  });

  it("rejects failed records with Candidate output or inconsistent attempts", () => {
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...base,
        candidateArtifactId: "candidate-artifact-1",
        candidateArtifactRole: `candidate-moment-batch-v1.gen_${"1".repeat(48)}`,
        candidateFingerprint: `sha256:${"d".repeat(64)}`,
        status: "invalid_response",
        diagnosticCode: "invalid_candidate_batch",
        attempts: [{ ...attempt, outcome: "invalid_candidate_batch" }],
        usage: null,
        candidateCounts: zero,
      }),
    ).toThrow();
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...base,
        candidateArtifactId: null,
        candidateArtifactRole: null,
        candidateFingerprint: null,
        status: "transport_failed",
        diagnosticCode: "transport_error",
        attempts: [{ ...attempt, attemptNumber: 2, outcome: "transport_error", httpStatus: null }],
        usage: null,
        candidateCounts: zero,
      }),
    ).toThrow();
  });

  it("rejects tampered generation roles, chronology, retries, and provider request identity", () => {
    const successful = {
      ...base,
      candidateArtifactId: "candidate-artifact-1",
      candidateArtifactRole: `candidate-moment-batch-v1.gen_${"1".repeat(48)}`,
      candidateFingerprint: `sha256:${"d".repeat(64)}`,
      status: "succeeded" as const,
      diagnosticCode: "completed" as const,
      attempts: [attempt],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      candidateCounts: zero,
    };
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        candidateArtifactRole: `candidate-moment-batch-v1.gen_${"9".repeat(48)}`,
      }),
    ).toThrow();
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        startedAt: "2026-07-24T11:59:59.000Z",
      }),
    ).toThrow();
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        providerRequestId: "req-other",
      }),
    ).toThrow();
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        attempts: [{ ...attempt, retryDelayMs: 1 }],
      }),
    ).toThrow();
    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        completedAt: "2026-07-24T12:00:01.000Z",
        attempts: [
          { ...attempt, outcome: "http_permanent", retryDelayMs: 1 },
          {
            ...attempt,
            attemptNumber: 2,
            startedAt: "2026-07-24T12:00:00.500Z",
            completedAt: "2026-07-24T12:00:01.000Z",
          },
        ],
      }),
    ).toThrow();
  });

  it("compares attempt chronology by instant rather than timestamp text", () => {
    const successful = {
      ...base,
      candidateArtifactId: "candidate-artifact-1",
      candidateArtifactRole: `candidate-moment-batch-v1.gen_${"1".repeat(48)}`,
      candidateFingerprint: `sha256:${"d".repeat(64)}`,
      status: "succeeded" as const,
      diagnosticCode: "completed" as const,
      providerRequestId: "req-2",
      startedAt: "2026-07-24T12:00:00.000+01:00",
      completedAt: "2026-07-24T12:00:00.000Z",
      attempts: [
        {
          ...attempt,
          outcome: "http_transient" as const,
          httpStatus: 503,
          providerRequestId: "req-1",
          startedAt: "2026-07-24T12:00:00.000+01:00",
          completedAt: "2026-07-24T12:30:00.000+01:00",
          retryDelayMs: 10,
        },
        {
          ...attempt,
          attemptNumber: 2,
          providerRequestId: "req-2",
          startedAt: "2026-07-24T11:45:00.000Z",
          completedAt: "2026-07-24T12:00:00.000Z",
        },
      ],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      candidateCounts: zero,
    };

    expect(CandidateGenerationRecordV1Schema.parse(successful).status).toBe("succeeded");

    expect(() =>
      CandidateGenerationRecordV1Schema.parse({
        ...successful,
        startedAt: "2026-07-24T12:00:00.000Z",
        completedAt: "2026-07-24T14:45:00.000+02:00",
        attempts: [
          {
            ...successful.attempts[0],
            startedAt: "2026-07-24T12:00:00.000Z",
            completedAt: "2026-07-24T12:30:00.000Z",
          },
          {
            ...successful.attempts[1],
            startedAt: "2026-07-24T14:00:00.000+02:00",
            completedAt: "2026-07-24T14:45:00.000+02:00",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects failed public results that use non-failure diagnostics", () => {
    for (const diagnosticCode of ["completed", "disabled", "semantic_input_unavailable"] as const) {
      expect(() =>
        CandidateGenerationResultV1Schema.parse({
          schemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
          generatorVersion: CANDIDATE_GENERATOR_VERSION,
          promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
          responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
          targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
          runId: "run-1",
          outcome: "failed",
          diagnosticCode,
          generationId: `gen_${"1".repeat(48)}`,
          generationKey: `gkey_${"2".repeat(48)}`,
          semanticInputArtifactId: "semantic-artifact-1",
          candidateArtifactId: null,
          requestFingerprint: sha,
          candidateFingerprint: null,
          providerFamily: "responses_json_v1",
          modelId: "model-1",
          modelRevision: null,
          candidateCounts: zero,
          attemptCount: 1,
          usage: null,
          pricing,
        }),
      ).toThrow();
    }
  });

  it("keeps disabled and failed public results content-free", () => {
    expect(
      CandidateGenerationResultV1Schema.parse({
        schemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
        generatorVersion: CANDIDATE_GENERATOR_VERSION,
        promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
        responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
        targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
        runId: "run-1",
        outcome: "disabled",
        diagnosticCode: "disabled",
        generationId: null,
        generationKey: null,
        semanticInputArtifactId: null,
        candidateArtifactId: null,
        requestFingerprint: null,
        candidateFingerprint: null,
        providerFamily: null,
        modelId: null,
        modelRevision: null,
        candidateCounts: zero,
        attemptCount: 0,
        usage: null,
        pricing,
      }).outcome,
    ).toBe("disabled");
  });
});
