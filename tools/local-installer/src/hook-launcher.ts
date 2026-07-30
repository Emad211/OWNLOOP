import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";

import { OWNLOOP_HOOK_ADAPTER_VERSION } from "@ownloop/contracts";

import { readInstallManifest } from "./install-manifest.js";
import {
  probeInstalledRuntime,
  type RuntimeClientDependencies,
  type RuntimeClientPaths,
} from "./runtime-client.js";
import { readInstallationSecrets } from "./secrets.js";

const ADAPTER_ENTRY = "hook-adapter/dist/index.js";

export type HookLauncherPaths = RuntimeClientPaths &
  Readonly<{
    stableHookLauncherPath: string;
  }>;

export type HookSpawnOptions = Omit<SpawnOptions, "stdio"> & {
  env: NodeJS.ProcessEnv;
  windowsHide: true;
  stdio: readonly ["inherit", "ignore", "ignore"];
};

export type HookSpawn = (
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
      child = spawn(executable, [...args], { ...options, stdio: ["inherit", "ignore", "ignore"] });
    } catch {
      resolvePromise();
      return;
    }
    child.once("error", () => resolvePromise());
    child.once("exit", () => resolvePromise());
  });
}

export async function launchInstalledHookAdapter(
  paths: HookLauncherPaths,
  dependencies: RuntimeClientDependencies & {
    spawnImplementation?: HookSpawn;
    nodeExecutable?: string;
  } = {},
): Promise<"launched" | "skipped"> {
  try {
    const probe = await probeInstalledRuntime(paths, dependencies);
    if (probe.result !== "running" || probe.state === null || probe.status === null)
      return "skipped";
    if (probe.status.hookAdapterVersion !== OWNLOOP_HOOK_ADAPTER_VERSION) return "skipped";
    const installation = await readInstallManifest(paths.installManifestPath);
    const expectedCommand = resolve(paths.stableHookLauncherPath);
    if (installation.hooks.some((hook) => resolve(hook.command) !== expectedCommand))
      return "skipped";
    const secrets = await readInstallationSecrets(paths.secretsPath);
    if (secrets === null || secrets.installId !== installation.installId) return "skipped";
    const adapterEntry = resolve(paths.releaseRoot, ADAPTER_ENTRY);
    const nodeExecutable = dependencies.nodeExecutable ?? process.execPath;
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      OWNLOOP_INGRESS_PORT: String(probe.state.port),
      OWNLOOP_INSTALLATION_TOKEN: secrets.installationToken,
    };
    await (dependencies.spawnImplementation ?? defaultSpawn)(nodeExecutable, [adapterEntry], {
      env: environment,
      windowsHide: true,
      stdio: ["inherit", "ignore", "ignore"],
    });
    return "launched";
  } catch {
    return "skipped";
  }
}
