import { createHash } from "node:crypto";

import {
  CANDIDATE_GENERATION_DEFAULT_MAX_ATTEMPTS,
  CANDIDATE_GENERATION_MAX_REQUEST_BYTES,
  CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
  CANDIDATE_GENERATION_REQUEST_SCHEMA_VERSION,
  CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
  CANDIDATE_GENERATOR_VERSION,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  type CandidateGenerationProviderPublicConfigV1,
  CandidateGenerationProviderPublicConfigV1Schema,
  type CandidateGenerationRetryPolicyV1,
  type DeterministicSemanticAnalysisInputV1,
  DeterministicSemanticAnalysisInputV1Schema,
} from "@ownloop/contracts";
import {
  canonicalizeJson,
  DEFAULT_CANONICAL_INPUT_LIMITS,
  type CanonicalJsonLimits,
} from "@ownloop/ingress-security";

import { PersistenceError } from "../persistence/index.js";
import {
  CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES,
  CANDIDATE_GENERATION_RESPONSE_FORMAT_NAME,
} from "./constants.js";
import {
  normalizeCandidateGenerationEndpoint,
  type NormalizedCandidateGenerationEndpoint,
} from "./endpoint.js";
import {
  CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1,
  CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_FINGERPRINT,
} from "./schema.js";

const encoder = new TextEncoder();
const REQUEST_LIMITS: CanonicalJsonLimits = Object.freeze({
  ...DEFAULT_CANONICAL_INPUT_LIMITS,
  maxUtf8Bytes: CANDIDATE_GENERATION_MAX_REQUEST_BYTES,
  maxArrayItems: 100_000,
  maxObjectProperties: 100_000,
});
const API_KEY_MAX_BYTES = 8 * 1024;

export const CANDIDATE_GENERATION_INSTRUCTIONS =
  `You propose evidence-backed OwnLoop Candidate Moments from one verified semantic-analysis input.
Return only the requested strict JSON object. Do not use Markdown fences or add prose.
Every factual claim or question must cite one or more Evidence IDs that already exist in the supplied input. Never invent or transform Evidence IDs.
Do not emit file paths, URLs, citations, source excerpts, commands, code, HTML, callbacks, tools, or executable actions.
Confidence and importance are proposal signals, not proof. Evidence support will be verified later.
Zero Candidates is valid. Prefer one to five high-value Candidates and never return more than seven.
Use only the four types and their exact interaction shapes defined by the response schema.` as const;

export type CandidateGenerationProviderOptions = Readonly<{
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelRevision?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retryPolicy?: CandidateGenerationRetryPolicyV1;
  pricingTableId?: string | null;
  pricingTableVersion?: string | null;
}>;

export type CandidateGenerationRequestIdentity = Readonly<{
  semanticInputArtifactId: string;
  semanticInputFingerprint: string;
  providerConfig: CandidateGenerationProviderPublicConfigV1;
  providerConfigFingerprint: string;
  requestFingerprint: string;
  generationKey: string;
  canonicalRequestJson: string;
  canonicalRequestBytes: Uint8Array;
}>;

export type PreparedCandidateGenerationRequest = CandidateGenerationRequestIdentity &
  Readonly<{
    endpoint: NormalizedCandidateGenerationEndpoint;
    httpRequestJson: string;
    httpRequestBytes: Uint8Array;
  }>;

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validateSemanticInput(
  input: DeterministicSemanticAnalysisInputV1,
): DeterministicSemanticAnalysisInputV1 {
  const semanticInput = DeterministicSemanticAnalysisInputV1Schema.parse(input);
  if (semanticInput.outcome === "unavailable") {
    throw new PersistenceError(
      "operation_failed",
      "Unavailable semantic input cannot be sent to a provider.",
    );
  }
  return semanticInput;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

export function validateCandidateGenerationApiKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    encoder.encode(value).byteLength > API_KEY_MAX_BYTES ||
    containsControlCharacter(value)
  ) {
    throw new PersistenceError("operation_failed", "The provider secret is invalid.");
  }
  return value;
}

export function candidateGenerationProviderConfigFingerprint(
  input: CandidateGenerationProviderPublicConfigV1,
): string {
  const value = CandidateGenerationProviderPublicConfigV1Schema.parse(input);
  return sha256(canonicalizeJson(value, DEFAULT_CANONICAL_INPUT_LIMITS));
}

