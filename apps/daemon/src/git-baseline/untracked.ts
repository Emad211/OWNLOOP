import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import type {
  GitBaselineDiagnosticCode,
  GitBaselineEntryHashStatus,
  GitBaselineEntryKind,
  GitBaselineEntrySensitivity,
} from "../persistence/index.js";

export type ScannedUntrackedEntry = Readonly<{
  pathIdentitySha256: string;
  relativePath: string | null;
  kind: GitBaselineEntryKind;
  sizeBytes: number | null;
  contentSha256: string | null;
  sensitivity: GitBaselineEntrySensitivity;
  hashStatus: GitBaselineEntryHashStatus;
}>;

export type UntrackedScanLimits = Readonly<{
  maximumEntries: number;
  maximumHashBytes: number;
}>;

export type UntrackedScanHooks = Readonly<{
  afterRegularFileRead?: (relativePath: string) => void | Promise<void>;
}>;

export type UntrackedScanResult = Readonly<{
  entries: readonly ScannedUntrackedEntry[];
  totalCount: number;
  hashedCount: number;
  omittedCount: number;
  diagnostics: readonly GitBaselineDiagnosticCode[];
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeGitRelativePath(value: string): string | null {
  if (value.length === 0 || value.includes("\0") || value.includes("\\")) {
    return null;
  }
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    return null;
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

async function safeAbsolutePath(
  root: string,
  normalizedRelativePath: string,
): Promise<string | null> {
  const candidate = resolve(root, ...normalizedRelativePath.split("/"));
  const rel = relative(root, candidate);
  if (rel === "" || rel === ".") {
    return null;
  }
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }

  try {
    const canonicalParent = await realpath(dirname(candidate));
    const parentRelative = relative(root, canonicalParent);
    if (
      parentRelative === ".." ||
      parentRelative.startsWith(`..${sep}`) ||
      isAbsolute(parentRelative)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return candidate;
}

export function isSensitiveUntrackedPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const segments = lower.split("/");
  const name = segments.at(-1) ?? lower;
  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  if (
    [".npmrc", ".pypirc", ".netrc", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].includes(name)
  ) {
    return true;
  }
  if (lower === ".aws/credentials" || lower.endsWith("/.aws/credentials")) {
    return true;
  }
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx)$/.test(name)) {
    return true;
  }
  return /(^|[._-])(credential|credentials|secret|secrets|password|passwd|token|api[-_]?key|private[-_]?key)([._-]|$)/.test(
    name,
  );
}

function pathIdentity(relativePath: string): string {
  return sha256(`ownloop-untracked-path-v1\0${relativePath}`);
}

