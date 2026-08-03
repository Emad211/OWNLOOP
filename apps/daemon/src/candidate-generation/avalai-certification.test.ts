import { describe, expect, it, vi } from "vitest";

import { certifyAvalAiCandidateGeneration } from "./avalai-certification.js";
import {
  CandidateGenerationTransportError,
  type CandidateGenerationTransport,
} from "./transport.js";
import { preparedSemanticInput, TEST_API_KEY } from "./test-fixture.js";

const encoder = new TextEncoder();

function input(maxAttempts = 1) {
  return {
    semanticInputArtifactId: "semantic-artifact-certification-1",
    semanticInput: preparedSemanticInput().value,
    provider: {
      region: "iran" as const,
      apiKey: TEST_API_KEY,
      modelId: "model-1",
      modelRevision: null,
      timeoutMs: 1_000,
      maxResponseBytes: 64 * 1024,
      retryPolicy: { maxAttempts, baseDelayMs: 10, maxRetryAfterMs: 100 },
    },
  };
}

function completed(candidateText: string) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": "avalai-request-1",
    },
    body: encoder.encode(
      JSON.stringify({
        id: "avalai-response-1",
        status: "completed",
        output: [{ content: [{ type: "output_text", text: candidateText }] }],
        usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
      }),
    ),
  };
}

describe("AvalAI certification harness", () => {
  it("certifies a strict response through the official Iran endpoint without exposing the secret", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async (request) => {
      expect(request.url).toBe("https://api.avalai.ir/v1/responses");
      expect(request.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(new TextDecoder().decode(request.body)).not.toContain(TEST_API_KEY);
      return completed(JSON.stringify({ schemaVersion: 1, candidates: [] }));
    });

    const result = await certifyAvalAiCandidateGeneration({ transport }, input());

    expect(result).toMatchObject({
      schemaVersion: 1,
      region: "iran",
      status: "succeeded",
      diagnosticCode: "completed",
      providerRequestId: "avalai-request-1",
      candidateCount: 0,
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
    });
    expect(result.candidateBatchFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.providerConfigFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded invalid-envelope result without raw provider content", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: encoder.encode("{not-json"),
    }));

    const result = await certifyAvalAiCandidateGeneration({ transport }, input());

    expect(result).toMatchObject({
      status: "invalid_response",
      diagnosticCode: "invalid_provider_envelope",
      candidateCount: 0,
      candidateBatchFingerprint: null,
      usage: null,
      attempts: [{ attemptNumber: 1, outcome: "invalid_envelope", httpStatus: 200 }],
    });
    expect(JSON.stringify(result)).not.toContain("not-json");
    expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
  });

  it("classifies timeout and oversized responses without returning exception text or secrets", async () => {
    const timeoutTransport = vi.fn<CandidateGenerationTransport>(async () => {
      throw new CandidateGenerationTransportError("timeout");
    });
    const timeout = await certifyAvalAiCandidateGeneration(
      { transport: timeoutTransport },
      input(),
    );
    expect(timeout).toMatchObject({
      status: "transport_failed",
      diagnosticCode: "transport_timeout",
      attempts: [{ attemptNumber: 1, outcome: "timeout", retryDelayMs: 0 }],
    });

    const oversizedTransport = vi.fn<CandidateGenerationTransport>(async () => {
      throw new CandidateGenerationTransportError("response_too_large");
    });
    const oversized = await certifyAvalAiCandidateGeneration(
      { transport: oversizedTransport },
      input(),
    );
    expect(oversized).toMatchObject({
      status: "invalid_response",
      diagnosticCode: "response_too_large",
      attempts: [{ attemptNumber: 1, outcome: "response_too_large", retryDelayMs: 0 }],
    });

    expect(JSON.stringify({ timeout, oversized })).not.toContain(TEST_API_KEY);
    expect(JSON.stringify({ timeout, oversized })).not.toContain("provider transport failed");
  });

  it("uses only the selected official global endpoint", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async (request) => {
      expect(request.url).toBe("https://api.avalai.org/v1/responses");
      return completed(JSON.stringify({ schemaVersion: 1, candidates: [] }));
    });

    const certificationInput = input();
    const result = await certifyAvalAiCandidateGeneration(
      { transport },
      {
        ...certificationInput,
        provider: { ...certificationInput.provider, region: "global" },
      },
    );

    expect(result.region).toBe("global");
  });
});
