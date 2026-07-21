import { realpath } from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { GitBaselineDiagnosticCode } from "../persistence/index.js";
import {
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
  DEFAULT_UNTRACKED_ENTRY_LIMIT,
  DEFAULT_UNTRACKED_HASH_LIMIT_BYTES,
} from "./constants.js";
import { GitCommandError, type GitCommandRunner, runGitCommand } from "./git-runner.js";
import { computeWorkingTreeFingerprint } from "./fingerprint.js";
import {
  scanUntrackedEntries,
  type ScannedUntrackedEntry,
  type UntrackedScanHooks,
} from "./untracked.js";

export type GitBaselineObservationLimits = Readonly<{
  commandTimeoutMs: number;
  maximumCommandOutputBytes: number;
  maximumUntrackedEntries: number;
  maximumUntrackedHashBytes: number;
}>;

export const DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS: GitBaselineObservationLimits = Object.freeze({
  commandTimeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  maximumCommandOutputBytes: DEFAULT_GIT_OUTPUT_LIMIT_BYTES,
  maximumUntrackedEntries: DEFAULT_UNTRACKED_ENTRY_LIMIT,
  maximumUntrackedHashBytes: DEFAULT_UNTRACKED_HASH_LIMIT_BYTES,
});

export type GitBaselineObservation = Readonly<{
  repositoryRoot: string;
  repositoryDiscovered: boolean;
  headCommit: string | null;
  headResolved: boolean;
  stagedDiffSha256: string | null;
  unstagedDiffSha256: string | null;
  statusBeforeSha256: string | null;
  statusAfterSha256: string | null;
  workingTreeFingerprint: string | null;
  stagedDirty: boolean;
  unstagedDirty: boolean;
  entries: readonly ScannedUntrackedEntry[];
  untrackedCount: number;
  untrackedHashedCount: number;
  untrackedOmittedCount: number;
  diagnosticCode: GitBaselineDiagnosticCode | null;
}>;

function canonicalText(buffer: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).trim();
  } catch {
    return null;
  }
}

function diagnosticFromError(error: unknown, discovery: boolean): GitBaselineDiagnosticCode {
  if (error instanceof GitCommandError) {
    switch (error.code) {
      case "executable_unavailable":
        return "git_executable_unavailable";
      case "timeout":
        return "git_command_timeout";
      case "output_limit":
        return "git_output_limit_exceeded";
      case "exit_nonzero":
        return discovery ? "not_a_git_repository" : "git_command_failed";
    }
  }
  return discovery ? "not_a_git_repository" : "git_command_failed";
}

function partialObservation(
  workspacePath: string,
  diagnosticCode: GitBaselineDiagnosticCode,
  input: Partial<GitBaselineObservation> = {},
): GitBaselineObservation {
  return {
    repositoryRoot: input.repositoryRoot ?? workspacePath,
    repositoryDiscovered: input.repositoryDiscovered ?? false,
    headCommit: input.headCommit ?? null,
    headResolved: input.headResolved ?? false,
    stagedDiffSha256: input.stagedDiffSha256 ?? null,
    unstagedDiffSha256: input.unstagedDiffSha256 ?? null,
    statusBeforeSha256: input.statusBeforeSha256 ?? null,
    statusAfterSha256: input.statusAfterSha256 ?? null,
    workingTreeFingerprint: input.workingTreeFingerprint ?? null,
    stagedDirty: input.stagedDirty ?? false,
    unstagedDirty: input.unstagedDirty ?? false,
    entries: input.entries ?? [],
    untrackedCount: input.untrackedCount ?? 0,
    untrackedHashedCount: input.untrackedHashedCount ?? 0,
    untrackedOmittedCount: input.untrackedOmittedCount ?? 0,
    diagnosticCode,
  };
}

async function runBuffer(
  runner: GitCommandRunner,
  executable: string,
  cwd: string,
  args: readonly string[],
  limits: GitBaselineObservationLimits,
) {
  return await runner({
    executable,
    cwd,
    args,
    mode: "buffer",
    maximumStdoutBytes: limits.maximumCommandOutputBytes,
    maximumStderrBytes: 64 * 1024,
    timeoutMs: limits.commandTimeoutMs,
  });
}

async function runHash(
  runner: GitCommandRunner,
  executable: string,
  cwd: string,
  args: readonly string[],
  limits: GitBaselineObservationLimits,
) {
  return await runner({
    executable,
    cwd,
    args,
    mode: "hash",
    maximumStdoutBytes: limits.maximumCommandOutputBytes,
    maximumStderrBytes: 64 * 1024,
    timeoutMs: limits.commandTimeoutMs,
  });
}

