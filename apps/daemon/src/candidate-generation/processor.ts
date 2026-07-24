import { randomBytes } from "node:crypto";

import {
  CANDIDATE_GENERATION_PRICING_POLICY_VERSION,
  CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
  CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
  CANDIDATE_GENERATION_SCHEMA_VERSION,
  CANDIDATE_GENERATOR_VERSION,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  type CandidateGenerationCandidateCountsV1,
  CandidateGenerationRecordV1Schema,
  type CandidateGenerationRecordV1,
  CandidateGenerationResultV1Schema,
  type CandidateGenerationResultV1,
} from "@ownloop/contracts";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import { type OwnLoopPersistence, PersistenceError } from "../persistence/index.js";
import {
  readValidatedRunSemanticAnalysisInput,
  type SemanticAnalysisInputDependencies,
} from "../semantic-input/index.js";
import {
  generateCandidateBatchWithResponsesAdapter,
  type CandidateGenerationAdapterDependencies,
} from "./adapter.js";
import {
  type canonicalCandidateMomentBatch,
  parseCanonicalCandidateMomentBatch,
} from "./artifact.js";
import {
  CANDIDATE_GENERATION_ARTIFACT_KIND,
  CANDIDATE_GENERATION_ARTIFACT_MEDIA_TYPE,
  CANDIDATE_GENERATION_ARTIFACT_ROLE_PREFIX,
  CANDIDATE_GENERATION_ARTIFACT_SENSITIVITY,
  CANDIDATE_GENERATION_MAX_BATCH_RUNS,
} from "./constants.js";
import {
  type CandidateGenerationProviderOptions,
  prepareCandidateGenerationRequest,
  prepareCandidateGenerationRequestIdentity,
} from "./request.js";

const ZERO_COUNTS: CandidateGenerationCandidateCountsV1 = Object.freeze({
  total: 0,
  change: 0,
  decision: 0,
  risk: 0,
  check: 0,
});
const UNAVAILABLE_PRICING = Object.freeze({
  status: "unavailable" as const,
  amountMinorUnits: null,
  currency: null,
  pricingTableId: null,
  pricingTableVersion: null,
  calculationPolicyVersion: CANDIDATE_GENERATION_PRICING_POLICY_VERSION,
});

export type CandidateGenerationDependencies = SemanticAnalysisInputDependencies &
  CandidateGenerationAdapterDependencies &
  Readonly<{
    persistence: OwnLoopPersistence;
    artifactStore: LocalArtifactStore;
    generationIdGenerator?: () => string;
  }>;

export type CandidateGenerationOptions =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      provider: CandidateGenerationProviderOptions;
      signal?: AbortSignal;
    }>;

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new PersistenceError("operation_failed", "The Candidate generation clock is invalid.");
  }
  return value.toISOString();
}

function generationId(generator?: () => string): string {
  const value = generator?.() ?? `gen_${randomBytes(24).toString("hex")}`;
  if (!/^gen_[0-9a-f]{48}$/u.test(value)) {
    throw new PersistenceError("operation_failed", "The Candidate generation ID is invalid.");
  }
  return value;
}

function counts(
  value: ReturnType<typeof canonicalCandidateMomentBatch>["value"],
): CandidateGenerationCandidateCountsV1 {
  const result = { total: value.candidates.length, change: 0, decision: 0, risk: 0, check: 0 };
  for (const candidate of value.candidates) result[candidate.type] += 1;
  return result;
}

function candidateRole(id: string): string {
  return `${CANDIDATE_GENERATION_ARTIFACT_ROLE_PREFIX}.${id}`;
}

function safeResult(record: CandidateGenerationRecordV1): CandidateGenerationResultV1 {
  return CandidateGenerationResultV1Schema.parse({
    schemaVersion: record.schemaVersion,
    generatorVersion: record.generatorVersion,
    promptTemplateVersion: record.promptTemplateVersion,
    responseSchemaVersion: record.responseSchemaVersion,
    targetCandidateMomentSchemaVersion: record.targetCandidateMomentSchemaVersion,
    runId: record.runId,
    outcome: record.status === "succeeded" ? "succeeded" : "failed",
    diagnosticCode: record.diagnosticCode,
    generationId: record.generationId,
    generationKey: record.generationKey,
    semanticInputArtifactId: record.semanticInputArtifactId,
    candidateArtifactId: record.candidateArtifactId,
    requestFingerprint: record.requestFingerprint,
    candidateFingerprint: record.candidateFingerprint,
    providerFamily: record.providerConfig.providerFamily,
    modelId: record.providerConfig.modelId,
    modelRevision: record.providerConfig.modelRevision,
    candidateCounts: record.candidateCounts,
    attemptCount: record.attempts.length,
    usage: record.usage,
    pricing: record.pricing,
  });
}

function disabled(runId: string): CandidateGenerationResultV1 {
  return CandidateGenerationResultV1Schema.parse({
    schemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
    generatorVersion: CANDIDATE_GENERATOR_VERSION,
    promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
    responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
    targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    runId,
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
    candidateCounts: ZERO_COUNTS,
    attemptCount: 0,
    usage: null,
    pricing: UNAVAILABLE_PRICING,
  });
}

