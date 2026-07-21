import { createHash } from "node:crypto";

import type { ScannedUntrackedEntry } from "./untracked.js";
import { GIT_BASELINE_FINGERPRINT_VERSION } from "./constants.js";

function field(value: string | number | boolean | null): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return String(value);
}

export function computeWorkingTreeFingerprint(
  input: Readonly<{
    headCommit: string | null;
    stagedDiffSha256: string;
    unstagedDiffSha256: string;
    statusBeforeSha256: string;
    statusAfterSha256: string;
    entries: readonly ScannedUntrackedEntry[];
  }>,
): string {
  const hash = createHash("sha256");
  const write = (name: string, value: string | number | boolean | null): void => {
    hash.update(name, "utf8");
    hash.update("\0", "utf8");
    hash.update(field(value), "utf8");
    hash.update("\0", "utf8");
  };

  write("version", GIT_BASELINE_FINGERPRINT_VERSION);
  write("head", input.headCommit ?? "unborn");
  write("staged", input.stagedDiffSha256);
  write("unstaged", input.unstagedDiffSha256);
  write("status-before", input.statusBeforeSha256);
  write("status-after", input.statusAfterSha256);
  for (const [index, entry] of input.entries.entries()) {
    write("entry-index", index);
    write("entry-path", entry.pathIdentitySha256);
    write("entry-kind", entry.kind);
    write("entry-size", entry.sizeBytes);
    write("entry-content", entry.contentSha256);
    write("entry-sensitivity", entry.sensitivity);
    write("entry-status", entry.hashStatus);
  }
  return hash.digest("hex");
}
