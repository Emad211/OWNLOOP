import { describe, expect, it } from "vitest";

import { OwnLoopInstallManifestV1Schema, SUPPORTED_CLAUDE_HOOK_NAMES } from "../src/index.js";
import { CODEX_HOOK_LAUNCHER_BASENAME, SUPPORTED_CODEX_HOOK_NAMES } from "../src/codex.js";

const manifest = () => ({
  schemaVersion: 1,
  installId: "install_1",
  applicationVersion: "0.1.0",
  releaseDirectoryName: "0.1.0",
  releaseManifestFingerprint: `sha256:${"a".repeat(64)}`,
  installLayoutVersion: 1,
  hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
    event,
    command: "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-hook.cmd",
  })),
  claudeSettings: {
    settingsFileCreated: false,
    hooksContainerCreated: false,
    createdEventContainers: [],
  },
  codexHooks: {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\bin\\ownloop-codex-hook.cmd",
    settings: {
      settingsFileCreated: false,
      hooksContainerCreated: false,
      createdEventContainers: [...SUPPORTED_CODEX_HOOK_NAMES],
    },
  },
  installedAt: "2026-07-26T12:00:00.000Z",
});

describe("Codex installation ownership contract", () => {
  it("accepts the stable launcher and canonical event ownership", () => {
    expect(
      OwnLoopInstallManifestV1Schema.parse(manifest()).codexHooks?.settings.createdEventContainers,
    ).toEqual(SUPPORTED_CODEX_HOOK_NAMES);
  });

  it("rejects reordered ownership or a versioned launcher command", () => {
    expect(() =>
      OwnLoopInstallManifestV1Schema.parse({
        ...manifest(),
        codexHooks: {
          ...manifest().codexHooks,
          settings: {
            ...manifest().codexHooks.settings,
            createdEventContainers: [...SUPPORTED_CODEX_HOOK_NAMES].reverse(),
          },
        },
      }),
    ).toThrow();
    expect(() =>
      OwnLoopInstallManifestV1Schema.parse({
        ...manifest(),
        codexHooks: {
          ...manifest().codexHooks,
          commandWindows:
            "C:\\Users\\Founder\\AppData\\Local\\OwnLoop\\app\\0.1.0\\ownloop-codex-hook.cmd",
        },
      }),
    ).toThrow();
  });
});
