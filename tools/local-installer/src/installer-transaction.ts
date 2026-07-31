import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_RELEASE_MANIFEST_FILE,
  OWNLOOP_STABLE_CODEX_HOOK_LAUNCHER_FILE,
  OWNLOOP_STABLE_HOOK_LAUNCHER_FILE,
  OWNLOOP_STABLE_USER_LAUNCHER_FILE,
  SUPPORTED_CLAUDE_HOOK_NAMES,
  type OwnLoopInstallManifestV1,
} from "@ownloop/contracts";

import { ensurePrivateWindowsAcl, type AclCommandRunner } from "./acl.js";
import { installClaudeHooksFile, removeClaudeHooksFile } from "./claude-settings.js";
import { readInstallManifest, writeInstallManifestAtomic } from "./install-manifest.js";
import { readAndVerifyReleasePackage, verifyReleasePackage } from "./manifest.js";
import { stopInstalledRuntime } from "./runtime-operations.js";
import { readInstalledRuntimeState } from "./runtime-state-file.js";
import { createOrReadInstallationSecrets, readInstallationSecrets } from "./secrets.js";

export type NativeInstallLayout = Readonly<{
  root: string;
  appRoot: string;
  releaseRoot: string;
  binRoot: string;
  configRoot: string;
  dataRoot: string;
  artifactRoot: string;
  databasePath: string;
  runRoot: string;
  installManifestPath: string;
  secretsPath: string;
  runtimeStatePath: string;
  stableUserLauncherPath: string;
  stableHookLauncherPath: string;
  stableCodexHookLauncherPath: string;
}>;

export class InstallerTransactionError extends Error {
  readonly code:
    | "invalid_layout"
    | "ambiguous_layout"
    | "package_invalid"
    | "acl_failed"
    | "install_failed"
    | "uninstall_failed"
    | "confirmation_required";
  constructor(code: InstallerTransactionError["code"]) {
    super("The OwnLoop installation transaction failed safely.");
    this.name = "InstallerTransactionError";
    this.code = code;
  }
}

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

