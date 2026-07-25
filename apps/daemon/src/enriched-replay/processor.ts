import type { EnrichedBuildReplayV1 } from "@ownloop/contracts";

import { readValidatedRunEvidenceGraph } from "../evidence-graph/index.js";
import { readMomentInteractionState } from "../moment-interactions/index.js";
import {
  type OwnershipMomentsDependencies,
  projectRunOwnershipMoments,
} from "../ownership-moments/index.js";
import { PersistenceError } from "../persistence/index.js";
import { projectRawRunReplay } from "../replay/index.js";
import { prepareEnrichedBuildReplay } from "./builder.js";

export type EnrichedBuildReplayDependencies = OwnershipMomentsDependencies;

export async function projectEnrichedBuildReplay(
  dependencies: EnrichedBuildReplayDependencies,
  runId: string,
): Promise<EnrichedBuildReplayV1 | null> {
  const run = dependencies.persistence.taskRuns.get(runId);
  if (run === null) return null;

  if (run.status === "Capturing" || run.status === "Finalizing") {
    const rawReplay = projectRawRunReplay(dependencies.persistence, runId, null);
    if (rawReplay === null) return null;
    return prepareEnrichedBuildReplay({
      rawReplay,
      momentProjection: null,
      interactionState: null,
      graphEvidenceIds: new Set(),
    });
  }

  const graph = await readValidatedRunEvidenceGraph(dependencies, runId);
  if (graph === null) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "The enriched Build Replay Evidence Graph is unavailable.",
    );
  }
  const rawReplay = projectRawRunReplay(dependencies.persistence, runId, graph);
  if (rawReplay === null) return null;
  const moments = await projectRunOwnershipMoments(dependencies, runId);
  if (moments === null) return null;
  const interactions =
    moments.validationId === null
      ? null
      : await readMomentInteractionState(dependencies, runId, moments.validationId);
  return prepareEnrichedBuildReplay({
    rawReplay,
    momentProjection: moments,
    interactionState: interactions,
    graphEvidenceIds: new Set(graph.value.nodes.map((node) => node.evidenceId)),
  });
}
