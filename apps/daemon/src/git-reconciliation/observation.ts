import {
  DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS,
  GitCommandError,
  observeGitBaseline,
  runGitCommand,
  type GitBaselineObservationLimits,
  type GitCommandRunner,
} from "../git-baseline/index.js";
import type { GitReconciliationDiagnosticCode } from "../persistence/index.js";
import { DEFAULT_GIT_RECONCILIATION_ENTRY_LIMIT } from "./constants.js";
import { parseGitPorcelainV2Status, type ParsedGitStatusEntry } from "./status-parser.js";

export type GitReconciliationObservationLimits = GitBaselineObservationLimits &
  Readonly<{ maximumStatusEntries: number }>;

export const DEFAULT_GIT_RECONCILIATION_OBSERVATION_LIMITS: GitReconciliationObservationLimits =
  Object.freeze({
    ...DEFAULT_GIT_BASELINE_OBSERVATION_LIMITS,
    maximumStatusEntries: DEFAULT_GIT_RECONCILIATION_ENTRY_LIMIT,
  });

export type GitReconciliationObservation = Readonly<{
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
  entries: readonly ParsedGitStatusEntry[];
  diagnosticCode: GitReconciliationDiagnosticCode | null;
}>;

function mapBaselineDiagnostic(
  code: import("../persistence/index.js").GitBaselineDiagnosticCode | null,
): GitReconciliationDiagnosticCode | null {
  if (code === "late_capture" || code === "baseline_processing_failed") {
    return "reconciliation_processing_failed";
  }
  return code;
}

function mapGitFailure(error: unknown): GitReconciliationDiagnosticCode {
  if (error instanceof GitCommandError) {
    switch (error.code) {
      case "executable_unavailable":
        return "git_executable_unavailable";
      case "timeout":
        return "git_command_timeout";
      case "output_limit":
        return "git_output_limit_exceeded";
      case "exit_nonzero":
        return "git_command_failed";
    }
  }
  return "git_command_failed";
}

export async function observeGitReconciliation(
  input: Readonly<{
    workspacePath: string;
    executable?: string;
    runner?: GitCommandRunner;
    limits?: GitReconciliationObservationLimits;
  }>,
): Promise<GitReconciliationObservation> {
  const executable = input.executable ?? "git";
  const runner = input.runner ?? runGitCommand;
  const limits = input.limits ?? DEFAULT_GIT_RECONCILIATION_OBSERVATION_LIMITS;
  const baselineObservation = await observeGitBaseline({
    workspacePath: input.workspacePath,
    executable,
    runner,
    limits,
  });

  if (!baselineObservation.repositoryDiscovered) {
    return {
      ...baselineObservation,
      entries: [],
      diagnosticCode: mapBaselineDiagnostic(baselineObservation.diagnosticCode),
    };
  }

  let parsedEntries: readonly ParsedGitStatusEntry[] = [];
  let statusDiagnostic: GitReconciliationDiagnosticCode | null = null;
  try {
    const status = await runner({
      executable,
      cwd: baselineObservation.repositoryRoot,
      args: [
        "-C",
        baselineObservation.repositoryRoot,
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
        "--no-renames",
      ],
      mode: "buffer",
      maximumStdoutBytes: limits.maximumCommandOutputBytes,
      maximumStderrBytes: 64 * 1024,
      timeoutMs: limits.commandTimeoutMs,
    });
    if (status.stdout === null) {
      statusDiagnostic = "git_command_failed";
    } else {
      const parsed = parseGitPorcelainV2Status(status.stdout, limits.maximumStatusEntries);
      parsedEntries = parsed.entries;
      statusDiagnostic = parsed.diagnosticCode;
    }

    const checkpoint = await runner({
      executable,
      cwd: baselineObservation.repositoryRoot,
      args: [
        "-C",
        baselineObservation.repositoryRoot,
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ],
      mode: "hash",
      maximumStdoutBytes: limits.maximumCommandOutputBytes,
      maximumStderrBytes: 64 * 1024,
      timeoutMs: limits.commandTimeoutMs,
    });
    if (
      statusDiagnostic === null &&
      checkpoint.stdoutSha256 !== baselineObservation.statusAfterSha256
    ) {
      statusDiagnostic = "repository_changed_during_capture";
    }
  } catch (error) {
    statusDiagnostic ??= mapGitFailure(error);
  }

  return {
    repositoryRoot: baselineObservation.repositoryRoot,
    repositoryDiscovered: baselineObservation.repositoryDiscovered,
    headCommit: baselineObservation.headCommit,
    headResolved: baselineObservation.headResolved,
    stagedDiffSha256: baselineObservation.stagedDiffSha256,
    unstagedDiffSha256: baselineObservation.unstagedDiffSha256,
    statusBeforeSha256: baselineObservation.statusBeforeSha256,
    statusAfterSha256: baselineObservation.statusAfterSha256,
    workingTreeFingerprint: baselineObservation.workingTreeFingerprint,
    stagedDirty: baselineObservation.stagedDirty,
    unstagedDirty: baselineObservation.unstagedDirty,
    entries: parsedEntries,
    diagnosticCode: statusDiagnostic ?? mapBaselineDiagnostic(baselineObservation.diagnosticCode),
  };
}
