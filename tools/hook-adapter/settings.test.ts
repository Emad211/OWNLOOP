import { readFile } from "node:fs/promises";

import { SUPPORTED_CLAUDE_HOOK_NAMES } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

const SETTINGS_PATH = new URL("./examples/claude-settings.json", import.meta.url);
const PROJECT_ADAPTER_PATH = ["$", "{CLAUDE_PROJECT_DIR}/tools/hook-adapter/dist/index.js"].join(
  "",
);

describe("Claude settings example", () => {
  it("is secret-free exec-form configuration for exactly nine Hooks", async () => {
    const text = await readFile(SETTINGS_PATH, "utf8");
    const settings = JSON.parse(text) as {
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>>; matcher?: unknown }>>;
    };

    expect(Object.keys(settings.hooks).sort()).toEqual([...SUPPORTED_CLAUDE_HOOK_NAMES].sort());
    expect(text).not.toMatch(/OWNLOOP_INSTALLATION_TOKEN|Bearer\s|fixture-secret|43210/);
    for (const hookName of SUPPORTED_CLAUDE_HOOK_NAMES) {
      const groups = settings.hooks[hookName];
      expect(groups).toHaveLength(1);
      expect(groups?.[0]).not.toHaveProperty("matcher");
      expect(groups?.[0]?.hooks).toEqual([
        {
          type: "command",
          command: "node",
          args: [PROJECT_ADAPTER_PATH],
          timeout: 2,
        },
      ]);
    }
  });
});
