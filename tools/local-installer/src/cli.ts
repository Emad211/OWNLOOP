#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  type OwnLoopInstallManifestV1,
} from "@ownloop/contracts";
import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import { inspectClaudeHooksFile } from "./claude-settings.js";
import { runCodexDoctor } from "./codex-doctor.js";
import { inspectCodexHooksFile } from "./codex-hooks-file.js";
import {
  installConfiguredCodexHooks,
  installConfiguredHooks,
  removeConfiguredCodexHooks,
  removeConfiguredHooks,
} from "./hook-reconciliation.js";
import { InstallManifestError, readInstallManifest } from "./install-manifest.js";
import {
  createNativeInstallLayout,
  installOwnLoop,
  uninstallOwnLoop,
  type NativeInstallLayout,
} from "./installer-transaction.js";
import { readAndVerifyReleasePackage } from "./manifest.js";
import { probeInstalledRuntime, type RuntimeClientDependencies } from "./runtime-client.js";
import { startInstalledRuntime, stopInstalledRuntime } from "./runtime-operations.js";
import { readInstallationSecrets } from "./secrets.js";

const execFileAsync = promisify(execFile);
const SID_PATTERN = /^S-1-[0-9]+(?:-[0-9]+)+$/u;

export type CliCommand =
  | Readonly<{ name: "install" }>
  | Readonly<{ name: "start" }>
  | Readonly<{ name: "status" }>
  | Readonly<{ name: "open" }>
  | Readonly<{ name: "stop" }>
  | Readonly<{ name: "hooks_install" }>
  | Readonly<{ name: "hooks_status" }>
  | Readonly<{ name: "hooks_remove" }>
  | Readonly<{ name: "codex_hooks_install" }>
  | Readonly<{ name: "codex_hooks_status" }>
  | Readonly<{ name: "codex_hooks_remove" }>
  | Readonly<{ name: "codex_doctor" }>
  | Readonly<{ name: "uninstall"; dataMode: "preserve" }>
  | Readonly<{ name: "uninstall"; dataMode: "remove"; confirmationInstallId: string }>;

export type CliResponse =
  | Readonly<Record<string, unknown> & { ok: true; command: string }>
  | Readonly<{ ok: false; error: { code: string } }>;

export class CliParseError extends Error {
  constructor() {
    super("Invalid OwnLoop command.");
    this.name = "CliParseError";
  }
}

export function parseCliCommand(args: readonly string[]): CliCommand {
  if (args.length === 1) {
    const name = args[0];
    if (
      name === "install" ||
      name === "start" ||
      name === "status" ||
      name === "open" ||
      name === "stop"
    ) {
      return { name };
    }
  }
  if (args.length === 2 && args[0] === "hooks") {
    if (args[1] === "install") return { name: "hooks_install" };
    if (args[1] === "status") return { name: "hooks_status" };
    if (args[1] === "remove") return { name: "hooks_remove" };
  }
  if (args.length === 2 && args[0] === "codex" && args[1] === "doctor") {
    return { name: "codex_doctor" };
  }
  if (args.length === 3 && args[0] === "codex" && args[1] === "hooks") {
    if (args[2] === "install") return { name: "codex_hooks_install" };
    if (args[2] === "status") return { name: "codex_hooks_status" };
    if (args[2] === "remove") return { name: "codex_hooks_remove" };
  }
  if (args.length === 2 && args[0] === "uninstall" && args[1] === "--preserve-data") {
    return { name: "uninstall", dataMode: "preserve" };
  }
  if (
    args.length === 4 &&
    args[0] === "uninstall" &&
    args[1] === "--remove-data" &&
    args[2] === "--confirm" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(args[3] ?? "")
  ) {
    return { name: "uninstall", dataMode: "remove", confirmationInstallId: args[3]! };
  }
  throw new CliParseError();
}

export type CliDependencies = RuntimeClientDependencies &
  Readonly<{
    environment?: NodeJS.ProcessEnv;
    platform?: string;
    architecture?: string;
    nodeVersion?: string;
    packageRoot?: string;
    userSid?: () => Promise<string>;
    openUrl?: (url: string) => Promise<void>;
    installImplementation?: typeof installOwnLoop;
    uninstallImplementation?: typeof uninstallOwnLoop;
    startImplementation?: typeof startInstalledRuntime;
    stopImplementation?: typeof stopInstalledRuntime;
    probeImplementation?: typeof probeInstalledRuntime;
  }>;

async function defaultUserSid(): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ],
    { windowsHide: true, timeout: 10_000 },
  );
  const value = stdout.trim();
  if (!SID_PATTERN.test(value)) throw new Error("SID unavailable");
  return value;
}

async function defaultOpenUrl(url: string): Promise<void> {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/u.test(url)) throw new Error("Invalid local URL");
  await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    windowsHide: true,
    timeout: 10_000,
  });
}

