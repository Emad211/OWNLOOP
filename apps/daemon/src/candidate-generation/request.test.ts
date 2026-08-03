import { describe, expect, it } from "vitest";

import { normalizeCandidateGenerationEndpoint } from "./endpoint.js";
import {
  CANDIDATE_GENERATION_INSTRUCTIONS,
  candidateGenerationProviderPublicConfig,
  prepareCandidateGenerationRequest,
  prepareCandidateGenerationRequestIdentity,
} from "./request.js";
import { CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_FINGERPRINT } from "./schema.js";
import { preparedSemanticInput, TEST_API_KEY, TEST_PROVIDER } from "./test-fixture.js";

const decoder = new TextDecoder();

describe("Candidate generation request", () => {
  it("rejects unsafe endpoint forms", () => {
    for (const value of [
      "http://api.example.org/v1",
      "https://user:pass@api.example.org/v1",
      "https://api.example.org/v1?x=1",
      "https://api.example.org/v1#x",
      "https://127.0.0.1/v1",
      "https://localhost/v1",
      "https://api.example.org/custom",
    ]) {
      expect(() => normalizeCandidateGenerationEndpoint(value)).toThrow();
    }
  });

  it("produces deterministic secret-free request identity and bounded Responses body", () => {
    const semantic = preparedSemanticInput();
    const first = prepareCandidateGenerationRequest({
      semanticInputArtifactId: "semantic-artifact-1",
      semanticInput: semantic.value,
      provider: TEST_PROVIDER,
    });
    const second = prepareCandidateGenerationRequest({
      semanticInputArtifactId: "semantic-artifact-1",
      semanticInput: semantic.value,
      provider: { ...TEST_PROVIDER, apiKey: "different-secret" },
    });
    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.generationKey).toBe(second.generationKey);
    expect(first.canonicalRequestJson).not.toContain(TEST_API_KEY);
    expect(first.httpRequestJson).not.toContain(TEST_API_KEY);
    const body = JSON.parse(decoder.decode(first.httpRequestBytes));
    expect(body).toMatchObject({ store: false, background: false, stream: false });
    expect(body).not.toHaveProperty("tools");
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(first.canonicalRequestJson).toContain(CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_FINGERPRINT);
  });

  it("requires Persian presentation with a controlled internal claim", () => {
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain("All user-visible text must be Persian");
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain('change = "یک تغییر ثبت شد"');
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain(
      "The claim field is internal deterministic language",
    );
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain('"Behavior file modified"');
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain('"انتخاب با شواهد ثبت شده است"');
    expect(CANDIDATE_GENERATION_INSTRUCTIONS).toContain(
      "Never claim certainty, safety, completeness, performance improvement, or absence of risk",
    );
  });

  it("regenerates the same identity from persisted public configuration", () => {
    const semantic = preparedSemanticInput();
    const provider = candidateGenerationProviderPublicConfig(TEST_PROVIDER);
    const first = prepareCandidateGenerationRequest({
      semanticInputArtifactId: "semantic-artifact-1",
      semanticInput: semantic.value,
      provider: TEST_PROVIDER,
    });
    const identity = prepareCandidateGenerationRequestIdentity({
      semanticInputArtifactId: "semantic-artifact-1",
      semanticInput: semantic.value,
      providerConfig: provider.value,
    });
    expect(identity.requestFingerprint).toBe(first.requestFingerprint);
    expect(identity.generationKey).toBe(first.generationKey);
  });
});
