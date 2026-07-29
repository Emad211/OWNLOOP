import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { OwnLoopInstallManifestV1Schema, type OwnLoopInstallManifestV1 } from "@ownloop/contracts";

import { parseStrictJsonObject } from "./strict-json.js";

const MAX_INSTALL_MANIFEST_BYTES = 64 * 1024;

export class InstallManifestError extends Error {
  readonly code:
    | "invalid_path"
    | "unsafe_path"
    | "missing_manifest"
    | "invalid_manifest"
    | "operation_failed";
  constructor(code: InstallManifestError["code"]) {
    super("The installed release manifest is invalid or unavailable.");
    this.name = "InstallManifestError";
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

function target(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new InstallManifestError("invalid_path");
  return resolve(path);
}

export async function readInstallManifest(path: string): Promise<OwnLoopInstallManifestV1> {
  const value = target(path);
  try {
    const stats = await lstat(value);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_INSTALL_MANIFEST_BYTES) {
      throw new InstallManifestError("unsafe_path");
    }
    return OwnLoopInstallManifestV1Schema.parse(
      parseStrictJsonObject((await readFile(value)).toString("utf8"), MAX_INSTALL_MANIFEST_BYTES),
    );
  } catch (error) {
    if (error instanceof InstallManifestError) throw error;
    if (fsCode(error) === "ENOENT") throw new InstallManifestError("missing_manifest");
    throw new InstallManifestError("invalid_manifest");
  }
}

export async function writeInstallManifestAtomic(
  path: string,
  manifestInput: unknown,
): Promise<void> {
  const value = target(path);
  let manifest: OwnLoopInstallManifestV1;
  try {
    manifest = OwnLoopInstallManifestV1Schema.parse(manifestInput);
  } catch {
    throw new InstallManifestError("invalid_manifest");
  }
  const parent = dirname(value);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    const parentStats = await lstat(parent);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory())
      throw new InstallManifestError("unsafe_path");
    const existing = await lstat(value).catch((error: unknown) => {
      if (fsCode(error) === "ENOENT") return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw new InstallManifestError("unsafe_path");
  } catch (error) {
    if (error instanceof InstallManifestError) throw error;
    throw new InstallManifestError("operation_failed");
  }
  const temporary = `${value}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(manifest)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, value);
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new InstallManifestError("operation_failed");
  }
}
