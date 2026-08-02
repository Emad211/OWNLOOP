import { describe, expect, it } from "vitest";

import {
  AVALAI_GLOBAL_BASE_URL,
  AVALAI_IR_BASE_URL,
  avalAiBaseUrl,
  createAvalAiCandidateGenerationProviderOptions,
} from "./avalai.js";
import { candidateGenerationProviderPublicConfig } from "./request.js";

describe("AvalAI Candidate generation preset", () => {
  it("uses the official Iran endpoint by default and derives the Responses route", () => {
    const secret = "avalai-test-secret";
    const options = createAvalAiCandidateGenerationProviderOptions({
      apiKey: secret,
      modelId: "user-selected-model",
    });
    const publicConfig = candidateGenerationProviderPublicConfig(options);

    expect(avalAiBaseUrl()).toBe(AVALAI_IR_BASE_URL);
    expect(options.baseUrl).toBe(AVALAI_IR_BASE_URL);
    expect(publicConfig.endpoint.responseUrl).toBe("https://api.avalai.ir/v1/responses");
    expect(publicConfig.value.modelId).toBe("user-selected-model");
    expect(JSON.stringify(publicConfig)).not.toContain(secret);
  });

  it("supports the official global endpoint without hard-coding a model", () => {
    const options = createAvalAiCandidateGenerationProviderOptions({
      region: "global",
      apiKey: "another-memory-only-secret",
      modelId: "another-user-selected-model",
      timeoutMs: 20_000,
    });
    const publicConfig = candidateGenerationProviderPublicConfig(options);

    expect(avalAiBaseUrl("global")).toBe(AVALAI_GLOBAL_BASE_URL);
    expect(options.baseUrl).toBe(AVALAI_GLOBAL_BASE_URL);
    expect(publicConfig.endpoint.responseUrl).toBe("https://api.avalai.org/v1/responses");
    expect(publicConfig.value.modelId).toBe("another-user-selected-model");
    expect(publicConfig.value.timeoutMs).toBe(20_000);
  });
});
