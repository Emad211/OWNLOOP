import { z } from "zod";

import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "./candidate-moment.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const safeModelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u);
const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const semanticFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true, precision: 3 });
const providerRequestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u)
  .nullable();

export const CANDIDATE_GENERATION_SCHEMA_VERSION = 1 as const;
export const CANDIDATE_GENERATION_REQUEST_SCHEMA_VERSION = 1 as const;
export const CANDIDATE_GENERATOR_VERSION = "0.1.0" as const;
export const CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION =
  "ownloop-candidate-generation-prompt-v1" as const;
export const CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION =
  "ownloop-candidate-generation-response-v1" as const;
export const CANDIDATE_GENERATION_PRICING_POLICY_VERSION =
  "ownloop-candidate-generation-pricing-v1" as const;

export const CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES = 7;
export const CANDIDATE_GENERATION_MAX_BATCH_RUNS = 10;
export const CANDIDATE_GENERATION_MAX_REQUEST_BYTES = 1024 * 1024;
export const CANDIDATE_GENERATION_MAX_RESPONSE_BYTES = 256 * 1024;
export const CANDIDATE_GENERATION_DEFAULT_MAX_ATTEMPTS = 2;
export const CANDIDATE_GENERATION_MAX_ATTEMPTS = 3;

export const CANDIDATE_GENERATION_PROVIDER_FAMILIES = ["responses_json_v1"] as const;
export const CandidateGenerationProviderFamilySchema = z.enum(
  CANDIDATE_GENERATION_PROVIDER_FAMILIES,
);
export type CandidateGenerationProviderFamily = z.infer<
  typeof CandidateGenerationProviderFamilySchema
>;

export const CandidateGenerationRetryPolicyV1Schema = z.strictObject({
  maxAttempts: z.number().int().min(1).max(CANDIDATE_GENERATION_MAX_ATTEMPTS),
  baseDelayMs: z.number().int().min(0).max(30_000),
  maxRetryAfterMs: z.number().int().min(0).max(60_000),
});
export type CandidateGenerationRetryPolicyV1 = z.infer<
  typeof CandidateGenerationRetryPolicyV1Schema
>;

export const CandidateGenerationProviderPublicConfigV1Schema = z
  .strictObject({
    providerFamily: z.literal(CANDIDATE_GENERATION_PROVIDER_FAMILIES[0]),
    endpointOriginFingerprint: sha256FingerprintSchema,
    modelId: safeModelSchema,
    modelRevision: safeModelSchema.nullable(),
    timeoutMs: z.number().int().min(1_000).max(120_000),
    maxResponseBytes: z.number().int().min(1).max(CANDIDATE_GENERATION_MAX_RESPONSE_BYTES),
    retryPolicy: CandidateGenerationRetryPolicyV1Schema,
    pricingTableId: safeIdSchema.nullable(),
    pricingTableVersion: safeVersionSchema.nullable(),
  })
  .superRefine((value, context) => {
    if ((value.pricingTableId === null) !== (value.pricingTableVersion === null)) {
      context.addIssue({ code: "custom", message: "Pricing identity must be all-or-none." });
    }
  });
export type CandidateGenerationProviderPublicConfigV1 = z.infer<
  typeof CandidateGenerationProviderPublicConfigV1Schema
>;

export const CANDIDATE_GENERATION_ATTEMPT_OUTCOMES = [
  "completed",
  "http_transient",
  "http_permanent",
  "invalid_content_type",
  "invalid_envelope",
  "provider_refusal",
  "provider_incomplete",
  "product_limit_exceeded",
  "invalid_candidate_batch",
  "aborted",
  "timeout",
  "response_too_large",
  "transport_error",
] as const;
export const CandidateGenerationAttemptOutcomeSchema = z.enum(
  CANDIDATE_GENERATION_ATTEMPT_OUTCOMES,
);
export type CandidateGenerationAttemptOutcome = z.infer<
  typeof CandidateGenerationAttemptOutcomeSchema
>;

export const CandidateGenerationAttemptV1Schema = z
  .strictObject({
    attemptNumber: z.number().int().min(1).max(CANDIDATE_GENERATION_MAX_ATTEMPTS),
    outcome: CandidateGenerationAttemptOutcomeSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    providerRequestId: providerRequestIdSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    retryDelayMs: z.number().int().min(0).max(60_000),
  })
  .superRefine((value, context) => {
    if (value.completedAt < value.startedAt) {
      context.addIssue({ code: "custom", message: "Attempt completion precedes start." });
    }
    const requiresHttp = [
      "completed",
      "http_transient",
      "http_permanent",
      "invalid_content_type",
      "invalid_envelope",
      "provider_refusal",
      "provider_incomplete",
      "product_limit_exceeded",
      "invalid_candidate_batch",
    ].includes(value.outcome);
    if (requiresHttp !== (value.httpStatus !== null)) {
      context.addIssue({ code: "custom", message: "Attempt HTTP status is inconsistent." });
    }
    if (
      value.retryDelayMs > 0 &&
      value.outcome !== "http_transient" &&
      value.outcome !== "timeout" &&
      value.outcome !== "transport_error"
    ) {
      context.addIssue({ code: "custom", message: "Attempt retry delay is inconsistent." });
    }
  });
