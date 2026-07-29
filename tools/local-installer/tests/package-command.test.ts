import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Windows package command", () => {
  it("bootstraps the compiled package builder and its workspace dependencies", async () => {
    const rootPackage = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as Readonly<{ scripts?: Readonly<Record<string, string>> }>;

    expect(rootPackage.scripts?.["package:windows"]).toBe(
      "pnpm --filter @ownloop/local-installer... run build && node tools/local-installer/dist/build-package.js",
    );
  });
});
