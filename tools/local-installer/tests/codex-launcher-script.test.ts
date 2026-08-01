import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("installed Codex Hook launcher", () => {
  it("is stable, silent, fail-open, and secret-free", async () => {
    const value = await readFile(
      resolve("tools/local-installer/scripts/installed-ownloop-codex-hook.cmd"),
      "utf8",
    );
    expect(value).toContain("installer\\dist\\codex-hook-main.js");
    expect(value).toContain(">nul 2>&1");
    expect(value).toContain("exit /b 0");
    expect(value).not.toContain("OWNLOOP_INSTALLATION_TOKEN");
    expect(value).not.toContain("secrets-v1.json");
  });
});
