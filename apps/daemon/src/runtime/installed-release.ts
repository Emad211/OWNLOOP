import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

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
const ACL_SID_PATTERN = /^S-1-[0-9]+(?:-[0-9]+)+$/u;

function encodedPowerShellUtf8Value(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`;
}

function encodedPowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function buildInstalledAclVerificationCommand(
  configRoot: string,
  secretsPath: string,
): readonly string[] {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$ConfigRoot=${encodedPowerShellUtf8Value(configRoot)}`,
    `$SecretsPath=${encodedPowerShellUtf8Value(secretsPath)}`,
    "if(-not [System.IO.Directory]::Exists($ConfigRoot)){throw 'missing_config'}",
    "if(-not [System.IO.File]::Exists($SecretsPath)){throw 'missing_secrets'}",
    "$userSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "function ConvertAclToJson([System.Security.AccessControl.FileSystemSecurity]$Acl){$rules=$Acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);$entries=[System.Collections.Generic.List[string]]::new();for($index=0;$index -lt $rules.Count;$index++){$entry=$rules[$index];$sidValue=$entry.IdentityReference.Value;$typeValue=$entry.AccessControlType.ToString();$rightsValue=$entry.FileSystemRights.ToString();$inheritanceValue=$entry.InheritanceFlags.ToString();$propagationValue=$entry.PropagationFlags.ToString();$inheritedValue=$entry.IsInherited.ToString().ToLowerInvariant();if(-not [System.Text.RegularExpressions.Regex]::IsMatch($sidValue,'^S-1-[0-9]+(?:-[0-9]+)+$')){throw 'invalid_acl_sid'};foreach($enumValue in @($typeValue,$rightsValue,$inheritanceValue,$propagationValue)){if(-not [System.Text.RegularExpressions.Regex]::IsMatch($enumValue,'^[A-Za-z]+(?:, [A-Za-z]+)*$')){throw 'invalid_acl_enum'}};$ignored=$entries.Add('{\"sid\":\"'+$sidValue+'\",\"type\":\"'+$typeValue+'\",\"rights\":\"'+$rightsValue+'\",\"inheritance\":\"'+$inheritanceValue+'\",\"propagation\":\"'+$propagationValue+'\",\"inherited\":'+$inheritedValue+'}')};$protectedValue=$Acl.AreAccessRulesProtected.ToString().ToLowerInvariant();return '{\"protected\":'+$protectedValue+',\"entries\":['+[string]::Join(',',$entries)+']}' }",
    "$configAcl=[System.IO.Directory]::GetAccessControl($ConfigRoot,[System.Security.AccessControl.AccessControlSections]::Access)",
    "$secretsAcl=[System.IO.File]::GetAccessControl($SecretsPath,[System.Security.AccessControl.AccessControlSections]::Access)",
    "$configJson=ConvertAclToJson $configAcl",
    "$secretsJson=ConvertAclToJson $secretsAcl",
    "[Console]::Out.Write('{\"userSid\":\"'+$userSid+'\",\"items\":['+$configJson+','+$secretsJson+']}')",
  ].join(";");
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedPowerShellCommand(script)];
}

async function verifyDefaultPrivateAcl(configRoot: string, secretsPath: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [...buildInstalledAclVerificationCommand(configRoot, secretsPath)],
      { windowsHide: true, timeout: 10_000 },
    );
    const parsed = parseStrictJsonObject(stdout.trim(), 64 * 1024);
    const userSid = parsed.userSid;
    const items = parsed.items;
    if (
      typeof userSid !== "string" ||
      !ACL_SID_PATTERN.test(userSid) ||
      !Array.isArray(items) ||
      items.length !== 2
    ) {
      return false;
    }
    return items.every((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      const record = item as Record<string, unknown>;
      if (index === 0 && record.protected !== true) return false;
      if (!Array.isArray(record.entries) || record.entries.length !== 1) return false;
      const entry = record.entries[0];
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const access = entry as Record<string, unknown>;
      const inheritance = String(access.inheritance)
        .split(",")
        .map((part) => part.trim());
      if (
        access.sid !== userSid ||
        access.type !== "Allow" ||
        typeof access.inherited !== "boolean" ||
        access.propagation !== "None" ||
        !String(access.rights)
          .split(",")
          .map((part) => part.trim())
          .includes("FullControl")
      ) {
        return false;
      }
      return (
        index !== 0 ||
        (access.inherited === false &&
          inheritance.includes("ContainerInherit") &&
          inheritance.includes("ObjectInherit"))
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