async function readRegularFileBounded(
  absolutePath: string,
  maximumBytes: number,
): Promise<Buffer | null> {
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(absolutePath, constants.O_RDONLY | noFollow);
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (total <= maximumBytes) {
      const remaining = maximumBytes + 1 - total;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    return total > maximumBytes ? null : Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function sameFileState(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.mode === after.mode
  );
}

async function scanOne(
  root: string,
  relativePath: string,
  maximumHashBytes: number,
  hooks: UntrackedScanHooks,
): Promise<
  Readonly<{ entry: ScannedUntrackedEntry; diagnostic: GitBaselineDiagnosticCode | null }>
> {
  const identity = pathIdentity(relativePath);
  const sensitive = isSensitiveUntrackedPath(relativePath);
  if (sensitive) {
    return {
      entry: {
        pathIdentitySha256: identity,
        relativePath: null,
        kind: "other",
        sizeBytes: null,
        contentSha256: null,
        sensitivity: "secret",
        hashStatus: "sensitive_path",
      },
      diagnostic: null,
    };
  }

  const absolutePath = await safeAbsolutePath(root, relativePath);
  if (absolutePath === null) {
    return {
      entry: {
        pathIdentitySha256: identity,
        relativePath,
        kind: "other",
        sizeBytes: null,
        contentSha256: null,
        sensitivity: "normal",
        hashStatus: "unreadable",
      },
      diagnostic: "untracked_entry_unreadable",
    };
  }

  try {
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink()) {
      const target = await readlink(absolutePath, "utf8");
      const after = await lstat(absolutePath);
      const stable = sameFileState(before, after);
      return {
        entry: {
          pathIdentitySha256: identity,
          relativePath,
          kind: "symlink",
          sizeBytes: before.size,
          contentSha256: stable ? sha256(target) : null,
          sensitivity: "normal",
          hashStatus: stable ? "hashed" : "changed_during_capture",
        },
        diagnostic: stable ? null : "untracked_entry_changed",
      };
    }
    if (before.isDirectory()) {
      return {
        entry: {
          pathIdentitySha256: identity,
          relativePath,
          kind: "directory",
          sizeBytes: null,
          contentSha256: null,
          sensitivity: "normal",
          hashStatus: "non_regular",
        },
        diagnostic: null,
      };
    }
    if (!before.isFile()) {
      return {
        entry: {
          pathIdentitySha256: identity,
          relativePath,
          kind: "other",
          sizeBytes: before.size,
          contentSha256: null,
          sensitivity: "normal",
          hashStatus: "non_regular",
        },
        diagnostic: null,
      };
    }
    if (before.size > maximumHashBytes) {
      return {
        entry: {
          pathIdentitySha256: identity,
          relativePath,
          kind: "regular",
          sizeBytes: before.size,
          contentSha256: null,
          sensitivity: "normal",
          hashStatus: "too_large",
        },
        diagnostic: null,
      };
    }

    const content = await readRegularFileBounded(absolutePath, maximumHashBytes);
    await hooks.afterRegularFileRead?.(relativePath);
    const after = await lstat(absolutePath);
    if (content === null || !sameFileState(before, after)) {
      return {
        entry: {
          pathIdentitySha256: identity,
          relativePath,
          kind: "regular",
          sizeBytes: before.size,
          contentSha256: null,
          sensitivity: "normal",
          hashStatus: "changed_during_capture",
        },
        diagnostic: "untracked_entry_changed",
      };
    }
    return {
      entry: {
        pathIdentitySha256: identity,
        relativePath,
        kind: "regular",
        sizeBytes: before.size,
        contentSha256: sha256(content),
        sensitivity: "normal",
        hashStatus: "hashed",
      },
      diagnostic: null,
    };
  } catch {
    return {
      entry: {
        pathIdentitySha256: identity,
        relativePath,
        kind: "other",
        sizeBytes: null,
        contentSha256: null,
        sensitivity: "normal",
        hashStatus: "unreadable",
      },
      diagnostic: "untracked_entry_unreadable",
    };
  }
}

export async function scanUntrackedEntries(
  root: string,
  rawList: Buffer,
  limits: UntrackedScanLimits,
  hooks: UntrackedScanHooks = {},
): Promise<UntrackedScanResult> {
  if (
    !Number.isInteger(limits.maximumEntries) ||
    limits.maximumEntries < 1 ||
    !Number.isInteger(limits.maximumHashBytes) ||
    limits.maximumHashBytes < 0
  ) {
    return {
      entries: [],
      totalCount: 0,
      hashedCount: 0,
      omittedCount: 0,
      diagnostics: ["untracked_entry_unreadable"],
    };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawList);
  } catch {
    return {
      entries: [],
      totalCount: 0,
      hashedCount: 0,
      omittedCount: 0,
      diagnostics: ["untracked_entry_unreadable"],
    };
  }

  const rawPaths = text.split("\0");
  if (rawPaths.at(-1) === "") {
    rawPaths.pop();
  }
  const normalizedPaths: string[] = [];
  const diagnostics: GitBaselineDiagnosticCode[] = [];
  for (const rawPath of rawPaths) {
    const normalized = normalizeGitRelativePath(rawPath);
    if (normalized === null) {
      diagnostics.push("untracked_entry_unreadable");
      continue;
    }
    normalizedPaths.push(normalized);
  }
  normalizedPaths.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));

  const totalCount = normalizedPaths.length;
  if (totalCount > limits.maximumEntries) {
    diagnostics.unshift("untracked_inventory_limit_exceeded");
  }
  const selected = normalizedPaths.slice(0, limits.maximumEntries);
  const entries: ScannedUntrackedEntry[] = [];
  for (const relativePath of selected) {
    const scanned = await scanOne(root, relativePath, limits.maximumHashBytes, hooks);
    entries.push(scanned.entry);
    if (scanned.diagnostic !== null && !diagnostics.includes(scanned.diagnostic)) {
      diagnostics.push(scanned.diagnostic);
    }
  }
  const hashedCount = entries.filter((entry) => entry.hashStatus === "hashed").length;
  const omittedCount = totalCount - hashedCount;
  return {
    entries,
    totalCount,
    hashedCount,
    omittedCount,
    diagnostics,
  };
}
