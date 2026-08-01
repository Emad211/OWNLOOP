import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { OwnLoopInstallManifestV1 } from "@ownloop/contracts";
import { CODEX_HOOK_LAUNCHER_BASENAME } from "@ownloop/contracts/codex";

import { installClaudeHooksFile, removeClaudeHooksFile } from "./claude-settings.js";
import { installCodexHooksFile, removeCodexHooksFile } from "./codex-hooks-file.js";
import { writeInstallManifestAtomic } from "./install-manifest.js";
import type { NativeInstallLayout } from "./installer-transaction.js";

export class HookReconciliationError extends Error {
  readonly code = "repair_needed" as const;

  constructor() {
    super("Installed Hook state requires repair.");
    this.name = "HookReconciliationError";
  }
}

type FileSnapshot = Readonly<{ existed: boolean; bytes: Buffer | null }>;

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function pathValue(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new HookReconciliationError();
  return resolve(path);
}

async function snapshot(pathInput: string): Promise<FileSnapshot> {
  const path = pathValue(pathInput);
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new HookReconciliationError();
    return { existed: true, bytes: await readFile(path) };
  } catch (error) {
    if (error instanceof HookReconciliationError) throw error;
    if (fsCode(error) === "ENOENT") return { existed: false, bytes: null };
    throw new HookReconciliationError();
  }
}

async function restore(pathInput: string, value: FileSnapshot): Promise<void> {
  const path = pathValue(pathInput);
  if (!value.existed) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.restore-${randomUUID()}`;
  await writeFile(temporary, value.bytes!, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function samePath(left: string, right: string): boolean {
  const actualLeft = resolve(left);
  const actualRight = resolve(right);
  return process.platform === "win32"
    ? actualLeft.toLowerCase() === actualRight.toLowerCase()
    : actualLeft === actualRight;
}

function codexCommands(layout: NativeInstallLayout) {
  return {
    command: CODEX_HOOK_LAUNCHER_BASENAME,
    commandWindows: layout.stableCodexHookLauncherPath,
  } as const;
}

function assertCodexOwnership(
  manifest: OwnLoopInstallManifestV1,
  layout: NativeInstallLayout,
): asserts manifest is OwnLoopInstallManifestV1 & {
  codexHooks: NonNullable<OwnLoopInstallManifestV1["codexHooks"]>;
} {
  if (
    manifest.codexHooks === undefined ||
    manifest.codexHooks.command !== CODEX_HOOK_LAUNCHER_BASENAME ||
    !samePath(manifest.codexHooks.commandWindows, layout.stableCodexHookLauncherPath)
  ) {
    throw new HookReconciliationError();
  }
}

export type ReconcileInstalledHooksOptions = Readonly<{
  layout: NativeInstallLayout;
  claudeSettingsPath: string;
  codexSettingsPath: string;
  manifest: OwnLoopInstallManifestV1;
  clock?: () => Date;
}>;

export async function installConfiguredHooks(
  options: ReconcileInstalledHooksOptions,
): Promise<{ changed: boolean; manifest: OwnLoopInstallManifestV1 }> {
  assertCodexOwnership(options.manifest, options.layout);
  const claudeSnapshot = await snapshot(options.claudeSettingsPath);
  const codexSnapshot = await snapshot(options.codexSettingsPath);
  const manifestSnapshot = await snapshot(options.layout.installManifestPath);
  try {
    const claude = await installClaudeHooksFile(
      options.claudeSettingsPath,
      options.layout.stableHookLauncherPath,
      options.clock,
    );
    const codex = await installCodexHooksFile(
      options.codexSettingsPath,
      codexCommands(options.layout),
      options.clock,
    );
    if (!claude.changed && !codex.changed) {
      return { changed: false, manifest: options.manifest };
    }
    const manifest: OwnLoopInstallManifestV1 = {
      ...options.manifest,
      claudeSettings: claude.changed ? claude.mutation : options.manifest.claudeSettings,
      codexHooks: {
        ...options.manifest.codexHooks,
        settings: codex.changed ? codex.mutation : options.manifest.codexHooks.settings,
      },
    };
    await writeInstallManifestAtomic(options.layout.installManifestPath, manifest);
    return { changed: true, manifest };
  } catch {
    await restore(options.layout.installManifestPath, manifestSnapshot).catch(() => undefined);
    await restore(options.codexSettingsPath, codexSnapshot).catch(() => undefined);
    await restore(options.claudeSettingsPath, claudeSnapshot).catch(() => undefined);
    throw new HookReconciliationError();
  }
}

export async function removeConfiguredHooks(
  options: ReconcileInstalledHooksOptions,
): Promise<{ changed: boolean }> {
  assertCodexOwnership(options.manifest, options.layout);
  const claudeSnapshot = await snapshot(options.claudeSettingsPath);
  const codexSnapshot = await snapshot(options.codexSettingsPath);
  try {
    const claude = await removeClaudeHooksFile(
      options.claudeSettingsPath,
      options.layout.stableHookLauncherPath,
      options.manifest.claudeSettings,
      options.clock,
    );
    const codex = await removeCodexHooksFile(
      options.codexSettingsPath,
      codexCommands(options.layout),
      options.manifest.codexHooks.settings,
      options.clock,
    );
    return { changed: claude.changed || codex.changed };
  } catch {
    await restore(options.codexSettingsPath, codexSnapshot).catch(() => undefined);
    await restore(options.claudeSettingsPath, claudeSnapshot).catch(() => undefined);
    throw new HookReconciliationError();
  }
}