function unavailable(runId: string): CandidateGenerationResultV1 {
  return CandidateGenerationResultV1Schema.parse({
    ...disabled(runId),
    outcome: "unavailable",
    diagnosticCode: "semantic_input_unavailable",
  });
}

export async function readValidatedCandidateGeneration(
  dependencies: CandidateGenerationDependencies,
  generationIdValue: string,
): Promise<Readonly<{
  record: CandidateGenerationRecordV1;
  result: CandidateGenerationResultV1;
}> | null> {
  const record = dependencies.persistence.candidateGenerations.get(generationIdValue);
  if (record === null) return null;
  const semantic = await readValidatedRunSemanticAnalysisInput(dependencies, record.runId);
  if (
    semantic === null ||
    semantic.artifactId !== record.semanticInputArtifactId ||
    semantic.value.inputFingerprint !== record.semanticInputFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate generation semantic source differs.",
    );
  }
  const finalization = dependencies.persistence.runFinalizations.getByRun(record.runId);
  if (finalization === null || finalization.finalizationId !== record.finalizationId) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate generation finalization differs.",
    );
  }
  const identity = prepareCandidateGenerationRequestIdentity({
    semanticInputArtifactId: semantic.artifactId,
    semanticInput: semantic.value,
    providerConfig: record.providerConfig,
  });
  if (
    identity.generationKey !== record.generationKey ||
    identity.requestFingerprint !== record.requestFingerprint ||
    identity.providerConfigFingerprint !== record.providerConfigFingerprint
  ) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The Candidate generation request identity differs.",
    );
  }
  if (record.status === "succeeded") {
    if (
      record.candidateArtifactId === null ||
      record.candidateArtifactRole === null ||
      record.candidateFingerprint === null
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The successful Candidate generation is incomplete.",
      );
    }
    const artifact = dependencies.persistence.artifacts.getRecordForRunRole(
      record.runId,
      record.candidateArtifactRole,
    );
    if (
      artifact === null ||
      artifact.artifact.artifactId !== record.candidateArtifactId ||
      artifact.artifact.storageVersion !== 1 ||
      artifact.artifact.kind !== CANDIDATE_GENERATION_ARTIFACT_KIND ||
      artifact.artifact.mediaType !== CANDIDATE_GENERATION_ARTIFACT_MEDIA_TYPE ||
      artifact.artifact.sensitivity !== CANDIDATE_GENERATION_ARTIFACT_SENSITIVITY
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Candidate generation artifact metadata differs.",
      );
    }
    const content = await dependencies.artifactStore.readPreparedBytes(record.candidateArtifactId);
    if (
      content.artifactId !== record.candidateArtifactId ||
      content.kind !== CANDIDATE_GENERATION_ARTIFACT_KIND ||
      content.mediaType !== CANDIDATE_GENERATION_ARTIFACT_MEDIA_TYPE ||
      content.sensitivity !== CANDIDATE_GENERATION_ARTIFACT_SENSITIVITY ||
      content.sizeBytes !== artifact.artifact.sizeBytes
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Candidate batch read metadata differs.",
      );
    }
    const candidate = parseCanonicalCandidateMomentBatch(content.bytes);
    const expectedCounts = counts(candidate.value);
    if (
      candidate.fingerprint !== record.candidateFingerprint ||
      JSON.stringify(expectedCounts) !== JSON.stringify(record.candidateCounts)
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "The Candidate generation artifact content differs.",
      );
    }
  }
  return { record, result: safeResult(record) };
}

export async function getCandidateGeneration(
  dependencies: CandidateGenerationDependencies,
  generationIdValue: string,
): Promise<CandidateGenerationResultV1 | null> {
  return (await readValidatedCandidateGeneration(dependencies, generationIdValue))?.result ?? null;
}

export async function getRunCandidateGenerations(
  dependencies: CandidateGenerationDependencies,
  runId: string,
  limit = 100,
): Promise<readonly CandidateGenerationResultV1[]> {
  const records = dependencies.persistence.candidateGenerations.listForRun(runId, limit);
  const results: CandidateGenerationResultV1[] = [];
  for (const record of records) {
    const validated = await readValidatedCandidateGeneration(dependencies, record.generationId);
    if (validated !== null) results.push(validated.result);
  }
  return results;
}

