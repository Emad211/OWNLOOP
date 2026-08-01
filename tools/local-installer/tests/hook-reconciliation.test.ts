import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SUPPORTED_CLAUDE_HOOK_NAMES, type OwnLoopInstallManifestV1 } from "@ownloop/contracts";
import {
  CODEX_HOOK_LAUNCHER_BASENAME,
  inspectCodexHookConfiguration,
  parseCodexHookConfigurationJson,
} from "@ownloop/contracts/codex";

import {
  createNativeInstallLayout,
  inspectClaudeHooks,
  installConfiguredHooks,
  parseStrictJsonObject,
  removeConfiguredHooks,
  writeInstallManifestAtomic,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-hook-reconciliation-"));
  roots.push(root);
  const layout = createNativeInstallLayout(join(root, "OwnLoop"));
  const claudeSettingsPath = join(root, "User", ".claude", "settings.json");
  const codexSettingsPath = join(root, "User", ".codex", "hooks.json");
  await mkdir(join(root, "User", ".claude"), { recursive: true });
  await mkdir(join(root, "User", ".codex"), { recursive: true });
  await writeFile(claudeSettingsPath, '{"theme":"dark"}\n');
  await writeFile(codexSettingsPath, '{"theme":"light"}\n');
  const manifest: OwnLoopInstallManifestV1 = {
    schemaVersion: 1,
    installId: "install_1",
    applicationVersion: "0.1.0",
    releaseDirectoryName: "0.1.0",
    releaseManifestFingerprint: `sha256:${"a".repeat(64)}`,
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
  };
  await writeInstallManifestAtomic(layout.installManifestPath, manifest);
  return { root, layout, claudeSettingsPath, codexSettingsPath, manifest };
}

function codexCommands(setup: Awaited<ReturnType<typeof fixture>>) {
  return {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: setup.layout.stableCodexHookLauncherPath,
  } as const;
}

describe("dual-client Hook reconciliation", () => {
  it("installs and removes exact Hooks while preserving unrelated settings", async () => {
    const setup = await fixture();
    const installed = await installConfiguredHooks({
      layout: setup.layout,
      claudeSettingsPath: setup.claudeSettingsPath,
      codexSettingsPath: setup.codexSettingsPath,
      manifest: setup.manifest,
    });
    expect(installed.changed).toBe(true);
    expect(
      inspectClaudeHooks(
        parseStrictJsonObject(await readFile(setup.claudeSettingsPath, "utf8")),
        setup.layout.stableHookLauncherPath,
      ),
    ).toBe("installed");
    const codexInstalled = parseCodexHookConfigurationJson(
      await readFile(setup.codexSettingsPath, "utf8"),
    );
    expect(inspectCodexHookConfiguration(codexInstalled, codexCommands(setup)).state).toBe("exact");

    const repeated = await installConfiguredHooks({
      layout: setup.layout,
      claudeSettingsPath: setup.claudeSettingsPath,
      codexSettingsPath: setup.codexSettingsPath,
      manifest: installed.manifest,
    });
    expect(repeated.changed).toBe(false);

    const removed = await removeConfiguredHooks({
      layout: setup.layout,
      claudeSettingsPath: setup.claudeSettingsPath,
      codexSettingsPath: setup.codexSettingsPath,
      manifest: installed.manifest,
    });
    expect(removed.changed).toBe(true);
    expect(parseStrictJsonObject(await readFile(setup.claudeSettingsPath, "utf8"))).toEqual({
      theme: "dark",
    });
    expect(
      parseCodexHookConfigurationJson(await readFile(setup.codexSettingsPath, "utf8")),
    ).toEqual({ theme: "light" });
  });

  it("restores Claude, Codex, and manifest bytes when Codex installation is ambiguous", async () => {
    const setup = await fixture();
    const ambiguous = `${JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: CODEX_HOOK_LAUNCHER_BASENAME,
                commandWindows: join(setup.root, "other", "ownloop-codex-hook.cmd"),
                timeout: 5,
                async: false,
                additionalContextLimit: 0,
              },
            ],
          },
        ],
      },
    })}\n`;
    await writeFile(setup.codexSettingsPath, ambiguous);
    const claudeBefore = await readFile(setup.claudeSettingsPath);
    const codexBefore = await readFile(setup.codexSettingsPath);
    const manifestBefore = await readFile(setup.layout.installManifestPath);

    await expect(
      installConfiguredHooks({
        layout: setup.layout,
        claudeSettingsPath: setup.claudeSettingsPath,
        codexSettingsPath: setup.codexSettingsPath,
        manifest: setup.manifest,
      }),
    ).rejects.toMatchObject({ code: "repair_needed" });
    expect(await readFile(setup.claudeSettingsPath)).toEqual(claudeBefore);
    expect(await readFile(setup.codexSettingsPath)).toEqual(codexBefore);
    expect(await readFile(setup.layout.installManifestPath)).toEqual(manifestBefore);
  });

  it("restores removed Claude Hooks when Codex removal becomes ambiguous", async () => {
    const setup = await fixture();
    const installed = await installConfiguredHooks({
      layout: setup.layout,
      claudeSettingsPath: setup.claudeSettingsPath,
      codexSettingsPath: setup.codexSettingsPath,
      manifest: setup.manifest,
    });
    const codexDocument = parseCodexHookConfigurationJson(
      await readFile(setup.codexSettingsPath, "utf8"),
    );
    const hooks = codexDocument.hooks as Record<string, unknown>;
    (hooks.SessionStart as unknown[]).push({
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: CODEX_HOOK_LAUNCHER_BASENAME,
          commandWindows: join(setup.root, "other", "ownloop-codex-hook.cmd"),
          timeout: 5,
          async: false,
          additionalContextLimit: 0,
        },
      ],
    });
    await writeFile(setup.codexSettingsPath, `${JSON.stringify(codexDocument)}\n`);
    const claudeBefore = await readFile(setup.claudeSettingsPath);
    const codexBefore = await readFile(setup.codexSettingsPath);

    await expect(
      removeConfiguredHooks({
        layout: setup.layout,
        claudeSettingsPath: setup.claudeSettingsPath,
        codexSettingsPath: setup.codexSettingsPath,
        manifest: installed.manifest,
      }),
    ).rejects.toMatchObject({ code: "repair_needed" });
    expect(await readFile(setup.claudeSettingsPath)).toEqual(claudeBefore);
    expect(await readFile(setup.codexSettingsPath)).toEqual(codexBefore);
  });
});
