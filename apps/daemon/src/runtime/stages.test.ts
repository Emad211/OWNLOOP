import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalArtifactStore } from "../artifact-store/index.js";
import type { CandidateGenerationTransport } from "../candidate-generation/index.js";
import { LocalSettingsService } from "../local-settings/index.js";
import { openPersistence } from "../persistence/index.js";
import { createProductionRuntimeStages } from "./stages.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

describe("production runtime stages", () => {
  it("performs zero provider transport calls while provider generation is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-stages-"));
    roots.push(root);
    const persistence = openPersistence(":memory:");
    try {
      const artifactStore = await createLocalArtifactStore({
        artifactRoot: join(root, "artifacts"),
        persistence,
      });
      const settings = new LocalSettingsService({ persistence, artifactStore });
      const transport = vi.fn<CandidateGenerationTransport>(async () => {
        throw new Error("Provider transport must not run while disabled.");
      });
      const stages = createProductionRuntimeStages({
        persistence,
        artifactStore,
        settings,
        transport,
      });

      await expect(
        Promise.resolve(stages.semantic_input({ signal: new AbortController().signal })),
      ).resolves.toEqual([]);
      await expect(
        Promise.resolve(stages.candidate_generation({ signal: new AbortController().signal })),
      ).resolves.toEqual([]);
      await expect(
        Promise.resolve(stages.candidate_validation({ signal: new AbortController().signal })),
      ).resolves.toEqual([]);
      expect(transport).not.toHaveBeenCalled();
      expect(settings.candidateGenerationOptions()).toEqual({ enabled: false });
    } finally {
      persistence.close();
    }
  });
});
