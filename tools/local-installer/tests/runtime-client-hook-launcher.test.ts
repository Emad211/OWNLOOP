import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES } from "@ownloop/contracts";

import {
  buildReleaseManifest,
  createOrReadInstallationSecrets,
  launchInstalledHookAdapter,
  type HookSpawn,
  probeInstalledRuntime,
  writeInstallManifestAtomic,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-client-"));
  roots.push(root);
  const releaseRoot = join(root, "app", "0.1.0");
  const adapterEntry = join(releaseRoot, "hook-adapter", "dist", "index.js");
  await mkdir(join(releaseRoot, "hook-adapter", "dist"), { recursive: true });
  await writeFile(adapterEntry, "process.exitCode = 0;\n");
  const release = await buildReleaseManifest(releaseRoot, ["hook-adapter/dist/index.js"]);
  await writeFile(join(releaseRoot, "release-manifest.json"), `${JSON.stringify(release)}\n`);
  const secretsPath = join(root, "config", "secrets-v1.json");
  const { secrets } = await createOrReadInstallationSecrets(
    secretsPath,
    () => new Date("2026-07-26T12:00:00.000Z"),
  );
  const stableHookLauncherPath = join(root, "bin", "ownloop-hook.cmd");
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(stableHookLauncherPath, "@exit /b 0\n");
  const installManifestPath = join(root, "install-manifest.json");
  await writeInstallManifestAtomic(installManifestPath, {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: release.fingerprint,
    installLayoutVersion: 1,
    hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({ event, command: stableHookLauncherPath })),
    claudeSettings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [],
    },
    installedAt: "2026-07-26T12:00:00.000Z",
  });
  const runtimeStatePath = join(root, "run", "runtime-v1.json");
  const state = {
    schemaVersion: 1 as const,
    installId: secrets.installId,
    applicationVersion: "0.1.0" as const,
    daemonVersion: "0.1.0" as const,
    hookAdapterVersion: "0.1.0" as const,
    installLayoutVersion: 1 as const,
    instanceId: "runtime_1",
    pid: 4321,
    processStartIdentity: "4321.100",
    port: 43123,
    phase: "ready" as const,
    startedAt: "2026-07-26T12:00:01.000Z",
    updatedAt: "2026-07-26T12:00:02.000Z",
  };
  await mkdir(join(root, "run"), { recursive: true });
  await writeFile(runtimeStatePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
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
    paths: {
      runtimeStatePath,
      secretsPath,
      installManifestPath,
      releaseRoot,
      stableHookLauncherPath,
    },
    secrets,
    state,
    status,
    adapterEntry,
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runtime client", () => {
  it("accepts only exact authenticated state/status/install/release reconciliation", async () => {
    const setup = await fixture();
    const fetchImplementation = vi.fn(async () => response(setup.status));
    const probe = await probeInstalledRuntime(setup.paths, {
      fetchImplementation: fetchImplementation as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
    });
    expect(probe.result).toBe("running");
    expect(fetchImplementation).toHaveBeenCalledWith(
      `http://127.0.0.1:${setup.state.port}/v1/runtime/status`,
      expect.objectContaining({
        redirect: "error",
        headers: { authorization: `Bearer ${setup.secrets.installationToken}` },
      }),
    );
  });

  it("classifies endpoint failure as stale only when the PID is observed absent", async () => {
    const setup = await fixture();
    const failedFetch = vi.fn(async () => {
      throw new Error("unavailable");
    });
    expect(
      (
        await probeInstalledRuntime(setup.paths, {
          fetchImplementation: failedFetch as typeof fetch,
          processInspector: { exists: vi.fn(async () => false) },
        })
      ).result,
    ).toBe("stale");
    expect(
      (
        await probeInstalledRuntime(setup.paths, {
          fetchImplementation: failedFetch as typeof fetch,
          processInspector: { exists: vi.fn(async () => true) },
        })
      ).result,
    ).toBe("repair_needed");
    expect(
      (
        await probeInstalledRuntime(setup.paths, {
          fetchImplementation: failedFetch as typeof fetch,
          processInspector: { exists: vi.fn(async () => null) },
        })
      ).result,
    ).toBe("repair_needed");
  });

  it("rejects status identity mismatch even when PID and port match", async () => {
    const setup = await fixture();
    const mismatch = { ...setup.status, processStartIdentity: "4321.999" };
    const probe = await probeInstalledRuntime(setup.paths, {
      fetchImplementation: (async () => response(mismatch)) as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
    });
    expect(probe.result).toBe("repair_needed");
  });
});

describe("installed Hook launcher", () => {
  it("passes token only in child environment and executes the fixed verified adapter entry", async () => {
    const setup = await fixture();
    const spawnImplementation = vi.fn<HookSpawn>(async () => undefined);
    const result = await launchInstalledHookAdapter(setup.paths, {
      fetchImplementation: (async () => response(setup.status)) as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
      spawnImplementation,
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    });
    expect(result).toBe("launched");
    expect(spawnImplementation).toHaveBeenCalledTimes(1);
    const [executable, args, options] = spawnImplementation.mock.calls[0]!;
    expect(executable).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(args).toEqual([resolve(setup.adapterEntry)]);
    expect(JSON.stringify(args)).not.toContain(setup.secrets.installationToken);
    expect(options.env?.OWNLOOP_INSTALLATION_TOKEN).toBe(setup.secrets.installationToken);
    expect(options.env?.OWNLOOP_INGRESS_PORT).toBe(String(setup.state.port));
    expect(options.stdio).toEqual(["inherit", "ignore", "ignore"]);
  });

  it("silently skips incompatible runtime without spawning", async () => {
    const setup = await fixture();
    const spawnImplementation = vi.fn<HookSpawn>(async () => undefined);
    const result = await launchInstalledHookAdapter(setup.paths, {
      fetchImplementation: (async () =>
        response({ ...setup.status, instanceId: "other" })) as typeof fetch,
      processInspector: { exists: vi.fn(async () => true) },
      spawnImplementation,
    });
    expect(result).toBe("skipped");
    expect(spawnImplementation).not.toHaveBeenCalled();
  });
});