export async function observeGitBaseline(
  input: Readonly<{
    workspacePath: string;
    executable?: string;
    runner?: GitCommandRunner;
    limits?: GitBaselineObservationLimits;
    scanHooks?: UntrackedScanHooks;
  }>,
): Promise<GitBaselineObservation> {
  const executable = input.executable ?? "git";
  const runner = input.runner ?? runGitCommand;
  const limits = input.limits ?? DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS;

  let root: string;
  try {
    const result = await runBuffer(
      runner,
      executable,
      input.workspacePath,
      ["-C", input.workspacePath, "rev-parse", "--show-toplevel"],
      limits,
    );
    const text = result.stdout === null ? null : canonicalText(result.stdout);
    if (text === null || text.length === 0) {
      return partialObservation(input.workspacePath, "not_a_git_repository");
    }
    root = await realpath(text);
  } catch (error) {
    return partialObservation(input.workspacePath, diagnosticFromError(error, true));
  }

  let headCommit: string | null = null;
  let headResolved = false;
  try {
    const result = await runBuffer(
      runner,
      executable,
      root,
      ["-C", root, "rev-parse", "--verify", "HEAD"],
      limits,
    );
    const value = result.stdout === null ? null : canonicalText(result.stdout);
    if (value === null || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
      return partialObservation(input.workspacePath, "git_command_failed", {
        repositoryRoot: root,
        repositoryDiscovered: true,
      });
    }
    headCommit = value;
    headResolved = true;
  } catch (error) {
    if (error instanceof GitCommandError && error.code === "exit_nonzero") {
      headCommit = null;
      headResolved = true;
    } else {
      return partialObservation(input.workspacePath, diagnosticFromError(error, false), {
        repositoryRoot: root,
        repositoryDiscovered: true,
      });
    }
  }

  try {
    const statusBefore = await runBuffer(
      runner,
      executable,
      root,
      ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"],
      limits,
    );
    const staged = await runHash(
      runner,
      executable,
      root,
      [
        "-C",
        root,
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--full-index",
        "--src-prefix=a/",
        "--dst-prefix=b/",
      ],
      limits,
    );
    const unstaged = await runHash(
      runner,
      executable,
      root,
      [
        "-C",
        root,
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--full-index",
        "--src-prefix=a/",
        "--dst-prefix=b/",
      ],
      limits,
    );
    const untrackedList = await runBuffer(
      runner,
      executable,
      root,
      ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"],
      limits,
    );
    if (untrackedList.stdout === null) {
      return partialObservation(input.workspacePath, "git_command_failed", {
        repositoryRoot: root,
        repositoryDiscovered: true,
        headCommit,
        headResolved,
      });
    }
    const untracked = await scanUntrackedEntries(
      root,
      untrackedList.stdout,
      {
        maximumEntries: limits.maximumUntrackedEntries,
        maximumHashBytes: limits.maximumUntrackedHashBytes,
      },
      input.scanHooks,
    );
    const statusAfter = await runBuffer(
      runner,
      executable,
      root,
      ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"],
      limits,
    );

    const diagnostics = [...untracked.diagnostics];
    if (statusBefore.stdoutSha256 !== statusAfter.stdoutSha256) {
      diagnostics.unshift("repository_changed_during_capture");
    }
    const workingTreeFingerprint = computeWorkingTreeFingerprint({
      headCommit,
      stagedDiffSha256: staged.stdoutSha256,
      unstagedDiffSha256: unstaged.stdoutSha256,
      statusBeforeSha256: statusBefore.stdoutSha256,
      statusAfterSha256: statusAfter.stdoutSha256,
      entries: untracked.entries,
    });
    return {
      repositoryRoot: root,
      repositoryDiscovered: true,
      headCommit,
      headResolved,
      stagedDiffSha256: staged.stdoutSha256,
      unstagedDiffSha256: unstaged.stdoutSha256,
      statusBeforeSha256: statusBefore.stdoutSha256,
      statusAfterSha256: statusAfter.stdoutSha256,
      workingTreeFingerprint,
      stagedDirty: staged.stdoutBytes > 0,
      unstagedDirty: unstaged.stdoutBytes > 0,
      entries: untracked.entries,
      untrackedCount: untracked.totalCount,
      untrackedHashedCount: untracked.hashedCount,
      untrackedOmittedCount: untracked.omittedCount,
      diagnosticCode: diagnostics[0] ?? null,
    };
  } catch (error) {
    return partialObservation(input.workspacePath, diagnosticFromError(error, false), {
      repositoryRoot: root,
      repositoryDiscovered: true,
      headCommit,
      headResolved,
    });
  }
}
