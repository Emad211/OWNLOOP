import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PURE_CLASSIFIER_FILES = ["rules.ts", "engine.ts", "artifact.ts", "processor.ts"] as const;

describe("deterministic change classification policy", () => {
  it("keeps the classifier independent of filesystem, Git, network and process execution", async () => {
    for (const filename of PURE_CLASSIFIER_FILES) {
      const source = await readFile(new URL(filename, import.meta.url), "utf8");
      for (const forbidden of [
        'from "node:fs',
        'from "node:child_process',
        'from "node:http',
        'from "node:https',
        "fetch(",
        "spawn(",
        "exec(",
        "repositoryRoot",
        "headCommit",
        "workingTreeFingerprint",
        "pathIdentitySha256",
      ]) {
        expect(source, `${filename} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("does not introduce a second package or executable boundary", () => {
    expect(fileURLToPath(new URL("index.ts", import.meta.url))).toContain(
      "apps/daemon/src/change-classification/index.ts",
    );
  });
});
