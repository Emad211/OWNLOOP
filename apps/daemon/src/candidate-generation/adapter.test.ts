import { describe, expect, it, vi } from "vitest";

import { generateCandidateBatchWithResponsesAdapter } from "./adapter.js";
import { prepareCandidateGenerationRequest } from "./request.js";
import {
  CandidateGenerationTransportError,
  type CandidateGenerationTransport,
} from "./transport.js";
import { preparedSemanticInput, TEST_API_KEY, TEST_PROVIDER } from "./test-fixture.js";

const encoder = new TextEncoder();

function request() {
  const semantic = preparedSemanticInput();
  return prepareCandidateGenerationRequest({
    semanticInputArtifactId: "semantic-artifact-1",
    semanticInput: semantic.value,
    provider: TEST_PROVIDER,
  });
}

function completed(text: string) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "x-request-id": "req-1" },
    body: encoder.encode(
      JSON.stringify({
        id: "resp-1",
        status: "completed",
        output: [{ content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      }),
    ),
  };
}

describe("Responses Candidate adapter", () => {
  it("accepts a strict zero-Candidate response and keeps the secret out of the body", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async (input) => {
      expect(input.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(new TextDecoder().decode(input.body)).not.toContain(TEST_API_KEY);
      return completed(JSON.stringify({ schemaVersion: 1, candidates: [] }));
    });
    const result = await generateCandidateBatchWithResponsesAdapter(
      { transport },
      request(),
      TEST_PROVIDER,
    );
    expect(result.status).toBe("succeeded");
    expect(result.attempts).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects JSON-prefixed non-JSON media types", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async () => ({
      ...completed(JSON.stringify({ schemaVersion: 1, candidates: [] })),
      headers: { "content-type": "application/jsonp" },
    }));
    const result = await generateCandidateBatchWithResponsesAdapter(
      { transport },
      request(),
      TEST_PROVIDER,
    );
    expect(result).toMatchObject({
      status: "invalid_response",
      diagnosticCode: "invalid_content_type",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not repair Markdown-fenced Candidate output or retry schema failures", async () => {
    const transport = vi.fn<CandidateGenerationTransport>(async () =>
      completed('```json\n{"schemaVersion":1,"candidates":[]}\n```'),
    );
    const result = await generateCandidateBatchWithResponsesAdapter(
      { transport },
      request(),
      TEST_PROVIDER,
    );
    expect(result).toMatchObject({
      status: "invalid_response",
      diagnosticCode: "invalid_candidate_batch",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("retries transient HTTP and timeout failures with recorded bounded delay", async () => {
    const sleep = vi.fn(async () => {});
    const httpTransport = vi
      .fn<CandidateGenerationTransport>()
      .mockResolvedValueOnce({
        statusCode: 503,
        headers: { "content-type": "application/json", "retry-after": "0.02" },
        body: encoder.encode("{}"),
      })
      .mockResolvedValueOnce(completed(JSON.stringify({ schemaVersion: 1, candidates: [] })));
    const httpResult = await generateCandidateBatchWithResponsesAdapter(
      { transport: httpTransport, sleep },
      request(),
      TEST_PROVIDER,
    );
    expect(httpResult.status).toBe("succeeded");
    expect(httpResult.attempts[0]?.retryDelayMs).toBe(20);

    const timeoutTransport = vi
      .fn<CandidateGenerationTransport>()
      .mockRejectedValueOnce(new CandidateGenerationTransportError("timeout"))
      .mockResolvedValueOnce(completed(JSON.stringify({ schemaVersion: 1, candidates: [] })));
    const timeoutResult = await generateCandidateBatchWithResponsesAdapter(
      { transport: timeoutTransport, sleep },
      request(),
      TEST_PROVIDER,
    );
    expect(timeoutResult.status).toBe("succeeded");
    expect(timeoutResult.attempts[0]?.outcome).toBe("timeout");
    expect(timeoutResult.attempts[0]?.retryDelayMs).toBe(10);
  });
});
