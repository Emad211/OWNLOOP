import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnrichedBuildReplayDependencies } from "./processor.js";

const readGraph = vi.fn();
const readInteractions = vi.fn();
const projectMoments = vi.fn();
const projectRaw = vi.fn();
const prepare = vi.fn();

vi.mock("../evidence-graph/index.js", () => ({ readValidatedRunEvidenceGraph: readGraph }));
vi.mock("../moment-interactions/index.js", () => ({
  readMomentInteractionState: readInteractions,
}));
vi.mock("../ownership-moments/index.js", () => ({ projectRunOwnershipMoments: projectMoments }));
vi.mock("../replay/index.js", () => ({ projectRawRunReplay: projectRaw }));
vi.mock("./builder.js", () => ({ prepareEnrichedBuildReplay: prepare }));

const activeRaw = { run: { runId: "run-1", status: "Capturing" } };
const terminalRaw = { run: { runId: "run-1", status: "Completed" } };
const output = { ok: true, runId: "run-1" };

function dependencies(status: "Capturing" | "Completed"): EnrichedBuildReplayDependencies {
  return {
    persistence: {
      taskRuns: { get: vi.fn(() => ({ runId: "run-1", status })) },
    },
  } as unknown as EnrichedBuildReplayDependencies;
}

describe("enriched Build Replay processor read boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepare.mockReturnValue(output);
  });

  it("returns active Runs before Graph, Moment, or interaction reads", async () => {
    projectRaw.mockReturnValue(activeRaw);
    const { projectEnrichedBuildReplay } = await import("./processor.js");
    await expect(projectEnrichedBuildReplay(dependencies("Capturing"), "run-1")).resolves.toBe(
      output,
    );
    expect(projectRaw).toHaveBeenCalledOnce();
    expect(readGraph).not.toHaveBeenCalled();
    expect(projectMoments).not.toHaveBeenCalled();
    expect(readInteractions).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith({
      rawReplay: activeRaw,
      momentProjection: null,
      interactionState: null,
      graphEvidenceIds: new Set(),
    });
  });

  it("does not read interaction state when current Moments are unavailable", async () => {
    const graph = {
      value: { nodes: [{ evidenceId: "ev_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] },
    };
    readGraph.mockResolvedValue(graph);
    projectRaw.mockReturnValue(terminalRaw);
    projectMoments.mockResolvedValue({ runId: "run-1", validationId: null });
    const { projectEnrichedBuildReplay } = await import("./processor.js");
    await projectEnrichedBuildReplay(dependencies("Completed"), "run-1");
    expect(readGraph).toHaveBeenCalledOnce();
    expect(projectMoments).toHaveBeenCalledOnce();
    expect(readInteractions).not.toHaveBeenCalled();
  });

  it("reads exact interaction state only for the selected validation", async () => {
    const graph = { value: { nodes: [] } };
    const moments = {
      runId: "run-1",
      validationId: "val_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const interactions = { validationId: moments.validationId };
    readGraph.mockResolvedValue(graph);
    projectRaw.mockReturnValue(terminalRaw);
    projectMoments.mockResolvedValue(moments);
    readInteractions.mockResolvedValue(interactions);
    const { projectEnrichedBuildReplay } = await import("./processor.js");
    await projectEnrichedBuildReplay(dependencies("Completed"), "run-1");
    expect(readInteractions).toHaveBeenCalledWith(expect.anything(), "run-1", moments.validationId);
  });
});
