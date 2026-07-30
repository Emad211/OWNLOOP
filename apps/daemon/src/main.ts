#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { startProductionRuntime, type ProductionRuntime } from "./runtime/composition.js";
import { loadVerifiedInstalledRuntime } from "./runtime/installed-release.js";

export type InstalledDaemonDependencies = Readonly<{
  environment?: NodeJS.ProcessEnv;
  platform?: string;
  architecture?: string;
  nodeVersion?: string;
  verifyPrivateAcl?: (configRoot: string, secretsPath: string) => Promise<boolean>;
}>;

export async function runInstalledDaemon(
  dependencies: InstalledDaemonDependencies = {},
): Promise<ProductionRuntime> {
  const environment = dependencies.environment ?? process.env;
  const localAppData = environment.LOCALAPPDATA;
  if (localAppData === undefined)
    throw new Error("Installed runtime configuration is unavailable.");
  const verified = await loadVerifiedInstalledRuntime({
    localAppData,
    ...(dependencies.platform === undefined ? {} : { platform: dependencies.platform }),
    ...(dependencies.architecture === undefined ? {} : { architecture: dependencies.architecture }),
    ...(dependencies.nodeVersion === undefined ? {} : { nodeVersion: dependencies.nodeVersion }),
    ...(dependencies.verifyPrivateAcl === undefined
      ? {}
      : { verifyPrivateAcl: dependencies.verifyPrivateAcl }),
  });
  return startProductionRuntime({
    databasePath: verified.paths.databasePath,
    artifactRoot: verified.paths.artifactRoot,
    webRoot: verified.paths.webRoot,
    runtimeStatePath: verified.paths.runtimeStatePath,
    installationToken: verified.secrets.installationToken,
    hmacKey: verified.secrets.hmacKey,
    installManifest: verified.installManifest,
    releaseManifest: verified.releaseManifest,
    platform: dependencies.platform ?? process.platform,
    architecture: dependencies.architecture ?? process.arch,
    nodeVersion: dependencies.nodeVersion ?? process.versions.node,
    processStartIdentity: `${process.pid}:${Date.now()}`,
  });
}

async function main(): Promise<void> {
  let runtime: ProductionRuntime | null = null;
  try {
    runtime = await runInstalledDaemon();
    const shutdown = (): void => {
      void runtime?.shutdown().finally(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  void main();
}
