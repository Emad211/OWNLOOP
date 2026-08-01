import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  SUPPORTED_CLAUDE_HOOK_NAMES,
} from "@ownloop/contracts";
import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import {
  buildReleaseManifest,
  createNativeInstallLayout,
  createOrReadInstallationSecrets,
  writeInstallManifestAtomic,
} from "../src/index.js";
import { executeCli, parseCliCommand } from "../src/cli.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const compatible = {
  platform: OWNLOOP_SUPPORTED_PLATFORM,
  architecture: OWNLOOP_SUPPORTED_ARCHITECTURE,
  nodeVersion: OWNLOOP_REQUIRED_NODE_VERSION,
} as const;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-codex-cli-"));
  roots.push(root);
  const localAppData = join(root, "LocalAppData");
  const userProfile = join(root, "User");
  const layout = createNativeInstallLayout(join(localAppData, "OwnLoop"));
  const claudeSettingsPath = join(userProfile, ".claude", "settings.json");
  const codexSettingsPath = join(userProfile, ".codex", "hooks.json");
  await mkdir(join(layout.releaseRoot, "installer", "dist"), { recursive: true });
  await mkdir(join(userProfile, ".claude"), { recursive: true });
  await mkdir(join(userProfile, ".codex"), { recursive: true });
  await writeFile(
    join(layout.releaseRoot, "installer", "dist", "hook-main.js"),
    "process.exitCode = 0;\n",
  );
  await writeFile(
    join(layout.releaseRoot, "installer", "dist", "codex-hook-main.js"),
    "process.exitCode = 0;\n",
  );
  const release = await buildReleaseManifest(layout.releaseRoot, [
    "installer/dist/hook-main.js",
    "installer/dist/codex-hook-main.js",
  ]);
  await writeFile(
    join(layout.releaseRoot, "release-manifest.json"),
    `${JSON.stringify(release)}\n`,
  );
  const secrets = await createOrReadInstallationSecrets(
    layout.secretsPath,
    () => new Date("2026-08-01T00:00:00.000Z"),
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
    installedAt: "2026-08-01T00:00:00.000Z",
  });
  await writeFile(claudeSettingsPath, '{"theme":"dark"}\n');
  await writeFile(codexSettingsPath, '{"theme":"light"}\n');
  return {
    layout,
    claudeSettingsPath,
    codexSettingsPath,
    environment: { LOCALAPPDATA: localAppData, USERPROFILE: userProfile },
  };
}

describe("Codex CLI command parsing", () => {
  it("parses the dedicated Hook and doctor surface", () => {
    expect(parseCliCommand(["codex", "hooks", "install"])).toEqual({
      name: "codex_hooks_install",
    });
    expect(parseCliCommand(["codex", "hooks", "status"])).toEqual({
      name: "codex_hooks_status",
    });
    expect(parseCliCommand(["codex", "hooks", "remove"])).toEqual({
      name: "codex_hooks_remove",
    });
    expect(parseCliCommand(["codex", "doctor"])).toEqual({ name: "codex_doctor" });
  });

  it("rejects unknown Codex subcommands", () => {
    expect(() => parseCliCommand(["codex", "hooks", "repair"])).toThrow();
    expect(() => parseCliCommand(["codex", "status"])).toThrow();
  });
});

describe("Codex-only CLI reconciliation", () => {
  it("installs and removes Codex Hooks without changing Claude settings", async () => {
    const setup = await fixture();
    const claudeBefore = await readFile(setup.claudeSettingsPath);

    expect(
      await executeCli(["codex", "hooks", "status"], {
        ...compatible,
        environment: setup.environment,
      }),
    ).toEqual({ ok: true, command: "codex hooks status", status: "missing" });

    expect(
      await executeCli(["codex", "hooks", "install"], {
        ...compatible,
        environment: setup.environment,
      }),
    ).toEqual({ ok: true, command: "codex hooks install", changed: true });
    expect(await readFile(setup.claudeSettingsPath)).toEqual(claudeBefore);
    expect(await readFile(setup.codexSettingsPath, "utf8")).toContain("ownloop-codex-hook");

    expect(
      await executeCli(["codex", "hooks", "status"], {
        ...compatible,
        environment: setup.environment,
      }),
    ).toEqual({ ok: true, command: "codex hooks status", status: "installed" });

    expect(
      await executeCli(["codex", "hooks", "remove"], {
        ...compatible,
        environment: setup.environment,
      }),
    ).toEqual({ ok: true, command: "codex hooks remove", changed: true });
    expect(await readFile(setup.claudeSettingsPath)).toEqual(claudeBefore);
    expect(JSON.parse(await readFile(setup.codexSettingsPath, "utf8"))).toEqual({
      theme: "light",
    });
  });

  it("returns a bounded local doctor result while the daemon is stopped", async () => {
    const setup = await fixture();
    await executeCli(["codex", "hooks", "install"], {
      ...compatible,
      environment: setup.environment,
    });
    const result = await executeCli(["codex", "doctor"], {
      ...compatible,
      environment: setup.environment,
    });
    expect(result).toMatchObject({
      ok: true,
      command: "codex doctor",
      source: "local",
      runtime: "stopped",
      diagnostic: null,
      capability: {
        schemaVersion: 1,
        state: "installed_unverified",
        facts: {
          configurationState: "exact",
          hookEngineState: "unknown",
          trustState: "unknown",
          managedPolicyState: "unknown",
          observedHookNames: [],
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(setup.codexSettingsPath);
    expect(serialized).not.toContain("installationToken");
    expect(serialized).not.toContain("hmacKey");
  });
});