function environmentPaths(environment: NodeJS.ProcessEnv): {
  layout: NativeInstallLayout;
  claudeSettingsPath: string;
  codexSettingsPath: string;
} {
  const localAppData = environment.LOCALAPPDATA;
  const userProfile = environment.USERPROFILE;
  if (localAppData === undefined || userProfile === undefined)
    throw new Error("Environment unavailable");
  return {
    layout: createNativeInstallLayout(join(resolve(localAppData), "OwnLoop")),
    claudeSettingsPath: join(resolve(userProfile), ".claude", "settings.json"),
    codexSettingsPath: join(resolve(userProfile), ".codex", "hooks.json"),
  };
}

function controlledError(error: unknown): CliResponse {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return { ok: false, error: { code: error.code } };
  }
  return { ok: false, error: { code: "operation_failed" } };
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function codexLauncherCommands(layout: NativeInstallLayout) {
  return {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: layout.stableCodexHookLauncherPath,
  } as const;
}

function combinedHooksStatus(
  claude: "installed" | "missing" | "repair_needed",
  codex: "installed" | "missing" | "repair_needed",
): "installed" | "missing" | "repair_needed" {
  if (claude === "repair_needed" || codex === "repair_needed") return "repair_needed";
  return claude === "installed" && codex === "installed" ? "installed" : "missing";
}

async function verifyHookInstallation(
  layout: NativeInstallLayout,
  options: { allowMissing?: boolean } = {},
) {
  let manifest: OwnLoopInstallManifestV1;
  try {
    manifest = await readInstallManifest(layout.installManifestPath);
  } catch (error) {
    if (
      options.allowMissing === true &&
      error instanceof InstallManifestError &&
      error.code === "missing_manifest"
    ) {
      return null;
    }
    const repair = new Error("Installed Hook state requires repair.") as Error & { code: string };
    repair.code = "repair_needed";
    throw repair;
  }
  try {
    const [release, secrets] = await Promise.all([
      readAndVerifyReleasePackage(layout.releaseRoot),
      readInstallationSecrets(layout.secretsPath),
    ]);
    if (
      secrets === null ||
      secrets.installId !== manifest.installId ||
      manifest.releaseManifestFingerprint !== release.fingerprint ||
      manifest.hooks.some(
        (hook) => !sameWindowsPath(hook.command, layout.stableHookLauncherPath),
      ) ||
      manifest.codexHooks === undefined ||
      manifest.codexHooks.command !== CODEX_HOOK_LAUNCHER_BASENAME ||
      !sameWindowsPath(manifest.codexHooks.commandWindows, layout.stableCodexHookLauncherPath)
    ) {
      throw new Error("reconciliation failed");
    }
    return manifest;
  } catch {
    const repair = new Error("Installed Hook state requires repair.") as Error & { code: string };
    repair.code = "repair_needed";
    throw repair;
  }
}

