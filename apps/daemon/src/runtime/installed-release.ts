import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_RELEASE_MANIFEST_FILE,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_SECRETS_FILE,
  OWNLOOP_STABLE_HOOK_LAUNCHER_FILE,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  OwnLoopInstallationSecretsV1Schema,
  OwnLoopInstallManifestV1Schema,
  OwnLoopReleaseManifestV1Schema,
  parseStrictJsonObject,
  type OwnLoopInstallationSecretsV1,
  type OwnLoopInstallManifestV1,
  type OwnLoopReleaseFileV1,
  type OwnLoopReleaseManifestV1,
} from "@ownloop/contracts";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const ACL_VERIFY_SCRIPT = [
  "param([string]$ConfigRoot,[string]$SecretsPath)",
  "$ErrorActionPreference='Stop'",
  "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$items=@($ConfigRoot,$SecretsPath|ForEach-Object{$acl=Get-Acl -LiteralPath $_;[pscustomobject]@{path=$_;protected=$acl.AreAccessRulesProtected;entries=@($acl.Access|ForEach-Object{[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();rights=$_.FileSystemRights.ToString()}})}})",
  "[pscustomobject]@{userSid=$sid;items=$items}|ConvertTo-Json -Compress -Depth 6",
].join(";");

async function verifyDefaultPrivateAcl(configRoot: string, secretsPath: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        ACL_VERIFY_SCRIPT,
        "-ConfigRoot",
        configRoot,
        "-SecretsPath",
        secretsPath,
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const parsed = parseStrictJsonObject(stdout.trim(), 64 * 1024);
    const userSid = parsed.userSid;
    const items = parsed.items;
    if (typeof userSid !== "string" || !Array.isArray(items) || items.length !== 2) return false;
    return items.every((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      if (index === 0 && record.protected !== true) return false;
      if (!Array.isArray(record.entries) || record.entries.length !== 1) return false;
      const entry = record.entries[0];
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const access = entry as Record<string, unknown>;
      return (
        access.sid === userSid &&
        access.type === "Allow" &&
        String(access.rights)
          .split(",")
          .map((part) => part.trim())
          .includes("FullControl")
      );
    });
  } catch {
    return false;
  }
}

const MAX_SECRET_BYTES = 16 * 1024;

export class InstalledReleaseError extends Error {
  readonly code:
    | "unsupported_environment"
    | "invalid_layout"
    | "unsafe_file"
    | "invalid_manifest"
    | "package_mismatch"
    | "installation_mismatch"
    | "acl_unverified";
  constructor(code: InstalledReleaseError["code"]) {
    super("The installed OwnLoop release failed startup verification.");
    this.name = "InstalledReleaseError";
    this.code = code;
  }
}

export type InstalledRuntimePaths = Readonly<{
  root: string;
  releaseRoot: string;
  binRoot: string;
  configRoot: string;
  dataRoot: string;
  databasePath: string;
  artifactRoot: string;
  runRoot: string;
  installManifestPath: string;
  secretsPath: string;
  runtimeStatePath: string;
  webRoot: string;
  stableHookLauncherPath: string;
}>;

export type VerifiedInstalledRuntime = Readonly<{
  paths: InstalledRuntimePaths;
  releaseManifest: OwnLoopReleaseManifestV1;
  installManifest: OwnLoopInstallManifestV1;
  secrets: OwnLoopInstallationSecretsV1;
}>;

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

export function deriveInstalledRuntimePaths(localAppData: string): InstalledRuntimePaths {
  if (!isAbsolute(localAppData) || localAppData.includes("\0"))
    throw new InstalledReleaseError("invalid_layout");
  const root = join(resolve(localAppData), "OwnLoop");
  const releaseRoot = join(root, "app", OWNLOOP_APPLICATION_VERSION);
  const configRoot = join(root, "config");
  const dataRoot = join(root, "data");
  const runRoot = join(root, "run");
  return {
    root,
    releaseRoot,
    binRoot: join(root, "bin"),
    configRoot,
    dataRoot,
    databasePath: join(dataRoot, "ownloop.sqlite"),
    artifactRoot: join(dataRoot, "artifacts"),
    runRoot,
    installManifestPath: join(root, "install-manifest.json"),
    secretsPath: join(configRoot, OWNLOOP_SECRETS_FILE),
    runtimeStatePath: join(runRoot, "runtime-v1.json"),
    webRoot: join(releaseRoot, "web"),
    stableHookLauncherPath: join(root, "bin", OWNLOOP_STABLE_HOOK_LAUNCHER_FILE),
  };
}

