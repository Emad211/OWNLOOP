import { isAbsolute, join, resolve } from "node:path";

import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import { inspectCodexCapabilityEnvironment } from "./environment.js";
import type { CodexCapabilityEnvironmentFacts } from "./projector.js";

export type InstalledCodexCapabilityEnvironmentProvider = () => Promise<CodexCapabilityEnvironmentFacts>;

export type InstalledCodexCapabilityEnvironmentOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}>;

function absoluteEnvironmentPath(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.includes("\0") || !isAbsolute(value)) {
    return null;
  }
  return resolve(value);
}

export function createInstalledCodexCapabilityEnvironmentProvider(
  options: InstalledCodexCapabilityEnvironmentOptions = {},
): InstalledCodexCapabilityEnvironmentProvider | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return null;

  const environment = options.environment ?? process.env;
  const userProfile = absoluteEnvironmentPath(environment.USERPROFILE);
  const localAppData = absoluteEnvironmentPath(environment.LOCALAPPDATA);
  if (userProfile === null || localAppData === null) return null;

  const programData = absoluteEnvironmentPath(environment.ProgramData);
  const codexRoot = join(userProfile, ".codex");
  const launcherCommands = Object.freeze({
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: join(localAppData, "OwnLoop", "bin", "ownloop-codex-hook.cmd"),
  });

  return async () =>
    inspectCodexCapabilityEnvironment({
      hooksPath: join(codexRoot, "hooks.json"),
      configPath: join(codexRoot, "config.toml"),
      requirementsPath:
        programData === null ? null : join(programData, "OpenAI", "Codex", "requirements.toml"),
      launcherCommands,
      platform,
    });
}
