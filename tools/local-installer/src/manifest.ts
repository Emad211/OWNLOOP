import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_DAEMON_VERSION,
  OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
  OWNLOOP_HOOK_ADAPTER_CONTRACT_VERSION,
  OWNLOOP_HOOK_ADAPTER_VERSION,
  OWNLOOP_INSTALL_LAYOUT_VERSION,
  OWNLOOP_RELEASE_MANIFEST_FILE,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_REQUIRED_PNPM_VERSION,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  OWNLOOP_WEB_VERSION,
  type OwnLoopReleaseFileV1,
  type OwnLoopReleaseManifestV1,
  OwnLoopReleaseManifestV1Schema,
} from "@ownloop/contracts";

export class ReleasePackageError extends Error {
  readonly code:
    | "invalid_root"
    | "unsafe_entry"
    | "missing_file"
    | "extra_file"
    | "digest_mismatch"
    | "manifest_mismatch"
    | "operation_failed";

  constructor(code: ReleasePackageError["code"]) {
    super("The release package failed deterministic verification.");
    this.name = "ReleasePackageError";
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

function canonicalRoot(root: string): string {
  if (!isAbsolute(root) || root.includes("\0")) throw new ReleasePackageError("invalid_root");
  return resolve(root);
}

function canonicalRelative(root: string, path: string): string {
  const value = relative(root, path);
  if (value === "" || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    throw new ReleasePackageError("unsafe_entry");
  }
  return value.split(sep).join("/");
}

async function hashFile(path: string): Promise<{ sizeBytes: number; sha256: string }> {
  const bytes = await readFile(path);
  return {
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function scanDirectory(
  root: string,
  directory: string,
  executableCriticalPaths: ReadonlySet<string>,
  result: OwnLoopReleaseFileV1[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new ReleasePackageError("operation_failed");
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const relativePath = canonicalRelative(root, absolute);
    if (relativePath === OWNLOOP_RELEASE_MANIFEST_FILE) continue;
    const stats = await lstat(absolute).catch(() => {
      throw new ReleasePackageError("operation_failed");
    });
    if (stats.isSymbolicLink()) throw new ReleasePackageError("unsafe_entry");
    if (stats.isDirectory()) {
      await scanDirectory(root, absolute, executableCriticalPaths, result);
      continue;
    }
    if (!stats.isFile()) throw new ReleasePackageError("unsafe_entry");
    const digest = await hashFile(absolute);
    result.push({
      path: relativePath,
      ...digest,
      executableCritical: executableCriticalPaths.has(relativePath),
    });
  }
}

export function computeReleaseManifestFingerprint(
  manifest: Omit<OwnLoopReleaseManifestV1, "fingerprint">,
): `sha256:${string}` {
  const canonical = JSON.stringify(manifest);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export async function buildReleaseManifest(
  packageRoot: string,
  executableCriticalPaths: readonly string[],
): Promise<OwnLoopReleaseManifestV1> {
  const root = canonicalRoot(packageRoot);
  const critical = new Set(executableCriticalPaths);
  if (critical.size !== executableCriticalPaths.length || critical.size === 0) {
    throw new ReleasePackageError("manifest_mismatch");
  }
  const files: OwnLoopReleaseFileV1[] = [];
  await scanDirectory(root, root, critical, files);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if ([...critical].some((path) => !files.some((file) => file.path === path))) {
    throw new ReleasePackageError("missing_file");
  }
  const unsigned = {
    schemaVersion: 1 as const,
    applicationVersion: OWNLOOP_APPLICATION_VERSION,
    daemonVersion: OWNLOOP_DAEMON_VERSION,
    hookAdapterVersion: OWNLOOP_HOOK_ADAPTER_VERSION,
    hookAdapterContractVersion: OWNLOOP_HOOK_ADAPTER_CONTRACT_VERSION,
    webVersion: OWNLOOP_WEB_VERSION,
    expectedDatabaseSchemaVersion: OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
    platform: OWNLOOP_SUPPORTED_PLATFORM,
    architecture: OWNLOOP_SUPPORTED_ARCHITECTURE,
    nodeVersion: OWNLOOP_REQUIRED_NODE_VERSION,
    packagingPnpmVersion: OWNLOOP_REQUIRED_PNPM_VERSION,
    installLayoutVersion: OWNLOOP_INSTALL_LAYOUT_VERSION,
    files,
  };
  return OwnLoopReleaseManifestV1Schema.parse({
    ...unsigned,
    fingerprint: computeReleaseManifestFingerprint(unsigned),
  });
}

export async function verifyReleasePackage(
  packageRoot: string,
  manifestInput: unknown,
): Promise<OwnLoopReleaseManifestV1> {
  let manifest: OwnLoopReleaseManifestV1;
  try {
    manifest = OwnLoopReleaseManifestV1Schema.parse(manifestInput);
  } catch {
    throw new ReleasePackageError("manifest_mismatch");
  }
  const { fingerprint: _fingerprint, ...unsigned } = manifest;
  if (computeReleaseManifestFingerprint(unsigned) !== manifest.fingerprint) {
    throw new ReleasePackageError("manifest_mismatch");
  }
  const rescanned = await buildReleaseManifest(
    packageRoot,
    manifest.files.filter((file) => file.executableCritical).map((file) => file.path),
  );
  const expectedByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const actualByPath = new Map(rescanned.files.map((file) => [file.path, file]));
  for (const expected of manifest.files) {
    const actual = actualByPath.get(expected.path);
    if (actual === undefined) throw new ReleasePackageError("missing_file");
    if (
      actual.sizeBytes !== expected.sizeBytes ||
      actual.sha256 !== expected.sha256 ||
      actual.executableCritical !== expected.executableCritical
    ) {
      throw new ReleasePackageError("digest_mismatch");
    }
  }
  for (const actual of rescanned.files) {
    if (!expectedByPath.has(actual.path)) throw new ReleasePackageError("extra_file");
  }
  return manifest;
}

export async function readAndVerifyReleasePackage(
  packageRoot: string,
): Promise<OwnLoopReleaseManifestV1> {
  const root = canonicalRoot(packageRoot);
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(resolve(root, OWNLOOP_RELEASE_MANIFEST_FILE));
  } catch (error) {
    throw new ReleasePackageError(fsCode(error) === "ENOENT" ? "missing_file" : "operation_failed");
  }
  if (manifestBytes.byteLength > 16 * 1024 * 1024)
    throw new ReleasePackageError("manifest_mismatch");
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new ReleasePackageError("manifest_mismatch");
  }
  return verifyReleasePackage(root, parsed);
}