async function strictFile(path: string, maximum: number): Promise<Record<string, unknown>> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > maximum) {
      throw new InstalledReleaseError("unsafe_file");
    }
    return parseStrictJsonObject((await readFile(path)).toString("utf8"), maximum);
  } catch (error) {
    if (error instanceof InstalledReleaseError) throw error;
    throw new InstalledReleaseError(fsCode(error) === "ENOENT" ? "invalid_layout" : "unsafe_file");
  }
}

function fingerprint(manifest: Omit<OwnLoopReleaseManifestV1, "fingerprint">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex")}`;
}

async function scan(
  root: string,
  directory: string,
  output: OwnLoopReleaseFileV1[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new InstalledReleaseError("unsafe_file");
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const rawRelative = relative(root, path);
    if (
      rawRelative === "" ||
      isAbsolute(rawRelative) ||
      rawRelative === ".." ||
      rawRelative.startsWith(`..${sep}`)
    ) {
      throw new InstalledReleaseError("unsafe_file");
    }
    const relativePath = rawRelative.split(sep).join("/");
    if (relativePath === OWNLOOP_RELEASE_MANIFEST_FILE) continue;
    const stats = await lstat(path).catch(() => {
      throw new InstalledReleaseError("unsafe_file");
    });
    if (stats.isSymbolicLink()) throw new InstalledReleaseError("unsafe_file");
    if (stats.isDirectory()) {
      await scan(root, path, output);
      continue;
    }
    if (!stats.isFile()) throw new InstalledReleaseError("unsafe_file");
    const bytes = await readFile(path);
    output.push({
      path: relativePath,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      executableCritical: false,
    });
  }
}

async function verifyPackage(root: string, manifest: OwnLoopReleaseManifestV1): Promise<void> {
  const { fingerprint: _value, ...unsigned } = manifest;
  if (fingerprint(unsigned) !== manifest.fingerprint)
    throw new InstalledReleaseError("invalid_manifest");
  const actual: OwnLoopReleaseFileV1[] = [];
  await scan(root, root, actual);
  actual.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (actual.length !== manifest.files.length) throw new InstalledReleaseError("package_mismatch");
  for (let index = 0; index < actual.length; index += 1) {
    const observed = actual[index]!;
    const expected = manifest.files[index]!;
    if (
      observed.path !== expected.path ||
      observed.sizeBytes !== expected.sizeBytes ||
      observed.sha256 !== expected.sha256
    ) {
      throw new InstalledReleaseError("package_mismatch");
    }
  }
}

export async function loadVerifiedInstalledRuntime(
  input: Readonly<{
    localAppData: string;
    platform?: string;
    architecture?: string;
    nodeVersion?: string;
    verifyPrivateAcl?: (configRoot: string, secretsPath: string) => Promise<boolean>;
  }>,
): Promise<VerifiedInstalledRuntime> {
  if (
    (input.platform ?? process.platform) !== OWNLOOP_SUPPORTED_PLATFORM ||
    (input.architecture ?? process.arch) !== OWNLOOP_SUPPORTED_ARCHITECTURE ||
    (input.nodeVersion ?? process.versions.node) !== OWNLOOP_REQUIRED_NODE_VERSION
  ) {
    throw new InstalledReleaseError("unsupported_environment");
  }
  const paths = deriveInstalledRuntimePaths(input.localAppData);
  let releaseManifest: OwnLoopReleaseManifestV1;
  let installManifest: OwnLoopInstallManifestV1;
  let secrets: OwnLoopInstallationSecretsV1;
  try {
    releaseManifest = OwnLoopReleaseManifestV1Schema.parse(
      await strictFile(join(paths.releaseRoot, OWNLOOP_RELEASE_MANIFEST_FILE), MAX_MANIFEST_BYTES),
    );
    installManifest = OwnLoopInstallManifestV1Schema.parse(
      await strictFile(paths.installManifestPath, MAX_MANIFEST_BYTES),
    );
    secrets = OwnLoopInstallationSecretsV1Schema.parse(
      await strictFile(paths.secretsPath, MAX_SECRET_BYTES),
    );
  } catch (error) {
    if (error instanceof InstalledReleaseError) throw error;
    throw new InstalledReleaseError("invalid_manifest");
  }
  await verifyPackage(paths.releaseRoot, releaseManifest);
  if (
    installManifest.installId !== secrets.installId ||
    installManifest.releaseManifestFingerprint !== releaseManifest.fingerprint ||
    installManifest.hooks.some(
      (hook) => resolve(hook.command) !== resolve(paths.stableHookLauncherPath),
    )
  ) {
    throw new InstalledReleaseError("installation_mismatch");
  }
  const verified = await (input.verifyPrivateAcl ?? verifyDefaultPrivateAcl)(
    paths.configRoot,
    paths.secretsPath,
  ).catch(() => false);
  if (!verified) throw new InstalledReleaseError("acl_unverified");
  return { paths, releaseManifest, installManifest, secrets };
}