export function candidateGenerationProviderPublicConfig(
  options: CandidateGenerationProviderOptions,
): Readonly<{
  endpoint: NormalizedCandidateGenerationEndpoint;
  value: CandidateGenerationProviderPublicConfigV1;
  fingerprint: string;
}> {
  const endpoint = normalizeCandidateGenerationEndpoint(options.baseUrl);
  const value = CandidateGenerationProviderPublicConfigV1Schema.parse({
    providerFamily: "responses_json_v1",
    endpointOriginFingerprint: endpoint.originFingerprint,
    modelId: options.modelId,
    modelRevision: options.modelRevision ?? null,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxResponseBytes: options.maxResponseBytes ?? 256 * 1024,
    retryPolicy:
      options.retryPolicy ??
      ({
        maxAttempts: CANDIDATE_GENERATION_DEFAULT_MAX_ATTEMPTS,
        baseDelayMs: 250,
        maxRetryAfterMs: 5_000,
      } as const),
    pricingTableId: options.pricingTableId ?? null,
    pricingTableVersion: options.pricingTableVersion ?? null,
  });
  if ((value.pricingTableId === null) !== (value.pricingTableVersion === null)) {
    throw new PersistenceError("operation_failed", "The provider pricing identity is incomplete.");
  }
  return {
    endpoint,
    value,
    fingerprint: candidateGenerationProviderConfigFingerprint(value),
  };
}

export function prepareCandidateGenerationRequestIdentity(
  input: Readonly<{
    semanticInputArtifactId: string;
    semanticInput: DeterministicSemanticAnalysisInputV1;
    providerConfig: CandidateGenerationProviderPublicConfigV1;
  }>,
): CandidateGenerationRequestIdentity {
  const semanticInput = validateSemanticInput(input.semanticInput);
  const providerConfig = CandidateGenerationProviderPublicConfigV1Schema.parse(
    input.providerConfig,
  );
  const providerConfigFingerprint = candidateGenerationProviderConfigFingerprint(providerConfig);
  const requestCore = {
    schemaVersion: CANDIDATE_GENERATION_REQUEST_SCHEMA_VERSION,
    generatorVersion: CANDIDATE_GENERATOR_VERSION,
    promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
    responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
    targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    semanticInputArtifactId: input.semanticInputArtifactId,
    semanticInputFingerprint: semanticInput.inputFingerprint,
    providerConfigFingerprint,
    providerConfig,
    responseSchemaFingerprint: CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1_FINGERPRINT,
    instructions: CANDIDATE_GENERATION_INSTRUCTIONS,
    semanticInput,
  } as const;
  const canonicalRequestJson = canonicalizeJson(requestCore, REQUEST_LIMITS);
  const canonicalRequestBytes = encoder.encode(canonicalRequestJson);
  const requestFingerprint = sha256(canonicalRequestBytes);
  const generationKey = `gkey_${createHash("sha256")
    .update(requestFingerprint)
    .digest("hex")
    .slice(0, 48)}`;
  return {
    semanticInputArtifactId: input.semanticInputArtifactId,
    semanticInputFingerprint: semanticInput.inputFingerprint,
    providerConfig,
    providerConfigFingerprint,
    requestFingerprint,
    generationKey,
    canonicalRequestJson,
    canonicalRequestBytes,
  };
}

export function prepareCandidateGenerationRequest(
  input: Readonly<{
    semanticInputArtifactId: string;
    semanticInput: DeterministicSemanticAnalysisInputV1;
    provider: CandidateGenerationProviderOptions;
  }>,
): PreparedCandidateGenerationRequest {
  const provider = candidateGenerationProviderPublicConfig(input.provider);
  const identity = prepareCandidateGenerationRequestIdentity({
    semanticInputArtifactId: input.semanticInputArtifactId,
    semanticInput: input.semanticInput,
    providerConfig: provider.value,
  });
  const semanticJson = canonicalizeJson(input.semanticInput, REQUEST_LIMITS);
  const httpRequest = {
    model: provider.value.modelRevision ?? provider.value.modelId,
    store: false,
    background: false,
    stream: false,
    instructions: CANDIDATE_GENERATION_INSTRUCTIONS,
    input: semanticJson,
    text: {
      format: {
        type: "json_schema",
        name: CANDIDATE_GENERATION_RESPONSE_FORMAT_NAME,
        strict: true,
        schema: CANDIDATE_MOMENT_BATCH_JSON_SCHEMA_V1,
      },
    },
  } as const;
  const httpRequestJson = canonicalizeJson(httpRequest, REQUEST_LIMITS);
  const httpRequestBytes = encoder.encode(httpRequestJson);
  if (httpRequestBytes.byteLength > CANDIDATE_GENERATION_MAX_REQUEST_BYTES) {
    throw new PersistenceError("operation_failed", "The provider request exceeds its byte limit.");
  }
  return {
    ...identity,
    endpoint: provider.endpoint,
    httpRequestJson,
    httpRequestBytes,
  };
}

export function candidateGenerationProductLimit(): number {
  return CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES;
}
