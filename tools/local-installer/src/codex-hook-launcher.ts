import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import type { HookSpawnOptions } from "./hook-launcher.js";
import { readInstallManifest } from "./install-manifest.js";
import {
  probeInstalledRuntime,
  type RuntimeClientDependencies,
  type RuntimeClientPaths,
} from "./runtime-client.js";
import { readInstallationSecrets } from "./secrets.js";

const ADAPTER_ENTRY = "codex-hook-adapter/dist/index.js";

export type CodexHookLauncherPaths = RuntimeClientPaths &
  Readonly<{ stableCodexHookLauncherPath: string }>;

export type CodexHookSpawn = (
  executable: string,
  args: readonly string[],
  options: HookSpawnOptions,
) => Promise<void>;

async function defaultSpawn(
  executable: string,
  args: readonly string[],
  options: HookSpawnOptions,
): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, [...args], {
        ...options,
        stdio: ["inherit", "ignore", "ignore"],
      });
    } catch {
      resolvePromise();
      return;
    }
    child.once("error", () => resolvePromise());
    child.once("exit", () => resolvePromise());
  });
}

export async function launchInstalledCodexHookAdapter(
  paths: CodexHookLauncherPaths,
  dependencies: RuntimeClientDependencies & {
    spawnImplementation?: CodexHookSpawn;
    nodeExecutable?: string;
  } = {},
): Promise<"launched" | "skipped"> {
  try {
    const probe = await probeInstalledRuntime(paths, dependencies);
    if (probe.result !== "running" || probe.state === null || probe.status === null) {
      return "skipped";
    }
    const installation = await readInstallManifest(paths.installManifestPath);
    const codex = installation.codexHooks;
    if (
      codex === undefined ||
      codex.command !== CODEX_HOOK_LAUNCHER_BASENAME ||
      resolve(codex.commandWindows) !== resolve(paths.stableCodexHookLauncherPath)
    ) {
      return "skipped";
    }
    const secrets = await readInstallationSecrets(paths.secretsPath);
    if (secrets === null || secrets.installId !== installation.installId) return "skipped";
    const adapterEntry = resolve(paths.releaseRoot, ADAPTER_ENTRY);
    await (dependencies.spawnImplementation ?? defaultSpawn)(
      dependencies.nodeExecutable ?? process.execPath,
      [adapterEntry],
      {
        env: {
          ...process.env,
          OWNLOOP_INGRESS_PORT: String(probe.state.port),
          OWNLOOP_INSTALLATION_TOKEN: secrets.installationToken,
          OWNLOOP_CODEX_SOURCE_SURFACE: "cli",
        },
        windowsHide: true,
        stdio: ["inherit", "ignore", "ignore"],
      },
    );
    return "launched";
  } catch {
    return "skipped";
  }
}