export function createNativeInstallLayout(rootInput: string): NativeInstallLayout {
  if (!isAbsolute(rootInput) || rootInput.includes("\0"))
    throw new InstallerTransactionError("invalid_layout");
  const root = resolve(rootInput);
  if (basename(root).toLowerCase() !== "ownloop")
    throw new InstallerTransactionError("invalid_layout");
  const appRoot = join(root, "app");
  const binRoot = join(root, "bin");
  const configRoot = join(root, "config");
  const dataRoot = join(root, "data");
  const runRoot = join(root, "run");
  return {
    root,
    appRoot,
    releaseRoot: join(appRoot, OWNLOOP_APPLICATION_VERSION),
    binRoot,
    configRoot,
    dataRoot,
    artifactRoot: join(dataRoot, "artifacts"),
    databasePath: join(dataRoot, "ownloop.sqlite"),
    runRoot,
    installManifestPath: join(root, "install-manifest.json"),
    secretsPath: join(configRoot, "secrets-v1.json"),
    runtimeStatePath: join(runRoot, "runtime-v1.json"),
    stableUserLauncherPath: join(binRoot, OWNLOOP_STABLE_USER_LAUNCHER_FILE),
    stableHookLauncherPath: join(binRoot, OWNLOOP_STABLE_HOOK_LAUNCHER_FILE),
    stableCodexHookLauncherPath: join(binRoot, OWNLOOP_STABLE_CODEX_HOOK_LAUNCHER_FILE),
  };
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

async function statsOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (fsCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function rejectSymlinkTree(path: string): Promise<void> {
  const stats = await statsOrNull(path);
  if (stats === null) return;
  if (stats.isSymbolicLink()) throw new InstallerTransactionError("ambiguous_layout");
  if (!stats.isDirectory()) return;
  for (const entry of await readdir(path)) await rejectSymlinkTree(join(path, entry));
}

async function assertKnownRoot(layout: NativeInstallLayout): Promise<void> {
  const expected = createNativeInstallLayout(layout.root);
  for (const key of Object.keys(expected) as (keyof NativeInstallLayout)[]) {
    const actualValue = process.platform === "win32" ? layout[key].toLowerCase() : layout[key];
    const expectedValue =
      process.platform === "win32" ? expected[key].toLowerCase() : expected[key];
    if (actualValue !== expectedValue) throw new InstallerTransactionError("invalid_layout");
  }
  if (!within(layout.root, layout.releaseRoot) || !within(layout.root, layout.dataRoot)) {
    throw new InstallerTransactionError("invalid_layout");
  }
  const rootStats = await statsOrNull(layout.root);
  if (rootStats === null) return;
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
    throw new InstallerTransactionError("ambiguous_layout");
  const allowed = new Set(["app", "bin", "config", "data", "run", "install-manifest.json"]);
  for (const entry of await readdir(layout.root)) {
    if (!allowed.has(entry)) throw new InstallerTransactionError("ambiguous_layout");
  }
  await rejectSymlinkTree(layout.appRoot);
  await rejectSymlinkTree(layout.binRoot);
  await rejectSymlinkTree(layout.configRoot);
  await rejectSymlinkTree(layout.dataRoot);
  await rejectSymlinkTree(layout.runRoot);
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) throw new InstallerTransactionError("package_invalid");
  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: false, mode: 0o700 });
    for (const entry of (await readdir(source)).sort()) {
      await copyTree(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!stats.isFile()) throw new InstallerTransactionError("package_invalid");
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

type FileSnapshot = Readonly<{ existed: boolean; bytes: Buffer | null }>;
async function snapshot(path: string): Promise<FileSnapshot> {
  const stats = await statsOrNull(path);
  if (stats === null) return { existed: false, bytes: null };
  if (stats.isSymbolicLink() || !stats.isFile())
    throw new InstallerTransactionError("ambiguous_layout");
  return { existed: true, bytes: await readFile(path) };
}

async function restore(path: string, value: FileSnapshot): Promise<void> {
  if (!value.existed) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.restore-${randomUUID()}`;
  await writeFile(temporary, value.bytes!, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function removeEmpty(path: string): Promise<void> {
  await rmdir(path).catch((error: unknown) => {
    if (fsCode(error) !== "ENOENT" && fsCode(error) !== "ENOTEMPTY") throw error;
  });
}

export type InstallOwnLoopOptions = Readonly<{
  sourcePackageRoot: string;
  layout: NativeInstallLayout;
  claudeSettingsPath: string;
  userSid: string;
  userLauncher: string;
  hookLauncher: string;
  clock?: () => Date;
  aclRunner?: AclCommandRunner;
}>;

export async function installOwnLoop(
  options: InstallOwnLoopOptions,
): Promise<{ installId: string; created: boolean }> {
  const clock = options.clock ?? (() => new Date());
  await assertKnownRoot(options.layout);
  const sourceManifest = await readAndVerifyReleasePackage(options.sourcePackageRoot).catch(() => {
    throw new InstallerTransactionError("package_invalid");
  });
  const settingsSnapshot = await snapshot(options.claudeSettingsPath);
  const userLauncherSnapshot = await snapshot(options.layout.stableUserLauncherPath);
  const hookLauncherSnapshot = await snapshot(options.layout.stableHookLauncherPath);
  const installManifestSnapshot = await snapshot(options.layout.installManifestPath);
  const secretsSnapshot = await snapshot(options.layout.secretsPath);
  const existingRelease = await statsOrNull(options.layout.releaseRoot);
  const originalDirectories = new Map(
    await Promise.all(
      [
        options.layout.root,
        options.layout.appRoot,
        options.layout.binRoot,
        options.layout.configRoot,
        options.layout.dataRoot,
        options.layout.artifactRoot,
        options.layout.runRoot,
      ].map(async (path) => [path, (await statsOrNull(path)) !== null] as const),
    ),
  );
  const previousManifest = installManifestSnapshot.existed
    ? await readInstallManifest(options.layout.installManifestPath).catch(() => {
        throw new InstallerTransactionError("ambiguous_layout");
      })
    : null;
  let releaseCreated = false;
  let settingsChanged = false;
  const staging = `${options.layout.releaseRoot}.staging-${randomUUID()}`;
  try {
    await mkdir(options.layout.root, { recursive: true, mode: 0o700 });
    await mkdir(options.layout.appRoot, { recursive: true, mode: 0o700 });
    if (existingRelease === null) {
      await copyTree(options.sourcePackageRoot, staging);
      await verifyReleasePackage(staging, sourceManifest);
      await rename(staging, options.layout.releaseRoot);
      releaseCreated = true;
    } else {
      if (existingRelease.isSymbolicLink() || !existingRelease.isDirectory()) {
        throw new InstallerTransactionError("ambiguous_layout");
      }
      const installedRelease = await readAndVerifyReleasePackage(options.layout.releaseRoot);
      if (installedRelease.fingerprint !== sourceManifest.fingerprint) {
        throw new InstallerTransactionError("ambiguous_layout");
      }
    }

    for (const directory of [
      options.layout.binRoot,
      options.layout.configRoot,
      options.layout.dataRoot,
      options.layout.artifactRoot,
      options.layout.runRoot,
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    for (const directory of [
      options.layout.configRoot,
      options.layout.dataRoot,
      options.layout.runRoot,
    ]) {
      await ensurePrivateWindowsAcl(directory, options.userSid, options.aclRunner).catch(() => {
        throw new InstallerTransactionError("acl_failed");
      });
    }

    const { secrets, created } = await createOrReadInstallationSecrets(
      options.layout.secretsPath,
      clock,
    );
    await writeFile(options.layout.stableUserLauncherPath, options.userLauncher, { mode: 0o700 });
    await writeFile(options.layout.stableHookLauncherPath, options.hookLauncher, { mode: 0o700 });
    const hookResult = await installClaudeHooksFile(
      options.claudeSettingsPath,
      options.layout.stableHookLauncherPath,
      clock,
    );
    settingsChanged = hookResult.changed;
    const manifest: OwnLoopInstallManifestV1 = {
      schemaVersion: 1,
      installId: secrets.installId,
      applicationVersion: "0.1.0",
      releaseDirectoryName: "0.1.0",
      releaseManifestFingerprint: sourceManifest.fingerprint,
      installLayoutVersion: 1,
      hooks: SUPPORTED_CLAUDE_HOOK_NAMES.map((event) => ({
        event,
        command: options.layout.stableHookLauncherPath,
      })),
      claudeSettings:
        !hookResult.changed && previousManifest !== null
          ? previousManifest.claudeSettings
          : hookResult.mutation,
      installedAt: previousManifest?.installedAt ?? clock().toISOString(),
    };
    await writeInstallManifestAtomic(options.layout.installManifestPath, manifest);
    return { installId: secrets.installId, created };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (settingsChanged)
      await restore(options.claudeSettingsPath, settingsSnapshot).catch(() => undefined);
    await restore(options.layout.stableUserLauncherPath, userLauncherSnapshot).catch(
      () => undefined,
    );
    await restore(options.layout.stableHookLauncherPath, hookLauncherSnapshot).catch(
      () => undefined,
    );
    await restore(options.layout.installManifestPath, installManifestSnapshot).catch(
      () => undefined,
    );
    await restore(options.layout.secretsPath, secretsSnapshot).catch(() => undefined);
    if (releaseCreated)
      await rm(options.layout.releaseRoot, { recursive: true, force: true }).catch(() => undefined);
    for (const directory of [
      options.layout.artifactRoot,
      options.layout.runRoot,
      options.layout.configRoot,
      options.layout.binRoot,
      options.layout.dataRoot,
      options.layout.appRoot,
      options.layout.root,
    ]) {
      if (originalDirectories.get(directory) === false) {
        await removeEmpty(directory).catch(() => undefined);
      }
    }
    if (error instanceof InstallerTransactionError) throw error;
    throw new InstallerTransactionError("install_failed");
  }
}

export type UninstallOwnLoopOptions = Readonly<{
  layout: NativeInstallLayout;
  claudeSettingsPath: string;
  dataMode: "preserve" | "remove";
  confirmationInstallId?: string;
  clock?: () => Date;
  stopRuntime?: () => Promise<void>;
}>;

export async function uninstallOwnLoop(
  options: UninstallOwnLoopOptions,
): Promise<{ dataPreserved: boolean }> {
  await assertKnownRoot(options.layout);
  const manifest = await readInstallManifest(options.layout.installManifestPath).catch(() => {
    throw new InstallerTransactionError("ambiguous_layout");
  });
  const release = await readAndVerifyReleasePackage(options.layout.releaseRoot).catch(() => {
    throw new InstallerTransactionError("ambiguous_layout");
  });
  const secrets = await readInstallationSecrets(options.layout.secretsPath).catch(() => null);
  if (
    secrets === null ||
    secrets.installId !== manifest.installId ||
    release.fingerprint !== manifest.releaseManifestFingerprint ||
    manifest.hooks.some(
      (hook) => resolve(hook.command) !== resolve(options.layout.stableHookLauncherPath),
    )
  ) {
    throw new InstallerTransactionError("ambiguous_layout");
  }
  if (options.dataMode === "remove" && options.confirmationInstallId !== manifest.installId) {
    throw new InstallerTransactionError("confirmation_required");
  }
  const settingsSnapshot = await snapshot(options.claudeSettingsPath);
  let hooksChanged = false;
  try {
    const removal = await removeClaudeHooksFile(
      options.claudeSettingsPath,
      options.layout.stableHookLauncherPath,
      manifest.claudeSettings,
      options.clock,
    );
    hooksChanged = removal.changed;
    try {
      await (options.stopRuntime ?? (() => stopInstalledRuntime(options.layout)))();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "not_running")) throw error;
    }
  } catch {
    if (hooksChanged)
      await restore(options.claudeSettingsPath, settingsSnapshot).catch(() => undefined);
    throw new InstallerTransactionError("uninstall_failed");
  }

  try {
    if ((await readInstalledRuntimeState(options.layout.runtimeStatePath)) !== null) {
      throw new InstallerTransactionError("uninstall_failed");
    }
    await rm(options.layout.stableUserLauncherPath, { force: true });
    await rm(options.layout.stableHookLauncherPath, { force: true });
    await rm(options.layout.releaseRoot, { recursive: true, force: false });
    await rm(options.layout.installManifestPath, { force: false });
    await rm(options.layout.secretsPath, { force: false });
    if (options.dataMode === "remove") {
      await rejectSymlinkTree(options.layout.dataRoot);
      await rm(options.layout.dataRoot, { recursive: true, force: true });
    }
    await rm(options.layout.runtimeStatePath, { force: true });
    await removeEmpty(options.layout.runRoot);
    await removeEmpty(options.layout.configRoot);
    await removeEmpty(options.layout.binRoot);
    await removeEmpty(options.layout.appRoot);
    await removeEmpty(options.layout.root);
    return { dataPreserved: options.dataMode === "preserve" };
  } catch (error) {
    if (error instanceof InstallerTransactionError) throw error;
    throw new InstallerTransactionError("uninstall_failed");
  }
}
