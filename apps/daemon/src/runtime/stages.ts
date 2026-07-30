import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  createNodeHttpsCandidateGenerationTransport,
  generateEligibleFinalizedRunCandidateBatches,
  type CandidateGenerationTransport,
} from "../candidate-generation/index.js";
import { validateEligibleCandidateGenerations } from "../candidate-validation/index.js";
import { classifyEligibleFinalizedRuns } from "../change-classification/index.js";
import { buildEligibleFinalizedRunEvidenceGraphs } from "../evidence-graph/index.js";
import { finalizeEligibleRuns } from "../finalization/index.js";
import { captureMissingGitBaselines } from "../git-baseline/index.js";
import { reconcileEligibleGitTriggers } from "../git-reconciliation/index.js";
import { processPendingLifecycleReceipts } from "../lifecycle/index.js";
import type { LocalSettingsService } from "../local-settings/index.js";
import { processPendingEventNormalizations } from "../normalization/index.js";
import type { OwnLoopPersistence } from "../persistence/index.js";
import { prepareEligibleFinalizedRunSemanticAnalysisInputs } from "../semantic-input/index.js";
import { extractEligibleFinalizedRunVerificationEvidence } from "../verification-extraction/index.js";
import type { RuntimeStageOperations } from "./pump.js";

export type ProductionRuntimeStageDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  settings: LocalSettingsService;
  transport?: CandidateGenerationTransport;
  clock?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}>;

export function createProductionRuntimeStages(
  dependencies: ProductionRuntimeStageDependencies,
): RuntimeStageOperations {
  const transport = dependencies.transport ?? createNodeHttpsCandidateGenerationTransport();
  const common = {
    persistence: dependencies.persistence,
    artifactStore: dependencies.artifactStore,
  };
  return {
    lifecycle: () =>
      processPendingLifecycleReceipts({
        persistence: dependencies.persistence,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      }),
    normalization: () =>
      processPendingEventNormalizations({
        persistence: dependencies.persistence,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      }),
    baseline: () =>
      captureMissingGitBaselines({
        persistence: dependencies.persistence,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      }),
    reconciliation: () =>
      reconcileEligibleGitTriggers({
        persistence: dependencies.persistence,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      }),
    finalization: () =>
      finalizeEligibleRuns({
        ...common,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
      }),
    classification: () => classifyEligibleFinalizedRuns(common),
    verification: () => extractEligibleFinalizedRunVerificationEvidence(common),
    evidence_graph: () => buildEligibleFinalizedRunEvidenceGraphs(common),
    semantic_input: () => {
      const enabled = dependencies.settings.candidateGenerationOptions().enabled;
      return prepareEligibleFinalizedRunSemanticAnalysisInputs(common, { enabled });
    },
    candidate_generation: ({ signal }) => {
      const options = dependencies.settings.candidateGenerationOptions();
      if (!options.enabled) return [];
      return generateEligibleFinalizedRunCandidateBatches(
        {
          ...common,
          transport,
          ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
          ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
        },
        { ...options, signal },
      );
    },
    candidate_validation: () =>
      validateEligibleCandidateGenerations({
        ...common,
        transport,
        ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
        ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
      }),
  };
}
