import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolvePackageBuildInvocation } from "../src/index.js";

describe("Windows package command", () => {
  it("bootstraps the compiled package builder and its workspace dependencies", async () => {
    const rootPackage = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as Readonly<{ scripts?: Readonly<Record<string, string>> }>;

    expect(rootPackage.scripts?.["package:windows"]).toBe(
      "pnpm --filter @ownloop/local-installer... run build && node tools/local-installer/dist/build-package.js",
    );
  });

  it("invokes the pnpm JavaScript entrypoint through Node on Windows", () => {
    expect(
      resolvePackageBuildInvocation("pnpm", ["--version"], {
        platform: "win32",
        environment: { npm_execpath: "/pnpm/bin/pnpm.cjs" },
        nodeExecutable: "/node/node.exe",
      }),
    ).toEqual({
      executable: "/node/node.exe",
      args: ["/pnpm/bin/pnpm.cjs", "--version"],
    });
  });

  it("fails closed when Windows has no absolute pnpm JavaScript entrypoint", () => {
    expect(() =>
      resolvePackageBuildInvocation("pnpm", ["build"], {
        platform: "win32",
        environment: {},
        nodeExecutable: "/node/node.exe",
      }),
    ).toThrowError(expect.objectContaining({ code: "runtime_incompatible" }));
  });
});
