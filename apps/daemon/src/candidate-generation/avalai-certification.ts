import type {
  CandidateGenerationAttemptV1,
  CandidateGenerationTokenUsageV1,
  DeterministicSemanticAnalysisInputV1,
} from "@ownloop/contracts";

import {
  generateCandidateBatchWithResponsesAdapter,
  type CandidateGenerationAdapterDependencies,
  type CandidateGenerationAdapterResult,
} from "./adapter.js";
import {
  createAvalAiCandidateGenerationProviderOptions,
  type AvalAiCandidateGenerationOptions,
  type AvalAiRegion,
} from "./avalai.js";
import { prepareCandidateGenerationRequest } from "./request.js";

export type AvalAiCertificationAttempt = Readonly<
  Pick<CandidateGenerationAttemptV1, "attemptNumber" | "outcome" | "httpStatus" | "retryDelayMs">
>;

export type AvalAiCertificationInput = Readonly<{
  semanticInputArtifactId: string;
  semanticInput: DeterministicSemanticAnalysisInputV1;
  provider: AvalAiCandidateGenerationOptions;
}>;

export type AvalAiCertificationResult = Readonly<{
  schemaVersion: 1;
  region: AvalAiRegion;
  status: CandidateGenerationAdapterResult["status"];
  diagnosticCode: CandidateGenerationAdapterResult["diagnosticCode"];
  requestFingerprint: string;
  providerConfigFingerprint: string;
  providerRequestId: string | null;
  candidateCount: number;
  candidateBatchFingerprint: string | null;
  usage: CandidateGenerationTokenUsageV1 | null;
  attempts: readonly AvalAiCertificationAttempt[];
}>;

function summarizeAttempts(
  attempts: readonly CandidateGenerationAttemptV1[],
): readonly AvalAiCertificationAttempt[] {
  return Object.freeze(
    attempts.map((item) =>
      Object.freeze({
        attemptNumber: item.attemptNumber,
        outcome: item.outcome,
        httpStatus: item.httpStatus,
        retryDelayMs: item.retryDelayMs,
      }),
    ),
  );
}

export async function certifyAvalAiCandidateGeneration(
  dependencies: CandidateGenerationAdapterDependencies,
  input: AvalAiCertificationInput,
  signal?: AbortSignal,
): Promise<AvalAiCertificationResult> {
  const region = input.provider.region ?? "iran";
  const provider = createAvalAiCandidateGenerationProviderOptions(input.provider);
  const request = prepareCandidateGenerationRequest({
    semanticInputArtifactId: input.semanticInputArtifactId,
    semanticInput: input.semanticInput,
    provider,
  });
  const result = await generateCandidateBatchWithResponsesAdapter(
    dependencies,
    request,
    provider,
    signal,
  );

  return Object.freeze({
    schemaVersion: 1,
    region,
    status: result.status,
    diagnosticCode: result.diagnosticCode,
    requestFingerprint: request.requestFingerprint,
    providerConfigFingerprint: request.providerConfigFingerprint,
    providerRequestId: result.providerRequestId,
    candidateCount: result.status === "succeeded" ? result.candidateBatch.value.candidates.length : 0,
    candidateBatchFingerprint:
      result.status === "succeeded" ? result.candidateBatch.fingerprint : null,
    usage: result.usage,
    attempts: summarizeAttempts(result.attempts),
  });
}
