import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";

import { OwnLoopRuntimeShutdownResponseV1Schema } from "@ownloop/contracts";

import { readInstallManifest } from "./install-manifest.js";
import { readAndVerifyReleasePackage } from "./manifest.js";
import {
  probeInstalledRuntime,
  type RuntimeClientDependencies,
  type RuntimeClientPaths,
  type RuntimeProbe,
} from "./runtime-client.js";
import { removeInstalledRuntimeState, readInstalledRuntimeState } from "./runtime-state-file.js";
import { readInstallationSecrets } from "./secrets.js";

const DAEMON_ENTRY = "daemon/dist/main.js";

export class RuntimeOperationError extends Error {
  readonly code:
    | "already_running"
    | "repair_needed"
    | "start_failed"
    | "start_timeout"
    | "not_running"
    | "stale_runtime"
    | "shutdown_rejected"
    | "stop_timeout";
  constructor(code: RuntimeOperationError["code"]) {
    super("The installed runtime operation did not complete safely.");
    this.name = "RuntimeOperationError";
    this.code = code;
  }
}

export type DaemonSpawn = (
  executable: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "stdio"> & { stdio: "ignore" },
) => Promise<void>;

async function defaultDaemonSpawn(
  executable: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "stdio"> & { stdio: "ignore" },
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, [...args], { ...options, stdio: "ignore" });
    } catch {
      rejectPromise(new RuntimeOperationError("start_failed"));
      return;
    }
    child.once("error", () => rejectPromise(new RuntimeOperationError("start_failed")));
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function deadline(value: number | undefined): number {
  const result = value ?? 10_000;
  if (!Number.isInteger(result) || result < 50 || result > 60_000) {
    throw new TypeError("Invalid runtime operation timeout.");
  }
  return result;
}

async function validateInstalledRelease(paths: RuntimeClientPaths): Promise<void> {
  const [installation, release, secrets] = await Promise.all([
    readInstallManifest(paths.installManifestPath),
    readAndVerifyReleasePackage(paths.releaseRoot),
    readInstallationSecrets(paths.secretsPath),
  ]);
  if (
    secrets === null ||
    secrets.installId !== installation.installId ||
    installation.releaseManifestFingerprint !== release.fingerprint
  ) {
    throw new RuntimeOperationError("repair_needed");
  }
}

async function waitFor(
  operation: () => Promise<RuntimeProbe>,
  expected: "running" | "stopped",
  timeoutMs: number,
  delayMs = 50,
): Promise<RuntimeProbe | null> {
  const end = Date.now() + timeoutMs;
  do {
    const probe = await operation();
    if (probe.result === expected) return probe;
    if (probe.result === "repair_needed") return null;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  } while (Date.now() < end);
  return null;
}

export async function startInstalledRuntime(
  paths: RuntimeClientPaths,
  dependencies: RuntimeClientDependencies & {
    spawnImplementation?: DaemonSpawn;
    nodeExecutable?: string;
    timeoutMs?: number;
  } = {},
): Promise<RuntimeProbe> {
  await validateInstalledRelease(paths).catch((error) => {
    if (error instanceof RuntimeOperationError) throw error;
    throw new RuntimeOperationError("repair_needed");
  });
  const initial = await probeInstalledRuntime(paths, dependencies);
  if (initial.result === "running") throw new RuntimeOperationError("already_running");
  if (initial.result === "repair_needed") throw new RuntimeOperationError("repair_needed");
  if (initial.result === "stale" && initial.state !== null) {
    await removeInstalledRuntimeState(paths.runtimeStatePath, initial.state.instanceId).catch(
      () => {
        throw new RuntimeOperationError("repair_needed");
      },
    );
  }

  const daemonEntry = resolve(paths.releaseRoot, DAEMON_ENTRY);
  await (dependencies.spawnImplementation ?? defaultDaemonSpawn)(
    dependencies.nodeExecutable ?? process.execPath,
    [daemonEntry],
    {
      detached: true,
      env: { ...process.env },
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const observed = await waitFor(
    () => probeInstalledRuntime(paths, dependencies),
    "running",
    deadline(dependencies.timeoutMs),
  );
  if (observed === null) throw new RuntimeOperationError("start_timeout");
  return observed;
}

export async function stopInstalledRuntime(
  paths: RuntimeClientPaths,
  dependencies: RuntimeClientDependencies & { timeoutMs?: number } = {},
): Promise<void> {
  const initial = await probeInstalledRuntime(paths, dependencies);
  if (initial.result === "stopped") throw new RuntimeOperationError("not_running");
  if (initial.result === "stale") throw new RuntimeOperationError("stale_runtime");
  if (initial.result !== "running" || initial.state === null)
    throw new RuntimeOperationError("repair_needed");
  const secrets = await readInstallationSecrets(paths.secretsPath).catch(() => null);
  if (secrets === null) throw new RuntimeOperationError("repair_needed");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadline(dependencies.timeoutMs));
  timeout.unref();
  try {
    const response = await (dependencies.fetchImplementation ?? fetch)(
      `http://127.0.0.1:${initial.state.port}/v1/runtime/shutdown`,
      {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${secrets.installationToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ schemaVersion: 1, instanceId: initial.state.instanceId }),
      },
    );
    if (response.status !== 200) throw new RuntimeOperationError("shutdown_rejected");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 16 * 1024)
      throw new RuntimeOperationError("shutdown_rejected");
    const parsed = OwnLoopRuntimeShutdownResponseV1Schema.parse(JSON.parse(body));
    if (parsed.instanceId !== initial.state.instanceId)
      throw new RuntimeOperationError("shutdown_rejected");
  } catch (error) {
    if (error instanceof RuntimeOperationError) throw error;
    throw new RuntimeOperationError("shutdown_rejected");
  } finally {
    clearTimeout(timeout);
  }

  const stopped = await waitFor(
    async () => {
      const state = await readInstalledRuntimeState(paths.runtimeStatePath).catch(
        () => initial.state,
      );
      if (state === null) return { result: "stopped", state: null, status: null };
      return probeInstalledRuntime(paths, dependencies);
    },
    "stopped",
    deadline(dependencies.timeoutMs),
  );
  if (stopped === null) throw new RuntimeOperationError("stop_timeout");
}
