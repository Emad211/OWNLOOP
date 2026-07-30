import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES } from "@ownloop/contracts";

import {
  RuntimeOperationError,
  buildReleaseManifest,
  type DaemonSpawn,
  createOrReadInstallationSecrets,
  startInstalledRuntime,
  stopInstalledRuntime,
  writeInstallManifestAtomic,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture(withState = false) {
  const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-operations-"));
  roots.push(root);
  const releaseRoot = join(root, "app", "0.1.0");
  await mkdir(join(releaseRoot, "daemon", "dist"), { recursive: true });
  await writeFile(join(releaseRoot, "daemon", "dist", "main.js"), "process.exitCode=0;\n");
  const release = await buildReleaseManifest(releaseRoot, ["daemon/dist/main.js"]);
  await writeFile(join(releaseRoot, "release-manifest.json"), `${JSON.stringify(release)}\n`);
  const secretsPath = join(root, "config", "secrets-v1.json");
  const { secrets } = await createOrReadInstallationSecrets(
    secretsPath,
    () => new Date("2026-07-26T12:00:00.000Z"),
  );
  const installManifestPath = join(root, "install-manifest.json");
  await writeInstallManifestAtomic(installManifestPath, {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: release.fingerprint,
    installLayoutVersion: 1,
    hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
      event,
      command: join(root, "bin", "ownloop-hook.cmd"),
    })),
    claudeSettings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [],
    },
    installedAt: "2026-07-26T12:00:00.000Z",
  });
  const runtimeStatePath = join(root, "run", "runtime-v1.json");
  const state = {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    daemonVersion: "0.1.0",
    hookAdapterVersion: "0.1.0",
    installLayoutVersion: 1,
    instanceId: "runtime_1",
    pid: 4321,
    processStartIdentity: "4321.100",
    port: 43123,
    phase: "ready",
    startedAt: "2026-07-26T12:00:01.000Z",
    updatedAt: "2026-07-26T12:00:02.000Z",
  } as const;
  if (withState) {
    await mkdir(join(root, "run"));
    await writeFile(runtimeStatePath, `${JSON.stringify(state)}\n`);
  }
  const status = {
    ok: true,
    schemaVersion: 1,
    installId: secrets.installId,
    instanceId: state.instanceId,
    applicationVersion: state.applicationVersion,
    daemonVersion: state.daemonVersion,
    hookAdapterVersion: state.hookAdapterVersion,
    pid: state.pid,
    processStartIdentity: state.processStartIdentity,
    port: state.port,
    phase: state.phase,
    pumpState: "idle",
    startedAt: state.startedAt,
    compatibility: {
      platform: "win32",
      architecture: "x64",
      nodeVersion: "24.18.0",
      databaseSchemaVersion: 18,
      installLayoutVersion: 1,
      releaseManifestFingerprint: release.fingerprint,
    },
  };
  return {
    paths: { releaseRoot, secretsPath, installManifestPath, runtimeStatePath },
    state,
    status,
    secrets,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("runtime start/stop", () => {
  it("starts from stopped state, passes no credentials in argv, and succeeds only after healthy status", async () => {
    const setup = await fixture(false);
    const spawnImplementation = vi.fn<DaemonSpawn>(async () => {
      await mkdir(join(resolve(setup.paths.runtimeStatePath, "..")), { recursive: true });
      await writeFile(setup.paths.runtimeStatePath, `${JSON.stringify(setup.state)}\n`);
    });
    const result = await startInstalledRuntime(setup.paths, {
      spawnImplementation,
      nodeExecutable: "node.exe",
      timeoutMs: 500,
      fetchImplementation: (async () => json(setup.status)) as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
    });
    expect(result.result).toBe("running");
    const [executable, args] = spawnImplementation.mock.calls[0]!;
    expect(executable).toBe("node.exe");
    expect(args).toEqual([resolve(setup.paths.releaseRoot, "daemon/dist/main.js")]);
    expect(JSON.stringify(args)).not.toContain(setup.secrets.installationToken);
  });

  it("fails closed when start never becomes healthy", async () => {
    const setup = await fixture(false);
    await expect(
      startInstalledRuntime(setup.paths, {
        spawnImplementation: vi.fn(async () => undefined),
        timeoutMs: 100,
        fetchImplementation: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
        processInspector: { exists: vi.fn(async () => false) },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "start_timeout" }));
  });

  it("accepts strict shutdown acknowledgement but waits for exact state removal", async () => {
    const setup = await fixture(true);
    let shutdownCalls = 0;
    const fetchImplementation = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/shutdown")) {
        shutdownCalls += 1;
        await rm(setup.paths.runtimeStatePath);
        return json({
          ok: true,
          schemaVersion: 1,
          instanceId: setup.state.instanceId,
          acknowledged: true,
        });
      }
      return json(setup.status);
    });
    await stopInstalledRuntime(setup.paths, {
      timeoutMs: 500,
      fetchImplementation: fetchImplementation as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
    });
    expect(shutdownCalls).toBe(1);
    await expect(readFile(setup.paths.runtimeStatePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a 200 response that is not the strict shutdown contract", async () => {
    const setup = await fixture(true);
    const fetchImplementation = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/shutdown") ? json({ ok: true }) : json(setup.status),
    );
    await expect(
      stopInstalledRuntime(setup.paths, {
        timeoutMs: 500,
        fetchImplementation: fetchImplementation as typeof fetch,
        processInspector: { exists: vi.fn(async () => true) },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "shutdown_rejected" }));
  });
});
