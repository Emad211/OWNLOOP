import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  OwnLoopInstallationSecretsV1Schema,
  type OwnLoopInstallationSecretsV1,
} from "@ownloop/contracts";

import { parseStrictJsonObject } from "./strict-json.js";

const MAX_SECRET_DOCUMENT_BYTES = 16 * 1024;

export class InstallationSecretError extends Error {
  readonly code: "invalid_path" | "unsafe_path" | "invalid_secret" | "operation_failed";
  constructor(code: InstallationSecretError["code"]) {
    super("The installation credential operation failed safely.");
    this.name = "InstallationSecretError";
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

function targetPath(path: string): string {
  if (!isAbsolute(path) || path.includes("\0")) throw new InstallationSecretError("invalid_path");
  return resolve(path);
}

async function rejectSymlink(path: string, allowMissing: boolean): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new InstallationSecretError("unsafe_path");
  } catch (error) {
    if (error instanceof InstallationSecretError) throw error;
    if (allowMissing && fsCode(error) === "ENOENT") return;
    throw new InstallationSecretError("operation_failed");
  }
}

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InstallationSecretError("operation_failed");
  }
  return value.toISOString();
}

export function generateInstallationSecrets(
  clock: () => Date = () => new Date(),
): OwnLoopInstallationSecretsV1 {
  const token = randomBytes(32).toString("base64url");
  let hmacKey = randomBytes(32).toString("base64url");
  while (hmacKey === token) hmacKey = randomBytes(32).toString("base64url");
  return OwnLoopInstallationSecretsV1Schema.parse({
    schemaVersion: 1,
    installId: `install_${randomUUID().replaceAll("-", "")}`,
    installationToken: token,
    hmacKey,
    createdAt: canonicalTimestamp(clock),
  });
}

export async function readInstallationSecrets(
  path: string,
): Promise<OwnLoopInstallationSecretsV1 | null> {
  const target = targetPath(path);
  await rejectSymlink(target, true);
  let bytes: Buffer;
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.size > MAX_SECRET_DOCUMENT_BYTES) {
      throw new InstallationSecretError("unsafe_path");
    }
    bytes = await readFile(target);
  } catch (error) {
    if (error instanceof InstallationSecretError) throw error;
    if (fsCode(error) === "ENOENT") return null;
    throw new InstallationSecretError("operation_failed");
  }
  try {
    return OwnLoopInstallationSecretsV1Schema.parse(
      parseStrictJsonObject(bytes.toString("utf8"), MAX_SECRET_DOCUMENT_BYTES),
    );
  } catch {
    throw new InstallationSecretError("invalid_secret");
  }
}

export async function createOrReadInstallationSecrets(
  path: string,
  clock: () => Date = () => new Date(),
): Promise<{ secrets: OwnLoopInstallationSecretsV1; created: boolean }> {
  const target = targetPath(path);
  const existing = await readInstallationSecrets(target);
  if (existing !== null) return { secrets: existing, created: false };
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await rejectSymlink(parent, false);
  const secrets = generateInstallationSecrets(clock);
  const temporary = `${target}.tmp-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(secrets)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    return { secrets, created: true };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    if (fsCode(error) === "EEXIST") {
      const raced = await readInstallationSecrets(target);
      if (raced !== null) return { secrets: raced, created: false };
    }
    throw new InstallationSecretError("operation_failed");
  }
}
