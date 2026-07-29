import { lstat, readFile, rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { OwnLoopRuntimeStateV1Schema, type OwnLoopRuntimeStateV1 } from "@ownloop/contracts";

import { parseStrictJsonObject } from "./strict-json.js";

const MAX_RUNTIME_STATE_BYTES = 16 * 1024;

export class InstalledRuntimeStateError extends Error {
  readonly code:
    | "invalid_path"
    | "unsafe_path"
    | "invalid_state"
    | "operation_failed"
    | "instance_mismatch";
  constructor(code: InstalledRuntimeStateError["code"]) {
    super("The installed runtime state is invalid or unavailable.");
    this.name = "InstalledRuntimeStateError";
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
  if (!isAbsolute(path) || path.includes("\0"))
    throw new InstalledRuntimeStateError("invalid_path");
  return resolve(path);
}

export async function readInstalledRuntimeState(
  path: string,
): Promise<OwnLoopRuntimeStateV1 | null> {
  const value = target(path);
  try {
    const stats = await lstat(value);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_RUNTIME_STATE_BYTES) {
      throw new InstalledRuntimeStateError("unsafe_path");
    }
    return OwnLoopRuntimeStateV1Schema.parse(
      parseStrictJsonObject((await readFile(value)).toString("utf8"), MAX_RUNTIME_STATE_BYTES),
    );
  } catch (error) {
    if (error instanceof InstalledRuntimeStateError) throw error;
    if (fsCode(error) === "ENOENT") return null;
    throw new InstalledRuntimeStateError("invalid_state");
  }
}

export async function removeInstalledRuntimeState(
  path: string,
  instanceId: string,
): Promise<boolean> {
  const value = target(path);
  const current = await readInstalledRuntimeState(value);
  if (current === null) return false;
  if (current.instanceId !== instanceId) throw new InstalledRuntimeStateError("instance_mismatch");
  try {
    await rm(value);
    return true;
  } catch (error) {
    if (fsCode(error) === "ENOENT") return false;
    throw new InstalledRuntimeStateError("operation_failed");
  }
}