export async function generateFinalizedRunCandidateBatch(
  dependencies: CandidateGenerationDependencies,
  runId: string,
  options: CandidateGenerationOptions,
): Promise<CandidateGenerationResultV1> {
  if (!options.enabled) return disabled(runId);
  const semantic = await readValidatedRunSemanticAnalysisInput(dependencies, runId);
  if (semantic === null || semantic.value.outcome === "unavailable") return unavailable(runId);
  const request = prepareCandidateGenerationRequest({
    semanticInputArtifactId: semantic.artifactId,
    semanticInput: semantic.value,
    provider: options.provider,
  });
  const existing = dependencies.persistence.candidateGenerations.getSucceededByKey(
    request.generationKey,
  );
  if (existing !== null) {
    const validated = await readValidatedCandidateGeneration(dependencies, existing.generationId);
    if (validated === null)
      throw new PersistenceError("invalid_persisted_row", "The successful generation disappeared.");
    return validated.result;
  }
  const finalization = dependencies.persistence.runFinalizations.getByRun(runId);
  if (finalization === null) return unavailable(runId);
  const clock = dependencies.clock ?? (() => new Date());
  const startedAt = timestamp(clock);
  const adapter = await generateCandidateBatchWithResponsesAdapter(
    dependencies,
    request,
    options.provider,
    options.signal,
  );
  const completedAt = timestamp(clock);
  const id = generationId(dependencies.generationIdGenerator);
  const base = {
    schemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
    requestSchemaVersion: 1 as const,
    generatorVersion: CANDIDATE_GENERATOR_VERSION,
    promptTemplateVersion: CANDIDATE_GENERATION_PROMPT_TEMPLATE_VERSION,
    responseSchemaVersion: CANDIDATE_GENERATION_RESPONSE_SCHEMA_VERSION,
    targetCandidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    generationId: id,
    generationKey: request.generationKey,
    runId,
    finalizationId: finalization.finalizationId,
    semanticInputArtifactId: semantic.artifactId,
    semanticInputFingerprint: semantic.value.inputFingerprint,
    requestFingerprint: request.requestFingerprint,
    providerConfigFingerprint: request.providerConfigFingerprint,
    providerConfig: request.providerConfig,
    providerRequestId: adapter.providerRequestId,
    startedAt: adapter.attempts[0]?.startedAt ?? startedAt,
    completedAt: adapter.attempts.at(-1)?.completedAt ?? completedAt,
    attempts: adapter.attempts,
    pricing: UNAVAILABLE_PRICING,
  } as const;

  if (adapter.status !== "succeeded") {
    const record = CandidateGenerationRecordV1Schema.parse({
      ...base,
      candidateArtifactId: null,
      candidateArtifactRole: null,
      candidateFingerprint: null,
      status: adapter.status,
      diagnosticCode: adapter.diagnosticCode,
      usage: null,
      candidateCounts: ZERO_COUNTS,
    });
    try {
      dependencies.persistence.candidateGenerations.insert(record);
      return safeResult(record);
    } catch {
      return CandidateGenerationResultV1Schema.parse({
        ...safeResult(record),
        diagnosticCode: "persistence_failed",
      });
    }
  }

  const role = candidateRole(id);
  const candidateCounts = counts(adapter.candidateBatch.value);
  const materialized = await dependencies.artifactStore.putPreparedBytes({
    preparedBytes: adapter.candidateBatch.bytes,
    kind: CANDIDATE_GENERATION_ARTIFACT_KIND,
    mediaType: CANDIDATE_GENERATION_ARTIFACT_MEDIA_TYPE,
    sensitivity: CANDIDATE_GENERATION_ARTIFACT_SENSITIVITY,
  });
  const record = CandidateGenerationRecordV1Schema.parse({
    ...base,
    candidateArtifactId: materialized.artifactId,
    candidateArtifactRole: role,
    candidateFingerprint: adapter.candidateBatch.fingerprint,
    status: "succeeded",
    diagnosticCode: "completed",
    usage: adapter.usage,
    candidateCounts,
  });
  try {
    dependencies.persistence.withTransaction((repositories) => {
      repositories.candidateGenerations.insert(record);
      repositories.artifacts.linkToRun({
        runId,
        artifactId: materialized.artifactId,
        role,
        createdAt: record.completedAt,
      });
    });
  } catch (error) {
    const raced = dependencies.persistence.candidateGenerations.getSucceededByKey(
      request.generationKey,
    );
    if (raced !== null) {
      const validated = await readValidatedCandidateGeneration(dependencies, raced.generationId);
      if (validated !== null) return validated.result;
    }
    throw error;
  }
  const persisted = await readValidatedCandidateGeneration(dependencies, id);
  if (persisted === null) {
    throw new PersistenceError("operation_failed", "The Candidate generation was not persisted.");
  }
  return persisted.result;
}

export async function generateEligibleFinalizedRunCandidateBatches(
  dependencies: CandidateGenerationDependencies,
  options: CandidateGenerationOptions,
  limit = CANDIDATE_GENERATION_MAX_BATCH_RUNS,
): Promise<readonly CandidateGenerationResultV1[]> {
  if (!options.enabled) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > CANDIDATE_GENERATION_MAX_BATCH_RUNS) {
    return [];
  }
  const runIds = dependencies.persistence.candidateGenerations.listSemanticInputRunIds(limit);
  const results: CandidateGenerationResultV1[] = [];
  for (const runId of runIds) {
    const result = await generateFinalizedRunCandidateBatch(dependencies, runId, options);
    results.push(result);
    if (result.diagnosticCode === "aborted") break;
  }
  return results;
}
