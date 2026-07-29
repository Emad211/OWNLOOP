import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  type OwnLoopRuntimePhase,
  type OwnLoopRuntimeStateV1,
  OwnLoopRuntimeStateV1Schema,
} from "@ownloop/contracts";

export const MAX_RUNTIME_STATE_BYTES = 16 * 1024;
const PHASE_RANK: Readonly<Record<OwnLoopRuntimePhase, number>> = {
  starting: 0,
  ready: 1,
  stopping: 2,
};

export class RuntimeStateError extends Error {
  readonly code:
    | "invalid_path"
    | "unsafe_path"
    | "invalid_state"
    | "state_too_large"
    | "instance_mismatch"
    | "invalid_transition"
    | "operation_failed";

  constructor(code: RuntimeStateError["code"]) {
    super("The local runtime state operation failed safely.");
    this.name = "RuntimeStateError";
    this.code = code;
  }
}

function filesystemCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function canonicalPath(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new RuntimeStateError("invalid_path");
  return resolve(path);
}

function canonicalBytes(state: OwnLoopRuntimeStateV1): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(OwnLoopRuntimeStateV1Schema.parse(state))}\n`);
}

async function assertNoSymbolicLink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new RuntimeStateError("unsafe_path");
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error;
    if (filesystemCode(error) !== "ENOENT") throw new RuntimeStateError("operation_failed");
  }
}

async function ensureContainedParent(path: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymbolicLink(parent);
  try {
    const actual = await realpath(parent);
    if (resolve(actual) !== resolve(parent)) throw new RuntimeStateError("unsafe_path");
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error;
    throw new RuntimeStateError("operation_failed");
  }
}

export async function readRuntimeState(path: string): Promise<OwnLoopRuntimeStateV1 | null> {
  const target = canonicalPath(path);
  await assertNoSymbolicLink(target);
  let bytes: Buffer;
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.size > MAX_RUNTIME_STATE_BYTES) {
      throw new RuntimeStateError(
        stats.size > MAX_RUNTIME_STATE_BYTES ? "state_too_large" : "unsafe_path",
      );
    }
    bytes = await readFile(target);
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error;
    if (filesystemCode(error) === "ENOENT") return null;
    throw new RuntimeStateError("operation_failed");
  }
  try {
    return OwnLoopRuntimeStateV1Schema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new RuntimeStateError("invalid_state");
  }
}

export async function writeRuntimeStateAtomic(
  path: string,
  state: OwnLoopRuntimeStateV1,
): Promise<void> {
  const target = canonicalPath(path);
  await ensureContainedParent(target);
  await assertNoSymbolicLink(target);
  const bytes = canonicalBytes(state);
  if (bytes.byteLength > MAX_RUNTIME_STATE_BYTES) throw new RuntimeStateError("state_too_large");
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // best effort only
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof RuntimeStateError) throw error;
    throw new RuntimeStateError("operation_failed");
  }
}

export async function removeOwnedRuntimeState(path: string, instanceId: string): Promise<boolean> {
  const current = await readRuntimeState(path);
  if (current === null) return false;
  if (current.instanceId !== instanceId) throw new RuntimeStateError("instance_mismatch");
  try {
    await rm(canonicalPath(path), { force: false });
    return true;
  } catch (error) {
    if (filesystemCode(error) === "ENOENT") return false;
    throw new RuntimeStateError("operation_failed");
  }
}

export class RuntimeStateController {
  readonly #path: string;
  #current: OwnLoopRuntimeStateV1 | null = null;

  constructor(path: string) {
    this.#path = canonicalPath(path);
  }

  get current(): OwnLoopRuntimeStateV1 | null {
    return this.#current;
  }

  async publish(state: OwnLoopRuntimeStateV1): Promise<void> {
    const parsed = OwnLoopRuntimeStateV1Schema.parse(state);
    if (this.#current !== null) {
      if (parsed.instanceId !== this.#current.instanceId) {
        throw new RuntimeStateError("instance_mismatch");
      }
      if (PHASE_RANK[parsed.phase] < PHASE_RANK[this.#current.phase]) {
        throw new RuntimeStateError("invalid_transition");
      }
      if (
        parsed.startedAt !== this.#current.startedAt ||
        parsed.updatedAt < this.#current.updatedAt
      ) {
        throw new RuntimeStateError("invalid_transition");
      }
    }
    await writeRuntimeStateAtomic(this.#path, parsed);
    this.#current = parsed;
  }

  async remove(instanceId: string): Promise<boolean> {
    const removed = await removeOwnedRuntimeState(this.#path, instanceId);
    if (this.#current?.instanceId === instanceId) this.#current = null;
    return removed;
  }
}