export type CandidateGenerationAttemptV1 = z.infer<typeof CandidateGenerationAttemptV1Schema>;

export const CandidateGenerationTokenUsageV1Schema = z
  .strictObject({
    inputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    outputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    totalTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((value, context) => {
    if (value.totalTokens !== value.inputTokens + value.outputTokens) {
      context.addIssue({ code: "custom", message: "Token totals are inconsistent." });
    }
  });
export type CandidateGenerationTokenUsageV1 = z.infer<typeof CandidateGenerationTokenUsageV1Schema>;

export const CANDIDATE_GENERATION_PRICING_STATUSES = [
  "unavailable",
  "provider_reported",
  "configured_estimate",
] as const;
export const CandidateGenerationPricingStatusSchema = z.enum(CANDIDATE_GENERATION_PRICING_STATUSES);
export type CandidateGenerationPricingStatus = z.infer<
  typeof CandidateGenerationPricingStatusSchema
>;

export const CandidateGenerationPricingV1Schema = z
  .strictObject({
    status: CandidateGenerationPricingStatusSchema,
    amountMinorUnits: z
      .string()
      .regex(/^(?:0|[1-9][0-9]{0,30})$/u)
      .nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    pricingTableId: safeIdSchema.nullable(),
    pricingTableVersion: safeVersionSchema.nullable(),
    calculationPolicyVersion: z.literal(CANDIDATE_GENERATION_PRICING_POLICY_VERSION),
  })
  .superRefine((value, context) => {
    const hasAmount = value.amountMinorUnits !== null && value.currency !== null;
    const hasTable = value.pricingTableId !== null && value.pricingTableVersion !== null;
    if ((value.amountMinorUnits === null) !== (value.currency === null)) {
      context.addIssue({ code: "custom", message: "Pricing amount and currency must be paired." });
    }
    if ((value.pricingTableId === null) !== (value.pricingTableVersion === null)) {
      context.addIssue({ code: "custom", message: "Pricing table identity must be paired." });
    }
    if (value.status === "unavailable" && (hasAmount || hasTable)) {
      context.addIssue({
        code: "custom",
        message: "Unavailable pricing cannot contain an amount.",
      });
    }
    if (value.status === "provider_reported" && (!hasAmount || hasTable)) {
      context.addIssue({ code: "custom", message: "Provider pricing is inconsistent." });
    }
    if (value.status === "configured_estimate" && (!hasAmount || !hasTable)) {
      context.addIssue({ code: "custom", message: "Configured pricing is incomplete." });
    }
  });
export type CandidateGenerationPricingV1 = z.infer<typeof CandidateGenerationPricingV1Schema>;

export const CandidateGenerationCandidateCountsV1Schema = z
  .strictObject({
    total: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    change: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    decision: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    risk: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
    check: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES),
  })
  .superRefine((value, context) => {
    if (value.total !== value.change + value.decision + value.risk + value.check) {
      context.addIssue({ code: "custom", message: "Candidate type counts are inconsistent." });
    }
  });
export type CandidateGenerationCandidateCountsV1 = z.infer<
  typeof CandidateGenerationCandidateCountsV1Schema
>;

export const CANDIDATE_GENERATION_STATUSES = [
  "succeeded",
  "aborted",
  "transport_failed",
  "provider_rejected",
  "invalid_response",
] as const;
export const CandidateGenerationStatusSchema = z.enum(CANDIDATE_GENERATION_STATUSES);
export type CandidateGenerationStatus = z.infer<typeof CandidateGenerationStatusSchema>;

export const CANDIDATE_GENERATION_DIAGNOSTIC_CODES = [
  "completed",
  "disabled",
  "semantic_input_unavailable",
  "persistence_failed",
  "aborted",
  "http_transient_exhausted",
  "http_permanent_failure",
  "invalid_content_type",
  "invalid_provider_envelope",
  "provider_refusal",
  "provider_incomplete",
  "candidate_product_limit_exceeded",
  "invalid_candidate_batch",
  "response_too_large",
  "transport_timeout",
  "transport_error",
] as const;
export const CandidateGenerationDiagnosticCodeSchema = z.enum(
  CANDIDATE_GENERATION_DIAGNOSTIC_CODES,
);
export type CandidateGenerationDiagnosticCode = z.infer<
  typeof CandidateGenerationDiagnosticCodeSchema
>;

const generationIdSchema = z.string().regex(/^gen_[0-9a-f]{48}$/u);
const generationKeySchema = z.string().regex(/^gkey_[0-9a-f]{48}$/u);
const candidateRoleSchema = z.string().regex(/^candidate-moment-batch-v1\.gen_[0-9a-f]{48}$/u);

export const CandidateGenerationRecordV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CANDIDATE_GENERATION_SCHEMA_VERSION),
    requestSchemaVersion: z.literal(CANDIDATE_GENERATION_REQUEST_SCHEMA_VERSION),
    generatorVersion: z.literal(CANDIDATE_GENERATOR_VERSION),
    promptTemplateVersion: z.literal(CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION),
    responseSchemaVersion: z.literal(CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION),
    targetCandidateMomentSchemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
    generationId: generationIdSchema,
    generationKey: generationKeySchema,
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    semanticInputArtifactId: safeIdSchema,
    semanticInputFingerprint: semanticFingerprintSchema,
    candidateArtifactId: safeIdSchema.nullable(),
    candidateArtifactRole: candidateRoleSchema.nullable(),
    candidateFingerprint: sha256FingerprintSchema.nullable(),
    requestFingerprint: sha256FingerprintSchema,
    providerConfigFingerprint: sha256FingerprintSchema,
    providerConfig: CandidateGenerationProviderPublicConfigV1Schema,
    providerRequestId: providerRequestIdSchema,
    status: CandidateGenerationStatusSchema,
    diagnosticCode: CandidateGenerationDiagnosticCodeSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    attempts: z.array(CandidateGenerationAttemptV1Schema).max(CANDIDATE_GENERATION_MAX_ATTEMPTS),
    usage: CandidateGenerationTokenUsageV1Schema.nullable(),
    pricing: CandidateGenerationPricingV1Schema,
    candidateCounts: CandidateGenerationCandidateCountsV1Schema,
  })
  .superRefine((value, context) => {
    if (value.completedAt < value.startedAt) {
      context.addIssue({ code: "custom", message: "Generation completion precedes start." });
    }
    for (let index = 0; index < value.attempts.length; index += 1) {
      if (value.attempts[index]?.attemptNumber !== index + 1) {
        context.addIssue({ code: "custom", message: "Generation attempts are not sequential." });
        break;
      }
    }
    if (value.attempts.length > value.providerConfig.retryPolicy.maxAttempts) {
      context.addIssue({ code: "custom", message: "Generation exceeds its retry policy." });
    }
    const hasCandidate =
      value.candidateArtifactId !== null &&
      value.candidateArtifactRole !== null &&
      value.candidateFingerprint !== null;
    if (
      (value.candidateArtifactId === null) !== (value.candidateArtifactRole === null) ||
      (value.candidateArtifactId === null) !== (value.candidateFingerprint === null)
    ) {
      context.addIssue({ code: "custom", message: "Candidate artifact identity is incomplete." });
    }
    if (value.status === "succeeded") {
      if (!hasCandidate || value.diagnosticCode !== "completed" || value.attempts.length < 1) {
        context.addIssue({ code: "custom", message: "Successful generation is incomplete." });
      }
      if (value.attempts.at(-1)?.outcome !== "completed") {
        context.addIssue({
          code: "custom",
          message: "Successful generation has no completed attempt.",
        });
      }
    } else {
      if (hasCandidate || value.candidateCounts.total !== 0 || value.usage !== null) {
        context.addIssue({
          code: "custom",
          message: "Failed generation contains successful output.",
        });
      }
      if (value.diagnosticCode === "completed") {
        context.addIssue({
          code: "custom",
          message: "Failed generation uses completed diagnostic.",
        });
      }
    }
    const allowedDiagnostics: Readonly<
      Record<CandidateGenerationStatus, readonly CandidateGenerationDiagnosticCode[]>
    > = {
      succeeded: ["completed"],
      aborted: ["aborted"],
      transport_failed: ["http_transient_exhausted", "transport_timeout", "transport_error"],
      provider_rejected: ["http_permanent_failure", "provider_refusal"],
      invalid_response: [
        "invalid_content_type",
        "invalid_provider_envelope",
        "provider_incomplete",
        "candidate_product_limit_exceeded",
        "invalid_candidate_batch",
        "response_too_large",
      ],
    };
    if (!allowedDiagnostics[value.status].includes(value.diagnosticCode)) {
      context.addIssue({ code: "custom", message: "Generation status and diagnostic differ." });
    }
    if (value.providerConfigFingerprint === value.requestFingerprint) {
      context.addIssue({
        code: "custom",
        message: "Generation fingerprints are not domain-separated.",
      });
    }
  });
