import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildWindowsReleasePackage, readAndVerifyReleasePackage } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "ownloop-package-builder-repo-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "ownloop-package-builder-output-"));
  roots.push(repositoryRoot, outputRoot);
  await mkdir(join(repositoryRoot, "apps", "web", "dist"), { recursive: true });
  await mkdir(join(repositoryRoot, "tools", "local-installer", "scripts"), { recursive: true });
  await writeFile(join(repositoryRoot, "apps", "web", "dist", "index.html"), "<!doctype html>\n");
  const packageFixtures = [
    [
      "apps/daemon/package.json",
      {
        name: "@ownloop/daemon",
        version: "0.1.0",
        private: true,
        type: "module",
        files: ["dist"],
        bin: { "ownloop-daemon": "./dist/main.js" },
        scripts: { build: "tsc" },
        dependencies: { "@ownloop/contracts": "workspace:*", fastify: "5.10.0" },
      },
    ],
    [
      "tools/hook-adapter/package.json",
      {
        name: "@ownloop/hook-adapter",
        version: "0.1.0",
        private: true,
        type: "module",
        files: ["dist"],
        bin: { "ownloop-hook-adapter": "./dist/index.js" },
        dependencies: { "@ownloop/contracts": "workspace:*" },
        devDependencies: { "@ownloop/test-fixtures": "workspace:*" },
      },
    ],
    [
      "tools/local-installer/package.json",
      {
        name: "@ownloop/local-installer",
        version: "0.1.0",
        private: true,
        type: "module",
        files: ["scripts", "dist"],
        bin: { "ownloop-package": "./dist/build-package.js" },
        dependencies: { "@ownloop/contracts": "workspace:*" },
      },
    ],
  ] as const;
  for (const [relativePath, value] of packageFixtures) {
    const path = join(repositoryRoot, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify(value)}\n`);
  }
  for (const name of [
    "ownloop.ps1",
    "ownloop.cmd",
    "installed-ownloop.cmd",
    "installed-ownloop-hook.cmd",
  ]) {
    await writeFile(join(repositoryRoot, "tools", "local-installer", "scripts", name), `${name}\n`);
  }
  return { repositoryRoot, outputRoot };
}

function runner(
  options: Readonly<{ forbidden?: boolean; unexpectedVirtualStoreEntry?: boolean }> = {},
) {
  return vi.fn(async (_executable: string, args: readonly string[]) => {
    if (args[0] === "--version") return { stdout: "11.4.0\n", stderr: "" };
    if (args[0] === "build") return { stdout: "", stderr: "" };
    const destination = args.at(-1)!;
    await mkdir(join(destination, "dist"), { recursive: true });
    const nodeModulesRoot = join(destination, "node_modules");
    await mkdir(join(nodeModulesRoot, ".bin"), { recursive: true });
    await writeFile(join(nodeModulesRoot, ".bin", "unused-runtime-bin"), "shim\n");
    await writeFile(join(destination, "pnpm-lock.yaml"), `root: ${destination}\n`);
    await writeFile(join(nodeModulesRoot, ".modules.yaml"), `storeDir: ${destination}\n`);
    await writeFile(
      join(nodeModulesRoot, ".pnpm-workspace-state-v1.json"),
      `${JSON.stringify({ lastValidatedTimestamp: Date.now(), root: destination })}\n`,
    );
    await mkdir(join(nodeModulesRoot, ".pnpm"), { recursive: true });
    await writeFile(join(nodeModulesRoot, ".pnpm", "lock.yaml"), `root: ${destination}\n`);
    if (options.unexpectedVirtualStoreEntry) {
      await writeFile(join(nodeModulesRoot, ".pnpm", "runtime.js"), "unexpected\n");
    }
    const filterIndex = args.indexOf("--filter");
    const workspace = args[filterIndex + 1];
    await writeFile(
      join(destination, "package.json"),
      `${JSON.stringify({
        name: workspace,
        version: "0.1.0",
        dependencies: {
          "@ownloop/contracts": `@ownloop/contracts@file://${destination}/contracts`,
        },
      })}\n`,
    );
    if (workspace === "@ownloop/daemon")
      await writeFile(join(destination, "dist", "main.js"), "daemon\n");
    if (workspace === "@ownloop/hook-adapter")
      await writeFile(join(destination, "dist", "index.js"), "hook\n");
    if (workspace === "@ownloop/local-installer") {
      await writeFile(join(destination, "dist", "cli.js"), "cli\n");
      await writeFile(join(destination, "dist", "hook-main.js"), "hook main\n");
      if (options.forbidden) await writeFile(join(destination, "dist", ".env"), "SECRET=x\n");
    }
    return { stdout: "", stderr: "" };
  });
}

describe("Windows package builder", () => {
  it("runs exact offline deploys and produces a verified deterministic package", async () => {
    const firstFixture = await fixture();
    const firstRunner = runner();
    const first = await buildWindowsReleasePackage({
      ...firstFixture,
      runner: firstRunner,
      nodeVersion: "24.18.0",
    });
    const verified = await readAndVerifyReleasePackage(first.packageRoot);
    expect(verified.fingerprint).toBe(first.fingerprint);
    expect(first.packageRoot.endsWith("ownloop-windows-0.1.0")).toBe(true);
    expect(
      verified.files.some((file) => file.path === "daemon/dist/main.js" && file.executableCritical),
    ).toBe(true);
    expect(await readFile(join(first.packageRoot, "web", "index.html"), "utf8")).toContain(
      "doctype",
    );
    const deployCalls = firstRunner.mock.calls.filter(([, args]) => args.includes("deploy"));
    expect(deployCalls).toHaveLength(3);
    for (const [, args] of deployCalls) {
      expect(args).toEqual(
        expect.arrayContaining([
          "--config.node-linker=hoisted",
          "--config.inject-workspace-packages=true",
          "deploy",
          "--prod",
          "--offline",
        ]),
      );
      expect(args).not.toContain("--legacy");
    }
    const daemonPackage = JSON.parse(
      await readFile(join(first.packageRoot, "daemon", "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(daemonPackage).toEqual({
      name: "@ownloop/daemon",
      version: "0.1.0",
      private: true,
      type: "module",
      files: ["dist"],
      bin: { "ownloop-daemon": "./dist/main.js" },
      dependencies: { "@ownloop/contracts": "0.1.0", fastify: "5.10.0" },
    });
    expect(JSON.stringify(daemonPackage)).not.toContain(firstFixture.repositoryRoot);
    expect(JSON.stringify(daemonPackage)).not.toContain(firstFixture.outputRoot);
    const hookPackage = JSON.parse(
      await readFile(join(first.packageRoot, "hook-adapter", "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hookPackage).not.toHaveProperty("devDependencies");
    expect(hookPackage).not.toHaveProperty("scripts");

    for (const path of [
      join(first.packageRoot, "daemon", "pnpm-lock.yaml"),
      join(first.packageRoot, "daemon", "node_modules", ".bin"),
      join(first.packageRoot, "daemon", "node_modules", ".modules.yaml"),
      join(first.packageRoot, "daemon", "node_modules", ".pnpm-workspace-state-v1.json"),
      join(first.packageRoot, "daemon", "node_modules", ".pnpm"),
    ]) {
      expect(await lstat(path).catch(() => null)).toBeNull();
    }

    const secondFixture = await fixture();
    const second = await buildWindowsReleasePackage({
      ...secondFixture,
      runner: runner(),
      nodeVersion: "24.18.0",
    });
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("cleans staging and rejects credentials or developer environment files", async () => {
    const setup = await fixture();
    await expect(
      buildWindowsReleasePackage({
        ...setup,
        runner: runner({ forbidden: true }),
        nodeVersion: "24.18.0",
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "forbidden_file" }));
    expect(await readdir(setup.outputRoot)).toEqual([]);
  });

  it("rejects unexpected content in the generated virtual-store metadata directory", async () => {
    const setup = await fixture();
    await expect(
      buildWindowsReleasePackage({
        ...setup,
        runner: runner({ unexpectedVirtualStoreEntry: true }),
        nodeVersion: "24.18.0",
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "forbidden_file" }));
    expect(await readdir(setup.outputRoot)).toEqual([]);
  });

  it("rejects non-exact external dependency specifiers in source package metadata", async () => {
    const setup = await fixture();
    const packagePath = join(setup.repositoryRoot, "apps", "daemon", "package.json");
    const source = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
    source.dependencies = { "@ownloop/contracts": "workspace:*", fastify: "file:///tmp/fastify" };
    await writeFile(packagePath, `${JSON.stringify(source)}\n`);
    await expect(
      buildWindowsReleasePackage({ ...setup, runner: runner(), nodeVersion: "24.18.0" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "forbidden_file" }));
    expect(await readdir(setup.outputRoot)).toEqual([]);
  });

  it("fails before build under the wrong Node or pnpm version", async () => {
    const setup = await fixture();
    await expect(
      buildWindowsReleasePackage({ ...setup, runner: runner(), nodeVersion: "24.17.0" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "runtime_incompatible" }));
    const wrongPnpm = vi.fn(async () => ({ stdout: "10.0.0\n", stderr: "" }));
    await expect(
      buildWindowsReleasePackage({ ...setup, runner: wrongPnpm, nodeVersion: "24.18.0" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "runtime_incompatible" }));
  });
});
