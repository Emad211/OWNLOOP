import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  SUPPORTED_CLAUDE_HOOK_NAMES,
} from "@ownloop/contracts";
import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  installCodexHookConfiguration,
  projectCodexCapabilityStatusV1,
  serializeCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import {
  buildReleaseManifest,
  createNativeInstallLayout,
  createOrReadInstallationSecrets,
  runCodexDoctor,
  writeInstallManifestAtomic,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const AT = "2026-08-01T00:00:00.000Z";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-codex-doctor-"));
  roots.push(root);
  const layout = createNativeInstallLayout(join(root, "OwnLoop"));
  const codexSettingsPath = join(root, "User", ".codex", "hooks.json");
  await mkdir(join(layout.releaseRoot, "daemon", "dist"), { recursive: true });
  await mkdir(join(root, "User", ".codex"), { recursive: true });
  await mkdir(layout.runRoot, { recursive: true });
  await writeFile(join(layout.releaseRoot, "daemon", "dist", "main.js"), "main\n");
  const release = await buildReleaseManifest(layout.releaseRoot, ["daemon/dist/main.js"]);
  await writeFile(
    join(layout.releaseRoot, "release-manifest.json"),
    `${JSON.stringify(release)}\n`,
  );
  const { secrets } = await createOrReadInstallationSecrets(
    layout.secretsPath,
    () => new Date(AT),
  );
  await writeInstallManifestAtomic(layout.installManifestPath, {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: release.fingerprint,
    installLayoutVersion: 1,
    hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
      event,
      command: layout.stableHookLauncherPath,
    })),
    claudeSettings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [],
    },
    codexHooks: {
      command: CODEX_HOOK_LAUNCHER_BASENAME,
      commandWindows: layout.stableCodexHookLauncherPath,
      settings: {
        settingsFileCreated: false,
        hooksContainerCreated: false,
        createdEventContainers: [],
      },
    },
    installedAt: AT,
  });
  const commands = {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: layout.stableCodexHookLauncherPath,
  } as const;
  await writeFile(
    codexSettingsPath,
    serializeCodexHookConfigurationJson(installCodexHookConfiguration({}, commands).document),
  );
  const state = {
    schemaVersion: 1,
    installId: secrets.installId,
    applicationVersion: "0.1.0",
    daemonVersion: "0.1.0",
    hookAdapterVersion: "0.1.0",
    installLayoutVersion: 1,
    instanceId: "runtime_doctor_1",
    pid: 4242,
    processStartIdentity: "4242:1",
    port: 43123,
    phase: "ready",
    startedAt: AT,
    updatedAt: AT,
  } as const;
  await writeFile(layout.runtimeStatePath, `${JSON.stringify(state)}\n`);
  const runtimeStatus = {
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
    pumpState: "running",
    startedAt: state.startedAt,
    compatibility: {
      platform: OWNLOOP_SUPPORTED_PLATFORM,
      architecture: OWNLOOP_SUPPORTED_ARCHITECTURE,
      nodeVersion: OWNLOOP_REQUIRED_NODE_VERSION,
      databaseSchemaVersion: OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
      installLayoutVersion: 1,
      releaseManifestFingerprint: release.fingerprint,
    },
  } as const;
  return { layout, codexSettingsPath, secrets, state, runtimeStatus };
}

describe("Codex doctor", () => {
  it("returns authenticated daemon capability only after runtime reconciliation", async () => {
    const setup = await fixture();
    const capability = projectCodexCapabilityStatusV1({
      configurationState: "exact",
      hookEngineState: "enabled",
      trustState: "needs_trust",
      managedPolicyState: "unrestricted",
      observedHookNames: [],
      observedSourceSurfaces: [],
      observedSourceVersions: [],
      lastObservedAt: null,
      limitations: [],
    });
    const fetchImplementation: typeof fetch = vi.fn(async (url, init) => {
      expect(init?.headers).toEqual({
        authorization: `Bearer ${setup.secrets.installationToken}`,
      });
      if (String(url).endsWith("/v1/runtime/status")) {
        return Response.json(setup.runtimeStatus, { status: 200 });
      }
      if (String(url).endsWith("/v1/diagnostics/codex")) {
        return Response.json(capability, {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      throw new Error("Unexpected doctor URL.");
    });

    const result = await runCodexDoctor(
      { ...setup.layout, codexSettingsPath: setup.codexSettingsPath },
      { fetchImplementation },
    );
    expect(result).toEqual({
      source: "daemon",
      runtime: "running",
      capability,
      diagnostic: null,
    });
    expect(JSON.stringify(result)).not.toContain(setup.secrets.installationToken);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("falls back locally when the running daemon capability response is invalid", async () => {
    const setup = await fixture();
    const fetchImplementation: typeof fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/v1/runtime/status")) {
        return Response.json(setup.runtimeStatus, { status: 200 });
      }
      return Response.json(
        { state: "active", secret: setup.secrets.installationToken },
        {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    });

    const result = await runCodexDoctor(
      { ...setup.layout, codexSettingsPath: setup.codexSettingsPath },
      { fetchImplementation },
    );
    expect(result).toMatchObject({
      source: "local",
      runtime: "running",
      diagnostic: "daemon_capability_unavailable",
      capability: { state: "installed_unverified" },
    });
    expect(JSON.stringify(result)).not.toContain(setup.secrets.installationToken);
  });
});