export type CandidateGenerationRecordV1 = z.infer<typeof CandidateGenerationRecordV1Schema>;

export const CANDIDATE_GENERATION_RESULT_OUTCOMES = [
  "disabled",
  "unavailable",
  "succeeded",
  "failed",
] as const;
export const CandidateGenerationResultOutcomeSchema = z.enum(CANDIDATE_GENERATION_RESULT_OUTCOMES);
export type CandidateGenerationResultOutcome = z.infer<
  typeof CandidateGenerationResultOutcomeSchema
>;

export const CandidateGenerationResultV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CANDIDATE_GENERATION_SCHEMA_VERSION),
    generatorVersion: z.literal(CANDIDATE_GENERATOR_VERSION),
    promptTemplateVersion: z.literal(CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION),
    responseSchemaVersion: z.literal(CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION),
    targetCandidateMomentSchemaVersion: z.literal(CANDIDATE_MOMENT_SCHEMA_VERSION),
    runId: safeIdSchema,
    outcome: CandidateGenerationResultOutcomeSchema,
    diagnosticCode: CandidateGenerationDiagnosticCodeSchema,
    generationId: generationIdSchema.nullable(),
    generationKey: generationKeySchema.nullable(),
    semanticInputArtifactId: safeIdSchema.nullable(),
    candidateArtifactId: safeIdSchema.nullable(),
    requestFingerprint: sha256FingerprintSchema.nullable(),
    candidateFingerprint: sha256FingerprintSchema.nullable(),
    providerFamily: CandidateGenerationProviderFamilySchema.nullable(),
    modelId: safeModelSchema.nullable(),
    modelRevision: safeModelSchema.nullable(),
    candidateCounts: CandidateGenerationCandidateCountsV1Schema,
    attemptCount: z.number().int().min(0).max(CANDIDATE_GENERATION_MAX_ATTEMPTS),
    usage: CandidateGenerationTokenUsageV1Schema.nullable(),
    pricing: CandidateGenerationPricingV1Schema,
  })
  .superRefine((value, context) => {
    const hasGeneration = value.generationId !== null;
    const hasProvider = value.providerFamily !== null && value.modelId !== null;
    if ((value.providerFamily === null) !== (value.modelId === null)) {
      context.addIssue({ code: "custom", message: "Result provider identity is incomplete." });
    }
    if (value.outcome === "disabled" || value.outcome === "unavailable") {
      if (
        hasGeneration ||
        value.generationKey !== null ||
        value.semanticInputArtifactId !== null ||
        value.candidateArtifactId !== null ||
        value.requestFingerprint !== null ||
        value.candidateFingerprint !== null ||
        hasProvider ||
        value.modelRevision !== null ||
        value.candidateCounts.total !== 0 ||
        value.attemptCount !== 0 ||
        value.usage !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Non-generated result leaks generation state.",
        });
      }
    } else {
      if (
        !hasGeneration ||
        value.generationKey === null ||
        value.semanticInputArtifactId === null ||
        value.requestFingerprint === null ||
        !hasProvider
      ) {
        context.addIssue({ code: "custom", message: "Generated result is incomplete." });
      }
    }
    if (value.outcome === "disabled" && value.diagnosticCode !== "disabled") {
      context.addIssue({ code: "custom", message: "Disabled result diagnostic is invalid." });
    }
    if (value.outcome === "unavailable" && value.diagnosticCode !== "semantic_input_unavailable") {
      context.addIssue({ code: "custom", message: "Unavailable result diagnostic is invalid." });
    }
    if (
      (value.outcome === "disabled" || value.outcome === "unavailable") &&
      value.pricing.status !== "unavailable"
    ) {
      context.addIssue({ code: "custom", message: "Non-generated result cannot contain pricing." });
    }
    if (value.outcome === "succeeded") {
      if (
        value.diagnosticCode !== "completed" ||
        value.candidateArtifactId === null ||
        value.candidateFingerprint === null ||
        value.attemptCount < 1
      ) {
        context.addIssue({ code: "custom", message: "Successful result is incomplete." });
      }
    }
    if (value.outcome === "failed") {
      if (
        value.candidateArtifactId !== null ||
        value.candidateFingerprint !== null ||
        value.candidateCounts.total !== 0 ||
        value.usage !== null
      ) {
        context.addIssue({ code: "custom", message: "Failed result contains successful output." });
      }
    }
  });
export type CandidateGenerationResultV1 = z.infer<typeof CandidateGenerationResultV1Schema>;