export async function executeCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<CliResponse> {
  try {
    if (
      (dependencies.platform ?? process.platform) !== OWNLOOP_SUPPORTED_PLATFORM ||
      (dependencies.architecture ?? process.arch) !== OWNLOOP_SUPPORTED_ARCHITECTURE ||
      (dependencies.nodeVersion ?? process.versions.node) !== OWNLOOP_REQUIRED_NODE_VERSION
    ) {
      return { ok: false, error: { code: "runtime_incompatible" } };
    }
    const command = parseCliCommand(args);
    const environment = dependencies.environment ?? process.env;
    const { layout, claudeSettingsPath, codexSettingsPath } = environmentPaths(environment);
    const runtimePaths = layout;

    if (command.name === "install") {
      const packageRoot = dependencies.packageRoot ?? environment.OWNLOOP_PACKAGE_ROOT;
      if (packageRoot === undefined) return { ok: false, error: { code: "package_unavailable" } };
      const sid = await (dependencies.userSid ?? defaultUserSid)();
      if (!SID_PATTERN.test(sid)) return { ok: false, error: { code: "acl_failed" } };
      const [userLauncher, hookLauncher, codexHookLauncher] = await Promise.all([
        readFile(join(packageRoot, "launchers", "installed-ownloop.cmd"), "utf8"),
        readFile(join(packageRoot, "launchers", "installed-ownloop-hook.cmd"), "utf8"),
        readFile(join(packageRoot, "launchers", "installed-ownloop-codex-hook.cmd"), "utf8"),
      ]);
      const result = await (dependencies.installImplementation ?? installOwnLoop)({
        sourcePackageRoot: packageRoot,
        layout,
        claudeSettingsPath,
        codexSettingsPath,
        userSid: sid,
        userLauncher,
        hookLauncher,
        codexHookLauncher,
      });
      return { ok: true, command: "install", installId: result.installId, created: result.created };
    }
    if (command.name === "start") {
      const result = await (dependencies.startImplementation ?? startInstalledRuntime)(
        runtimePaths,
        dependencies,
      );
      if (result.result !== "running" || result.state === null) {
        return { ok: false, error: { code: "start_failed" } };
      }
      return {
        ok: true,
        command: "start",
        status: result.result,
        instanceId: result.state.instanceId,
        phase: result.state.phase,
        pid: result.state.pid,
        url: `http://127.0.0.1:${result.state.port}/`,
      };
    }
    if (command.name === "status") {
      const result = await (dependencies.probeImplementation ?? probeInstalledRuntime)(
        runtimePaths,
        dependencies,
      );
      return {
        ok: true,
        command: "status",
        status: result.result,
        ...(result.result === "running" && result.state !== null
          ? {
              instanceId: result.state.instanceId,
              phase: result.state.phase,
              pid: result.state.pid,
              url: `http://127.0.0.1:${result.state.port}/`,
            }
          : {}),
      };
    }
    if (command.name === "open") {
      const result = await (dependencies.probeImplementation ?? probeInstalledRuntime)(
        runtimePaths,
        dependencies,
      );
      if (result.result !== "running" || result.state === null)
        return { ok: false, error: { code: result.result } };
      const url = `http://127.0.0.1:${result.state.port}/`;
      await (dependencies.openUrl ?? defaultOpenUrl)(url);
      return { ok: true, command: "open", url };
    }
    if (command.name === "stop") {
      await (dependencies.stopImplementation ?? stopInstalledRuntime)(runtimePaths, dependencies);
      return { ok: true, command: "stop", status: "stopped" };
    }
    if (command.name === "codex_doctor") {
      const result = await runCodexDoctor({ ...layout, codexSettingsPath }, dependencies);
      return { ok: true, command: "codex doctor", ...result };
    }
    if (command.name === "codex_hooks_status") {
      const status = await inspectCodexHooksFile(
        codexSettingsPath,
        codexLauncherCommands(layout),
      );
      try {
        const manifest = await verifyHookInstallation(layout, { allowMissing: true });
        if (manifest === null) {
          return {
            ok: true,
            command: "codex hooks status",
            status: status === "missing" ? "missing" : "repair_needed",
          };
        }
        return { ok: true, command: "codex hooks status", status };
      } catch {
        return { ok: true, command: "codex hooks status", status: "repair_needed" };
      }
    }
    if (command.name === "hooks_status") {
      const [claudeStatus, codexStatus] = await Promise.all([
        inspectClaudeHooksFile(claudeSettingsPath, layout.stableHookLauncherPath),
        inspectCodexHooksFile(codexSettingsPath, codexLauncherCommands(layout)),
      ]);
      const status = combinedHooksStatus(claudeStatus, codexStatus);
      try {
        const manifest = await verifyHookInstallation(layout, { allowMissing: true });
        if (manifest === null) {
          const cleanAbsence = claudeStatus === "missing" && codexStatus === "missing";
          return {
            ok: true,
            command: "hooks status",
            status: cleanAbsence ? "missing" : "repair_needed",
          };
        }
        return { ok: true, command: "hooks status", status };
      } catch {
        return { ok: true, command: "hooks status", status: "repair_needed" };
      }
    }
    const manifest = await verifyHookInstallation(layout);
    if (manifest === null) return { ok: false, error: { code: "repair_needed" } };
    if (command.name === "codex_hooks_install") {
      const result = await installConfiguredCodexHooks({
        layout,
        codexSettingsPath,
        manifest,
      });
      return { ok: true, command: "codex hooks install", changed: result.changed };
    }
    if (command.name === "codex_hooks_remove") {
      const result = await removeConfiguredCodexHooks({
        layout,
        codexSettingsPath,
        manifest,
      });
      return { ok: true, command: "codex hooks remove", changed: result.changed };
    }
    if (command.name === "hooks_install") {
      const result = await installConfiguredHooks({
        layout,
        claudeSettingsPath,
        codexSettingsPath,
        manifest,
      });
      return { ok: true, command: "hooks install", changed: result.changed };
    }
    if (command.name === "hooks_remove") {
      const result = await removeConfiguredHooks({
        layout,
        claudeSettingsPath,
        codexSettingsPath,
        manifest,
      });
      return { ok: true, command: "hooks remove", changed: result.changed };
    }
    const result = await (dependencies.uninstallImplementation ?? uninstallOwnLoop)({
      layout,
      claudeSettingsPath,
      codexSettingsPath,
      dataMode: command.dataMode,
      ...(command.dataMode === "remove"
        ? { confirmationInstallId: command.confirmationInstallId }
        : {}),
      stopRuntime: () =>
        (dependencies.stopImplementation ?? stopInstalledRuntime)(runtimePaths, dependencies),
    });
    return {
      ok: true,
      command: "uninstall",
      dataPreserved: result.dataPreserved,
      ...(result.dataPreserved ? { dataPath: layout.dataRoot } : {}),
    };
  } catch (error) {
    return controlledError(error);
  }
}

async function main(): Promise<void> {
  const response = await executeCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = response.ok ? 0 : 1;
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  void main().catch(() => {
    process.stdout.write('{"ok":false,"error":{"code":"operation_failed"}}\n');
    process.exitCode = 1;
  });
}
